"use client";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { ActivityPanel } from "./ActivityPanel";
import { DeliveriesPanel } from "./DeliveriesPanel";
import { HealthStrip } from "./HealthStrip";
import { InboxPanel } from "./InboxPanel";
import { MonitorStats } from "./MonitorStats";
import { RulesPanel } from "./RulesPanel";
import { SetupChecklist } from "./SetupChecklist";
import { SignIn } from "./SignIn";
import { WatchlistPanel } from "./WatchlistPanel";
import { AuditLog } from "./setup/AuditLog";
import { ConnectionSetup } from "./setup/ConnectionSetup";
import { DestinationSetup } from "./setup/DestinationSetup";
import { TeamAccess } from "./setup/TeamAccess";
import { TelegramBotSetup } from "./setup/TelegramBotSetup";
import { setupSteps, type SetupKey } from "./status";
import type { Tab } from "./types";
import { Button, Notice, Panel, Skeleton } from "./ui";
import { useTeamWorkspace } from "./useTeamWorkspace";

const TABS: { id: Tab; label: string }[] = [
  { id: "monitor", label: "Wallets & activity" },
  { id: "alerts", label: "Alerts" },
  { id: "setup", label: "Setup & team" },
];

export function TeamWorkspace() {
  const ws = useTeamWorkspace();
  const [tab, setTab] = useState<Tab>("monitor");
  const [selected, setSelected] = useState<string | null>(null);
  const tabRefs = useRef<Partial<Record<Tab, HTMLButtonElement | null>>>({});
  const { phase, team, state, monitor, errors, pending, notice } = ws;

  useEffect(() => {
    if (phase !== "ready") { setSelected(null); setTab("monitor"); }
  }, [phase]);

  // Clear the selection if its wallet disappears (for example removed by the other member).
  useEffect(() => {
    if (selected && state && !state.watchlist.some((w) => w.address === selected)) setSelected(null);
  }, [selected, state]);

  const selectWallet = (address: string | null) => {
    setSelected(address);
    if (address && window.matchMedia("(max-width: 1023px)").matches) {
      setTimeout(() => document.getElementById("wallet-activity")?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
    }
  };

  const goSetup = useCallback((key: SetupKey | "team") => {
    setTab("setup");
    const target = key === "wallet" ? null : `setup-${key}`;
    setTimeout(() => {
      const element = target ? document.getElementById(target) : null;
      if (element) { element.scrollIntoView({ block: "start" }); element.focus({ preventScroll: true }); }
      else if (key === "wallet") setTab("monitor");
    }, 0);
  }, []);

  function onTabKey(event: KeyboardEvent, index: number) {
    const keys: Record<string, number> = { ArrowRight: (index + 1) % TABS.length, ArrowLeft: (index + TABS.length - 1) % TABS.length, Home: 0, End: TABS.length - 1 };
    if (!(event.key in keys)) return;
    event.preventDefault();
    const next = TABS[keys[event.key]!]!;
    setTab(next.id);
    tabRefs.current[next.id]?.focus();
  }

  const steps = team ? setupSteps({ rpcConfigured: team.rpcConfigured, telegramConfigured: team.telegramConfigured, destination: team.destination, walletCount: state?.watchlist.filter((w) => w.kind === "WALLET").length ?? 0 }) : [];
  const todo = steps.filter((s) => !s.done).length;
  const scoped = (scope: string) => (notice?.scope === scope ? notice : null);
  const counts: Record<Tab, string> = {
    monitor: "",
    alerts: state ? ` (${state.alertRules.length})` : "",
    setup: team && todo ? ` (${todo} to do)` : "",
  };

  return (
    <main className="min-h-screen pb-16">
      <header className="sticky top-0 z-20 border-b border-[var(--line)] bg-[var(--bg-0)]/90 backdrop-blur">
        <div className="mx-auto flex max-w-[1280px] flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3 sm:px-6">
          <div className="min-w-0">
            <h1 className="brand text-2xl leading-tight font-semibold sm:text-[28px]">Solana Sentinel <span className="text-base font-normal text-[var(--muted)] sm:text-lg">· Shared wallet monitor</span></h1>
            <p className="text-xs text-[var(--muted)]">Read-only chain access · no signing or trading</p>
          </div>
          {team && (
            <div className="flex items-center gap-3">
              <span className="rounded-full border border-[var(--line)] px-3 py-1 text-sm" title="Signed in as">{team.member.username}</span>
              <Button busy={pending === "signout"} busyText="Signing out…" onClick={() => void ws.signOut()}>Sign out</Button>
            </div>
          )}
        </div>
      </header>

      <div className="mx-auto max-w-[1280px] space-y-4 px-4 pt-5 sm:px-6">
        <div aria-live="polite">
          {notice && !notice.scope && <Notice tone={notice.tone} onDismiss={ws.dismissNotice}>{notice.text}</Notice>}
        </div>

        {phase === "loading" && (
          <div aria-busy="true" aria-label="Connecting to your workspace" className="space-y-4">
            <p className="text-sm text-[var(--muted)]">Connecting to your workspace…</p>
            <Skeleton className="h-20" /><Skeleton className="h-10" /><Skeleton className="h-64" />
          </div>
        )}
        {phase === "unavailable" && (
          <Panel className="mx-auto max-w-lg text-center">
            <h2 className="text-lg font-semibold">The workspace is unreachable</h2>
            <p className="mt-2 text-sm text-[var(--muted)]">{ws.refreshError ?? "The server did not respond."} The host may be asleep, restarting or offline.</p>
            <Button className="mt-4" variant="primary" busy={ws.refreshing} busyText="Retrying…" onClick={() => void ws.refresh()}>Retry</Button>
          </Panel>
        )}
        {phase === "signedOut" && <SignIn reason={ws.signOutReason} pending={pending === "signin"} onSignIn={ws.signIn} />}

        {phase === "ready" && team && (
          <>
            <HealthStrip team={team} monitor={monitor} monitorError={errors.monitor} monitorUpdatedAt={ws.monitorUpdatedAt} lastSuccessAt={ws.lastSuccessAt} refreshError={ws.refreshError} refreshing={ws.refreshing} onRefresh={() => void ws.refresh()} />
            <div role="tablist" aria-label="Workspace" className="flex gap-1 overflow-x-auto rounded-lg border border-[var(--line)] bg-[var(--bg-1)]/90 p-1">
              {TABS.map((t, i) => (
                <button key={t.id} ref={(el) => { tabRefs.current[t.id] = el; }} role="tab" id={`tab-${t.id}`} type="button" aria-selected={tab === t.id} aria-controls={`panel-${t.id}`} tabIndex={tab === t.id ? 0 : -1}
                  onClick={() => setTab(t.id)} onKeyDown={(e) => onTabKey(e, i)}
                  className={`min-h-10 shrink-0 rounded-md px-4 text-sm font-semibold whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${tab === t.id ? "bg-[var(--accent)] text-[#0c1117]" : "text-[var(--muted)] hover:bg-[var(--bg-2)] hover:text-[var(--text)]"}`}>
                  {t.label}{counts[t.id]}
                </button>
              ))}
            </div>

            <div role="tabpanel" id="panel-monitor" aria-labelledby="tab-monitor" hidden={tab !== "monitor"} className="space-y-4">
              {tab === "monitor" && (
                <>
                  <SetupChecklist steps={steps} onGo={goSetup} />
                  <div className="grid gap-4 lg:grid-cols-12">
                    <div className="lg:col-span-7"><WatchlistPanel state={state} monitor={monitor} error={errors.state} selected={selected} onSelect={selectWallet} run={ws.run} pending={pending} /></div>
                    <div className="lg:sticky lg:top-24 lg:col-span-5 lg:self-start"><ActivityPanel wallet={selected} load={ws.loadActivity} /></div>
                  </div>
                  <MonitorStats monitor={monitor} error={errors.monitor} />
                </>
              )}
            </div>

            <div role="tabpanel" id="panel-alerts" aria-labelledby="tab-alerts" hidden={tab !== "alerts"}>
              {tab === "alerts" && (
                <div className="grid gap-4 lg:grid-cols-12">
                  <div className="lg:col-span-7"><RulesPanel state={state} error={errors.state} run={ws.run} pending={pending} /></div>
                  <div className="space-y-4 lg:col-span-5">
                    <InboxPanel state={state} error={errors.state} />
                    <DeliveriesPanel team={team} run={ws.run} pending={pending} onSetup={() => goSetup("destination")} />
                  </div>
                </div>
              )}
            </div>

            <div role="tabpanel" id="panel-setup" aria-labelledby="tab-setup" hidden={tab !== "setup"} className="space-y-4">
              {tab === "setup" && (
                <>
                  <p className="text-sm font-medium">Setup {steps.length - todo} of {steps.length} complete</p>
                  <div className="grid gap-4 md:grid-cols-2 md:items-start">
                    <ConnectionSetup team={team} run={ws.run} pending={pending} notice={scoped("rpc")} onDismiss={ws.dismissNotice} />
                    <TelegramBotSetup team={team} run={ws.run} pending={pending} notice={scoped("telegram")} onDismiss={ws.dismissNotice} />
                    <DestinationSetup team={team} run={ws.run} pending={pending} notice={scoped("destination")} onDismiss={ws.dismissNotice} />
                    <TeamAccess team={team} issued={ws.issued} run={ws.run} pending={pending} notice={scoped("team")} onGenerate={ws.generateCredential} onHide={ws.hideIssued} onDismiss={ws.dismissNotice} />
                  </div>
                  <AuditLog team={team} />
                </>
              )}
            </div>
          </>
        )}
      </div>
    </main>
  );
}
