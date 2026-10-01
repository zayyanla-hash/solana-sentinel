"use client";
import { formatTime } from "./format";
import type { StateSnapshot } from "./types";
import { EmptyState, Notice, Panel, PanelHeader, Skeleton, StatusPill } from "./ui";

export function InboxPanel({ state, error }: { state: StateSnapshot | null; error?: string }) {
  const events = (state?.alertEvents ?? []).filter((e) => !e.isDemo)
    .slice().sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  return (
    <Panel>
      <PanelHeader title="Shared inbox" hint="Newest first. Visible to both members." />
      {error && <Notice tone="error" className="mb-3">Could not load alerts: {error}</Notice>}
      {!state && !error && <Skeleton className="h-24" />}
      {state && !events.length && <EmptyState title="No live alerts yet.">Alerts appear when a rule matches finalized, supported activity.</EmptyState>}
      <ul className="divide-y divide-[var(--line)]">
        {events.map((event) => (
          <li key={event.id} className="space-y-1 py-3">
            <h3 className="text-sm font-semibold">{event.title}</h3>
            <p className="break-words text-sm text-[var(--muted)]">{event.body}</p>
            <div className="flex flex-wrap items-center gap-2">
              <time dateTime={event.createdAt} title={new Date(event.createdAt).toLocaleString()} className="text-xs text-[var(--muted)]">{formatTime(event.createdAt)}</time>
              {event.delivered ? <StatusPill tone="ok" label="Delivered to inbox" /> : <StatusPill tone="neutral" label={`Suppressed · ${event.suppressedReason ?? "no reason recorded"}`} />}
            </div>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
