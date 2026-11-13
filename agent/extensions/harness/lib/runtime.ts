import { realpathSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { type HarnessConfig, loadConfig } from "./config.ts";
import type { FsProbe } from "./types.ts";

/** 1 回の依頼(ユーザーの入力から、応答が終わるまで)の間の状態 */
export class RunState {
  /** ファイルを変更した、または commit・PR など、成果物を作る操作をした */
  touched = false;
  /** 確定した計画があり、すべての項目が済んだ(完了報告を出した) */
  planCompleted = false;
  /** 計画の、未着手・進行中の項目の数(計画のモジュールが差し替える) */
  openItems: () => number = () => 0;

  resetForNewPrompt(): void {
    this.touched = false;
  }
}

/** ハーネス全体で共有する、実行時の事実 */
export interface Runtime {
  config: HarnessConfig;
  /** サブエージェント(子プロセス)として起動された */
  isSubagent: boolean;
  /** サブエージェントの役割(scout / planner / worker / reviewer など) */
  role: string | undefined;
  home: string;
  tmpdir: string;
  /** このハーネスが作った worktree の絶対パス */
  ownedWorktrees: Set<string>;
  run: RunState;
}

export function createRuntime(env: NodeJS.ProcessEnv = process.env): Runtime {
  const home = homedir();
  return {
    config: loadConfig(home),
    isSubagent: env.PI_SUBAGENT === "1",
    role: env.PI_SUBAGENT_ROLE || undefined,
    home,
    tmpdir: env.TMPDIR || tmpdir(),
    ownedWorktrees: new Set(),
    run: new RunState(),
  };
}

/** 存在する最も深い祖先の実パスを解決し、残りを連結する(未作成のパスでも、symlink を辿った先で判定できる) */
export const realFs: FsProbe = {
  resolve(p: string): string {
    const abs = path.resolve(p);
    const rest: string[] = [];
    let probe = abs;
    for (;;) {
      try {
        return path.join(realpathSync(probe), ...rest);
      } catch {
        const parent = path.dirname(probe);
        if (parent === probe) return abs;
        rest.unshift(path.basename(probe));
        probe = parent;
      }
    }
  },
};
