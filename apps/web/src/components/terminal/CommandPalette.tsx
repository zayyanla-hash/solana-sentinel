"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { type CandidateItem, type ProposalItem } from "./CandidateTable";

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  candidates: CandidateItem[];
  selectedCandidate: CandidateItem | null;
  selectedProposal: ProposalItem | null;
  operatingMode: string;
  onSelectMint: (mint: string) => void;
  onRunAction: (action: string, extra?: Record<string, string>) => void;
}

interface CommandItem {
  id: string;
  category: "Action" | "Asset" | "System";
  title: string;
  subtitle?: string;
  badge?: string;
  execute: () => void;
}

export function CommandPalette({
  isOpen,
  onClose,
  candidates,
  selectedCandidate,
  selectedProposal,
  operatingMode,
  onSelectMint,
  onRunAction,
}: CommandPaletteProps) {
  const [search, setSearch] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setSearch("");
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  const commands = useMemo<CommandItem[]>(() => {
    const list: CommandItem[] = [];

    // System & Pipeline Actions
    list.push({
      id: "action-research-pass",
      category: "Action",
      title: "Run Full Research Pass",
      subtitle: "Discover, evaluate risk/policy gates, score, and propose trades",
      badge: "PIPELINE",
      execute: () => {
        onRunAction("research_pass");
        onClose();
      },
    });

    list.push({
      id: "action-discover",
      category: "Action",
      title: "Run Discovery Cycle",
      subtitle: "Query trending Solana candidates from market provider",
      badge: "DISCOVERY",
      execute: () => {
        onRunAction("discover");
        onClose();
      },
    });

    list.push({
      id: "action-experiment",
      category: "Action",
      title: "Replay Backtest Experiment",
      subtitle: "Execute simulated equity replay against SOL and Cash baselines",
      badge: "REPLAY",
      execute: () => {
        onRunAction("experiment");
        onClose();
      },
    });

    list.push({
      id: "action-mark",
      category: "Action",
      title: "Mark Positions to Market",
      subtitle: "Update open paper positions against current market feeds",
      badge: "MARK",
      execute: () => {
        onRunAction("mark");
        onClose();
      },
    });

    if (selectedCandidate) {
      list.push({
        id: `eval-${selectedCandidate.symbol}`,
        category: "Action",
        title: `Re-evaluate ${selectedCandidate.symbol}`,
        subtitle: `Refresh token-risk, policy, and quantitative signals for ${selectedCandidate.name}`,
        badge: "EVAL",
        execute: () => {
          onRunAction("evaluate", { mint: selectedCandidate.mint });
          onClose();
        },
      });

      if (
        selectedProposal &&
        selectedProposal.status !== "REJECTED" &&
        selectedProposal.status !== "ACCEPTED_PAPER" &&
        operatingMode !== "READ_ONLY"
      ) {
        list.push({
          id: `paper-exec-${selectedCandidate.symbol}`,
          category: "Action",
          title: `Simulate Paper Trade: ${selectedCandidate.symbol}`,
          subtitle: `Execute proposal #${selectedProposal.id.slice(0, 8)} (${selectedProposal.sizeUsd.toFixed(0)} USD)`,
          badge: "EXECUTE",
          execute: () => {
            onRunAction("paper_execute", { proposalId: selectedProposal.id });
            onClose();
          },
        });
      }
    }

    list.push({
      id: "action-reset",
      category: "System",
      title: "Reset Demo State",
      subtitle: "Re-initialize paper starting balance to $100,000 USD",
      badge: "RESET",
      execute: () => {
        onRunAction("reset");
        onClose();
      },
    });

    // Asset Jumps
    for (const c of candidates) {
      list.push({
        id: `asset-${c.mint}`,
        category: "Asset",
        title: `${c.symbol} — ${c.name}`,
        subtitle: `Mint: ${c.mint.slice(0, 12)}…${c.mint.slice(-6)}`,
        badge: c.isDemo ? "DEMO" : "REAL",
        execute: () => {
          onSelectMint(c.mint);
          onClose();
        },
      });
    }

    return list;
  }, [candidates, selectedCandidate, selectedProposal, operatingMode, onRunAction, onSelectMint, onClose]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter(
      (c) =>
        c.title.toLowerCase().includes(q) ||
        (c.subtitle && c.subtitle.toLowerCase().includes(q)) ||
        c.category.toLowerCase().includes(q)
    );
  }, [commands, search]);

  // Keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((prev) => (prev + 1) % (filtered.length || 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((prev) => (prev - 1 + filtered.length) % (filtered.length || 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (filtered[selectedIndex]) {
        filtered[selectedIndex].execute();
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-start justify-center pt-20 px-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl bg-[#0c131d] border border-[#23354d] shadow-2xl rounded-sm overflow-hidden flex flex-col font-mono text-xs"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        {/* Search input bar */}
        <div className="flex items-center px-3 py-2.5 border-b border-[#1b2636] bg-[#090e16]">
          <span className="text-[#64748b] mr-2">›</span>
          <input
            ref={inputRef}
            type="text"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setSelectedIndex(0);
            }}
            placeholder="Type a command or token symbol (e.g. JUP, pass, replay)…"
            className="w-full bg-transparent text-white placeholder-[#475569] focus:outline-none text-xs"
          />
          <span className="text-[10px] text-[#64748b] px-1.5 py-0.5 bg-[#141e2b] border border-[#233145] rounded-sm">
            ESC
          </span>
        </div>

        {/* Command list */}
        <div className="max-h-80 overflow-auto p-1 divide-y divide-[#131b26]">
          {filtered.length === 0 ? (
            <div className="p-4 text-center text-[#64748b]">No matching commands or assets</div>
          ) : (
            filtered.map((item, index) => {
              const isSelected = index === selectedIndex;
              return (
                <div
                  key={item.id}
                  onClick={() => item.execute()}
                  onMouseEnter={() => setSelectedIndex(index)}
                  className={`px-3 py-2 flex items-center justify-between cursor-pointer rounded-xs transition-colors ${
                    isSelected ? "bg-[#162538] text-white" : "text-[#cbd5e1] hover:bg-[#0f1722]"
                  }`}
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-white">{item.title}</span>
                      {item.badge && (
                        <span className="text-[9px] px-1 bg-[#1e2d40] text-[#38bdf8] border border-[#2b3e58] rounded-sm">
                          {item.badge}
                        </span>
                      )}
                    </div>
                    {item.subtitle && (
                      <p className="text-[10px] text-[#64748b] mt-0.5">{item.subtitle}</p>
                    )}
                  </div>
                  <span className="text-[10px] text-[#64748b] uppercase tracking-wider">
                    {item.category}
                  </span>
                </div>
              );
            })
          )}
        </div>

        {/* Palette footer */}
        <div className="px-3 py-1.5 border-t border-[#1b2636] bg-[#090e16] flex items-center justify-between text-[10px] text-[#64748b]">
          <div className="flex items-center gap-3">
            <span>
              <kbd className="term-kbd text-[8px]">↑</kbd> <kbd className="term-kbd text-[8px]">↓</kbd> Navigate
            </span>
            <span>
              <kbd className="term-kbd text-[8px]">↵</kbd> Select
            </span>
          </div>
          <span>SAT Operator Palette</span>
        </div>
      </div>
    </div>
  );
}
