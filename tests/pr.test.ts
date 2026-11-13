import assert from "node:assert/strict";
import { test } from "node:test";
import {
  type Plan,
  proposePlan,
  recordReview,
  recordVerification,
} from "../agent/extensions/harness/flow/plan.ts";
import {
  buildPrBody,
  evaluateChecks,
  hasDefaultBranchProtection,
  isValidBranchName,
  mergeBlockers,
  parseChecks,
  parseGithubRemote,
  protectionRuleset,
  worktreePath,
} from "../agent/extensions/harness/flow/pr.ts";

function plan(opts: { review?: boolean; done?: boolean } = {}): Plan {
  const r = proposePlan(
    "g",
    [{ id: "a", title: "A", acceptance: "x", review: opts.review ?? false }],
    0,
  );
  assert.ok(r.ok);
  const p = { ...r.value, confirmed: true };
  if (opts.done !== false) p.items[0] = { ...p.items[0], status: "done", evidence: "e" } as never;
  return p;
}
const verified = (p: Plan, fp = "fp") =>
  recordVerification(p, { command: "npm test", ok: true, fingerprint: fp, summary: "成功" });
const gate = (over: Partial<Parameters<typeof mergeBlockers>[0]> = {}) =>
  mergeBlockers({
    isSubagent: false,
    plan: verified(plan()),
    checks: "pass",
    fingerprint: "fp",
    ...over,
  });

test("PR 本文は、概要・変更点・確認方法の固定の形", () => {
  const body = buildPrBody({
    commits: ["feat: a を追加", "fix: b を直す"],
    diffStat: " a.ts | 2 +-",
    verification: { command: "npm run check", ok: true, summary: "12 件成功" },
  });
  const [a, b, c] = ["## 概要", "## 変更点", "## 確認方法"].map((h) => body.indexOf(h));
  assert.ok(a !== undefined && b !== undefined && c !== undefined && a >= 0 && a < b && b < c);
  assert.ok(body.includes("- feat: a を追加") && body.includes("成功: `npm run check`"));
});

test("PR 本文: 概要を渡せる。検証がなければ「未検証」", () => {
  const body = buildPrBody({ summary: "認証を直す", commits: [], diffStat: "" });
  assert.ok(body.includes("認証を直す") && body.includes("**未検証**(検証を実行していません)"));
  const un = buildPrBody({
    commits: ["x"],
    diffStat: "",
    verification: { command: "(なし)", ok: true, unverified: true, summary: "" },
  });
  assert.ok(un.includes("検証コマンドが見つかりませんでした"));
});

test("CI の状態の判定", () => {
  assert.equal(evaluateChecks([]), "none");
  assert.equal(evaluateChecks([{ name: "a", bucket: "skipping" }]), "none");
  assert.equal(
    evaluateChecks([
      { name: "a", bucket: "pass" },
      { name: "b", bucket: "pass" },
    ]),
    "pass",
  );
  assert.equal(
    evaluateChecks([
      { name: "a", bucket: "pass" },
      { name: "b", bucket: "pending" },
    ]),
    "pending",
  );
  assert.equal(
    evaluateChecks([
      { name: "a", bucket: "fail" },
      { name: "b", bucket: "pending" },
    ]),
    "fail",
  );
  assert.equal(evaluateChecks([{ name: "a", bucket: "cancel" }]), "fail");
  assert.deepEqual(parseChecks('[{"name":"quality","bucket":"pass"}]'), [
    { name: "quality", bucket: "pass" },
  ]);
  assert.deepEqual(parseChecks("壊れている"), []);
});

test("マージのゲート: すべて満たせばマージできる", () => {
  assert.deepEqual(gate(), []);
});

test("マージのゲート: サブエージェントは拒否", () => {
  assert.ok(gate({ isSubagent: true }).some((r) => r.includes("メインセッション")));
});

test("マージのゲート: CI が無い・失敗・未了は拒否", () => {
  assert.ok(gate({ checks: "none" }).some((r) => r.includes("チェックがありません")));
  assert.ok(gate({ checks: "fail" }).some((r) => r.includes("失敗")));
  assert.ok(gate({ checks: "pending" }).some((r) => r.includes("終わっていません")));
});

test("マージのゲート: 計画がない・検証がない・未検証・失敗・古い検証は拒否", () => {
  assert.ok(gate({ plan: undefined }).length > 0);
  assert.ok(gate({ plan: plan() }).some((r) => r.includes("検証が未実行")));
  const unverified = recordVerification(plan(), {
    command: "(なし)",
    ok: true,
    unverified: true,
    fingerprint: "fp",
    summary: "",
  });
  assert.ok(gate({ plan: unverified }).some((r) => r.includes("未検証")));
  const failed = recordVerification(plan(), {
    command: "t",
    ok: false,
    fingerprint: "fp",
    summary: "",
  });
  assert.ok(gate({ plan: failed }).some((r) => r.includes("失敗")));
  assert.ok(gate({ fingerprint: "fp2" }).some((r) => r.includes("変更がありました")));
});

test("マージのゲート: レビューが必要な計画は、承認と新しさが要る", () => {
  const base = verified(plan({ review: true }));
  assert.ok(gate({ plan: base }).some((r) => r.includes("承認されていません")));
  const stale = recordReview(base, { approved: true, fingerprint: "old", summary: "" });
  assert.ok(gate({ plan: stale }).some((r) => r.includes("再レビュー")));
  const ok = recordReview(base, { approved: true, fingerprint: "fp", summary: "" });
  assert.deepEqual(gate({ plan: ok }), []);
});

test("マージのゲート: 未着手・進行中の項目が残っていれば拒否", () => {
  assert.ok(
    gate({ plan: verified(plan({ done: false })) }).some((r) => r.includes("未着手・進行中")),
  );
});

test("ブランチ保護: 既定ブランチに、PR 必須・force push と削除の禁止があるか", () => {
  assert.equal(hasDefaultBranchProtection([]), false);
  const full = protectionRuleset(["quality"]) as never;
  assert.equal(hasDefaultBranchProtection([full]), true);
  assert.equal(
    hasDefaultBranchProtection([{ ...(full as object), enforcement: "disabled" } as never]),
    false,
  );
  assert.equal(
    hasDefaultBranchProtection([{ ...(full as object), rules: [{ type: "deletion" }] } as never]),
    false,
  );
  assert.equal(
    hasDefaultBranchProtection([{ ...(full as object), target: "tag" } as never]),
    false,
  );
});

test("ブランチ保護のルールセット: bypass なし。チェックがあれば必須にする", () => {
  const withChecks = protectionRuleset(["quality"]) as {
    bypass_actors: unknown[];
    rules: { type: string }[];
  };
  assert.deepEqual(withChecks.bypass_actors, []);
  assert.ok(withChecks.rules.some((r) => r.type === "required_status_checks"));
  const noChecks = protectionRuleset([]) as { rules: { type: string }[] };
  assert.ok(!noChecks.rules.some((r) => r.type === "required_status_checks"));
});

test("GitHub のリモートの解析", () => {
  assert.deepEqual(parseGithubRemote("https://github.com/katoline/pi-coding-agent-settings.git"), {
    owner: "katoline",
    repo: "pi-coding-agent-settings",
  });
  assert.deepEqual(parseGithubRemote("git@github.com:o/r.git"), { owner: "o", repo: "r" });
  assert.deepEqual(parseGithubRemote("https://github.com/o/r"), { owner: "o", repo: "r" });
  assert.equal(parseGithubRemote("https://gitlab.com/o/r"), null);
});

test("worktree の置き場所とブランチ名の検査", () => {
  assert.equal(worktreePath("/w/app", "feat/x y"), "/w/app.worktrees/feat-x-y");
  assert.equal(isValidBranchName("feat/a-b_c.1"), true);
  for (const bad of ["", "-x", "a..b", "a b", "a;b", "x/", "x.lock", "$(x)"])
    assert.equal(isValidBranchName(bad), false, bad);
});
