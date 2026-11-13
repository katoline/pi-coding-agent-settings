import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { probeGitState } from "../lib/git-state.ts";
import { type Runtime, realFs } from "../lib/runtime.ts";
import type { GitState, GuardInput } from "../lib/types.ts";
import type { Verdict } from "../lib/verdict.ts";
import { evaluateBash, evaluateFileTool } from "./index.ts";
import { redact } from "./secrets.ts";

const GIT_CACHE_MS = 1500;

/**
 * ガードを Pi のフックに接続する。
 *
 * - `tool_call` は、1 本の **fail-closed** のラッパーで包む。Pi は、フックが例外を投げると、
 *   ゲートを通さずにツールを実行してしまうため、例外は必ず block に変換する。
 * - 許可制(ask)は、UI があれば確認し、UI がなければ(サブエージェントなど)拒否する。
 */
export function registerGuards(pi: ExtensionAPI, rt: Runtime): void {
  const cache = new Map<string, { at: number; needMerged: boolean; state: GitState }>();

  async function gitState(cwd: string, needMerged: boolean): Promise<GitState> {
    const hit = cache.get(cwd);
    if (hit && Date.now() - hit.at < GIT_CACHE_MS && (hit.needMerged || !needMerged))
      return hit.state;
    const state = await probeGitState(
      async (args) => {
        const r = await pi.exec("git", args, { cwd, timeout: 5000 });
        return { code: r.code, stdout: r.stdout };
      },
      rt.config,
      { needMerged, ownedWorktrees: rt.ownedWorktrees },
    );
    cache.set(cwd, { at: Date.now(), needMerged, state });
    return state;
  }

  async function guardInput(cwd: string, needMerged: boolean): Promise<GuardInput> {
    return {
      env: { isSubagent: rt.isSubagent, cwd, home: rt.home, tmpdir: rt.tmpdir },
      config: rt.config,
      git: await gitState(cwd, needMerged),
      fs: realFs,
    };
  }

  async function decide(verdict: Verdict, ctx: ExtensionContext, subject: string) {
    if (verdict.kind === "allow") return undefined;
    if (verdict.kind === "block") return { block: true, reason: verdict.reason };
    // ask
    if (ctx.hasUI) {
      const ok = await ctx.ui.confirm(
        "許可が必要な操作",
        `${verdict.reason}\n\n${subject}\n\n実行を許可しますか?`,
      );
      if (ok) return undefined;
      return { block: true, reason: `ユーザーが許可しませんでした。${verdict.reason}` };
    }
    return {
      block: true,
      reason: `${verdict.reason}\n(対話の画面がないため、許可を得られず、実行しませんでした。ユーザーに依頼してください。)`,
    };
  }

  pi.on("tool_call", async (event, ctx) => {
    try {
      const toolInput = event.input as Record<string, unknown>;
      if (event.toolName === "bash") {
        const command = String(toolInput.command ?? "");
        const input = await guardInput(ctx.cwd, /\bpush\b/.test(command));
        return await decide(evaluateBash(command, input), ctx, command);
      }
      const input = await guardInput(ctx.cwd, false);
      return await decide(
        evaluateFileTool(event.toolName, toolInput, input),
        ctx,
        `${event.toolName}: ${String(toolInput.path ?? "")}`,
      );
    } catch (error) {
      // fail-closed: ガードの内部エラーでは、実行させない
      const message = error instanceof Error ? error.message : String(error);
      return {
        block: true,
        reason: `ハーネスのガードで内部エラーが起きたため、安全のため実行を止めました(${message})。`,
      };
    }
  });

  // モデルの入力側でも、秘密を断つ
  pi.on("tool_result", async (event) => {
    let changed = false;
    const content = event.content.map((item) => {
      if (item.type !== "text") return item;
      const text = redact(item.text);
      if (text !== item.text) changed = true;
      return { ...item, text };
    });
    if (!changed) return undefined;
    return {
      content,
      ...(event.structuredContent === undefined
        ? {}
        : { structuredContent: JSON.parse(redact(JSON.stringify(event.structuredContent))) }),
    };
  });
}
