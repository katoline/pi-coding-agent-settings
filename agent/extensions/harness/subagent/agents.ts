import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

export interface AgentDef {
  name: string;
  description: string;
  /** 許可する組み込みツール。未指定なら、既定のツール(サブエージェント自身の呼び出しは除く) */
  tools?: string[];
  /** 未指定なら、`/subagent-model` で選んだモデル(既定: OpenCode Go の DeepSeek V4.1 Flash) */
  model?: string;
  /** 役割の指示(本文) */
  instructions: string;
}

/** 先頭の `---` で囲んだ `key: value` の行と、本文を分ける(入れ子や配列は使わない) */
export function parseAgentFile(text: string): { meta: Record<string, string>; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!m) return { meta: {}, body: text };
  const meta: Record<string, string> = {};
  for (const line of (m[1] as string).split(/\r?\n/)) {
    const kv = /^([A-Za-z_-]+):\s*(.*)$/.exec(line);
    if (kv) meta[kv[1] as string] = (kv[2] as string).trim();
  }
  return { meta, body: (m[2] as string).trim() };
}

export function loadAgents(dir: string): AgentDef[] {
  if (!existsSync(dir)) return [];
  const agents: AgentDef[] = [];
  for (const file of readdirSync(dir).sort()) {
    if (!file.endsWith(".md")) continue;
    const { meta, body } = parseAgentFile(readFileSync(path.join(dir, file), "utf8"));
    if (!meta.name || !meta.description) continue;
    const tools = meta.tools
      ?.split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    agents.push({
      name: meta.name,
      description: meta.description,
      ...(tools && tools.length > 0 ? { tools } : {}),
      ...(meta.model ? { model: meta.model } : {}),
      instructions: body,
    });
  }
  return agents;
}
