"use client";

import React, { useMemo, useState } from "react";
import { usd, pct } from "@/lib/utils";

export interface CandidateItem {
  mint: string;
  symbol: string;
  name: string;
  priceUsd: number | null;
  liquidityUsd: number | null;
  volume24hUsd: number | null;
  priceChange24hPct: number | null;
  isDemo: boolean;
  riskFlags: string[];
}

export interface ProposalItem {
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
}

interface CandidateTableProps {
  candidates: CandidateItem[];
  proposals: ProposalItem[];
  scores: Array<{ mint: string; compositeScore: number }>;
  selectedMint: string | null;
  onSelectMint: (mint: string) => void;
}

export function CandidateTable({
  candidates,
  proposals,
  scores,
  selectedMint,
  onSelectMint,
}: CandidateTableProps) {
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<"score" | "change" | "symbol" | "price">("score");
  const [sortAsc, setSortAsc] = useState(false);

  const proposalByMint = useMemo(() => {
    const map = new Map<string, ProposalItem>();
    for (const p of proposals) map.set(p.mint, p);
    return map;
  }, [proposals]);

  const scoreByMint = useMemo(() => {
    const map = new Map<string, number>();
    for (const s of scores) map.set(s.mint, s.compositeScore);
    return map;
  }, [scores]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = candidates.filter((c) => {
      if (!q) return true;
      return (
        c.symbol.toLowerCase().includes(q) ||
        c.name.toLowerCase().includes(q) ||
        c.mint.toLowerCase().includes(q)
      );
    });

    list.sort((a, b) => {
      let diff = 0;
      if (sortKey === "score") {
        const sa = scoreByMint.get(a.mint) ?? -1;
        const sb = scoreByMint.get(b.mint) ?? -1;
        diff = sa - sb;
      } else if (sortKey === "change") {
        diff = (a.priceChange24hPct ?? 0) - (b.priceChange24hPct ?? 0);
      } else if (sortKey === "price") {
        diff = (a.priceUsd ?? 0) - (b.priceUsd ?? 0);
      } else {
        diff = a.symbol.localeCompare(b.symbol);
      }
      return sortAsc ? diff : -diff;
    });

    return list;
  }, [candidates, query, sortKey, sortAsc, scoreByMint]);

  const handleSort = (key: typeof sortKey) => {
    if (sortKey === key) {
      setSortAsc(!sortAsc);
    } else {
      setSortKey(key);
      setSortAsc(false);
    }
  };

  return (
    <div className="panel flex flex-col h-full overflow-hidden">
      {/* Header bar with count and search */}
      <div className="p-2 border-b border-[#1b2636] bg-[#0c131d] flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-mono font-semibold uppercase tracking-wider text-[#cbd5e1]">
            Watchlist
          </span>
          <span className="text-[10px] font-mono px-1.5 py-0.2 bg-[#16202e] text-[#94a3b8] rounded-sm">
            {filtered.length}/{candidates.length}
          </span>
        </div>
        <div className="relative">
          <input
            type="text"
            placeholder="Filter (/)..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-28 sm:w-36 px-2 py-0.5 text-[11px] font-mono bg-[#080d14] border border-[#1e2c3e] text-[#f1f5f9] placeholder-[#475569] rounded-sm focus:outline-none focus:border-[#38bdf8]"
          />
        </div>
      </div>

      {/* Dense Table View */}
      <div className="flex-1 overflow-auto">
        <table className="w-full text-left border-collapse text-[11px] font-mono select-none">
          <thead className="sticky top-0 bg-[#090e16] border-b border-[#1b2636] text-[10px] text-[#64748b] tracking-wider uppercase">
            <tr>
              <th
                onClick={() => handleSort("symbol")}
                className="py-1.5 px-2 font-medium cursor-pointer hover:text-white"
              >
                Asset {sortKey === "symbol" && (sortAsc ? "▲" : "▼")}
              </th>
              <th
                onClick={() => handleSort("price")}
                className="py-1.5 px-2 text-right font-medium cursor-pointer hover:text-white"
              >
                Price {sortKey === "price" && (sortAsc ? "▲" : "▼")}
              </th>
              <th
                onClick={() => handleSort("change")}
                className="py-1.5 px-2 text-right font-medium cursor-pointer hover:text-white"
              >
                24h {sortKey === "change" && (sortAsc ? "▲" : "▼")}
              </th>
              <th
                onClick={() => handleSort("score")}
                className="py-1.5 px-2 text-right font-medium cursor-pointer hover:text-white"
              >
                Score {sortKey === "score" && (sortAsc ? "▲" : "▼")}
              </th>
              <th className="py-1.5 px-2 text-right font-medium">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#141d2a]">
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-6 text-center text-[#64748b]">
                  No matching assets
                </td>
              </tr>
            ) : (
              filtered.map((c) => {
                const isSelected = c.mint === selectedMint;
                const prop = proposalByMint.get(c.mint);
                const score = scoreByMint.get(c.mint);
                const chg = c.priceChange24hPct ?? 0;
                const isUp = chg > 0;
                const isDown = chg < 0;

                return (
                  <tr
                    key={c.mint}
                    data-testid={`candidate-${c.symbol}`}
                    onClick={() => onSelectMint(c.mint)}
                    className={`cursor-pointer transition-colors ${
                      isSelected
                        ? "bg-[#142233] text-white border-l-2 border-l-[#38bdf8]"
                        : "hover:bg-[#0f1722] text-[#cbd5e1]"
                    }`}
                  >
                    <td className="py-1.5 px-2">
                      <div className="flex items-center gap-1.5">
                        <span className="font-semibold text-[#f8fafc]">{c.symbol}</span>
                        {c.isDemo && (
                          <span className="text-[9px] px-1 py-0.2 bg-[#2d1b0d] text-[#fb923c] rounded-[2px] border border-[#522d13]">
                            DEMO
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] text-[#64748b] truncate max-w-[90px]">
                        {c.name}
                      </div>
                    </td>
                    <td className="py-1.5 px-2 text-right text-[#e2e8f0]">
                      {usd(c.priceUsd, c.priceUsd && c.priceUsd < 0.01 ? 6 : 2)}
                    </td>
                    <td
                      className={`py-1.5 px-2 text-right font-medium ${
                        isUp ? "text-emerald-400" : isDown ? "text-rose-400" : "text-[#94a3b8]"
                      }`}
                    >
                      {pct(c.priceChange24hPct)}
                    </td>
                    <td className="py-1.5 px-2 text-right">
                      {score != null ? (
                        <span
                          className={`font-semibold ${
                            score >= 70
                              ? "text-emerald-400"
                              : score >= 50
                                ? "text-amber-400"
                                : "text-rose-400"
                          }`}
                        >
                          {score.toFixed(1)}
                        </span>
                      ) : (
                        <span className="text-[#64748b]">—</span>
                      )}
                    </td>
                    <td className="py-1.5 px-2 text-right">
                      {prop ? (
                        <span
                          data-testid={`proposal-status-${c.symbol}`}
                          className={`inline-block px-1.5 py-0.2 text-[9px] font-semibold uppercase tracking-wider rounded-sm ${
                            prop.status === "REJECTED"
                              ? "bg-rose-950/60 text-rose-400 border border-rose-800/40"
                              : prop.status === "ACCEPTED_PAPER"
                                ? "bg-emerald-950/60 text-emerald-400 border border-emerald-800/40"
                                : "bg-amber-950/60 text-amber-300 border border-amber-800/40"
                          }`}
                        >
                          {prop.status}
                        </span>
                      ) : (
                        <span className="text-[9px] text-[#64748b]">IDLE</span>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
