import { latestReview, latestVerification, type Plan, type PlanItem } from "./plan.ts";

const statusLabel = (i: PlanItem): string => {
  switch (i.status) {
    case "done":
      return "完了";
    case "unfinished":
      return `未完了(${i.reason ?? "理由なし"})`;
    case "deferred":
      return `保留(${i.reason ?? "理由なし"})`;
    default:
      return "未着手のまま(計画が途中で止まりました)";
  }
};

/**
 * 完了報告(固定の形)。ハーネスが、状態から決定論的に作る。根拠を示せない項目は「完了」にならない
 * (完了にするゲートが、根拠・検証・レビューを要求するため)。
 */
export function renderReport(plan: Plan): string {
  const lines: string[] = [];
  lines.push(`# 完了報告: ${plan.goal}`);

  lines.push("", "## 要件ごとの結果");
  for (const item of plan.items) {
    lines.push(`- **${item.id}: ${item.title}** — ${statusLabel(item)}`);
    lines.push(`  - 完了条件: ${item.acceptance}`);
    if (item.status === "done" && item.evidence) lines.push(`  - 根拠: ${item.evidence}`);
    if (item.cycles > 0) lines.push(`  - 差し戻し: ${item.cycles} 回`);
  }

  lines.push("", "## 実行した検証");
  if (plan.verifications.length === 0)
    lines.push(
      "- **未検証**(検証コマンドが無い、または実行していません。自動マージはしていません)",
    );
  for (const v of plan.verifications)
    lines.push(`- ${v.ok ? "成功" : "失敗"}: \`${v.command}\` — ${v.summary}`);
  const lv = latestVerification(plan);
  if (lv && !lv.ok) lines.push("- 最後の検証は失敗しています。");

  lines.push("", "## 独立レビュー");
  if (plan.reviews.length === 0)
    lines.push("- 実施していません(挙動に関わる変更がない、または対象外)");
  for (const r of plan.reviews) lines.push(`- ${r.approved ? "承認" : "却下"}: ${r.summary}`);
  const lr = latestReview(plan);
  if (lr && !lr.approved) lines.push("- 最後のレビューは承認されていません。");

  lines.push("", "## PR");
  if (plan.prs.length === 0) lines.push("- 作成していません");
  for (const pr of plan.prs)
    lines.push(`- #${pr.number} ${pr.title} — ${pr.merged ? "マージ済み" : "未マージ"} ${pr.url}`);

  lines.push("", "## 自分で判断したこと");
  if (plan.decisions.length === 0) lines.push("- なし");
  for (const d of plan.decisions) lines.push(`- ${d}`);

  const deferred = plan.items.filter((i) => i.status === "deferred");
  lines.push("", "## ユーザーへの依頼(保留した項目)");
  if (deferred.length === 0) lines.push("- なし");
  for (const i of deferred) lines.push(`- ${i.id}: ${i.title} — ${i.reason ?? ""}`);

  if (plan.paused && plan.pausedReason)
    lines.push("", `> 自動の継続は止まっています: ${plan.pausedReason}`);
  return lines.join("\n");
}
