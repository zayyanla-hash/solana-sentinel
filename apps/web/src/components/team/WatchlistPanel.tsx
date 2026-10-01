"use client";
import { useState, type FormEvent } from "react";
import { changeState } from "./api";
import { formatAge, isBase58Address } from "./format";
import { presentWallet } from "./status";
import type { MonitorHealth, Run, StateSnapshot } from "./types";
import { Address, Button, ConfirmInline, EmptyState, Notice, Panel, PanelHeader, Skeleton, StatusPill, TextInput } from "./ui";

export function WatchlistPanel({ state, monitor, error, selected, onSelect, run, pending }: {
  state: StateSnapshot | null; monitor: MonitorHealth | null; error?: string; selected: string | null;
  onSelect: (address: string | null) => void; run: Run; pending: string | null;
}) {
  const [wallet, setWallet] = useState("");
  const [touched, setTouched] = useState(false);
  const trimmed = wallet.trim();
  const problem = touched && trimmed && !isBase58Address(trimmed)
    ? "That does not look like a Solana address (32–44 base58 characters)." : null;
  const wallets = state?.watchlist.filter((w) => w.kind === "WALLET") ?? [];

  async function add(event: FormEvent) {
    event.preventDefault();
    setTouched(true);
    if (!isBase58Address(trimmed)) return;
    const ok = await run("wallet:add", async () => {
      await changeState("watchlist_add", { kind: "WALLET", address: trimmed });
    }, "Wallet added; monitoring picks it up automatically");
    if (ok) { setWallet(""); setTouched(false); }
  }

  return (
    <Panel>
      <PanelHeader title="Shared watchlist" hint="Both members see and edit the same wallets." />
      <form onSubmit={add} noValidate className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start">
        <div className="min-w-0 grow">
          <TextInput label="Wallet address" value={wallet} onChange={(e) => setWallet(e.target.value)} onBlur={() => setTouched(true)}
            placeholder="Public Solana wallet address" autoComplete="off" spellCheck={false} className="mono"
            hint="Public address only. Never paste a private key or seed phrase." error={problem} />
        </div>
        <Button type="submit" variant="primary" className="sm:mt-6" busy={pending === "wallet:add"} busyText="Adding…" disabled={!!pending}>Watch wallet</Button>
      </form>
      {error && <Notice tone="error" className="mb-3">Could not load the watchlist: {error}</Notice>}
      {!state && !error && <div className="space-y-2"><Skeleton className="h-12" /><Skeleton className="h-12" /></div>}
      {state && !wallets.length && (
        <EmptyState title="No wallets watched yet.">Add a public wallet address to begin. No sample wallets are added automatically.</EmptyState>
      )}
      {wallets.length > 0 && (
        <ul className="divide-y divide-[var(--line)] border-y border-[var(--line)]">
          {wallets.map((w) => {
            const health = monitor?.wallets.find((h) => h.wallet === w.address);
            const presented = presentWallet(health);
            const isSelected = selected === w.address;
            return (
              <li key={w.id} className={`grid gap-3 py-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-center ${isSelected ? "bg-[var(--accent)]/5" : ""}`}>
                <div className="min-w-0 space-y-1">
                  <Address value={w.address} />
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusPill presented={presented} />
                    <span className="text-xs text-[var(--muted)]">
                      {health?.pollAgeMs == null ? "No completed poll yet" : `Last head observation ${formatAge(health.pollAgeMs)} ago`}
                    </span>
                  </div>
                  {health?.lastError && <p className="break-words text-xs text-[#ff9f9f]">{health.lastError}</p>}
                  {presented.detail && presented.tone === "warn" && <p className="text-xs text-[var(--muted)]">{presented.detail}</p>}
                </div>
                <div className="flex flex-wrap items-start gap-2 md:justify-end">
                  <Button aria-pressed={isSelected} onClick={() => onSelect(isSelected ? null : w.address)}
                    className={isSelected ? "!border-[var(--accent)] !text-[var(--accent)]" : ""}>
                    {isSelected ? "Viewing activity" : "View activity"}
                  </Button>
                  <ConfirmInline trigger="Remove" message="Remove wallet? Its history is kept." confirmLabel="Remove wallet" busy={pending === `wallet:${w.id}:remove`}
                    onConfirm={() => run(`wallet:${w.id}:remove`, async () => {
                      await changeState("watchlist_remove", { id: w.id });
                      if (isSelected) onSelect(null);
                    }, "Wallet removed")} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}
