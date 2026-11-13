import type { ChildResult } from "./child.ts";
import { isFailed } from "./child.ts";

/** 起動時の表示 */
export const startLine = (model: string, title: string) =>
  `⏳ サブエージェント（${model}）で${title}を実行中`;
/** 終了時の表示 */
export const doneLine = (title: string) => `✅ ${title}が完了`;
export const failLine = (title: string, reason: string) => `❌ ${title}が失敗(${reason})`;

export function failureReason(r: ChildResult): string {
  if (r.timedOut) return "時間切れ";
  if (r.aborted) return "中断";
  if (r.errorMessage) return r.errorMessage.slice(0, 200);
  if (r.exitCode !== 0)
    return `終了コード ${r.exitCode}${r.stderr ? `: ${r.stderr.trim().slice(-200)}` : ""}`;
  return r.stopReason ?? "不明";
}

export function resultLine(r: ChildResult): string {
  return isFailed(r) ? failLine(r.title, failureReason(r)) : doneLine(r.title);
}

export function formatUsage(r: ChildResult): string {
  const u = r.usage;
  return `${u.turns} ターン ↑${u.input} ↓${u.output}${u.cost > 0 ? ` $${u.cost.toFixed(4)}` : ""} ${r.model}`;
}

/** 親(メインエージェント)に返す、全サブエージェントの報告 */
export function formatReport(results: readonly ChildResult[]): string {
  const ok = results.filter((r) => !isFailed(r)).length;
  const body = results.map((r) => {
    const status = resultLine(r);
    return `### ${r.agent}: ${status}\n(${formatUsage(r)})\n\n${r.output || "(報告なし)"}`;
  });
  return `サブエージェント: ${ok}/${results.length} 件が完了\n\n${body.join("\n\n---\n\n")}`;
}
