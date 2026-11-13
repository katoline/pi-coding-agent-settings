import type { Invocation } from "../lib/shell.ts";
import type { GuardInput } from "../lib/types.ts";
import { ALLOW, ask, block, combine, type Verdict } from "../lib/verdict.ts";

/** `git` の前置オプション(-C、-c など)を読み飛ばして、サブコマンドと残りの引数を返す */
export function gitSubcommand(
  inv: Invocation,
): { sub: string; args: string[]; dynamic: boolean } | null {
  const words = inv.args;
  let i = 0;
  const withValue = new Set(["-C", "-c", "--git-dir", "--work-tree", "--namespace", "--exec-path"]);
  while (i < words.length) {
    const v = words[i]?.value ?? "";
    if (withValue.has(v)) {
      i += 2;
      continue;
    }
    if (v.startsWith("-")) {
      i++;
      continue;
    }
    break;
  }
  const sub = words[i];
  if (!sub) return null;
  const rest = words.slice(i + 1);
  return {
    sub: sub.value,
    args: rest.map((w) => w.value),
    dynamic: rest.some((w) => w.dynamic) || sub.dynamic,
  };
}

const FORCE_FLAGS = new Set(["-f", "--force", "--force-with-lease", "--force-if-includes"]);

function stripRef(ref: string): string {
  return ref.replace(/^refs\/heads\//, "").replace(/^\+/, "");
}

function isDefault(name: string, input: GuardInput): boolean {
  return input.git.defaultBranches.has(name);
}

const SUBAGENT_DENIED_GIT = new Set([
  "commit",
  "push",
  "merge",
  "pull",
  "cherry-pick",
  "rebase",
  "revert",
  "am",
  "tag",
]);

const subagentReason = (what: string) =>
  `${what} はサブエージェントからは実行できません。変更は親(メインセッション)に任せ、変更したファイルと検証結果を報告してください。`;

function checkPush(args: string[], dynamic: boolean, input: GuardInput): Verdict {
  const flags = args.filter((a) => a.startsWith("-"));
  const positional = args.filter((a) => !a.startsWith("-"));
  const refspecs = positional.slice(1); // 最初の引数はリモート名

  if (
    flags.some((f) => FORCE_FLAGS.has(f) || f.startsWith("--force-with-lease=")) ||
    refspecs.some((r) => r.startsWith("+"))
  ) {
    return block("force push は禁止です。履歴を書き換えず、新しいコミットを追加してください。");
  }
  if (flags.includes("--no-verify")) {
    return block("`--no-verify` は禁止です。フックが失敗する原因を直してください。");
  }
  if (flags.some((f) => f === "--mirror" || f === "--all" || f === "--prune")) {
    return block(
      "`--mirror` / `--all` / `--prune` は、既定ブランチやほかのブランチを壊しうるため禁止です。ブランチ名を指定してください。",
    );
  }
  if (dynamic) {
    return block(
      "push のブランチ名を変数やコマンド置換で組み立てないでください。具体的なブランチ名を書いてください。",
    );
  }
  const deleting =
    flags.includes("--delete") || flags.includes("-d") || refspecs.some((r) => r.startsWith(":"));
  if (deleting) {
    const targets = refspecs.map((r) => stripRef(r.startsWith(":") ? r.slice(1) : r));
    const unmerged = targets.filter((t) => !input.git.mergedRemoteBranches.has(t));
    if (targets.length === 0 || unmerged.length > 0) {
      return block(
        `マージ済みでないリモートブランチは削除できません(${unmerged.join(", ") || "対象を指定してください"})。PR をマージしてから削除してください。`,
      );
    }
    return ALLOW;
  }
  const targets: string[] = [];
  if (refspecs.length === 0) {
    if (input.git.currentBranch) targets.push(input.git.currentBranch);
    else
      return block(
        "現在のブランチを判定できないため、push を許可できません。ブランチ名を明示してください。",
      );
  }
  for (const spec of refspecs) {
    const dst = spec.includes(":") ? (spec.split(":")[1] as string) : spec;
    const name = stripRef(dst === "HEAD" || dst === "" ? (input.git.currentBranch ?? "") : dst);
    if (name === "")
      return block("push 先のブランチを判定できません。ブランチ名を明示してください。");
    targets.push(name);
  }
  const hitDefault = targets.find((t) => isDefault(t, input));
  if (hitDefault) {
    return block(
      `既定ブランチ(${hitDefault})への直接の push は禁止です。作業ブランチを push し、PR(harness_pr_create)を作ってからマージしてください。`,
    );
  }
  return ALLOW;
}

function checkCommit(args: string[], input: GuardInput): Verdict {
  // `-n` は commit では --no-verify。`-nm` のような結合も見る(値は別の語なので、英字だけの語に限る)
  if (args.includes("--no-verify") || args.some((a) => /^-[a-zA-Z]*n[a-zA-Z]*$/.test(a))) {
    return block("`--no-verify` は禁止です。フックが失敗する原因を直してください。");
  }
  const branch = input.git.currentBranch;
  if (input.git.inRepo && branch && isDefault(branch, input)) {
    return block(
      `既定ブランチ(${branch})への直接の commit は禁止です。先に作業ブランチを作成してください: git switch -c <ブランチ名>`,
    );
  }
  if (args.includes("--amend")) {
    return ask("`git commit --amend` は履歴を書き換えます。ユーザーの明示的な許可が必要です。");
  }
  return ALLOW;
}

function destructiveGit(sub: string, args: string[]): Verdict {
  const has = (...f: string[]) => f.some((x) => args.includes(x));
  switch (sub) {
    case "reset":
      return has("--hard", "--merge", "--keep")
        ? ask("`git reset --hard` は作業ツリーの変更を破棄します。")
        : ALLOW;
    case "clean":
      return has("-n", "--dry-run")
        ? ALLOW
        : ask("`git clean` は追跡されていないファイルを削除します。");
    case "checkout": {
      const discards = has("--", ".", "-f", "--force");
      return discards ? ask("`git checkout` で変更を破棄しようとしています。") : ALLOW;
    }
    case "restore": {
      const stagedOnly = has("--staged") && !has("--worktree", "-W");
      return stagedOnly ? ALLOW : ask("`git restore` は作業ツリーの変更を破棄します。");
    }
    case "switch":
      return has("-f", "--force", "--discard-changes")
        ? ask("`git switch --discard-changes` は変更を破棄します。")
        : ALLOW;
    case "branch":
      return has("-D") || (has("-d") && has("-f", "--force"))
        ? ask("`git branch -D` は未マージのブランチを削除します。")
        : ALLOW;
    case "stash":
      return args[0] === "drop" || args[0] === "clear"
        ? ask("`git stash drop` / `clear` は退避した変更を失います。")
        : ALLOW;
    case "rebase":
      return ask("`git rebase` は履歴を書き換えます。");
    case "filter-branch":
    case "filter-repo":
      return ask("履歴を書き換える操作です。");
    case "reflog":
      return args[0] === "expire" || args[0] === "delete"
        ? ask("reflog を削除する操作です。")
        : ALLOW;
    case "gc":
      return args.some((a) => a.startsWith("--prune"))
        ? ask("`git gc --prune` は到達不能なオブジェクトを削除します。")
        : ALLOW;
    case "update-ref":
      return has("-d") ? ask("参照を削除する操作です。") : ALLOW;
    case "tag":
      return has("-d", "--delete") ? ask("タグを削除する操作です。") : ALLOW;
    default:
      return ALLOW;
  }
}

function checkWorktree(args: string[], dynamic: boolean, input: GuardInput): Verdict {
  const action = args[0];
  if (action === "prune") return ask("`git worktree prune` は worktree の記録を削除します。");
  if (action !== "remove") return ALLOW;
  if (args.includes("--force") || args.includes("-f")) {
    return block(
      "`git worktree remove --force` は禁止です。未保存の成果物がある場合は、削除せずに、理由とパスを報告してください。",
    );
  }
  const target = args.slice(1).find((a) => !a.startsWith("-"));
  if (!target || dynamic || !target.startsWith("/")) {
    return block(
      "`git worktree remove` は、メインのチェックアウトから、絶対パスを直接指定してください。",
    );
  }
  if (!input.git.ownedWorktrees.has(target)) {
    return block(
      `${target} は、このハーネスが作った worktree ではありません。他のセッションの worktree とブランチは削除しません。`,
    );
  }
  return ALLOW;
}

export function checkGit(inv: Invocation, input: GuardInput): Verdict {
  const parsed = gitSubcommand(inv);
  if (!parsed) return ALLOW;
  const { sub, args, dynamic } = parsed;

  if (input.env.isSubagent && SUBAGENT_DENIED_GIT.has(sub)) {
    return block(subagentReason(`\`git ${sub}\``));
  }

  const verdicts: Verdict[] = [];
  switch (sub) {
    case "commit":
      verdicts.push(checkCommit(args, input));
      break;
    case "push":
      verdicts.push(checkPush(args, dynamic, input));
      break;
    case "merge": {
      const branch = input.git.currentBranch;
      if (branch && isDefault(branch, input)) {
        verdicts.push(
          block(
            "既定ブランチ上での直接の merge は禁止です。マージは PR 経由(harness_pr_merge)で行ってください。",
          ),
        );
      }
      break;
    }
    case "worktree":
      if (input.env.isSubagent) verdicts.push(block(subagentReason("`git worktree`")));
      else verdicts.push(checkWorktree(args, dynamic, input));
      break;
    default:
      break;
  }
  verdicts.push(destructiveGit(sub, args));
  return combine(verdicts);
}

const PR_WRITE = new Set([
  "create",
  "edit",
  "merge",
  "ready",
  "close",
  "reopen",
  "review",
  "comment",
  "lock",
  "unlock",
  "update-branch",
]);
const GH_BLOCKED_GROUPS = new Set(["secret", "variable", "ruleset", "ssh-key", "gpg-key", "auth"]);

export function checkGh(inv: Invocation, input: GuardInput): Verdict {
  const words = inv.args.map((w) => w.value);
  const group = words.find((w) => !w.startsWith("-"));
  if (!group) return ALLOW;
  const action = words.slice(words.indexOf(group) + 1).find((w) => !w.startsWith("-"));

  if (input.env.isSubagent && group === "pr" && action && PR_WRITE.has(action)) {
    return block(subagentReason(`\`gh pr ${action}\``));
  }
  if (group === "pr" && (action === "create" || action === "edit")) {
    return block(
      "PR の作成・更新は harness_pr_create を使ってください(本文は差分とコミットから、概要・変更点・確認方法の固定の形で自動生成されます)。",
    );
  }
  if (group === "pr" && action === "merge") {
    return block(
      "マージは harness_pr_merge を使ってください(検証済みであること、CI がすべて通っていることを確認してからマージされます)。",
    );
  }
  if (group === "pr" && action && PR_WRITE.has(action) && !input.env.isSubagent) {
    return ALLOW;
  }
  if (group === "api") {
    const mutating =
      words.some(
        (w, i) => (w === "-X" || w === "--method") && (words[i + 1] ?? "").toUpperCase() !== "GET",
      ) ||
      words.some((w) => w.startsWith("--method=") && w.slice(9).toUpperCase() !== "GET") ||
      words.some(
        (w) =>
          w === "-f" || w === "-F" || w === "--field" || w === "--raw-field" || w === "--input",
      );
    if (mutating) {
      return block(
        "`gh api` による書き込み(POST・PUT・PATCH・DELETE)は禁止です。専用のツールを使ってください。",
      );
    }
    return ALLOW;
  }
  if (GH_BLOCKED_GROUPS.has(group)) {
    return block(`\`gh ${group}\` はリポジトリや認証の設定を変えるため禁止です。`);
  }
  if (
    group === "repo" &&
    action &&
    ["delete", "archive", "rename", "edit", "transfer"].includes(action)
  ) {
    return block(`\`gh repo ${action}\` は禁止です。`);
  }
  if (group === "release" && action && ["create", "delete", "edit", "upload"].includes(action)) {
    return block(`\`gh release ${action}\` は禁止です。`);
  }
  return ALLOW;
}
