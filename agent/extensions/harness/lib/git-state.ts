import type { HarnessConfig } from "./config.ts";
import type { GitState } from "./types.ts";

export interface GitExecResult {
  code: number;
  stdout: string;
}
/** git を実行する関数(テストでは偽物を渡す) */
export type GitExec = (args: string[]) => Promise<GitExecResult>;

const trim = (r: GitExecResult) => (r.code === 0 ? r.stdout.trim() : "");

/**
 * cwd の git の状態を調べる。既定ブランチは、設定の名前(main / master)に、
 * `origin/HEAD` の指す先を加える。マージ済みのリモートブランチは、push の削除を判定するときだけ調べる。
 */
export async function probeGitState(
  exec: GitExec,
  config: HarnessConfig,
  options: { needMerged: boolean; ownedWorktrees: ReadonlySet<string> },
): Promise<GitState> {
  const repoRoot = trim(await exec(["rev-parse", "--show-toplevel"])) || null;
  const defaults = new Set(config.defaultBranches);
  if (!repoRoot) {
    return {
      inRepo: false,
      repoRoot: null,
      currentBranch: null,
      defaultBranches: defaults,
      mergedRemoteBranches: new Set(),
      ownedWorktrees: options.ownedWorktrees,
    };
  }
  const branch = trim(await exec(["branch", "--show-current"])) || null;
  const originHead = trim(await exec(["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]));
  if (originHead.startsWith("origin/")) defaults.add(originHead.slice("origin/".length));

  const merged = new Set<string>();
  if (options.needMerged) {
    for (const base of defaults) {
      const out = trim(await exec(["branch", "-r", "--merged", `origin/${base}`]));
      for (const line of out.split("\n")) {
        const name = line.trim().replace(/^origin\//, "");
        if (name && !name.includes("->") && !defaults.has(name)) merged.add(name);
      }
    }
  }
  return {
    inRepo: true,
    repoRoot,
    currentBranch: branch,
    defaultBranches: defaults,
    mergedRemoteBranches: merged,
    ownedWorktrees: options.ownedWorktrees,
  };
}
