import { PostgresIngestionStore } from "@sat/database";
import type { WalletHistoryProvider, WalletHistoryResult } from "@sat/solana";

/** Read the monitor's durable, finalized observations without making another network request. */
export class JournalWalletHistoryProvider implements WalletHistoryProvider {
  readonly name = "solana-finalized-journal";
  readonly isDemo = false;
  private readonly store: PostgresIngestionStore;
  constructor(url: string, private readonly maxAgeMs = 120_000) {
    this.store = new PostgresIngestionStore(url);
  }
  async getTrades(address: string): Promise<WalletHistoryResult> {
    const checkpoint = await this.store.getCheckpoint(address);
    const trades = await this.store.getTrades(address);
    const age = checkpoint.lastSuccessAt ? Date.now() - Date.parse(checkpoint.lastSuccessAt) : Infinity;
    const current = checkpoint.coverage === "CURRENT" && checkpoint.lastError == null && age >= 0 && age <= this.maxAgeMs;
    return { address, trades, provider: this.name, isDemo: false,
      freshness: trades.length ? current ? "FRESH" : "STALE" : "INSUFFICIENT",
      provenance: [this.name, `coverage=${checkpoint.coverage}`, "address-accountKeys-scope", "initial-history-window-bounded",
        ...(checkpoint.lastSuccessAt ? [`observed-through=${checkpoint.lastSuccessAt}`] : []),
        ...(checkpoint.lastError ? [`reason=${checkpoint.lastError}`] : [])],
      diagnostics: { status: current ? "COMPLETE" : checkpoint.lastError ? "FAILED" : "PARTIAL",
        pages: 0, received: trades.length, rejected: 0, duplicates: 0, retries: 0,
        ...(current ? {} : { reason: checkpoint.lastError ?? "journal-not-current" }) },
    };
  }
  async close(): Promise<void> { await this.store.close(); }
}
