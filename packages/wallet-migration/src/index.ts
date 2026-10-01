import { createHash } from "node:crypto";
import { z } from "zod";
import { SolanaAddressSchema, WalletClusterSchema, WalletTradeSchema, type WalletTrade } from "@sat/shared";

export const WALLET_MIGRATION_VERSION = "wallet-migration-v1";
const Address = SolanaAddressSchema;
const IsoDate = z.string().datetime();

export const WalletMigrationInputSchema = z.object({
  tradesByWallet: z.record(z.array(WalletTradeSchema)),
  clusters: z.array(WalletClusterSchema).default([]),
  asOf: IsoDate,
  windowHours: z.number().positive().max(24 * 90).default(720),
  maxDelayHours: z.number().positive().max(24 * 90).default(72),
  maxPriceAgeHours: z.number().positive().max(24 * 90).default(24),
  repeatPenalty: z.number().min(0).max(1).default(0.15),
});
export type WalletMigrationInput = z.input<typeof WalletMigrationInputSchema>;

export const WalletMigrationEvidenceSchema = z.object({
  wallet: Address,
  signature: z.string().min(1),
  sourceSignature: z.string().optional(),
  side: z.enum(["SELL", "BUY"]),
  timestamp: IsoDate,
  mint: Address,
  quantity: z.number(),
  usdValue: z.number().nonnegative().nullable(),
  priceSource: z.string().nullable(),
  priceAsOf: IsoDate.nullable(),
  provider: z.string().nullable(),
  costBasis: z.enum(["PRICED", "UNPRICED", "PARTIAL", "UNKNOWN"]).nullable(),
});
export type WalletMigrationEvidence = z.infer<typeof WalletMigrationEvidenceSchema>;

export const WalletMigrationSchema = z.object({
  id: z.string().uuid(),
  sourceMint: Address,
  destinationMint: Address,
  firstTransitionAt: IsoDate,
  lastTransitionAt: IsoDate,
  transitionCount: z.number().int().positive(),
  uniqueWalletCount: z.number().int().positive(),
  uniqueClusterCount: z.number().int().nonnegative(),
  clusterAdjustedCount: z.number().nonnegative(),
  migrationVelocityWalletsPerHour: z.number().nonnegative(),
  repeatPenalty: z.number().min(0).max(1),
  estimatedMigratedNotionalUsd: z.number().nonnegative().nullable(),
  valuationQuality: z.enum(["COMPLETE", "PARTIAL", "MISSING"]),
  evidence: z.array(WalletMigrationEvidenceSchema).min(2),
  provenance: z.array(z.string()).min(1),
  asOf: IsoDate,
  isDemo: z.boolean(),
  ownershipClaimed: z.literal(false),
});
export type WalletMigration = z.infer<typeof WalletMigrationSchema>;

export const WalletMigrationResultSchema = z.object({
  version: z.string(),
  asOf: IsoDate,
  migrations: z.array(WalletMigrationSchema),
});
export type WalletMigrationResult = z.infer<typeof WalletMigrationResultSchema>;

interface WalletRecord { wallet: string; trade: WalletTrade }
interface Transition { wallet: string; sell: WalletRecord; buy: WalletRecord }

function compareTime(a: string, b: string): number {
  return Date.parse(a) - Date.parse(b);
}

function stableId(value: string): string {
  const hex = createHash("sha256").update(value).digest("hex").slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function tradeValue(trade: WalletTrade, maxPriceAgeHours: number): number | null {
  if (trade.priceAsOf && Date.parse(trade.priceAsOf) > Date.parse(trade.timestamp)) return null;
  if (trade.usdNotional > 0) return trade.usdNotional;
  if (trade.priceUsd !== null && trade.priceUsd > 0 && Number.isFinite(trade.qty) && trade.priceAsOf && trade.priceSource?.trim()) {
    const tradeAt = Date.parse(trade.timestamp);
    const priceAt = Date.parse(trade.priceAsOf);
    if (priceAt <= tradeAt && tradeAt - priceAt <= maxPriceAgeHours * 3_600_000) {
      return Math.abs(trade.qty) * trade.priceUsd;
    }
  }
  return null;
}

function clusterMembership(clusters: z.infer<typeof WalletClusterSchema>[]): Map<string, { id: string; size: number }> {
  const membership = new Map<string, { id: string; size: number }>();
  for (const cluster of [...clusters].sort((a, b) => a.id.localeCompare(b.id))) {
    for (const wallet of new Set(cluster.wallets)) {
      const existing = membership.get(wallet);
      if (existing && existing.id !== cluster.id) throw new Error(`Wallet belongs to overlapping clusters: ${wallet}`);
      membership.set(wallet, { id: cluster.id, size: cluster.wallets.length });
    }
  }
  return membership;
}

function sameTransaction(a: WalletTrade, b: WalletTrade): boolean {
  return Boolean(a.sourceSignature && b.sourceSignature && a.sourceSignature === b.sourceSignature) || a.signature === b.signature;
}

function tradePayloadWithoutSourceSignature(trade: WalletTrade): string {
  const { sourceSignature: _sourceSignature, ...payload } = trade;
  return JSON.stringify(Object.fromEntries(Object.entries(payload).sort(([a], [b]) => a.localeCompare(b))));
}

function evidence(record: WalletRecord, maxPriceAgeHours: number) {
  const { wallet, trade } = record;
  return {
    wallet,
    signature: trade.signature,
    ...(trade.sourceSignature ? { sourceSignature: trade.sourceSignature } : {}),
    side: trade.side as "SELL" | "BUY",
    timestamp: trade.timestamp,
    mint: trade.mint,
    quantity: trade.qty,
    usdValue: tradeValue(trade, maxPriceAgeHours),
    priceSource: trade.priceSource ?? null,
    priceAsOf: trade.priceAsOf ?? null,
    provider: trade.provider ?? null,
    costBasis: trade.costBasis ?? null,
  };
}

/** Detects wallet-level SELL(A) -> BUY(B) transitions and aggregates by mint pair. */
export function detectWalletMigrations(rawInput: WalletMigrationInput): WalletMigrationResult {
  const input = WalletMigrationInputSchema.parse(rawInput);
  const cutoff = Date.parse(input.asOf);
  const lookbackStart = cutoff - input.windowHours * 3_600_000;
  const maxDelayMs = input.maxDelayHours * 3_600_000;
  const byWallet = new Map<string, WalletRecord[]>();

  for (const [wallet, trades] of Object.entries(input.tradesByWallet)) {
    if (!Address.safeParse(wallet).success) throw new Error(`Invalid wallet address: ${wallet}`);
    // A transaction signature identifies one wallet/mint/action record. This keeps
    // repeated ingestion and duplicate signature rows from manufacturing activity.
    const deduped = new Map<string, WalletTrade>();
    for (const trade of trades) {
      const key = `${wallet}|${trade.signature}|${trade.mint}|${trade.side}`;
      const prior = deduped.get(key);
      if (!prior) {
        deduped.set(key, trade);
        continue;
      }
      if (tradePayloadWithoutSourceSignature(prior) !== tradePayloadWithoutSourceSignature(trade)) {
        throw new Error(`Conflicting duplicate wallet trade: ${wallet}/${trade.signature}/${trade.mint}/${trade.side}`);
      }
      if (prior.sourceSignature && trade.sourceSignature && prior.sourceSignature !== trade.sourceSignature) {
        throw new Error(`Conflicting source signatures for duplicate wallet trade: ${wallet}/${trade.signature}`);
      }
      if (!prior.sourceSignature && trade.sourceSignature) deduped.set(key, trade);
    }
    const records = [...deduped.values()]
      .filter((trade) => {
        const timestamp = Date.parse(trade.timestamp);
        return timestamp >= lookbackStart && timestamp <= cutoff && (trade.side === "SELL" || trade.side === "BUY");
      })
      .map((trade) => ({ wallet, trade }))
      .sort((a, b) => compareTime(a.trade.timestamp, b.trade.timestamp) || a.trade.signature.localeCompare(b.trade.signature) || a.trade.mint.localeCompare(b.trade.mint));
    byWallet.set(wallet, records);
  }

  const transitions = new Map<string, Transition[]>();
  for (const [wallet, records] of byWallet) {
    const sells = records.filter(({ trade }) => trade.side === "SELL");
    const availableBuys = records.filter(({ trade }) => trade.side === "BUY");
    const consumedBuys = new Set<string>();
    const consumedSells = new Set<WalletRecord>();
    const addTransition = (sell: WalletRecord, buy: WalletRecord) => {
      const key = `${sell.trade.mint}|${buy.trade.mint}`;
      const group = transitions.get(key) ?? [];
      group.push({ wallet, sell, buy });
      transitions.set(key, group);
      consumedSells.add(sell);
      consumedBuys.add(`${buy.trade.signature}|${buy.trade.mint}`);
    };

    // Reserve same-transaction atomic swaps first so an older unrelated SELL
    // cannot consume the BUY leg before its actual transaction mate is seen.
    for (const sell of sells) {
      const atomicBuy = availableBuys
        .filter((candidate) => !consumedBuys.has(`${candidate.trade.signature}|${candidate.trade.mint}`) &&
          candidate.trade.mint !== sell.trade.mint && compareTime(candidate.trade.timestamp, sell.trade.timestamp) === 0 &&
          sameTransaction(candidate.trade, sell.trade))
        .sort((a, b) => a.trade.mint.localeCompare(b.trade.mint) || a.trade.signature.localeCompare(b.trade.signature))[0];
      if (atomicBuy) addTransition(sell, atomicBuy);
    }

    for (const sell of sells) {
      if (consumedSells.has(sell)) continue;
      const sellAt = Date.parse(sell.trade.timestamp);
      const buy = availableBuys.find((candidate) => {
        const candidateId = `${candidate.trade.signature}|${candidate.trade.mint}`;
        const buyAt = Date.parse(candidate.trade.timestamp);
        const atomic = buyAt === sellAt && sameTransaction(candidate.trade, sell.trade);
        const causallyOrdered = buyAt > sellAt || atomic;
        return !consumedBuys.has(candidateId) && candidate.trade.mint !== sell.trade.mint && causallyOrdered && buyAt - sellAt <= maxDelayMs;
      });
      if (!buy) continue;
      addTransition(sell, buy);
    }
  }

  const membership = clusterMembership(input.clusters);
  const migrations: WalletMigration[] = [];
  for (const [mintPair, group] of transitions) {
    const [sourceMint, destinationMint] = mintPair.split("|") as [string, string];
    const ordered = group.sort((a, b) => compareTime(a.buy.trade.timestamp, b.buy.trade.timestamp) || a.wallet.localeCompare(b.wallet) || a.sell.trade.signature.localeCompare(b.sell.trade.signature));
    const wallets = [...new Set(ordered.map((transition) => transition.wallet))].sort();
    const representedClusters = new Set(wallets.map((wallet) => membership.get(wallet)?.id).filter((id): id is string => Boolean(id)));
    const unclusteredWalletCount = wallets.filter((wallet) => !membership.has(wallet)).length;
    const clusterAdjustedCount = representedClusters.size + unclusteredWalletCount;
    const values = ordered.flatMap(({ sell, buy }) => [tradeValue(sell.trade, input.maxPriceAgeHours), tradeValue(buy.trade, input.maxPriceAgeHours)]);
    const availableValues = values.filter((value): value is number => value !== null);
    const fullyValued = ordered.every(({ sell, buy }) => tradeValue(sell.trade, input.maxPriceAgeHours) !== null && tradeValue(buy.trade, input.maxPriceAgeHours) !== null);
    const estimatedMigratedNotionalUsd = fullyValued
      ? ordered.reduce((sum, { sell, buy }) => sum + Math.min(tradeValue(sell.trade, input.maxPriceAgeHours)!, tradeValue(buy.trade, input.maxPriceAgeHours)!), 0)
      : null;
    const valuationQuality = fullyValued ? "COMPLETE" : availableValues.length ? "PARTIAL" : "MISSING";
    const evidenceRecords = ordered.flatMap(({ sell, buy }) => [evidence(sell, input.maxPriceAgeHours), evidence(buy, input.maxPriceAgeHours)]);
    const identity = ordered.map(({ wallet, sell, buy }) => `${wallet}:${sell.trade.signature}:${buy.trade.signature}`).sort().join("|");
    migrations.push(WalletMigrationSchema.parse({
      id: stableId(`${WALLET_MIGRATION_VERSION}|${sourceMint}|${destinationMint}|${identity}`),
      sourceMint, destinationMint,
      firstTransitionAt: ordered[0]!.buy.trade.timestamp,
      lastTransitionAt: ordered.at(-1)!.buy.trade.timestamp,
      transitionCount: ordered.length,
      uniqueWalletCount: wallets.length,
      uniqueClusterCount: representedClusters.size,
      clusterAdjustedCount,
      migrationVelocityWalletsPerHour: wallets.length / input.windowHours,
      repeatPenalty: Math.min(1, Math.max(0, ordered.length - wallets.length) * input.repeatPenalty),
      estimatedMigratedNotionalUsd, valuationQuality, evidence: evidenceRecords,
      provenance: ["Per-wallet SELL followed by BUY of a different mint within maxDelayHours", `Causal lookback: ${input.windowHours}h ending ${input.asOf}`, "Duplicate wallet/signature/mint/action records are counted once", `Derived prices require source provenance and priceAsOf no more than ${input.maxPriceAgeHours}h before trade time; future or stale prices are excluded`],
      asOf: input.asOf,
      isDemo: ordered.some(({ sell, buy }) => sell.trade.isDemo || buy.trade.isDemo),
      ownershipClaimed: false,
    }));
  }
  migrations.sort((a, b) => compareTime(a.firstTransitionAt, b.firstTransitionAt) || a.sourceMint.localeCompare(b.sourceMint) || a.destinationMint.localeCompare(b.destinationMint));
  return WalletMigrationResultSchema.parse({ version: WALLET_MIGRATION_VERSION, asOf: input.asOf, migrations });
}
