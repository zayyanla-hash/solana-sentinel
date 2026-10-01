"use client";
import type { MonitorHealth } from "./types";
import { Notice, Panel, PanelHeader } from "./ui";

export function MonitorStats({ monitor, error }: { monitor: MonitorHealth | null; error?: string }) {
  const stats = monitor?.stats;
  const tiles: [string, number | undefined, string][] = [
    ["Stored observations", stats?.observations, "Chain observations kept in the journal"],
    ["Archived", stats?.archivedObservations ?? (stats ? 0 : undefined), "Older observations moved to compressed archive"],
    ["Trade legs", stats?.trades, "Supported BUY/SELL legs found"],
    ["Unclassified", stats?.outcomes.UNKNOWN, "Parser abstained; not proof of no trade"],
  ];
  return (
    <Panel>
      <PanelHeader title="Monitor statistics" />
      {error && <Notice tone="error" className="mb-3">{error}</Notice>}
      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {tiles.map(([label, value, note]) => (
          <div key={label} className="rounded-md border border-[var(--line)] bg-[var(--bg-0)] p-3">
            <dt className="text-xs text-[var(--muted)]">{label}</dt>
            <dd className="mt-1 text-2xl font-semibold tabular-nums">{value === undefined ? "—" : value.toLocaleString("en-US")}</dd>
            <dd className="mt-1 text-xs text-[var(--muted)]">{value === undefined ? "Not available until the monitor reports." : note}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 text-xs text-[var(--muted)]">
        Scope: {monitor?.scope ?? "bounded recent window"}. Coverage is a bounded recent window, not complete lifetime history. Unsupported transactions remain unclassified.
        USD values and research performance are unavailable in this workspace.
      </p>
    </Panel>
  );
}
