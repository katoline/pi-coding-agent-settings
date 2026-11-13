/** 利用状況の取得結果の解析と表示(副作用のない純粋な関数) */

export interface Meter {
  /** 5h / 週 / 月 */
  label: "5h" | "週" | "月";
  /** 使用率(%) */
  percent: number;
  /** リセット時刻(ミリ秒)。不明なら undefined */
  resetsAt?: number;
}

const asRecord = (v: unknown): Record<string, unknown> | null =>
  v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

function num(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

const clampPercent = (p: number) => Math.round(Math.min(100, Math.max(0, p)) * 10) / 10;

function timestampMs(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v) && v > 0)
    return v < 10_000_000_000 ? v * 1000 : v;
  if (typeof v === "string" && v.trim()) {
    const n = Number(v);
    if (Number.isFinite(n)) return timestampMs(n);
    const d = Date.parse(v);
    return Number.isFinite(d) ? d : undefined;
  }
  return undefined;
}

/**
 * OpenCode Go: `GET https://opencode.ai/zen/go/v1/usage`(非公式)。
 * `{ usage: { rolling, weekly, monthly: { status, percent, resetsAt } } }`。
 * 形が変わって読めないときは、空を返す(確かな 0% とは区別する)。
 */
export function parseGoUsage(payload: unknown): Meter[] {
  const usage = asRecord(asRecord(payload)?.usage);
  if (!usage) return [];
  const map = [
    ["rolling", "5h"],
    ["weekly", "週"],
    ["monthly", "月"],
  ] as const;
  const meters: Meter[] = [];
  for (const [key, label] of map) {
    const w = asRecord(usage[key]);
    const p = w ? num(w.percent) : null;
    if (!w || p === null) continue;
    const resetsAt = timestampMs(w.resetsAt);
    meters.push({ label, percent: clampPercent(p), ...(resetsAt ? { resetsAt } : {}) });
  }
  return meters;
}

/**
 * Codex(ChatGPT のサブスク): `GET https://chatgpt.com/backend-api/wham/usage`(非公式・未文書化)。
 * `rate_limit.primary_window` / `secondary_window` に `used_percent` と、リセット時刻。
 * 窓の長さ(`limit_window_seconds`)で 5 時間と週を判別し、なければ、primary を 5h、secondary を週とみなす。
 */
export function parseCodexUsage(payload: unknown, now: number): Meter[] {
  const rate = asRecord(asRecord(payload)?.rate_limit);
  if (!rate) return [];
  const meters: Meter[] = [];
  const windows: [unknown, "5h" | "週"][] = [
    [rate.primary_window, "5h"],
    [rate.secondary_window, "週"],
  ];
  for (const [raw, fallback] of windows) {
    const w = asRecord(raw);
    const p = w ? num(w.used_percent) : null;
    if (!w || p === null) continue;
    const seconds = num(w.limit_window_seconds);
    const label: Meter["label"] =
      seconds === null
        ? fallback
        : seconds <= 6 * 3600
          ? "5h"
          : seconds >= 5 * 86400
            ? "週"
            : fallback;
    let resetsAt = timestampMs(w.reset_at) ?? timestampMs(w.resets_at);
    const after = num(w.reset_after_seconds);
    if (resetsAt === undefined && after !== null && after >= 0) resetsAt = now + after * 1000;
    meters.push({ label, percent: clampPercent(p), ...(resetsAt ? { resetsAt } : {}) });
  }
  return meters;
}

/** `5h 62% · 週 31%`。リセットまでの時間は、カッコで */
export function formatMeters(prefix: string, meters: readonly Meter[], now: number): string {
  if (meters.length === 0) return `${prefix}: 取得できません`;
  return `${prefix} ${meters.map((m) => `${m.label} ${m.percent}%${m.resetsAt ? `(${countdown(m.resetsAt - now)})` : ""}`).join(" · ")}`;
}

export function countdown(ms: number): string {
  if (ms <= 0) return "まもなく";
  const m = Math.floor(ms / 60000);
  if (m < 60) return `${m}分`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}時間${m % 60}分`;
  return `${Math.floor(h / 24)}日`;
}

// ---- セッションの使用額 ----
export interface CostParts {
  main: number;
  children: number;
}

/** セッションのエントリ(assistant のメッセージの `usage.cost.total`)の合計 */
export function sessionCost(entries: readonly unknown[]): number {
  let total = 0;
  for (const e of entries) {
    const entry = e as {
      type?: string;
      message?: { role?: string; usage?: { cost?: { total?: number } } };
    };
    if (entry.type !== "message" || entry.message?.role !== "assistant") continue;
    const c = entry.message.usage?.cost?.total;
    if (typeof c === "number" && Number.isFinite(c)) total += c;
  }
  return total;
}

export function formatCost(parts: CostParts): string {
  const total = parts.main + parts.children;
  const usd = (n: number) => `$${n.toFixed(n < 1 ? 4 : 2)}`;
  return parts.children > 0
    ? `このセッション ${usd(total)}(サブエージェント ${usd(parts.children)} を含む)`
    : `このセッション ${usd(total)}`;
}
