"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertsView } from "./AlertsView";
import { Banners } from "./BannersGroup";
import { HomeView } from "./HomeView";
import { SetupView } from "./SetupView";
import { BottomTabs, Brand, TopBar } from "./Shell";
import { SignIn } from "./SignIn";
import { WalletView } from "./WalletView";
import { WalletsList } from "./WalletsList";
import { geist, geistMono } from "./fonts";
import { stepper } from "./derive";
import s from "./team.module.css";
import type { NavTarget, View } from "./types";
import { useActivityFeed } from "./useActivityFeed";
import { useTeamWorkspace } from "./useTeamWorkspace";
import { Button, Skeleton, cx, useStale } from "./ui";

export function TeamWorkspace() {
  const ws = useTeamWorkspace();
  const { phase, team, state, monitor, errors, pending, notice } = ws;
  const [view, setView] = useState<View>("home");
  const [selected, setSelected] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [setupStep, setSetupStep] = useState<{ step?: NavTarget["step"]; n: number }>({ n: 0 });
  const [alertsTab, setAlertsTab] = useState<{ tab: "inbox" | "rules"; n: number }>({ tab: "inbox", n: 0 });
  const mainRef = useRef<HTMLElement>(null);
  const firstView = useRef(true);
  const stale = useStale(ws.lastSuccessAt, ws.refreshError);

  const addresses = useMemo(() => state?.watchlist.filter((w) => w.kind === "WALLET").map((w) => w.address) ?? [], [state]);
  const ready = phase === "ready" && team !== null;
  const feed = useActivityFeed({ addresses, enabled: ready, active: ready && (view === "home" || view === "wallets"), tick: ws.lastSuccessAt, load: ws.loadActivity });

  useEffect(() => {
    if (phase !== "ready") { setSelected(null); setView("home"); setQuery(""); }
  }, [phase]);

  // Clear the selection if its wallet disappears (for example removed by the other member).
  useEffect(() => {
    if (selected && state && !state.watchlist.some((w) => w.address === selected)) setSelected(null);
  }, [selected, state]);

  useEffect(() => {
    if (firstView.current) { firstView.current = false; return; }
    window.scrollTo({ top: 0 });
    mainRef.current?.focus({ preventScroll: true });
  }, [view, selected]);

  const go = useCallback((next: View, target?: NavTarget) => {
    setView(next);
    setSelected(next === "wallets" ? target?.wallet ?? null : null);
    if (next === "setup") setSetupStep((current) => ({ step: target?.step, n: current.n + 1 }));
    if (next === "alerts") setAlertsTab((current) => ({ tab: target?.alertsTab ?? "inbox", n: current.n + 1 }));
  }, []);

  const todo = team ? stepper(team).filter((step) => step.state !== "done").length : 0;
  const scoped = (scope: string) => (notice?.scope === scope ? notice : null);
  const showSearch = view === "home" || (view === "wallets" && !selected);
  const hasWallets = addresses.length > 0;

  return (
    <div className={cx(geist.variable, geistMono.variable, s.root)}>
      <a href="#main" className={s.skip}>Skip to content</a>

      {phase === "signedOut" && <SignIn reason={ws.signOutReason} pending={pending === "signin"} onSignIn={ws.signIn} />}

      {phase === "loading" && (
        <div aria-busy="true">
          <div className="mx-auto max-w-[1280px] px-5 py-6 sm:px-8"><Brand /></div>
          <main id="main" className="mx-auto flex max-w-[1280px] flex-col gap-5 px-5 pb-16 sm:px-8">
            <Skeleton className="h-9 w-[70%]" /><Skeleton className="h-4 w-[45%]" /><Skeleton className="h-[150px] w-full" />
            <div className="flex gap-1.5"><Skeleton className="h-8 w-14 !rounded-full" /><Skeleton className="h-8 w-16 !rounded-full" /><Skeleton className="h-8 w-16 !rounded-full" /></div>
            {[0, 1, 2, 3].map((n) => <div key={n} className="flex items-center justify-between border-b border-[var(--t-hair)] py-2.5"><div className="flex flex-col gap-1.5"><Skeleton className="h-3.5 w-[120px]" /><Skeleton className="h-3 w-20" /></div><Skeleton className="h-7 w-[84px] !rounded-full" /></div>)}
            <p role="status" className={cx(s.muted, "text-[13px]")}>Connecting to your workspace…</p>
          </main>
        </div>
      )}

      {phase === "unavailable" && (
        <div>
          <div className="mx-auto max-w-[1280px] px-5 py-6 sm:px-8"><Brand /></div>
          <main id="main" className="mx-auto flex max-w-lg flex-col gap-4 px-5 pt-10 sm:px-8">
            <h1 className="text-3xl font-medium tracking-[-0.03em]">The workspace is unreachable</h1>
            <p className={cx(s.muted, "text-[15px]")}>{ws.refreshError ?? "The server did not respond."} The host may be asleep, restarting or offline.</p>
            <Button className="self-start" variant="primary" busy={ws.refreshing} busyText="Retrying…" onClick={() => void ws.refresh()}>Retry</Button>
          </main>
        </div>
      )}

      {ready && team && (
        <>
          <TopBar view={view} onView={(next) => go(next)} username={team.member.username} query={query} onQuery={setQuery} showSearch={showSearch && hasWallets}
            signingOut={pending === "signout"} onSignOut={() => void ws.signOut()} todo={todo} />
          <main id="main" ref={mainRef} tabIndex={-1} className="mx-auto max-w-[1280px] px-5 pt-8 pb-28 outline-none md:px-8 md:pt-12 md:pb-24">
            <Banners ws={ws} />
            {showSearch && hasWallets && (
              <label className="relative mb-6 block md:hidden">
                <span className={s.sr}>Search watched wallets</span>
                <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search wallets" autoComplete="off" spellCheck={false} className={cx(s.field, "!h-11 !rounded-full !text-sm")} />
              </label>
            )}

            {view === "home" && (
              <HomeView team={team} state={state} monitor={monitor} errors={errors} feed={feed.entries} observations={feed.observations} newest={feed.newest} reload={feed.reload}
                addresses={addresses} query={query} stale={stale} updatedAt={ws.lastSuccessAt} refreshing={ws.refreshing} onRefresh={() => void ws.refresh()}
                onNavigate={go} run={ws.run} pending={pending} />
            )}
            {view === "wallets" && !selected && (
              <WalletsList state={state} monitor={monitor} error={errors.state} feed={feed.entries} query={query} onOpen={(address) => go("wallets", { wallet: address })} run={ws.run} pending={pending} />
            )}
            {view === "wallets" && selected && (
              <WalletView address={selected} team={team} state={state} monitor={monitor} entry={feed.entries[selected]} reload={feed.reload} dim={stale} run={ws.run} pending={pending}
                notice={scoped("wallet-alert")} onDismiss={ws.dismissNotice} onBack={() => go("wallets")} onEditRules={() => go("alerts", { alertsTab: "rules" })} />
            )}
            {view === "alerts" && (
              <AlertsView key={alertsTab.n} initialTab={alertsTab.tab} state={state} error={errors.state} team={team} run={ws.run} pending={pending} onSetup={() => go("setup", { step: "destination" })} />
            )}
            {view === "setup" && (
              <SetupView key={setupStep.n} initialStep={setupStep.step} team={team} run={ws.run} pending={pending} issued={ws.issued} scoped={scoped}
                onGenerate={ws.generateCredential} onHide={ws.hideIssued} onDismiss={ws.dismissNotice} />
            )}
          </main>
          <BottomTabs view={view} onView={(next) => go(next)} todo={todo} />
        </>
      )}
    </div>
  );
}
