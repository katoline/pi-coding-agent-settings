import {
  isComplete,
  type Limits,
  nextItem,
  openItems,
  type Plan,
  renderChecklist,
} from "./plan.ts";

/**
 * 自律ループの「継続するか」の判断(純粋な関数)。
 *
 * Pi の `agent_before_settle` は、最後に継続を 1 回だけ要求できる境界。無条件に継続すると
 * 無限ループになるため、次の停止条件を、ここで必ず判定する。
 *
 * - 確定した計画がない、一時停止中、キルスイッチ、完了
 * - 継続の回数、経過時間、進捗がない状態の連続
 */
export interface ContinuationInput {
  plan: Plan | undefined;
  now: number;
  limits: Limits;
  /** キルスイッチ(ファイル)がある */
  killSwitch: boolean;
}

export type Decision =
  | { continue: false; reason: "no-plan" | "complete" | "kill-switch" | "paused" }
  | { continue: false; reason: "limit"; detail: string; plan: Plan }
  | { continue: true; plan: Plan; message: string };

/** 進捗の指紋: 項目の状態・差し戻し回数・記録の数。同じなら、進んでいない */
export function progressKey(plan: Plan): string {
  return JSON.stringify([
    plan.items.map((i) => [i.id, i.status, i.cycles]),
    plan.verifications.length,
    plan.reviews.length,
    plan.prs.length,
  ]);
}

export function decideContinuation(input: ContinuationInput): Decision {
  const { plan, now, limits } = input;
  if (!plan?.confirmed) return { continue: false, reason: "no-plan" };
  if (input.killSwitch) return { continue: false, reason: "kill-switch" };
  if (plan.paused) return { continue: false, reason: "paused" };
  if (isComplete(plan)) return { continue: false, reason: "complete" };

  const stop = (detail: string): Decision => ({
    continue: false,
    reason: "limit",
    detail,
    plan: { ...plan, paused: true, pausedReason: detail },
  });
  if (plan.continuations >= limits.maxContinuations) {
    return stop(`自動の継続の上限(${limits.maxContinuations} 回)に達しました。`);
  }
  if ((now - plan.startedAt) / 60000 >= limits.maxMinutes) {
    return stop(`経過時間の上限(${limits.maxMinutes} 分)に達しました。`);
  }
  const key = progressKey(plan);
  const noProgress = key === plan.progressKey ? plan.noProgress + 1 : 0;
  if (noProgress >= limits.maxNoProgress) {
    return stop(`進捗のないまま ${limits.maxNoProgress} 回続いたため、止めました。`);
  }
  const next = { ...plan, continuations: plan.continuations + 1, progressKey: key, noProgress };
  return { continue: true, plan: next, message: continuationMessage(next) };
}

/** 継続のたびに、モデルへ渡す(画面には出さない)メッセージ */
export function continuationMessage(plan: Plan): string {
  const item = nextItem(plan);
  const open = openItems(plan).length;
  return [
    "確定した計画は、まだ完了していません。ユーザーに質問せずに、続けてください。",
    "",
    renderChecklist(plan),
    "",
    item
      ? `次に取り組む項目: ${item.id}「${item.title}」(完了条件: ${item.acceptance})`
      : "未着手の項目はありません。",
    `未完了の項目: ${open} 件。`,
    "項目が済んだら、根拠を添えて plan_update で完了にする(変更を伴う項目は、先に harness_verify、レビューが必要な項目は harness_review)。",
    "差し戻しが 3 周で収まらない項目は、ハーネスが未完了にして、次へ進める。",
    "計画で決めていない判断は、計画の方針に沿う妥当な既定で進め、plan_note で記録する。",
    "ユーザーにしかできないことは、plan_update の deferred(理由つき)で保留にして、他の項目を進める。",
  ].join("\n");
}

/** すべての項目が済んだときの、完了報告を促すメッセージ */
export function completionMessage(): string {
  return [
    "計画のすべての項目が、完了・未完了・保留のいずれかになりました。",
    "plan_report を呼び、その出力を、そのまま最終の報告として書いてください(要件ごとの完了・未完了と理由、実行した検証・レビューの結果、作成・マージした PR、自分で判断したこと、ユーザーへの依頼を含みます)。",
  ].join("\n");
}
