"use client";

import React from "react";
import { usd } from "@/lib/utils";

export interface SystemHealthData {
  operatingMode: string;
  liveTradingAllowed: boolean;
  canBroadcast: boolean;
  persistence: string;
  demoMode: boolean;
  navUsd: number;
  drawdownPct: number;
  providers: Record<string, string | { name: string; status: string }>;
}

interface TerminalHeaderProps {
  health?: SystemHealthData;
  operatingMode?: string;
  solPrice?: number | null;
  onOpenCommandPalette: () => void;
  onRunAction: (action: string) => void;
  pending: boolean;
  actionMsg?: string | null;
  onReload: () => void;
}

export function TerminalHeader({
  health,
  operatingMode = "PAPER",
  solPrice = 148.2,
  onOpenCommandPalette,
  onRunAction,
  pending,
  actionMsg,
  onReload,
}: TerminalHeaderProps) {
  const getProviderStatus = (key: string): { name: string; isReal: boolean } => {
    if (!health?.providers) return { name: "…", isReal: false };
    const val = health.providers[key];
    if (!val) return { name: "…", isReal: false };
    if (typeof val === "string") {
      const isReal = val.includes("birdeye") || val.includes("helius") || val.includes("openai") || val === "jupiter-v1";
      return { name: val, isReal };
    }
    return { name: val.name, isReal: val.status === "REAL" };
  };

  const market = getProviderStatus("market");
  const onchain = getProviderStatus("onchain");
  const execution = getProviderStatus("execution");
  const research = getProviderStatus("research");

  return (
    <header className="border-b border-[#1b2636] bg-[#090d14] text-xs select-none">
      {/* Top compact warning banner */}
      <div
        className="demo-banner px-3 py-1 flex items-center justify-between font-mono"
        data-testid="banner-mode"
      >
        <div className="flex items-center gap-2">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-500 live-dot" />
          <strong className="text-amber-400 font-semibold tracking-wide">
            DEMO / PAPER ONLY
          </strong>
          <span className="text-[#64748b]">|</span>
          <span className="text-[#cbd5e1] hidden sm:inline">
            Live broadcasting is hard-disabled. Not investment advice. Simulated fills only.
          </span>
        </div>
        <div className="flex items-center gap-3 text-[10px]">
          <span className="text-[#94a3b8]">PORT: 4317</span>
          <span className="text-[#64748b]">|</span>
          <span className="text-[#94a3b8]">HOST: 127.0.0.1</span>
        </div>
      </div>

      {/* Main Workstation Navigation Bar */}
      <div className="px-3 py-2 flex flex-wrap items-center justify-between gap-2 bg-[#0c121b]">
        {/* Brand & Ticker Telemetry */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <span className="font-mono text-xs font-bold tracking-tight text-white px-1.5 py-0.5 bg-[#172233] border border-[#2b3d56] rounded-sm">
              SAT
            </span>
            <span className="font-semibold text-sm tracking-tight text-[#f1f5f9]">
              RESEARCH
            </span>
            <span className="text-[10px] font-mono text-[#64748b] hidden md:inline">
              v1.5
            </span>
          </div>

          <div className="hidden lg:flex items-center gap-2 pl-3 border-l border-[#1e2c3e] font-mono text-[11px]">
            <span className="text-[#64748b]">SOL/USD</span>
            <span className="text-[#38bdf8] font-semibold">
              {solPrice != null ? usd(solPrice, 2) : "$148.20"}
            </span>
          </div>

          {/* Hard Safety Status Chips */}
          <div className="flex items-center gap-1.5 pl-2 border-l border-[#1e2c3e]">
            <span className="term-badge term-badge-demo" data-testid="pill-operating-mode">
              {operatingMode}
            </span>
            <span
              className="term-badge term-badge-good"
              data-testid="health-live-allowed"
            >
              LIVE {health?.liveTradingAllowed ? "ON" : "OFF"}
            </span>
            <span
              className="term-badge"
              data-testid="health-can-broadcast"
              title="Execution plan canBroadcast invariant"
            >
              canBroadcast={String(health?.canBroadcast ?? false)}
            </span>
            <span
              className={`term-badge ${
                health?.persistence === "postgres" ? "term-badge-good" : "term-badge-warn"
              }`}
              data-testid="health-persistence"
            >
              {health?.persistence ?? "memory"} store
            </span>
          </div>
        </div>

        {/* Center: Providers Status Strip */}
        <div className="hidden xl:flex items-center gap-2 text-[10px] font-mono text-[#94a3b8] px-2 py-0.5 bg-[#090e15] border border-[#1b2636] rounded-sm">
          <span>DATA:</span>
          <span title={`Market: ${market.name}`} className={market.isReal ? "text-emerald-400" : "text-amber-400"}>
            MKT:{market.isReal ? "REAL" : "DEMO"}
          </span>
          <span className="text-[#334155]">/</span>
          <span title={`On-chain: ${onchain.name}`} className={onchain.isReal ? "text-emerald-400" : "text-amber-400"}>
            CHAIN:{onchain.isReal ? "REAL" : "DEMO"}
          </span>
          <span className="text-[#334155]">/</span>
          <span title={`Execution: ${execution.name}`} className="text-sky-400">
            EXEC:{execution.isReal ? "JUPITER" : "DEMO"}
          </span>
          <span className="text-[#334155]">/</span>
          <span title={`Research: ${research.name}`} className={research.isReal ? "text-emerald-400" : "text-slate-400"}>
            LLM:{research.isReal ? "OPENAI" : "MOCK"}
          </span>
        </div>

        {/* Right: Actions & Command Palette Trigger */}
        <div className="flex items-center gap-1.5">
          <button
            onClick={onOpenCommandPalette}
            className="flex items-center gap-2 px-2.5 py-1 text-[11px] font-mono text-[#94a3b8] bg-[#121a26] hover:bg-[#1b2636] hover:text-white border border-[#223145] rounded-sm transition-colors cursor-pointer"
            title="Open Command Palette (⌘K or Ctrl+K)"
          >
            <span>Search / Actions</span>
            <span className="term-kbd text-[9px]">⌘K</span>
          </button>

          <button
            onClick={() => onRunAction("research_pass")}
            disabled={pending}
            data-testid="btn-research-pass"
            className="px-2 py-1 text-[11px] font-mono bg-[#142030] hover:bg-[#1e2f47] text-[#38bdf8] border border-[#233b59] rounded-sm transition-colors disabled:opacity-50 cursor-pointer"
            title="Run complete discovery, scoring, and research pass"
          >
            {pending ? "Running…" : "Run Pass"}
          </button>

          <button
            onClick={() => onRunAction("experiment")}
            disabled={pending}
            data-testid="btn-experiment"
            className="hidden sm:inline-block px-2 py-1 text-[11px] font-mono bg-[#111823] hover:bg-[#182333] text-[#94a3b8] hover:text-white border border-[#1e2b3c] rounded-sm transition-colors disabled:opacity-50 cursor-pointer"
            title="Run backtest/paper replay experiment"
          >
            Replay
          </button>

          <button
            onClick={() => onRunAction("reset")}
            disabled={pending}
            data-testid="btn-reset"
            className="hidden sm:inline-block px-2 py-1 text-[11px] font-mono bg-[#18110e] hover:bg-[#261a15] text-amber-400 hover:text-amber-300 border border-[#3f2619] rounded-sm transition-colors disabled:opacity-50 cursor-pointer"
            title="Reset demo capital and proposals"
          >
            Reset
          </button>

          <button
            onClick={onReload}
            disabled={pending}
            className="p-1 text-[#94a3b8] hover:text-white hover:bg-[#172233] border border-[#1b2636] rounded-sm transition-colors cursor-pointer"
            title="Reload state"
            aria-label="Reload state"
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
              <path d="M3 3v5h5" />
              <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
              <path d="M16 21h5v-5" />
            </svg>
          </button>
        </div>
      </div>

      {/* Action Notification Toast Bar */}
      {actionMsg && (
        <div
          data-testid="action-msg"
          className="px-3 py-1 text-xs font-mono bg-[#0f2136] text-[#38bdf8] border-t border-[#1a365d] flex items-center justify-between"
        >
          <span>› {actionMsg}</span>
          <span className="text-[10px] text-[#64748b]">UPDATED</span>
        </div>
      )}
    </header>
  );
}
