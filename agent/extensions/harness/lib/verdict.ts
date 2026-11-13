/** ガードの判定。block: 実行させない / ask: ユーザーの明示的な許可があるときだけ通す / allow */
export type Verdict =
  | { kind: "allow" }
  | { kind: "block"; reason: string }
  | { kind: "ask"; reason: string };

export const ALLOW: Verdict = { kind: "allow" };
export const block = (reason: string): Verdict => ({ kind: "block", reason });
export const ask = (reason: string): Verdict => ({ kind: "ask", reason });

/** block が最優先、次に ask。ask が複数ある場合は理由をまとめる */
export function combine(verdicts: Verdict[]): Verdict {
  const blocked = verdicts.find((v) => v.kind === "block");
  if (blocked) return blocked;
  const asks = verdicts.filter((v): v is Extract<Verdict, { kind: "ask" }> => v.kind === "ask");
  if (asks.length > 0) return ask(asks.map((a) => a.reason).join("\n"));
  return ALLOW;
}
