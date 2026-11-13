import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const cache = new Map<string, string>();

export type InstructionKind = "main" | "subagent";

/** 固定の指示の本文(Markdown)。ファイルは、編集しやすいよう、コードと分けている */
export function loadInstructions(kind: InstructionKind): string {
  const cached = cache.get(kind);
  if (cached !== undefined) return cached;
  const text = readFileSync(path.join(here, `${kind}.md`), "utf8").trim();
  cache.set(kind, text);
  return text;
}

/** サブエージェントの役割ごとの指示を、固定の指示に足す */
export function composeInstructions(kind: InstructionKind, roleInstructions?: string): string {
  const base = loadInstructions(kind);
  return roleInstructions?.trim() ? `${base}\n\n# 役割の指示\n\n${roleInstructions.trim()}` : base;
}
