"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { usd, pct } from "@/lib/utils";

type Health = {
  operatingMode: string;
  liveTradingAllowed: boolean;
  canBroadcast: boolean;
  persistence: string;
  demoMode: boolean;
  publicDemo?: boolean;
  marketDataProvider?: string;
  onChainProvider?: string;
  researchProvider?: string;
  executionProvider?: string;
  navUsd: number;
  drawdownPct: number;
  providers: Record<string, string | boolean>;
};

type StatePayload = {
  candidates: Array<{
    mint: string;
    symbol: string;
    name: string;
    priceUsd: number | null;
    liquidityUsd: number | null;
    volume24hUsd: number | null;
    priceChange24hPct: number | null;
    isDemo: boolean;
    riskFlags: string[];
  }>;
  proposals: Array<{
    id: string;
    mint: string;
    symbol: string;
    sizeUsd: number;
    status: string;
    score: { compositeScore: number; explanation: string[]; components: Record<string, number> };
    tokenRisk: {
      riskScore: number;
      riskTier: string;
      riskFlags: string[];
      riskReasons: string[];
      dataConfidence: number;
    };
    policy: { decision: string; reasons: string[] };
    risk: { decision: string; reasons: string[]; approvedSizeUsd: number };
    research?: { thesis: string; catalysts: string[]; isMock: boolean };
    signals: Array<{ name: string; normalizedScore: number; confidence: number }>;
  }>;
  orders: Array<{
    id: string;
    mint: string;
    side: string;
    filledUsd: number;
    status: string;
    spreadCostUsd: number;
    slippageCostUsd: number;
    impactCostUsd: number;
    networkCostUsd: number;
    createdAt: string;
    provenance: { reasons: string[]; strategyConfigVersion: string };
  }>;
  positions: Array<{
    symbol: string;
    mint: string;
    qty: number;
    avgEntryUsd: number;
    markUsd: number;
    unrealizedPnlUsd: number;
  }>;
  portfolio: {
    navUsd: number;
    cashUsd: number;
    positionsValueUsd: number;
    drawdownPct: number;
    peakNavUsd: number;
  };
  events: Array<{ type: string; message: string; timestamp: string; mint?: string }>;
  scores: Array<{ mint: string; compositeScore: number }>;
  experiments: Array<{
    experiment: { name: string; strategy: { version: string } };
    strategyMetrics: {
      totalReturnPct: number;
      maxDrawdownPct: number;
      sharpe: number | null;
      warnings: string[];
      costDragUsd: number;
    } | null;
    baselines: {
      solBuyHold: { totalReturnPct: number } | null;
      cash: { totalReturnPct: number } | null;
      mechanicalMomentum: { totalReturnPct: number } | null;
    };
    notes: string[];
    dataQuality?: string;
    isDemo?: boolean;
  }>;
  equityHistory: Array<{ t: string; nav: number }>;
  health: Health;
  operatingMode: string;
  wallets?: Array<{
    address: string;
    score: number;
    confidence: number;
    sampleSize: number;
    reasonCodes: string[];
    positiveEvidence: string[];
    negativeEvidence: string[];
    dataFreshness: string;
    isDemo: boolean;
    neverGuaranteed: true;
  }>;
  sentinelSignals?: Array<{
    id: string;
    symbol: string;
    signalType: string;
    score: number;
    confidence: number;
    explanation: string[];
    invalidationConditions: string[];
    tokenRisk: string;
    isDemo: boolean;
  }>;
};

async function fetchState(): Promise<StatePayload> {
  const res = await fetch("/api/state", { cache: "no-store" });
  if (!res.ok) throw new Error("Failed to load state");
  const s = (await res.json()) as StatePayload;
  if (s.candidates.length === 0) {
    const boot = await fetch("/api/state", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "bootstrap" }),
    });
    if (boot.ok) return boot.json() as Promise<StatePayload>;
    const again = await fetch("/api/state", { cache: "no-store" });
    if (!again.ok) throw new Error("Failed to bootstrap demo state");
    return again.json() as Promise<StatePayload>;
  }
  return s;
}

async function postAction(action: string, extra: Record<string, string> = {}) {
  const res = await fetch("/api/state", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...extra }),
  });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? data.code ?? "Action failed");
  return data;
}

function Sparkline({ values }: { values: number[] }) {
  const pts = useMemo(() => {
    if (values.length < 2) return "";
    const min = Math.min(...values);
    const max = Math.max(...values);
    const w = 240;
    const h = 56;
    return values
      .map((v, i) => {
        const x = (i / (values.length - 1)) * w;
        const y = h - ((v - min) / (max - min || 1)) * (h - 4) - 2;
        return `${x},${y}`;
      })
      .join(" ");
  }, [values]);
  return (
    <svg viewBox="0 0 240 56" className="h-14 w-full" role="img" aria-label="Equity curve">
      <polyline fill="none" stroke="#3d9cf0" strokeWidth="2" points={pts} />
    </svg>
  );
}

function Pill({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "neutral" | "good" | "warn" | "bad" | "demo";
}) {
  const colors = {
    neutral: "border-[var(--line)] text-[var(--muted)]",
    good: "border-[var(--good)] text-[var(--good)]",
    warn: "border-[var(--warn)] text-[var(--warn)]",
    bad: "border-[var(--bad)] text-[var(--bad)]",
    demo: "border-[var(--demo)] text-[var(--demo)]",
  }[tone];
  return (
    <span className={`inline-flex border px-2 py-0.5 text-[11px] uppercase tracking-wide ${colors}`}>
      {children}
    </span>
  );
}

export default function DashboardPage() {
  const [data, setData] = useState<StatePayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedMint, setSelectedMint] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [view, setView] = useState<"terminal" | "wallets" | "signals" | "lab" | "alerts">("terminal");
  const [labMint, setLabMint] = useState<string>("");
  const [backtest, setBacktest] = useState<{
    metrics: { totalReturnPct: number; maxDrawdownPct: number; tradeCount: number } | null;
    warnings: string[];
    equity: number[];
    label: string;
  } | null>(null);

  const reload = useCallback(() => {
    startTransition(async () => {
      try {
        setError(null);
        const s = await fetchState();
        setData(s);
        if (!selectedMint && s.candidates[0]) setSelectedMint(s.candidates[0].mint);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  }, [selectedMint]);

  useEffect(() => {
    reload();
  }, [reload]);

  const run = (action: string, extra?: Record<string, string>) => {
    startTransition(async () => {
      try {
        setMsg(null);
        const result = await postAction(action, extra);
        if (action === "paper_execute") {
          setMsg(
            `Paper fill ${result.order.status}: $${Number(result.order.filledUsd).toFixed(2)} (broadcast disabled)`,
          );
        } else {
          setMsg(`Action ${action} completed`);
        }
        const s = await fetchState();
        setData(s);
      } catch (e) {
        setMsg(e instanceof Error ? e.message : String(e));
      }
    });
  };

  const selectedProposal = data?.proposals.find((p) => p.mint === selectedMint);
  const selectedCandidate = data?.candidates.find((c) => c.mint === selectedMint);
  const costDrag =
    data?.orders.reduce(
      (s, o) => s + o.spreadCostUsd + o.slippageCostUsd + o.impactCostUsd + o.networkCostUsd,
      0,
    ) ?? 0;

  return (
    <div className="min-h-screen" data-testid="dashboard-root">
      <div className="demo-banner px-4 py-2 text-center text-sm" data-testid="banner-mode">
        <strong className="brand">DEMO / PAPER ONLY</strong>
        <span className="mx-2">·</span>
        Live broadcasting is hard-disabled. Not investment advice. Simulated fills only.
      </div>

      <header className="border-b border-[var(--line)] px-4 py-5 md:px-8">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div className="anim-fade">
            <p className="text-xs uppercase tracking-[0.25em] text-[var(--muted)]">
              Solana Agentic Trading Research Platform
            </p>
            <h1 className="brand mt-1 text-3xl text-[var(--text)] md:text-4xl">Solana Sentinel</h1>
            <p className="mt-2 max-w-xl text-sm text-[var(--muted)]">
              Scan assets, explain signals and token risk, enforce deterministic policy, and
              simulate paper fills with provenance. Live trading is off.
            </p>
          </div>
          <div className="anim-fade anim-delay-1 flex flex-wrap items-center gap-2">
            <Pill tone="demo">
              <span data-testid="pill-operating-mode">{data?.operatingMode ?? "…"}</span>
            </Pill>
            <Pill>
              <span data-testid="health-live-allowed">
                LIVE {data?.health?.liveTradingAllowed ? "ON" : "OFF"}
              </span>
            </Pill>
            <Pill>
              <span data-testid="health-can-broadcast">
                canBroadcast={String(data?.health?.canBroadcast ?? false)}
              </span>
            </Pill>
            <Pill tone={data?.health?.persistence === "memory" ? "warn" : "good"}>
              <span data-testid="health-persistence">
                persistence: {data?.health?.persistence ?? "…"}
              </span>
            </Pill>
            {data?.health?.publicDemo ? (
              <Pill tone="demo">
                <span data-testid="health-public-demo">PUBLIC DEMO</span>
              </Pill>
            ) : null}
            <span className="live-dot ml-2 h-2 w-2 rounded-full bg-[var(--accent)]" />
          </div>
        </div>
      </header>

      <main className="mx-auto grid max-w-7xl gap-4 px-4 py-6 md:px-8">
        {error && (
          <div className="panel border-[var(--bad)] p-4 text-[var(--bad)]">
            Failed to load dashboard: {error}
          </div>
        )}
        {!data && !error && (
          <div className="panel p-8 text-center text-[var(--muted)]">Loading research state…</div>
        )}

        {data && (
          <>
            <nav className="flex flex-wrap gap-2" data-testid="terminal-nav">
              {(
                [
                  ["terminal", "Terminal"],
                  ["wallets", "Wallets"],
                  ["signals", "Signals"],
                  ["lab", "Strategy Lab"],
                  ["alerts", "Alerts"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  data-testid={`tab-${id}`}
                  className={`border px-3 py-1.5 text-xs uppercase tracking-wide ${
                    view === id
                      ? "border-[var(--accent)] text-[var(--accent)]"
                      : "border-[var(--line)] text-[var(--muted)]"
                  }`}
                  onClick={() => setView(id)}
                >
                  {label}
                </button>
              ))}
            </nav>
            {msg && (
              <p className="text-xs text-[var(--accent-2)]" data-testid="action-msg">
                {msg}
              </p>
            )}
          {view === "terminal" && (
          <>
            <section className="anim-fade grid gap-4 md:grid-cols-4">
              <div className="panel p-4 md:col-span-2">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-xs uppercase tracking-wide text-[var(--muted)]">Equity / NAV</p>
                    <p className="mono mt-1 text-3xl">{usd(data.portfolio.navUsd)}</p>
                    <p className="mt-1 text-sm text-[var(--muted)]">
                      Cash {usd(data.portfolio.cashUsd)} · Positions{" "}
                      {usd(data.portfolio.positionsValueUsd)}
                    </p>
                  </div>
                  <div className="text-right text-sm">
                    <p className="text-[var(--muted)]">Drawdown</p>
                    <p className="mono text-[var(--warn)]">
                      {(data.portfolio.drawdownPct * 100).toFixed(2)}%
                    </p>
                    <p className="mt-2 text-[var(--muted)]">Cost drag</p>
                    <p className="mono">{usd(costDrag)}</p>
                  </div>
                </div>
                <div className="mt-4">
                  <Sparkline values={data.equityHistory.map((e) => e.nav)} />
                </div>
              </div>
              <div className="panel p-4">
                <p className="text-xs uppercase tracking-wide text-[var(--muted)]">Benchmarks</p>
                {data.experiments[0]?.dataQuality === "INSUFFICIENT_HISTORY" ||
                !data.experiments[0]?.strategyMetrics ? (
                  <p className="mt-3 text-sm text-[var(--warn)]" data-testid="experiment-insufficient">
                    INSUFFICIENT HISTORY — metrics hidden. DEMO DATA / not a verified performance path.
                  </p>
                ) : data.experiments[0] ? (
                  <ul className="mt-3 space-y-2 text-sm">
                    <li className="flex justify-between">
                      <span>Strategy (DEMO DATA)</span>
                      <span className="mono">
                        {pct(data.experiments[0].strategyMetrics.totalReturnPct)}
                      </span>
                    </li>
                    <li className="flex justify-between">
                      <span>SOL B&amp;H</span>
                      <span className="mono">
                        {data.experiments[0].baselines.solBuyHold
                          ? pct(data.experiments[0].baselines.solBuyHold.totalReturnPct)
                          : "—"}
                      </span>
                    </li>
                    <li className="flex justify-between">
                      <span>Cash</span>
                      <span className="mono">
                        {data.experiments[0].baselines.cash
                          ? pct(data.experiments[0].baselines.cash.totalReturnPct)
                          : "—"}
                      </span>
                    </li>
                    <li className="flex justify-between">
                      <span>Mechanical</span>
                      <span className="mono">
                        {data.experiments[0].baselines.mechanicalMomentum
                          ? pct(data.experiments[0].baselines.mechanicalMomentum.totalReturnPct)
                          : "—"}
                      </span>
                    </li>
                  </ul>
                ) : (
                  <p className="mt-3 text-sm text-[var(--muted)]">No experiment yet</p>
                )}
              </div>
              <div className="panel p-4">
                <p className="text-xs uppercase tracking-wide text-[var(--muted)]">System health</p>
                <ul className="mt-3 space-y-2 text-sm text-[var(--muted)]">
                  <li>Market: {data.health.providers.market}</li>
                  <li>On-chain: {data.health.providers.onchain}</li>
                  <li>Execution: {data.health.providers.execution}</li>
                  <li>Research: {data.health.providers.research}</li>
                </ul>
                <div className="mt-4 flex flex-wrap gap-2">
                  {!data.health.publicDemo && (
                    <>
                  <button
                    className="border border-[var(--line)] bg-[var(--bg-2)] px-3 py-1.5 text-xs hover:border-[var(--accent)]"
                    disabled={pending}
                    data-testid="btn-research-pass"
                    onClick={() => run("research_pass")}
                  >
                    Run research pass
                  </button>
                  <button
                    className="border border-[var(--line)] bg-[var(--bg-2)] px-3 py-1.5 text-xs hover:border-[var(--accent)]"
                    disabled={pending}
                    data-testid="btn-experiment"
                    onClick={() => run("experiment")}
                  >
                    Replay experiment
                  </button>
                  <button
                    className="border border-[var(--line)] bg-[var(--bg-2)] px-3 py-1.5 text-xs hover:border-[var(--demo)]"
                    disabled={pending}
                    data-testid="btn-reset"
                    onClick={() => run("reset")}
                  >
                    Reset demo
                  </button>
                    </>
                  )}
                </div>
                {msg && (
                  <p className="mt-3 text-xs text-[var(--accent-2)]">
                    {msg}
                  </p>
                )}
              </div>
            </section>

            <section className="anim-fade anim-delay-1 grid gap-4 lg:grid-cols-5">
              <div className="panel lg:col-span-2">
                <div className="border-b border-[var(--line)] px-4 py-3">
                  <h2 className="text-sm font-semibold tracking-wide">Opportunity feed</h2>
                  <p className="text-xs text-[var(--muted)]">Demo-labeled candidates · click for detail</p>
                </div>
                <div className="max-h-[420px] overflow-auto">
                  {data.candidates.map((c) => {
                    const score = data.scores.find((s) => s.mint === c.mint)?.compositeScore;
                    const prop = data.proposals.find((p) => p.mint === c.mint);
                    return (
                      <button
                        key={c.mint}
                        data-testid={`candidate-${c.symbol}`}
                        onClick={() => setSelectedMint(c.mint)}
                        className={`flex w-full items-center justify-between border-b border-[var(--line)] px-4 py-3 text-left hover:bg-[var(--bg-2)] ${
                          selectedMint === c.mint ? "bg-[var(--bg-2)]" : ""
                        }`}
                      >
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{c.symbol}</span>
                            {c.isDemo && <Pill tone="demo">DEMO</Pill>}
                            {prop && (
                              <Pill
                                tone={
                                  prop.status === "REJECTED"
                                    ? "bad"
                                    : prop.status === "ACCEPTED_PAPER"
                                      ? "good"
                                      : "warn"
                                }
                              >
                                <span data-testid={`proposal-status-${c.symbol}`}>{prop.status}</span>
                              </Pill>
                            )}
                          </div>
                          <p className="text-xs text-[var(--muted)]">{c.name}</p>
                        </div>
                        <div className="text-right mono text-sm">
                          <div>{usd(c.priceUsd, c.priceUsd && c.priceUsd < 0.01 ? 6 : 2)}</div>
                          <div className="text-xs text-[var(--muted)]">
                            score {score != null ? score.toFixed(1) : "—"} · {pct(c.priceChange24hPct)}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="panel lg:col-span-3">
                <div className="border-b border-[var(--line)] px-4 py-3">
                  <h2 className="text-sm font-semibold tracking-wide">Token detail & provenance</h2>
                </div>
                {!selectedCandidate ? (
                  <p className="p-4 text-sm text-[var(--muted)]">Select a token</p>
                ) : (
                  <div className="grid gap-4 p-4 md:grid-cols-2">
                    <div>
                      <h3 className="brand text-2xl">{selectedCandidate.symbol}</h3>
                      <p className="text-sm text-[var(--muted)]">{selectedCandidate.name}</p>
                      <p className="mono mt-2 break-all text-xs text-[var(--muted)]">
                        {selectedCandidate.mint}
                      </p>
                      <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
                        <div>
                          <p className="text-[var(--muted)]">Liquidity</p>
                          <p className="mono">{usd(selectedCandidate.liquidityUsd, 0)}</p>
                        </div>
                        <div>
                          <p className="text-[var(--muted)]">Volume 24h</p>
                          <p className="mono">{usd(selectedCandidate.volume24hUsd, 0)}</p>
                        </div>
                      </div>
                      {selectedProposal && (
                        <div className="mt-4 flex flex-wrap gap-2">
                          <button
                            className="border border-[var(--accent)] bg-[var(--bg-3)] px-3 py-2 text-xs"
                            data-testid="btn-paper-execute"
                            disabled={
                              pending ||
                              Boolean(data.health.publicDemo) ||
                              selectedProposal.status === "REJECTED" ||
                              selectedProposal.status === "ACCEPTED_PAPER" ||
                              data.operatingMode === "READ_ONLY"
                            }
                            onClick={() =>
                              run("paper_execute", { proposalId: selectedProposal.id })
                            }
                          >
                            Simulate paper trade
                          </button>
                          <button
                            className="border border-[var(--line)] px-3 py-2 text-xs"
                            disabled={pending}
                            onClick={() => run("evaluate", { mint: selectedCandidate.mint })}
                          >
                            Re-evaluate
                          </button>
                        </div>
                      )}
                    </div>
                    <div className="space-y-3 text-sm">
                      {selectedProposal ? (
                        <>
                          <div>
                            <p className="text-xs uppercase text-[var(--muted)]">Composite score</p>
                            <p className="mono text-2xl">
                              {selectedProposal.score.compositeScore.toFixed(1)}
                            </p>
                            <ul className="mt-1 text-xs text-[var(--muted)]">
                              {selectedProposal.score.explanation.map((e) => (
                                <li key={e}>{e}</li>
                              ))}
                            </ul>
                          </div>
                          <div>
                            <p className="text-xs uppercase text-[var(--muted)]">Token risk</p>
                            <div className="mt-1 flex flex-wrap gap-2">
                              <Pill
                                tone={
                                  selectedProposal.tokenRisk.riskTier === "HIGH_RISK"
                                    ? "bad"
                                    : selectedProposal.tokenRisk.riskTier === "LOWER_RISK"
                                      ? "good"
                                      : "warn"
                                }
                              >
                                {selectedProposal.tokenRisk.riskTier}
                              </Pill>
                              <span className="mono">
                                score {selectedProposal.tokenRisk.riskScore}
                              </span>
                            </div>
                            <p className="mt-1 text-xs text-[var(--muted)]">
                              {selectedProposal.tokenRisk.riskReasons[0]}
                            </p>
                          </div>
                          <div>
                            <p className="text-xs uppercase text-[var(--muted)]">Policy</p>
                            <Pill
                              tone={
                                selectedProposal.policy.decision === "APPROVED"
                                  ? "good"
                                  : selectedProposal.policy.decision === "REJECTED"
                                    ? "bad"
                                    : "warn"
                              }
                            >
                              {selectedProposal.policy.decision}
                            </Pill>
                            <p className="mt-1 text-xs text-[var(--muted)]">
                              {selectedProposal.policy.reasons[0]}
                            </p>
                          </div>
                          <div>
                            <p className="text-xs uppercase text-[var(--muted)]">Portfolio risk</p>
                            <Pill
                              tone={
                                selectedProposal.risk.decision === "APPROVE"
                                  ? "good"
                                  : selectedProposal.risk.decision === "REDUCE_SIZE"
                                    ? "warn"
                                    : "bad"
                              }
                            >
                              {selectedProposal.risk.decision}
                            </Pill>
                            <p className="mt-1 text-xs text-[var(--muted)]">
                              Approved size {usd(selectedProposal.risk.approvedSizeUsd)}
                            </p>
                          </div>
                        </>
                      ) : (
                        <p className="text-[var(--muted)]">No proposal yet — run research pass.</p>
                      )}
                    </div>
                    {selectedProposal && (
                      <div className="md:col-span-2">
                        <p className="text-xs uppercase text-[var(--muted)]">Signal decomposition</p>
                        <div className="mt-2 grid grid-cols-2 gap-2 md:grid-cols-4">
                          {selectedProposal.signals.map((s) => (
                            <div key={s.name} className="border border-[var(--line)] p-2">
                              <p className="text-[11px] uppercase text-[var(--muted)]">{s.name}</p>
                              <p className="mono text-sm">{s.normalizedScore.toFixed(3)}</p>
                              <p className="text-[11px] text-[var(--muted)]">
                                conf {(s.confidence * 100).toFixed(0)}%
                              </p>
                            </div>
                          ))}
                        </div>
                        {selectedProposal.research && (
                          <div className="mt-4 border border-[var(--line)] p-3">
                            <div className="flex items-center gap-2">
                              <p className="text-xs uppercase text-[var(--muted)]">Research brief</p>
                              {selectedProposal.research.isMock && <Pill tone="demo">MOCK LLM</Pill>}
                            </div>
                            <p className="mt-2 text-sm">{selectedProposal.research.thesis}</p>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </section>

            <section className="anim-fade anim-delay-2 grid gap-4 lg:grid-cols-3">
              <div className="panel">
                <div className="border-b border-[var(--line)] px-4 py-3">
                  <h2 className="text-sm font-semibold">Paper positions</h2>
                </div>
                <div className="max-h-64 overflow-auto p-2">
                  {data.positions.length === 0 && (
                    <p className="p-2 text-sm text-[var(--muted)]">No open positions</p>
                  )}
                  {data.positions.map((p) => (
                    <div
                      key={p.mint}
                      data-testid={`position-${p.symbol}`}
                      className="flex items-center justify-between border-b border-[var(--line)] px-2 py-2 text-sm"
                    >
                      <div>
                        <p className="font-medium">{p.symbol}</p>
                        <p className="mono text-xs text-[var(--muted)]">
                          qty {p.qty.toPrecision(4)} @ {usd(p.avgEntryUsd)}
                        </p>
                      </div>
                      <div className="text-right mono">
                        <p>{usd(p.qty * p.markUsd)}</p>
                        <p className={p.unrealizedPnlUsd >= 0 ? "text-[var(--good)]" : "text-[var(--bad)]"}>
                          {usd(p.unrealizedPnlUsd)}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="panel">
                <div className="border-b border-[var(--line)] px-4 py-3">
                  <h2 className="text-sm font-semibold">Trade ledger</h2>
                </div>
                <div className="max-h-64 overflow-auto p-2">
                  {data.orders.length === 0 && (
                    <p className="p-2 text-sm text-[var(--muted)]">No paper orders yet</p>
                  )}
                  {data.orders.map((o) => (
                    <div
                      key={o.id}
                      data-testid="ledger-order"
                      className="border-b border-[var(--line)] px-2 py-2 text-sm"
                    >
                      <div className="flex justify-between">
                        <span>
                          {o.side} · <span className="mono">{o.status}</span>
                        </span>
                        <span className="mono">{usd(o.filledUsd)}</span>
                      </div>
                      <p className="text-xs text-[var(--muted)]">
                        costs{" "}
                        {usd(
                          o.spreadCostUsd + o.slippageCostUsd + o.impactCostUsd + o.networkCostUsd,
                        )}{" "}
                        · {o.provenance.strategyConfigVersion}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
              <div className="panel">
                <div className="border-b border-[var(--line)] px-4 py-3">
                  <h2 className="text-sm font-semibold">System events</h2>
                </div>
                <div className="max-h-64 overflow-auto p-2">
                  {data.events.slice(0, 40).map((e, i) => (
                    <div key={`${e.timestamp}-${i}`} className="border-b border-[var(--line)] px-2 py-2 text-xs">
                      <p className="mono text-[var(--accent-2)]">{e.type}</p>
                      <p className="text-[var(--muted)]">{e.message}</p>
                    </div>
                  ))}
                </div>
              </div>
            </section>

            {data.experiments[0] && (
              <section className="anim-fade anim-delay-3 panel p-4">
                <h2 className="text-sm font-semibold">Experiment / benchmark notes</h2>
                <p className="mt-2 text-sm text-[var(--muted)]">
                  {data.experiments[0].notes.join(" · ")}
                </p>
                {data.experiments[0].strategyMetrics?.warnings &&
                  data.experiments[0].strategyMetrics.warnings.length > 0 && (
                  <p className="mt-2 text-xs text-[var(--warn)]">
                    {data.experiments[0].strategyMetrics.warnings.join(" · ")}
                  </p>
                )}
              </section>
            )}
          </>
          )}

          {view === "wallets" && (
            <section className="panel" data-testid="wallet-intel-panel">
              <div className="border-b border-[var(--line)] px-4 py-3">
                <h2 className="text-sm font-semibold">Wallet credibility (DEMO fixtures)</h2>
                <p className="text-xs text-[var(--muted)]">
                  Not guaranteed profitable. Sample-size, moonshot, wash, and creator adjustments applied.
                </p>
              </div>
              <div className="divide-y divide-[var(--line)]">
                {(data.wallets ?? []).map((w) => (
                  <div key={w.address} className="px-4 py-3 text-sm" data-testid={`wallet-row-${w.address.slice(0, 6)}`}>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="mono text-xs">{w.address}</span>
                      <span className="mono">
                        score {w.score} · conf {(w.confidence * 100).toFixed(0)}% · n={w.sampleSize}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-[var(--muted)]">{w.reasonCodes.join(" · ")}</p>
                    <p className="mt-1 text-xs text-[var(--good)]">{w.positiveEvidence[0]}</p>
                    <p className="text-xs text-[var(--warn)]">{w.negativeEvidence[0]}</p>
                  </div>
                ))}
              </div>
            </section>
          )}

          {view === "signals" && (
            <section className="panel" data-testid="sentinel-signals-panel">
              <div className="border-b border-[var(--line)] px-4 py-3">
                <h2 className="text-sm font-semibold">Sentinel smart-money signals</h2>
                <p className="text-xs text-[var(--muted)]">
                  Score is evidence strength, not expected return. Invalidation conditions are listed.
                </p>
              </div>
              {(data.sentinelSignals ?? []).length === 0 && (
                <p className="p-4 text-sm text-[var(--muted)]">No signals yet — run a research pass.</p>
              )}
              {(data.sentinelSignals ?? []).map((s) => (
                <div key={s.id} className="border-b border-[var(--line)] px-4 py-3 text-sm">
                  <div className="flex justify-between">
                    <span>
                      {s.symbol} · {s.signalType}
                    </span>
                    <span className="mono">
                      {s.score.toFixed(1)} / conf {(s.confidence * 100).toFixed(0)}%
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-[var(--muted)]">{s.explanation[0]}</p>
                  <p className="text-xs text-[var(--warn)]">Invalid if: {s.invalidationConditions[0]}</p>
                </div>
              ))}
            </section>
          )}

          {view === "lab" && (
            <section className="panel p-4" data-testid="strategy-lab-panel">
              <h2 className="text-sm font-semibold">Strategy Lab</h2>
              <p className="mt-1 text-xs text-[var(--muted)]">
                Deterministic backtest with lagged fills, costs, and walk-forward. PAPER/BACKTEST only.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <select
                  className="border border-[var(--line)] bg-[var(--bg-2)] px-2 py-1 text-xs"
                  value={labMint}
                  onChange={(e) => setLabMint(e.target.value)}
                >
                  <option value="">Default candidate</option>
                  {data.candidates.map((c) => (
                    <option key={c.mint} value={c.mint}>
                      {c.symbol}
                    </option>
                  ))}
                </select>
                <button
                  className="border border-[var(--accent)] px-3 py-1.5 text-xs"
                  data-testid="btn-run-backtest"
                  disabled={pending || Boolean(data.health.publicDemo)}
                  onClick={() => {
                    startTransition(async () => {
                      try {
                        const result = await postAction("backtest", labMint ? { mint: labMint } : {});
                        setBacktest(result.backtest);
                        setMsg(`Backtest ${result.backtest.label} complete`);
                      } catch (e) {
                        setMsg(e instanceof Error ? e.message : String(e));
                      }
                    });
                  }}
                >
                  Run backtest
                </button>
              </div>
              {backtest && (
                <div className="mt-4 text-sm" data-testid="backtest-result">
                  <p className="text-xs uppercase text-[var(--muted)]">{backtest.label}</p>
                  {backtest.metrics ? (
                    <ul className="mt-2 space-y-1 mono text-xs">
                      <li>Return {backtest.metrics.totalReturnPct.toFixed(2)}%</li>
                      <li>Max DD {backtest.metrics.maxDrawdownPct.toFixed(2)}%</li>
                      <li>Trades {backtest.metrics.tradeCount}</li>
                    </ul>
                  ) : (
                    <p className="mt-2 text-[var(--warn)]">Metrics hidden — insufficient sample</p>
                  )}
                  <Sparkline values={backtest.equity} />
                  <p className="mt-2 text-xs text-[var(--muted)]">{backtest.warnings.join(" · ")}</p>
                </div>
              )}
            </section>
          )}

          {view === "alerts" && (
            <section className="panel p-4" data-testid="alerts-panel">
              <h2 className="text-sm font-semibold">Alerts</h2>
              <p className="mt-1 text-xs text-[var(--muted)]">
                Internal channel is live. Telegram/Discord/Email are stubs until credentials exist.
              </p>
              <button
                className="mt-3 border border-[var(--line)] px-3 py-1.5 text-xs"
                data-testid="btn-create-alert"
                disabled={pending || Boolean(data.health.publicDemo)}
                onClick={() => run("alert_create", { name: "score-cross", trigger: "SENTINEL_SCORE_CROSS" })}
              >
                Create score-cross alert
              </button>
            </section>
          )}
          </>
        )}
      </main>

      <footer className="border-t border-[var(--line)] px-4 py-6 text-center text-xs text-[var(--muted)]">
        Solana Sentinel · PAPER · LIVE OFF · canBroadcast=false · Not investment advice ·
        Risk tiers never use SAFE
      </footer>
    </div>
  );
}
