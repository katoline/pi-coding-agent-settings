/** セッションのエントリ(`pi.appendEntry` で保存したカスタムエントリ)から、最新の状態を取り出す */
export function latestCustomEntry<T>(
  entries: readonly unknown[],
  customType: string,
): T | undefined {
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i] as { type?: string; customType?: string; data?: unknown };
    if (e?.type === "custom" && e.customType === customType) return e.data as T;
  }
  return undefined;
}
