import { describe, it, expect } from "vitest";
import {
  parseHeliusEnhancedTx,
  parseParsedEventsItem,
  dedupeTrades,
  normalizeStreamMessage,
  classifyWalletActivity,
  tradesAsOf,
} from "@sat/solana";
import { JUP, USDC, WSOL } from "@sat/shared";
import { closeRoundTrips, lotAudit } from "@sat/wallet-intel";
import { DEMO_WALLETS } from "@sat/wallet-intel";
import { buildSentinelSignals } from "@sat/signals";
import { getDemoCandidates } from "@sat/shared";
import { listDemoWalletScores } from "@sat/wallet-intel";
import { isLiveTradingAllowed } from "@sat/shared";

const W = DEMO_WALLETS.SMART_A;
const OTHER = DEMO_WALLETS.SMART_B;

function parsedSwap(sig: string, t: number, inputMint: string, outputMint: string, inAmt: number, outAmt: number) {
  return {
    signature: sig,
    parserStatus: "OK",
    parsed: {
      slot: 1,
      blockTime: t,
      fee: 5000,
      feePayer: W,
      transactionStatus: "OK",
      error: null,
      nativeTransfers: [],
      tokenTransfers: [
        {
          fromUserAccount: W,
          toUserAccount: OTHER,
          mint: inputMint,
          rawTokenAmount: inAmt,
          decimals: 6,
        },
        {
          fromUserAccount: OTHER,
          toUserAccount: W,
          mint: outputMint,
          rawTokenAmount: outAmt,
          decimals: 6,
        },
      ],
      summary: {
        type: "swap",
        parsedData: {
          protocol: "jupiter",
          input_mint: inputMint,
          output_mint: outputMint,
          in_amount: String(inAmt),
          actual_out_amount: String(outAmt),
          inner_swaps: [],
        },
      },
      instructions: [{ programId: "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4" }],
    },
  };
}

describe("golden fixture matrix", () => {
  it("1 USDC → token BUY", () => {
    const t = parseParsedEventsItem(W, parsedSwap("s1", 1_700_000_001, USDC, JUP, 1_000_000, 500_000_000));
    expect(t.map((x) => x.side)).toEqual(["BUY"]);
    expect(t[0]?.mint).toBe(JUP);
  });

  it("2 token → USDC SELL", () => {
    const t = parseParsedEventsItem(W, parsedSwap("s2", 1_700_000_002, JUP, USDC, 500_000_000, 1_100_000));
    expect(t.map((x) => x.side)).toEqual(["SELL"]);
  });

  it("3 SOL → token BUY via WSOL mint", () => {
    const t = parseParsedEventsItem(W, parsedSwap("s3", 1_700_000_003, WSOL, JUP, 1_000_000_000, 10));
    expect(t[0]?.side).toBe("BUY");
  });

  it("4 token → SOL SELL", () => {
    const t = parseParsedEventsItem(W, parsedSwap("s4", 1_700_000_004, JUP, WSOL, 10, 1_000_000_000));
    expect(t[0]?.side).toBe("SELL");
  });

  it("5 WSOL Jupiter swap (enhanced shape)", () => {
    const t = parseHeliusEnhancedTx(W, {
      signature: "s5",
      timestamp: 1_700_000_005,
      type: "SWAP",
      source: "JUPITER",
      events: {
        swap: {
          nativeInput: { account: W, amount: "1000000000" },
          tokenOutputs: [{ userAccount: W, mint: JUP, tokenAmount: 8 }],
        },
      },
    });
    expect(t[0]?.side).toBe("BUY");
  });

  it("6 token → token swap", () => {
    const BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
    const t = parseParsedEventsItem(W, parsedSwap("s6", 1_700_000_006, JUP, BONK, 10, 20));
    expect(t.map((x) => x.side).sort()).toEqual(["BUY", "SELL"]);
  });

  it("7 routed Jupiter swap with inner mints still BUY output", () => {
    const row = parsedSwap("s7", 1_700_000_007, WSOL, JUP, 1e9, 5);
    (row.parsed.summary.parsedData as { inner_swaps: unknown[] }).inner_swaps = [
      { input_mint: WSOL, output_mint: USDC },
      { input_mint: USDC, output_mint: JUP },
    ];
    const t = parseParsedEventsItem(W, row);
    expect(t.some((x) => x.side === "BUY" && x.mint === JUP)).toBe(true);
  });

  it("8 simple incoming transfer is not a buy", () => {
    const t = parseHeliusEnhancedTx(W, {
      signature: "s8",
      timestamp: 1_700_000_008,
      type: "TRANSFER",
      tokenTransfers: [{ mint: JUP, tokenAmount: 1, fromUserAccount: OTHER, toUserAccount: W }],
    });
    expect(t[0]?.side).toBe("TRANSFER_IN");
  });

  it("9 simple outgoing transfer is not a sell-trade", () => {
    const t = parseHeliusEnhancedTx(W, {
      signature: "s9",
      timestamp: 1_700_000_009,
      type: "TRANSFER",
      tokenTransfers: [{ mint: JUP, tokenAmount: 1, fromUserAccount: W, toUserAccount: OTHER }],
    });
    expect(t[0]?.side).toBe("TRANSFER_OUT");
  });

  it("10 swap plus unrelated transfer keeps swap BUY and extra TRANSFER_IN", () => {
    const row = parsedSwap("s10", 1_700_000_010, USDC, JUP, 1_000_000, 10);
    const extra = "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm";
    row.parsed.tokenTransfers.push({
      fromUserAccount: OTHER,
      toUserAccount: W,
      mint: extra,
      rawTokenAmount: 3,
      decimals: 6,
    });
    const t = parseParsedEventsItem(W, row);
    expect(t.some((x) => x.side === "BUY" && x.mint === JUP)).toBe(true);
    expect(t.some((x) => x.side === "TRANSFER_IN" && x.mint === extra)).toBe(true);
  });

  it("11 failed transaction yields no trades", () => {
    const t = parseHeliusEnhancedTx(W, {
      signature: "s11",
      timestamp: 1_700_000_011,
      type: "SWAP",
      transactionError: { err: "InstructionError" },
      events: { swap: { tokenInputs: [], tokenOutputs: [] } },
    });
    expect(t).toEqual([]);
  });

  it("12-13 unpriced BUY then SELL closes a lot without P&L", () => {
    const buy = parseParsedEventsItem(W, parsedSwap("s12", 1_700_000_012, USDC, JUP, 1_000_000, 10));
    const sell = parseParsedEventsItem(W, parsedSwap("s13", 1_700_000_013, JUP, USDC, 10, 1_000_000));
    const closed = closeRoundTrips([...buy, ...sell]);
    expect(closed).toHaveLength(1);
    expect(closed[0]?.priced).toBe(false);
    expect(closed[0]?.pnlUsd).toBe(0);
    expect(lotAudit([...buy, ...sell]).realizedPnlUsd).toBeNull();
  });

  it("14 duplicate ingestion is idempotent", () => {
    const one = parseParsedEventsItem(W, parsedSwap("s14", 1_700_000_014, USDC, JUP, 1, 1));
    const { trades, duplicates } = dedupeTrades([...one, ...one, ...one]);
    expect(trades).toHaveLength(1);
    expect(duplicates).toBe(2);
  });

  it("15 out-of-order timestamps still close FIFO after sort", () => {
    const sell = parseParsedEventsItem(W, parsedSwap("s15b", 1_700_000_020, JUP, USDC, 10, 1));
    const buy = parseParsedEventsItem(W, parsedSwap("s15a", 1_700_000_015, USDC, JUP, 1, 10));
    const closed = closeRoundTrips([...sell, ...buy]);
    expect(closed).toHaveLength(1);
  });

  it("16 malformed provider response is empty", () => {
    expect(parseParsedEventsItem(W, null)).toEqual([]);
    expect(parseParsedEventsItem(W, { parserStatus: "ERROR", signature: "x" })).toEqual([]);
  });

  it("17 unknown program without swap is a transfer if deltas exist", () => {
    const t = parseParsedEventsItem(W, {
      signature: "s17",
      parserStatus: "OK",
      parsed: {
        blockTime: 1_700_000_017,
        transactionStatus: "OK",
        summary: { type: "transfer" },
        nativeTransfers: [],
        tokenTransfers: [
          { fromUserAccount: OTHER, toUserAccount: W, mint: JUP, rawTokenAmount: 1, decimals: 6 },
        ],
        instructions: [{ programId: "Unknown1111111111111111111111111111111111111" }],
      },
    });
    expect(t[0]?.side).toBe("TRANSFER_IN");
  });

  it("18 dust is ignored", () => {
    const t = parseParsedEventsItem(W, parsedSwap("s18", 1_700_000_018, USDC, JUP, 1, 0));
    expect(t.filter((x) => x.side === "BUY")).toHaveLength(0);
  });

  it("19 wrap/unwrap SOL (quote→quote) is not a BUY", () => {
    const t = parseParsedEventsItem(W, parsedSwap("s19", 1_700_000_019, WSOL, WSOL, 1e9, 1e9));
    expect(t.filter((x) => x.side === "BUY" || x.side === "SELL")).toEqual([]);
  });

  it("20 parsed-stream messages use the same classifier", () => {
    const ev = normalizeStreamMessage(parsedSwap("s20", 1_700_000_020, USDC, JUP, 1_000_000, 4), W);
    expect(ev?.provider).toBe("helius-parsed-stream");
    const trades = classifyWalletActivity(ev!, W);
    expect(trades[0]?.side).toBe("BUY");
  });
});

describe("lot accounting FIFO", () => {
  it("BUY BUY SELL consumes first lot first", () => {
    const mk = (sig: string, t: number, side: "BUY" | "SELL", qty: number, px: number) =>
      parseHeliusEnhancedTx(W, {
        signature: sig,
        timestamp: t,
        type: "SWAP",
        events: {
          swap:
            side === "BUY"
              ? {
                  tokenInputs: [{ userAccount: W, mint: USDC, tokenAmount: qty * px }],
                  tokenOutputs: [{ userAccount: W, mint: JUP, tokenAmount: qty }],
                }
              : {
                  tokenInputs: [{ userAccount: W, mint: JUP, tokenAmount: qty }],
                  tokenOutputs: [{ userAccount: W, mint: USDC, tokenAmount: qty * px }],
                },
        },
      }).map((tr) => ({ ...tr, priceUsd: px, usdNotional: qty * px, costBasis: "PRICED" as const }));
    const trades = [
      ...mk("b1", 1_700_000_100, "BUY", 2, 1),
      ...mk("b2", 1_700_000_101, "BUY", 2, 2),
      ...mk("s1", 1_700_000_102, "SELL", 2, 3),
    ];
    const closed = closeRoundTrips(trades);
    expect(closed[0]?.priced).toBe(true);
    expect(closed[0]?.pnlUsd).toBeGreaterThan(0);
  });

  it("transfer in then SELL does not invent cost basis", () => {
    const tin = parseHeliusEnhancedTx(W, {
      signature: "tin",
      timestamp: 1_700_000_200,
      type: "TRANSFER",
      tokenTransfers: [{ mint: JUP, tokenAmount: 5, fromUserAccount: OTHER, toUserAccount: W }],
    });
    const sell = parseParsedEventsItem(W, parsedSwap("tsell", 1_700_000_201, JUP, USDC, 5, 5));
    const closed = closeRoundTrips([...tin, ...sell]);
    expect(closed).toHaveLength(0);
  });
});

describe("signal determinism and safety", () => {
  it("identical inputs produce identical signal ids", () => {
    const asset = getDemoCandidates().find((c) => c.symbol === "JUP")!;
    const wallets = listDemoWalletScores().map((w) => ({ ...w, assessedAt: "2025-12-31T23:59:00.000Z" }));
    const walletFlowEvidence = [{ wallet: DEMO_WALLETS.SMART_B, mint: asset.mint, signature: "proof", side: "BUY" as const, qty: 1, timestamp: "2025-12-31T23:59:00.000Z", provider: "fixture", freshness: "DEMO" as const, isDemo: true }];
    const marketSignals = [
      { name: "momentum", value: 4, normalizedScore: 0.4, confidence: 0.8, source: "t", timestamp: "2026-01-01T00:00:00.000Z" },
      { name: "volume", value: 3, normalizedScore: 0.3, confidence: 0.7, source: "t", timestamp: "2026-01-01T00:00:00.000Z" },
      { name: "liquidity", value: 1, normalizedScore: 0.2, confidence: 0.7, source: "t", timestamp: "2026-01-01T00:00:00.000Z" },
    ];
    const a = buildSentinelSignals({
      asset,
      marketSignals,
      wallets,
      walletFlowEvidence,
      tokenRiskTier: "LOWER_RISK",
      tokenRiskScore: 20,
      asOf: "2026-01-01T00:00:00.000Z",
    });
    const b = buildSentinelSignals({
      asset,
      marketSignals,
      wallets,
      walletFlowEvidence,
      tokenRiskTier: "LOWER_RISK",
      tokenRiskScore: 20,
      asOf: "2026-01-01T00:00:00.000Z",
    });
    expect(a.map((s) => s.id)).toEqual(b.map((s) => s.id));
    expect(a[0]?.provenance.some((p) => p.startsWith("wallet:"))).toBe(true);
  });

  it("live broadcast remains disabled", () => {
    expect(isLiveTradingAllowed()).toBe(false);
  });

  it("replay as-of drops later trades", () => {
    const buy = parseParsedEventsItem(W, parsedSwap("r1", 1_700_000_100, USDC, JUP, 1_000_000, 10));
    const sell = parseParsedEventsItem(W, parsedSwap("r2", 1_700_000_200, JUP, USDC, 10, 1_000_000));
    const asOf = tradesAsOf([...buy, ...sell], 1_700_000_100 * 1000);
    expect(asOf.some((t) => t.side === "SELL")).toBe(false);
    expect(asOf.some((t) => t.side === "BUY")).toBe(true);
  });
});
