import {
  type WalletTrade,
  WalletTradeSchema,
  SolanaAddressSchema,
  nowIso,
} from "@sat/shared";
import { DEMO_WALLETS, getDemoWalletTrades } from "@sat/wallet-intel";

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

/**
 * Helius enhanced-tx / signatures adapter.
 * Fail-closed: unknown wallets never receive demo trades.
 * Unparseable transfers are labeled UNKNOWN, not BUY.
 * Docs: https://www.helius.dev/docs/api-reference/enhanced-transactions
 */
export class HeliusWalletHistoryProvider implements WalletHistoryProvider {
  readonly name = "helius-wallet-history";
  readonly isDemo = false;

  constructor(
    private readonly apiKey: string,
    private readonly base = process.env.HELIUS_API_BASE ?? "https://api.helius.xyz",
  ) {}

  async getTrades(address: string): Promise<WalletHistoryResult> {
    const parsed = SolanaAddressSchema.safeParse(address);
    if (!parsed.success) {
      return {
        address,
        trades: [],
        freshness: "INSUFFICIENT",
        provenance: ["invalid-address"],
        isDemo: false,
        provider: this.name,
      };
    }
    const demoHit = (Object.values(DEMO_WALLETS) as string[]).includes(parsed.data);
    if (demoHit) {
      return new DemoWalletHistoryProvider().getTrades(parsed.data);
    }
    try {
      const url = `${this.base.replace(/\/$/, "")}/v0/addresses/${parsed.data}/transactions?api-key=${this.apiKey}&limit=50`;
      const res = await fetch(url, { headers: { Accept: "application/json" } });
      if (!res.ok) {
        return {
          address: parsed.data,
          trades: [],
          freshness: "INSUFFICIENT",
          provenance: [`helius HTTP ${res.status}`],
          isDemo: false,
          provider: this.name,
        };
      }
      const raw = (await res.json()) as unknown;
      const rows = Array.isArray(raw) ? raw : [];
      const trades: WalletTrade[] = [];
      for (const row of rows) {
        if (!row || typeof row !== "object") continue;
        const tx = row as {
          signature?: string;
          timestamp?: number;
          type?: string;
          tokenTransfers?: Array<{
            mint?: string;
            tokenAmount?: number;
            fromUserAccount?: string;
            toUserAccount?: string;
          }>;
        };
        const ts =
          typeof tx.timestamp === "number"
            ? new Date(tx.timestamp * 1000).toISOString()
            : nowIso();
        const transfers = Array.isArray(tx.tokenTransfers) ? tx.tokenTransfers : [];
        if (!transfers.length) continue;
        for (const t of transfers) {
          const mint = SolanaAddressSchema.safeParse(t.mint);
          if (!mint.success) continue;
          const inbound = t.toUserAccount === parsed.data;
          const outbound = t.fromUserAccount === parsed.data;
          const side = inbound ? "TRANSFER_IN" : outbound ? "TRANSFER_OUT" : "UNKNOWN";
          const parsedTrade = WalletTradeSchema.safeParse({
            signature: String(tx.signature ?? `${parsed.data}:${ts}`),
            timestamp: ts,
            mint: mint.data,
            side,
            usdNotional: 0,
            qty: Number(t.tokenAmount ?? 0),
            priceUsd: null,
            tokenAgeHoursAtEntry: null,
            liquidityUsdAtEntry: null,
            slippageBps: null,
            counterparty: inbound ? t.fromUserAccount : t.toUserAccount,
            isDemo: false,
          });
          if (parsedTrade.success) trades.push(parsedTrade.data);
        }
      }
      return {
        address: parsed.data,
        trades,
        freshness: trades.length ? "FRESH" : "INSUFFICIENT",
        provenance: [
          "helius-enhanced-tx",
          "tokenTransfers mapped as TRANSFER_* not BUY/SELL unless a DEX swap parser is added",
        ],
        isDemo: false,
        provider: this.name,
      };
    } catch (err) {
      return {
        address: parsed.data,
        trades: [],
        freshness: "INSUFFICIENT",
        provenance: [`helius error: ${err instanceof Error ? err.message : String(err)}`],
        isDemo: false,
        provider: this.name,
      };
    }
  }
}

export function createWalletHistoryProvider(): WalletHistoryProvider {
  const key = process.env.HELIUS_API_KEY?.trim();
  if (key) return new HeliusWalletHistoryProvider(key);
  return new DemoWalletHistoryProvider();
}
