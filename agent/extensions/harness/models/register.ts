import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { Runtime } from "../lib/runtime.ts";
import { latestCustomEntry } from "../lib/state.ts";
import { groupModels, type ModelRef, parseRef, refToString, SUBAGENT_DEFAULT } from "./catalog.ts";

const SUBAGENT_MODEL_ENTRY = "harness-subagent-model";

function availableRefs(ctx: ExtensionContext): ModelRef[] {
  return ctx.modelRegistry.getAvailable().map((m) => ({ provider: m.provider, id: m.id }));
}

/** グループ → モデルの 2 段階で選ばせる。キャンセルなら null */
async function pickModel(ctx: ExtensionContext, title: string): Promise<ModelRef | null> {
  const refs = availableRefs(ctx);
  const isChatGptLogin = (m: ModelRef) => {
    const model = ctx.modelRegistry.find(m.provider, m.id);
    return model ? ctx.modelRegistry.isUsingOAuth(model) : false;
  };
  const groups = groupModels(refs, isChatGptLogin);
  if (groups.length === 0) {
    ctx.ui.notify(
      "使えるモデルがありません。`/login` か、API キーの設定を確認してください。",
      "warning",
    );
    return null;
  }
  const labels = groups.map((g) => `${g.label}(${g.models.length})`);
  const chosenGroup =
    groups.length === 1
      ? 0
      : labels.indexOf((await ctx.ui.select(`${title}: プロバイダ`, labels)) ?? "");
  if (chosenGroup < 0) return null;
  const group = groups[chosenGroup];
  if (!group) return null;
  const items = group.models.map(refToString);
  const picked = await ctx.ui.select(`${title}: ${group.label}`, items);
  return picked ? parseRef(picked) : null;
}

/**
 * `/models` と `/subagent-model`。
 * メインのモデルは固定せず、起動時と `/models` で選ぶ。サブエージェントの既定は DeepSeek V4.1 Flash。
 */
export function registerModels(pi: ExtensionAPI, rt: Runtime): void {
  async function setMain(ref: ModelRef, ctx: ExtensionContext): Promise<void> {
    const model = ctx.modelRegistry.find(ref.provider, ref.id);
    if (!model) {
      ctx.ui.notify(`${refToString(ref)} は見つかりません。`, "error");
      return;
    }
    const ok = await pi.setModel(model);
    ctx.ui.notify(
      ok ? `メインのモデル: ${refToString(ref)}` : `${refToString(ref)} の認証が未設定です。`,
      ok ? "info" : "error",
    );
  }

  pi.registerCommand("models", {
    description: "メインエージェントのモデルを選ぶ(OpenCode Go / Anthropic API / Codex)",
    handler: async (args: string, ctx: ExtensionCommandContext) => {
      const direct = args.trim() ? parseRef(args.trim()) : null;
      const ref = direct ?? (await pickModel(ctx, "メインのモデル"));
      if (ref) await setMain(ref, ctx);
    },
  });

  const restore = (ctx: ExtensionContext) => {
    const saved = latestCustomEntry<{ model?: string }>(
      ctx.sessionManager.getBranch(),
      SUBAGENT_MODEL_ENTRY,
    );
    rt.subagentModel = saved?.model && parseRef(saved.model) ? saved.model : SUBAGENT_DEFAULT;
  };

  pi.registerCommand("subagent-model", {
    description: `サブエージェントのモデルを切り替える(既定: ${SUBAGENT_DEFAULT}。reset で既定に戻す)`,
    handler: async (args: string, ctx: ExtensionCommandContext) => {
      const arg = args.trim();
      let next: string | null;
      if (arg === "reset") next = SUBAGENT_DEFAULT;
      else if (arg) next = parseRef(arg) ? arg : null;
      else {
        const ref = await pickModel(ctx, "サブエージェントのモデル");
        next = ref ? refToString(ref) : null;
      }
      if (!next) {
        ctx.ui.notify(`現在のサブエージェントのモデル: ${rt.subagentModel}`, "info");
        return;
      }
      rt.subagentModel = next;
      pi.appendEntry(SUBAGENT_MODEL_ENTRY, { model: next });
      ctx.ui.notify(`サブエージェントのモデル: ${next}`, "info");
    },
  });

  pi.on("session_start", async (event, ctx) => {
    restore(ctx);
    // 起動時に、メインのモデルを選ぶ(再開・リロード・フォークでは選び直さない)
    if (rt.isSubagent || !ctx.hasUI) return;
    if (event.reason !== "startup" && event.reason !== "new") return;
    if (!rt.config.selectModelOnStartup) return;
    const ref = await pickModel(ctx, "起動時: メインのモデルを選んでください(Esc で既定のまま)");
    if (ref) await setMain(ref, ctx);
  });
  pi.on("session_tree", async (_event, ctx) => restore(ctx));
}
