import type { WalletTrade } from "@sat/shared";

/** Information available as of timestamp T (inclusive). Prevents look-ahead. */
export function tradesAsOf(trades: WalletTrade[], asOfMs: number): WalletTrade[] {
  return trades.filter((t) => Date.parse(t.timestamp) <= asOfMs);
}
