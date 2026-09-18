import { type WalletTrade, WalletTradeSchema, SolanaAddressSchema, USDC, WSOL } from "@sat/shared";

/** USDT on Solana mainnet. */
export const USDT = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";

const QUOTE_MINTS = new Set([USDC, USDT, WSOL]);

export function isQuoteMint(mint: string): boolean {
  return QUOTE_MINTS.has(mint);
}

interface TokenLeg {
  mint: string;
  qty: number;
  account: string;
}

function qtyFromRaw(raw: unknown): number {
  if (raw == null) return 0;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string") {
    const n = Number(raw);
    return Number.isFinite(n) ? n : 0;
  }
  if (typeof raw === "object") {
    const rec = raw as { tokenAmount?: unknown; amount?: unknown; uiAmount?: unknown };
    if (rec.uiAmount != null) return qtyFromRaw(rec.uiAmount);
    if (rec.tokenAmount != null) return qtyFromRaw(rec.tokenAmount);
    if (rec.amount != null) return qtyFromRaw(rec.amount);
  }
  return 0;
}

function mintOk(mint: unknown): string | null {
  const p = SolanaAddressSchema.safeParse(mint);
  return p.success ? p.data : null;
}

function legsFromSwapEvent(swap: Record<string, unknown>, wallet: string): { ins: TokenLeg[]; outs: TokenLeg[] } {
  const ins: TokenLeg[] = [];
  const outs: TokenLeg[] = [];
  const nativeIn = swap.nativeInput as { account?: string; amount?: unknown } | undefined;
  const nativeOut = swap.nativeOutput as { account?: string; amount?: unknown } | undefined;
  if (nativeIn?.account === wallet) {
    ins.push({ mint: WSOL, qty: qtyFromRaw(nativeIn.amount) / 1e9, account: wallet });
  }
  if (nativeOut?.account === wallet) {
    outs.push({ mint: WSOL, qty: qtyFromRaw(nativeOut.amount) / 1e9, account: wallet });
  }
  const tokenIns = Array.isArray(swap.tokenInputs) ? swap.tokenInputs : [];
  const tokenOuts = Array.isArray(swap.tokenOutputs) ? swap.tokenOutputs : [];
  for (const t of tokenIns) {
    if (!t || typeof t !== "object") continue;
    const rec = t as { userAccount?: string; mint?: string; rawTokenAmount?: unknown; tokenAmount?: unknown };
    if (rec.userAccount !== wallet) continue;
    const mint = mintOk(rec.mint);
    if (!mint) continue;
    ins.push({ mint, qty: qtyFromRaw(rec.rawTokenAmount ?? rec.tokenAmount), account: wallet });
  }
  for (const t of tokenOuts) {
    if (!t || typeof t !== "object") continue;
    const rec = t as { userAccount?: string; mint?: string; rawTokenAmount?: unknown; tokenAmount?: unknown };
    if (rec.userAccount !== wallet) continue;
    const mint = mintOk(rec.mint);
    if (!mint) continue;
    outs.push({ mint, qty: qtyFromRaw(rec.rawTokenAmount ?? rec.tokenAmount), account: wallet });
  }
  return { ins, outs };
}

function legsFromTransfers(
  tokenTransfers: unknown,
  nativeTransfers: unknown,
  wallet: string,
): { ins: TokenLeg[]; outs: TokenLeg[] } {
  const ins: TokenLeg[] = [];
  const outs: TokenLeg[] = [];
  const tokens = Array.isArray(tokenTransfers) ? tokenTransfers : [];
  for (const t of tokens) {
    if (!t || typeof t !== "object") continue;
    const rec = t as {
      mint?: string;
      tokenAmount?: unknown;
      fromUserAccount?: string;
      toUserAccount?: string;
    };
    const mint = mintOk(rec.mint);
    if (!mint) continue;
    const qty = qtyFromRaw(rec.tokenAmount);
    if (rec.toUserAccount === wallet) ins.push({ mint, qty, account: wallet });
    if (rec.fromUserAccount === wallet) outs.push({ mint, qty, account: wallet });
  }
  const natives = Array.isArray(nativeTransfers) ? nativeTransfers : [];
  for (const t of natives) {
    if (!t || typeof t !== "object") continue;
    const rec = t as { fromUserAccount?: string; toUserAccount?: string; amount?: unknown };
    const qty = qtyFromRaw(rec.amount) / 1e9;
    if (rec.toUserAccount === wallet) ins.push({ mint: WSOL, qty, account: wallet });
    if (rec.fromUserAccount === wallet) outs.push({ mint: WSOL, qty, account: wallet });
  }
  return { ins, outs };
}

function mk(
  signature: string,
  timestamp: string,
  mint: string,
  side: "BUY" | "SELL",
  qty: number,
): WalletTrade | null {
  const parsed = WalletTradeSchema.safeParse({
    signature: `${signature}:${side}:${mint.slice(0, 8)}`,
    timestamp,
    mint,
    side,
    usdNotional: 0,
    qty,
    priceUsd: null,
    tokenAgeHoursAtEntry: null,
    liquidityUsdAtEntry: null,
    slippageBps: null,
    counterparty: null,
    isDemo: false,
  });
  return parsed.success ? parsed.data : null;
}

/**
 * Classify a Helius enhanced-tx (or Parsed Events-shaped) row.
 * BUY/SELL only when a swap is evidenced. Plain transfers stay TRANSFER_*.
 */
export function parseHeliusEnhancedTx(wallet: string, row: unknown): WalletTrade[] {
  if (!row || typeof row !== "object") return [];
  const tx = row as {
    signature?: string;
    timestamp?: number;
    type?: string;
    tokenTransfers?: unknown;
    nativeTransfers?: unknown;
    events?: { swap?: Record<string, unknown> };
    parsed?: { summary?: { type?: string } };
  };
  const ts =
    typeof tx.timestamp === "number" ? new Date(tx.timestamp * 1000).toISOString() : new Date().toISOString();
  const sig = String(tx.signature ?? `${wallet}:${ts}`);
  const type = String(tx.type ?? tx.parsed?.summary?.type ?? "").toUpperCase();
  const swapEvent = tx.events?.swap;
  const isSwap = Boolean(swapEvent) || type === "SWAP";

  if (isSwap) {
    const { ins, outs } = swapEvent
      ? legsFromSwapEvent(swapEvent, wallet)
      : legsFromTransfers(tx.tokenTransfers, tx.nativeTransfers, wallet);
    const soldAssets = ins.filter((l) => !isQuoteMint(l.mint));
    const boughtAssets = outs.filter((l) => !isQuoteMint(l.mint));
    const soldQuote = ins.some((l) => isQuoteMint(l.mint));
    const boughtQuote = outs.some((l) => isQuoteMint(l.mint));
    const trades: WalletTrade[] = [];
    if (soldQuote && boughtAssets.length) {
      for (const b of boughtAssets) {
        const rowT = mk(sig, ts, b.mint, "BUY", b.qty);
        if (rowT) trades.push(rowT);
      }
      return trades;
    }
    if (boughtQuote && soldAssets.length) {
      for (const s of soldAssets) {
        const rowT = mk(sig, ts, s.mint, "SELL", s.qty);
        if (rowT) trades.push(rowT);
      }
      return trades;
    }
    if (soldAssets.length && boughtAssets.length) {
      for (const s of soldAssets) {
        const rowT = mk(sig, ts, s.mint, "SELL", s.qty);
        if (rowT) trades.push(rowT);
      }
      for (const b of boughtAssets) {
        const rowT = mk(sig, ts, b.mint, "BUY", b.qty);
        if (rowT) trades.push(rowT);
      }
      return trades;
    }
    return trades;
  }

  const transfers: WalletTrade[] = [];
  const tokens = Array.isArray(tx.tokenTransfers) ? tx.tokenTransfers : [];
  for (const t of tokens) {
    if (!t || typeof t !== "object") continue;
    const rec = t as {
      mint?: string;
      tokenAmount?: unknown;
      fromUserAccount?: string;
      toUserAccount?: string;
    };
    const mint = mintOk(rec.mint);
    if (!mint) continue;
    const inbound = rec.toUserAccount === wallet;
    const outbound = rec.fromUserAccount === wallet;
    const side = inbound ? "TRANSFER_IN" : outbound ? "TRANSFER_OUT" : "UNKNOWN";
    if (side === "UNKNOWN") continue;
    const parsed = WalletTradeSchema.safeParse({
      signature: sig,
      timestamp: ts,
      mint,
      side,
      usdNotional: 0,
      qty: qtyFromRaw(rec.tokenAmount),
      priceUsd: null,
      tokenAgeHoursAtEntry: null,
      liquidityUsdAtEntry: null,
      slippageBps: null,
      counterparty: inbound ? rec.fromUserAccount : rec.toUserAccount,
      isDemo: false,
    });
    if (parsed.success) transfers.push(parsed.data);
  }
  return transfers;
}
