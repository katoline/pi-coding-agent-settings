import { mkdirSync } from "node:fs";
import path from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { Runtime } from "../lib/runtime.ts";
import { latestCustomEntry } from "../lib/state.ts";
import { fsReader, parseNul, workingTreeFingerprint } from "./fingerprint.ts";
import { recordPr } from "./plan.ts";
import {
  buildPrBody,
  evaluateChecks,
  hasDefaultBranchProtection,
  isValidBranchName,
  mergeBlockers,
  parseChecks,
  parseGithubRemote,
  protectionRuleset,
  type Ruleset,
  worktreePath,
} from "./pr.ts";

const WORKTREE_ENTRY = "harness-worktrees";
const text = (t: string) => ({ content: [{ type: "text" as const, text: t }], details: undefined });

const CHECK_POLL_MS = 15_000;
const CHECK_TIMEOUT_MS = 20 * 60_000;

/**
 * Git・GitHub の書き込み(worktree、PR、マージ、ブランチ保護)の専用ツール。
 * これらは、サンドボックスの外(拡張のコードが、ホストで)で実行する。bash からの `git push`・
 * `gh pr create / merge` は、ガードが拒否し、ここへ誘導する。メインセッションだけが使える。
 */
export function registerGitTools(pi: ExtensionAPI, rt: Runtime): void {
  if (rt.isSubagent) return;

  async function git(cwd: string, args: string[], timeout = 30000) {
    return pi.exec("git", args, { cwd, timeout, maxBuffer: 32 * 1024 * 1024 });
  }
  async function gh(cwd: string, args: string[], timeout = 60000) {
    return pi.exec("gh", args, { cwd, timeout, maxBuffer: 8 * 1024 * 1024 });
  }
  const out = async (cwd: string, args: string[]) => {
    const r = await git(cwd, args);
    return r.code === 0 ? r.stdout.trim() : "";
  };

  async function repoRoot(cwd: string) {
    return (await out(cwd, ["rev-parse", "--show-toplevel"])) || null;
  }

  async function defaultBranch(cwd: string): Promise<string> {
    const head = await out(cwd, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]);
    return head.startsWith("origin/") ? head.slice(7) : (rt.config.defaultBranches[0] ?? "main");
  }

  async function fingerprint(cwd: string): Promise<string> {
    const root = await repoRoot(cwd);
    if (!root) return "no-repo";
    const r = await git(
      root,
      ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
      15000,
    );
    if (r.code !== 0) return "no-repo";
    return workingTreeFingerprint({
      listFiles: async () => parseNul(r.stdout),
      read: fsReader(root),
    });
  }

  const restoreWorktrees = (ctx: ExtensionContext) => {
    const saved = latestCustomEntry<{ paths?: string[] }>(
      ctx.sessionManager.getBranch(),
      WORKTREE_ENTRY,
    );
    rt.ownedWorktrees.clear();
    for (const p of saved?.paths ?? []) rt.ownedWorktrees.add(p);
  };
  const saveWorktrees = () => pi.appendEntry(WORKTREE_ENTRY, { paths: [...rt.ownedWorktrees] });
  pi.on("session_start", async (_e, ctx) => restoreWorktrees(ctx));
  pi.on("session_tree", async (_e, ctx) => restoreWorktrees(ctx));

  // ---- worktree ----
  pi.registerTool({
    name: "harness_worktree",
    label: "worktree",
    description:
      "タスク用の worktree を作る・削除する。並列に書き込むサブエージェントには、別々の worktree を渡す。作る場所は、リポジトリの隣の `<repo>.worktrees/<ブランチ名>`。削除は、このツールが作ったものだけで、未保存の成果物があれば残して、理由とパスを報告する(--force は使わない)。",
    parameters: Type.Object({
      action: Type.Union([Type.Literal("create"), Type.Literal("remove")]),
      branch: Type.Optional(Type.String({ description: "create: 作業ブランチ名" })),
      path: Type.Optional(Type.String({ description: "remove: 絶対パス" })),
    }),
    executionMode: "sequential",
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const root = await repoRoot(ctx.cwd);
      if (!root) return text("git のリポジトリの外では、worktree を作れません。");
      if (params.action === "create") {
        const branch = params.branch ?? "";
        if (!isValidBranchName(branch)) return text(`ブランチ名が不正です: ${branch}`);
        if ((await defaultBranch(root)) === branch || rt.config.defaultBranches.includes(branch)) {
          return text("既定ブランチは使えません。作業ブランチの名前を指定してください。");
        }
        const target = worktreePath(root, branch);
        if (rt.ownedWorktrees.has(target))
          return text(`すでにあります(使い回してください): ${target}`);
        mkdirSync(path.dirname(target), { recursive: true });
        const exists =
          (await git(root, ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`])).code ===
          0;
        const r = exists
          ? await git(root, ["worktree", "add", target, branch])
          : await git(root, ["worktree", "add", "-b", branch, target]);
        if (r.code !== 0) return text(`worktree を作れませんでした: ${r.stderr.trim()}`);
        rt.ownedWorktrees.add(target);
        saveWorktrees();
        rt.run.touched = true;
        return text(`worktree を作りました: ${target}(ブランチ ${branch})`);
      }
      // remove
      const target = params.path ?? "";
      if (!path.isAbsolute(target)) return text("remove には、絶対パスを指定してください。");
      if (!rt.ownedWorktrees.has(target)) {
        return text(
          `${target} は、このハーネスが作った worktree ではありません。他のセッションの worktree は削除しません。`,
        );
      }
      const dirty = (await git(target, ["status", "--porcelain"])).stdout.trim();
      if (dirty) return text(`未保存の変更があるため、残します: ${target}\n${dirty.slice(0, 500)}`);
      const unpushed = (
        await git(target, ["log", "--oneline", "HEAD", "--not", "--remotes"])
      ).stdout.trim();
      if (unpushed) {
        return text(
          `push されていないコミットがあるため、残します: ${target}\n${unpushed.slice(0, 500)}`,
        );
      }
      const r = await git(root, ["worktree", "remove", target]);
      if (r.code !== 0)
        return text(
          `削除できなかったため、残します(--force では再試行しません): ${target}\n${r.stderr.trim()}`,
        );
      rt.ownedWorktrees.delete(target);
      saveWorktrees();
      return text(`worktree を削除しました: ${target}`);
    },
  });

  // ---- ブランチ保護 ----
  async function ensureProtection(
    ctx: ExtensionContext,
    root: string,
    options: { confirm: boolean },
  ): Promise<{ ok: boolean; message: string }> {
    const remote = parseGithubRemote(await out(root, ["remote", "get-url", "origin"]));
    if (!remote)
      return {
        ok: false,
        message: "origin が GitHub のリポジトリではないため、ブランチ保護を確認できません。",
      };
    const slug = `${remote.owner}/${remote.repo}`;
    const listed = await gh(root, ["api", `repos/${slug}/rulesets`]);
    if (listed.code !== 0)
      return {
        ok: false,
        message: `ルールセットを取得できませんでした(gh の認証と権限を確認してください): ${listed.stderr.trim().slice(0, 200)}`,
      };
    let rulesets: Ruleset[] = [];
    try {
      const summaries = JSON.parse(listed.stdout) as { id: number }[];
      for (const s of summaries) {
        const detail = await gh(root, ["api", `repos/${slug}/rulesets/${s.id}`]);
        if (detail.code === 0) rulesets.push(JSON.parse(detail.stdout) as Ruleset);
      }
    } catch {
      rulesets = [];
    }
    if (hasDefaultBranchProtection(rulesets))
      return { ok: true, message: `${slug}: 既定ブランチは、ルールセットで保護されています。` };

    if (options.confirm) {
      if (!ctx.hasUI) {
        return {
          ok: false,
          message: `${slug} の既定ブランチが保護されていません。対話の画面がないため設定できません。ユーザーに、ブランチ保護(PR 必須、force push と削除の禁止、必須のチェック)の設定を依頼してください。`,
        };
      }
      const ok = await ctx.ui.confirm(
        "GitHub のブランチ保護を設定します",
        `${slug} の既定ブランチに、次のルールセットを作ります。\n- PR 必須\n- force push と削除の禁止\n- 必須のチェック: quality\n- bypass なし\n\n初めての push の前に、必ず設定します。よろしいですか?`,
      );
      if (!ok)
        return {
          ok: false,
          message: "ユーザーがブランチ保護の設定を許可しませんでした。push と PR は行えません。",
        };
    }
    const body = JSON.stringify(protectionRuleset(["quality"]));
    const created = await pi.exec(
      "sh",
      ["-c", `printf '%s' "$1" | gh api -X POST repos/${slug}/rulesets --input -`, "sh", body],
      { cwd: root, timeout: 60000 },
    );
    if (created.code !== 0)
      return {
        ok: false,
        message: `ルールセットを作れませんでした(管理者の権限が必要です): ${created.stderr.trim().slice(0, 300)}`,
      };
    return { ok: true, message: `${slug}: 既定ブランチのルールセットを作りました。` };
  }

  pi.registerTool({
    name: "harness_ensure_protection",
    label: "ブランチ保護",
    description:
      "GitHub の既定ブランチが、ルールセットで保護されているかを確認し、なければ(ユーザーの確認のうえ)作る。初めて push する前に必ず行う。harness_pr_create は、これを自動で呼ぶ。",
    parameters: Type.Object({}),
    async execute(_id, _p, _s, _u, ctx) {
      const root = await repoRoot(ctx.cwd);
      if (!root) return text("git のリポジトリの外です。");
      return text((await ensureProtection(ctx, root, { confirm: true })).message);
    },
  });

  // ---- PR の作成・更新 ----
  pi.registerTool({
    name: "harness_pr_create",
    label: "PR を作成・更新",
    description:
      "現在の作業ブランチを push し、PR を作る(すでにあれば更新する)。本文は、差分とコミットから、概要・変更点・確認方法の固定の形で自動生成する。コミットと PR は細かく分ける(1 つの PR に 1 つの目的)。既定ブランチ上では使えない。初回は、GitHub のブランチ保護を確認・設定する。",
    parameters: Type.Object({
      title: Type.String({ description: "PR のタイトル(1 つの目的)" }),
      summary: Type.Optional(
        Type.String({ description: "概要(1〜3 文)。省略するとコミットの件名から作る" }),
      ),
    }),
    executionMode: "sequential",
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const root = await repoRoot(ctx.cwd);
      if (!root) return text("git のリポジトリの外です。");
      const branch = await out(root, ["branch", "--show-current"]);
      const base = await defaultBranch(root);
      if (!branch)
        return text("ブランチ上にいません(detached HEAD)。作業ブランチに切り替えてください。");
      if (rt.config.defaultBranches.includes(branch) || branch === base) {
        return text(
          `既定ブランチ(${branch})上では、PR を作れません。作業ブランチを作成してください: git switch -c <ブランチ名>`,
        );
      }
      const dirty = await out(root, ["status", "--porcelain"]);
      if (dirty)
        return text(
          `コミットされていない変更があります。細かくコミットしてから、PR を作ってください。\n${dirty.slice(0, 500)}`,
        );

      const protection = await ensureProtection(ctx, root, { confirm: true });
      if (!protection.ok) return text(protection.message);

      const pushed = await git(root, ["push", "-u", "origin", branch], 120000);
      if (pushed.code !== 0)
        return text(`push に失敗しました: ${pushed.stderr.trim().slice(0, 500)}`);

      const commits = (await out(root, ["log", "--format=%s", `origin/${base}..HEAD`]))
        .split("\n")
        .filter(Boolean)
        .reverse();
      const diffStat = await out(root, ["diff", "--stat", `origin/${base}...HEAD`]);
      const verification = rt.plan?.verifications.at(-1);
      const body = buildPrBody({
        ...(params.summary ? { summary: params.summary } : {}),
        commits,
        diffStat,
        ...(verification ? { verification } : {}),
      });
      const existing = await gh(root, ["pr", "view", branch, "--json", "number,url"]);
      let number: number;
      let url: string;
      if (existing.code === 0) {
        const info = JSON.parse(existing.stdout) as { number: number; url: string };
        const edited = await gh(root, [
          "pr",
          "edit",
          String(info.number),
          "--title",
          params.title,
          "--body",
          body,
        ]);
        if (edited.code !== 0)
          return text(`PR を更新できませんでした: ${edited.stderr.trim().slice(0, 500)}`);
        number = info.number;
        url = info.url;
      } else {
        const created = await gh(root, [
          "pr",
          "create",
          "--base",
          base,
          "--head",
          branch,
          "--title",
          params.title,
          "--body",
          body,
        ]);
        if (created.code !== 0)
          return text(`PR を作れませんでした: ${created.stderr.trim().slice(0, 500)}`);
        url = created.stdout.trim().split("\n").at(-1) ?? "";
        number = Number(/\/pull\/(\d+)/.exec(url)?.[1] ?? 0);
      }
      if (rt.plan) {
        pi.appendEntry(
          "harness-plan",
          recordPr(rt.plan, { number, url, title: params.title, merged: false }),
        );
        rt.plan = recordPr(rt.plan, { number, url, title: params.title, merged: false });
      }
      rt.run.touched = true;
      return text(
        `PR を${existing.code === 0 ? "更新" : "作成"}しました: #${number} ${url}\nCI が通ったら、harness_pr_merge でマージします。`,
      );
    },
  });

  // ---- マージ ----
  async function waitForChecks(root: string, number: number, signal: AbortSignal | undefined) {
    const started = Date.now();
    for (;;) {
      const r = await gh(root, ["pr", "checks", String(number), "--json", "name,bucket"]);
      // チェックがまだ登録されていないとき、gh は非 0 で返すことがある(none として扱い、少し待つ)
      const state = r.stdout ? evaluateChecks(parseChecks(r.stdout)) : "none";
      if (state === "pass" || state === "fail") return state;
      if (Date.now() - started > CHECK_TIMEOUT_MS) return state;
      if (state === "none" && Date.now() - started > 60_000) return state;
      if (signal?.aborted) return "pending" as const;
      await new Promise((resolve) => setTimeout(resolve, CHECK_POLL_MS));
    }
  }

  pi.registerTool({
    name: "harness_pr_merge",
    label: "PR をマージ",
    description:
      "CI のチェックがすべて通り、検証済み(と、必要ならレビュー承認)であれば、ユーザーの確認なしでマージする。落ちたら、直してから CI を通し直す。CI が無い・未検証の変更は、自動でマージしない。",
    parameters: Type.Object({
      number: Type.Optional(
        Type.Number({ description: "PR の番号。省略すると、現在のブランチの PR" }),
      ),
    }),
    executionMode: "sequential",
    async execute(_id, params, signal, onUpdate, ctx) {
      const root = await repoRoot(ctx.cwd);
      if (!root) return text("git のリポジトリの外です。");
      let number = params.number;
      if (!number) {
        const branch = await out(root, ["branch", "--show-current"]);
        const r = await gh(root, ["pr", "view", branch, "--json", "number"]);
        number = r.code === 0 ? (JSON.parse(r.stdout) as { number: number }).number : undefined;
      }
      if (!number) return text("PR が見つかりません。先に harness_pr_create を実行してください。");
      onUpdate?.({
        content: [{ type: "text", text: `#${number} の CI を待っています…` }],
        details: undefined,
      });
      const checks = await waitForChecks(root, number, signal);
      const reasons = mergeBlockers({
        isSubagent: rt.isSubagent,
        plan: rt.plan,
        checks,
        fingerprint: await fingerprint(root),
      });
      if (reasons.length > 0)
        return text(`マージしません:\n${reasons.map((r) => `- ${r}`).join("\n")}`);
      const merged = await gh(
        root,
        ["pr", "merge", String(number), "--merge", "--delete-branch"],
        120000,
      );
      if (merged.code !== 0)
        return text(`マージできませんでした: ${merged.stderr.trim().slice(0, 500)}`);
      const view = await gh(root, ["pr", "view", String(number), "--json", "number,url,title"]);
      if (rt.plan && view.code === 0) {
        const info = JSON.parse(view.stdout) as { number: number; url: string; title: string };
        const plan = recordPr(rt.plan, {
          number: info.number,
          url: info.url,
          title: info.title,
          merged: true,
        });
        rt.plan = plan;
        pi.appendEntry("harness-plan", plan);
      }
      rt.run.touched = true;
      return text(`#${number} をマージしました。`);
    },
  });
}
