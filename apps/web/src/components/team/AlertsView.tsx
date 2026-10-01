"use client";
import { useRef, useState, type KeyboardEvent } from "react";
import { changeState } from "./api";
import { RuleCard } from "./RuleCard";
import { TelegramPanel } from "./TelegramPanel";
import { inboxEvents, inboxSide } from "./derive-alerts";
import { formatAge, formatTime } from "./format";
import { Icon } from "./icons";
import type { Run, StateSnapshot, TeamStatus } from "./types";
import s from "./team.module.css";
import { Button, EmptyState, Notice, Skeleton, TONE_COLOR, cx } from "./ui";

type Tab = "inbox" | "rules";

function when(iso: string): string {
  const ms = Date.now() - Date.parse(iso);
  return Number.isFinite(ms) && ms >= 0 && ms < 86_400_000 ? `${formatAge(ms)} ago` : formatTime(iso);
}

function Inbox({ state, error }: { state: StateSnapshot | null; error?: string }) {
  const events = inboxEvents(state?.alertEvents ?? []);
  return (
    <section aria-label="Inbox">
      {error && <Notice tone="error" className="mb-3">Could not load alerts: {error}</Notice>}
      {!state && !error && <Skeleton className="h-24" />}
      {state && !events.length && <EmptyState title="No live alerts yet.">Alerts appear when a rule matches finalized, supported activity.</EmptyState>}
      <ul>
        {events.map((event) => {
          const side = inboxSide(event);
          return (
            <li key={event.id} className={cx(s.row, "!items-start")}>
              <span className="flex min-w-0 gap-3.5">
                <span className={s.iconCircle}><Icon name={side === "buy" ? "up" : side === "sell" ? "down" : "bell"} color={side === "buy" ? TONE_COLOR.ok : side === "sell" ? TONE_COLOR.bad : "#8F897D"} /></span>
                <span className="flex min-w-0 flex-col gap-0.5">
                  <h3 className="text-[15px] font-semibold break-words">{event.title}</h3>
                  <span className="text-sm break-words text-[#d6d0c4]">{event.body}</span>
                  <span className={s.fine}>{event.delivered ? "In inbox" : `Suppressed · ${event.suppressedReason ?? "no reason recorded"}`}</span>
                </span>
              </span>
              <time dateTime={event.createdAt} title={new Date(event.createdAt).toLocaleString()} className={cx(s.muted, "text-[13px] whitespace-nowrap")}>{when(event.createdAt)}</time>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Rules({ state, error, run, pending }: { state: StateSnapshot | null; error?: string; run: Run; pending: string | null }) {
  return (
    <section aria-label="Rules" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className={cx(s.muted, "max-w-md text-sm")}>Rules without a wallet filter apply to every watched wallet. To alert on one wallet, open it under Wallets.</p>
        <div className="flex flex-wrap gap-2">
          {(["BUY", "SELL"] as const).map((side) => (
            <Button key={side} small disabled={!!pending} busy={pending === `rule:new:${side}`} busyText="Adding…"
              onClick={() => void run(`rule:new:${side}`, () => changeState("alert_create", { name: `Wallet ${side.toLowerCase()}`, trigger: `TRACKED_WALLET_${side}` }), "Rule added")}>
              Add {side} rule
            </Button>
          ))}
        </div>
      </div>
      {error && <Notice tone="error">Could not load rules: {error}</Notice>}
      {!state && !error && <Skeleton className="h-32" />}
      {state && !state.alertRules.length && <EmptyState title="No alert rules yet.">Rules apply to future supported, finalized activity only. Add a BUY or SELL rule to start.</EmptyState>}
      {state?.alertRules.map((rule) => <RuleCard key={`${rule.id}:${JSON.stringify(rule)}`} rule={rule} run={run} pending={pending} />)}
    </section>
  );
}

export function AlertsView({ state, error, team, run, pending, onSetup, initialTab = "inbox" }: { state: StateSnapshot | null; error?: string; team: TeamStatus; run: Run; pending: string | null; onSetup: () => void; initialTab?: Tab }) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const refs = useRef<Partial<Record<Tab, HTMLButtonElement | null>>>({});
  const tabs: { id: Tab; label: string }[] = [{ id: "inbox", label: "Inbox" }, { id: "rules", label: `Rules${state ? ` · ${state.alertRules.length}` : ""}` }];
  function onKey(event: KeyboardEvent, index: number) {
    const to = event.key === "ArrowRight" || event.key === "ArrowLeft" ? (index + 1) % 2 : event.key === "Home" ? 0 : event.key === "End" ? 1 : null;
    if (to === null) return;
    event.preventDefault();
    setTab(tabs[to]!.id);
    refs.current[tabs[to]!.id]?.focus();
  }
  return (
    <div className="flex flex-col gap-10 lg:grid lg:grid-cols-[minmax(0,1fr)_400px] lg:gap-16">
      <div className="flex min-w-0 flex-col gap-7">
        <div className="flex flex-col gap-2">
          <span className={s.eyebrow}>Shared inbox</span>
          <h1 className="text-5xl leading-[1.05] font-medium tracking-[-0.035em]">Alerts</h1>
        </div>
        <div role="tablist" aria-label="Alert views" className="flex gap-1">
          {tabs.map((t, i) => (
            <button key={t.id} ref={(el) => { refs.current[t.id] = el; }} type="button" role="tab" id={`alerts-tab-${t.id}`} aria-selected={tab === t.id} aria-controls={`alerts-panel-${t.id}`} tabIndex={tab === t.id ? 0 : -1}
              onClick={() => setTab(t.id)} onKeyDown={(e) => onKey(e, i)} className={cx(s.seg, tab === t.id && s.segOn)}>{t.label}</button>
          ))}
        </div>
        <div role="tabpanel" id={`alerts-panel-${tab}`} aria-labelledby={`alerts-tab-${tab}`}>
          {tab === "inbox" ? <Inbox state={state} error={error} /> : <Rules state={state} error={error} run={run} pending={pending} />}
        </div>
        <p className={s.fine}>Alerts are sent only for finalized transactions in supported parser shapes. Both members see the same inbox.</p>
      </div>
      <TelegramPanel team={team} state={state} run={run} pending={pending} onSetup={onSetup} />
    </div>
  );
}
