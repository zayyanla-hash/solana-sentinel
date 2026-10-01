"use client";
import { AddWalletForm } from "./AddWalletForm";
import { SystemCard } from "./SystemCard";
import { setupSteps } from "./status";
import type { MonitorHealth, Run, TeamStatus, View } from "./types";
import s from "./team.module.css";
import { Dot, cx } from "./ui";

/** Zero wallets: a single clear next step, plus the setup progress that gates useful alerts. */
export function FirstRun({ team, monitor, run, pending, onNavigate, updatedAt, refreshing, onRefresh }: {
  team: TeamStatus; monitor: MonitorHealth | null; run: Run; pending: string | null; onNavigate: (view: View) => void;
  updatedAt: number | null; refreshing: boolean; onRefresh: () => void;
}) {
  const steps = setupSteps({ rpcConfigured: team.rpcConfigured, telegramConfigured: team.telegramConfigured, destination: team.destination, walletCount: 0 });
  const done = steps.filter((step) => step.done).length;
  const rows: Record<string, string> = { rpc: "Solana RPC", telegram: "Telegram bot", destination: "Your destination", wallet: "First wallet" };
  const values: Record<string, [string, string]> = { rpc: ["verified", "not configured"], telegram: ["saved", "not saved"], destination: ["verified", "not verified"], wallet: ["added", "not added"] };
  return (
    <div className="flex flex-col gap-10 lg:grid lg:grid-cols-[minmax(0,1fr)_380px] lg:gap-16">
      <section aria-labelledby="first-run" className="flex max-w-xl flex-col gap-4">
        <span className={s.eyebrow}>Shared monitor · no wallets yet</span>
        <h1 id="first-run" className="text-[34px] leading-[1.05] font-medium tracking-[-0.035em] sm:text-5xl">Watch your first wallet</h1>
        <p className={cx(s.muted, "text-[15px]")}>Paste any public Solana address. Both members will see it, and monitoring picks it up automatically.</p>
        <AddWalletForm run={run} pending={pending} hero />
        <p className={s.hint} style={{ marginTop: -4 }}>No sample wallets are ever added for you.</p>
        <div className="mt-2 flex flex-col gap-1 border-t border-[var(--t-hair)] pt-4">
          <div className="flex items-baseline justify-between"><h2 className="font-semibold">Finish setup</h2><span className={cx(s.muted, "text-[13px]")}>{done} of {steps.length}</span></div>
          <div className={s.progress} role="img" aria-label={`${done} of ${steps.length} setup steps done`}><div className={s.progressBar} style={{ width: `${(done / steps.length) * 100}%` }} /></div>
          <ul>
            {steps.map((step, index) => (
              <li key={step.key} className={cx(s.row, "!gap-3 !py-[11px] text-sm", index === steps.length - 1 && s.rowLast)}>
                <span className="inline-flex items-center gap-2.5"><Dot tone={step.done ? "ok" : "neutral"} />{rows[step.key]}</span>
                <span className={cx(s.soft, "text-[13px]")}>{values[step.key]![step.done ? 0 : 1]}</span>
              </li>
            ))}
          </ul>
          {done < steps.length && <button type="button" onClick={() => onNavigate("setup")} className={cx(s.link, "self-start border-0 bg-transparent p-0 text-sm")}>Open setup</button>}
        </div>
      </section>
      <aside aria-label="System" className="flex flex-col gap-5">
        <SystemCard monitor={monitor} team={team} updatedAt={updatedAt} refreshing={refreshing} onRefresh={onRefresh} />
      </aside>
    </div>
  );
}
