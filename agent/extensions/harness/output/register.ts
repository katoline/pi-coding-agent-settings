import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { Runtime } from "../lib/runtime.ts";
import { withFinalLine } from "./final-line.ts";

const ARTIFACT_TOOLS = new Set([
  "write",
  "edit",
  "harness_pr_create",
  "harness_pr_merge",
  "harness_worktree",
]);

/**
 * 作業が完了したら、最終応答の最後の 1 行を、必ず「🚀作業が完了しました!」にする。
 * 「完了」は、成果物を作る操作(ファイルの変更、commit、PR)があり、計画に未着手・進行中の項目が
 * 残っていないこと。モデルの書き忘れには頼らず、確定したメッセージを、ハーネスが書き換える。
 */
export function registerOutput(pi: ExtensionAPI, rt: Runtime): void {
  pi.on("input", async () => {
    rt.run.resetForNewPrompt();
    return undefined;
  });

  pi.on("tool_execution_end", async (event) => {
    if (event.isError) return;
    if (ARTIFACT_TOOLS.has(event.toolName)) {
      rt.run.touched = true;
      return;
    }
    if (event.toolName === "bash") {
      const command = String((event as { args?: { command?: unknown } }).args?.command ?? "");
      if (/\bgit\s+(-C\s+\S+\s+)?commit\b/.test(command)) rt.run.touched = true;
    }
  });

  pi.on("message_end", async (event) => {
    if (rt.isSubagent) return undefined;
    if (!(rt.run.touched || rt.run.planCompleted) || rt.run.openItems() > 0) return undefined;
    const replaced = withFinalLine(event.message as never);
    return replaced ? { message: replaced as never } : undefined;
  });
}
