import assert from "node:assert/strict";
import { test } from "node:test";
import {
  countdown,
  formatCost,
  formatMeters,
  parseCodexUsage,
  parseGoUsage,
  sessionCost,
} from "../agent/extensions/harness/usage/parse.ts";

const NOW = Date.UTC(2026, 10, 13, 0, 0, 0);

test("Go: 5 時間・週・月の使用率を読む", () => {
  const meters = parseGoUsage({
    usage: {
      rolling: { status: "ok", percent: 62.34, resetsAt: new Date(NOW + 3600_000).toISOString() },
      weekly: { status: "ok", percent: "31", resetsAt: new Date(NOW + 86400_000).toISOString() },
      monthly: { status: "ok", percent: 140 },
    },
  });
  assert.deepEqual(
    meters.map((m) => [m.label, m.percent]),
    [
      ["5h", 62.3],
      ["週", 31],
      ["月", 100],
    ],
  );
  assert.equal(meters[0]?.resetsAt, NOW + 3600_000);
  assert.equal(meters[2]?.resetsAt, undefined);
});

test("Go: 形が変わって読めないときは、空(確かな 0% にしない)", () => {
  assert.deepEqual(parseGoUsage({}), []);
  assert.deepEqual(parseGoUsage(null), []);
  assert.deepEqual(parseGoUsage({ usage: { rolling: { percent: "x" } } }), []);
});

test("Codex: primary を 5h、secondary を週とみなす。窓の長さがあれば、それで判別する", () => {
  const byDefault = parseCodexUsage(
    {
      rate_limit: {
        primary_window: { used_percent: 25, reset_after_seconds: 1800 },
        secondary_window: { used_percent: 42, reset_at: (NOW + 86400_000) / 1000 },
      },
    },
    NOW,
  );
  assert.deepEqual(
    byDefault.map((m) => [m.label, m.percent]),
    [
      ["5h", 25],
      ["週", 42],
    ],
  );
  assert.equal(byDefault[0]?.resetsAt, NOW + 1800_000);
  assert.equal(byDefault[1]?.resetsAt, NOW + 86400_000);
  const swapped = parseCodexUsage(
    {
      rate_limit: {
        primary_window: { used_percent: 10, limit_window_seconds: 604800 },
        secondary_window: { used_percent: 20, limit_window_seconds: 18000 },
      },
    },
    NOW,
  );
  assert.deepEqual(
    swapped.map((m) => m.label),
    ["週", "5h"],
  );
});

test("Codex: 読めない形は空", () => {
  assert.deepEqual(parseCodexUsage({}, NOW), []);
  assert.deepEqual(
    parseCodexUsage({ rate_limit: { primary_window: { used_percent: "x" } } }, NOW),
    [],
  );
});

test("表示: 使用率とリセットまでの時間", () => {
  const text = formatMeters(
    "Go",
    [
      { label: "5h", percent: 62, resetsAt: NOW + 90 * 60_000 },
      { label: "週", percent: 31 },
    ],
    NOW,
  );
  assert.equal(text, "Go 5h 62%(1時間30分) · 週 31%");
  assert.equal(formatMeters("Go", [], NOW), "Go: 取得できません");
  assert.equal(countdown(-5), "まもなく");
  assert.equal(countdown(5 * 60_000), "5分");
  assert.equal(countdown(3 * 86400_000), "3日");
});

test("セッションの使用額: assistant のメッセージの費用を合算し、サブエージェント分を足す", () => {
  const entries = [
    { type: "message", message: { role: "user" } },
    { type: "message", message: { role: "assistant", usage: { cost: { total: 0.25 } } } },
    { type: "message", message: { role: "assistant", usage: { cost: { total: 0.5 } } } },
    { type: "custom", customType: "x" },
    { type: "message", message: { role: "assistant" } },
  ];
  assert.equal(sessionCost(entries), 0.75);
  assert.equal(formatCost({ main: 0.75, children: 0 }), "このセッション $0.7500");
  assert.equal(
    formatCost({ main: 2, children: 0.5 }),
    "このセッション $2.50(サブエージェント $0.5000 を含む)",
  );
});
