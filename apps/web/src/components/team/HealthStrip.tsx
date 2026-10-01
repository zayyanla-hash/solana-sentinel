"use client";
import { useEffect, useState } from "react";
import { formatAge, formatClock } from "./format";
import { presentBackup, presentMonitor, presentRpc, presentTelegram, presentWorker } from "./status";
import type { MonitorHealth, TeamStatus } from "./types";
import { Button, Notice, StatusPill } from "./ui";

const STALE_AFTER_MS = 45_000;

export function HealthStrip({ team, monitor, monitorError, monitorUpdatedAt, lastSuccessAt, refreshError, refreshing, onRefresh }: {
  team: TeamStatus; monitor: MonitorHealth | null; monitorError?: string; monitorUpdatedAt: number | null; lastSuccessAt: number | null;
  refreshError: string | null; refreshing: boolean; onRefresh: () => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const stale = lastSuccessAt !== null && Math.max(0, now - lastSuccessAt) > STALE_AFTER_MS;
  const pills = [
    presentMonitor(monitor?.status, monitorError ?? null),
    presentWorker(monitor?.worker),
    presentBackup(monitor?.backup, "backup"),
    presentBackup(monitor?.backupCopy, "copy"),
    presentRpc(team.rpcConfigured),
    presentTelegram(team.telegramConfigured),
  ];
  return (
    <div aria-label="System health" role="group" className="space-y-3 rounded-lg border border-[var(--line)] bg-[var(--bg-1)]/90 px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        {pills.map((p) => <StatusPill key={p.label} presented={p} />)}
        <span className="ml-auto flex items-center gap-2 text-xs text-[var(--muted)]">
          <span className="tabular-nums">{lastSuccessAt ? `Updated ${formatAge(Math.max(0, now - lastSuccessAt))} ago` : "Not updated yet"}</span>
          <Button variant="ghost" busy={refreshing} busyText="Refreshing…" onClick={onRefresh} className="!min-h-8">Refresh</Button>
        </span>
      </div>
      {(refreshError || stale) && lastSuccessAt && (
        <Notice tone="warn">
          Showing data from {formatClock(lastSuccessAt)}
          {refreshError ? ` — refresh failing: ${refreshError}` : " — the latest refresh has not completed."}
        </Notice>
      )}
      {monitorError && monitor && monitorUpdatedAt && (
        <Notice tone="warn">
          Monitor health could not be refreshed: {monitorError}. Worker and backup status shown are from {formatClock(monitorUpdatedAt)}.
        </Notice>
      )}
      <p className="text-xs text-[var(--muted)]">Monitoring pauses while the host Mac is asleep or offline.</p>
    </div>
  );
}
