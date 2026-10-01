"use client";
import { useEffect, useRef, useState } from "react";
import { Icon, Mark, type IconName } from "./icons";
import type { View } from "./types";
import s from "./team.module.css";
import { cx } from "./ui";

export const NAV: { view: View; label: string; icon: IconName }[] = [
  { view: "home", label: "Home", icon: "home" },
  { view: "wallets", label: "Wallets", icon: "wallet" },
  { view: "alerts", label: "Alerts", icon: "bell" },
  { view: "setup", label: "Setup", icon: "gear" },
];

export function Brand({ onClick, size = 32 }: { onClick?: () => void; size?: number }) {
  const inner = (
    <>
      <Mark size={size} />
      <span className={cx(s.serif, "text-2xl font-semibold tracking-[-0.01em]")}>Sentinel</span>
    </>
  );
  return onClick
    ? <button type="button" onClick={onClick} aria-label="Sentinel, go to Home" className="flex items-center gap-2.5 border-0 bg-transparent p-0 text-[var(--t-ink)]">{inner}</button>
    : <span className="flex items-center gap-2.5">{inner}</span>;
}

function AccountMenu({ username, busy, onSignOut }: { username: string; busy: boolean; onSignOut: () => void }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => { if (!wrap.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);
  return (
    <div ref={wrap} className="relative" onKeyDown={(event) => { if (event.key === "Escape" && open) { setOpen(false); button.current?.focus(); } }}>
      <button ref={button} type="button" aria-haspopup="menu" aria-expanded={open} aria-label={`Account menu for ${username}`} onClick={() => setOpen((v) => !v)}
        className={cx(s.btn2, "!min-h-11 !gap-2.5 !px-1.5 md:!min-h-10")}>
        <span aria-hidden="true" className="inline-flex size-8 items-center justify-center rounded-full bg-[var(--t-neutral)] text-[13px] uppercase md:size-7">{username.slice(0, 1)}</span>
        <span className="hidden pr-2.5 md:inline">{username}</span>
      </button>
      {open && (
        <div role="menu" aria-label="Account" className={s.menu}>
          <p className={cx(s.muted, "px-3 py-2 text-[13px]")}>Signed in as <span className="font-semibold text-[var(--t-ink)]">{username}</span></p>
          <button type="button" role="menuitem" className={s.menuItem} disabled={busy} autoFocus onClick={() => { setOpen(false); onSignOut(); }}>{busy ? "Signing out…" : "Sign out"}</button>
        </div>
      )}
    </div>
  );
}

export function TopBar({ view, onView, username, query, onQuery, showSearch, signingOut, onSignOut, todo }: {
  view: View; onView: (view: View) => void; username: string; query: string; onQuery: (value: string) => void; showSearch: boolean;
  signingOut: boolean; onSignOut: () => void; todo: number;
}) {
  return (
    <header className="sticky top-0 z-40 border-b border-[var(--t-hair)] bg-[var(--t-ground)]">
      <div className="mx-auto flex max-w-[1280px] items-center justify-between gap-6 px-5 py-3 md:justify-start md:gap-10 md:px-8 md:py-0">
        <Brand onClick={() => onView("home")} />
        <nav aria-label="Workspace" className="hidden gap-7 md:flex">
          {NAV.map((item) => (
            <button key={item.view} type="button" onClick={() => onView(item.view)} aria-current={view === item.view ? "page" : undefined} className={cx(s.navlink, view === item.view && s.navOn)}>
              {item.label}
              {item.view === "setup" && todo > 0 && <span className={s.sr}> ({todo} to do)</span>}
            </button>
          ))}
        </nav>
        <div className="hidden grow md:block" />
        {showSearch && (
          <label className="relative hidden w-[260px] md:block">
            <span className={s.sr}>Search watched wallets</span>
            <span className="pointer-events-none absolute top-[11px] left-3.5 text-[var(--t-muted)]"><Icon name="search" /></span>
            <input type="search" value={query} onChange={(event) => onQuery(event.target.value)} placeholder="Search wallets" autoComplete="off" spellCheck={false} className={cx(s.field, "!h-10 !rounded-full !pl-[42px] !text-sm")} />
          </label>
        )}
        <AccountMenu username={username} busy={signingOut} onSignOut={onSignOut} />
      </div>
    </header>
  );
}

export function BottomTabs({ view, onView, todo }: { view: View; onView: (view: View) => void; todo: number }) {
  return (
    <nav aria-label="Workspace" className={cx(s.tabbar, "md:!hidden")}>
      {NAV.map((item) => (
        <button key={item.view} type="button" onClick={() => onView(item.view)} aria-current={view === item.view ? "page" : undefined} className={cx(s.tab, "relative", view === item.view && s.tabOn)}>
          <Icon name={item.icon} size={22} color={view === item.view ? "#CCFF00" : "#A39C8E"} />
          {item.label}
          {item.view === "setup" && todo > 0 && <><span aria-hidden="true" className={s.tabBadge} /><span className={s.sr}> ({todo} to do)</span></>}
        </button>
      ))}
    </nav>
  );
}
