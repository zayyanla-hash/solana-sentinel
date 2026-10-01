"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { formatClock, formatQty, shortAddress } from "./format";
import { messageOf } from "./useTeamWorkspace";
import { presentActivityOutcome } from "./status";
import type { ActivityItem, ActivityResponse } from "./types";
import { Address, Button, EmptyState, Notice, Panel, PanelHeader, Skeleton, StatusPill } from "./ui";

export function ActivityPanel({ wallet, load }: { wallet: string | null; load: (wallet: string) => Promise<ActivityResponse> }) {
  const [data, setData] = useState<ActivityResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const request = useRef(0); // only the latest request may update the panel

  const fetchActivity = useCallback(async (target: string) => {
    const ticket = ++request.current;
    setLoading(true); setError(null); setData(null);
    try {
      const result = await load(target);
      if (ticket === request.current) setData(result);
    } catch (e) {
      if (ticket === request.current) setError(messageOf(e));
    } finally {
      if (ticket === request.current) setLoading(false);
    }
  }, [load]);

  useEffect(() => {
    if (wallet) void fetchActivity(wallet);
    else { request.current += 1; setData(null); setError(null); setLoading(false); }
  }, [wallet, fetchActivity]);

  if (!wallet) {
    return (
      <Panel>
        <PanelHeader title="Recent activity" />
        <EmptyState title="Select a wallet">Choose View activity on a watched wallet to see its most recent observations.</EmptyState>
      </Panel>
    );
  }
  const revision = data?.activity.reduce((max, a) => Math.max(max, a.parserVersion), 0);
  return (
    <Panel id="wallet-activity">
      <PanelHeader title="Recent activity"
        hint={<><Address value={wallet} full /><span className="mt-1 block">Most recent 50 observations{revision ? ` · parser revision ${revision}` : ""} · USD unavailable</span></>} />
      <p className="mb-3 text-xs text-[var(--muted)]">
        Bounded recent window. Unclassified means the parser abstained — not proof that no trade happened. Reinterpretations do not send historical alerts.
      </p>
      {loading && <div className="space-y-2" aria-busy="true"><Skeleton className="h-16" /><Skeleton className="h-16" /><Skeleton className="h-16" /></div>}
      {error && <Notice tone="error">Could not load activity: {error} <Button className="ml-2" onClick={() => void fetchActivity(wallet)}>Retry</Button></Notice>}
      {data && !data.activity.length && <EmptyState title="No observations yet.">Observations appear after the first successful poll of this wallet.</EmptyState>}
      {data && data.activity.length > 0 && (
        <ul className="divide-y divide-[var(--line)] border-y border-[var(--line)]">{data.activity.map((a) => <Row key={a.signature} item={a} />)}</ul>
      )}
    </Panel>
  );
}

function Row({ item }: { item: ActivityItem }) {
  const outcome = presentActivityOutcome(item.outcome);
  return (
    <li className="space-y-1 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <StatusPill presented={outcome} />
        <span className="text-xs text-[var(--muted)] tabular-nums">Slot {item.slot}{item.blockTime ? ` · ${formatClock(item.blockTime * 1000)}` : ""}</span>
        <a className="mono text-xs text-[var(--accent)] underline underline-offset-2" href={`https://explorer.solana.com/tx/${item.signature}`} target="_blank" rel="noreferrer" title={item.signature}>
          {shortAddress(item.signature, 6, 6)}<span className="sr-only"> (opens Solana Explorer in a new tab)</span>
        </a>
      </div>
      {item.reason && <p className="break-words text-sm text-[var(--muted)]">{item.reason}</p>}
      {item.trades.map((t, i) => (
        <p key={i} className="break-all text-sm"><span className="font-semibold tabular-nums">{t.side} {formatQty(t.qty)}</span> <span className="mono text-xs text-[var(--muted)]">{t.mint}</span></p>
      ))}
    </li>
  );
}
