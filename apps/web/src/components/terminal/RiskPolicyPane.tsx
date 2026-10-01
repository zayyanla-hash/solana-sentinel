"use client";

import React from "react";
import { type ProposalItem } from "./CandidateTable";
import { usd } from "@/lib/utils";

interface RiskPolicyPaneProps {
  proposal: ProposalItem | null;
}

export function RiskPolicyPane({ proposal }: RiskPolicyPaneProps) {
  if (!proposal) {
    return (
      <div className="panel h-full p-4 flex flex-col items-center justify-center text-center font-mono text-xs text-[#64748b]">
        <p>No proposal generated for selected asset.</p>
        <p className="mt-1 text-[11px] text-[#475569]">
          Run a research pass or click Re-evaluate to run deterministic gates.
        </p>
      </div>
    );
  }

  const { score, tokenRisk, policy, risk, research } = proposal;

  return (
    <div className="flex flex-col gap-2 h-full overflow-auto pr-0.5 text-xs font-mono select-none">
      {/* 1. Opportunity Score Breakdown */}
      <div className="panel p-3 bg-[#0c131d]">
        <div className="flex items-center justify-between pb-1.5 border-b border-[#1b2636]">
          <span className="text-[10px] uppercase font-semibold text-[#94a3b8] tracking-wider">
            Opportunity Score
          </span>
          <span className="text-[9px] text-[#64748b]">strategy-v1</span>
        </div>

        <div className="flex items-baseline justify-between mt-2">
          <div className="flex items-baseline gap-2">
            <span
              className={`text-2xl font-bold ${
                score.compositeScore >= 70
                  ? "text-emerald-400"
                  : score.compositeScore >= 50
                    ? "text-amber-400"
                    : "text-rose-400"
              }`}
            >
              {score.compositeScore.toFixed(1)}
            </span>
            <span className="text-[11px] text-[#64748b]">/ 100</span>
          </div>
          <span className="text-[10px] text-[#94a3b8]">
            Proposed: <strong className="text-white">{usd(proposal.sizeUsd)}</strong>
          </span>
        </div>

        {score.components && Object.keys(score.components).length > 0 && (
          <div className="mt-2 pt-2 border-t border-[#162130] grid grid-cols-3 gap-1 text-[10px]">
            {Object.entries(score.components).map(([k, v]) => (
              <div key={k} className="bg-[#080d14] p-1 rounded-sm border border-[#162130]">
                <p className="text-[#64748b] truncate uppercase">{k}</p>
                <p className="font-semibold text-[#cbd5e1]">{Number(v).toFixed(1)}</p>
              </div>
            ))}
          </div>
        )}

        {score.explanation && score.explanation.length > 0 && (
          <ul className="mt-2 text-[10px] text-[#94a3b8] space-y-0.5 list-disc list-inside">
            {score.explanation.map((e, idx) => (
              <li key={idx} className="truncate">
                {e}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* 2. Token Risk Audit (Deterministic) */}
      <div className="panel p-3 bg-[#0c131d]">
        <div className="flex items-center justify-between pb-1.5 border-b border-[#1b2636]">
          <span className="text-[10px] uppercase font-semibold text-[#94a3b8] tracking-wider">
            Token Risk Gate
          </span>
          <span className="text-[9px] text-[#64748b]">DAS / RPC</span>
        </div>

        <div className="flex items-center justify-between mt-2">
          <span
            className={`term-badge font-semibold ${
              tokenRisk.riskTier === "HIGH_RISK"
                ? "term-badge-bad"
                : tokenRisk.riskTier === "LOWER_RISK"
                  ? "term-badge-good"
                  : "term-badge-warn"
            }`}
          >
            {tokenRisk.riskTier}
          </span>
          <div className="flex items-center gap-2 text-[10px]">
            <span className="text-[#64748b]">Score:</span>
            <span className="font-semibold text-white">{tokenRisk.riskScore}/100</span>
            <span className="text-[#64748b]">|</span>
            <span className="text-[#64748b]">Conf:</span>
            <span className="text-sky-400">{(tokenRisk.dataConfidence * 100).toFixed(0)}%</span>
          </div>
        </div>

        {/* Deterministic risk flags */}
        {tokenRisk.riskFlags && tokenRisk.riskFlags.length > 0 ? (
          <div className="mt-2 flex flex-wrap gap-1">
            {tokenRisk.riskFlags.map((flag) => (
              <span
                key={flag}
                className="text-[9px] px-1 py-0.2 bg-rose-950/50 text-rose-300 border border-rose-800/40 rounded-sm"
              >
                {flag}
              </span>
            ))}
          </div>
        ) : (
          <p className="mt-2 text-[10px] text-emerald-400">
            ✓ No elevated deterministic risk flags
          </p>
        )}

        {tokenRisk.riskReasons && tokenRisk.riskReasons[0] && (
          <p className="mt-2 text-[10px] text-[#94a3b8] bg-[#080d14] p-1.5 rounded-sm border border-[#162130]">
            {tokenRisk.riskReasons[0]}
          </p>
        )}
      </div>

      {/* 3. Policy & Shariah Gate (Deterministic) */}
      <div className="panel p-3 bg-[#0c131d]">
        <div className="flex items-center justify-between pb-1.5 border-b border-[#1b2636]">
          <span className="text-[10px] uppercase font-semibold text-[#94a3b8] tracking-wider">
            Policy Engine
          </span>
          <span className="text-[9px] text-[#64748b]">Deterministic Hard Rules</span>
        </div>

        <div className="flex items-center justify-between mt-2">
          <span
            className={`term-badge font-semibold ${
              policy.decision === "APPROVED"
                ? "term-badge-good"
                : policy.decision === "REJECTED"
                  ? "term-badge-bad"
                  : "term-badge-warn"
            }`}
          >
            {policy.decision}
          </span>
          <span className="text-[10px] text-[#64748b]">
            {policy.decision === "APPROVED" ? "Passed All Rules" : "Violations Detected"}
          </span>
        </div>

        {policy.reasons && policy.reasons[0] && (
          <p className="mt-2 text-[10px] text-[#94a3b8] bg-[#080d14] p-1.5 rounded-sm border border-[#162130]">
            {policy.reasons[0]}
          </p>
        )}
      </div>

      {/* 4. Portfolio Risk Gate (Deterministic) */}
      <div className="panel p-3 bg-[#0c131d]">
        <div className="flex items-center justify-between pb-1.5 border-b border-[#1b2636]">
          <span className="text-[10px] uppercase font-semibold text-[#94a3b8] tracking-wider">
            Portfolio Risk Gate
          </span>
          <span className="text-[9px] text-[#64748b]">Execution Sizing</span>
        </div>

        <div className="flex items-center justify-between mt-2">
          <span
            className={`term-badge font-semibold ${
              risk.decision === "APPROVE"
                ? "term-badge-good"
                : risk.decision === "REDUCE_SIZE"
                  ? "term-badge-warn"
                  : "term-badge-bad"
            }`}
          >
            {risk.decision}
          </span>
          <span className="text-[10px] text-[#cbd5e1]">
            Approved:{" "}
            <strong className="text-emerald-400">{usd(risk.approvedSizeUsd)}</strong>
          </span>
        </div>

        {risk.reasons && risk.reasons[0] && (
          <p className="mt-2 text-[10px] text-[#94a3b8] bg-[#080d14] p-1.5 rounded-sm border border-[#162130]">
            {risk.reasons[0]}
          </p>
        )}
      </div>

      {/* 5. Bounded Advisory LLM Research (Non-Authoritative) */}
      <div className="panel p-3 bg-[#0c131d]">
        <div className="flex items-center justify-between pb-1.5 border-b border-[#1b2636]">
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] uppercase font-semibold text-[#94a3b8] tracking-wider">
              LLM Research Brief
            </span>
            {research?.isMock ? (
              <span className="text-[9px] px-1 bg-[#1a2230] text-[#94a3b8] rounded-sm">
                MOCK
              </span>
            ) : (
              <span className="text-[9px] px-1 bg-emerald-950/60 text-emerald-400 rounded-sm">
                OPENAI
              </span>
            )}
          </div>
          <span className="text-[9px] text-amber-500 font-semibold">ADVISORY ONLY</span>
        </div>

        <p className="text-[9px] text-[#475569] mt-1 italic">
          AI research is advisory and cannot override deterministic policy or risk gates.
        </p>

        {research ? (
          <div className="mt-2 space-y-2">
            <p className="text-[11px] text-[#cbd5e1] leading-relaxed bg-[#080d14] p-2 rounded-sm border border-[#162130]">
              {research.thesis}
            </p>

            {research.catalysts && research.catalysts.length > 0 && (
              <div>
                <p className="text-[10px] font-semibold text-[#94a3b8] uppercase">
                  Catalysts & Observations:
                </p>
                <ul className="mt-1 space-y-0.5 text-[10px] text-[#94a3b8] list-disc list-inside">
                  {research.catalysts.map((c, idx) => (
                    <li key={idx}>{c}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ) : (
          <p className="mt-2 text-[10px] text-[#64748b]">No research synthesis attached.</p>
        )}
      </div>
    </div>
  );
}
