/**
 * 計画(チェックリスト)の状態機械。副作用のない、純粋な関数だけで書く。
 *
 * 要点:
 * - 項目の「完了」は、モデルの申告だけでは成立しない。証拠の記載に加え、変更を伴う項目は、
 *   最後の変更のあとに検証が通っていること、独立レビューが必要な項目は、最後の変更のあとに
 *   承認されていることを、状態(作業ツリーの指紋)で確かめる。
 * - 検証・レビューの失敗(差し戻し)は項目ごとに数え、上限(既定 3 周)で、止まらずに
 *   「未完了」にして、他の項目を進める。
 */

export type ItemKind = "change" | "task";
export type ItemStatus = "pending" | "in_progress" | "done" | "unfinished" | "deferred";

export interface PlanItem {
  id: string;
  title: string;
  /** 完了条件(確認できる形で) */
  acceptance: string;
  /** change: ファイルを変更する(検証が必要)/ task: 調査・記録など */
  kind: ItemKind;
  /** 挙動に関わる変更で、独立レビューが必要 */
  review: boolean;
  status: ItemStatus;
  /** 検証・レビューで差し戻された回数 */
  cycles: number;
  /** 完了の根拠(file:line、コマンドの出力など) */
  evidence?: string;
  /** 未完了・保留の理由 */
  reason?: string;
}

export interface VerificationRecord {
  command: string;
  ok: boolean;
  /** 検証コマンドが無く、検証できなかった(完了にはできるが、「未検証」と報告し、自動マージはしない) */
  unverified?: boolean;
  /** 実行したときの、作業ツリーの指紋 */
  fingerprint: string;
  summary: string;
}

export interface ReviewRecord {
  approved: boolean;
  fingerprint: string;
  summary: string;
}

export interface PrRecord {
  number: number;
  url: string;
  title: string;
  merged: boolean;
}

export interface Plan {
  version: 1;
  goal: string;
  confirmed: boolean;
  items: PlanItem[];
  /** 一時停止(中断・無進捗・上限・ユーザーの操作) */
  paused: boolean;
  pausedReason?: string;
  /** 自動の継続を行った回数 */
  continuations: number;
  startedAt: number;
  /** 直近の継続時の進捗の指紋と、同じだった連続回数 */
  progressKey: string;
  noProgress: number;
  /** 自分で判断したこと(完了報告に書く) */
  decisions: string[];
  verifications: VerificationRecord[];
  reviews: ReviewRecord[];
  prs: PrRecord[];
}

export interface Limits {
  /** 項目ごとの、差し戻しの上限(周) */
  maxCyclesPerItem: number;
  /** 自動の継続の上限 */
  maxContinuations: number;
  /** 全体の時間の上限(分) */
  maxMinutes: number;
  /** 進捗がないまま続けてよい回数 */
  maxNoProgress: number;
}

export const DEFAULT_LIMITS: Limits = {
  maxCyclesPerItem: 3,
  maxContinuations: 200,
  maxMinutes: 240,
  maxNoProgress: 3,
};

export interface ItemInput {
  id: string;
  title: string;
  acceptance: string;
  kind?: ItemKind;
  review?: boolean;
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };
const fail = <T>(error: string): Result<T> => ({ ok: false, error });

export function proposePlan(goal: string, inputs: readonly ItemInput[], now: number): Result<Plan> {
  if (!goal.trim()) return fail("目的(goal)が空です。");
  if (inputs.length === 0) return fail("項目が 1 つもありません。");
  const seen = new Set<string>();
  const items: PlanItem[] = [];
  for (const input of inputs) {
    const id = input.id.trim();
    if (!id) return fail("項目の id が空です。");
    if (seen.has(id)) return fail(`項目の id が重複しています: ${id}`);
    seen.add(id);
    if (!input.title.trim()) return fail(`項目 ${id} の題名が空です。`);
    if (!input.acceptance.trim()) {
      return fail(`項目 ${id} の完了条件(acceptance)が空です。確認できる形で書いてください。`);
    }
    items.push({
      id,
      title: input.title.trim(),
      acceptance: input.acceptance.trim(),
      kind: input.kind ?? "change",
      review: input.review ?? false,
      status: "pending",
      cycles: 0,
    });
  }
  return {
    ok: true,
    value: {
      version: 1,
      goal: goal.trim(),
      confirmed: false,
      items,
      paused: false,
      continuations: 0,
      startedAt: now,
      progressKey: "",
      noProgress: 0,
      decisions: [],
      verifications: [],
      reviews: [],
      prs: [],
    },
  };
}

export const clonePlan = (plan: Plan): Plan => structuredClone(plan);

export const isOpen = (item: PlanItem) =>
  item.status === "pending" || item.status === "in_progress";
export const openItems = (plan: Plan): PlanItem[] => plan.items.filter(isOpen);

/** 確定した計画があり、未着手・進行中の項目がない */
export const isComplete = (plan: Plan) => plan.confirmed && openItems(plan).length === 0;

/** 次に取り組む項目: 進行中のものを優先し、なければ、先頭の未着手 */
export function nextItem(plan: Plan): PlanItem | undefined {
  return (
    plan.items.find((i) => i.status === "in_progress") ??
    plan.items.find((i) => i.status === "pending")
  );
}

function find(plan: Plan, id: string): Result<PlanItem> {
  const item = plan.items.find((i) => i.id === id);
  return item ? { ok: true, value: item } : fail(`項目 ${id} はありません。`);
}

export interface Gates {
  /** いまの作業ツリーの指紋 */
  fingerprint: string;
}

export function latestVerification(plan: Plan): VerificationRecord | undefined {
  return plan.verifications.at(-1);
}
export function latestReview(plan: Plan): ReviewRecord | undefined {
  return plan.reviews.at(-1);
}

export type UpdateInput =
  | { status: "in_progress" }
  | { status: "done"; evidence: string }
  | { status: "deferred"; reason: string };

/** 項目の状態を更新する。完了は、ゲート(証拠・検証・レビュー)を満たすときだけ通す */
export function updateItem(
  plan: Plan,
  id: string,
  update: UpdateInput,
  gates: Gates,
): Result<Plan> {
  if (!plan.confirmed)
    return fail("計画がまだ確定していません。plan_propose で、ユーザーの確認を得てください。");
  const found = find(plan, id);
  if (!found.ok) return found;
  const next = clonePlan(plan);
  const item = next.items.find((i) => i.id === id) as PlanItem;
  if (item.status === "done" || item.status === "unfinished") {
    return fail(
      `項目 ${id} は、すでに ${item.status === "done" ? "完了" : "未完了として確定"}しています。`,
    );
  }
  if (update.status === "in_progress") {
    item.status = "in_progress";
    return { ok: true, value: next };
  }
  if (update.status === "deferred") {
    if (!update.reason.trim())
      return fail(
        "保留の理由(reason)を書いてください。ユーザーにしかできないことだけを保留にできます。",
      );
    item.status = "deferred";
    item.reason = update.reason.trim();
    return { ok: true, value: next };
  }
  // done
  if (!update.evidence.trim()) {
    return fail(
      "完了には、根拠(evidence: file:line、コマンドの出力など)が必要です。根拠を示せない項目は、完了にできません。",
    );
  }
  if (item.kind === "change") {
    const v = latestVerification(plan);
    if (!v)
      return fail(
        "検証が未実行です。harness_verify を実行してください(検証コマンドがなければ、未検証として報告し、自動マージはしません)。",
      );
    if (!v.ok)
      return fail("直近の検証が失敗しています。直して、harness_verify をやり直してください。");
    if (v.fingerprint !== gates.fingerprint) {
      return fail("最後の検証のあとに、変更がありました。harness_verify をやり直してください。");
    }
  }
  if (item.review) {
    const r = latestReview(plan);
    if (!r) return fail("独立レビューが未実施です。harness_review を実行してください。");
    if (!r.approved)
      return fail("直近のレビューは承認されていません。指摘を直して、再レビューを受けてください。");
    if (r.fingerprint !== gates.fingerprint) {
      return fail(
        "最後のレビューのあとに、変更がありました。直した差分を、再レビューしてください。",
      );
    }
  }
  item.status = "done";
  item.evidence = update.evidence.trim();
  return { ok: true, value: next };
}

/**
 * 検証またはレビューの失敗(差し戻し)を、進行中の項目に数える。上限に達した項目は、止まらずに
 * 「未完了」にして、他の項目を進める。
 */
export function recordRework(
  plan: Plan,
  reason: string,
  limits: Limits = DEFAULT_LIMITS,
): { plan: Plan; gaveUp: PlanItem[] } {
  const next = clonePlan(plan);
  const gaveUp: PlanItem[] = [];
  for (const item of next.items) {
    if (item.status !== "in_progress") continue;
    item.cycles += 1;
    if (item.cycles >= limits.maxCyclesPerItem) {
      item.status = "unfinished";
      item.reason = `${item.cycles} 周で収まりませんでした: ${reason}`;
      gaveUp.push(item);
    }
  }
  return { plan: next, gaveUp };
}

export function addDecision(plan: Plan, note: string): Plan {
  const next = clonePlan(plan);
  next.decisions.push(note.trim());
  return next;
}

export function recordVerification(plan: Plan, v: VerificationRecord): Plan {
  const next = clonePlan(plan);
  next.verifications.push(v);
  return next;
}
export function recordReview(plan: Plan, r: ReviewRecord): Plan {
  const next = clonePlan(plan);
  next.reviews.push(r);
  return next;
}
export function recordPr(plan: Plan, pr: PrRecord): Plan {
  const next = clonePlan(plan);
  const i = next.prs.findIndex((p) => p.number === pr.number);
  if (i >= 0) next.prs[i] = pr;
  else next.prs.push(pr);
  return next;
}

export function pausePlan(plan: Plan, reason: string): Plan {
  const next = clonePlan(plan);
  next.paused = true;
  next.pausedReason = reason;
  return next;
}
export function resumePlan(plan: Plan): Plan {
  const next = clonePlan(plan);
  next.paused = false;
  delete next.pausedReason;
  next.noProgress = 0;
  return next;
}

/** チェックリストの表示(Markdown) */
export function renderChecklist(plan: Plan): string {
  const mark: Record<ItemStatus, string> = {
    pending: "[ ]",
    in_progress: "[~]",
    done: "[x]",
    unfinished: "[!]",
    deferred: "[-]",
  };
  const lines = plan.items.map((i) => {
    const extra =
      i.status === "unfinished" || i.status === "deferred"
        ? `(${i.reason ?? ""})`
        : i.cycles > 0
          ? `(差し戻し ${i.cycles} 回)`
          : "";
    return `- ${mark[i.status]} ${i.id}: ${i.title}${extra}\n    完了条件: ${i.acceptance}`;
  });
  return `目的: ${plan.goal}\n\n${lines.join("\n")}\n\n凡例: [ ] 未着手 / [~] 進行中 / [x] 完了 / [!] 未完了 / [-] 保留(ユーザーの対応待ち)`;
}
