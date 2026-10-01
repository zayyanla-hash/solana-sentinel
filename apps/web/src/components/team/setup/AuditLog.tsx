"use client";
import { formatTime } from "../format";
import { collapseAudit, humanizeAction, presentAuditOutcome } from "../status";
import type { TeamStatus } from "../types";
import { EmptyState, Panel, PanelHeader, StatusPill } from "../ui";

export function AuditLog({ team }: { team: TeamStatus }) {
  const entries = collapseAudit(team.audit).slice(0, 20);
  return (
    <Panel>
      <PanelHeader title="Recent team changes" hint="A requested change without a completed entry may have been interrupted." />
      {!entries.length && <EmptyState title="No changes recorded yet." />}
      <ul className="divide-y divide-[var(--line)]">
        {entries.map((a) => {
          const outcome = presentAuditOutcome(a.outcome);
          return (
            <li key={a.id} className="grid gap-1 py-2 text-sm md:grid-cols-[10rem_8rem_minmax(0,1fr)_auto] md:items-center md:gap-3">
              <time dateTime={a.created_at} className="text-xs text-[var(--muted)] tabular-nums">{formatTime(a.created_at)}</time>
              <span>{a.username || "Host setup"}</span>
              <span>{humanizeAction(a.action)}</span>
              <span className="flex flex-wrap items-center gap-2"><StatusPill presented={outcome} />{a.outcome === "requested" && <span className="text-xs text-[var(--muted)]">{outcome.detail}</span>}</span>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}
