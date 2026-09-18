import {
  type AlertRule,
  type BacktestResult,
  type SentinelSignal,
  type StrategyLabConfig,
  type WalletCredibilityScore,
  DEFAULT_STRATEGY_LAB_CONFIG,
  newId,
  nowIso,
} from "@sat/shared";
import { getDatabase, type Database } from "@sat/database";
import { buildDemoOhlcv } from "@sat/market-data";
import { computeAllSignals, buildSentinelSignals } from "@sat/signals";
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
import { getProviders } from "./providers";

let alerts: AlertEngine | null = null;

export function getAlertEngine(): AlertEngine {
  if (!alerts) alerts = createDefaultAlertEngine();
  return alerts;
}

export function resetIntelligenceForTests(): void {
  alerts = null;
}

export async function listWalletIntelligence(): Promise<WalletCredibilityScore[]> {
  return listDemoWalletScores();
}

export async function analyzeWallet(address: string): Promise<WalletCredibilityScore> {
  const demo = Object.values(DEMO_WALLETS) as string[];
  if (demo.includes(address)) return analyzeDemoWallet(address);
  return scoreWallet({
    address,
    trades: [],
    isDemo: false,
    dataFreshness: "INSUFFICIENT",
  });
}

export async function walletGraphForDemo() {
  const trades = getDemoWalletTrades();
  return buildWalletGraph({ tradesByWallet: trades, isDemo: true });
}

export async function generateSmartMoneySignals(db: Database = getDatabase()): Promise<SentinelSignal[]> {
  const { onchain } = getProviders();
  const state = await db.getState();
  const wallets = listDemoWalletScores();
  const out: SentinelSignal[] = [];
  for (const asset of state.candidates.slice(0, 12)) {
    const on = await onchain.getTokenRiskInputs(asset.mint);
    const tokenRisk = assessTokenRisk(asset, on);
    const { signals } = computeAllSignals(asset, state.candidates);
    out.push(
      ...buildSentinelSignals({
        asset,
        marketSignals: signals,
        wallets,
        tokenRiskTier: tokenRisk.riskTier,
        tokenRiskScore: tokenRisk.riskScore,
      }),
    );
  }
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
  const config = { ...DEFAULT_STRATEGY_LAB_CONFIG, ...params.config, version: params.config?.version ?? DEFAULT_STRATEGY_LAB_CONFIG.version };
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
  return result;
}

export function createAlertRule(partial: Partial<AlertRule> & Pick<AlertRule, "name" | "trigger">): AlertRule {
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
  return getAlertEngine().upsertRule(rule);
}

export async function emitTestAlert(trigger: AlertRule["trigger"], title: string, body: string) {
  return getAlertEngine().emit({ trigger, title, body, isDemo: true, value: 80 });
}
