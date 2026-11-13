import { latestVerification, type Plan } from "./plan.ts";

/** PR・マージのゲートと、PR 本文の生成(副作用のない純粋な関数) */

// ---- PR 本文 ----
export interface PrBodyInput {
  /** 1〜3 文の概要。省略時は、コミットの件名から作る */
  summary?: string;
  /** `git log --format=%s base..HEAD` の各行 */
  commits: string[];
  /** `git diff --stat` */
  diffStat: string;
  /** 検証の記録 */
  verification?: { command: string; ok: boolean; unverified?: boolean; summary: string };
}

/** 「概要・変更点・確認方法」の固定の形。差分とコミットから、自動で作る */
export function buildPrBody(input: PrBodyInput): string {
  const summary =
    input.summary?.trim() ||
    (input.commits.length > 0
      ? input.commits.join("、")
      : "変更の概要は、コミットを参照してください。");
  const changes =
    input.commits.length > 0 ? input.commits.map((c) => `- ${c}`).join("\n") : "- (コミットなし)";
  const v = input.verification;
  const verify = !v
    ? "- **未検証**(検証を実行していません)"
    : v.unverified
      ? "- **未検証**(検証コマンドが見つかりませんでした)"
      : `- ${v.ok ? "成功" : "失敗"}: \`${v.command}\`\n  - ${v.summary}`;
  return [
    "## 概要",
    "",
    summary,
    "",
    "## 変更点",
    "",
    changes,
    "",
    "```",
    input.diffStat.trim() || "(差分の統計なし)",
    "```",
    "",
    "## 確認方法",
    "",
    verify,
  ].join("\n");
}

// ---- CI ----
export interface CheckRun {
  name: string;
  /** gh pr checks --json bucket: pass / fail / pending / skipping / cancel */
  bucket: string;
}

export type ChecksState = "pass" | "fail" | "pending" | "none";

export function evaluateChecks(checks: readonly CheckRun[]): ChecksState {
  const relevant = checks.filter((c) => c.bucket !== "skipping");
  if (relevant.length === 0) return "none";
  if (relevant.some((c) => c.bucket === "fail" || c.bucket === "cancel")) return "fail";
  if (relevant.some((c) => c.bucket === "pending")) return "pending";
  return "pass";
}

export function parseChecks(json: string): CheckRun[] {
  try {
    const parsed = JSON.parse(json) as { name?: string; bucket?: string }[];
    return parsed.map((c) => ({ name: String(c.name ?? ""), bucket: String(c.bucket ?? "") }));
  } catch {
    return [];
  }
}

// ---- マージのゲート ----
export interface MergeGateInput {
  isSubagent: boolean;
  plan: Plan | undefined;
  checks: ChecksState;
  /** 現在の作業ツリーの指紋(検証・レビューが、最後の変更のあとのものか) */
  fingerprint: string;
}

/** マージを拒否する理由の一覧。空なら、マージしてよい */
export function mergeBlockers(input: MergeGateInput): string[] {
  const reasons: string[] = [];
  if (input.isSubagent) reasons.push("マージは、メインセッションからだけ許可されます。");
  if (input.checks === "none")
    reasons.push("CI のチェックがありません(未検証の変更は、自動でマージしません)。");
  if (input.checks === "fail")
    reasons.push("CI のチェックが失敗しています。直して、CI を通し直してください。");
  if (input.checks === "pending") reasons.push("CI のチェックが、まだ終わっていません。");
  const plan = input.plan;
  if (!plan?.confirmed) {
    reasons.push(
      "確定した計画がありません。検証とレビューの記録が確認できないため、マージできません。",
    );
    return reasons;
  }
  const v = latestVerification(plan);
  if (!v) reasons.push("検証が未実行です(harness_verify)。");
  else if (v.unverified) reasons.push("検証コマンドがなく、未検証です。自動でマージしません。");
  else if (!v.ok) reasons.push("直近の検証が失敗しています。");
  else if (v.fingerprint !== input.fingerprint)
    reasons.push("最後の検証のあとに、変更がありました。harness_verify をやり直してください。");
  const needsReview = plan.items.some((i) => i.review);
  if (needsReview) {
    const r = plan.reviews.at(-1);
    if (!r?.approved) reasons.push("独立レビューが承認されていません(harness_review)。");
    else if (r.fingerprint !== input.fingerprint)
      reasons.push("最後のレビューのあとに、変更がありました。再レビューを受けてください。");
  }
  const open = plan.items.filter((i) => i.status === "pending" || i.status === "in_progress");
  if (open.length > 0) reasons.push(`未着手・進行中の項目が ${open.length} 件あります。`);
  return reasons;
}

// ---- GitHub のブランチ保護(ルールセット) ----
export interface Ruleset {
  name?: string;
  target?: string;
  enforcement?: string;
  conditions?: { ref_name?: { include?: string[] } };
  rules?: { type?: string }[];
}

/** 既定ブランチに、「PR 必須」と「直接 push・削除の禁止」を課す、有効なルールセットがあるか */
export function hasDefaultBranchProtection(rulesets: readonly Ruleset[]): boolean {
  return rulesets.some((r) => {
    if (r.enforcement !== "active" || r.target !== "branch") return false;
    const include = r.conditions?.ref_name?.include ?? [];
    const targetsDefault = include.includes("~DEFAULT_BRANCH") || include.includes("~ALL");
    const types = new Set((r.rules ?? []).map((x) => x.type));
    return (
      targetsDefault &&
      types.has("pull_request") &&
      types.has("non_fast_forward") &&
      types.has("deletion")
    );
  });
}

/**
 * 既定ブランチのルールセット。PR 必須・force push と削除の禁止・必須のステータスチェック。
 * bypass の主体は置かない(管理者も、直接 push できない)。
 */
export function protectionRuleset(requiredChecks: readonly string[]): Record<string, unknown> {
  const rules: Record<string, unknown>[] = [
    { type: "deletion" },
    { type: "non_fast_forward" },
    {
      type: "pull_request",
      parameters: {
        required_approving_review_count: 0,
        dismiss_stale_reviews_on_push: false,
        require_code_owner_review: false,
        require_last_push_approval: false,
        required_review_thread_resolution: false,
      },
    },
  ];
  if (requiredChecks.length > 0) {
    rules.push({
      type: "required_status_checks",
      parameters: {
        strict_required_status_checks_policy: false,
        required_status_checks: requiredChecks.map((context) => ({ context })),
      },
    });
  }
  return {
    name: "harness: protect default branch",
    target: "branch",
    enforcement: "active",
    conditions: { ref_name: { include: ["~DEFAULT_BRANCH"], exclude: [] } },
    bypass_actors: [],
    rules,
  };
}

/** `git remote get-url origin` から owner/repo を取り出す(github.com のみ) */
export function parseGithubRemote(url: string): { owner: string; repo: string } | null {
  const m = /github\.com[:/]([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/.exec(url.trim());
  return m ? { owner: m[1] as string, repo: m[2] as string } : null;
}

/** worktree の置き場所: リポジトリの隣の `<repo>.worktrees/<ブランチ名(/ を - に)>` */
export function worktreePath(repoRoot: string, branch: string): string {
  const safe = branch.replace(/[^A-Za-z0-9._-]+/g, "-");
  return `${repoRoot}.worktrees/${safe}`;
}

export const isValidBranchName = (name: string) =>
  /^[A-Za-z0-9._/-]+$/.test(name) &&
  !name.startsWith("-") &&
  !name.includes("..") &&
  !name.endsWith("/") &&
  !name.endsWith(".lock");
