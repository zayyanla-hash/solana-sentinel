"use client";
import { useMemo } from "react";
import { ActivityList } from "./ActivityList";
import { ChartSection } from "./ChartSection";
import { WalletAlertPanel } from "./WalletAlertPanel";
import { changeState } from "./api";
import { rulesForWallet, walletStats } from "./derive";
import { formatAge, shortAddress } from "./format";
import { Icon } from "./icons";
import { presentWallet } from "./status";
import type { FeedEntry } from "./useActivityFeed";
import type { MonitorHealth, Notice, Observation, Run, StateSnapshot, TeamStatus } from "./types";
import s from "./team.module.css";
import { Button, ConfirmInline, CopyButton, Notice as NoticeBox, Skeleton, StatusPill, cx } from "./ui";
import { sortNewestFirst } from "./chart-model";

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="flex flex-col gap-0.5 border-b border-[var(--t-hair)] py-3.5">
      <dt className={cx(s.muted, "text-[13px]")}>{label}</dt>
      <dd className="text-xl font-medium">{value}</dd>
      {sub && <dd className={s.fine}>{sub}</dd>}
    </div>
  );
}

const humanize = (value: string) => value.toLowerCase().replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

export function WalletView({ address, team, state, monitor, entry, reload, dim, run, pending, notice, onDismiss, onBack, onEditRules }: {
  address: string; team: TeamStatus; state: StateSnapshot | null; monitor: MonitorHealth | null; entry: FeedEntry | undefined; reload: (wallet?: string) => void;
  dim: boolean; run: Run; pending: string | null; notice: Notice | null; onDismiss: () => void; onBack: () => void; onEditRules: () => void;
}) {
  const watched = state?.watchlist.find((w) => w.kind === "WALLET" && w.address === address);
  const health = monitor?.wallets.find((w) => w.wallet === address);
  const presented = presentWallet(health);
  const observations = useMemo<Observation[]>(() => (entry?.data?.activity ?? []).map((item) => ({ wallet: address, item })), [entry, address]);
  const newest = useMemo(() => sortNewestFirst(observations), [observations]);
  const stats = useMemo(() => walletStats(observations), [observations]);
  const scoped = rulesForWallet(state?.alertRules ?? [], address);
  const feed = useMemo(() => (entry ? { [address]: entry } : {}), [entry, address]);
  const loaded = Boolean(entry?.data);

  return (
    <div className="flex flex-col gap-10 lg:grid lg:grid-cols-[minmax(0,1fr)_380px] lg:gap-16">
      <div className="flex min-w-0 flex-col gap-9">
        <section aria-labelledby="wallet-title" className="flex flex-col gap-3">
          <button type="button" onClick={onBack} className={cx(s.muted, "inline-flex min-h-9 items-center gap-1 self-start border-0 bg-transparent p-0 text-sm font-semibold hover:text-[var(--t-ink)]")}>
            <Icon name="back" size={16} />Wallets
          </button>
          <div className="flex flex-wrap items-center gap-3">
            <h1 id="wallet-title" className={cx(s.mono, "text-2xl font-medium tracking-[-0.02em] break-all sm:text-4xl")} title={address}>
              <span aria-hidden="true">{shortAddress(address, 8, 8)}</span><span className={s.sr}>{address}</span>
            </h1>
            <CopyButton value={address} label="Copy address">Copy address</CopyButton>
          </div>
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-base">
            <StatusPill presented={presented} />
            <span className={s.muted}>
              {health?.pollAgeMs == null ? "No completed poll yet" : `Last head observation ${formatAge(health.pollAgeMs)} ago`}
              {stats.parserRevision ? ` · parser revision ${stats.parserRevision}` : ""}
            </span>
          </div>
          {health?.lastError && <p className="text-sm break-words" style={{ color: "#FF8A5C" }}>{health.lastError}</p>}
          {!watched && state && <NoticeBox tone="warn">This wallet is no longer on the shared watchlist.</NoticeBox>}
        </section>

        <section aria-labelledby="wallet-chart" className="flex flex-col gap-4">
          <h2 id="wallet-chart" className={s.sr}>Observations chart</h2>
          <div>
            <span className={cx(s.muted, "text-[13px]")}>Supported trade legs in the {loaded ? stats.observations : "most recent"} observations</span>
            {loaded ? <div className="text-5xl font-medium tracking-[-0.035em] sm:text-6xl" style={dim ? { color: "#8F897D" } : undefined}>{stats.legs}</div> : <Skeleton className="mt-2 h-14 w-24" />}
          </div>
          <ChartSection addresses={[address]} feed={feed} observations={observations} reload={reload} dim={dim} extraFilters walletPicker={false} label={`Observations for ${shortAddress(address)}`} />
        </section>

        <section aria-labelledby="wallet-stats" className="flex flex-col">
          <h2 id="wallet-stats" className={cx(s.h2, "mb-1")}>Key statistics</h2>
          <dl className="grid grid-cols-2 gap-x-8 md:grid-cols-4">
            <Stat label="Observations" value={loaded ? String(stats.observations) : "—"} sub="recent window" />
            <Stat label="Buys" value={loaded ? String(stats.buys) : "—"} />
            <Stat label="Sells" value={loaded ? String(stats.sells) : "—"} />
            <Stat label="Unclassified" value={loaded ? String(stats.unclassified) : "—"} sub="parser abstained" />
            <Stat label="Failed" value={loaded ? String(stats.failed) : "—"} />
            <Stat label="Coverage" value={health ? humanize(health.coverage) : "—"} sub={health?.pollAgeMs != null ? `head polled ${formatAge(health.pollAgeMs)} ago` : "no completed poll yet"} />
            <Stat label="Parser revision" value={stats.parserRevision ? String(stats.parserRevision) : "—"} />
            <Stat label="Rules on this wallet" value={String(scoped.rules.length)} sub={scoped.rules.length ? `${scoped.enabled} enabled` : undefined} />
          </dl>
        </section>

        <section aria-labelledby="wallet-obs" className="flex flex-col">
          <h2 id="wallet-obs" className={s.h2}>Observations</h2>
          {entry?.error && !loaded && <NoticeBox tone="error" className="mt-3" action={<Button small onClick={() => reload(address)}>Retry</Button>}>Could not load activity: {entry.error}</NoticeBox>}
          {!entry?.error && !loaded && <div className="mt-4 space-y-3"><Skeleton className="h-14" /><Skeleton className="h-14" /><Skeleton className="h-14" /></div>}
          {loaded && newest.length === 0 && <p className={cx(s.muted, "pt-4 text-sm")}>No observations yet. They appear after the first successful poll of this wallet.</p>}
          {newest.length > 0 && <ActivityList key={address} items={newest} pageSize={15} />}
          <p className={cx(s.fine, "mt-4")}>Most recent 50 observations. Reinterpretations by a newer parser do not send historical alerts. USD unavailable.</p>
        </section>
      </div>

      <div className="flex flex-col gap-6">
        <WalletAlertPanel key={address} address={address} team={team} rules={scoped.rules} run={run} pending={pending} notice={notice} onDismiss={onDismiss} onEditRules={onEditRules} />
        {watched && (
          <ConfirmInline trigger="Remove from watchlist" triggerVariant="link" confirmLabel="Remove wallet" message="Remove wallet? Its history is kept." busy={pending === `wallet:${watched.id}:remove`}
            triggerClassName="self-start"
            onConfirm={() => run(`wallet:${watched.id}:remove`, async () => { await changeState("watchlist_remove", { id: watched.id }); }, "Wallet removed").then((ok) => { if (ok) onBack(); })} />
        )}
      </div>
    </div>
  );
}
