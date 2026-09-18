import { SolanaAddressSchema } from "@sat/shared";
import { DEMO_WALLETS, getDemoWalletTrades } from "@sat/wallet-intel";
import type { WalletHistoryProvider, WalletHistoryResult } from "./history-types";
import {
  CompositeHeliusHistoryProvider,
  HeliusEnhancedTransactionsProvider,
  HeliusParsedEventsProvider,
} from "./parsed-events";

export type { WalletHistoryProvider, WalletHistoryResult } from "./history-types";

export class DemoWalletHistoryProvider implements WalletHistoryProvider {
  readonly name = "demo-wallet-history";
  readonly isDemo = true;

  async getTrades(address: string): Promise<WalletHistoryResult> {
    const parsed = SolanaAddressSchema.safeParse(address);
    if (!parsed.success) {
      return {
        address,
        trades: [],
        freshness: "INSUFFICIENT",
        provenance: ["invalid-address"],
        isDemo: true,
        provider: this.name,
      };
    }
    const trades = getDemoWalletTrades()[parsed.data] ?? [];
    return {
      address: parsed.data,
      trades,
      freshness: trades.length ? "DEMO" : "INSUFFICIENT",
      provenance: trades.length ? ["demo-wallet-fixtures"] : ["demo-wallet-fixtures", "no-history"],
      isDemo: true,
      provider: this.name,
    };
  }
}

export class FixtureWalletHistoryProvider implements WalletHistoryProvider {
  readonly name = "fixture";
  readonly isDemo = true;
  constructor(private readonly tradesByWallet: Record<string, WalletHistoryResult["trades"]>) {}
  async getTrades(address: string): Promise<WalletHistoryResult> {
    const trades = this.tradesByWallet[address] ?? [];
    return {
      address,
      trades,
      freshness: trades.length ? "DEMO" : "INSUFFICIENT",
      provenance: ["fixture"],
      isDemo: true,
      provider: this.name,
    };
  }
}

/** @deprecated name kept for tests; Enhanced is fallback-only. */
export class HeliusWalletHistoryProvider extends HeliusEnhancedTransactionsProvider {}

export function createWalletHistoryProvider(): WalletHistoryProvider {
  const key = process.env.HELIUS_API_KEY?.trim();
  if (!key) return new DemoWalletHistoryProvider();
  return new CompositeHeliusHistoryProvider(
    new HeliusParsedEventsProvider(key),
    new HeliusEnhancedTransactionsProvider(key),
  );
}

export function createLiveWalletHistoryProvider(): WalletHistoryProvider {
  const key = process.env.HELIUS_API_KEY?.trim();
  if (!key) {
    throw new Error(
      "HELIUS_API_KEY is required for live wallet analysis. Set it in .env.local and rerun. Demo fixtures will not be used.",
    );
  }
  return new CompositeHeliusHistoryProvider(
    new HeliusParsedEventsProvider(key),
    new HeliusEnhancedTransactionsProvider(key),
  );
}

export { DEMO_WALLETS };
