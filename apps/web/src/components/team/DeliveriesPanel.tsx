"use client";
import { teamAction } from "./api";
import { shortAddress } from "./format";
import { presentDelivery } from "./status";
import type { Run, TeamStatus } from "./types";
import { Button, ConfirmInline, EmptyState, Notice, Panel, PanelHeader, StatusPill } from "./ui";

export function DeliveriesPanel({ team, run, pending, onSetup }: { team: TeamStatus; run: Run; pending: string | null; onSetup: () => void }) {
  const ready = team.destination?.verified;
  return (
    <Panel>
      <PanelHeader title="Your Telegram deliveries" hint="Private to you. An uncertain send may already have arrived." />
      {!ready && <Notice tone="warn" className="mb-3">Your Telegram destination is not verified, so nothing is sent to you. <Button className="ml-2" onClick={onSetup}>Open setup</Button></Notice>}
      {!team.deliveries.length && <EmptyState title="No deliveries yet.">Deliveries are listed here after a matching alert is queued for your destination.</EmptyState>}
      <ul className="divide-y divide-[var(--line)]">
        {team.deliveries.map((d) => {
          const retry = () => run(`delivery:${d.id}:retry`, () => teamAction("retry-delivery", { id: d.id }), "Retry queued");
          return (
            <li key={d.id} className="space-y-2 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <StatusPill presented={presentDelivery(d.status)} />
                <span className="text-xs text-[var(--muted)] tabular-nums">{d.attempts} attempt{d.attempts === 1 ? "" : "s"}</span>
                <span title={d.eventId} className="mono text-xs text-[var(--muted)]">{shortAddress(d.eventId, 8, 4)}</span>
              </div>
              {d.lastError && <p className="break-words text-xs text-[#ff9f9f]">{d.lastError}</p>}
              {d.status === "FAILED" && <Button disabled={!!pending} busy={pending === `delivery:${d.id}:retry`} busyText="Retrying…" onClick={() => void retry()}>Retry delivery</Button>}
              {d.status === "UNCERTAIN" && (
                <ConfirmInline tone="warn" trigger="Retry delivery" confirmLabel="Retry anyway" busy={pending === `delivery:${d.id}:retry`}
                  message="This message may already have arrived. Check Telegram first — retrying can send a duplicate." onConfirm={retry} />
              )}
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}
