"use client";
import { useState } from "react";
import { Sparkline } from "./Chart";
import { AddWalletForm } from "./AddWalletForm";
import { isWalletCurrent } from "./derive";
import { formatAge, shortAddress } from "./format";
import { Icon } from "./icons";
import { presentWallet, type Tone } from "./status";
import type { FeedEntry } from "./useActivityFeed";
import type { MonitorHealth, Run, StateSnapshot } from "./types";
import s from "./team.module.css";
import { Notice, SegGroup, Skeleton, StatusPill, Button, cx } from "./ui";

const SPARK: Record<Tone, string> = { ok: "#C9C3B6", warn: "#FFB01F", bad: "#FF5000", neutral: "#4A443A", pending: "#4A443A" };

export type WatchFilter = "all" | "attention";

export function WatchlistCard({ state, monitor, error, feed, query, onOpen, run, pending }: {
  state: StateSnapshot | null; monitor: MonitorHealth | null; error?: string; feed: Record<string, FeedEntry>;
  query: string; onOpen: (address: string) => void; run: Run; pending: string | null;
}) {
  const [adding, setAdding] = useState(false);
  const [filter, setFilter] = useState<WatchFilter>("all");
  const wallets = state?.watchlist.filter((w) => w.kind === "WALLET") ?? [];
  const health = (address: string) => monitor?.wallets.find((h) => h.wallet === address);
  const attention = wallets.filter((w) => !isWalletCurrent(health(w.address))).length;
  const q = query.trim().toLowerCase();
  const visible = wallets.filter((w) => (!q || w.address.toLowerCase().includes(q)) && (filter === "all" || !isWalletCurrent(health(w.address))));

  return (
    <section aria-labelledby="watchlist-title" className={cx(s.panel, "!px-[22px] !pt-[22px] !pb-2")}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 id="watchlist-title" className={s.h3}>Watchlist</h2>
          <p className={cx(s.muted, "text-[13px]")}>Shared by both members</p>
        </div>
        {adding
          ? <Button small onClick={() => setAdding(false)}>Cancel</Button>
          : <Button variant="primary" small onClick={() => setAdding(true)}><Icon name="plus" size={16} color="#0E0C09" strokeWidth={2.2} />Add wallet</Button>}
      </div>
      {adding && <div className="mt-4"><AddWalletForm run={run} pending={pending} autoFocus onDone={() => setAdding(false)} /></div>}
      {wallets.length > 0 && (
        <SegGroup<WatchFilter> className="mt-4" label="Filter watchlist" value={filter} onChange={setFilter}
          options={[{ value: "all", label: "All", count: wallets.length }, { value: "attention", label: "Needs attention", count: attention }]} />
      )}
      {error && <Notice tone="error" className="mt-3">Could not load the watchlist: {error}</Notice>}
      {!state && !error && <div className="my-4 space-y-3"><Skeleton className="h-12" /><Skeleton className="h-12" /></div>}
      {state && !wallets.length && <p className={cx(s.muted, "py-6 text-sm")}>No wallets watched yet. No sample wallets are added automatically.</p>}
      {state && wallets.length > 0 && !visible.length && <p className={cx(s.muted, "py-6 text-sm")}>{q ? `No watched wallet matches “${query.trim()}”.` : "Every watched wallet is current."}</p>}
      <ul className="mt-2">
        {visible.map((w, index) => {
          const h = health(w.address);
          const presented = presentWallet(h);
          const entry = feed[w.address];
          const observations = (entry?.data?.activity ?? []).map((item) => ({ wallet: w.address, item }));
          const sub = h?.lastError ? h.lastError : h?.pollAgeMs == null ? "No completed poll yet" : `${formatAge(h.pollAgeMs)} ago${entry?.data ? ` · ${entry.data.activity.length} obs` : ""}`;
          return (
            <li key={w.id} className={cx(index === visible.length - 1 && "[&>button]:border-b-0")}>
              <button type="button" onClick={() => onOpen(w.address)} className={cx(s.row, "w-full border-x-0 border-t-0 bg-transparent py-3.5 text-left text-[var(--t-ink)]")} aria-label={`${w.address}, ${presented.label}. Open wallet`}>
                <span className="flex min-w-0 shrink flex-col gap-0.5">
                  <span className={cx(s.mono, "text-[15px] whitespace-nowrap")} title={w.address}>{shortAddress(w.address)}</span>
                  <span className={cx(s.muted, "truncate text-[13px]")}>{sub}</span>
                </span>
                <span className="flex shrink-0 items-center gap-3.5">
                  <span className="hidden sm:inline-flex"><Sparkline observations={observations} color={SPARK[presented.tone]} /></span>
                  <StatusPill presented={presented} className="min-w-[92px] justify-center" />
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <p className={cx(s.fine, "pb-3")} hidden={!wallets.length}>Select a wallet to see its activity and create alerts.</p>
    </section>
  );
}
