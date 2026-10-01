"use client";
import { systemRows } from "./derive";
import type { MonitorHealth, TeamStatus } from "./types";
import s from "./team.module.css";
import { Button, Dot, Updated, cx, useNow } from "./ui";

export function SystemCard({ monitor, team, updatedAt, refreshing, onRefresh }: { monitor: MonitorHealth | null; team: TeamStatus; updatedAt: number | null; refreshing: boolean; onRefresh: () => void }) {
  const now = useNow(5000);
  const rows = systemRows(monitor, team, now);
  return (
    <section aria-labelledby="system-title" className={cx(s.panel, "!p-[22px]")}>
      <h2 id="system-title" className={cx(s.h3, "mb-1.5")}>System</h2>
      <ul>
        {rows.map((row, index) => (
          <li key={row.key} className={cx(s.row, "!gap-3 !py-[11px] text-sm", index === rows.length - 1 && s.rowLast)}>
            <span className="inline-flex items-center gap-2.5"><Dot tone={row.tone} />{row.label}</span>
            <span className="text-[13px]" style={{ color: row.tone === "warn" ? "#FFB01F" : row.tone === "bad" ? "#FF8A5C" : "#C9C3B6" }}>{row.value}</span>
          </li>
        ))}
      </ul>
      <p className={cx(s.fine, "mt-3")}>Monitoring pauses while the host Mac is asleep or offline.</p>
      <div className={cx(s.fine, "mt-2 flex items-center justify-between gap-2")}>
        <Updated at={updatedAt} />
        <Button variant="text" busy={refreshing} busyText="Refreshing…" onClick={onRefresh} className="!min-h-9 !text-[13px]">Refresh</Button>
      </div>
    </section>
  );
}
