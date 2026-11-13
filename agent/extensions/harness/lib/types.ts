/** ガードの入力。実行環境の事実は、呼び出し側(index.ts)が集めて渡す。 */
export interface GuardEnv {
  /** サブエージェント(子プロセス)として起動されている */
  isSubagent: boolean;
  cwd: string;
  home: string;
  tmpdir: string;
}

export interface GitState {
  /** cwd のリポジトリ。リポジトリの外なら false */
  inRepo: boolean;
  /** リポジトリのルート(`git rev-parse --show-toplevel`) */
  repoRoot: string | null;
  currentBranch: string | null;
  /** 既定ブランチ(main / master と、origin/HEAD の指す先) */
  defaultBranches: ReadonlySet<string>;
  /** 既定ブランチにマージ済みのリモートブランチ名(origin/ を除く) */
  mergedRemoteBranches: ReadonlySet<string>;
  /** このハーネスが作った worktree の絶対パス */
  ownedWorktrees: ReadonlySet<string>;
}

export interface FsProbe {
  /** 存在する最も深い祖先の実パスを解決し、残りを連結して返す(symlink の回避を防ぐ) */
  resolve(path: string): string;
}

export interface GuardInput {
  env: GuardEnv;
  config: import("./config.ts").HarnessConfig;
  git: GitState;
  fs: FsProbe;
}
