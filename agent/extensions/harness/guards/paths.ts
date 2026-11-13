import path from "node:path";
import type { Word } from "../lib/shell.ts";
import { expandWord } from "../lib/shell.ts";
import type { GuardInput } from "../lib/types.ts";

/** `parent` の内側(parent 自身を除く)か */
export function isStrictlyInside(target: string, parent: string): boolean {
  const rel = path.relative(parent, target);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

export function isInsideOrEqual(target: string, parent: string): boolean {
  const rel = path.relative(parent, target);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/** パターンの各セグメントを正規表現にして、絶対パスの先頭の同じ数のセグメントと照合する */
function matchesPatternRoot(abs: string, pattern: string): boolean {
  const patSegs = pattern.split("/").filter(Boolean);
  const absSegs = abs.split("/").filter(Boolean);
  if (absSegs.length <= patSegs.length) return false; // 内側のみ
  return patSegs.every((seg, i) => {
    const re = new RegExp(`^${seg.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*")}$`);
    return re.test(absSegs[i] as string);
  });
}

/** 削除・書き込みを許す場所の内側か(作業ルートと一時領域。ルート自身は含まない) */
export function isInsideAllowedRoot(abs: string, input: GuardInput): boolean {
  const resolved = input.fs.resolve(abs);
  for (const root of input.config.workRoots) {
    if (isStrictlyInside(resolved, input.fs.resolve(root))) return true;
  }
  for (const pattern of input.config.tempRoots) {
    if (pattern === "$TMPDIR") {
      if (isStrictlyInside(resolved, input.fs.resolve(input.env.tmpdir))) return true;
    } else if (matchesPatternRoot(resolved, pattern)) {
      return true;
    }
  }
  return false;
}

/** 語を、cwd 基準の絶対パスにする。変数などで決まらない語は null。glob は、glob を含むセグメントの手前まで */
export function wordToAbsolute(
  word: Word,
  input: GuardInput,
): { abs: string; glob: boolean } | null {
  const expanded = expandWord(word, { home: input.env.home, tmpdir: input.env.tmpdir });
  if (expanded === null) return null;
  let value = expanded;
  let glob = false;
  if (word.glob) {
    const segs = value.split("/");
    const keep: string[] = [];
    for (const seg of segs) {
      if (/[*?[{]/.test(seg)) {
        glob = true;
        break;
      }
      keep.push(seg);
    }
    value = keep.join("/") || ".";
  }
  const abs = path.isAbsolute(value) ? path.normalize(value) : path.resolve(input.env.cwd, value);
  return { abs, glob };
}
