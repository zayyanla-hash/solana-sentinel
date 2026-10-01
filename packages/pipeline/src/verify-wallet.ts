import { isLiveTradingAllowed, type WalletTrade } from "@sat/shared";
import { closeRoundTrips, lotAudit, scoreWallet, walletQualityReport } from "@sat/wallet-intel";
import {
  createLiveWalletHistoryProvider,
  HeliusEnhancedTransactionsProvider,
  HeliusParsedEventsProvider,
  compareNormalized,
  normalizeEnhancedTx,
  normalizeParsedEventsItem,
  dedupeTrades,
} from "@sat/solana";

export interface WalletVerificationReport {
  address: string;
  provider: string;
  provenance: string[];
  retrieved: number;
  normalized: number;
  buyCount: number;
  sellCount: number;
  transferCount: number;
  unknownCount: number;
  parseFailures: number;
  duplicates: number;
  chronologicalOk: boolean;
  lotsOpened: number;
  lotsClosed: number;
  pricedTrades: number;
  unpricedTrades: number;
  realizedPnlUsd: number | null;
  quality: ReturnType<typeof walletQualityReport>;
  score: ReturnType<typeof scoreWallet>;
  warnings: string[];
  liveTradingAllowed: false;
  canBroadcast: false;
}

function chronoOk(trades: WalletTrade[]): boolean {
  for (let i = 1; i < trades.length; i++) {
    if (Date.parse(trades[i]!.timestamp) < Date.parse(trades[i - 1]!.timestamp)) return false;
  }
  return true;
}

export async function verifyLiveWallet(address: string): Promise<WalletVerificationReport> {
  const provider = createLiveWalletHistoryProvider();
  const history = await provider.getTrades(address).finally(() => provider.close?.());
  const { trades, duplicates } = dedupeTrades(history.trades);
  const sorted = [...trades].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  const quality = walletQualityReport(sorted, duplicates);
  const lots = lotAudit(sorted);
  const pricedTrades = sorted.filter((t) => t.priceUsd != null && t.priceUsd > 0).length;
  const warnings = [...history.provenance];
  if (history.isDemo) warnings.push("DEMO data — not live validation");
  const score = scoreWallet({
    address,
    trades: sorted,
    isDemo: history.isDemo,
    dataFreshness: history.freshness,
  });
  return {
    address,
    provider: history.provider,
    provenance: history.provenance,
    retrieved: sorted.length + duplicates,
    normalized: sorted.length,
    buyCount: quality.buyCount,
    sellCount: quality.sellCount,
    transferCount: quality.transferCount,
    unknownCount: quality.unknownCount,
    parseFailures: history.diagnostics?.rejected ?? (history.provenance.some((p) => /HTTP|error/i.test(p)) ? 1 : 0),
    duplicates,
    chronologicalOk: chronoOk(sorted),
    lotsOpened: lots.opened,
    lotsClosed: lots.closed,
    pricedTrades,
    unpricedTrades: sorted.length - pricedTrades,
    realizedPnlUsd: lots.realizedPnlUsd,
    quality,
    score,
    warnings,
    liveTradingAllowed: isLiveTradingAllowed() && false,
    canBroadcast: false,
  };
}

export async function compareWalletProviders(address: string): Promise<{
  address: string;
  parsed: { provider: string; trades: number; provenance: string[] };
  enhanced: { provider: string; trades: number; provenance: string[] };
  diffs: Array<{ field: string; a: unknown; b: unknown }>;
}> {
  const key = process.env.HELIUS_API_KEY?.trim();
  if (!key) {
    throw new Error("HELIUS_API_KEY is required for compare-providers");
  }
  const parsedP = new HeliusParsedEventsProvider(key);
  const enhancedP = new HeliusEnhancedTransactionsProvider(key);
  const [p, e] = await Promise.all([parsedP.getTrades(address), enhancedP.getTrades(address)]);
  const diffs: Array<{ field: string; a: unknown; b: unknown }> = [];
  const pSides = p.trades.map((t) => t.side).sort().join(",");
  const eSides = e.trades.map((t) => t.side).sort().join(",");
  if (pSides !== eSides) diffs.push({ field: "sides", a: pSides, b: eSides });
  if (p.trades.length !== e.trades.length) {
    diffs.push({ field: "tradeCount", a: p.trades.length, b: e.trades.length });
  }
  void compareNormalized;
  void normalizeEnhancedTx;
  void normalizeParsedEventsItem;
  void closeRoundTrips;
  return {
    address,
    parsed: { provider: p.provider, trades: p.trades.length, provenance: p.provenance },
    enhanced: { provider: e.provider, trades: e.trades.length, provenance: e.provenance },
    diffs,
  };
}
