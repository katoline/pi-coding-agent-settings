import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Runtime } from "../lib/runtime.ts";
import {
  formatCost,
  formatMeters,
  type Meter,
  parseCodexUsage,
  parseGoUsage,
  sessionCost,
} from "./parse.ts";

const GO_URL = "https://opencode.ai/zen/go/v1/usage";
const CODEX_URL = "https://chatgpt.com/backend-api/wham/usage";
const REFRESH_MS = 5 * 60_000;
const TIMEOUT_MS = 8000;

async function getJson(url: string, headers: Record<string, string>): Promise<unknown> {
  const response = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": "pi-harness-usage", ...headers },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    redirect: "manual",
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

/** JWT の `https://api.openai.com/auth` クレームから、ChatGPT のアカウント ID を取り出す */
function chatgptAccountId(token: string): string | undefined {
  try {
    const payload = JSON.parse(
      Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8"),
    ) as Record<string, unknown>;
    const auth = payload["https://api.openai.com/auth"] as
      | { chatgpt_account_id?: string }
      | undefined;
    return auth?.chatgpt_account_id;
  } catch {
    return undefined;
  }
}

/**
 * 利用状況の表示(フッターのステータス)。
 * - Anthropic API: セッションで使った額(メイン + サブエージェント)。残高を取得する公式 API はない
 * - OpenCode Go: 5 時間・週・月の使用率(非公式の usage エンドポイント)
 * - Codex: 5 時間・週の使用率(非公式の wham/usage。従来の `/login openai-codex` のトークンが必要)
 * 取得に失敗しても、表示が「取得できません」になるだけで、作業は止めない。
 */
export function registerUsage(pi: ExtensionAPI, rt: Runtime): void {
  if (rt.isSubagent) return;
  let lastFetch = 0;
  let cached: { go?: Meter[]; codex?: Meter[]; codexHint?: string } = {};

  function cost(ctx: ExtensionContext): string {
    return formatCost({
      main: sessionCost(ctx.sessionManager.getBranch()),
      children: rt.childCost,
    });
  }

  async function refresh(ctx: ExtensionContext, force = false) {
    const now = Date.now();
    if (!force && now - lastFetch < REFRESH_MS) return;
    lastFetch = now;
    const providers = new Set(ctx.modelRegistry.getAvailable().map((m) => m.provider));
    const next: typeof cached = {};
    if (providers.has("opencode-go")) {
      try {
        const model = ctx.modelRegistry.getAvailable().find((m) => m.provider === "opencode-go");
        const auth = model ? await ctx.modelRegistry.getApiKeyAndHeaders(model) : undefined;
        if (auth?.ok && auth.apiKey)
          next.go = parseGoUsage(await getJson(GO_URL, { Authorization: `Bearer ${auth.apiKey}` }));
      } catch {
        next.go = [];
      }
    }
    const codexModel = ctx.modelRegistry.getAvailable().find((m) => m.provider === "openai-codex");
    if (codexModel) {
      try {
        const auth = await ctx.modelRegistry.getApiKeyAndHeaders(codexModel);
        const token = auth.ok ? (auth.apiKey ?? "") : "";
        const accountId =
          (auth.ok ? (auth.headers?.["ChatGPT-Account-Id"] as string | undefined) : undefined) ??
          chatgptAccountId(token);
        if (token) {
          next.codex = parseCodexUsage(
            await getJson(CODEX_URL, {
              Authorization: `Bearer ${token}`,
              ...(accountId ? { "ChatGPT-Account-Id": accountId } : {}),
            }),
            Date.now(),
          );
        }
      } catch {
        next.codex = [];
      }
    } else if (providers.has("openai")) {
      next.codexHint = "Codex の使用率は、従来のログイン(/login openai-codex)が必要です";
    }
    cached = next;
  }

  function line(ctx: ExtensionContext): string | undefined {
    const provider = ctx.model?.provider;
    const now = Date.now();
    if (provider === "anthropic") return `Anthropic API: ${cost(ctx)}`;
    if (provider === "opencode-go")
      return cached.go ? formatMeters("Go", cached.go, now) : undefined;
    if (provider === "openai-codex")
      return cached.codex ? formatMeters("Codex", cached.codex, now) : undefined;
    if (provider === "openai") return cached.codexHint;
    return undefined;
  }

  async function update(ctx: ExtensionContext, force = false) {
    await refresh(ctx, force).catch(() => {});
    ctx.ui.setStatus("harness-usage", line(ctx));
  }

  pi.on("session_start", async (_e, ctx) => update(ctx, true));
  pi.on("model_select", async (_e, ctx) => update(ctx));
  pi.on("agent_end", async (_e, ctx) => update(ctx));

  pi.registerCommand("usage", {
    description: "利用状況を表示する(Anthropic API の使用額、Go・Codex の使用率)",
    handler: async (_args, ctx) => {
      await refresh(ctx, true).catch(() => {});
      const now = Date.now();
      const lines = [
        `Anthropic API: ${cost(ctx)}(残高を取得する公式 API はないため、使用額を表示します)`,
      ];
      lines.push(cached.go ? formatMeters("OpenCode Go", cached.go, now) : "OpenCode Go: 未接続");
      lines.push(
        cached.codex
          ? formatMeters("Codex", cached.codex, now)
          : (cached.codexHint ?? "Codex: 未接続"),
      );
      ctx.ui.notify(lines.join("\n"), "info");
      ctx.ui.setStatus("harness-usage", line(ctx));
    },
  });
}
