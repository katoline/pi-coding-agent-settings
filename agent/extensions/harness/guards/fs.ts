import type { Invocation, Word } from "../lib/shell.ts";
import type { GuardInput } from "../lib/types.ts";
import { ALLOW, block, combine, type Verdict } from "../lib/verdict.ts";
import { isInsideAllowedRoot, wordToAbsolute } from "./paths.ts";

const DELETERS = new Set(["rm", "rmdir", "unlink", "shred", "trash", "trash-put", "gio-trash"]);

const roots = (input: GuardInput) =>
  [...input.config.workRoots, ...input.config.tempRoots].join("、");

function nonOptions(words: Word[]): Word[] {
  const out: Word[] = [];
  let endOfOptions = false;
  for (const w of words) {
    if (!endOfOptions && w.value === "--") {
      endOfOptions = true;
      continue;
    }
    if (!endOfOptions && w.value.startsWith("-") && w.value.length > 1) continue;
    out.push(w);
  }
  return out;
}

function checkTargets(targets: Word[], inv: Invocation, input: GuardInput, label: string): Verdict {
  if (inv.viaXargs) {
    return block(
      `xargs 経由の${label}は、対象が実行時に決まるため禁止です。具体的なパスを指定してください。`,
    );
  }
  if (inv.afterCd) {
    return block(
      `\`cd\` と組み合わせた${label}は禁止です。cd せずに、具体的なパス(絶対パス、または cwd からの相対パス)を指定してください。`,
    );
  }
  for (const word of targets) {
    const target = wordToAbsolute(word, input);
    if (!target) {
      return block(
        `変数やコマンド置換で組み立てたパス(${word.value})の${label}は禁止です。具体的なパスを書いてください。`,
      );
    }
    if (!isInsideAllowedRoot(target.abs, input)) {
      return block(
        `${target.abs} は、${label}を許可された場所の外です。許可されているのは、作業ルートと一時領域の内側だけです(${roots(input)})。`,
      );
    }
  }
  return ALLOW;
}

export function checkDelete(inv: Invocation, input: GuardInput): Verdict {
  const args = inv.args;
  if (DELETERS.has(inv.name)) {
    if (args.some((w) => w.value === "--no-preserve-root")) {
      return block("`--no-preserve-root` は禁止です。");
    }
    return checkTargets(nonOptions(args), inv, input, "削除");
  }
  if (inv.name === "find") {
    const values = args.map((w) => w.value);
    const execIdx = values.findIndex(
      (v) => v === "-exec" || v === "-execdir" || v === "-ok" || v === "-okdir",
    );
    const execTarget = execIdx >= 0 ? values[execIdx + 1] : undefined;
    const deleting =
      values.includes("-delete") ||
      (execTarget !== undefined && DELETERS.has(execTarget.split("/").pop() ?? ""));
    if (!deleting) return ALLOW;
    const starts: Word[] = [];
    for (const w of args) {
      if (w.value.startsWith("-") || w.value === "(" || w.value === "!") break;
      starts.push(w);
    }
    if (starts.length === 0) starts.push({ value: ".", dynamic: false, glob: false });
    return checkTargets(starts, inv, input, "find による削除");
  }
  if (
    inv.name === "rsync" &&
    args.some((w) => w.value.startsWith("--delete") || w.value === "--remove-source-files")
  ) {
    return block("`rsync --delete` は、同期先のファイルを削除します。禁止です。");
  }
  return ALLOW;
}

const KILL_PATTERNS = [/^\$\(\s*lsof\s+-ti\s*:\d{1,5}\s*\)$/, /^`\s*lsof\s+-ti\s*:\d{1,5}\s*`$/];

export function checkProcess(inv: Invocation): Verdict {
  const stop =
    "プロセスの停止は、`kill $(lsof -ti :<ポート>)` か、PID を指定した `kill <PID>` だけにしてください。";
  if (
    inv.name === "pkill" ||
    inv.name === "killall" ||
    inv.name === "killall5" ||
    inv.name === "skill"
  ) {
    return block(`\`${inv.name}\` は、無関係なプロセスまで停止しうるため禁止です。${stop}`);
  }
  if (inv.name === "fuser" && inv.args.some((w) => /^-[a-zA-Z]*k/.test(w.value))) {
    return block(`\`fuser -k\` は禁止です。${stop}`);
  }
  if (inv.name !== "kill") return ALLOW;
  if (inv.viaXargs) return block(`xargs 経由の kill は禁止です。${stop}`);
  const args = inv.args;
  // シグナルの指定は、先頭の 1 つだけ読み飛ばす(-9、-KILL、-s KILL、-n 9)。
  // 2 つ目以降の `-1` などは、プロセスグループの指定(全プロセスの停止)なので対象として検査する
  let i = 0;
  const first = (args[0] as Word | undefined)?.value ?? "";
  if (first === "-s" || first === "-n") i = 2;
  else if (/^-([0-9]{1,2}|[A-Za-z]{2,10})$/.test(first)) i = 1;
  const targets = args.slice(i);
  if (targets.length === 0) return ALLOW;
  for (const t of targets) {
    if (t.dynamic) {
      if (!KILL_PATTERNS.some((re) => re.test(t.value))) {
        return block(`kill の対象を、ほかの変数やコマンド置換で組み立てないでください。${stop}`);
      }
      continue;
    }
    if (!/^[0-9]+$/.test(t.value) || Number(t.value) <= 1) {
      return block(`kill の対象は、PID(2 以上の数字)だけにしてください。${stop}`);
    }
  }
  return ALLOW;
}

export function checkFs(inv: Invocation, input: GuardInput): Verdict {
  return combine([checkDelete(inv, input), checkProcess(inv)]);
}
