import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface HarnessConfig {
  /** 削除・書き込みを許す作業ルート */
  workRoots: string[];
  /** 一時領域(`$TMPDIR` と glob を含むパターン) */
  tempRoots: string[];
  /** 開発中に変更させないグローバル環境(cwd がその中にあるときだけ許す) */
  protectedGlobalPaths: string[];
  /** ハーネス自身と認証情報(cwd がこの設定リポジトリの中にあるときだけ、設定の編集を許す) */
  protectedHarnessPaths: string[];
  /** 既定ブランチとして扱うブランチ名(origin/HEAD の指す先も加える) */
  defaultBranches: string[];
  /** プロジェクトの AGENTS.md / CLAUDE.md を、モデルに読ませない */
  dropContextFiles: boolean;
}

const here = path.dirname(fileURLToPath(import.meta.url));

function expandHome(p: string, home: string): string {
  if (p === "~") return home;
  if (p.startsWith("~/")) return path.join(home, p.slice(2));
  return p;
}

/** 既定の設定に、`~/.pi/agent/harness.json` の上書きを重ねる。壊れた上書きは無視して既定を使う */
export function loadConfig(home: string = homedir(), overridePath?: string): HarnessConfig {
  const defaults = JSON.parse(readFileSync(path.join(here, "..", "config.default.json"), "utf8"));
  let merged: HarnessConfig = defaults;
  const file = overridePath ?? path.join(home, ".pi", "agent", "harness.json");
  if (existsSync(file)) {
    try {
      const override = JSON.parse(readFileSync(file, "utf8"));
      merged = { ...defaults, ...override };
    } catch {
      // 壊れた上書きは使わない
    }
  }
  return {
    ...merged,
    workRoots: merged.workRoots.map((p) => expandHome(p, home)),
    protectedGlobalPaths: merged.protectedGlobalPaths.map((p) => expandHome(p, home)),
    protectedHarnessPaths: merged.protectedHarnessPaths.map((p) => expandHome(p, home)),
  };
}
