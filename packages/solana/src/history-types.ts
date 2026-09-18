import type { WalletTrade } from "@sat/shared";

export interface WalletHistoryResult {
  address: string;
  trades: WalletTrade[];
  freshness: "FRESH" | "STALE" | "INSUFFICIENT" | "DEMO";
  provenance: string[];
  isDemo: boolean;
  provider: string;
}

export interface WalletHistoryProvider {
  readonly name: string;
  readonly isDemo: boolean;
  getTrades(address: string): Promise<WalletHistoryResult>;
}
