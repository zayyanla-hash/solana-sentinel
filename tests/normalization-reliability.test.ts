import { describe, expect, it } from "vitest";
import { JUP, USDC } from "@sat/shared";
import { DEMO_WALLETS } from "@sat/wallet-intel";
import { classifyWalletActivity, dedupeTrades, normalizeEnhancedTx, normalizeParsedEventsItem, parseHeliusEnhancedTx } from "@sat/solana";

const W = DEMO_WALLETS.SMART_A;
function swap() {
  return { signature: "synthetic", timestamp: 1_700_000_000, type: "SWAP", events: { swap: {
    tokenInputs: [{ userAccount: W, mint: USDC, rawTokenAmount: { tokenAmount: "1000000", decimals: 6 } }],
    tokenOutputs: [{ userAccount: W, mint: JUP, rawTokenAmount: { tokenAmount: "500000000", decimals: 6 } }],
  } } };
}

describe("normalization rejects malformed evidence without poisoning other rows", () => {
  it("preserves exact nested raw quantity instead of treating it as UI units", () => {
    expect(parseHeliusEnhancedTx(W, swap())[0]?.qty).toBe(500);
  });
  it.each([-1, 1.5, 256, "bad", null])("rejects invalid or missing raw decimals %s", (decimals) => {
    const row = swap();
    (row.events.swap.tokenOutputs[0]!.rawTokenAmount as { decimals: unknown }).decimals = decimals;
    expect(normalizeEnhancedTx(row, W)).toBeNull();
  });
  it.each([0, 9, 19, 255])("supports valid SPL decimal count %s", (decimals) => {
    const row = swap();
    row.events.swap.tokenOutputs[0]!.rawTokenAmount.decimals = decimals;
    expect(normalizeEnhancedTx(row, W)?.tokenDeltas.find((t) => t.mint === JUP)?.qty).toBe(500000000 / 10 ** decimals);
  });
  it.each(["NaN", "Infinity", "-1", "2.2", "", "0xFF"])("rejects malformed raw amount %s", (amount) => {
    const row = swap();
    row.events.swap.tokenOutputs[0]!.rawTokenAmount.tokenAmount = amount;
    expect(normalizeEnhancedTx(row, W)).toBeNull();
  });
  it("rejects malformed transfer or mint rather than dropping evidence and changing the net", () => {
    const row = { ...swap(), tokenTransfers: [{ mint: "bad", tokenAmount: 4, toUserAccount: W }] };
    expect(normalizeEnhancedTx(row, W)).toBeNull();
    expect(normalizeParsedEventsItem({ signature: "x", parsed: { blockTime: 1_700_000_000, nativeTransfers: [{ amount: {} }] } }, W)).toBeNull();
  });
  it("a null transfer alongside a valid swap rejects the transaction rather than silently changing its net", () => {
    expect(normalizeEnhancedTx({ ...swap(), tokenTransfers: [null, { mint: JUP, tokenAmount: 1, toUserAccount: W }] }, W)).toBeNull();
    expect(normalizeEnhancedTx({ ...swap(), nativeTransfers: { unexpected: "container" } }, W)).toBeNull();
  });
  it("handles seconds and milliseconds consistently", () => {
    const row = swap();
    const seconds = parseHeliusEnhancedTx(W, row);
    row.timestamp *= 1000;
    expect(parseHeliusEnhancedTx(W, row)[0]?.timestamp).toBe(seconds[0]?.timestamp);
  });
  it("does not classify missing, unknown, or failed transaction evidence", () => {
    const ev = normalizeEnhancedTx(swap(), W)!;
    expect(classifyWalletActivity({ ...ev, status: "UNKNOWN" }, W)).toEqual([]);
    expect(classifyWalletActivity({ ...ev, blockTime: null }, W)).toEqual([]);
    expect(classifyWalletActivity({ ...ev, blockTime: Number.MAX_VALUE }, W)).toEqual([]);
    expect(parseHeliusEnhancedTx(W, { ...swap(), error: { code: "failed" } })).toEqual([]);
  });
  it("rejects an invalid row but preserves a valid sibling", () => {
    const rows = [null, { signature: "x", timestamp: 1.5 }, swap()];
    expect(rows.flatMap((r) => parseHeliusEnhancedTx(W, r))).toHaveLength(1);
  });
  it("transaction legs have full-mint identities even when mints share an eight-character prefix", () => {
    const ev = normalizeEnhancedTx(swap(), W)!;
    const other = JUP.slice(0, -1) + (JUP.endsWith("1") ? "2" : "1");
    const trades = classifyWalletActivity({ ...ev, summaryType: "transfer", swapHint: null, tokenDeltas: [
      { mint: JUP, qty: 1, raw: null, decimals: 0, from: null, to: W },
      { mint: other, qty: 1, raw: null, decimals: 0, from: null, to: W },
    ], nativeDeltas: [] }, W);
    expect(trades).toHaveLength(2);
    expect(new Set(trades.map((t) => t.signature)).size).toBe(2);
    expect(trades.every((t) => t.sourceSignature === ev.signature)).toBe(true);
  });
  it("identical duplicates suppress; conflicting facts quarantine the entire signature", () => {
    const trade = parseHeliusEnhancedTx(W, swap())[0]!;
    expect(dedupeTrades([trade, trade])).toMatchObject({ duplicates: 1, conflicts: 0, trades: [trade] });
    expect(dedupeTrades([trade, { ...trade, qty: trade.qty + 1 }])).toMatchObject({ trades: [], conflicts: 1 });
  });
});
