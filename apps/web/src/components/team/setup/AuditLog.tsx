"use client";
import { formatTime } from "../format";
import { collapseAudit, humanizeAction, presentAuditOutcome } from "../status";
import type { TeamStatus } from "../types";
import s from "../team.module.css";
import { StatusPill, cx } from "../ui";

export function AuditLog({ team }: { team: TeamStatus }) {
  const entries = collapseAudit(team.audit).slice(0, 20);
  return (
    <section aria-labelledby="audit-title" className="flex flex-col">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-[var(--t-hair)] pb-2">
        <h2 id="audit-title" className={s.h2}>Recent team changes</h2>
        <span className={cx(s.muted, "text-[13px]")}>A requested change without a completed entry may have been interrupted.</span>
      </div>
      {!entries.length && <p className={cx(s.muted, "py-5 text-sm")}>No changes recorded yet.</p>}
      <ul>
        {entries.map((a) => {
          const outcome = presentAuditOutcome(a.outcome);
          return (
            <li key={a.id} className={cx(s.row, "!gap-3 !py-3.5 text-sm max-md:flex-col max-md:!items-start")}>
              <span className="flex flex-col gap-0.5 md:flex-row md:items-center md:gap-4">
                <time dateTime={a.created_at} className={cx(s.muted, "text-xs whitespace-nowrap md:w-36")}>{formatTime(a.created_at)}</time>
                <span className="font-semibold md:w-28">{a.username || "Host setup"}</span>
                <span>{humanizeAction(a.action)}</span>
              </span>
              <span className="flex flex-wrap items-center gap-2"><StatusPill presented={outcome} />{a.outcome === "requested" && <span className={s.fine}>{outcome.detail}</span>}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
