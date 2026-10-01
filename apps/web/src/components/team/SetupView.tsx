"use client";
import { useState } from "react";
import { stepper } from "./derive";
import { Icon } from "./icons";
import { AuditLog } from "./setup/AuditLog";
import { ConnectionSetup } from "./setup/ConnectionSetup";
import { DestinationSetup } from "./setup/DestinationSetup";
import { TeamAccess } from "./setup/TeamAccess";
import { TelegramBotSetup } from "./setup/TelegramBotSetup";
import type { Notice, Run, StepKey, TeamStatus } from "./types";
import s from "./team.module.css";
import { cx } from "./ui";

const COPY: Record<StepKey, { headline: string; intro: string }> = {
  rpc: { headline: "Connect Sentinel to Solana.", intro: "Sentinel reads finalized transactions through a dedicated RPC endpoint that you provide. It never signs, broadcasts or trades." },
  telegram: { headline: "Add the shared Telegram bot.", intro: "One bot sends alerts to both members. Each member then verifies their own chat." },
  destination: { headline: "Get alerts in your own Telegram.", intro: "Start the shared bot in Telegram, then enter your numeric chat ID. We’ll send a code to prove the chat is yours." },
  team: { headline: "Two people, one workspace.", intro: "Each member signs in with a personal credential. Rotate or revoke access below; a credential is shown exactly once." },
};

function StepDot({ state }: { state: "done" | "now" | "todo" }) {
  if (state === "done") return <span className={s.stepDot} style={{ background: "#00C805" }}><Icon name="check" size={18} color="#04140A" strokeWidth={2.4} /></span>;
  if (state === "now") return <span className={s.stepDot} style={{ border: "2px solid #CCFF00" }}><span style={{ width: 10, height: 10, borderRadius: 999, background: "#CCFF00" }} /></span>;
  return <span className={s.stepDot} style={{ border: "2px solid #3A342A" }} />;
}

export type SetupViewProps = {
  team: TeamStatus; run: Run; pending: string | null; issued: string | null; scoped: (scope: string) => Notice | null;
  onGenerate: (username: string) => Promise<boolean>; onHide: () => void; onDismiss: () => void; initialStep?: StepKey;
};

export function SetupView({ team, run, pending, issued, scoped, onGenerate, onHide, onDismiss, initialStep }: SetupViewProps) {
  const steps = stepper(team);
  const done = steps.filter((step) => step.state === "done").length;
  const [chosen, setChosen] = useState<StepKey | null>(initialStep ?? null);
  const current = chosen ?? steps.find((step) => step.state === "now")?.key ?? "team";
  const index = steps.findIndex((step) => step.key === current);
  const copy = COPY[current];

  return (
    <div className="flex flex-col gap-8 lg:grid lg:grid-cols-[340px_minmax(0,1fr)] lg:gap-[72px]">
      <nav aria-label="Setup steps" className="flex flex-col gap-1">
        <span className={cx(s.eyebrow, "px-4 pb-3")}>Setup · {done} of {steps.length}</span>
        {steps.map((step) => (
          <button key={step.key} type="button" onClick={() => setChosen(step.key)} aria-current={step.key === current ? "step" : undefined} className={cx(s.stepLink, step.key === current && s.stepNow)}>
            <StepDot state={step.state} />
            <span className="flex flex-col">
              <span className="font-semibold">{step.title}</span>
              <span className={cx(s.muted, "text-[13px]")}>{step.sub}</span>
              <span className={s.sr}>{step.state === "done" ? "Done" : step.state === "now" ? "Next step" : "To do"}</span>
            </span>
          </button>
        ))}
      </nav>
      <div className="flex max-w-[640px] min-w-0 flex-col gap-12">
        <section aria-labelledby="step-title" className="flex flex-col gap-6">
          <div className="flex flex-col gap-3">
            <span className={s.eyebrow}>Step {index + 1}</span>
            <h1 id="step-title" className={cx(s.serif, "text-4xl leading-[1.08] font-medium tracking-[-0.01em] sm:text-[44px]")}>{copy.headline}</h1>
            <p className={cx(s.muted, "text-base")}>{copy.intro}</p>
          </div>
          {current === "rpc" && <ConnectionSetup team={team} run={run} pending={pending} notice={scoped("rpc")} onDismiss={onDismiss} />}
          {current === "telegram" && <TelegramBotSetup team={team} run={run} pending={pending} notice={scoped("telegram")} onDismiss={onDismiss} />}
          {current === "destination" && <DestinationSetup team={team} run={run} pending={pending} notice={scoped("destination")} onDismiss={onDismiss} />}
        </section>
        <TeamAccess team={team} issued={issued} run={run} pending={pending} notice={scoped("team")} onGenerate={onGenerate} onHide={onHide} onDismiss={onDismiss} />
        <AuditLog team={team} />
      </div>
    </div>
  );
}
