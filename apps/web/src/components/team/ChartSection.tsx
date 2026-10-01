"use client";
import { useMemo, useState } from "react";
import { ChartLegend, ObservationChart, chartRange } from "./Chart";
import type { ChartFilter } from "./chart-data";
import { shortAddress } from "./format";
import type { FeedEntry } from "./useActivityFeed";
import type { Observation } from "./types";
import s from "./team.module.css";
import { Button, EmptyState, Notice, SegGroup, Skeleton, cx } from "./ui";

type Props = {
  addresses: string[];
  feed: Record<string, FeedEntry>;
  observations: Observation[];
  reload: (wallet?: string) => void;
  dim?: boolean;
  /** Extra filter options (the wallet view adds "Unclassified"). */
  extraFilters?: boolean;
  label: string;
  /** Show the wallet picker (home). The wallet view charts a single wallet. */
  walletPicker?: boolean;
  emptyTitle?: string;
};

export function ChartSection({ addresses, feed, observations, reload, dim, extraFilters, label, walletPicker = true, emptyTitle = "No observations yet." }: Props) {
  const [filter, setFilter] = useState<ChartFilter>("all");
  const [wallet, setWallet] = useState<string>("all");
  const picked = wallet !== "all" && addresses.includes(wallet) ? wallet : "all";
  const shown = useMemo(() => (picked === "all" ? observations : observations.filter((o) => o.wallet === picked)), [observations, picked]);
  const range = useMemo(() => chartRange(shown), [shown]);
  const entries = addresses.map((a) => feed[a]);
  const loading = entries.some((e) => !e || (e.loading && !e.data));
  const failed = addresses.filter((a) => feed[a]?.error);
  const allFailed = failed.length > 0 && failed.length === addresses.length && !observations.length;

  const options: { value: ChartFilter; label: string }[] = [
    { value: "all", label: "All" }, { value: "buys", label: "Buys" }, { value: "sells", label: "Sells" },
    ...(extraFilters ? [{ value: "unclassified" as const, label: "Unclassified" }] : []),
  ];

  return (
    <section aria-label={label} className="flex flex-col gap-3.5">
      {walletPicker && addresses.length > 1 && (
        <div className="flex justify-end">
          {addresses.length <= 4 ? (
            <SegGroup<string> label="Wallet" value={picked} onChange={setWallet}
              options={[{ value: "all", label: "All wallets" }, ...addresses.map((a) => ({ value: a, label: <span className={s.mono}>{shortAddress(a)}</span> }))]} />
          ) : (
            <label className="flex items-center gap-2 text-[13px]">
              <span className={s.muted}>Wallet</span>
              <select className={cx(s.field, s.fieldSm, "!w-auto min-w-44")} value={picked} onChange={(event) => setWallet(event.target.value)}>
                <option value="all">All wallets</option>
                {addresses.map((a) => <option key={a} value={a}>{shortAddress(a)}</option>)}
              </select>
            </label>
          )}
        </div>
      )}
      {loading && !shown.length && <div aria-busy="true" aria-label="Loading observations"><Skeleton className="h-[200px] w-full sm:h-[250px]" /></div>}
      {allFailed && (
        <Notice tone="error" action={<Button small onClick={() => reload()}>Retry</Button>}>Could not load activity: {feed[failed[0]!]?.error}</Notice>
      )}
      {!allFailed && failed.length > 0 && (
        <Notice tone="warn" action={<Button small onClick={() => reload()}>Retry</Button>}>Activity for {failed.length} of {addresses.length} wallets could not be loaded, so the chart is incomplete.</Notice>
      )}
      {!loading && !allFailed && !shown.length && (
        <EmptyState title={emptyTitle}>Observations appear after the first successful poll of a watched wallet. A bounded recent window is shown, never lifetime history.</EmptyState>
      )}
      {shown.length > 0 && (
        <>
          <ObservationChart observations={shown} filter={filter} dim={dim} label={label} />
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-[var(--t-hair)] pt-2.5">
            <SegGroup<ChartFilter> label="Show on chart" value={filter} onChange={setFilter} options={options} />
            {range && <span className={cx(s.muted, "text-xs")}>{range.from} → {range.to}</span>}
          </div>
          <ChartLegend />
        </>
      )}
    </section>
  );
}
