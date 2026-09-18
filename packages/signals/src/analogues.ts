import type { PaperOrder, SentinelSignal } from "@sat/shared";

export interface SignalAnalogue {
  id: string;
  symbol: string;
  signalType: string;
  similarity: number;
  paperOutcome: "WIN" | "LOSS" | "FLAT" | "UNKNOWN" | "INSUFFICIENT";
  note: string;
  isDemo: boolean;
}

/**
 * Attach historical analogues from observed paper fills only.
 * Never invents outcomes. Thin overlap → INSUFFICIENT.
 */
export function attachAnalogues(
  signal: SentinelSignal,
  prior: SentinelSignal[],
  orders: PaperOrder[],
): SentinelSignal {
  const analogues: SignalAnalogue[] = [];
  const sameType = prior.filter(
    (p) => p.id !== signal.id && p.signalType === signal.signalType && p.asset !== signal.asset,
  );
  for (const p of sameType.slice(0, 5)) {
    const related = orders.filter((o) => o.mint === p.asset && (o.status === "FILLED" || o.status === "PARTIAL"));
    let paperOutcome: SignalAnalogue["paperOutcome"] = "INSUFFICIENT";
    if (!related.length) paperOutcome = "INSUFFICIENT";
    else {
      const pnlProxy = related.reduce((s, o) => {
        const costs = o.spreadCostUsd + o.slippageCostUsd + o.impactCostUsd + o.networkCostUsd;
        return s + (o.side === "SELL" ? o.filledUsd - costs : -costs);
      }, 0);
      paperOutcome = related.length < 2 ? "UNKNOWN" : pnlProxy > 10 ? "WIN" : pnlProxy < -10 ? "LOSS" : "FLAT";
    }
    const scoreDelta = Math.abs(p.score - signal.score);
    analogues.push({
      id: p.id,
      symbol: p.symbol,
      signalType: p.signalType,
      similarity: Math.max(0, 1 - scoreDelta / 100) * 0.8 + (p.tokenRisk === signal.tokenRisk ? 0.2 : 0),
      paperOutcome,
      note:
        paperOutcome === "INSUFFICIENT"
          ? "Not enough paper fills after the analogue signal"
          : `Observed paper proxy ${paperOutcome} — not live profitability`,
      isDemo: p.isDemo || signal.isDemo,
    });
  }
  return { ...signal, analogues };
}
