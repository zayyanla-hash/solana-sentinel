import { createHash } from "node:crypto";
import { z } from "zod";
import { SolanaAddressSchema, WalletTradeSchema, type WalletTrade } from "@sat/shared";
import { boundedInteger, requestJson, type HttpOptions } from "./http";
import { isQuoteMint } from "./helius-swap";

const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
export function decodeBase58(value: string): Uint8Array {
  if (!value || value.length > 4096) throw new Error("invalid-base58");
  let n = 0n;
  for (const c of value) {
    const digit = ALPHABET.indexOf(c);
    if (digit < 0) throw new Error("invalid-base58");
    n = n * 58n + BigInt(digit);
  }
  const bytes: number[] = [];
  while (n > 0n) { bytes.unshift(Number(n & 255n)); n >>= 8n; }
  return Uint8Array.from([...Array(value.match(/^1*/)?.[0].length ?? 0).fill(0), ...bytes]);
}
export function isTransactionSignature(value: unknown): value is string {
  if (typeof value !== "string" || value.length < 64 || value.length > 88) return false;
  try { return decodeBase58(value).length === 64; } catch { return false; }
}
const signature = z.string().refine(isTransactionSignature);
const SignatureRowSchema = z.object({
  signature, slot: z.number().int().nonnegative().safe(),
  err: z.unknown(), blockTime: z.number().int().nullable(),
  confirmationStatus: z.enum(["processed", "confirmed", "finalized"]).nullable(),
});
export type SignatureRow = z.infer<typeof SignatureRowSchema>;
export const MAINNET_GENESIS = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";

/** Only finalized, read-only RPC operations are exposed. Provider errors never include URLs. */
export class ReadOnlyRpcReader {
  constructor(private readonly endpoint: string, private readonly options: HttpOptions = {}) {
    const url = new URL(endpoint);
    if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))) {
      throw new Error("rpc-https-required");
    }
  }
  private async rpc(method: "getGenesisHash" | "getSignaturesForAddress" | "getTransaction", params: unknown[], signal?: AbortSignal): Promise<unknown> {
    const { value } = await requestJson(this.endpoint, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: method, method, params }),
    }, { ...this.options, signal });
    const parsed = z.object({ jsonrpc: z.literal("2.0"), id: z.literal(method), result: z.unknown(), error: z.unknown().optional() }).safeParse(value);
    if (!parsed.success || parsed.data.error != null || !Object.hasOwn(parsed.data, "result")) throw new Error("rpc-invalid-response");
    return parsed.data.result;
  }
  async verifyMainnet(signal?: AbortSignal): Promise<void> {
    if (await this.rpc("getGenesisHash", [], signal) !== MAINNET_GENESIS) throw new Error("rpc-wrong-cluster");
  }
  async signatures(wallet: string, before: string | null, limit: number, signal?: AbortSignal): Promise<SignatureRow[]> {
    SolanaAddressSchema.parse(wallet);
    if (before != null && !isTransactionSignature(before)) throw new Error("rpc-invalid-cursor");
    boundedInteger(limit, 100, 1, 1000);
    const rows = z.array(SignatureRowSchema).max(limit).parse(await this.rpc("getSignaturesForAddress", [wallet, {
      commitment: "finalized", limit, ...(before ? { before } : {}),
    }], signal));
    if (rows.some((r) => r.confirmationStatus !== "finalized") || new Set(rows.map((r) => r.signature)).size !== rows.length ||
      rows.some((r, i) => i > 0 && r.slot > rows[i - 1]!.slot) || rows.some((r) => r.signature === before)) throw new Error("rpc-invalid-signature-page");
    return rows;
  }
  async transaction(sig: string, signal?: AbortSignal): Promise<Record<string, unknown>> {
    if (!isTransactionSignature(sig)) throw new Error("rpc-invalid-signature");
    const value = await this.rpc("getTransaction", [sig, { commitment: "finalized", encoding: "jsonParsed", maxSupportedTransactionVersion: 0 }], signal);
    if (value == null) throw new Error("rpc-transaction-unavailable");
    return z.record(z.unknown()).parse(value);
  }
}

const KeySchema = z.object({ pubkey: SolanaAddressSchema, signer: z.boolean() }).passthrough();
const BalanceSchema = z.object({
  accountIndex: z.number().int().nonnegative(), mint: SolanaAddressSchema,
  owner: SolanaAddressSchema.optional(),
  uiTokenAmount: z.object({ amount: z.string().max(20).regex(/^\d+$/), decimals: z.number().int().min(0).max(255) }).passthrough(),
}).passthrough();
const TransactionSchema = z.object({
  slot: z.number().int().nonnegative().safe(), blockTime: z.number().int().nullable(),
  meta: z.object({ err: z.unknown(), fee: z.number().int().nonnegative().safe(),
    preBalances: z.array(z.number().int().nonnegative().safe()), postBalances: z.array(z.number().int().nonnegative().safe()),
    preTokenBalances: z.array(BalanceSchema).optional(), postTokenBalances: z.array(BalanceSchema).optional(),
  }).passthrough(),
  transaction: z.object({ signatures: z.array(signature).min(1), message: z.object({
    accountKeys: z.array(KeySchema).min(1), instructions: z.array(z.record(z.unknown())),
  }).passthrough() }).passthrough(),
}).passthrough();
const JUPITER = "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4";
const COMPUTE = "ComputeBudget111111111111111111111111111111";
const SYSTEM = "11111111111111111111111111111111";
const MEMO = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";
const ATA = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
const TOKEN = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const TOKEN_2022 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const WSOL = "So11111111111111111111111111111111111111112";
const PUMP = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";
const PUMP_FEES = "pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ";
// Anchor instruction names from jup-ag/instruction-parser/src/idl/jupiter.ts.
const ROUTES = new Map(["route", "route_with_token_ledger", "shared_accounts_route", "shared_accounts_route_with_token_ledger", "exact_out_route", "shared_accounts_exact_out_route"]
  .map((name) => [createHash("sha256").update(`global:${name}`).digest().subarray(0, 8).toString("hex"), name.startsWith("shared_accounts_")
    ? { authority: 2, source: 3, destination: 6 }
    : { authority: 1, source: 2, destination: 3 }]));

export interface RpcInterpretation {
  outcome: "CLASSIFIED" | "UNKNOWN" | "FAILED";
  reason: string;
  trades: WalletTrade[];
  slot: number;
  blockTime: number | null;
}

/** The only supported native-output route: one Pump SellV2 leg, a wallet-owned
 * temporary WSOL ATA, and its close back to the same wallet. Every other
 * wrapped-SOL or multi-instruction shape continues to abstain. */
function isolatedPumpSellToClosedWsol(
  tx: z.infer<typeof TransactionSchema>, wallet: string,
): { mint: string; qty: number } | null {
  const instructions = tx.transaction.message.instructions;
  const significant = instructions.map((ix, index) => ({ ix, index }))
    .filter(({ ix }) => ix.programId !== COMPUTE && ix.programId !== MEMO);
  if (significant.length !== 3 || significant[0]!.ix.programId !== ATA ||
    significant[1]!.ix.programId !== JUPITER || significant[2]!.ix.programId !== TOKEN) return null;
  const { ix: create, index: createIndex } = significant[0]!;
  const { ix: route, index: routeIndex } = significant[1]!;
  const { ix: close } = significant[2]!;
  if (!Array.isArray(route!.accounts) || route!.accounts[1] !== wallet ||
    typeof route!.accounts[2] !== "string" || typeof route!.accounts[3] !== "string" ||
    typeof route!.data !== "string") return null;
  let routeId: string;
  try { routeId = Buffer.from(decodeBase58(route!.data).subarray(0, 8)).toString("hex"); }
  catch { return null; }
  if (routeId !== createHash("sha256").update("global:route").digest("hex").slice(0, 16)) return null;
  const source = route!.accounts[2] as string;
  const destination = route!.accounts[3] as string;
  if (source === destination || source === wallet || destination === wallet) return null;
  const ataInfo = z.object({ account: z.literal(destination), mint: z.literal(WSOL),
    source: z.literal(wallet), wallet: z.literal(wallet), tokenProgram: z.literal(TOKEN) })
    .safeParse((create!.parsed as { info?: unknown } | undefined)?.info);
  const closeInfo = z.object({ account: z.literal(destination), destination: z.literal(wallet), owner: z.literal(wallet) })
    .safeParse((close!.parsed as { info?: unknown } | undefined)?.info);
  if ((create!.parsed as { type?: unknown } | undefined)?.type !== "createIdempotent" || !ataInfo.success ||
    (close!.parsed as { type?: unknown } | undefined)?.type !== "closeAccount" || !closeInfo.success) return null;

  const groups = z.array(z.object({ index: z.number().int().nonnegative(), instructions: z.array(z.record(z.unknown())) }))
    .safeParse(tx.meta.innerInstructions);
  if (!groups.success || groups.data.length !== 2) return null;
  const createGroup = groups.data.find((group) => group.index === createIndex);
  const routeGroup = groups.data.find((group) => group.index === routeIndex);
  if (!createGroup || !routeGroup) return null;
  let rent = 0;
  let initialized = false;
  for (const inner of createGroup.instructions) {
    const type = (inner.parsed as { type?: unknown } | undefined)?.type;
    const info = (inner.parsed as { info?: unknown } | undefined)?.info;
    if (inner.programId === SYSTEM && type === "createAccount") {
      const parsed = z.object({ newAccount: z.literal(destination), source: z.literal(wallet),
        owner: z.literal(TOKEN), lamports: z.number().int().positive().safe() }).safeParse(info);
      if (!parsed.success || rent !== 0) return null;
      rent = parsed.data.lamports;
    } else if (inner.programId === TOKEN && type === "initializeAccount3") {
      const parsed = z.object({ account: z.literal(destination), mint: z.literal(WSOL), owner: z.literal(wallet) }).safeParse(info);
      if (!parsed.success || initialized) return null;
      initialized = true;
    } else if (inner.programId !== TOKEN || !["getAccountDataSize", "initializeImmutableOwner"].includes(String(type))) return null;
  }
  if (!rent || !initialized) return null;

  const logs = z.array(z.string()).safeParse(tx.meta.logMessages);
  if (!logs.success || !logs.data.some((line, index) => line === `Program ${PUMP} invoke [2]` &&
    logs.data[index + 1] === "Program log: Instruction: SellV2")) return null;

  const pre = z.array(BalanceSchema).safeParse(tx.meta.preTokenBalances);
  const post = z.array(BalanceSchema).safeParse(tx.meta.postTokenBalances);
  if (!pre.success || !post.success) return null;
  const preByIndex = new Map(pre.data.map((balance) => [balance.accountIndex, balance]));
  const postByIndex = new Map(post.data.map((balance) => [balance.accountIndex, balance]));
  if (preByIndex.size !== pre.data.length || postByIndex.size !== post.data.length) return null;
  const keys = tx.transaction.message.accountKeys;
  const sourceIndex = keys.findIndex((key) => key.pubkey === source);
  const destinationIndex = keys.findIndex((key) => key.pubkey === destination);
  if (sourceIndex < 0 || destinationIndex < 0 || preByIndex.has(destinationIndex) || postByIndex.has(destinationIndex) ||
    tx.meta.preBalances[destinationIndex] !== 0 || tx.meta.postBalances[destinationIndex] !== 0) return null;
  const sourcePre = preByIndex.get(sourceIndex), sourcePost = postByIndex.get(sourceIndex);
  if (!sourcePre || !sourcePost || sourcePre.owner !== wallet || sourcePost.owner !== wallet ||
    sourcePre.mint !== sourcePost.mint || isQuoteMint(sourcePre.mint) ||
    sourcePre.uiTokenAmount.decimals !== sourcePost.uiTokenAmount.decimals ||
    ![TOKEN, TOKEN_2022].includes(String(sourcePre.programId)) || sourcePre.programId !== sourcePost.programId) return null;
  const spent = BigInt(sourcePre.uiTokenAmount.amount) - BigInt(sourcePost.uiTokenAmount.amount);
  if (spent <= 0n || spent > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  for (const index of new Set([...preByIndex.keys(), ...postByIndex.keys()])) {
    if (index === sourceIndex) continue;
    const a = preByIndex.get(index), b = postByIndex.get(index);
    if (a?.owner !== wallet && b?.owner !== wallet) continue;
    if (!a || !b || a.owner !== wallet || b.owner !== wallet || a.mint !== b.mint ||
      a.uiTokenAmount.decimals !== b.uiTokenAmount.decimals || a.uiTokenAmount.amount !== b.uiTokenAmount.amount) return null;
  }

  // Official Pump sell_v2 IDL: discriminator, exact input amount and account roles.
  // https://github.com/pump-fun/pump-public-docs/blob/main/idl/pump.json
  const pumpCalls = routeGroup.instructions.filter((inner) => inner.programId === PUMP && inner.stackHeight === 2);
  if (pumpCalls.length !== 1) return null;
  const pump = pumpCalls[0]!;
  if (typeof pump.data !== "string" || !Array.isArray(pump.accounts) || pump.accounts.length !== 26) return null;
  let pumpData: Buffer;
  try { pumpData = Buffer.from(decodeBase58(pump.data)); } catch { return null; }
  if (pumpData.length !== 24 || pumpData.subarray(0, 8).toString("hex") !== "5df6823ce7e940b2" ||
    pumpData.readBigUInt64LE(8) !== spent || pump.accounts[1] !== sourcePre.mint || pump.accounts[2] !== WSOL ||
    pump.accounts[3] !== sourcePre.programId || pump.accounts[4] !== TOKEN || pump.accounts[5] !== ATA ||
    pump.accounts[13] !== wallet || pump.accounts[14] !== source || pump.accounts[15] !== destination ||
    pump.accounts[22] !== PUMP_FEES || pump.accounts[23] !== SYSTEM || pump.accounts[25] !== PUMP) return null;

  let sourceTransfer = false, wrap = false, sync = false, pumpInstructions = 0;
  for (const inner of routeGroup.instructions) {
    const type = (inner.parsed as { type?: unknown } | undefined)?.type;
    const info = (inner.parsed as { info?: unknown } | undefined)?.info;
    if (inner.programId === PUMP) {
      if (type != null) return null;
      if (inner.stackHeight === 2) pumpInstructions += 1;
      else {
        // Only the observed event CPI is allowed alongside the single sale call.
        if (inner.stackHeight !== 3 || typeof inner.data !== "string" || !Array.isArray(inner.accounts) ||
          inner.accounts.length !== 1 || inner.accounts[0] !== pump.accounts[24]) return null;
        try { if (Buffer.from(decodeBase58(inner.data).subarray(0, 8)).toString("hex") !== "e445a52e51cb9a1d") return null; }
        catch { return null; }
      }
      continue;
    }
    if (inner.programId === PUMP_FEES || inner.programId === JUPITER) { if (type != null) return null; continue; }
    if (inner.programId === sourcePre.programId && type === "transferChecked") {
      const parsed = z.object({ authority: z.literal(wallet), source: z.literal(source),
        mint: z.literal(sourcePre.mint), destination: SolanaAddressSchema,
        tokenAmount: z.object({ amount: z.string().regex(/^\d+$/), decimals: z.number().int() }) }).safeParse(info);
      if (!parsed.success || parsed.data.destination === source || sourceTransfer ||
        parsed.data.destination !== pump.accounts[11] || BigInt(parsed.data.tokenAmount.amount) !== spent ||
        parsed.data.tokenAmount.decimals !== sourcePre.uiTokenAmount.decimals) return null;
      sourceTransfer = true;
    } else if (inner.programId === SYSTEM && type === "transfer") {
      const parsed = z.object({ source: z.literal(wallet), destination: z.literal(destination),
        lamports: z.number().int().positive().safe() }).safeParse(info);
      if (!parsed.success || wrap) return null;
      wrap = true;
    } else if (inner.programId === TOKEN && type === "syncNative") {
      const parsed = z.object({ account: z.literal(destination) }).safeParse(info);
      if (!parsed.success || sync || !wrap) return null;
      sync = true;
    } else return null;
  }
  if (!sourceTransfer || !wrap || !sync || pumpInstructions !== 1) return null;

  const walletIndex = keys.findIndex((key) => key.pubkey === wallet);
  if (walletIndex !== 0 || !keys[walletIndex]!.signer) return null;
  const deltas = keys.map((_, index) => BigInt(tx.meta.postBalances[index]!) - BigInt(tx.meta.preBalances[index]!));
  const fee = BigInt(tx.meta.fee);
  const nativeReceived = deltas[walletIndex]! + fee;
  if (nativeReceived <= 0n || deltas.reduce((sum, delta) => sum + delta, 0n) !== -fee ||
    deltas[destinationIndex] !== 0n) return null;
  const externalDebits = deltas.map((delta, index) => ({ delta, index }))
    .filter(({ delta, index }) => index !== walletIndex && delta < 0n);
  if (externalDebits.length !== 1 || keys[externalDebits[0]!.index]!.pubkey !== pump.accounts[10]) return null;
  const qty = Number(spent) / 10 ** sourcePre.uiTokenAmount.decimals;
  return qty > 0 && Number.isFinite(qty) ? { mint: sourcePre.mint, qty } : null;
}
/** Conservative initial interpreter: direct SOL transfers and isolated Jupiter token-to-token routes.
 * Native rent, wrapping, closure, other protocols and combined actions deliberately abstain. */
export function interpretRpcTransaction(sig: string, wallet: string, raw: unknown): RpcInterpretation {
  const tx = TransactionSchema.parse(raw);
  SolanaAddressSchema.parse(wallet);
  if (!isTransactionSignature(sig) || tx.transaction.signatures[0] !== sig) throw new Error("rpc-signature-mismatch");
  const keys = tx.transaction.message.accountKeys;
  if (new Set(keys.map((key) => key.pubkey)).size !== keys.length) throw new Error("rpc-duplicate-account-key");
  const walletIndex = keys.findIndex((k) => k.pubkey === wallet);
  if (walletIndex < 0 || tx.meta.preBalances.length !== keys.length || tx.meta.postBalances.length !== keys.length) throw new Error("rpc-wallet-or-balances-mismatch");
  const base = { slot: tx.slot, blockTime: tx.blockTime, trades: [] as WalletTrade[] };
  if (!Object.hasOwn(tx.meta, "err")) throw new Error("rpc-missing-transaction-status");
  if (tx.meta.err != null) return { ...base, outcome: "FAILED", reason: "onchain-failed" };
  if (tx.blockTime == null || tx.blockTime <= 0) return { ...base, outcome: "UNKNOWN", reason: "missing-block-time" };
  const timestamp = new Date(tx.blockTime * 1000).toISOString();
  const trade = (mint: string, side: WalletTrade["side"], qty: number): WalletTrade => WalletTradeSchema.parse({
    signature: createHash("sha256").update(JSON.stringify([sig, wallet, side, mint])).digest("hex"),
    sourceSignature: sig, timestamp, mint, side, qty, usdNotional: 0,
    priceUsd: null, tokenAgeHoursAtEntry: null, liquidityUsdAtEntry: null, slippageBps: null,
    isDemo: false, provider: "solana-finalized-rpc-v1", classificationConfidence: 0.8, costBasis: "UNPRICED",
  });
  const instructions = tx.transaction.message.instructions;
  const relevant = instructions.filter((ix) => ix.programId !== COMPUTE && ix.programId !== MEMO);
  if (relevant.length > 0 && relevant.every((ix) => ix.programId === SYSTEM &&
    ix.parsed != null && typeof ix.parsed === "object" && (ix.parsed as { type?: unknown }).type === "transfer")) {
    let net = 0n;
    for (const ix of relevant) {
      const info = z.object({ source: SolanaAddressSchema, destination: SolanaAddressSchema, lamports: z.number().int().positive().safe() })
        .parse((ix.parsed as { info?: unknown }).info);
      if (info.source === wallet) net -= BigInt(info.lamports);
      if (info.destination === wallet) net += BigInt(info.lamports);
    }
    const observed = BigInt(tx.meta.postBalances[walletIndex]!) - BigInt(tx.meta.preBalances[walletIndex]!) + (walletIndex === 0 ? BigInt(tx.meta.fee) : 0n);
    if (net !== observed) return { ...base, outcome: "UNKNOWN", reason: "native-transfer-balance-mismatch" };
    const magnitude = net < 0n ? -net : net;
    if (magnitude > BigInt(Number.MAX_SAFE_INTEGER)) return { ...base, outcome: "UNKNOWN", reason: "quantity-precision-limit" };
    return { ...base, outcome: net ? "CLASSIFIED" : "UNKNOWN", reason: "direct-sol-transfer",
      trades: net ? [trade("So11111111111111111111111111111111111111112", net > 0n ? "TRANSFER_IN" : "TRANSFER_OUT", Number(magnitude) / 1e9)] : [] };
  }
  const pumpSell = isolatedPumpSellToClosedWsol(tx, wallet);
  if (pumpSell) return { ...base, outcome: "CLASSIFIED", reason: "jupiter-pump-sell-closed-wsol", trades: [trade(pumpSell.mint, "SELL", pumpSell.qty)] };
  if (relevant.length !== 1 || relevant[0]!.programId !== JUPITER || !keys[walletIndex]!.signer) return { ...base, outcome: "UNKNOWN", reason: "unsupported-or-combined-instructions" };
  const route = relevant[0]!;
  if (typeof route.data !== "string" || !Array.isArray(route.accounts) || !route.accounts.includes(wallet)) return { ...base, outcome: "UNKNOWN", reason: "unverified-route-authority" };
  let bytes: Uint8Array;
  try { bytes = decodeBase58(route.data); } catch { return { ...base, outcome: "UNKNOWN", reason: "invalid-route-data" }; }
  const layout = ROUTES.get(Buffer.from(bytes.subarray(0, 8)).toString("hex"));
  if (layout == null) return { ...base, outcome: "UNKNOWN", reason: "unsupported-jupiter-instruction" };
  if (route.accounts[layout.authority] !== wallet) return { ...base, outcome: "UNKNOWN", reason: "unverified-route-authority" };
  if (!tx.meta.preTokenBalances || !tx.meta.postTokenBalances) return { ...base, outcome: "UNKNOWN", reason: "missing-token-balances" };
  const pre = new Map(tx.meta.preTokenBalances.map((b) => [b.accountIndex, b]));
  const post = new Map(tx.meta.postTokenBalances.map((b) => [b.accountIndex, b]));
  if (pre.size !== tx.meta.preTokenBalances.length || post.size !== tx.meta.postTokenBalances.length) throw new Error("rpc-duplicate-token-account");
  const net = new Map<string, { raw: bigint; decimals: number }>();
  let routeSpent = false, routeReceived = false;
  for (const index of new Set([...pre.keys(), ...post.keys()])) {
    const a = pre.get(index), b = post.get(index);
    if (a?.owner !== wallet && b?.owner !== wallet) continue;
    if (!a || !b || a.owner !== b.owner || a.mint !== b.mint || a.uiTokenAmount.decimals !== b.uiTokenAmount.decimals || index >= keys.length) {
      return { ...base, outcome: "UNKNOWN", reason: "token-account-created-closed-or-owner-changed" };
    }
    const old = net.get(a.mint);
    if (old && old.decimals !== a.uiTokenAmount.decimals) throw new Error("rpc-decimals-conflict");
    const delta = BigInt(b.uiTokenAmount.amount) - BigInt(a.uiTokenAmount.amount);
    if (delta !== 0n) {
      const key = keys[index]!.pubkey;
      if (key === route.accounts[layout.source] && delta < 0n) routeSpent = true;
      else if (key === route.accounts[layout.destination] && delta > 0n) routeReceived = true;
      else return { ...base, outcome: "UNKNOWN", reason: "token-deltas-outside-route-accounts" };
    }
    net.set(a.mint, { raw: (old?.raw ?? 0n) + delta, decimals: a.uiTokenAmount.decimals });
  }
  const changed = [...net].filter(([, value]) => value.raw !== 0n);
  const native = tx.meta.postBalances[walletIndex]! - tx.meta.preBalances[walletIndex]! + (walletIndex === 0 ? tx.meta.fee : 0);
  if (!routeSpent || !routeReceived || native !== 0 || changed.length !== 2 || !changed.some(([, q]) => q.raw < 0n) || !changed.some(([, q]) => q.raw > 0n)) return { ...base, outcome: "UNKNOWN", reason: "ambiguous-net-assets-or-native-cost" };
  if (changed.every(([mint]) => isQuoteMint(mint))) return { ...base, outcome: "UNKNOWN", reason: "quote-to-quote-route" };
  const trades: WalletTrade[] = [];
  for (const [mint, value] of changed) {
    if (isQuoteMint(mint)) continue;
    const magnitude = value.raw < 0n ? -value.raw : value.raw;
    if (magnitude > BigInt(Number.MAX_SAFE_INTEGER)) return { ...base, outcome: "UNKNOWN", reason: "quantity-precision-limit" };
    const qty = Number(magnitude) / 10 ** value.decimals;
    if (!(qty > 0) || !Number.isFinite(qty)) return { ...base, outcome: "UNKNOWN", reason: "quantity-out-of-range" };
    trades.push(trade(mint, value.raw < 0n ? "SELL" : "BUY", qty));
  }
  return { ...base, outcome: "CLASSIFIED", reason: "isolated-jupiter-token-route", trades };
}
