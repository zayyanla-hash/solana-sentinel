"use client";
import { useMemo } from "react";
import { ActivityList } from "./ActivityList";
import { ChartSection } from "./ChartSection";
import { FirstRun } from "./FirstRun";
import { SystemCard } from "./SystemCard";
import { WatchlistCard } from "./WatchlistCard";
import { countCurrent, heroSummary, needsAttention, type AttentionItem } from "./derive";
import { Icon } from "./icons";
import type { MonitorHealth, NavTarget, Run, StateSnapshot, TeamStatus, View } from "./types";
import type { FeedEntry } from "./useActivityFeed";
import type { Observation } from "./types";
import s from "./team.module.css";
import { Skeleton, TONE_COLOR, cx } from "./ui";

type Props = {
  team: TeamStatus; state: StateSnapshot | null; monitor: MonitorHealth | null; errors: { state?: string; monitor?: string };
  feed: Record<string, FeedEntry>; observations: Observation[]; newest: Observation[]; reload: (wallet?: string) => void;
  addresses: string[]; query: string; stale: boolean; updatedAt: number | null; refreshing: boolean; onRefresh: () => void;
  onNavigate: (view: View, target?: NavTarget) => void; run: Run; pending: string | null;
};

const TONE_ICON = { ok: "check", warn: "alert", bad: "alert", neutral: "dot", pending: "dot" } as const;

function Attention({ items, onNavigate }: { items: AttentionItem[]; onNavigate: Props["onNavigate"] }) {
  if (!items.length) return null;
  return (
    <section aria-labelledby="attention-title" className="flex flex-col gap-3.5 max-lg:order-4">
      <div className="flex items-baseline justify-between">
        <h2 id="attention-title" className={s.h2}>Needs attention</h2>
        <span className={cx(s.muted, "text-[13px]")}>{items.length} item{items.length === 1 ? "" : "s"}</span>
      </div>
      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {items.map((item) => (
          <li key={item.key} className="flex min-w-0 flex-col gap-2.5 rounded-2xl border border-[var(--t-hair)] p-[18px]">
            <span className={s.iconCircle} style={{ width: 36, height: 36 }}>
              <Icon name={item.icon} color={item.tone === "bad" ? TONE_COLOR.bad : item.tone === "warn" ? TONE_COLOR.warn : "#A39C8E"} />
            </span>
            <h3 className="text-[15px] font-semibold">{item.title}</h3>
            <p className={cx(s.muted, "flex-grow text-[13px] leading-[1.45] break-words")}>{item.body}</p>
            <button type="button" onClick={() => onNavigate(item.view, { wallet: item.wallet, step: item.step })} className="inline-flex min-h-8 items-center gap-1 self-start border-0 bg-transparent p-0 text-sm font-semibold text-[var(--t-ink)]">
              {item.action}<span className={s.sr}>: {item.title}</span><Icon name="chev" size={16} />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="flex flex-col gap-0.5 border-b border-[var(--t-hair)] py-3.5">
      <dt className={cx(s.muted, "text-[13px]")}>{label}</dt>
      <dd className="text-xl font-medium">{value}</dd>
      {sub && <dd className={s.fine}>{sub}</dd>}
    </div>
  );
}

export function HomeView(props: Props) {
  const { team, state, monitor, errors, feed, observations, newest, reload, addresses, query, stale, onNavigate, run, pending } = props;
  const hero = useMemo(() => heroSummary({ monitor, monitorError: errors.monitor, addresses }), [monitor, errors.monitor, addresses]);
  const attention = useMemo(() => needsAttention({ monitor, monitorError: errors.monitor, team, addresses }), [monitor, errors.monitor, team, addresses]);
  const stats = monitor?.stats ?? null;
  const { current, total } = countCurrent(addresses, monitor?.wallets);
  const fmt = (n: number | undefined) => (n === undefined ? "—" : n.toLocaleString("en-US"));

  if (state && addresses.length === 0) {
    return <FirstRun team={team} monitor={monitor} run={run} pending={pending} onNavigate={onNavigate} updatedAt={props.updatedAt} refreshing={props.refreshing} onRefresh={props.onRefresh} />;
  }

  const heroColor = hero.status.tone === "ok" ? TONE_COLOR.ok : hero.status.tone === "warn" ? TONE_COLOR.warn : hero.status.tone === "bad" ? TONE_COLOR.bad : "#A39C8E";
  return (
    <div className="flex flex-col gap-10 lg:grid lg:grid-cols-[minmax(0,1fr)_380px] lg:gap-16">
      <div className="contents lg:flex lg:min-w-0 lg:flex-col lg:gap-11">
        <section aria-labelledby="hero" className="flex flex-col gap-3 max-lg:order-1">
          <span className={s.eyebrow}>Shared monitor{state ? ` · ${addresses.length} wallet${addresses.length === 1 ? "" : "s"}` : ""}</span>
          {!state && !errors.state ? <Skeleton className="h-14 w-3/4" /> : (
            <h1 id="hero" className="text-4xl leading-none font-medium tracking-[-0.04em] sm:text-6xl" style={stale ? { color: "#8F897D" } : undefined}>{hero.headline}</h1>
          )}
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-base">
            <span className="inline-flex items-center gap-2 font-semibold" style={{ color: heroColor }}>
              <Icon name={TONE_ICON[hero.status.tone]} color={heroColor} />{hero.status.label}
            </span>
            {hero.reason && <span className={s.muted}>· {hero.reason}</span>}
            {stale && <span className={s.muted}>· Last known — may be out of date</span>}
          </div>
        </section>

        <div className="max-lg:order-2"><ChartSection addresses={addresses} feed={feed} observations={observations} reload={reload} dim={stale} label="Observations in the recent window" /></div>

        <Attention items={attention} onNavigate={onNavigate} />

        <section aria-labelledby="stats-title" className="flex flex-col max-lg:order-5">
          <h2 id="stats-title" className={cx(s.h2, "mb-1")}>Key statistics</h2>
          {errors.monitor && <p className={cx(s.fine, "mb-2")}>Statistics unavailable: {errors.monitor}.</p>}
          <dl className="grid grid-cols-2 gap-x-8 md:grid-cols-4">
            <Stat label="Stored observations" value={fmt(stats?.observations)} />
            <Stat label="Archived" value={fmt(stats?.archivedObservations)} />
            <Stat label="Journal capacity" value={stats?.observationCapacityPercent === undefined ? "—" : `${stats.observationCapacityPercent}%`} sub="of retention limit" />
            <Stat label="Pending alerts" value={fmt(stats?.pendingAlerts)} />
            <Stat label="Trade legs" value={fmt(stats?.trades)} sub="supported BUY/SELL" />
            <Stat label="Unclassified" value={fmt(stats?.outcomes.UNKNOWN)} sub="not proof of no trade" />
            <Stat label="Failed" value={fmt(stats?.outcomes.FAILED)} sub="failed on chain" />
            <Stat label="Wallets current" value={monitor ? `${current} / ${total}` : "—"} />
          </dl>
        </section>

        <section aria-labelledby="activity-title" className="flex flex-col max-lg:order-6">
          <h2 id="activity-title" className={s.h2}>Recent activity</h2>
          {newest.length === 0 && <p className={cx(s.muted, "pt-4 text-sm")}>No observations to list yet.</p>}
          {newest.length > 0 && <ActivityList items={newest} showWallet onOpenWallet={(wallet) => onNavigate("wallets", { wallet })} />}
          <p className={cx(s.fine, "mt-4")}>Bounded recent window per wallet, not lifetime history. Quantities only — USD prices are unavailable. Read-only chain access; Sentinel never signs or trades.</p>
        </section>
      </div>
      <aside aria-label="Watchlist and system" className="contents lg:flex lg:flex-col lg:gap-5">
        <div className="max-lg:order-3">
          <WatchlistCard state={state} monitor={monitor} error={errors.state} feed={feed} query={query} onOpen={(address) => onNavigate("wallets", { wallet: address })} run={run} pending={pending} />
        </div>
        <div className="max-lg:order-7">
          <SystemCard monitor={monitor} team={team} updatedAt={props.updatedAt} refreshing={props.refreshing} onRefresh={props.onRefresh} />
        </div>
      </aside>
    </div>
  );
}

