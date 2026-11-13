import { uuidv7 } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { convertToLlm, serializeConversation } from "@earendil-works/pi-coding-agent";
import type { Runtime } from "../lib/runtime.ts";
import { parseRef } from "../models/catalog.ts";
import { buildStateBlock, buildSummaryPrompt } from "./prompt.ts";

/**
 * 要約(compact)のときに、必ず残す項目を指定する。
 * 要約は、日本語で、5 項目(変更ファイルと検証、検証の結果、PR、サブエージェントの状態、決定事項)を
 * 明示して作らせ、そのうえで、ハーネスが持つ確定した状態(計画・検証・レビュー・PR)を、
 * そのまま付け足す。要約のモデルや認証が使えないときは、Pi の標準の要約に任せる。
 */
export function registerCompaction(pi: ExtensionAPI, rt: Runtime): void {
  if (rt.isSubagent) return;
  pi.on("session_before_compact", async (event, ctx) => {
    const { preparation, signal } = event;
    const configured = rt.config.compactionModel ? parseRef(rt.config.compactionModel) : null;
    const model =
      (configured && ctx.modelRegistry.find(configured.provider, configured.id)) || ctx.model;
    if (!model) return undefined;
    const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
    if (!auth.ok) return undefined;

    const messages = [...preparation.messagesToSummarize, ...preparation.turnPrefixMessages];
    const prompt = buildSummaryPrompt(
      serializeConversation(convertToLlm(messages)),
      preparation.previousSummary,
    );
    try {
      const response = await ctx.modelRegistry.complete(
        model,
        {
          messages: [
            {
              role: "user" as const,
              content: [{ type: "text" as const, text: prompt }],
              timestamp: Date.now(),
            },
          ],
        },
        { maxTokens: 8192, signal, cacheRetention: "none", sessionId: uuidv7() },
      );
      const summary = response.content
        .filter((c): c is { type: "text"; text: string } => c.type === "text")
        .map((c) => c.text)
        .join("\n")
        .trim();
      if (!summary) return undefined;
      const state = buildStateBlock({
        plan: rt.plan,
        subagentModel: rt.subagentModel,
        subagentSpawns: rt.subagentSpawns,
        childCost: rt.childCost,
      });
      return {
        compaction: {
          summary: `${summary}\n\n${state}`,
          firstKeptEntryId: preparation.firstKeptEntryId,
          tokensBefore: preparation.tokensBefore,
          usage: response.usage,
        },
      };
    } catch (error) {
      if (!signal.aborted) {
        ctx.ui.notify(
          `要約に失敗したため、標準の要約を使います: ${error instanceof Error ? error.message : String(error)}`,
          "warning",
        );
      }
      return undefined;
    }
  });
}
