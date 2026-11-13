import assert from "node:assert/strict";
import { test } from "node:test";
import { decideContinuation, progressKey } from "../agent/extensions/harness/flow/loop.ts";
import {
  addDecision,
  DEFAULT_LIMITS,
  isComplete,
  nextItem,
  openItems,
  type Plan,
  pausePlan,
  proposePlan,
  recordPr,
  recordReview,
  recordRework,
  recordVerification,
  renderChecklist,
  resumePlan,
  updateItem,
} from "../agent/extensions/harness/flow/plan.ts";
import { renderReport } from "../agent/extensions/harness/flow/report.ts";

const T0 = 1_000_000;

function confirmed(
  items = [
    { id: "a", title: "A", acceptance: "テストが通る" },
    { id: "b", title: "B", acceptance: "README に書く", kind: "task" as const },
  ],
): Plan {
  const r = proposePlan("目的", items, T0);
  assert.ok(r.ok);
  return { ...r.value, confirmed: true };
}
const gates = (fingerprint = "fp1") => ({ fingerprint });
const okUpdate = (p: Plan, id: string, update: Parameters<typeof updateItem>[2], g = gates()) => {
  const r = updateItem(p, id, update, g);
  assert.ok(r.ok, r.ok ? "" : r.error);
  return r.value;
};

test("計画の提案: 空の目的・項目・id の重複・完了条件なしを拒否する", () => {
  assert.equal(proposePlan("", [{ id: "a", title: "A", acceptance: "x" }], T0).ok, false);
  assert.equal(proposePlan("g", [], T0).ok, false);
  assert.equal(
    proposePlan(
      "g",
      [
        { id: "a", title: "A", acceptance: "x" },
        { id: "a", title: "B", acceptance: "y" },
      ],
      T0,
    ).ok,
    false,
  );
  const noAcceptance = proposePlan("g", [{ id: "a", title: "A", acceptance: " " }], T0);
  assert.equal(noAcceptance.ok, false);
  const ok = proposePlan("g", [{ id: "a", title: "A", acceptance: "x" }], T0);
  assert.ok(ok.ok);
  assert.equal(ok.value.confirmed, false);
  assert.equal(ok.value.items[0]?.kind, "change");
});

test("確定前は、項目を更新できない", () => {
  const r = proposePlan("g", [{ id: "a", title: "A", acceptance: "x" }], T0);
  assert.ok(r.ok);
  const u = updateItem(r.value, "a", { status: "in_progress" }, gates());
  assert.equal(u.ok, false);
});

test("完了には根拠が要る", () => {
  const p = confirmed();
  assert.equal(updateItem(p, "b", { status: "done", evidence: "  " }, gates()).ok, false);
  const done = okUpdate(p, "b", { status: "done", evidence: "README.md:3" });
  assert.equal(done.items[1]?.status, "done");
});

test("変更を伴う項目は、検証が通り、かつ最後の変更のあとであることが要る", () => {
  let p = confirmed();
  assert.equal(updateItem(p, "a", { status: "done", evidence: "x" }, gates()).ok, false); // 未検証
  p = recordVerification(p, {
    command: "npm test",
    ok: false,
    fingerprint: "fp1",
    summary: "失敗",
  });
  assert.equal(updateItem(p, "a", { status: "done", evidence: "x" }, gates()).ok, false); // 失敗
  p = recordVerification(p, { command: "npm test", ok: true, fingerprint: "fp1", summary: "成功" });
  const stale = updateItem(p, "a", { status: "done", evidence: "x" }, gates("fp2")); // 検証後に変更
  assert.equal(stale.ok, false);
  assert.match(stale.ok ? "" : stale.error, /変更がありました/);
  assert.equal(
    okUpdate(p, "a", { status: "done", evidence: "src/a.ts:10 / npm test 成功" }).items[0]?.status,
    "done",
  );
});

test("レビューが必要な項目は、承認され、かつ最後の変更のあとであることが要る", () => {
  let p = confirmed([{ id: "a", title: "A", acceptance: "x", review: true } as never]);
  p = recordVerification(p, { command: "npm test", ok: true, fingerprint: "fp1", summary: "成功" });
  assert.equal(updateItem(p, "a", { status: "done", evidence: "x" }, gates()).ok, false); // 未レビュー
  p = recordReview(p, { approved: false, fingerprint: "fp1", summary: "却下" });
  assert.equal(updateItem(p, "a", { status: "done", evidence: "x" }, gates()).ok, false);
  p = recordReview(p, { approved: true, fingerprint: "fp0", summary: "承認(古い)" });
  assert.equal(updateItem(p, "a", { status: "done", evidence: "x" }, gates()).ok, false); // 変更後に再レビューが要る
  p = recordReview(p, { approved: true, fingerprint: "fp1", summary: "承認" });
  assert.equal(okUpdate(p, "a", { status: "done", evidence: "x" }).items[0]?.status, "done");
});

test("保留は、理由が要る。完了・未完了として確定した項目は、変えられない", () => {
  const p = confirmed();
  assert.equal(updateItem(p, "a", { status: "deferred", reason: "" }, gates()).ok, false);
  const d = okUpdate(p, "a", { status: "deferred", reason: "sudo が必要" });
  assert.equal(d.items[0]?.status, "deferred");
  const done = okUpdate(p, "b", { status: "done", evidence: "x" });
  assert.equal(updateItem(done, "b", { status: "in_progress" }, gates()).ok, false);
  assert.equal(updateItem(p, "zzz", { status: "in_progress" }, gates()).ok, false);
});

test("差し戻しが 3 周で、止まらずに未完了にして、次へ進む", () => {
  let p = okUpdate(confirmed(), "a", { status: "in_progress" });
  for (let i = 0; i < 2; i++) {
    const r = recordRework(p, "テストが落ちる");
    assert.equal(r.gaveUp.length, 0);
    p = r.plan;
  }
  assert.equal(p.items[0]?.cycles, 2);
  const last = recordRework(p, "テストが落ちる");
  assert.equal(last.gaveUp.length, 1);
  assert.equal(last.plan.items[0]?.status, "unfinished");
  assert.match(last.plan.items[0]?.reason ?? "", /3 周/);
  assert.equal(nextItem(last.plan)?.id, "b");
  // 進行中でない項目は数えない
  assert.equal(recordRework(confirmed(), "x").plan.items[0]?.cycles, 0);
});

test("次の項目と、完了の判定", () => {
  let p = confirmed();
  assert.equal(nextItem(p)?.id, "a");
  p = okUpdate(p, "b", { status: "in_progress" });
  assert.equal(nextItem(p)?.id, "b"); // 進行中を優先
  assert.equal(openItems(p).length, 2);
  assert.equal(isComplete(p), false);
  p = okUpdate(p, "b", { status: "done", evidence: "x" });
  p = okUpdate(p, "a", { status: "deferred", reason: "ユーザーの対応待ち" });
  assert.equal(isComplete(p), true);
});

const limits = DEFAULT_LIMITS;
const decide = (
  plan: Plan | undefined,
  over: Partial<Parameters<typeof decideContinuation>[0]> = {},
) => decideContinuation({ plan, now: T0 + 60_000, limits, killSwitch: false, ...over });

test("継続: 計画がない・未確定・完了・一時停止・キルスイッチでは継続しない", () => {
  assert.deepEqual(decide(undefined), { continue: false, reason: "no-plan" });
  const unconfirmed = proposePlan("g", [{ id: "a", title: "A", acceptance: "x" }], T0);
  assert.ok(unconfirmed.ok);
  assert.equal(decide(unconfirmed.value).continue, false);
  assert.deepEqual(decide(confirmed(), { killSwitch: true }), {
    continue: false,
    reason: "kill-switch",
  });
  assert.deepEqual(decide(pausePlan(confirmed(), "x")), { continue: false, reason: "paused" });
  let done = confirmed();
  done = okUpdate(done, "b", { status: "done", evidence: "x" });
  done = okUpdate(done, "a", { status: "deferred", reason: "r" });
  assert.deepEqual(decide(done), { continue: false, reason: "complete" });
});

test("継続: 未完了の項目があれば、継続を要求し、メッセージに次の項目を含める", () => {
  const d = decide(confirmed());
  assert.equal(d.continue, true);
  if (d.continue) {
    assert.equal(d.plan.continuations, 1);
    assert.match(d.message, /次に取り組む項目: a/);
    assert.match(d.message, /ユーザーに質問せずに/);
  }
});

test("継続: 進捗がないまま続けたら、止める", () => {
  let p = confirmed();
  const stops: string[] = [];
  for (let i = 0; i < 6; i++) {
    const d = decide(p);
    if (!d.continue) {
      stops.push(d.reason);
      break;
    }
    p = d.plan;
  }
  assert.deepEqual(stops, ["limit"]);
  assert.ok(p.noProgress >= 1);
});

test("継続: 進捗があれば、無進捗の数え直し", () => {
  let p = confirmed();
  const d1 = decide(p);
  assert.ok(d1.continue);
  p = d1.continue ? d1.plan : p;
  p = okUpdate(p, "a", { status: "in_progress" }); // 進捗
  const d2 = decide(p);
  assert.ok(d2.continue);
  if (d2.continue) assert.equal(d2.plan.noProgress, 0);
});

test("継続: 回数と時間の上限で止める", () => {
  const p = { ...confirmed(), continuations: limits.maxContinuations };
  const d = decide(p);
  assert.equal(d.continue, false);
  assert.equal(decide(confirmed(), { now: T0 + limits.maxMinutes * 60_000 + 1 }).continue, false);
});

test("進捗の指紋は、状態が変わると変わる", () => {
  const p = confirmed();
  assert.notEqual(progressKey(p), progressKey(okUpdate(p, "a", { status: "in_progress" })));
  assert.equal(progressKey(p), progressKey(addDecision(p, "メモ")));
});

test("再開すると、一時停止と無進捗の数が戻る", () => {
  const p = resumePlan({ ...pausePlan(confirmed(), "中断"), noProgress: 2 });
  assert.equal(p.paused, false);
  assert.equal(p.noProgress, 0);
  assert.equal(p.pausedReason, undefined);
});

test("チェックリストの表示", () => {
  const text = renderChecklist(okUpdate(confirmed(), "a", { status: "in_progress" }));
  assert.match(text, /\[~\] a: A/);
  assert.match(text, /\[ \] b: B/);
  assert.match(text, /完了条件: テストが通る/);
});

test("完了報告: 要件ごとの結果・検証・レビュー・PR・判断・保留を、固定の形で出す", () => {
  let p = confirmed([
    { id: "a", title: "実装", acceptance: "テストが通る" },
    { id: "b", title: "記録", acceptance: "README", kind: "task" as const },
    { id: "c", title: "本番の設定", acceptance: "設定済み", kind: "task" as const },
  ]);
  p = recordVerification(p, {
    command: "npm test",
    ok: true,
    fingerprint: "fp1",
    summary: "12 件成功",
  });
  p = recordReview(p, { approved: true, fingerprint: "fp1", summary: "指摘なし" });
  p = recordPr(p, { number: 7, url: "https://example.com/pr/7", title: "feat: x", merged: true });
  p = addDecision(p, "ブランチ名は feat/x にした");
  p = okUpdate(p, "a", { status: "done", evidence: "src/a.ts:10" });
  p = okUpdate(p, "b", { status: "done", evidence: "README.md:5" });
  p = okUpdate(p, "c", { status: "deferred", reason: "秘密情報の用意が必要" });
  const report = renderReport(p);
  for (const s of [
    "要件ごとの結果",
    "a: 実装** — 完了",
    "根拠: src/a.ts:10",
    "実行した検証",
    "成功: `npm test`",
    "独立レビュー",
    "承認: 指摘なし",
    "#7 feat: x — マージ済み",
    "自分で判断したこと",
    "ブランチ名は feat/x にした",
    "ユーザーへの依頼",
    "c: 本番の設定 — 秘密情報の用意が必要",
  ]) {
    assert.ok(report.includes(s), s);
  }
});

test("完了報告: 検証が無ければ「未検証」と書く。未完了の理由も書く", () => {
  let p = confirmed([{ id: "a", title: "実装", acceptance: "x" }]);
  p = okUpdate(p, "a", { status: "in_progress" });
  for (let i = 0; i < 3; i++) p = recordRework(p, "テストが落ちる").plan;
  const report = renderReport(p);
  assert.match(report, /未検証/);
  assert.match(report, /未完了\(3 周で収まりませんでした/);
});
