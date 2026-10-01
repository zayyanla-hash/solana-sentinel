"use client";
import { formatClock } from "./format";
import { StaleBanner } from "./Banners";
import type { useTeamWorkspace } from "./useTeamWorkspace";
import { Notice, useStale } from "./ui";

type Workspace = ReturnType<typeof useTeamWorkspace>;

/** Global status messages: stale/offline, partial source failures, and unscoped action results. */
export function Banners({ ws }: { ws: Workspace }) {
  const { lastSuccessAt, refreshError, monitor, monitorUpdatedAt, errors, state, notice } = ws;
  const stale = useStale(lastSuccessAt, refreshError);
  return (
    <div className="sticky top-[76px] z-30 mb-6 flex flex-col gap-3 empty:mb-0 md:top-[84px]" aria-live="polite">
      {stale && lastSuccessAt !== null && <StaleBanner lastSuccessAt={lastSuccessAt} refreshError={refreshError} refreshing={ws.refreshing} onRetry={() => void ws.refresh()} />}
      {errors.monitor && monitor && monitorUpdatedAt !== null && (
        <Notice tone="warn">Monitor health could not be refreshed: {errors.monitor}. Worker and backup status shown are from {formatClock(monitorUpdatedAt)}.</Notice>
      )}
      {errors.state && state && <Notice tone="warn">The watchlist and alerts could not be refreshed: {errors.state}. Showing the last loaded data.</Notice>}
      {notice && !notice.scope && <Notice tone={notice.tone} onDismiss={ws.dismissNotice}>{notice.text}</Notice>}
    </div>
  );
}
