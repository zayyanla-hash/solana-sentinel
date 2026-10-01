"use client";
import { WatchlistCard } from "./WatchlistCard";
import type { FeedEntry } from "./useActivityFeed";
import type { MonitorHealth, Run, StateSnapshot } from "./types";
import s from "./team.module.css";
import { cx } from "./ui";

export function WalletsList({ state, monitor, error, feed, query, onOpen, run, pending }: {
  state: StateSnapshot | null; monitor: MonitorHealth | null; error?: string; feed: Record<string, FeedEntry>; query: string;
  onOpen: (address: string) => void; run: Run; pending: string | null;
}) {
  return (
    <div className="flex max-w-[720px] flex-col gap-7">
      <div className="flex flex-col gap-2">
        <span className={s.eyebrow}>Shared watchlist</span>
        <h1 className="text-5xl leading-[1.05] font-medium tracking-[-0.035em]">Wallets</h1>
        <p className={cx(s.muted, "text-[15px]")}>Both members see and edit the same wallets. Open one to see its recent observations and create alerts for it.</p>
      </div>
      <WatchlistCard state={state} monitor={monitor} error={error} feed={feed} query={query} onOpen={onOpen} run={run} pending={pending} />
    </div>
  );
}
