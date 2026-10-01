import {
  type CandidateAsset,
  type OhlcvBar,
  type OhlcvInterval,
  CandidateAssetSchema,
  OhlcvBarSchema,
  getDemoCandidates,
  USDC,
  WSOL,
  nowIso,
} from "@sat/shared";

export type { OhlcvBar, OhlcvInterval };

export interface MarketDataProvider {
  readonly name: string;
  readonly isDemo: boolean;
  listTrending(limit?: number): Promise<CandidateAsset[]>;
  getAsset(mint: string): Promise<CandidateAsset | null>;
  getBenchmarkPrices?(): Promise<{ solUsd: number; btcUsd: number | null }>;
  getOhlcv(mint: string, interval: OhlcvInterval, limit?: number): Promise<OhlcvBar[]>;
}

const INTERVAL_MS: Record<OhlcvInterval, number> = {
  "1m": 60_000,
  "5m": 300_000,
  "15m": 900_000,
  "1h": 3_600_000,
  "4h": 14_400_000,
  "1d": 86_400_000,
};

const BIRDEYE_TYPE: Record<OhlcvInterval, string> = {
  "1m": "1m",
  "5m": "5m",
  "15m": "15m",
  "1h": "1H",
  "4h": "4H",
  "1d": "1D",
};

export function intervalMs(interval: OhlcvInterval): number {
  return INTERVAL_MS[interval];
}

/**
 * Deterministic DEMO bars derived from the last known demo price.
 * Labeled via provider.isDemo — never presented as live history.
 */
export function buildDemoOhlcv(opts: {
  mint: string;
  lastClose: number;
  interval: OhlcvInterval;
  count: number;
  endMs: number;
}): OhlcvBar[] {
  const step = INTERVAL_MS[opts.interval];
  const seed = [...opts.mint].reduce((s, ch) => s + ch.charCodeAt(0), 0);
  const bars: OhlcvBar[] = [];
  let close = Math.max(opts.lastClose / (1 + 0.00015 * opts.count), opts.lastClose * 0.5);
  for (let i = opts.count - 1; i >= 0; i--) {
    const ts = opts.endMs - i * step;
    const wave = Math.sin((seed + i) / 9) * 0.004 + Math.cos((seed + i) / 13) * 0.002;
    const open = close;
    const closeNext = Math.max(open * (1 + wave), 1e-9);
    const high = Math.max(open, closeNext) * (1 + Math.abs(wave) * 0.4);
    const low = Math.min(open, closeNext) * (1 - Math.abs(wave) * 0.4);
    const volume = Math.max(1, (1000 + (seed % 500)) * (1 + Math.abs(wave) * 4));
    const parsed = OhlcvBarSchema.safeParse({
      timestamp: ts,
      open,
      high,
      low,
      close: closeNext,
      volume,
    });
    if (parsed.success) bars.push(parsed.data);
    close = closeNext;
  }
  return bars;
}

export class DemoMarketDataProvider implements MarketDataProvider {
  readonly name = "demo";
  readonly isDemo = true;

  async listTrending(limit = 20): Promise<CandidateAsset[]> {
    return getDemoCandidates().slice(0, limit);
  }

  async getAsset(mint: string): Promise<CandidateAsset | null> {
    return getDemoCandidates().find((c) => c.mint === mint) ?? null;
  }

  async getBenchmarkPrices() {
    return { solUsd: 148.2, btcUsd: 64_500 };
  }

  async getOhlcv(mint: string, interval: OhlcvInterval, limit = 120): Promise<OhlcvBar[]> {
    const asset =
      getDemoCandidates().find((c) => c.mint === mint) ??
      ({ priceUsd: 1 } as { priceUsd: number | null });
    return buildDemoOhlcv({
      mint,
      lastClose: asset.priceUsd ?? 1,
      interval,
      count: limit,
      endMs: Date.now(),
    });
  }
}

const BirdeyeItemSchema = {
  parse(raw: Record<string, unknown>): OhlcvBar | null {
    const mapped = {
      timestamp: Math.trunc(Number(raw.unix_time) * 1000),
      open: Number(raw.o),
      high: Number(raw.h),
      low: Number(raw.l),
      close: Number(raw.c),
      volume: Number(raw.v),
    };
    const parsed = OhlcvBarSchema.safeParse(mapped);
    return parsed.success ? parsed.data : null;
  },
};

/**
 * Birdeye OHLCV — official v3 then legacy v1.
 * Docs: https://docs.birdeye.so/reference/get-defi-v3-ohlcv
 * Legacy: https://docs.birdeye.so/reference/get-defi-ohlcv
 * Intervals: 1m, 5m, 15m, 1H, 4H. padding=false so missing candles are not invented.
 */
export class BirdeyeMarketDataProvider implements MarketDataProvider {
  readonly name = "birdeye";
  readonly isDemo = false;
  private readonly ohlcvCache = new Map<string, { at: number; bars: OhlcvBar[] }>();

  constructor(
    private readonly apiKey: string,
    private readonly baseUrl = process.env.BIRDEYE_API_BASE ?? "https://public-api.birdeye.so",
  ) {}

  private headers(): Record<string, string> {
    return {
      "X-API-KEY": this.apiKey,
      Accept: "application/json",
      "x-chain": "solana",
    };
  }

  async listTrending(limit = 20): Promise<CandidateAsset[]> {
    try {
      const url = `${this.baseUrl}/defi/token_trending?sort_by=rank&sort_type=asc&offset=0&limit=${limit}`;
      const res = await fetch(url, { headers: this.headers(), signal: AbortSignal.timeout(8_000) });
      if (!res.ok) throw new Error(`Birdeye HTTP ${res.status}`);
      const json = (await res.json()) as {
        data?: { tokens?: Array<Record<string, unknown>> };
      };
      const tokens = json.data?.tokens ?? [];
      const out: CandidateAsset[] = [];
      for (const t of tokens) {
        const parsed = CandidateAssetSchema.safeParse({
          mint: String(t.address ?? t.mint ?? ""),
          symbol: String(t.symbol ?? "UNK"),
          name: String(t.name ?? t.symbol ?? "Unknown"),
          timestamp: nowIso(),
          priceUsd: num(t.price),
          marketCapUsd: num(t.mc ?? t.marketCap),
          liquidityUsd: num(t.liquidity),
          volume24hUsd: num(t.v24hUSD ?? t.volume24hUSD),
          volumeChange24hPct: num(t.v24hChangePercent),
          priceChange1hPct: num(t.priceChange1hPercent),
          priceChange24hPct: num(t.priceChange24hPercent),
          priceChange7dPct: num(t.priceChange7dPercent),
          tokenAgeHours: null,
          holderCount: null,
          decimals: num(t.decimals),
          metadata: { provider: "birdeye" },
          dataSources: ["birdeye"],
          riskFlags: [],
          isDemo: false,
        });
        if (parsed.success) out.push(parsed.data);
      }
      if (!out.length) {
        throw new Error("Birdeye trending returned 0 validated rows");
      }
      return out;
    } catch (err) {
      throw new Error(
        `Birdeye trending failed (no demo fallback): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async getAsset(mint: string): Promise<CandidateAsset | null> {
    try {
      const url = `${this.baseUrl}/defi/token_overview?address=${mint}`;
      const res = await fetch(url, { headers: this.headers(), signal: AbortSignal.timeout(8_000) });
      if (!res.ok) throw new Error(`Birdeye HTTP ${res.status}`);
      const json = (await res.json()) as { data?: Record<string, unknown> };
      const t = json.data;
      if (!t) return null;
      const parsed = CandidateAssetSchema.safeParse({
        mint,
        symbol: String(t.symbol ?? "UNK"),
        name: String(t.name ?? "Unknown"),
        timestamp: nowIso(),
        priceUsd: num(t.price),
        marketCapUsd: num(t.mc),
        liquidityUsd: num(t.liquidity),
        volume24hUsd: num(t.v24hUSD),
        volumeChange24hPct: num(t.v24hChangePercent),
        priceChange1hPct: num(t.priceChange1hPercent),
        priceChange24hPct: num(t.priceChange24hPercent),
        priceChange7dPct: num(t.priceChange7dPercent),
        tokenAgeHours: null,
        holderCount: num(t.holder),
        decimals: num(t.decimals),
        metadata: { provider: "birdeye" },
        dataSources: ["birdeye"],
        riskFlags: [],
        isDemo: false,
      });
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }

  async getBenchmarkPrices() {
    const sol = await this.getAsset(WSOL);
    return { solUsd: sol?.priceUsd ?? 0, btcUsd: null };
  }

  async getOhlcv(mint: string, interval: OhlcvInterval, limit = 120): Promise<OhlcvBar[]> {
    const key = `${mint}:${interval}:${limit}`;
    const cached = this.ohlcvCache.get(key);
    if (cached && Date.now() - cached.at < 30_000) return cached.bars;
    try {
      const bars = await this.fetchOhlcv(mint, interval, limit);
      this.ohlcvCache.set(key, { at: Date.now(), bars });
      return bars;
    } catch {
      return [];
    }
  }

  private async fetchOhlcv(
    mint: string,
    interval: OhlcvInterval,
    limit: number,
  ): Promise<OhlcvBar[]> {
    const type = BIRDEYE_TYPE[interval];
    const timeTo = Math.floor(Date.now() / 1000);
    const v3 = new URL(`${this.baseUrl}/defi/v3/ohlcv`);
    v3.searchParams.set("address", mint);
    v3.searchParams.set("type", type);
    v3.searchParams.set("currency", "usd");
    v3.searchParams.set("time_to", String(timeTo));
    v3.searchParams.set("mode", "count");
    v3.searchParams.set("count_limit", String(Math.min(Math.max(limit, 1), 5000)));
    v3.searchParams.set("padding", "false");
    const v3res = await fetch(v3, { headers: this.headers(), signal: AbortSignal.timeout(8_000) });
    if (v3res.ok) {
      const bars = parseBirdeyeOhlcv(await v3res.json());
      if (bars.length) return bars.slice(-limit);
    }
    const timeFrom = timeTo - Math.ceil((INTERVAL_MS[interval] / 1000) * limit);
    const v1 = new URL(`${this.baseUrl}/defi/ohlcv`);
    v1.searchParams.set("address", mint);
    v1.searchParams.set("type", type);
    v1.searchParams.set("time_from", String(timeFrom));
    v1.searchParams.set("time_to", String(timeTo));
    const v1res = await fetch(v1, { headers: this.headers(), signal: AbortSignal.timeout(8_000) });
    if (!v1res.ok) throw new Error(`Birdeye OHLCV HTTP ${v1res.status}`);
    return parseBirdeyeOhlcv(await v1res.json()).slice(-limit);
  }
}

function parseBirdeyeOhlcv(json: unknown): OhlcvBar[] {
  const root = json as {
    data?: { items?: Array<Record<string, unknown>>; items_usd?: Array<Record<string, unknown>> };
  };
  const items = root.data?.items ?? [];
  const out: OhlcvBar[] = [];
  for (const raw of items) {
    const bar = BirdeyeItemSchema.parse(raw);
    if (bar) out.push(bar);
  }
  return out.sort((a, b) => a.timestamp - b.timestamp);
}

function num(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function createMarketDataProvider(): MarketDataProvider {
  const key = process.env.BIRDEYE_API_KEY;
  if (key) return new BirdeyeMarketDataProvider(key);
  return new DemoMarketDataProvider();
}

export { USDC, WSOL };
