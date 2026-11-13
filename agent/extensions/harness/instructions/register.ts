import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { Runtime } from "../lib/runtime.ts";
import { composeInstructions } from "./load.ts";

/**
 * 固定の指示を、AGENTS.md ではなく、ハーネスの中から渡す。
 * システムプロンプトの名前つきセクション(`<harness>`)に書く。全体を置換しないので、他の拡張や
 * Pi のプロンプトと共存でき、変わった部分だけがモデルに差分として渡る。
 */
export function registerInstructions(pi: ExtensionAPI, rt: Runtime): void {
  pi.on("before_agent_start", async (event) => {
    const options = event.systemPromptOptions;
    const text = composeInstructions(rt.isSubagent ? "subagent" : "main");
    options.sections = { ...(options.sections ?? {}), harness: text };
    // 任意: プロジェクトの AGENTS.md / CLAUDE.md を読ませない(設定 dropContextFiles)
    if (rt.config.dropContextFiles && Array.isArray(options.contextFiles)) {
      options.contextFiles.length = 0;
    }
    return undefined;
  });
}
