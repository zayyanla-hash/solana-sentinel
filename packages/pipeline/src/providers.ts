import { createMarketDataProvider, type MarketDataProvider } from "@sat/market-data";
import {
  createOnChainProvider,
  createWalletHistoryProvider,
  type OnChainProvider,
  type WalletHistoryProvider,
} from "@sat/solana";
import { createExecutionProvider, type ExecutionProvider } from "@sat/execution";
import { createResearchProvider, type ResearchProvider } from "@sat/research-agent";
import { JournalWalletHistoryProvider } from "./journal-history";

export interface AppProviders {
  market: MarketDataProvider;
  onchain: OnChainProvider;
  execution: ExecutionProvider;
  research: ResearchProvider;
  walletHistory: WalletHistoryProvider;
}

let cached: AppProviders | null = null;
let closing = false;
let closeTask: Promise<void> | null = null;

export function getProviders(): AppProviders {
  if (closing) throw new Error("providers-shutting-down");
  if (!cached) {
    cached = {
      market: createMarketDataProvider(),
      onchain: createOnChainProvider(),
      execution: createExecutionProvider(),
      research: createResearchProvider(),
      walletHistory: process.env.SAT_WALLET_HISTORY_SOURCE === "journal"
        ? new JournalWalletHistoryProvider(requiredJournalUrl()) : createWalletHistoryProvider(),
    };
  }
  return cached;
}

function requiredJournalUrl(): string {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) throw new Error("journal-database-required");
  return url;
}

export function resetProvidersForTests(): void {
  cached = null;
  closing = false;
  closeTask = null;
}

export async function closeProviders(): Promise<void> {
  if (closeTask) return closeTask;
  closing = true;
  const providers = cached;
  cached = null;
  closeTask = providers?.walletHistory.close?.() ?? Promise.resolve();
  await closeTask;
}
