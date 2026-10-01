import type { WalletTrade } from "@sat/shared";

export interface WalletHistoryResult {
  address: string;
  trades: WalletTrade[];
  freshness: "FRESH" | "STALE" | "INSUFFICIENT" | "DEMO";
  provenance: string[];
  isDemo: boolean;
  provider: string;
  diagnostics?: {
    status: "COMPLETE" | "PARTIAL" | "FAILED" | "INVALID";
    pages: number;
    received: number;
    rejected: number;
    duplicates: number;
    retries: number;
    failedTransactions?: number;
    unknownEvents?: number;
    reason?: string;
  };
}

export interface WalletHistoryProvider {
  readonly name: string;
  readonly isDemo: boolean;
  getTrades(address: string, options?: { signal?: AbortSignal }): Promise<WalletHistoryResult>;
  close?(): Promise<void>;
}
