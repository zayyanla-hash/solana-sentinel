import { createMarketDataProvider, type MarketDataProvider } from "@sat/market-data";
import {
  createOnChainProvider,
  createWalletHistoryProvider,
  type OnChainProvider,
  type WalletHistoryProvider,
} from "@sat/solana";
import { createExecutionProvider, type ExecutionProvider } from "@sat/execution";
import { createResearchProvider, type ResearchProvider } from "@sat/research-agent";

export interface AppProviders {
  market: MarketDataProvider;
  onchain: OnChainProvider;
  execution: ExecutionProvider;
  research: ResearchProvider;
  walletHistory: WalletHistoryProvider;
}

let cached: AppProviders | null = null;

export function getProviders(): AppProviders {
  if (!cached) {
    cached = {
      market: createMarketDataProvider(),
      onchain: createOnChainProvider(),
      execution: createExecutionProvider(),
      research: createResearchProvider(),
      walletHistory: createWalletHistoryProvider(),
    };
  }
  return cached;
}

export function resetProvidersForTests(): void {
  cached = null;
}
