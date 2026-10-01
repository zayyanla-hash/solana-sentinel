"use client";

import React, { useState } from "react";
import { type CandidateItem, type ProposalItem } from "./CandidateTable";
import { MarketChart } from "./MarketChart";
import { usd, pct } from "@/lib/utils";

interface AssetWorkspaceProps {
  candidate: CandidateItem | null;
  proposal: ProposalItem | null;
  operatingMode: string;
  pending: boolean;
  onPaperExecute: (proposalId: string) => void;
  onEvaluate: (mint: string) => void;
  apiToken?: string;
}

export function AssetWorkspace({
  candidate,
  proposal,
  operatingMode,
  pending,
  onPaperExecute,
  onEvaluate,
  apiToken,
}: AssetWorkspaceProps) {
  const [copied, setCopied] = useState(false);

  if (!candidate) {
    return (
      <div className="panel h-full flex items-center justify-center p-8 text-center text-[#64748b] font-mono text-xs">
        Select a token from the candidate watchlist to view market signals and execution analysis.
      </div>
    );
  }

  const copyMint = () => {
    navigator.clipboard.writeText(candidate.mint);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const isReadOnly = operatingMode === "READ_ONLY";
  const canPaperExecute =
    proposal &&
    proposal.status !== "REJECTED" &&
    proposal.status !== "ACCEPTED_PAPER" &&
    !isReadOnly;

  return (
    <div className="flex flex-col gap-2 h-full">
      {/* Top Asset Summary Header */}
      <div className="panel p-3 bg-[#0c131e] border-b border-[#1b2636]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* Symbol & Mint Identification */}
          <div className="flex items-center gap-3">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-bold tracking-tight text-white font-mono">
                  {candidate.symbol}
                </h2>
                <span className="text-xs text-[#94a3b8]">{candidate.name}</span>
                {candidate.isDemo && (
                  <span className="term-badge term-badge-demo">DEMO</span>
                )}
                {proposal && (
                  <span
                    className={`term-badge ${
                      proposal.status === "REJECTED"
                        ? "term-badge-bad"
                        : proposal.status === "ACCEPTED_PAPER"
                          ? "term-badge-good"
                          : "term-badge-warn"
                    }`}
                  >
                    {proposal.status}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="font-mono text-[10px] text-[#64748b]">
                  MINT: {candidate.mint.slice(0, 8)}…{candidate.mint.slice(-6)}
                </span>
                <button
                  onClick={copyMint}
                  className="text-[9px] font-mono px-1 py-0.2 bg-[#162130] hover:bg-[#1e2f44] text-[#94a3b8] hover:text-white rounded-sm cursor-pointer transition-colors"
                  title="Copy full Solana Mint address"
                >
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
            </div>
          </div>

          {/* Quick Stats Grid */}
          <div className="flex flex-wrap items-center gap-4 text-xs font-mono">
            <div>
              <p className="text-[10px] text-[#64748b] uppercase">Price</p>
              <p className="font-semibold text-white">
                {usd(candidate.priceUsd, candidate.priceUsd && candidate.priceUsd < 0.01 ? 6 : 2)}
              </p>
            </div>
            <div>
              <p className="text-[10px] text-[#64748b] uppercase">24h Chg</p>
              <p
                className={`font-semibold ${
                  (candidate.priceChange24hPct ?? 0) >= 0
                    ? "text-emerald-400"
                    : "text-rose-400"
                }`}
              >
                {pct(candidate.priceChange24hPct)}
              </p>
            </div>
            <div>
              <p className="text-[10px] text-[#64748b] uppercase">Liquidity</p>
              <p className="text-[#cbd5e1]">{usd(candidate.liquidityUsd, 0)}</p>
            </div>
            <div>
              <p className="text-[10px] text-[#64748b] uppercase">24h Vol</p>
              <p className="text-[#cbd5e1]">{usd(candidate.volume24hUsd, 0)}</p>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-2">
            {proposal && (
              <button
                data-testid="btn-paper-execute"
                disabled={pending || !canPaperExecute}
                onClick={() => onPaperExecute(proposal.id)}
                className={`px-3 py-1.5 text-xs font-mono font-medium rounded-sm transition-all cursor-pointer ${
                  canPaperExecute
                    ? "bg-[#0284c7] hover:bg-[#0369a1] text-white border border-[#38bdf8] shadow-sm"
                    : "bg-[#141b24] text-[#475569] border border-[#1e2633] cursor-not-allowed"
                }`}
                title={
                  isReadOnly
                    ? "Paper execution is disabled in READ_ONLY mode"
                    : proposal.status === "REJECTED"
                      ? "Cannot execute proposal rejected by risk or policy gates"
                      : proposal.status === "ACCEPTED_PAPER"
                        ? "Already paper-executed"
                        : "Simulate paper fill via Jupiter plan (no live broadcast)"
                }
              >
                {pending ? "Executing…" : "Simulate Paper Trade"}
              </button>
            )}

            <button
              disabled={pending}
              onClick={() => onEvaluate(candidate.mint)}
              className="px-2.5 py-1.5 text-xs font-mono bg-[#141f2e] hover:bg-[#1a2b40] text-[#94a3b8] hover:text-white border border-[#223348] rounded-sm transition-colors cursor-pointer disabled:opacity-50"
              title="Run deterministic signals and risk assessment"
            >
              Re-evaluate
            </button>
          </div>
        </div>
      </div>

      {/* Candlestick & Volume Chart */}
      <MarketChart
        mint={candidate.mint}
        symbol={candidate.symbol}
        currentPrice={candidate.priceUsd}
        isDemoAsset={candidate.isDemo}
        apiToken={apiToken}
      />

      {/* Quantitative Signal Decomposition Matrix */}
      <div className="panel p-3 bg-[#0c131e]">
        <div className="flex items-center justify-between pb-2 mb-2 border-b border-[#1b2636]">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-mono font-semibold uppercase tracking-wider text-[#cbd5e1]">
              Quantitative Signal Decomposition
            </span>
            <span className="text-[10px] font-mono text-[#64748b]">
              Closed-Bar Real-Time
            </span>
          </div>
          <span className="text-[10px] font-mono text-[#64748b]">
            Scale: [-1.000 to +1.000]
          </span>
        </div>

        {proposal && proposal.signals && proposal.signals.length > 0 ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs font-mono">
            {proposal.signals.map((s) => {
              const score = s.normalizedScore;
              const isPos = score > 0;
              const isNeg = score < 0;
              const barWidth = Math.min(100, Math.abs(score) * 100);

              return (
                <div
                  key={s.name}
                  className="p-2 bg-[#080d14] border border-[#162130] rounded-sm flex flex-col justify-between"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-[#94a3b8] uppercase truncate max-w-[95px]">
                      {s.name}
                    </span>
                    <span className="text-[9px] text-[#64748b]">
                      conf {(s.confidence * 100).toFixed(0)}%
                    </span>
                  </div>

                  <div className="flex items-baseline justify-between mt-1">
                    <span
                      className={`text-xs font-semibold ${
                        isPos
                          ? "text-emerald-400"
                          : isNeg
                            ? "text-rose-400"
                            : "text-[#94a3b8]"
                      }`}
                    >
                      {score >= 0 ? `+${score.toFixed(3)}` : score.toFixed(3)}
                    </span>
                  </div>

                  {/* Horizontal mini bar gauge */}
                  <div className="mt-1.5 h-1 w-full bg-[#16202c] rounded-full overflow-hidden flex">
                    <div className="w-1/2 flex justify-end">
                      {isNeg && (
                        <div
                          style={{ width: `${barWidth}%` }}
                          className="h-full bg-rose-500 rounded-l-full"
                        />
                      )}
                    </div>
                    <div className="w-1/2 flex justify-start">
                      {isPos && (
                        <div
                          style={{ width: `${barWidth}%` }}
                          className="h-full bg-emerald-500 rounded-r-full"
                        />
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="py-4 text-center text-xs font-mono text-[#64748b]">
            No signals calculated yet — click Re-evaluate to generate quantitative indicators.
          </div>
        )}
      </div>
    </div>
  );
}
