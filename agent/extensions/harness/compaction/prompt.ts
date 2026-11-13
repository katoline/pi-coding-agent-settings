import { latestReview, latestVerification, type Plan, renderChecklist } from "../flow/plan.ts";

/** 要約(compact)のときに、必ず残す 5 項目 */
export const RETENTION_ITEMS = [
  "変更したファイルの一覧と、検証済みか未検証か",
  "実行した検証コマンドと結果(失敗ならその内容)",
  "作成・マージした PR",
  "サブエージェントの担当・モデル・状態と、未解決の点",
  "ユーザーが確定した決定事項と、判断待ちの事項",
] as const;

/** 会話の要約を作らせるプロンプト。日本語で、残す項目を明示する */
export function buildSummaryPrompt(conversationText: string, previousSummary?: string): string {
  const previous = previousSummary?.trim() ? `\n\n前回までの要約:\n${previousSummary.trim()}` : "";
  return [
    "あなたは、会話の要約を作る担当です。この要約は、会話の履歴全体の代わりになります。作業を続けるために必要な情報を、漏れなく、簡潔に、日本語の Markdown で書いてください。",
    previous,
    "",
    "必ず、次の項目を、この順に、見出しをつけて書くこと(該当がなければ「なし」)。",
    ...RETENTION_ITEMS.map((item, i) => `${i + 1}. ${item}`),
    "",
    "そのほか、目的、重要な設計判断とその理由、進行中の作業の現在地、次の一手も書く。コマンド・パス・モデル ID は、原文のまま書く。",
    "",
    "<conversation>",
    conversationText,
    "</conversation>",
  ].join("\n");
}

export interface StateInput {
  plan: Plan | undefined;
  subagentModel: string;
  subagentSpawns: number;
  childCost: number;
}

/**
 * ハーネスが持っている、確定した状態。要約モデルの出力に頼らず、そのまま付け足す
 * (圧縮のあとも、計画・検証・レビュー・PR を、正確に引き継ぐ)。
 */
export function buildStateBlock(state: StateInput): string {
  const lines = ["## ハーネスの記録(確定した状態)"];
  const plan = state.plan;
  if (plan?.confirmed) {
    lines.push("", "### 計画", renderChecklist(plan));
    const v = latestVerification(plan);
    lines.push(
      "",
      "### 検証",
      v
        ? `- 直近: ${v.unverified ? "未検証(検証コマンドなし)" : v.ok ? "成功" : "失敗"} — \`${v.command}\`: ${v.summary}`
        : "- 未実行",
    );
    const r = latestReview(plan);
    lines.push(
      "",
      "### 独立レビュー",
      r ? `- 直近: ${r.approved ? "承認" : "却下"} — ${r.summary}` : "- 未実施",
    );
    lines.push("", "### PR");
    if (plan.prs.length === 0) lines.push("- なし");
    for (const pr of plan.prs) {
      lines.push(
        `- #${pr.number} ${pr.title} — ${pr.merged ? "マージ済み" : "未マージ"} ${pr.url}`,
      );
    }
    if (plan.decisions.length > 0) {
      lines.push("", "### 自分で判断したこと", ...plan.decisions.map((d) => `- ${d}`));
    }
  } else {
    lines.push("", "- 確定した計画はありません。");
  }
  lines.push(
    "",
    "### サブエージェント",
    `- モデル: ${state.subagentModel} / 起動した数: ${state.subagentSpawns} / 費用: $${state.childCost.toFixed(4)}`,
  );
  return lines.join("\n");
}
