/** プロジェクトの検証コマンド(lint・型チェック・テスト・ビルド)の検出と、出力の要約 */

export interface ProjectFiles {
  read(file: string): string | null;
  exists(file: string): boolean;
}

type PackageManager = "npm" | "pnpm" | "yarn" | "bun";

export function detectPackageManager(files: ProjectFiles): PackageManager {
  if (files.exists("pnpm-lock.yaml")) return "pnpm";
  if (files.exists("yarn.lock")) return "yarn";
  if (files.exists("bun.lock") || files.exists("bun.lockb")) return "bun";
  return "npm";
}

const SCRIPT_ORDER = ["lint", "typecheck", "type-check", "test", "build"];

function runScript(pm: PackageManager, script: string): string {
  if (pm === "npm" && script === "test") return "npm test";
  return `${pm} run ${script}`;
}

/**
 * 検証コマンドを決める。優先順位:
 * 1. `.harness/verify.json`(`{ "commands": ["npm run check"] }`)。明示された設定
 * 2. package.json の `check` スクリプト
 * 3. package.json の lint・typecheck・test・build(あるものだけ、この順)
 * 見つからなければ空(「未検証」として報告する)。
 */
export function detectVerifyCommands(files: ProjectFiles): string[] {
  const explicit = files.read(".harness/verify.json");
  if (explicit !== null) {
    try {
      const parsed = JSON.parse(explicit) as { commands?: unknown };
      if (Array.isArray(parsed.commands)) {
        return parsed.commands.filter((c): c is string => typeof c === "string" && c.trim() !== "");
      }
    } catch {
      // 壊れた設定は、見つからなかったものとして扱う
    }
    return [];
  }
  const pkgText = files.read("package.json");
  if (pkgText === null) return [];
  let scripts: Record<string, unknown> = {};
  try {
    scripts = (JSON.parse(pkgText) as { scripts?: Record<string, unknown> }).scripts ?? {};
  } catch {
    return [];
  }
  const pm = detectPackageManager(files);
  if (typeof scripts.check === "string") return [runScript(pm, "check")];
  return SCRIPT_ORDER.filter((s) => typeof scripts[s] === "string").map((s) => runScript(pm, s));
}

/** 出力の末尾(失敗の理由は、たいてい末尾にある)を、短く */
export function summarizeOutput(text: string, max = 600): string {
  const t = text.trim();
  if (t.length <= max) return t;
  return `…${t.slice(-max)}`;
}
