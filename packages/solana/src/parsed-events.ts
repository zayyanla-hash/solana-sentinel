import { SolanaAddressSchema, type NormalizedChainEvent, type WalletTrade } from "@sat/shared";
import { logEvent, recordUsage } from "@sat/observability";
import { classifyWalletActivity, normalizeEnhancedTx, normalizeParsedEventsItem } from "./normalize";
import { boundedInteger, requestJson, SafeHttpError, type HttpOptions } from "./http";
import type { WalletHistoryProvider, WalletHistoryResult } from "./history-types";

type Diagnostics = NonNullable<WalletHistoryResult["diagnostics"]>;
export interface HistoryHttpOptions extends Omit<HttpOptions, "signal"> {
  maxPages?: number;
  maxEvents?: number;
}
const PAGE_SIZE = 100;
const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function envUrl(name: string, fallback: string): string {
  const raw = process.env[name]?.trim();
  return raw ? raw.replace(/\/$/, "") : fallback;
}
const DEFAULT_HOST = envUrl("HELIUS_RPC_URL", "https://mainnet.helius-rpc.com");

function validSignature(value: unknown): value is string {
  if (typeof value !== "string" || value.length < 64 || value.length > 88) return false;
  let n = BigInt(0);
  for (const char of value) {
    const digit = ALPHABET.indexOf(char);
    if (digit < 0) return false;
    n = n * BigInt(58) + BigInt(digit);
  }
  let bytes = 0;
  while (n > BigInt(0)) { bytes++; n >>= BigInt(8); }
  return (value.match(/^1*/)?.[0].length ?? 0) + bytes === 64;
}

function rowSignature(row: unknown): string | null {
  if (!row || typeof row !== "object" || Array.isArray(row)) return null;
  const signature = (row as { signature?: unknown }).signature;
  return validSignature(signature) ? signature : null;
}

function fingerprint(ev: NormalizedChainEvent): string {
  return JSON.stringify([ev.slot, ev.blockTime, ev.status, ev.parserStatus, ev.summaryType,
    ev.nativeDeltas, ev.tokenDeltas, ev.swapHint]);
}

function addReason(diagnostics: Diagnostics, value: string): void {
  if (!(diagnostics.reason ?? "").split(";").includes(value))
    diagnostics.reason = diagnostics.reason ? `${diagnostics.reason};${value}` : value;
}

function result(address: string, provider: string, events: NormalizedChainEvent[], diagnostics: Diagnostics): WalletHistoryResult {
  if (diagnostics.rejected && diagnostics.status === "COMPLETE") {
    diagnostics.status = "PARTIAL";
    diagnostics.reason = "rejected-rows";
  }
  const bySignature = new Map<string, { event: NormalizedChainEvent; fingerprint: string }>();
  const conflicts = new Set<string>();
  for (const event of events) {
    const prior = bySignature.get(event.signature);
    if (!prior) bySignature.set(event.signature, { event, fingerprint: fingerprint(event) });
    else if (prior.fingerprint === fingerprint(event)) diagnostics.duplicates++;
    else { diagnostics.duplicates++; conflicts.add(event.signature); }
  }
  if (conflicts.size) {
    diagnostics.rejected += conflicts.size;
    diagnostics.status = "PARTIAL";
    addReason(diagnostics, "conflicting-duplicate");
  }
  const trades: WalletTrade[] = [];
  for (const [signature, { event }] of bySignature) {
    if (conflicts.has(signature)) continue;
    if (event.status === "FAILED") diagnostics.failedTransactions = (diagnostics.failedTransactions ?? 0) + 1;
    if (event.status === "UNKNOWN" || event.parserStatus === "ERROR" || event.parserStatus === "RAW") {
      diagnostics.unknownEvents = (diagnostics.unknownEvents ?? 0) + 1;
      diagnostics.status = "PARTIAL";
      addReason(diagnostics, "parser-uncertainty");
      continue;
    }
    try { trades.push(...classifyWalletActivity(event, address)); }
    catch { diagnostics.rejected++; diagnostics.status = "PARTIAL"; diagnostics.reason = "classification-error"; }
  }
  trades.sort((a, b) => a.timestamp.localeCompare(b.timestamp) || a.signature.localeCompare(b.signature));
  return {
    address, trades,
    freshness: trades.length ? diagnostics.status === "COMPLETE" ? "FRESH" : "STALE" : "INSUFFICIENT",
    provenance: [provider, `history-status=${diagnostics.status}`, `events=${diagnostics.received}`,
      `duplicates=${diagnostics.duplicates}`, ...(diagnostics.reason ? [`reason=${diagnostics.reason}`] : [])],
    isDemo: false, provider, diagnostics,
  };
}

function failure(address: string, provider: string, diagnostics: Diagnostics): WalletHistoryResult {
  return result(address, provider, [], diagnostics);
}

function invalid(address: string, provider: string): WalletHistoryResult {
  return failure(address, provider, {
    status: "INVALID", pages: 0, received: 0, rejected: 0, duplicates: 0, retries: 0,
    reason: "invalid-address",
  });
}

function safeReason(error: unknown, endpoint: "parsed" | "enhanced"): string {
  if (error instanceof SafeHttpError) {
    if (error.kind === "http") return endpoint === "parsed" && [401, 403, 404].includes(error.status ?? 0)
      ? `parsed-unavailable-${error.status}` : `http-${error.status ?? 0}`;
    return error.kind;
  }
  return "provider-error";
}

function logRequest(provider: string, action: string, latencyMs: number, ok: boolean): void {
  logEvent({ level: ok ? "info" : "warn", msg: action, provider, latencyMs });
  recordUsage({ subject: "helius", action, units: 1, estimatedCostUsd: null, provider });
}

function bounds(options: HistoryHttpOptions): { maxPages: number; maxEvents: number } {
  return {
    maxPages: boundedInteger(options.maxPages, 10, 1, 100),
    maxEvents: boundedInteger(options.maxEvents, 1_000, 1, 10_000),
  };
}

abstract class BaseHistoryProvider {
  abstract readonly name: string;
  protected readonly inFlight = new Map<string, Promise<WalletHistoryResult>>();
  private pending = 0;
  protected coalesce(address: string, signal: AbortSignal | undefined, run: () => Promise<WalletHistoryResult>): Promise<WalletHistoryResult> {
    if (signal?.aborted) return Promise.reject(new SafeHttpError("aborted", null, 0));
    if (!signal) {
      const existing = this.inFlight.get(address);
      if (existing) return existing.then((value) => structuredClone(value));
    }
    if (this.pending >= 32) {
      return Promise.resolve(failure(address, this.name, { status: "FAILED", pages: 0, received: 0,
        rejected: 0, duplicates: 0, retries: 0, reason: "provider-saturated" }));
    }
    this.pending++;
    const promise = Promise.resolve().then(run).finally(() => {
      this.pending--;
      if (!signal && this.inFlight.get(address) === promise) this.inFlight.delete(address);
    });
    if (!signal) this.inFlight.set(address, promise);
    return promise.then((value) => structuredClone(value));
  }
}

export class HeliusParsedEventsProvider extends BaseHistoryProvider implements WalletHistoryProvider {
  readonly name = "helius-parsed-events";
  readonly isDemo = false;
  constructor(private readonly apiKey: string, private readonly host = DEFAULT_HOST,
    private readonly options: HistoryHttpOptions = {}) { super(); }

  async fetchPage(address: string, paginationToken?: string | null, signal?: AbortSignal, limit = PAGE_SIZE): Promise<{
    events: NormalizedChainEvent[]; paginationToken: string | null; latencyMs: number; status: number;
    received: number; rejected: number; retries: number; fullWithoutCursor: boolean;
  }> {
    const url = `${this.host.replace(/\/$/, "")}/v1/parsed-events/transaction-history?api-key=${encodeURIComponent(this.apiKey)}`;
    const started = Date.now();
    try {
      const response = await requestJson(url, {
        method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ address, limit, sortOrder: "desc", commitment: "confirmed",
          ...(paginationToken ? { paginationToken } : {}) }),
      }, { ...this.options, signal });
      const value = response.value;
      const container = Array.isArray(value) ? { data: value, paginationToken: null } : value;
      if (!container || typeof container !== "object" || Array.isArray(container)) throw new SafeHttpError("malformed-json", response.status, response.retries);
      const rec = container as Record<string, unknown>;
      if (!Array.isArray(rec.data) || rec.data.length > limit || (rec.paginationToken != null &&
        (typeof rec.paginationToken !== "string" || !rec.paginationToken))) {
        throw new SafeHttpError("malformed-json", response.status, response.retries);
      }
      const events: NormalizedChainEvent[] = [];
      let rejected = 0;
      for (const row of rec.data) {
        if (!rowSignature(row)) { rejected++; continue; }
        try { const event = normalizeParsedEventsItem(row, address); if (event) events.push(event); else rejected++; }
        catch { rejected++; }
      }
      logRequest(this.name, "parsed-events-history", response.latencyMs, true);
      return { events, paginationToken: rec.paginationToken as string | null ?? null,
        latencyMs: response.latencyMs, status: response.status, received: rec.data.length, rejected,
        retries: response.retries, fullWithoutCursor: rec.data.length === limit && rec.paginationToken == null };
    } catch (error) {
      logRequest(this.name, "parsed-events-history", Date.now() - started, false);
      throw error;
    }
  }

  getTrades(address: string, options?: { signal?: AbortSignal }): Promise<WalletHistoryResult> {
    if (!SolanaAddressSchema.safeParse(address).success) return Promise.resolve(invalid(address, this.name));
    return this.coalesce(address, options?.signal, () => this.load(address, options?.signal));
  }

  private async load(address: string, signal?: AbortSignal): Promise<WalletHistoryResult> {
    const diagnostics: Diagnostics = { status: "COMPLETE", pages: 0, received: 0, rejected: 0, duplicates: 0, retries: 0 };
    const events: NormalizedChainEvent[] = [];
    const seenTokens = new Set<string>();
    const seenSignatures = new Set<string>();
    const { maxPages, maxEvents } = bounds(this.options);
    let token: string | null = null;
    try {
      for (let pageNumber = 0; pageNumber < maxPages; pageNumber++) {
        const page = await this.fetchPage(address, token, signal, Math.min(PAGE_SIZE, maxEvents - diagnostics.received));
        diagnostics.pages++; diagnostics.received += page.received; diagnostics.rejected += page.rejected;
        diagnostics.retries += page.retries;
        events.push(...page.events);
        const newSignatures = page.events.filter((event) => !seenSignatures.has(event.signature));
        for (const event of page.events) seenSignatures.add(event.signature);
        if (!page.paginationToken) {
          if (page.fullWithoutCursor) { diagnostics.status = "PARTIAL"; diagnostics.reason = "full-page-no-cursor"; }
          return result(address, this.name, events, diagnostics);
        }
        if (seenTokens.has(page.paginationToken) || page.paginationToken === token ||
          page.received === 0 || (pageNumber > 0 && newSignatures.length === 0)) {
          diagnostics.status = "PARTIAL"; diagnostics.reason = "pagination-no-progress";
          return result(address, this.name, events, diagnostics);
        }
        if (diagnostics.received >= maxEvents) {
          diagnostics.status = "PARTIAL"; diagnostics.reason = "event-cap";
          return result(address, this.name, events, diagnostics);
        }
        seenTokens.add(page.paginationToken);
        token = page.paginationToken;
      }
      diagnostics.status = "PARTIAL"; diagnostics.reason = "page-cap";
      return result(address, this.name, events, diagnostics);
    } catch (error) {
      if (error instanceof SafeHttpError && error.kind === "aborted") throw error;
      diagnostics.retries += error instanceof SafeHttpError ? error.retries : 0;
      diagnostics.status = events.length || diagnostics.received ? "PARTIAL" : "FAILED";
      diagnostics.reason = safeReason(error, "parsed");
      return result(address, this.name, events, diagnostics);
    }
  }
}

export class HeliusEnhancedTransactionsProvider extends BaseHistoryProvider implements WalletHistoryProvider {
  readonly name = "helius-enhanced-tx";
  readonly isDemo = false;
  constructor(private readonly apiKey: string,
    private readonly base = envUrl("HELIUS_API_BASE", "https://api.helius.xyz"),
    private readonly options: HistoryHttpOptions = {}) { super(); }

  async fetchRows(address: string, before?: string | null, signal?: AbortSignal, limit = PAGE_SIZE): Promise<{
    rows: unknown[]; status: number; latencyMs: number; retries: number;
  }> {
    const url = `${this.base.replace(/\/$/, "")}/v0/addresses/${address}/transactions?api-key=${encodeURIComponent(this.apiKey)}&limit=${limit}` +
      (before ? `&before=${encodeURIComponent(before)}` : "");
    const started = Date.now();
    try {
      const response = await requestJson(url, { headers: { Accept: "application/json" } },
        { ...this.options, signal });
      if (!Array.isArray(response.value) || response.value.length > limit)
        throw new SafeHttpError("malformed-json", response.status, response.retries);
      logRequest(this.name, "enhanced-tx-history", response.latencyMs, true);
      return { rows: response.value, status: response.status, latencyMs: response.latencyMs, retries: response.retries };
    } catch (error) {
      logRequest(this.name, "enhanced-tx-history", Date.now() - started, false);
      throw error;
    }
  }

  getTrades(address: string, options?: { signal?: AbortSignal }): Promise<WalletHistoryResult> {
    if (!SolanaAddressSchema.safeParse(address).success) return Promise.resolve(invalid(address, this.name));
    return this.coalesce(address, options?.signal, () => this.load(address, options?.signal));
  }

  private async load(address: string, signal?: AbortSignal): Promise<WalletHistoryResult> {
    const diagnostics: Diagnostics = { status: "COMPLETE", pages: 0, received: 0, rejected: 0, duplicates: 0, retries: 0 };
    const events: NormalizedChainEvent[] = [];
    const { maxPages, maxEvents } = bounds(this.options);
    let before: string | null = null;
    const cursors = new Set<string>();
    const seenSignatures = new Set<string>();
    try {
      for (let pageNumber = 0; pageNumber < maxPages; pageNumber++) {
        const limit = Math.min(PAGE_SIZE, maxEvents - diagnostics.received);
        const page = await this.fetchRows(address, before, signal, limit);
        diagnostics.pages++; diagnostics.received += page.rows.length; diagnostics.retries += page.retries;
        for (const row of page.rows) {
          if (!rowSignature(row)) { diagnostics.rejected++; continue; }
          try { const event = normalizeEnhancedTx(row, address); if (event) events.push(event); else diagnostics.rejected++; }
          catch { diagnostics.rejected++; }
        }
        const newSignatures = events.filter((event) => !seenSignatures.has(event.signature));
        for (const event of events) seenSignatures.add(event.signature);
        if (page.rows.length < limit) return result(address, this.name, events, diagnostics);
        const last = rowSignature(page.rows[page.rows.length - 1]);
        if (!last || last === before || cursors.has(last) || (pageNumber > 0 && newSignatures.length === 0)) {
          diagnostics.status = "PARTIAL"; diagnostics.reason = "pagination-no-progress";
          return result(address, this.name, events, diagnostics);
        }
        if (diagnostics.received >= maxEvents) {
          diagnostics.status = "PARTIAL"; diagnostics.reason = "event-cap";
          return result(address, this.name, events, diagnostics);
        }
        cursors.add(last); before = last;
      }
      diagnostics.status = "PARTIAL"; diagnostics.reason = "page-cap";
      return result(address, this.name, events, diagnostics);
    } catch (error) {
      if (error instanceof SafeHttpError && error.kind === "aborted") throw error;
      diagnostics.retries += error instanceof SafeHttpError ? error.retries : 0;
      diagnostics.status = events.length || diagnostics.received ? "PARTIAL" : "FAILED";
      diagnostics.reason = safeReason(error, "enhanced");
      return result(address, this.name, events, diagnostics);
    }
  }
}

export class CompositeHeliusHistoryProvider implements WalletHistoryProvider {
  readonly name = "helius-composite";
  readonly isDemo = false;
  constructor(private readonly parsed: HeliusParsedEventsProvider,
    private readonly enhanced: HeliusEnhancedTransactionsProvider) {}

  async getTrades(address: string, options?: { signal?: AbortSignal }): Promise<WalletHistoryResult> {
    const primary = await this.parsed.getTrades(address, options);
    const reason = primary.diagnostics?.reason;
    if (primary.diagnostics?.status !== "FAILED" || !reason || !/^parsed-unavailable-(401|403|404)$/.test(reason)) return primary;
    const fallback = await this.enhanced.getTrades(address, options);
    return { ...fallback, provenance: [`primary=${this.parsed.name}`, ...primary.provenance,
      `fallback=${this.enhanced.name}`, ...fallback.provenance] };
  }
}
