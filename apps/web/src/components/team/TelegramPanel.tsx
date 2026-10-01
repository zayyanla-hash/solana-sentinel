"use client";
import { teamAction } from "./api";
import { inboxEvents } from "./derive-alerts";
import { maskChatId, shortAddress } from "./format";
import { presentDelivery, presentDestination } from "./status";
import type { Delivery, Run, StateSnapshot, TeamStatus } from "./types";
import s from "./team.module.css";
import { Button, ConfirmInline, Notice, StatusPill, cx } from "./ui";

export function TelegramPanel({ team, state, run, pending, onSetup }: { team: TeamStatus; state: StateSnapshot | null; run: Run; pending: string | null; onSetup: () => void }) {
  const destination = team.destination;
  const ready = Boolean(destination?.verified);
  const titles = new Map(inboxEvents(state?.alertEvents ?? []).map((event) => [event.id, event.title]));
  const label = (d: Delivery) => titles.get(d.eventId) ?? `Alert ${shortAddress(d.eventId, 8, 4)}`;
  const retry = (d: Delivery) => () => run(`delivery:${d.id}:retry`, () => teamAction("retry-delivery", { id: d.id }), "Retry queued");
  const meta = (d: Delivery) => `${d.attempts} attempt${d.attempts === 1 ? "" : "s"}${d.lastError ? ` · ${d.lastError}` : ""}`;

  return (
    <aside aria-label="Your Telegram deliveries" className="flex flex-col gap-6">
      <section aria-labelledby="telegram-title" className={s.panel}>
        <div className="mb-2 flex items-center justify-between gap-3">
          <div>
            <h2 id="telegram-title" className={s.h3}>Your Telegram</h2>
            <span className={cx(s.muted, "text-[13px]")}>{ready ? `Chat ${maskChatId(destination?.chatId)} · verified` : "Private to you"}</span>
          </div>
          <StatusPill presented={presentDestination(destination)} />
        </div>
        {!ready && (
          <Notice tone="warn" className="my-3" action={<Button small onClick={onSetup}>Open setup</Button>}>
            Your Telegram destination is not verified, so nothing is sent to you.
          </Notice>
        )}
        {ready && destination && !destination.enabled && <p className={cx(s.muted, "my-3 text-sm")}>Delivery is paused. Alerts still land in the shared inbox.</p>}
        {!team.deliveries.length && <p className={cx(s.muted, "pt-4 text-sm")}>No deliveries yet. They are listed here after a matching alert is queued for your destination.</p>}
        <ul className="mt-2">
          {team.deliveries.map((d, index) => {
            const presented = presentDelivery(d.status);
            const busy = pending === `delivery:${d.id}:retry`;
            if (d.status === "UNCERTAIN") {
              return (
                <li key={d.id} className="my-3 flex flex-col gap-3 rounded-2xl border border-[var(--t-caution)] p-4">
                  <div className="flex justify-between gap-3">
                    <span className="flex min-w-0 flex-col"><span className="text-sm font-semibold break-words">{label(d)}</span><span className={s.fine}>{meta(d)}</span></span>
                    <StatusPill presented={presented} />
                  </div>
                  <p className="text-[13px] leading-[1.45] text-[#e9e4da]">This message may already be in Telegram. Check there first — retrying can send a duplicate.</p>
                  <ConfirmInline tone="warn" trigger="Retry delivery" confirmLabel="Retry anyway" busy={busy} message="Check Telegram first — retrying can send a duplicate." onConfirm={retry(d)} />
                </li>
              );
            }
            return (
              <li key={d.id} className={cx(s.row, index === team.deliveries.length - 1 && s.rowLast, "flex-wrap")}>
                <span className="flex min-w-0 flex-col"><span className="text-sm font-semibold break-words">{label(d)}</span><span className={s.fine}>{meta(d)}</span></span>
                <span className="flex items-center gap-2">
                  {d.status === "FAILED" && <Button small disabled={!!pending} busy={busy} busyText="Retrying…" onClick={() => void retry(d)()}>Retry delivery</Button>}
                  <StatusPill presented={presented} />
                </span>
              </li>
            );
          })}
        </ul>
      </section>
      <Button className="self-start" onClick={onSetup}>Manage destination</Button>
    </aside>
  );
}
