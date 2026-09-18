import { describe, it, expect } from "vitest";
import { parseHeliusEnhancedTx, isQuoteMint } from "@sat/solana";
import { JUP, USDC, WSOL, getDemoCandidates } from "@sat/shared";
import { closeRoundTrips } from "@sat/wallet-intel";
import { DEMO_WALLETS } from "@sat/wallet-intel";

const WALLET = DEMO_WALLETS.SMART_A;

describe("Helius SWAP parsing", () => {
  it("does not treat a plain transfer as a buy", () => {
    const trades = parseHeliusEnhancedTx(WALLET, {
      signature: "sig-transfer",
      timestamp: 1_700_000_000,
      type: "TRANSFER",
      tokenTransfers: [
        {
          mint: JUP,
          tokenAmount: 10,
          fromUserAccount: "Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS",
          toUserAccount: WALLET,
        },
      ],
    });
    expect(trades).toHaveLength(1);
    expect(trades[0]?.side).toBe("TRANSFER_IN");
  });

  it("maps quote-out / token-in swap to BUY", () => {
    const trades = parseHeliusEnhancedTx(WALLET, {
      signature: "sig-buy",
      timestamp: 1_700_000_100,
      type: "SWAP",
      source: "JUPITER",
      events: {
        swap: {
          tokenInputs: [
            {
              userAccount: WALLET,
              mint: USDC,
              rawTokenAmount: { tokenAmount: "1000000", decimals: 6 },
            },
          ],
          tokenOutputs: [
            {
              userAccount: WALLET,
              mint: JUP,
              rawTokenAmount: { tokenAmount: "500000000", decimals: 6 },
            },
          ],
        },
      },
    });
    expect(trades.map((t) => t.side)).toEqual(["BUY"]);
    expect(trades[0]?.mint).toBe(JUP);
    expect(trades[0]?.qty).toBeGreaterThan(0);
  });

  it("maps token-out / quote-in swap to SELL", () => {
    const trades = parseHeliusEnhancedTx(WALLET, {
      signature: "sig-sell",
      timestamp: 1_700_000_200,
      type: "SWAP",
      events: {
        swap: {
          nativeOutput: { account: WALLET, amount: "150000000" },
          tokenInputs: [
            {
              userAccount: WALLET,
              mint: JUP,
              rawTokenAmount: { tokenAmount: "400000000", decimals: 6 },
            },
          ],
        },
      },
    });
    expect(trades.map((t) => t.side)).toEqual(["SELL"]);
    expect(trades[0]?.mint).toBe(JUP);
    expect(isQuoteMint(WSOL)).toBe(true);
  });

  it("closes unpriced BUY/SELL lots by quantity", () => {
    const buy = parseHeliusEnhancedTx(WALLET, {
      signature: "a",
      timestamp: 1_700_000_000,
      type: "SWAP",
      events: {
        swap: {
          tokenInputs: [{ userAccount: WALLET, mint: USDC, tokenAmount: 10 }],
          tokenOutputs: [{ userAccount: WALLET, mint: JUP, tokenAmount: 5 }],
        },
      },
    });
    const sell = parseHeliusEnhancedTx(WALLET, {
      signature: "b",
      timestamp: 1_700_000_800,
      type: "SWAP",
      events: {
        swap: {
          tokenInputs: [{ userAccount: WALLET, mint: JUP, tokenAmount: 5 }],
          tokenOutputs: [{ userAccount: WALLET, mint: USDC, tokenAmount: 12 }],
        },
      },
    });
    const closed = closeRoundTrips([...buy, ...sell]);
    expect(closed).toHaveLength(1);
    expect(closed[0]?.priced).toBe(false);
    expect(closed[0]?.holdingHours).toBeGreaterThan(0);
    expect(getDemoCandidates()[0]?.mint).toBeTruthy();
  });

  it("does not invent BUY from SWAP that does not involve the wallet", () => {
    const other = "Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS";
    const trades = parseHeliusEnhancedTx(WALLET, {
      signature: "sig-other",
      timestamp: 1_700_000_000,
      type: "SWAP",
      events: {
        swap: {
          tokenInputs: [{ userAccount: other, mint: USDC, tokenAmount: 1 }],
          tokenOutputs: [{ userAccount: other, mint: JUP, tokenAmount: 1 }],
        },
      },
    });
    expect(trades).toEqual([]);
  });
});
