import {
  type NormalizedChainEvent,
  type WalletTrade,
  type ChainProviderName,
  NormalizedChainEventSchema,
  WalletTradeSchema,
  SolanaAddressSchema,
  USDC,
  WSOL,
} from "@sat/shared";
import { createHash } from "node:crypto";
const USDT = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";

const QUOTE = new Set([USDC, USDT, WSOL]);
const ATA_RENT = 2_039_280;
const DUST = 1e-9;

export function isQuoteMint(mint: string): boolean {
  return QUOTE.has(mint);
}

function mintOk(v: unknown): string | null {
  const p = SolanaAddressSchema.safeParse(v);
  return p.success ? p.data : null;
}

function num(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  throw new Error("invalid-numeric-field");
}

function tokenQty(rec: Record<string, unknown>): number {
  const nested = rec.rawTokenAmount;
  if (nested != null) {
    const n = typeof nested === "object" ? nested as Record<string, unknown> : rec;
    const raw = typeof nested === "object" ? n.tokenAmount : nested;
    const decimals = n.decimals;
    // Raw units are never silently reinterpreted as UI units.
    if (raw == null || decimals == null) throw new Error("missing-token-decimals");
    if (typeof raw === "string" ? !/^\d+$/.test(raw) : !Number.isSafeInteger(raw)) {
      throw new Error("invalid-raw-token-amount");
    }
    const d = num(decimals);
    if (!Number.isInteger(d) || d < 0 || d > 255) throw new Error("invalid-token-decimals");
    const qty = num(raw) / 10 ** d;
    if (qty < 0 || !Number.isFinite(qty) || (num(raw) > 0 && qty === 0)) throw new Error("invalid-token-quantity");
    return qty;
  }
  const qty = num(rec.tokenAmount ?? rec.uiAmount ?? rec.amount);
  if (qty < 0) throw new Error("invalid-token-quantity");
  return qty;
}

function tsIso(blockTime: number | null): string {
  const ms = blockTime && blockTime > 1e12 ? blockTime : (blockTime ?? 0) * 1000;
  const date = new Date(ms);
  return Number.isFinite(date.getTime()) ? date.toISOString() : new Date(0).toISOString();
}

export function normalizeParsedEventsItem(row: unknown, wallet: string | null): NormalizedChainEvent | null {
  try { return normalizeParsedEventsItemUnsafe(row, wallet); } catch { return null; }
}

function normalizeParsedEventsItemUnsafe(row: unknown, wallet: string | null): NormalizedChainEvent | null {
  if (!row || typeof row !== "object") return null;
  const env = row as {
    signature?: string;
    parserStatus?: string;
    parserError?: { message?: string };
    parsed?: Record<string, unknown>;
  };
  if (env.parserStatus && env.parserStatus !== "OK") {
    return NormalizedChainEventSchema.parse({
      signature: String(env.signature ?? "unknown"),
      slot: null,
      blockTime: null,
      wallet,
      status: "UNKNOWN",
      feeLamports: null,
      feePayer: null,
      programs: [],
      summaryType: null,
      nativeDeltas: [],
      tokenDeltas: [],
      swapHint: null,
      provider: "helius-parsed-events",
      parserStatus: "ERROR",
      warnings: [env.parserError?.message ?? "parserStatus ERROR"],
    });
  }
  const parsed = env.parsed;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  return fromParsedBody(String(env.signature ?? ""), parsed, wallet, "helius-parsed-events");
}

function fromParsedBody(
  signature: string,
  parsed: Record<string, unknown>,
  wallet: string | null,
  provider: ChainProviderName,
): NormalizedChainEvent {
  const summary = (parsed.summary ?? null) as {
    type?: string;
    parsedData?: Record<string, unknown> | null;
  } | null;
  const pd = summary?.parsedData ?? null;
  const instructions = Array.isArray(parsed.instructions) ? parsed.instructions : [];
  const programs = [
    ...new Set(
      instructions
        .map((i) => (i && typeof i === "object" ? String((i as { programId?: string }).programId ?? "") : ""))
        .filter(Boolean),
    ),
  ];
  if (parsed.nativeTransfers != null && !Array.isArray(parsed.nativeTransfers)) throw new Error("invalid-native-transfers");
  if (parsed.tokenTransfers != null && !Array.isArray(parsed.tokenTransfers)) throw new Error("invalid-token-transfers");
  const native = Array.isArray(parsed.nativeTransfers) ? parsed.nativeTransfers : [];
  const tokens = Array.isArray(parsed.tokenTransfers) ? parsed.tokenTransfers : [];
  let swapHint = null;
  const st = summary?.type ? String(summary.type).toLowerCase() : null;
  if (st === "swap" && pd) {
    const inputMint = mintOk(pd.input_mint ?? pd.inputMint);
    const outputMint = mintOk(pd.output_mint ?? pd.outputMint);
    if (inputMint && outputMint) {
      const inner = Array.isArray(pd.inner_swaps) ? pd.inner_swaps : [];
      const innerMints = inner.flatMap((x) => {
        if (!x || typeof x !== "object") return [];
        const r = x as { input_mint?: unknown; output_mint?: unknown };
        return [mintOk(r.input_mint), mintOk(r.output_mint)].filter((m): m is string => Boolean(m));
      });
      swapHint = {
        inputMint,
        outputMint,
        inAmount: pd.in_amount != null ? num(pd.in_amount) : null,
        outAmount: pd.actual_out_amount != null ? num(pd.actual_out_amount) : null,
        protocol: pd.protocol != null ? String(pd.protocol) : null,
        innerMints: [...new Set(innerMints)],
      };
    }
  }
  const failed =
    parsed.transactionStatus === "ERROR" || parsed.transactionStatus === "FAILED" || parsed.error != null || parsed.transactionError != null;
  const unknown = parsed.transactionStatus != null && parsed.transactionStatus !== "OK" && !failed;
  return NormalizedChainEventSchema.parse({
    signature,
    slot: parsed.slot == null ? null : num(parsed.slot),
    blockTime: parsed.blockTime == null && parsed.timestamp == null ? null : num(parsed.blockTime ?? parsed.timestamp),
    wallet,
    status: failed ? "FAILED" : unknown ? "UNKNOWN" : "OK",
    feeLamports: parsed.fee == null ? null : num(parsed.fee),
    feePayer: parsed.feePayer == null ? null : String(parsed.feePayer),
    programs,
    summaryType: st,
    nativeDeltas: native.flatMap((n) => {
      if (!n || typeof n !== "object" || Array.isArray(n)) throw new Error("invalid-native-transfer");
      const r = n as { fromUserAccount?: string | null; toUserAccount?: string | null; amount?: unknown };
      return [
        {
          from: r.fromUserAccount ?? null,
          to: r.toUserAccount ?? null,
          amountLamports: num(r.amount),
        },
      ];
    }),
    tokenDeltas: tokens.flatMap((t) => {
      if (!t || typeof t !== "object" || Array.isArray(t)) throw new Error("invalid-token-transfer");
      const r = t as Record<string, unknown>;
      const mint = mintOk(r.mint);
      if (!mint) throw new Error("invalid-token-mint");
      return [
        {
          mint,
          qty: tokenQty(r),
          raw: r.rawTokenAmount != null ? String(num(r.rawTokenAmount) || r.rawTokenAmount) : null,
          decimals: r.decimals == null ? null : num(r.decimals),
          from: r.fromUserAccount == null ? null : String(r.fromUserAccount),
          to: r.toUserAccount == null ? null : String(r.toUserAccount),
        },
      ];
    }),
    swapHint,
    provider,
    parserStatus: "OK",
    warnings: [],
  });
}

export function normalizeEnhancedTx(row: unknown, wallet: string | null): NormalizedChainEvent | null {
  try { return normalizeEnhancedTxUnsafe(row, wallet); } catch { return null; }
}

function normalizeEnhancedTxUnsafe(row: unknown, wallet: string | null): NormalizedChainEvent | null {
  if (!row || typeof row !== "object") return null;
  const tx = row as Record<string, unknown>;
  const signature = typeof tx.signature === "string" ? tx.signature : "";
  if (!signature) return null;
  const type = tx.type != null ? String(tx.type).toLowerCase() : null;
  const swap = tx.events && typeof tx.events === "object" ? (tx.events as { swap?: Record<string, unknown> }).swap : undefined;
  let swapHint = null;
  if (swap) {
    const ins = Array.isArray(swap.tokenInputs) ? swap.tokenInputs : [];
    const outs = Array.isArray(swap.tokenOutputs) ? swap.tokenOutputs : [];
    const nativeIn = swap.nativeInput as { account?: string; amount?: unknown } | undefined;
    const nativeOut = swap.nativeOutput as { account?: string; amount?: unknown } | undefined;
    const inMint =
      mintOk((ins[0] as { mint?: string } | undefined)?.mint) ?? (nativeIn ? WSOL : null);
    const outMint =
      mintOk((outs[0] as { mint?: string } | undefined)?.mint) ?? (nativeOut ? WSOL : null);
    if (inMint && outMint) {
      swapHint = {
        inputMint: inMint,
        outputMint: outMint,
        inAmount: null,
        outAmount: null,
        protocol: tx.source != null ? String(tx.source) : null,
        innerMints: [],
      };
    }
  }
  if (tx.tokenTransfers != null && !Array.isArray(tx.tokenTransfers)) throw new Error("invalid-token-transfers");
  if (tx.nativeTransfers != null && !Array.isArray(tx.nativeTransfers)) throw new Error("invalid-native-transfers");
  const tokens: unknown[] = Array.isArray(tx.tokenTransfers) ? [...tx.tokenTransfers] : [];
  const natives: unknown[] = Array.isArray(tx.nativeTransfers) ? [...tx.nativeTransfers] : [];
  if (swap) {
    const ins = Array.isArray(swap.tokenInputs) ? swap.tokenInputs : [];
    const outs = Array.isArray(swap.tokenOutputs) ? swap.tokenOutputs : [];
    if (!tokens.length) {
      for (const t of ins) {
        if (!t || typeof t !== "object" || Array.isArray(t)) throw new Error("invalid-token-transfer");
        const r = t as Record<string, unknown>;
        const mint = mintOk(r.mint);
        if (!mint) throw new Error("invalid-token-mint");
        tokens.push({
          mint,
          fromUserAccount: r.userAccount,
          toUserAccount: null,
          tokenAmount: tokenQty(r),
        });
      }
      for (const t of outs) {
        if (!t || typeof t !== "object" || Array.isArray(t)) throw new Error("invalid-token-transfer");
        const r = t as Record<string, unknown>;
        const mint = mintOk(r.mint);
        if (!mint) throw new Error("invalid-token-mint");
        tokens.push({
          mint,
          fromUserAccount: null,
          toUserAccount: r.userAccount,
          tokenAmount: tokenQty(r),
        });
      }
    }
    const nativeIn = swap.nativeInput as { account?: string; amount?: unknown } | undefined;
    const nativeOut = swap.nativeOutput as { account?: string; amount?: unknown } | undefined;
    if (!natives.length) {
      if (nativeIn) {
        natives.push({ fromUserAccount: nativeIn.account, toUserAccount: null, amount: nativeIn.amount });
      }
      if (nativeOut) {
        natives.push({ fromUserAccount: null, toUserAccount: nativeOut.account, amount: nativeOut.amount });
      }
    }
  }
  const failed = tx.transactionError != null || tx.err != null || tx.error != null || tx.transactionStatus === "ERROR" || tx.transactionStatus === "FAILED";
  const unknown = tx.transactionStatus != null && tx.transactionStatus !== "OK" && !failed;
  return NormalizedChainEventSchema.parse({
    signature,
    slot: tx.slot == null ? null : num(tx.slot),
    blockTime: tx.timestamp == null ? null : num(tx.timestamp),
    wallet,
    status: failed ? "FAILED" : unknown ? "UNKNOWN" : "OK",
    feeLamports: tx.fee == null ? null : num(tx.fee),
    feePayer: tx.feePayer == null ? null : String(tx.feePayer),
    programs: tx.source ? [String(tx.source)] : [],
    summaryType: type === "swap" || swap ? "swap" : type,
    nativeDeltas: natives.flatMap((n) => {
      if (!n || typeof n !== "object" || Array.isArray(n)) throw new Error("invalid-native-transfer");
      const r = n as { fromUserAccount?: string | null; toUserAccount?: string | null; amount?: unknown };
      return [{ from: r.fromUserAccount ?? null, to: r.toUserAccount ?? null, amountLamports: num(r.amount) }];
    }),
    tokenDeltas: tokens.flatMap((t) => {
      if (!t || typeof t !== "object" || Array.isArray(t)) throw new Error("invalid-token-transfer");
      const r = t as Record<string, unknown>;
      const mint = mintOk(r.mint);
      if (!mint) throw new Error("invalid-token-mint");
      return [
        {
          mint,
          qty: tokenQty(r),
          raw: null,
          decimals: r.decimals == null ? null : num(r.decimals),
          from: r.fromUserAccount == null ? null : String(r.fromUserAccount),
          to: r.toUserAccount == null ? null : String(r.toUserAccount),
        },
      ];
    }),
    swapHint,
    provider: "helius-enhanced-tx",
    parserStatus: "OK",
    warnings: failed ? ["failed-transaction"] : [],
  });
}

export function normalizeStreamMessage(row: unknown, wallet: string | null): NormalizedChainEvent | null {
  const ev = normalizeParsedEventsItem(row, wallet);
  if (!ev) return null;
  return { ...ev, provider: "helius-parsed-stream" };
}

function walletNets(ev: NormalizedChainEvent, wallet: string): Map<string, number> {
  const net = new Map<string, number>();
  const add = (mint: string, q: number) => net.set(mint, (net.get(mint) ?? 0) + q);
  for (const t of ev.tokenDeltas) {
    if (t.to === wallet) add(t.mint, t.qty);
    if (t.from === wallet) add(t.mint, -t.qty);
  }
  let native = 0;
  for (const n of ev.nativeDeltas) {
    if (n.amountLamports === ATA_RENT) continue;
    if (n.to === wallet) native += n.amountLamports;
    if (n.from === wallet) native -= n.amountLamports;
  }
  if (Math.abs(native) > 1000) add(WSOL, native / 1e9);
  return net;
}

function mkTrade(
  ev: NormalizedChainEvent,
  wallet: string,
  mint: string,
  side: WalletTrade["side"],
  qty: number,
  confidence: number,
): WalletTrade | null {
  if (!(qty > DUST)) return null;
  const parsed = WalletTradeSchema.safeParse({
    signature: createHash("sha256").update(JSON.stringify([ev.signature, wallet, side, mint])).digest("hex"),
    timestamp: tsIso(ev.blockTime),
    mint,
    side,
    usdNotional: 0,
    qty: Math.abs(qty),
    priceUsd: null,
    tokenAgeHoursAtEntry: null,
    liquidityUsdAtEntry: null,
    slippageBps: null,
    counterparty: null,
    isDemo: ev.provider === "demo" || ev.provider === "fixture",
    sourceSignature: ev.signature,
    provider: ev.provider,
    classificationConfidence: confidence,
    priceSource: null,
    priceAsOf: null,
    costBasis: "UNPRICED",
  });
  return parsed.success ? parsed.data : null;
}

/**
 * Classify using wallet asset deltas + optional swap summary.
 * False positives are rejected in favor of UNCLASSIFIED / transfers.
 */
export function classifyWalletActivity(ev: NormalizedChainEvent, wallet: string): WalletTrade[] {
  if (ev.status !== "OK") return [];
  if (ev.parserStatus === "ERROR") return [];
  if (!ev.blockTime || tsIso(ev.blockTime) === new Date(0).toISOString()) return [];
  const skip = new Set(["create_account", "create_token_account", "add_liquidity", "remove_liquidity"]);
  if (ev.summaryType && skip.has(ev.summaryType) && !ev.swapHint) return [];

  const net = walletNets(ev, wallet);
  const entries = [...net.entries()].filter(([, q]) => Math.abs(q) > DUST);
  if (!entries.length) return [];

  const out: WalletTrade[] = [];
  const push = (mint: string, side: WalletTrade["side"], qty: number, conf: number) => {
    const t = mkTrade(ev, wallet, mint, side, qty, conf);
    if (t) out.push(t);
  };

  if (ev.swapHint) {
    const { inputMint, outputMint, innerMints } = ev.swapHint;
    const spent = net.get(inputMint) ?? 0;
    const recv = net.get(outputMint) ?? 0;
    const intermediate = new Set(innerMints.filter((m) => m !== inputMint && m !== outputMint));
    if (isQuoteMint(inputMint) && isQuoteMint(outputMint)) return [];
    if (spent < -DUST && recv > DUST) {
      if (isQuoteMint(inputMint) && !isQuoteMint(outputMint)) push(outputMint, "BUY", recv, 0.9);
      else if (!isQuoteMint(inputMint) && isQuoteMint(outputMint)) push(inputMint, "SELL", -spent, 0.9);
      else if (!isQuoteMint(inputMint) && !isQuoteMint(outputMint)) {
        push(inputMint, "SELL", -spent, 0.85);
        push(outputMint, "BUY", recv, 0.85);
      }
      for (const [mint, q] of entries) {
        if (mint === inputMint || mint === outputMint || intermediate.has(mint) || isQuoteMint(mint)) continue;
        if (q > DUST) push(mint, "TRANSFER_IN", q, 0.4);
        if (q < -DUST) push(mint, "TRANSFER_OUT", -q, 0.4);
      }
      return out;
    }
    // There is no observed quantity for the hinted input. Do not fabricate one.
    return [];
  }

  if (ev.summaryType === "swap") {
    const sold = entries.filter(([m, q]) => q < 0 && !isQuoteMint(m));
    const bought = entries.filter(([m, q]) => q > 0 && !isQuoteMint(m));
    const soldQ = entries.some(([m, q]) => q < 0 && isQuoteMint(m));
    const boughtQ = entries.some(([m, q]) => q > 0 && isQuoteMint(m));
    if (soldQ && bought.length) {
      for (const [m, q] of bought) push(m, "BUY", q, 0.75);
      return out;
    }
    if (boughtQ && sold.length) {
      for (const [m, q] of sold) push(m, "SELL", -q, 0.75);
      return out;
    }
    if (sold.length && bought.length) {
      for (const [m, q] of sold) push(m, "SELL", -q, 0.7);
      for (const [m, q] of bought) push(m, "BUY", q, 0.7);
      return out;
    }
    return [];
  }

  if (ev.summaryType === "transfer" || !ev.summaryType) {
    for (const [mint, q] of entries) {
      if (q > DUST) push(mint, "TRANSFER_IN", q, 0.8);
      else if (q < -DUST) push(mint, "TRANSFER_OUT", -q, 0.8);
    }
  }
  return out;
}

export function dedupeTrades(trades: WalletTrade[]): { trades: WalletTrade[]; duplicates: number; conflicts: number } {
  const seen = new Map<string, string>();
  const conflicted = new Set<string>();
  const out: WalletTrade[] = [];
  let duplicates = 0;
  for (const t of trades) {
    const sig = t.sourceSignature ?? t.signature;
    const key = JSON.stringify([sig, t.side, t.mint]);
    const facts = JSON.stringify([t.timestamp, t.qty, t.priceUsd, t.usdNotional]);
    if (seen.has(key)) {
      duplicates += 1;
      if (seen.get(key) !== facts) conflicted.add(sig);
      continue;
    }
    seen.set(key, facts);
    out.push(t);
  }
  return { trades: out.filter((t) => !conflicted.has(t.sourceSignature ?? t.signature)), duplicates, conflicts: conflicted.size };
}

export function parseHeliusEnhancedTx(wallet: string, row: unknown): WalletTrade[] {
  const ev = normalizeEnhancedTx(row, wallet);
  if (!ev) return [];
  return classifyWalletActivity(ev, wallet);
}

export function parseParsedEventsItem(wallet: string, row: unknown): WalletTrade[] {
  const ev = normalizeParsedEventsItem(row, wallet);
  if (!ev) return [];
  return classifyWalletActivity(ev, wallet);
}

export function compareNormalized(
  a: NormalizedChainEvent,
  b: NormalizedChainEvent,
): Array<{ field: string; a: unknown; b: unknown }> {
  const diffs: Array<{ field: string; a: unknown; b: unknown }> = [];
  const keys: Array<keyof NormalizedChainEvent> = [
    "signature",
    "status",
    "summaryType",
    "feeLamports",
    "blockTime",
  ];
  for (const k of keys) {
    if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) diffs.push({ field: k, a: a[k], b: b[k] });
  }
  const aTrades = a.wallet ? classifyWalletActivity(a, a.wallet) : [];
  const bTrades = b.wallet ? classifyWalletActivity(b, b.wallet) : [];
  const label = (xs: WalletTrade[]) =>
    xs.map((t) => `${t.side}:${t.mint}:${t.qty.toFixed(6)}`).sort().join("|");
  if (label(aTrades) !== label(bTrades)) {
    diffs.push({ field: "classification", a: label(aTrades), b: label(bTrades) });
  }
  return diffs;
}
