import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

export interface FingerprintDeps {
  /** 追跡しているファイルと、無視されていない未追跡のファイル(相対パス) */
  listFiles(): Promise<string[]>;
  /** 内容。存在しなければ null(削除された) */
  read(file: string): Buffer | null;
}

/**
 * 作業ツリーの指紋。コミットの有無によらず、ファイルの内容だけで決まる。
 * 「最後の検証・レビューのあとに、変更があったか」を、モデルの申告ではなく、状態で確かめる。
 */
export async function workingTreeFingerprint(deps: FingerprintDeps): Promise<string> {
  const files = [...(await deps.listFiles())].sort();
  const hash = createHash("sha256");
  for (const file of files) {
    const content = deps.read(file);
    if (content === null) continue;
    hash.update(file);
    hash.update("\0");
    hash.update(createHash("sha256").update(content).digest());
  }
  return hash.digest("hex");
}

export function fsReader(root: string): FingerprintDeps["read"] {
  return (file) => {
    try {
      return readFileSync(path.join(root, file));
    } catch {
      return null;
    }
  };
}

/** `git ls-files -z` の出力を、パスの一覧にする */
export function parseNul(out: string): string[] {
  return out.split("\0").filter(Boolean);
}
