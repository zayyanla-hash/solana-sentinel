import { SolanaAddressSchema, type WalletTrade } from "@sat/shared";
import { logEvent, recordUsage } from "@sat/observability";
import type { NormalizedChainEvent } from "@sat/shared";
import {
  classifyWalletActivity,
  dedupeTrades,
  normalizeEnhancedTx,
  normalizeParsedEventsItem,
} from "./normalize";
import type { WalletHistoryProvider, WalletHistoryResult } from "./history-types";

function envUrl(name: string, fallback: string): string {
  const raw = process.env[name]?.trim();
  return raw ? raw.replace(/\/$/, "") : fallback;
}

const DEFAULT_HOST = envUrl("HELIUS_RPC_URL", "https://mainnet.helius-rpc.com");

function redactUrl(url: string): string {
  return url.replace(/api-key=[^&]+/gi, "api-key=REDACTED");
}

async function timedFetch(url: string, init: RequestInit): Promise<{ res: Response; latencyMs: number }> {
  const started = Date.now();
  const res = await fetch(url, init);
  return { res, latencyMs: Date.now() - started };
}

export class HeliusParsedEventsProvider implements WalletHistoryProvider {
  readonly name = "helius-parsed-events";
  readonly isDemo = false;

  constructor(
    private readonly apiKey: string,
    private readonly host = DEFAULT_HOST,
  ) {}

  async fetchPage(address: string, paginationToken?: string | null): Promise<{
    events: NormalizedChainEvent[];
    paginationToken: string | null;
    latencyMs: number;
    status: number;
  }> {
    const url = `${this.host}/v1/parsed-events/transaction-history?api-key=${this.apiKey}`;
    const { res, latencyMs } = await timedFetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        address,
        limit: 100,
        sortOrder: "desc",
        commitment: "confirmed",
        ...(paginationToken ? { paginationToken } : {}),
      }),
    });
    logEvent({
      level: res.ok ? "info" : "warn",
      msg: "helius-parsed-events",
      provider: this.name,
      latencyMs,
    });
    recordUsage({
      subject: "helius",
      action: "parsed-events-history",
      units: 1,
      estimatedCostUsd: null,
      provider: this.name,
    });
    if (!res.ok) {
      return { events: [], paginationToken: null, latencyMs, status: res.status };
    }
    const json = (await res.json()) as { data?: unknown[]; paginationToken?: string | null };
    const rows = Array.isArray(json.data) ? json.data : Array.isArray(json) ? (json as unknown[]) : [];
    const events = rows
      .map((row) => normalizeParsedEventsItem(row, address))
      .filter((e): e is NormalizedChainEvent => Boolean(e));
    void redactUrl;
    return {
      events,
      paginationToken: json.paginationToken ?? null,
      latencyMs,
      status: res.status,
    };
  }

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
    try {
      const page = await this.fetchPage(parsed.data);
      if (page.status === 401 || page.status === 403 || page.status === 404) {
        return {
          address: parsed.data,
          trades: [],
          freshness: "INSUFFICIENT",
          provenance: [`parsed-events HTTP ${page.status} — paid-plan open beta; fallback may apply`],
          isDemo: false,
          provider: this.name,
        };
      }
      if (page.status >= 400) {
        return {
          address: parsed.data,
          trades: [],
          freshness: "INSUFFICIENT",
          provenance: [`parsed-events HTTP ${page.status}`],
          isDemo: false,
          provider: this.name,
        };
      }
      const rawTrades: WalletTrade[] = [];
      for (const ev of page.events) {
        rawTrades.push(...classifyWalletActivity(ev, parsed.data));
      }
      const { trades, duplicates } = dedupeTrades(rawTrades);
      return {
        address: parsed.data,
        trades,
        freshness: trades.length ? "FRESH" : page.events.length ? "STALE" : "INSUFFICIENT",
        provenance: [
          this.name,
          `events=${page.events.length}`,
          `duplicates-suppressed=${duplicates}`,
          `latencyMs=${page.latencyMs}`,
        ],
        isDemo: false,
        provider: this.name,
      };
    } catch (err) {
      return {
        address: parsed.data,
        trades: [],
        freshness: "INSUFFICIENT",
        provenance: [`parsed-events error: ${err instanceof Error ? err.message : String(err)}`],
        isDemo: false,
        provider: this.name,
      };
    }
  }
}

export class HeliusEnhancedTransactionsProvider implements WalletHistoryProvider {
  readonly name = "helius-enhanced-tx";
  readonly isDemo = false;

  constructor(
    private readonly apiKey: string,
    private readonly base = envUrl("HELIUS_API_BASE", "https://api.helius.xyz"),
  ) {}

  async fetchRows(address: string): Promise<{ rows: unknown[]; status: number; latencyMs: number }> {
    const url = `${this.base.replace(/\/$/, "")}/v0/addresses/${address}/transactions?api-key=${this.apiKey}&limit=100`;
    const { res, latencyMs } = await timedFetch(url, { headers: { Accept: "application/json" } });
    logEvent({
      level: res.ok ? "info" : "warn",
      msg: "helius-enhanced-tx",
      provider: this.name,
      latencyMs,
    });
    recordUsage({
      subject: "helius",
      action: "enhanced-tx-history",
      units: 1,
      estimatedCostUsd: null,
      provider: this.name,
    });
    if (!res.ok) return { rows: [], status: res.status, latencyMs };
    const json = (await res.json()) as unknown;
    return { rows: Array.isArray(json) ? json : [], status: res.status, latencyMs };
  }

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
    try {
      const { rows, status, latencyMs } = await this.fetchRows(parsed.data);
      if (status >= 400) {
        return {
          address: parsed.data,
          trades: [],
          freshness: "INSUFFICIENT",
          provenance: [`enhanced-tx HTTP ${status}`],
          isDemo: false,
          provider: this.name,
        };
      }
      const events = rows
        .map((row) => normalizeEnhancedTx(row, parsed.data))
        .filter((e): e is NormalizedChainEvent => Boolean(e));
      const rawTrades: WalletTrade[] = [];
      for (const ev of events) rawTrades.push(...classifyWalletActivity(ev, parsed.data));
      const { trades, duplicates } = dedupeTrades(rawTrades);
      return {
        address: parsed.data,
        trades,
        freshness: trades.length ? "FRESH" : "INSUFFICIENT",
        provenance: [
          this.name,
          "compatibility-fallback",
          `events=${events.length}`,
          `duplicates-suppressed=${duplicates}`,
          `latencyMs=${latencyMs}`,
        ],
        isDemo: false,
        provider: this.name,
      };
    } catch (err) {
      return {
        address: parsed.data,
        trades: [],
        freshness: "INSUFFICIENT",
        provenance: [`enhanced-tx error: ${err instanceof Error ? err.message : String(err)}`],
        isDemo: false,
        provider: this.name,
      };
    }
  }
}

export class CompositeHeliusHistoryProvider implements WalletHistoryProvider {
  readonly name = "helius-composite";
  readonly isDemo = false;
  constructor(
    private readonly parsed: HeliusParsedEventsProvider,
    private readonly enhanced: HeliusEnhancedTransactionsProvider,
  ) {}

  async getTrades(address: string): Promise<WalletHistoryResult> {
    const primary = await this.parsed.getTrades(address);
    const failed =
      primary.freshness === "INSUFFICIENT" &&
      primary.provenance.some((p) => /HTTP|error|paid-plan/i.test(p));
    if (!failed && primary.trades.length) return primary;
    const fallback = await this.enhanced.getTrades(address);
    return {
      ...fallback,
      provenance: [
        `primary=${this.parsed.name}`,
        ...primary.provenance,
        `fallback=${this.enhanced.name}`,
        ...fallback.provenance,
      ],
      provider: fallback.trades.length ? this.enhanced.name : this.parsed.name,
    };
  }
}
