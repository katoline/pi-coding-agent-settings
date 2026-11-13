export interface ModelRef {
  provider: string;
  id: string;
}

export interface ModelGroup {
  key: "opencode-go" | "anthropic" | "codex";
  label: string;
  models: ModelRef[];
}

/** サブエージェントの既定: OpenCode Go の DeepSeek V4.1 Flash */
export const SUBAGENT_DEFAULT = "opencode-go/deepseek-v4.1-flash";

/** Anthropic API で、`/models` に出すモデル(Opus 5.5 / Sonnet 5.5 / Fable 5.2 / Haiku 5.5) */
export const ANTHROPIC_MODEL_IDS = [
  "claude-opus-5-5",
  "claude-sonnet-5-5",
  "claude-fable-5-2",
  "claude-haiku-5-5",
] as const;

export const refToString = (m: ModelRef): string => `${m.provider}/${m.id}`;

export function parseRef(text: string): ModelRef | null {
  const i = text.indexOf("/");
  if (i <= 0 || i === text.length - 1) return null;
  return { provider: text.slice(0, i), id: text.slice(i + 1) };
}

/**
 * 使えるモデルを、`/models` の 3 つのグループに分ける。
 * - OpenCode Go: サブスクで使えるモデルの一覧
 * - Anthropic API: Opus 5.5 / Sonnet 5.5 / Fable 5.2 / Haiku 5.5(この順)
 * - Codex: ChatGPT のサブスクで使えるモデルの一覧(`openai-codex`、または ChatGPT でサインインした `openai`)
 */
export function groupModels(
  available: readonly ModelRef[],
  isChatGptLogin: (m: ModelRef) => boolean = () => false,
): ModelGroup[] {
  const byProvider = (p: string) => available.filter((m) => m.provider === p);
  const anthropic = ANTHROPIC_MODEL_IDS.flatMap((id) =>
    available.filter((m) => m.provider === "anthropic" && m.id === id),
  );
  const codex = [
    ...byProvider("openai-codex"),
    ...available.filter((m) => m.provider === "openai" && isChatGptLogin(m)),
  ];
  const groups: ModelGroup[] = [
    { key: "opencode-go", label: "OpenCode Go(サブスク)", models: byProvider("opencode-go") },
    { key: "anthropic", label: "Anthropic API", models: anthropic },
    { key: "codex", label: "Codex(ChatGPT のサブスク)", models: codex },
  ];
  return groups.filter((g) => g.models.length > 0);
}
