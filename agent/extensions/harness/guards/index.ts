import path from "node:path";
import { invocations, parseShell } from "../lib/shell.ts";
import type { GuardInput } from "../lib/types.ts";
import { ALLOW, block, combine, type Verdict } from "../lib/verdict.ts";
import { checkFs } from "./fs.ts";
import { checkGh, checkGit } from "./git.ts";
import {
  checkInstall,
  checkInstallAll,
  checkProtectedBash,
  checkProtectedWrite,
} from "./install.ts";
import { isInsideOrEqual, isStrictlyInside } from "./paths.ts";
import { checkEnvDump, checkSecretsBash, checkSecretToolPath } from "./secrets.ts";

/** bash ツールのコマンドを、すべてのガードで検査する */
export function evaluateBash(command: string, input: GuardInput): Verdict {
  const parsed = parseShell(command);
  if (!parsed.ok) {
    return block(
      "コマンドの構文を解析できませんでした(クォートの閉じ忘れなど)。安全のため実行しません。単純なコマンドに分けて、書き直してください。",
    );
  }
  if (parsed.opaque) {
    return block(
      "`eval` や、変数で組み立てた `sh -c` は、中身を判定できないため禁止です。実行したいコマンドを直接書いてください。",
    );
  }
  const invs = invocations(parsed);
  const verdicts: Verdict[] = [checkEnvDump(parsed), checkInstallAll(parsed, invs)];
  for (const inv of invs) {
    if (inv.name === "git") verdicts.push(checkGit(inv, input));
    else if (inv.name === "gh") verdicts.push(checkGh(inv, input));
    verdicts.push(
      checkFs(inv, input),
      checkInstall(inv),
      checkSecretsBash(inv, input),
      checkProtectedBash(inv, input),
    );
  }
  return combine(verdicts);
}

const WRITE_TOOLS = new Set(["write", "edit"]);
const PATH_TOOLS = new Set(["read", "write", "edit", "grep", "find", "ls"]);

function toolPath(toolInput: Record<string, unknown>): string | null {
  const p = toolInput.path ?? toolInput.file_path ?? toolInput.filePath;
  return typeof p === "string" ? p : null;
}

/** read / write / edit / grep / find / ls ツールを検査する。対象外のツールは許可 */
export function evaluateFileTool(
  toolName: string,
  toolInput: Record<string, unknown>,
  input: GuardInput,
): Verdict {
  if (!PATH_TOOLS.has(toolName)) return ALLOW;
  const rawPath = toolPath(toolInput);
  if (rawPath === null) return ALLOW;

  const verdicts: Verdict[] = [checkSecretToolPath(rawPath, input)];
  if (WRITE_TOOLS.has(toolName)) {
    const abs = path.isAbsolute(rawPath)
      ? path.normalize(rawPath)
      : path.resolve(input.env.cwd, rawPath.replace(/^~(?=\/|$)/, input.env.home));
    const resolved = input.fs.resolve(abs);
    verdicts.push(checkProtectedWrite(abs, input));

    const root = input.git.repoRoot ? input.fs.resolve(input.git.repoRoot) : null;
    if (root && isInsideOrEqual(resolved, root)) {
      if (isStrictlyInside(resolved, path.join(root, ".git"))) {
        verdicts.push(
          block("`.git` の中(フック、設定、オブジェクト)は、ファイルツールで変更できません。"),
        );
      }
      const branch = input.git.currentBranch;
      if (input.git.inRepo && branch && input.git.defaultBranches.has(branch)) {
        verdicts.push(
          block(
            `既定ブランチ(${branch})上では、ファイルを変更できません。先に作業ブランチを作成してください: git switch -c <ブランチ名>`,
          ),
        );
      }
    }
  }
  return combine(verdicts);
}
