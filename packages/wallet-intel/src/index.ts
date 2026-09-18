import {
  type WalletTrade,
  type WalletCredibilityScore,
  type WalletPerformance,
  type WalletBehavior,
  type WalletRiskProfile,
  WalletCredibilityScoreSchema,
  SolanaAddressSchema,
  nowIso,
  WSOL,
  JUP,
  WIF,
  BONK,
  RAY,
} from "@sat/shared";

export const WALLET_INTEL_VERSION = "wallet-intel-v1";

export interface ClosedRoundTrip {
  mint: string;
  pnlUsd: number;
  returnPct: number;
  holdingHours: number;
  entryNotional: number;
  tokenAgeHoursAtEntry: number | null;
  liquidityUsdAtEntry: number | null;
  priced: boolean;
  costBasis: "PRICED" | "UNPRICED" | "PARTIAL" | "UNKNOWN";
}

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

function mean(xs: number[]): number | null {
  if (!xs.length) return null;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function stdev(xs: number[]): number | null {
  if (xs.length < 2) return null;
  const m = mean(xs)!;
  const v = xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1);
  return Math.sqrt(v);
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

export function closeRoundTrips(trades: WalletTrade[]): ClosedRoundTrip[] {
  const lots = new Map<string, Array<{ t: WalletTrade; remaining: number }>>();
  const closed: ClosedRoundTrip[] = [];
  const sorted = [...trades].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  for (const t of sorted) {
    if (t.side === "AIRDROP" || t.side === "TRANSFER_IN" || t.side === "TRANSFER_OUT" || t.side === "UNKNOWN") {
      continue;
    }
    const queue = lots.get(t.mint) ?? [];
    const sizeOf = (x: WalletTrade) => (x.usdNotional > 0 ? x.usdNotional : x.qty);
    if (t.side === "BUY") {
      queue.push({ t, remaining: sizeOf(t) });
      lots.set(t.mint, queue);
      continue;
    }
    let remaining = sizeOf(t);
    while (remaining > 1e-9 && queue.length) {
      const buy = queue[0]!;
      const used = Math.min(buy.remaining, remaining);
      const entryPx = buy.t.priceUsd ?? 0;
      const exitPx = t.priceUsd ?? 0;
      const priced = entryPx > 0 && exitPx > 0;
      const ret = priced ? (exitPx - entryPx) / entryPx : 0;
      const pnl = priced ? ret * (buy.t.usdNotional > 0 ? used : used * entryPx) : 0;
      closed.push({
        mint: t.mint,
        pnlUsd: pnl,
        returnPct: ret * 100,
        holdingHours: Math.max(0, (Date.parse(t.timestamp) - Date.parse(buy.t.timestamp)) / 3_600_000),
        entryNotional: used,
        tokenAgeHoursAtEntry: buy.t.tokenAgeHoursAtEntry ?? null,
        liquidityUsdAtEntry: buy.t.liquidityUsdAtEntry ?? null,
        priced,
        costBasis: priced ? "PRICED" : buy.t.priceUsd || t.priceUsd ? "PARTIAL" : "UNPRICED",
      });
      buy.remaining -= used;
      remaining -= used;
      if (buy.remaining <= 1e-9) queue.shift();
    }
    lots.set(t.mint, queue);
  }
  return closed;
}

export function computePerformance(trades: WalletTrade[]): WalletPerformance {
  const closed = closeRoundTrips(trades);
  const priced = closed.filter((t) => t.priced);
  const sampleSize = closed.length;
  if (priced.length < 3) {
    return {
      realizedPnlUsd: priced.length ? priced.reduce((s, t) => s + t.pnlUsd, 0) : null,
      unrealizedPnlUsd: null,
      winRate: null,
      lossRate: null,
      averageWinnerUsd: null,
      averageLoserUsd: null,
      expectancyUsd: null,
      profitFactor: null,
      medianReturnPct: null,
      maxDrawdownPct: null,
      consistency: null,
      tradeCount: trades.filter((t) => t.side === "BUY" || t.side === "SELL").length,
      sampleSize,
    };
  }
  const wins = priced.filter((t) => t.pnlUsd > 0);
  const losses = priced.filter((t) => t.pnlUsd < 0);
  const grossWin = wins.reduce((s, t) => s + t.pnlUsd, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnlUsd, 0));
  const realized = priced.reduce((s, t) => s + t.pnlUsd, 0);
  let peak = 0;
  let equity = 0;
  let maxDd = 0;
  for (const t of priced) {
    equity += t.pnlUsd;
    peak = Math.max(peak, equity);
    if (peak > 0) maxDd = Math.max(maxDd, (peak - equity) / Math.max(peak, 1));
  }
  const rets = priced.map((t) => t.returnPct);
  const sd = stdev(rets);
  const m = mean(rets) ?? 0;
  const consistency = sd == null || sd === 0 ? 1 : clamp(1 - sd / (Math.abs(m) + sd), 0, 1);
  return {
    realizedPnlUsd: realized,
    unrealizedPnlUsd: null,
    winRate: wins.length / priced.length,
    lossRate: losses.length / priced.length,
    averageWinnerUsd: wins.length ? grossWin / wins.length : null,
    averageLoserUsd: losses.length ? -(grossLoss / losses.length) : null,
    expectancyUsd: realized / priced.length,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? null : 0,
    medianReturnPct: median(rets),
    maxDrawdownPct: maxDd * 100,
    consistency,
    tradeCount: trades.filter((t) => t.side === "BUY" || t.side === "SELL").length,
    sampleSize,
  };
}

/** FIFO quantity lots. Transfers never open or close trading lots. Accounting method: FIFO. */
export function lotAudit(trades: WalletTrade[]): {
  method: "FIFO";
  opened: number;
  closed: number;
  remainingOpen: number;
  pricedClosed: number;
  unpricedClosed: number;
  realizedPnlUsd: number | null;
} {
  const closed = closeRoundTrips(trades);
  const opened = trades.filter((t) => t.side === "BUY").length;
  const remaining =
    opened -
    closed.length +
    trades.filter((t) => t.side === "SELL").length -
    closed.length;
  const pricedClosed = closed.filter((c) => c.priced).length;
  const unpricedClosed = closed.length - pricedClosed;
  const realized =
    pricedClosed > 0 ? closed.filter((c) => c.priced).reduce((s, c) => s + c.pnlUsd, 0) : null;
  return {
    method: "FIFO",
    opened,
    closed: closed.length,
    remainingOpen: Math.max(0, remaining),
    pricedClosed,
    unpricedClosed,
    realizedPnlUsd: realized,
  };
}

export function computeBehavior(trades: WalletTrade[]): WalletBehavior {
  const closed = closeRoundTrips(trades);
  const buys = trades.filter((t) => t.side === "BUY");
  const notionals = buys.map((t) => (t.usdNotional > 0 ? t.usdNotional : t.qty)).filter((n) => n > 0);
  const ages = buys.map((t) => t.timestamp);
  let tradesPerDay: number | null = null;
  if (ages.length >= 2) {
    const span = (Date.parse(ages[ages.length - 1]!) - Date.parse(ages[0]!)) / 86_400_000;
    tradesPerDay = span > 0 ? buys.length / span : null;
  }
  const byMint = new Map<string, number>();
  for (const t of buys) byMint.set(t.mint, (byMint.get(t.mint) ?? 0) + t.usdNotional);
  const total = [...byMint.values()].reduce((s, n) => s + n, 0);
  const hhi =
    total > 0 ? [...byMint.values()].reduce((s, n) => s + (n / total) ** 2, 0) : null;
  return {
    medianHoldingHours: median(closed.map((t) => t.holdingHours)),
    turnover: notionals.length ? notionals.reduce((s, n) => s + n, 0) : null,
    tradesPerDay,
    typicalPositionUsd: median(notionals),
    preferredMarketCapUsd: null,
    concentrationHhi: hhi,
    avgTokenAgeHoursAtEntry: mean(buys.map((t) => t.tokenAgeHoursAtEntry ?? 0).filter((n) => n > 0)),
    avgLiquidityUsdAtEntry: mean(
      buys.map((t) => t.liquidityUsdAtEntry ?? 0).filter((n) => n > 0),
    ),
    avgSlippageBps: mean(buys.map((t) => t.slippageBps ?? 0).filter((n) => n > 0)),
  };
}

export function computeRisk(trades: WalletTrade[]): WalletRiskProfile {
  const buys = trades.filter((t) => t.side === "BUY");
  const n = Math.max(buys.length, 1);
  const illiquid = buys.filter((t) => (t.liquidityUsdAtEntry ?? Infinity) < 50_000).length / n;
  const young = buys.filter((t) => (t.tokenAgeHoursAtEntry ?? Infinity) < 24).length / n;
  const transfers = trades.filter((t) => t.side === "TRANSFER_IN" || t.side === "TRANSFER_OUT");
  const airdrops = trades.filter((t) => t.side === "AIRDROP");
  const flags: string[] = [];
  if (airdrops.length > buys.length) flags.push("AIRDROP_HEAVY");
  if (transfers.length > trades.length * 0.4) flags.push("TRANSFER_HEAVY");
  const timestamps = trades.map((t) => Date.parse(t.timestamp)).filter((n) => Number.isFinite(n));
  const ageDays =
    timestamps.length >= 2 ? (Math.max(...timestamps) - Math.min(...timestamps)) / 86_400_000 : null;
  const byMint = new Map<string, number>();
  for (const t of buys) byMint.set(t.mint, (byMint.get(t.mint) ?? 0) + t.usdNotional);
  const total = [...byMint.values()].reduce((s, x) => s + x, 0);
  const topShare = total > 0 ? Math.max(...byMint.values()) / total : 0;
  return {
    rugExposure: young,
    scamExposure: null,
    failedTokenExposure: null,
    illiquidTokenExposure: illiquid,
    concentrationRisk: topShare,
    suspiciousTransferScore: clamp(transfers.length / Math.max(trades.length, 1), 0, 1),
    walletAgeDays: ageDays,
    fundingSourceFlags: flags,
  };
}

export function scoreWallet(input: {
  address: string;
  trades: WalletTrade[];
  isDemo?: boolean;
  isCreator?: boolean;
  washSuspected?: boolean;
  dataFreshness?: WalletCredibilityScore["dataFreshness"];
}): WalletCredibilityScore {
  const parsed = SolanaAddressSchema.safeParse(input.address);
  if (!parsed.success) {
    throw new Error("Invalid wallet address");
  }
  const trades = input.trades;
  const performance = computePerformance(trades);
  const behavior = computeBehavior(trades);
  const risk = computeRisk(trades);
  const closed = closeRoundTrips(trades);
  const reasonCodes: string[] = [];
  const positive: string[] = [];
  const negative: string[] = [];

  let score = 50;
  const n = performance.sampleSize;

  if (n < 5) {
    score -= 18;
    reasonCodes.push("SMALL_SAMPLE");
    negative.push(`Only ${n} closed round-trips — score is uncertain`);
  } else if (n >= 20) {
    score += 8;
    reasonCodes.push("ADEQUATE_SAMPLE");
    positive.push(`${n} closed round-trips`);
  }

  if (performance.winRate != null && n >= 8) {
    score += (performance.winRate - 0.5) * 24;
    if (performance.winRate > 0.55) positive.push(`Win rate ${(performance.winRate * 100).toFixed(0)}%`);
  }
  if (performance.profitFactor != null && n >= 8) {
    score += clamp((performance.profitFactor - 1) * 8, -12, 12);
    if (performance.profitFactor > 1.2) positive.push(`Profit factor ${performance.profitFactor.toFixed(2)}`);
  }
  if (performance.consistency != null && n >= 8) {
    score += (performance.consistency - 0.5) * 10;
  }

  const absPnl = closed.map((t) => Math.abs(t.pnlUsd));
  const totalAbs = absPnl.reduce((s, x) => s + x, 0);
  const maxAbs = absPnl.length ? Math.max(...absPnl) : 0;
  if (totalAbs > 0 && maxAbs / totalAbs > 0.7) {
    score -= 20;
    reasonCodes.push("MOONSHOT_CONCENTRATION");
    negative.push("More than 70% of P&L magnitude comes from a single round-trip");
  }

  const tiny = closed.filter((t) => t.entryNotional < 25).length;
  if (closed.length && tiny / closed.length > 0.6) {
    score -= 10;
    reasonCodes.push("TINY_POSITIONS");
    negative.push("Most round-trips are sub-$25 notionals");
  }

  if (input.washSuspected || (behavior.tradesPerDay != null && behavior.tradesPerDay > 40)) {
    score -= 22;
    reasonCodes.push("WASH_OR_HYPERACTIVE");
    negative.push("Wash activity or implausibly high trade frequency");
  }
  if (input.isCreator) {
    score -= 15;
    reasonCodes.push("CREATOR_OR_DEV");
    negative.push("Creator/dev wallet — not an independent smart-money signal");
  }
  if ((risk.illiquidTokenExposure ?? 0) > 0.4) {
    score -= 8;
    reasonCodes.push("ILLIQUID_ENTRIES");
    negative.push("Frequent entries into thin liquidity");
  }
  if ((risk.concentrationRisk ?? 0) > 0.7) {
    score -= 8;
    reasonCodes.push("TOKEN_CONCENTRATION");
    negative.push("Activity concentrated in a single mint");
  }
  if (risk.fundingSourceFlags.includes("AIRDROP_HEAVY")) {
    score -= 12;
    reasonCodes.push("AIRDROP_HEAVY");
    negative.push("Airdrops dominate over explicit buys — transfers are not buys");
  }
  if ((risk.walletAgeDays ?? 0) < 7 && n > 0) {
    score -= 6;
    reasonCodes.push("YOUNG_WALLET");
    negative.push("Short observed history");
  }

  score = clamp(Math.round(score), 0, 100);
  const freshness = input.dataFreshness ?? (input.isDemo ? "DEMO" : n < 5 ? "INSUFFICIENT" : "FRESH");
  const confidence = clamp(
    (Math.min(n, 40) / 40) * 0.7 +
      (freshness === "FRESH" || freshness === "DEMO" ? 0.25 : freshness === "STALE" ? 0.1 : 0) +
      (input.isDemo ? 0 : 0.1) -
      (input.washSuspected ? 0.2 : 0),
    0,
    1,
  );
  if (n < 5) reasonCodes.push("INSUFFICIENT_DATA");
  if (!reasonCodes.length) reasonCodes.push("BASELINE");

  return WalletCredibilityScoreSchema.parse({
    address: parsed.data,
    score,
    confidence: Number(confidence.toFixed(3)),
    sampleSize: n,
    reasonCodes: [...new Set(reasonCodes)],
    positiveEvidence: positive,
    negativeEvidence: negative,
    dataFreshness: freshness,
    performance,
    behavior,
    risk,
    assessedAt: nowIso(),
    configVersion: WALLET_INTEL_VERSION,
    isDemo: Boolean(input.isDemo),
    neverGuaranteed: true,
  });
}

/** Deterministic DEMO wallets — labeled, not live chain history. */
export function getDemoWalletTrades(): Record<string, WalletTrade[]> {
  const t = (hoursAgo: number) => new Date(Date.now() - hoursAgo * 3_600_000).toISOString();
  const SMART_A = DEMO_WALLETS.SMART_A;
  const LUCKY_MOON = DEMO_WALLETS.LUCKY_MOON;
  const WASH = DEMO_WALLETS.WASH;
  const DEV = DEMO_WALLETS.DEV;
  const mk = (
    signature: string,
    hoursAgo: number,
    mint: string,
    side: WalletTrade["side"],
    usd: number,
    price: number,
    extra: Partial<WalletTrade> = {},
  ): WalletTrade => ({
    signature,
    timestamp: t(hoursAgo),
    mint,
    side,
    usdNotional: usd,
    qty: price > 0 ? usd / price : 0,
    priceUsd: price,
    tokenAgeHoursAtEntry: extra.tokenAgeHoursAtEntry ?? 24 * 200,
    liquidityUsdAtEntry: extra.liquidityUsdAtEntry ?? 2_000_000,
    slippageBps: extra.slippageBps ?? 12,
    counterparty: extra.counterparty ?? null,
    isDemo: true,
  });

  return {
    [SMART_A]: [
      mk("smart1", 720, JUP, "BUY", 4_000, 0.55),
      mk("smart2", 680, JUP, "SELL", 4_800, 0.66),
      mk("smart3", 600, WIF, "BUY", 3_200, 1.4),
      mk("smart4", 540, WIF, "SELL", 3_680, 1.61),
      mk("smart5", 480, BONK, "BUY", 2_500, 0.00002),
      mk("smart6", 400, BONK, "SELL", 2_200, 0.0000176),
      mk("smart7", 320, JUP, "BUY", 5_000, 0.6),
      mk("smart8", 260, JUP, "SELL", 5_900, 0.71),
      mk("smart9", 200, WSOL, "BUY", 6_000, 140),
      mk("smart10", 140, WSOL, "SELL", 6_360, 148.4),
      mk("smart11", 90, JUP, "BUY", 3_500, 0.68),
      mk("smart12", 40, JUP, "SELL", 3_780, 0.735),
      mk("smart13", 36, RAY, "BUY", 2_800, 2.9),
      mk("smart14", 20, RAY, "SELL", 3_100, 3.21),
      mk("smart15", 16, WIF, "BUY", 1_800, 1.55),
      mk("smart16", 8, WIF, "SELL", 1_980, 1.7),
    ],
    [DEMO_WALLETS.SMART_B]: [
      mk("smb1", 700, RAY, "BUY", 3_000, 2.8),
      mk("smb2", 640, RAY, "SELL", 3_360, 3.14),
      mk("smb3", 580, JUP, "BUY", 4_200, 0.58),
      mk("smb4", 500, JUP, "SELL", 4_700, 0.65),
      mk("smb5", 420, WIF, "BUY", 2_200, 1.5),
      mk("smb6", 360, WIF, "SELL", 2_530, 1.73),
      mk("smb7", 280, WSOL, "BUY", 5_000, 142),
      mk("smb8", 200, WSOL, "SELL", 5_350, 152),
      mk("smb9", 160, JUP, "BUY", 3_000, 0.66),
      mk("smb10", 80, JUP, "SELL", 3_240, 0.71),
      mk("smb11", 50, RAY, "BUY", 2_400, 3.0),
      mk("smb12", 18, RAY, "SELL", 2_640, 3.3),
      mk("smb13", 14, WIF, "BUY", 1_500, 1.6),
      mk("smb14", 6, WIF, "SELL", 1_680, 1.79),
      mk("smb15", 5, JUP, "BUY", 2_000, 0.7),
      mk("smb16", 2, JUP, "SELL", 2_160, 0.756),
    ],
    [LUCKY_MOON]: [
      mk("lucky1", 400, BONK, "BUY", 80, 0.000002, { liquidityUsdAtEntry: 8_000, tokenAgeHoursAtEntry: 6 }),
      mk("lucky2", 20, BONK, "SELL", 9_600, 0.00024, { liquidityUsdAtEntry: 90_000 }),
      mk("lucky3", 10, WIF, "BUY", 40, 2.1),
    ],
    [WASH]: Array.from({ length: 24 }, (_, i) =>
      mk(`wash${i}`, 200 - i * 2, JUP, i % 2 === 0 ? "BUY" : "SELL", 50, 0.7, {
        counterparty: "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
      }),
    ),
    [DEV]: [
      mk("dev1", 50, BONK, "TRANSFER_IN", 100_000, 0.00002),
      mk("dev2", 40, BONK, "TRANSFER_OUT", 80_000, 0.00002),
      mk("dev3", 10, BONK, "AIRDROP", 20_000, 0.00002),
    ],
  };
}

export const DEMO_WALLETS = {
  SMART_A: "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
  SMART_B: "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin",
  LUCKY_MOON: "4Nd1mBQtrMJVYVfKf2PRfWnYaJKarnPZtCSjsyj2xK5B",
  WASH: "2wmVCSfPxGPjD4xDvGNPJoxD7yFzYJTVfKsogtWQ8Uj",
  DEV: "GThUX1At1qDcCw3NuMLapPGxAdTDyAtRbHqZc7xT6Z2k",
} as const;

export function analyzeDemoWallet(address: string): WalletCredibilityScore {
  const all = getDemoWalletTrades();
  const trades = all[address] ?? [];
  return scoreWallet({
    address,
    trades,
    isDemo: true,
    isCreator: address === DEMO_WALLETS.DEV,
    washSuspected: address === DEMO_WALLETS.WASH,
    dataFreshness: trades.length ? "DEMO" : "INSUFFICIENT",
  });
}

export function listDemoWalletScores(): WalletCredibilityScore[] {
  return Object.values(DEMO_WALLETS).map((a) => analyzeDemoWallet(a));
}

export interface WalletQualityReport {
  trades: number;
  buyCount: number;
  sellCount: number;
  transferCount: number;
  unknownCount: number;
  duplicateRate: number;
  classificationCoverage: number;
  priceCoverage: number;
  costBasisCoverage: number;
  pnlCoverage: number;
  lots: ReturnType<typeof lotAudit>;
}

export function walletQualityReport(trades: WalletTrade[], duplicates = 0): WalletQualityReport {
  const buyCount = trades.filter((t) => t.side === "BUY").length;
  const sellCount = trades.filter((t) => t.side === "SELL").length;
  const transferCount = trades.filter(
    (t) => t.side === "TRANSFER_IN" || t.side === "TRANSFER_OUT",
  ).length;
  const unknownCount = trades.filter((t) => t.side === "UNKNOWN").length;
  const classified = buyCount + sellCount + transferCount;
  const priced = trades.filter((t) => t.priceUsd != null && t.priceUsd > 0).length;
  const closed = closeRoundTrips(trades);
  const pricedClosed = closed.filter((c) => c.priced).length;
  const denom = Math.max(trades.length, 1);
  return {
    trades: trades.length,
    buyCount,
    sellCount,
    transferCount,
    unknownCount,
    duplicateRate: duplicates / Math.max(trades.length + duplicates, 1),
    classificationCoverage: classified / denom,
    priceCoverage: priced / denom,
    costBasisCoverage: closed.length ? pricedClosed / closed.length : 0,
    pnlCoverage: closed.length ? pricedClosed / closed.length : 0,
    lots: lotAudit(trades),
  };
}
