"use client";
import { formatAge, formatClock } from "./format";
import { Icon } from "./icons";
import s from "./team.module.css";
import { Button, cx, useNow } from "./ui";

/** Offline / stale banner: the last data stays on screen, greyed, and the exact age is stated. */
export function StaleBanner({ lastSuccessAt, refreshError, refreshing, onRetry }: { lastSuccessAt: number; refreshError: string | null; refreshing: boolean; onRetry: () => void }) {
  const now = useNow(1000);
  const age = formatAge(Math.max(0, now - lastSuccessAt));
  return (
    <div role="alert" className={cx(s.notice, s.noticeWarn, "flex flex-wrap items-center justify-between gap-3")}>
      <div className="flex min-w-0 flex-col gap-1">
        <span className="inline-flex items-center gap-2 font-semibold" style={{ color: "#FFB01F" }}>
          <Icon name="alert" size={16} color="#FFB01F" />{refreshError ? "Can’t reach the host Mac" : "The latest refresh has not completed"}
        </span>
        <span className="text-[13px] text-[#e9e4da]">
          Showing data from {formatClock(lastSuccessAt)} ({age} ago).{refreshError ? ` ${refreshError}. The Mac may be asleep, restarting or offline.` : " What you see may be out of date."} Retrying every 15s.
        </span>
      </div>
      <Button small busy={refreshing} busyText="Retrying…" onClick={onRetry}>Retry now</Button>
    </div>
  );
}
