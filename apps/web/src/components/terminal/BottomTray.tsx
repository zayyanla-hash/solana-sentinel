"use client";

import React from "react";
import { usd, pct } from "@/lib/utils";

interface BottomTrayProps {
  events: Array<{ type: string; message: string; timestamp: string; mint?: string }>;
  positions: Array<{
    symbol: string;
    mint: string;
    qty: number;
    avgEntryUsd: number;
    markUsd: number;
    unrealizedPnlUsd: number;
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
  portfolio: {
    navUsd: number;
    cashUsd: number;
    positionsValueUsd: number;
    drawdownPct: number;
    peakNavUsd: number;
  };
  equityHistory: Array<{ t: string; nav: number }>;
}

export function BottomTray({
  events,
  positions,
  orders,
  experiments,
  portfolio,
  equityHistory,
}: BottomTrayProps) {
  const costDrag = orders.reduce(
    (s, o) => s + o.spreadCostUsd + o.slippageCostUsd + o.impactCostUsd + o.networkCostUsd,
    0
  );

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-2 text-xs font-mono select-none">
      {/* Col 1: Positions & Trade Ledger (4 cols) */}
      <div className="lg:col-span-4 flex flex-col gap-2">
        {/* Positions Table */}
        <div className="panel flex flex-col h-32 overflow-hidden bg-[#0c131d]">
          <div className="px-2.5 py-1 border-b border-[#1b2636] bg-[#090e16] flex items-center justify-between text-[10px]">
            <div className="flex items-center gap-1.5">
              <span className="font-semibold text-[#cbd5e1] uppercase tracking-wider">
                Paper Positions
              </span>
              <span className="px-1 bg-[#162130] text-[#94a3b8] rounded-sm">
                {positions.length}
              </span>
            </div>
            <span className="text-[#64748b]">Total: {usd(portfolio.positionsValueUsd)}</span>
          </div>

          <div className="flex-1 overflow-auto">
            <table className="w-full text-left border-collapse text-[10px]">
              <thead className="sticky top-0 bg-[#0c131d] border-b border-[#1b2636] text-[#64748b] uppercase">
                <tr>
                  <th className="py-0.5 px-2">Asset</th>
                  <th className="py-0.5 px-2 text-right">Qty</th>
                  <th className="py-0.5 px-2 text-right">Avg Entry</th>
                  <th className="py-0.5 px-2 text-right">Mark</th>
                  <th className="py-0.5 px-2 text-right">Unrealized</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#131b26]">
                {positions.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-3 text-center text-[#64748b]">
                      No open paper positions
                    </td>
                  </tr>
                ) : (
                  positions.map((p) => {
                    const isGain = p.unrealizedPnlUsd >= 0;
                    return (
                      <tr
                        key={p.mint}
                        data-testid={`position-${p.symbol}`}
                        className="hover:bg-[#101825]"
                      >
                        <td className="py-1 px-2 font-semibold text-white">{p.symbol}</td>
                        <td className="py-1 px-2 text-right text-[#cbd5e1]">{p.qty.toFixed(3)}</td>
                        <td className="py-1 px-2 text-right text-[#cbd5e1]">{usd(p.avgEntryUsd)}</td>
                        <td className="py-1 px-2 text-right text-[#cbd5e1]">{usd(p.markUsd)}</td>
                        <td
                          className={`py-1 px-2 text-right font-semibold ${
                            isGain ? "text-emerald-400" : "text-rose-400"
                          }`}
                        >
                          {usd(p.unrealizedPnlUsd)}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Trade Ledger Table */}
        <div className="panel flex flex-col h-32 overflow-hidden bg-[#0c131d]">
          <div className="px-2.5 py-1 border-b border-[#1b2636] bg-[#090e16] flex items-center justify-between text-[10px]">
            <div className="flex items-center gap-1.5">
              <span className="font-semibold text-[#cbd5e1] uppercase tracking-wider">
                Trade Ledger
              </span>
              <span className="px-1 bg-[#162130] text-[#94a3b8] rounded-sm">
                {orders.length}
              </span>
            </div>
            <span className="text-[#64748b]">Cost Drag: {usd(costDrag)}</span>
          </div>

          <div className="flex-1 overflow-auto">
            <table className="w-full text-left border-collapse text-[10px]">
              <thead className="sticky top-0 bg-[#0c131d] border-b border-[#1b2636] text-[#64748b] uppercase">
                <tr>
                  <th className="py-0.5 px-2">Time</th>
                  <th className="py-0.5 px-2">Side</th>
                  <th className="py-0.5 px-2">Status</th>
                  <th className="py-0.5 px-2 text-right">Filled</th>
                  <th className="py-0.5 px-2 text-right">Friction</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#131b26]">
                {orders.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-3 text-center text-[#64748b]">
                      No paper orders executed
                    </td>
                  </tr>
                ) : (
                  orders.map((o) => {
                    const friction =
                      o.spreadCostUsd + o.slippageCostUsd + o.impactCostUsd + o.networkCostUsd;
                    return (
                      <tr
                        key={o.id}
                        data-testid="ledger-order"
                        className="hover:bg-[#101825]"
                      >
                        <td className="py-1 px-2 text-[#64748b]">
                          {new Date(o.createdAt).toLocaleTimeString()}
                        </td>
                        <td className="py-1 px-2 font-semibold text-emerald-400">{o.side}</td>
                        <td className="py-1 px-2">
                          <span className="px-1 py-0.2 text-[9px] bg-emerald-950/60 text-emerald-300 border border-emerald-800/40 rounded-sm">
                            {o.status}
                          </span>
                        </td>
                        <td className="py-1 px-2 text-right font-medium text-white">
                          {usd(o.filledUsd)}
                        </td>
                        <td className="py-1 px-2 text-right text-rose-400">{usd(friction)}</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Col 2: Event Stream Log (5 cols) */}
      <div className="lg:col-span-5 panel flex flex-col h-[264px] overflow-hidden bg-[#0c131d]">
        <div className="px-2.5 py-1 border-b border-[#1b2636] bg-[#090e16] flex items-center justify-between text-[10px]">
          <div className="flex items-center gap-1.5">
            <span className="font-semibold text-[#cbd5e1] uppercase tracking-wider">
              Audit Event Stream
            </span>
            <span className="px-1 bg-[#162130] text-[#94a3b8] rounded-sm">{events.length}</span>
          </div>
          <span className="text-[9px] text-emerald-400 flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 live-dot" /> LIVE FEED
          </span>
        </div>

        <div className="flex-1 overflow-auto">
          <table className="w-full text-left border-collapse text-[10px]">
            <thead className="sticky top-0 bg-[#0c131d] border-b border-[#1b2636] text-[#64748b] uppercase">
              <tr>
                <th className="py-0.5 px-2 w-20">Time</th>
                <th className="py-0.5 px-2 w-32">Event Type</th>
                <th className="py-0.5 px-2 w-24">Asset</th>
                <th className="py-0.5 px-2">Message</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#131b26]">
              {events.length === 0 ? (
                <tr>
                  <td colSpan={4} className="py-4 text-center text-[#64748b]">
                    No events recorded in current session
                  </td>
                </tr>
              ) : (
                events.map((e, idx) => {
                  const time = new Date(e.timestamp).toLocaleTimeString();
                  const isWarn = e.type.includes("REJECT") || e.type.includes("ERROR");
                  const isSuccess = e.type.includes("FILL") || e.type.includes("APPROVE");
                  return (
                    <tr key={`${e.timestamp}-${idx}`} className="hover:bg-[#101825]">
                      <td className="py-0.5 px-2 text-[#64748b] whitespace-nowrap">{time}</td>
                      <td className="py-0.5 px-2">
                        <span
                          className={`font-semibold ${
                            isWarn
                              ? "text-rose-400"
                              : isSuccess
                                ? "text-emerald-400"
                                : "text-sky-400"
                          }`}
                        >
                          {e.type}
                        </span>
                      </td>
                      <td className="py-0.5 px-2 text-[#94a3b8] truncate">
                        {e.mint ? `${e.mint.slice(0, 6)}…` : "—"}
                      </td>
                      <td className="py-0.5 px-2 text-[#cbd5e1] truncate max-w-[200px]" title={e.message}>
                        {e.message}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Col 3: Experiments, Benchmarks & Portfolio Telemetry (3 cols) */}
      <div className="lg:col-span-3 panel flex flex-col h-[264px] overflow-hidden bg-[#0c131d]">
        <div className="px-2.5 py-1 border-b border-[#1b2636] bg-[#090e16] flex items-center justify-between text-[10px]">
          <span className="font-semibold text-[#cbd5e1] uppercase tracking-wider">
            Replay & Benchmarks
          </span>
          <span className="text-[#64748b]">NAV: {usd(portfolio.navUsd)}</span>
        </div>

        <div className="flex-1 overflow-auto p-2 space-y-2">
          {experiments[0]?.dataQuality === "INSUFFICIENT_HISTORY" ||
          !experiments[0]?.strategyMetrics ? (
            <div
              className="p-2 bg-amber-950/30 border border-amber-800/40 rounded-sm text-amber-300 text-[10px]"
              data-testid="experiment-insufficient"
            >
              <p className="font-semibold">⚠ INSUFFICIENT HISTORY</p>
              <p className="mt-0.5 text-[9px] text-amber-400/80">
                {experiments[0]?.notes?.join(" · ") ??
                  "DEMO DATA / Not a verified live performance path. Minimum 10 history points required."}
              </p>
            </div>
          ) : experiments[0] ? (
            <div className="space-y-1.5 text-[10px]">
              <div className="flex items-center justify-between p-1.5 bg-[#080d14] border border-[#162130] rounded-sm">
                <span className="text-[#94a3b8]">Strategy (Replay)</span>
                <span className="font-semibold text-emerald-400">
                  {pct(experiments[0].strategyMetrics.totalReturnPct)}
                </span>
              </div>
              <div className="flex items-center justify-between p-1.5 bg-[#080d14] border border-[#162130] rounded-sm">
                <span className="text-[#94a3b8]">SOL Benchmark B&H</span>
                <span className="font-semibold text-[#cbd5e1]">
                  {experiments[0].baselines.solBuyHold
                    ? pct(experiments[0].baselines.solBuyHold.totalReturnPct)
                    : "—"}
                </span>
              </div>
              <div className="flex items-center justify-between p-1.5 bg-[#080d14] border border-[#162130] rounded-sm">
                <span className="text-[#94a3b8]">Cash Baseline</span>
                <span className="font-semibold text-[#cbd5e1]">
                  {experiments[0].baselines.cash
                    ? pct(experiments[0].baselines.cash.totalReturnPct)
                    : "—"}
                </span>
              </div>
              <div className="flex items-center justify-between p-1.5 bg-[#080d14] border border-[#162130] rounded-sm">
                <span className="text-[#94a3b8]">Mechanical Momentum</span>
                <span className="font-semibold text-[#cbd5e1]">
                  {experiments[0].baselines.mechanicalMomentum
                    ? pct(experiments[0].baselines.mechanicalMomentum.totalReturnPct)
                    : "—"}
                </span>
              </div>
            </div>
          ) : (
            <p className="text-[#64748b] text-[10px]">No experiment data</p>
          )}

          {/* Mini Equity Sparkline */}
          {equityHistory && equityHistory.length > 1 && (
            <div className="pt-1">
              <div className="flex items-center justify-between text-[9px] text-[#64748b] mb-0.5">
                <span>Equity Path ({equityHistory.length} pts)</span>
                <span>Peak: {usd(portfolio.peakNavUsd)}</span>
              </div>
              <svg viewBox="0 0 200 24" className="w-full h-6 bg-[#080d14] rounded-sm border border-[#162130]" preserveAspectRatio="none">
                {(() => {
                  const navs = equityHistory.map((e) => e.nav);
                  const min = Math.min(...navs);
                  const max = Math.max(...navs);
                  const pts = navs
                    .map((v, i) => {
                      const x = (i / (navs.length - 1)) * 200;
                      const y = 22 - ((v - min) / (max - min || 1)) * 20;
                      return `${x.toFixed(1)},${y.toFixed(1)}`;
                    })
                    .join(" ");
                  return <polyline fill="none" stroke="#38bdf8" strokeWidth="1.2" points={pts} />;
                })()}
              </svg>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
