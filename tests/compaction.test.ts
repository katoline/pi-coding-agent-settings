import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildStateBlock,
  buildSummaryPrompt,
  RETENTION_ITEMS,
} from "../agent/extensions/harness/compaction/prompt.ts";
import {
  addDecision,
  proposePlan,
  recordPr,
  recordReview,
  recordVerification,
} from "../agent/extensions/harness/flow/plan.ts";

test("要約のプロンプト: 残す 5 項目を、この順に、日本語で指定する", () => {
  const prompt = buildSummaryPrompt("会話の本文", "前回の要約");
  let last = -1;
  for (const item of RETENTION_ITEMS) {
    const i = prompt.indexOf(item);
    assert.ok(i > last, item);
    last = i;
  }
  assert.equal(RETENTION_ITEMS.length, 5);
  assert.ok(
    prompt.includes("会話の本文") &&
      prompt.includes("前回の要約") &&
      prompt.includes("<conversation>"),
  );
  assert.ok(!buildSummaryPrompt("x").includes("前回までの要約"));
});

test("確定した状態: 計画・検証・レビュー・PR・判断・サブエージェントをそのまま載せる", () => {
  const r = proposePlan("目的", [{ id: "a", title: "実装", acceptance: "テスト" }], 0);
  assert.ok(r.ok);
  let plan = { ...r.value, confirmed: true };
  plan = recordVerification(plan, {
    command: "npm test",
    ok: true,
    fingerprint: "f",
    summary: "成功",
  });
  plan = recordReview(plan, { approved: false, fingerprint: "f", summary: "src/a.ts:3 バグ" });
  plan = recordPr(plan, { number: 9, url: "https://x/9", title: "feat: a", merged: false });
  plan = addDecision(plan, "既定の branch 名にした");
  const block = buildStateBlock({
    plan,
    subagentModel: "opencode-go/deepseek-v4.1-flash",
    subagentSpawns: 3,
    childCost: 0.12,
  });
  for (const s of [
    "ハーネスの記録",
    "目的: 目的",
    "成功 — `npm test`",
    "却下 — src/a.ts:3 バグ",
    "#9 feat: a — 未マージ",
    "既定の branch 名にした",
    "deepseek-v4.1-flash / 起動した数: 3 / 費用: $0.1200",
  ]) {
    assert.ok(block.includes(s), s);
  }
});

test("確定した計画がなければ、その旨を書く", () => {
  const block = buildStateBlock({
    plan: undefined,
    subagentModel: "m",
    subagentSpawns: 0,
    childCost: 0,
  });
  assert.ok(block.includes("確定した計画はありません"));
});
