import {
  type AlertRule,
  type BacktestResult,
  type SentinelSignal,
  type StrategyLabConfig,
  type WalletCredibilityScore,
  type WalletFlowEvidence,
  type WalletTrade,
  type WatchlistItem,
  DEFAULT_STRATEGY_LAB_CONFIG,
  DEFAULT_RISK_CONFIG,
  newId,
  nowIso,
  SolanaAddressSchema,
  AlertRuleSchema,
  WSOL,
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
let persistentAlerts = new WeakMap<Database, Promise<AlertEngine>>();

export function getAlertEngine(): AlertEngine {
  if (!alerts) alerts = createDefaultAlertEngine();
  return alerts;
}

export async function getPersistentAlertEngine(db: Database = getDatabase()): Promise<AlertEngine> {
  let pending = persistentAlerts.get(db);
  if (!pending) {
    pending = (async () => {
      const state = await db.getState();
      const engine = createDefaultAlertEngine();
      engine.restoreRules(state.alertRules);
      engine.restoreHistory(state.alertEvents);
      engine.setEventRecorder((event, cooldown) => db.recordAlertEvent(event, cooldown));
      return engine;
    })();
    persistentAlerts.set(db, pending);
    pending.catch(() => { if (persistentAlerts.get(db) === pending) persistentAlerts.delete(db); });
  }
  const engine = await pending;
  engine.restoreRules((await db.getState()).alertRules);
  return engine;
}

export function resetIntelligenceForTests(): void {
  alerts = null;
  persistentAlerts = new WeakMap();
}

export async function listWalletIntelligence(
  db: Database = getDatabase(),
): Promise<WalletCredibilityScore[]> {
  const state = await db.getState();
  const liveOnly = state.candidates.length > 0 && state.candidates.every((c) => !c.isDemo);
  const stored = liveOnly ? state.walletScores.filter((s) => !s.isDemo) : state.walletScores;
  if (stored.length) return stored;
  if (!getProviders().walletHistory.isDemo || state.candidates.some((c) => !c.isDemo)) return [];
  const scores = listDemoWalletScores();
  await db.setWalletScores(scores);
  return scores;
}

export async function analyzeWallet(
  address: string,
  db: Database = getDatabase(),
  opts: { live?: boolean } = {},
): Promise<WalletCredibilityScore> {
  const demo = Object.values(DEMO_WALLETS) as string[];
  const state = await db.getState();
  const liveOnly = state.candidates.length > 0 && state.candidates.every((c) => !c.isDemo);
  if (!opts.live && !liveOnly && demo.includes(address)) {
    const score = analyzeDemoWallet(address);
    await db.upsertWalletScore(score);
    return score;
  }
  const { walletHistory } = getProviders();
  if ((opts.live || liveOnly) && walletHistory.isDemo) {
    throw new Error("LIVE_WALLET_HISTORY_UNAVAILABLE — demo history cannot support live analysis");
  }
  const history = await walletHistory.getTrades(address);
  if ((opts.live || liveOnly) && history.isDemo) {
    throw new Error("LIVE_WALLET_HISTORY_UNAVAILABLE — provider returned demo history");
  }
  const score = scoreWallet({
    address,
    trades: history.trades,
    isDemo: history.isDemo,
    dataFreshness: history.freshness,
  });
  await db.upsertWalletScore(score);
  return score;
}

export async function walletGraphForDemo() {
  const trades = getDemoWalletTrades();
  return buildWalletGraph({ tradesByWallet: trades, isDemo: true });
}

export async function generateSmartMoneySignals(
  db: Database = getDatabase(),
): Promise<SentinelSignal[]> {
  const { onchain, walletHistory } = getProviders();
  const state = await db.getState();
  const wallets = await listWalletIntelligence(db);
  const tracked = state.watchlist.filter((w) => w.kind === "WALLET").slice(0, 8);
  const trackedAddresses = walletHistory.isDemo && state.candidates.some((c) => c.isDemo)
    ? [...new Set([...tracked.map((w) => w.address), ...Object.values(DEMO_WALLETS)])]
    : walletHistory.isDemo ? [] : tracked.map((w) => w.address);
  const walletFlowEvidence: WalletFlowEvidence[] = [];
  const tradesByWallet: Record<string, WalletTrade[]> = {};
  for (const address of trackedAddresses) {
    try {
      const history = await walletHistory.getTrades(address);
      if (history.isDemo !== walletHistory.isDemo) continue;
      tradesByWallet[address] = history.trades;
      const score = history.isDemo && new Set<string>(Object.values(DEMO_WALLETS)).has(address)
        ? analyzeDemoWallet(address)
        : scoreWallet({
            address,
            trades: history.trades,
            isDemo: history.isDemo,
            dataFreshness: history.freshness,
          });
      wallets.splice(0, wallets.length, score, ...wallets.filter((s) => s.address !== address));
      await db.upsertWalletScore(score);
      for (const trade of history.trades) {
        if (trade.side !== "BUY" && trade.side !== "SELL") continue;
        if (!Number.isFinite(trade.qty) || trade.qty <= 0) continue;
        if (!history.isDemo && (trade.classificationConfidence == null || trade.classificationConfidence < 0.75)) continue;
        const sourceSignature = trade.sourceSignature ?? (history.isDemo ? trade.signature : null);
        if (!sourceSignature) continue;
        walletFlowEvidence.push({
          wallet: address, mint: trade.mint, signature: sourceSignature,
          side: trade.side, qty: trade.qty, timestamp: trade.timestamp,
          provider: trade.provider || history.provider,
          freshness: history.freshness, isDemo: history.isDemo,
        });
      }
    } catch {
      /* unavailable or invalid wallet history contributes no flow evidence */
    }
  }
  const out: SentinelSignal[] = [];
  const walletClusters = buildWalletGraph({ tradesByWallet, isDemo: walletHistory.isDemo }).clusters;
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
      walletFlowEvidence,
      walletClusters,
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
  const bars = asset.isDemo === market.isDemo ? await market.getOhlcv(asset.mint, "1h", 180) : [];
  const sol = market.isDemo && bars.length
    ? buildDemoOhlcv({ mint: WSOL, lastClose: 148.2, interval: "1h", count: bars.length, endMs: bars[bars.length - 1]!.timestamp })
    : await market.getOhlcv(WSOL, "1h", 180);
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
        liquidityUsd: market.isDemo && asset.isDemo ? asset.liquidityUsd : null,
        tokenAgeHours: market.isDemo && asset.isDemo ? asset.tokenAgeHours : null,
        tokenRiskScore: market.isDemo && asset.isDemo
          ? (state.tokenRisk.find((t) => t.mint === asset.mint)?.riskScore ?? 25)
          : null,
        confirmingWallets: market.isDemo && asset.isDemo ? 2 : undefined,
        walletCredibility: market.isDemo && asset.isDemo ? 72 : undefined,
      },
    ],
    config,
    benchmark: sol,
    isDemo: Boolean(asset.isDemo && market.isDemo),
    walkForward: params.walkForward ?? true,
  });
  await db.addBacktest(result);
  return result;
}

export async function createAlertRule(
  partial: Partial<AlertRule> & Pick<AlertRule, "name" | "trigger">,
  db?: Database,
): Promise<AlertRule> {
  const rule = AlertRuleSchema.parse({
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
    isDemo: partial.isDemo ?? !(process.env.SAT_WALLET_HISTORY_SOURCE === "journal" &&
      !!process.env.DATABASE_URL && ["TRACKED_WALLET_BUY", "TRACKED_WALLET_SELL"].includes(partial.trigger)),
  });
  const database = db ?? getDatabase();
  await database.addAlertRule(rule);
  (await getPersistentAlertEngine(database)).upsertRule(rule);
  return rule;
}

export async function emitTestAlert(trigger: AlertRule["trigger"], title: string, body: string) {
  return (await getPersistentAlertEngine()).emit({ trigger, title, body, isDemo: true, value: 80 });
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
  const entitlements = input.entitlements ?? entitlementsFor("FREE");
  const item: WatchlistItem = {
    id: newId(),
    kind: input.kind,
    address: parsed.data,
    label: input.label,
    addedAt: nowIso(),
  };
  return db.addWatchlistItem(item, entitlements.maxWatchlist);
}

export async function removeWatchlistItem(id: string, db: Database = getDatabase()): Promise<void> {
  await db.removeWatchlistItem(id);
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
