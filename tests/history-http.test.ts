import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { JUP, USDC } from "@sat/shared";
import {
  CompositeHeliusHistoryProvider, HeliusEnhancedTransactionsProvider, HeliusParsedEventsProvider,
} from "../packages/solana/src/parsed-events";
import { requestJson, SafeHttpError } from "../packages/solana/src/http";

const W = "1".repeat(32);
const SIG = "1".repeat(63) + "2";
const SIG2 = "1".repeat(63) + "3";
function row(signature = SIG, amount = 10, time = 1_700_000_000) {
  return { signature, parserStatus: "OK", parsed: { slot: 1, blockTime: time, fee: 5000,
    tokenTransfers: [
      { fromUserAccount: W, toUserAccount: null, mint: USDC, tokenAmount: 1 },
      { fromUserAccount: null, toUserAccount: W, mint: JUP, tokenAmount: amount },
    ], summary: { type: "swap", parsedData: { input_mint: USDC, output_mint: JUP } } } };
}
const json = (value: unknown, status = 200, headers?: HeadersInit) =>
  new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json", ...headers } });
const fetchStub = (...responses: Response[]) => vi.fn(async () => responses.shift() ?? json({ data: [] }));
let server: Server | undefined;
afterEach(async () => { if (server) { await new Promise<void>((resolve) => server!.close(() => resolve())); server = undefined; } });

async function localServer(handler: Parameters<typeof createServer>[0]): Promise<string> {
  server = createServer(handler);
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("server-address");
  return `http://127.0.0.1:${address.port}`;
}

describe("bounded JSON transport", () => {
  it("retries 429 and 5xx, caps attempts, and never retries auth or malformed JSON", async () => {
    const fetchFn = fetchStub(json({}, 429, { "retry-after": "0" }), json({}, 503), json({ ok: true }));
    const got = await requestJson("https://example.invalid/?api-key=secret", {}, { fetchFn, maxRetries: 2, baseDelayMs: 0 });
    expect(got.retries).toBe(2);
    expect(fetchFn).toHaveBeenCalledTimes(3);
    const auth = fetchStub(json({}, 401), json({ ok: true }));
    await expect(requestJson("https://example.invalid", {}, { fetchFn: auth, maxRetries: 2 })).rejects.toMatchObject({ kind: "http", status: 401 });
    expect(auth).toHaveBeenCalledTimes(1);
    const malformed = vi.fn(async () => new Response("nope"));
    await expect(requestJson("https://example.invalid", {}, { fetchFn: malformed, maxRetries: 2 })).rejects.toMatchObject({ kind: "malformed-json" });
    expect(malformed).toHaveBeenCalledTimes(1);
  });

  it("bounds persistent failures and never exposes credentials in errors", async () => {
    const fetchFn = vi.fn(async () => json({}, 503));
    let error: unknown;
    try { await requestJson("https://example.invalid/?api-key=topsecret", {}, { fetchFn, maxRetries: 2, baseDelayMs: 0 }); }
    catch (caught) { error = caught; }
    expect(error).toBeInstanceOf(SafeHttpError);
    expect(error).toMatchObject({ kind: "http", status: 503, retries: 2 });
    expect(String(error)).not.toContain("topsecret");
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it("times out while a real server stalls its response body", async () => {
    const url = await localServer((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.write('{"data":');
      setTimeout(() => { if (!res.destroyed) res.end("[]}"); }, 200);
    });
    await expect(requestJson(url, {}, { timeoutMs: 30, maxRetries: 0 })).rejects.toMatchObject({ kind: "timeout" });
  });

  it("retries a real local 429 once and then succeeds", async () => {
    let calls = 0;
    const url = await localServer((_req, res) => {
      calls++;
      if (calls === 1) { res.writeHead(429, { "retry-after": "0" }); res.end(); }
      else { res.writeHead(200, { "content-type": "application/json" }); res.end('{"ok":true}'); }
    });
    const got = await requestJson(url, {}, { maxRetries: 1, baseDelayMs: 0 });
    expect(got).toMatchObject({ value: { ok: true }, retries: 1 });
    expect(calls).toBe(2);
  });

  it("rejects oversized streamed bodies and aborted callers", async () => {
    const url = await localServer((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.write("[" + "x".repeat(200)); res.end("]");
    });
    await expect(requestJson(url, {}, { maxResponseBytes: 50, maxRetries: 0 })).rejects.toMatchObject({ kind: "oversized" });
    const controller = new AbortController(); controller.abort();
    await expect(requestJson(url, {}, { signal: controller.signal })).rejects.toMatchObject({ kind: "aborted" });
  });

  it("rejects invalid and unbounded options before making requests", async () => {
    const fetchFn = vi.fn(async () => json({ ok: true }));
    for (const options of [{ timeoutMs: NaN }, { maxResponseBytes: Infinity },
      { maxResponseBytes: 8_000_001 }, { maxRetries: -1 }, { maxDelayMs: 50_000 }]) {
      await expect(requestJson("https://example.invalid", {}, { ...options, fetchFn })).rejects.toMatchObject({ kind: "invalid-options" });
    }
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("settles immediately on caller abort even when a custom fetch ignores its signal", async () => {
    const controller = new AbortController();
    const fetchFn = vi.fn(() => new Promise<Response>(() => undefined));
    const started = Date.now();
    const pending = requestJson("https://example.invalid", {}, { fetchFn, signal: controller.signal, timeoutMs: 2_000, maxRetries: 0 });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ kind: "aborted" });
    expect(Date.now() - started).toBeLessThan(500);
    const fromInit = new AbortController();
    const second = requestJson("https://example.invalid", { signal: fromInit.signal }, { fetchFn, timeoutMs: 2_000, maxRetries: 0 });
    fromInit.abort();
    await expect(second).rejects.toMatchObject({ kind: "aborted" });
  });
});

describe("Helius history pages", () => {
  it("paginates parsed history, sorts trades chronologically, and coalesces concurrent calls", async () => {
    const fetchFn = fetchStub(json({ data: [row(SIG2, 20, 1_700_000_002)], paginationToken: "next" }),
      json({ data: [row(SIG, 10, 1_700_000_001)], paginationToken: null }));
    const provider = new HeliusParsedEventsProvider("secret", "https://example.invalid", { fetchFn, maxRetries: 0 });
    const [one, two] = await Promise.all([provider.getTrades(W), provider.getTrades(W)]);
    expect(one).toEqual(two);
    one.provenance.push("mutated-by-caller");
    expect(two.provenance).not.toContain("mutated-by-caller");
    expect(one.diagnostics).toMatchObject({ status: "COMPLETE", pages: 2, received: 2 });
    expect(one.trades.map((t) => t.sourceSignature)).toEqual([SIG, SIG2]);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(fetchFn.mock.calls[1]?.[1]?.body)).paginationToken).toBe("next");
  });

  it("marks parser uncertainty, invalid rows, and a token cycle as partial", async () => {
    const fetchFn = fetchStub(json({ data: [row(), null], paginationToken: "repeat" }),
      json({ data: [row()], paginationToken: "repeat" }));
    const provider = new HeliusParsedEventsProvider("key", "https://example.invalid", { fetchFn, maxRetries: 0 });
    const got = await provider.getTrades(W);
    expect(got.diagnostics).toMatchObject({ status: "PARTIAL", pages: 2, received: 3, rejected: 1, duplicates: 1, reason: "pagination-no-progress" });
    expect(got.freshness).toBe("STALE");
  });

  it("drops conflicting duplicate signatures and rejects bad containers", async () => {
    const conflict = new HeliusParsedEventsProvider("key", "https://example.invalid", {
      fetchFn: fetchStub(json({ data: [row(SIG, 10), row(SIG, 20)] })), maxRetries: 0,
    });
    const got = await conflict.getTrades(W);
    expect(got.trades).toHaveLength(0);
    expect(got.diagnostics).toMatchObject({ status: "PARTIAL", reason: "conflicting-duplicate", duplicates: 1 });
    const malformed = new HeliusParsedEventsProvider("key", "https://example.invalid", {
      fetchFn: fetchStub(json({ error: "bad" })), maxRetries: 0,
    });
    expect((await malformed.getTrades(W)).diagnostics).toMatchObject({ status: "FAILED", reason: "malformed-json" });
  });

  it("marks parser errors and full parsed pages without cursor as partial", async () => {
    const parserError = new HeliusParsedEventsProvider("key", "https://example.invalid", {
      fetchFn: fetchStub(json({ data: [{ signature: SIG, parserStatus: "ERROR" }] })), maxRetries: 0,
    });
    expect((await parserError.getTrades(W)).diagnostics).toMatchObject({ status: "PARTIAL", unknownEvents: 1, reason: "parser-uncertainty" });
    const full = new HeliusParsedEventsProvider("key", "https://example.invalid", {
      fetchFn: fetchStub(json(Array.from({ length: 100 }, () => row()))), maxRetries: 0,
    });
    expect((await full.getTrades(W)).diagnostics).toMatchObject({ status: "PARTIAL", reason: "full-page-no-cursor", received: 100 });
    const failed = row(); failed.parsed.transactionStatus = "ERROR";
    const failedTx = new HeliusParsedEventsProvider("key", "https://example.invalid", {
      fetchFn: fetchStub(json({ data: [failed] })), maxRetries: 0,
    });
    const got = await failedTx.getTrades(W);
    expect(got.trades).toHaveLength(0);
    expect(got.diagnostics).toMatchObject({ status: "COMPLETE", failedTransactions: 1 });
  });

  it("does not classify transactions with unknown status or malformed quantities", async () => {
    const unknownStatus = { ...row(SIG), parsed: { ...row(SIG).parsed, transactionStatus: "UNKNOWN" } };
    const malformedQty = row(SIG2);
    malformedQty.parsed.tokenTransfers[1]!.tokenAmount = Number.NaN;
    const provider = new HeliusParsedEventsProvider("key", "https://example.invalid", {
      fetchFn: fetchStub(json({ data: [unknownStatus, malformedQty] })), maxRetries: 0,
    });
    const got = await provider.getTrades(W);
    expect(got.trades).toHaveLength(0);
    expect(got.diagnostics).toMatchObject({ status: "PARTIAL", unknownEvents: 1, rejected: 1 });
    const enhanced = new HeliusEnhancedTransactionsProvider("key", "https://example.invalid", {
      fetchFn: fetchStub(json([{ signature: SIG, transactionStatus: "UNKNOWN", timestamp: 1_700_000_000,
        type: "SWAP", tokenTransfers: [
          { fromUserAccount: W, toUserAccount: null, mint: USDC, tokenAmount: 1 },
          { fromUserAccount: null, toUserAccount: W, mint: JUP, tokenAmount: 10 },
        ] }])), maxRetries: 0,
    });
    const enhancedGot = await enhanced.getTrades(W);
    expect(enhancedGot.trades).toHaveLength(0);
    expect(enhancedGot.diagnostics).toMatchObject({ status: "PARTIAL", unknownEvents: 1 });
  });

  it("rejects NaN and infinite pagination bounds before requesting a page", async () => {
    const fetchFn = fetchStub(json({ data: [] }));
    const badPages = new HeliusParsedEventsProvider("key", "https://example.invalid", { fetchFn, maxPages: NaN });
    await expect(badPages.getTrades(W)).rejects.toMatchObject({ kind: "invalid-options" });
    const badEvents = new HeliusEnhancedTransactionsProvider("key", "https://example.invalid", { fetchFn, maxEvents: Infinity });
    await expect(badEvents.getTrades(W)).rejects.toMatchObject({ kind: "invalid-options" });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("caps provider in-flight work at 32 with a safe failure reason", async () => {
    const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
    const fetchFn = vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    }));
    const provider = new HeliusParsedEventsProvider("key", "https://example.invalid", { fetchFn, timeoutMs: 2_000, maxRetries: 0 });
    const controllers = Array.from({ length: 32 }, () => new AbortController());
    const active = controllers.map((controller, index) => provider.getTrades("1".repeat(31) + alphabet[index], { signal: controller.signal }));
    const saturated = await provider.getTrades("1".repeat(31) + alphabet[32]);
    expect(saturated.diagnostics).toMatchObject({ status: "FAILED", reason: "provider-saturated" });
    controllers.forEach((controller) => controller.abort());
    await Promise.allSettled(active);
  });

  it("only falls back on parsed endpoint unavailability", async () => {
    const enhancedFetch = fetchStub(json([]));
    const enhanced = new HeliusEnhancedTransactionsProvider("key", "https://example.invalid", { fetchFn: enhancedFetch, maxRetries: 0 });
    const parsedMissing = new HeliusParsedEventsProvider("key", "https://example.invalid", { fetchFn: fetchStub(json({}, 404)), maxRetries: 0 });
    await new CompositeHeliusHistoryProvider(parsedMissing, enhanced).getTrades(W);
    expect(enhancedFetch).toHaveBeenCalledTimes(1);
    const parsedEmpty = new HeliusParsedEventsProvider("key", "https://example.invalid", { fetchFn: fetchStub(json({ data: [] })), maxRetries: 0 });
    await new CompositeHeliusHistoryProvider(parsedEmpty, enhanced).getTrades(W);
    expect(enhancedFetch).toHaveBeenCalledTimes(1);
    const parsedMalformed = new HeliusParsedEventsProvider("key", "https://example.invalid", { fetchFn: fetchStub(json({ error: "bad" })), maxRetries: 0 });
    await new CompositeHeliusHistoryProvider(parsedMalformed, enhanced).getTrades(W);
    expect(enhancedFetch).toHaveBeenCalledTimes(1);
  });

  it("uses the last enhanced signature as before cursor and reports capped history", async () => {
    const first = Array.from({ length: 100 }, () => ({ signature: SIG, timestamp: 1_700_000_000,
      type: "TRANSFER", tokenTransfers: [] }));
    const fetchFn = fetchStub(json(first), json([]));
    const provider = new HeliusEnhancedTransactionsProvider("key", "https://example.invalid", { fetchFn, maxRetries: 0 });
    const got = await provider.getTrades(W);
    expect(got.diagnostics).toMatchObject({ status: "COMPLETE", pages: 2, received: 100, duplicates: 99 });
    expect(String(fetchFn.mock.calls[1]?.[0])).toContain(`before=${SIG}`);
    const capped = new HeliusEnhancedTransactionsProvider("key", "https://example.invalid", {
      fetchFn: fetchStub(json(first)), maxPages: 1, maxRetries: 0,
    });
    expect((await capped.getTrades(W)).diagnostics).toMatchObject({ status: "PARTIAL", reason: "page-cap" });
  });

  it("preserves caller cancellation as an error", async () => {
    const controller = new AbortController(); controller.abort();
    const provider = new HeliusParsedEventsProvider("key", "https://example.invalid");
    await expect(provider.getTrades(W, { signal: controller.signal })).rejects.toMatchObject({ kind: "aborted" });
  });
});
