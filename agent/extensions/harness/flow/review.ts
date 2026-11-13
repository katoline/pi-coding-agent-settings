/** 独立レビュー: 新しいコンテキストの読み取り専用のサブエージェントに、差分と要件だけを渡す */

export type Verdict = "approved" | "disapproved" | "none";

/**
 * 末尾のマーカー(`<approved/>` / `<disapproved/>`)で判定する。
 * **マーカーがない・エラー・中断は、承認ではない**(fail-closed)。どちらも含まれていれば、却下。
 */
export function parseVerdict(text: string): Verdict {
  const dis = /<disapproved\s*\/>/i.test(text);
  const app = /<approved\s*\/>/i.test(text);
  if (dis) return "disapproved";
  if (app) return "approved";
  return "none";
}

export const DIFF_CAP = 200 * 1024;

export interface ReviewMaterial {
  requirements: string;
  baseRef: string;
  diffStat: string;
  diff: string;
}

/** レビュー担当に渡す依頼。**差分と要件だけ**を渡し、実装側の説明は渡さない */
export function buildReviewTask(m: ReviewMaterial): string {
  const diff =
    m.diff.length > DIFF_CAP
      ? `${m.diff.slice(0, DIFF_CAP)}\n\n[差分が大きいため、途中で切りました。残りは、ファイルを直接読んで確認してください]`
      : m.diff;
  return [
    "次の変更を、要件に照らしてレビューしてください。実装側の説明は渡していません。差分と、実際のコードだけを根拠にしてください。",
    "",
    "## 要件",
    m.requirements.trim(),
    "",
    `## 比較の基準: ${m.baseRef}`,
    "",
    "## 変更の概要",
    m.diffStat.trim() || "(変更なし)",
    "",
    "## 差分",
    "```diff",
    diff,
    "```",
    "",
    "## 出力の形式",
    "- 指摘ごとに、`file:line`、再現経路を 1 文で書く。書けないものは出さない。",
    "- 最後の行に、**必ず** `<approved/>`(指摘なし、または、直すべき指摘がない)か、`<disapproved/>`(直すべき指摘がある)のどちらかを書く。",
  ].join("\n");
}

/** 再レビューは、直した差分だけを対象にする */
export function buildRereviewNote(previousSummary: string): string {
  return `\n\n## 前回の指摘\n${previousSummary.trim()}\n\n今回は、前回の指摘を直した差分だけを対象にしてください。`;
}
