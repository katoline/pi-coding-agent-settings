export const FINAL_LINE = "🚀作業が完了しました！";

interface TextBlock {
  type: "text";
  text: string;
}
interface MessageLike {
  role?: string;
  stopReason?: string;
  content?: unknown;
}

/**
 * 最終応答の最後の 1 行を、必ず完了の 1 行にする。
 * 変更が必要なときだけ、置き換え後のメッセージを返す(不要なら null)。
 * ツール呼び出しを含むメッセージ(まだ続く)や、エラー・中断のメッセージには付けない。
 */
export function withFinalLine<T extends MessageLike>(message: T): T | null {
  if (message.role !== "assistant") return null;
  if (
    message.stopReason === "error" ||
    message.stopReason === "aborted" ||
    message.stopReason === "toolUse"
  ) {
    return null;
  }
  const content = Array.isArray(message.content) ? (message.content as { type?: string }[]) : [];
  if (content.some((b) => b.type === "toolCall")) return null;

  const blocks = [...content];
  let lastText = -1;
  for (let i = blocks.length - 1; i >= 0; i--) {
    if (blocks[i]?.type === "text") {
      lastText = i;
      break;
    }
  }
  if (lastText >= 0) {
    const block = blocks[lastText] as unknown as TextBlock;
    const lines = block.text.trimEnd().split("\n");
    if (lines[lines.length - 1]?.trim() === FINAL_LINE) return null;
    blocks[lastText] = {
      ...block,
      text: `${block.text.trimEnd()}\n\n${FINAL_LINE}`,
    } as unknown as (typeof blocks)[number];
  } else {
    blocks.push({ type: "text", text: FINAL_LINE } as unknown as (typeof blocks)[number]);
  }
  return { ...message, content: blocks };
}
