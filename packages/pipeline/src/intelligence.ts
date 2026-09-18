import {
  type AlertRule,
  type BacktestResult,
  type SentinelSignal,
  type StrategyLabConfig,
  type WalletCredibilityScore,
  type WatchlistItem,
  DEFAULT_STRATEGY_LAB_CONFIG,
  DEFAULT_RISK_CONFIG,
  newId,
  nowIso,
  SolanaAddressSchema,
} from "@sat/shared";
import { getDatabase, type Database } from "@sat/database";
import { buildDemoOhlcv } from "@sat/market-data";
import { computeAllSignals, buildSentinelSignals, attachAnalogues } from "@sat/signals";
import { assessTokenRisk } from "@sat/token-risk";
import {
  analyzeDemoWallet,
  listDemoWalletScores,
  scoreWallet,
  DEMO_WALLETS,
} from "@sat/wallet-intel";
import { buildWalletGraph } from "@sat/wallet-graph";
import { getDemoWalletTrades } from "@sat/wallet-intel";
import { runBacktest } from "@sat/backtest";
import { createDefaultAlertEngine, type AlertEngine } from "@sat/alerts";
import { assessPortfolioExposure } from "@sat/portfolio";
import { fetchJupiterTokenIntel } from "@sat/solana";
import { entitlementsFor } from "@sat/entitlements";
import type { Entitlements } from "@sat/shared";
import { getProviders } from "./providers";

let alerts: AlertEngine | null = null;

export function getAlertEngine(): AlertEngine {
  if (!alerts) alerts = createDefaultAlertEngine();
  return alerts;
}

export function resetIntelligenceForTests(): void {
  alerts = null;
}

export async function listWalletIntelligence(
  db: Database = getDatabase(),
): Promise<WalletCredibilityScore[]> {
  const stored = (await db.getState()).walletScores;
  if (stored.length) return stored;
  const scores = listDemoWalletScores();
  await db.setWalletScores(scores);
  return scores;
}

export async function analyzeWallet(
  address: string,
  db: Database = getDatabase(),
): Promise<WalletCredibilityScore> {
  const demo = Object.values(DEMO_WALLETS) as string[];
  if (demo.includes(address)) {
    const score = analyzeDemoWallet(address);
    const state = await db.getState();
    await db.setWalletScores([score, ...state.walletScores.filter((s) => s.address !== address)]);
    return score;
  }
  const { walletHistory } = getProviders();
  const history = await walletHistory.getTrades(address);
  const score = scoreWallet({
    address,
    trades: history.trades,
    isDemo: history.isDemo,
    dataFreshness: history.freshness,
  });
  const state = await db.getState();
  await db.setWalletScores([score, ...state.walletScores.filter((s) => s.address !== address)]);
  return score;
}

export async function walletGraphForDemo() {
  const trades = getDemoWalletTrades();
  return buildWalletGraph({ tradesByWallet: trades, isDemo: true });
}

export async function generateSmartMoneySignals(
  db: Database = getDatabase(),
): Promise<SentinelSignal[]> {
  const { onchain } = getProviders();
  const state = await db.getState();
  const wallets = await listWalletIntelligence(db);
  const out: SentinelSignal[] = [];
  for (const asset of state.candidates.slice(0, 12)) {
    const on = await onchain.getTokenRiskInputs(asset.mint);
    const jup = await fetchJupiterTokenIntel(asset.mint);
    const tokenRisk = assessTokenRisk(asset, {
      ...on,
      jupiterVerified: jup.verified,
      jupiterOrganicScore: jup.organicScore,
    });
    const { signals } = computeAllSignals(asset, state.candidates);
    const built = buildSentinelSignals({
      asset,
      marketSignals: signals,
      wallets,
      tokenRiskTier: tokenRisk.riskTier,
      tokenRiskScore: tokenRisk.riskScore,
    });
    for (const s of built) {
      out.push(attachAnalogues(s, [...out, ...state.sentinelSignals], state.orders));
    }
  }
  await db.setSentinelSignals(out);
  return out;
}

export async function runStrategyLab(params: {
  mint?: string;
  config?: Partial<StrategyLabConfig>;
  walkForward?: boolean;
  db?: Database;
}): Promise<BacktestResult> {
  const db = params.db ?? getDatabase();
  const { market } = getProviders();
  const state = await db.getState();
  const asset =
    (params.mint ? state.candidates.find((c) => c.mint === params.mint) : state.candidates[0]) ??
    state.candidates[0];
  if (!asset) {
    throw new Error("No candidate available for backtest");
  }
  let bars = await market.getOhlcv(asset.mint, "1h", 180);
  if (!bars.length) {
    bars = buildDemoOhlcv({
      mint: asset.mint,
      lastClose: asset.priceUsd ?? 1,
      interval: "1h",
      count: 180,
      endMs: Date.now(),
    });
  }
  const sol = await market.getOhlcv("So11111111111111111111111111111111111111112", "1h", 180);
  const config = {
    ...DEFAULT_STRATEGY_LAB_CONFIG,
    ...params.config,
    version: params.config?.version ?? DEFAULT_STRATEGY_LAB_CONFIG.version,
  };
  const result = runBacktest({
    markets: [
      {
        mint: asset.mint,
        bars,
        liquidityUsd: asset.liquidityUsd,
        tokenAgeHours: asset.tokenAgeHours,
        tokenRiskScore: state.tokenRisk.find((t) => t.mint === asset.mint)?.riskScore ?? 25,
        confirmingWallets: 2,
        walletCredibility: 72,
      },
    ],
    config,
    benchmark: sol.length ? sol : bars,
    isDemo: Boolean(asset.isDemo || market.isDemo),
    walkForward: params.walkForward ?? true,
  });
  await db.addBacktest(result);
  return result;
}

export function createAlertRule(
  partial: Partial<AlertRule> & Pick<AlertRule, "name" | "trigger">,
  db?: Database,
): AlertRule {
  const rule: AlertRule = {
    id: partial.id ?? newId(),
    name: partial.name,
    trigger: partial.trigger,
    channel: partial.channel ?? "INTERNAL",
    threshold: partial.threshold ?? null,
    mint: partial.mint ?? null,
    wallet: partial.wallet ?? null,
    cooldownMinutes: partial.cooldownMinutes ?? 30,
    quietHoursUtc: partial.quietHoursUtc ?? null,
    enabled: partial.enabled ?? true,
    createdAt: partial.createdAt ?? nowIso(),
    isDemo: partial.isDemo ?? true,
  };
  getAlertEngine().upsertRule(rule);
  void (db ?? getDatabase()).addAlertRule(rule);
  return rule;
}

export async function emitTestAlert(trigger: AlertRule["trigger"], title: string, body: string) {
  return getAlertEngine().emit({ trigger, title, body, isDemo: true, value: 80 });
}

export async function addWatchlistItem(input: {
  kind: WatchlistItem["kind"];
  address: string;
  label?: string;
  entitlements?: Entitlements;
  db?: Database;
}): Promise<WatchlistItem> {
  const parsed = SolanaAddressSchema.safeParse(input.address);
  if (!parsed.success) throw new Error("Invalid address");
  const db = input.db ?? getDatabase();
  const state = await db.getState();
  const entitlements = input.entitlements ?? entitlementsFor("FREE");
  if (state.watchlist.length >= entitlements.maxWatchlist) {
    throw new Error("WATCHLIST_LIMIT");
  }
  if (state.watchlist.some((w) => w.address === parsed.data && w.kind === input.kind)) {
    return state.watchlist.find((w) => w.address === parsed.data && w.kind === input.kind)!;
  }
  const item: WatchlistItem = {
    id: newId(),
    kind: input.kind,
    address: parsed.data,
    label: input.label,
    addedAt: nowIso(),
  };
  await db.setWatchlist([item, ...state.watchlist]);
  return item;
}

export async function removeWatchlistItem(id: string, db: Database = getDatabase()): Promise<void> {
  const state = await db.getState();
  await db.setWatchlist(state.watchlist.filter((w) => w.id !== id));
}

export async function portfolioRiskSnapshot(db: Database = getDatabase()) {
  const state = await db.getState();
  return assessPortfolioExposure(state.portfolio, state.positions, {
    maxPositionUsd: DEFAULT_RISK_CONFIG.maxPositionUsd,
    maxSimultaneousPositions: DEFAULT_RISK_CONFIG.maxSimultaneousPositions,
    maxPortfolioExposurePct: DEFAULT_RISK_CONFIG.maxPortfolioExposurePct,
    maxDrawdownPct: DEFAULT_RISK_CONFIG.maxDrawdownPct,
  });
}
