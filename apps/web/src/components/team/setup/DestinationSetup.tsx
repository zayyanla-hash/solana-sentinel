"use client";
import { useState, type FormEvent } from "react";
import { teamAction } from "../api";
import { maskChatId } from "../format";
import { presentDestination } from "../status";
import type { Notice as NoticeT, Run, TeamStatus } from "../types";
import s from "../team.module.css";
import { Button, Notice, StatusPill, TextInput, cx } from "../ui";

export function DestinationSetup({ team, run, pending, notice, onDismiss }: { team: TeamStatus; run: Run; pending: string | null; notice: NoticeT | null; onDismiss: () => void }) {
  const [chatId, setChatId] = useState("");
  const [code, setCode] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const destination = team.destination;
  const verified = Boolean(destination?.verified);
  const noBot = !team.telegramConfigured;
  const other = (key: string) => !!pending && pending !== key;

  async function sendCode(event: FormEvent) {
    event.preventDefault();
    if (await run("setup:destination", () => teamAction("destination", { chatId }), "Verification code sent to Telegram", "destination")) setCodeSent(true);
  }
  async function verify(event: FormEvent) {
    event.preventDefault();
    if (await run("setup:verify", () => teamAction("verify-destination", { code }), "Destination verified", "destination")) { setCode(""); setCodeSent(false); setChatId(""); }
  }

  return (
    <div id="setup-destination" tabIndex={-1} className="flex flex-col gap-6 outline-none">
      <div className="flex flex-wrap items-center gap-3">
        <StatusPill presented={presentDestination(destination)} />
        <span className={cx(s.muted, "text-sm")}>{verified ? <>Verified chat <span className={s.mono}>{maskChatId(destination?.chatId)}</span>.</> : "Each member does this separately."}</span>
      </div>
      {noBot && <Notice tone="warn">Save the shared bot token first, then come back to verify your chat.</Notice>}
      <form onSubmit={sendCode} className="flex flex-col gap-5">
        <h3 className="text-sm font-semibold">1. Send code</h3>
        <TextInput label="Chat ID" value={chatId} onChange={(e) => setChatId(e.target.value)} disabled={noBot} inputMode="numeric" pattern="-?[0-9]{1,20}" autoComplete="off" placeholder="e.g. 123456789"
          hint="Your numeric Telegram chat ID. Start the bot, then message a bot such as @userinfobot or open getUpdates for your bot to find it." required />
        <Button type="submit" variant={codeSent ? "secondary" : "primary"} className="self-start" disabled={noBot || other("setup:destination")} busy={pending === "setup:destination"} busyText="Sending…">Send verification code</Button>
      </form>
      <form onSubmit={verify} className="flex flex-col gap-5 border-t border-[var(--t-hair)] pt-6">
        <h3 className="text-sm font-semibold">2. Enter code</h3>
        <TextInput label="Verification code" value={code} onChange={(e) => setCode(e.target.value)} autoComplete="one-time-code" className="max-w-[260px]" hint={codeSent ? "Check Telegram for the code we just sent." : "Enter the code exactly as Telegram shows it."} required />
        <Button type="submit" variant={codeSent ? "primary" : "secondary"} className="self-start" disabled={noBot || other("setup:verify")} busy={pending === "setup:verify"} busyText="Verifying…">Verify destination</Button>
      </form>
      {verified && (
        <div className="flex flex-col gap-3 border-t border-[var(--t-hair)] pt-6">
          <h3 className="text-sm font-semibold">3. Verified</h3>
          <div className="flex flex-wrap gap-2">
            <Button disabled={other("setup:test")} busy={pending === "setup:test"} busyText="Sending test…" onClick={() => void run("setup:test", () => teamAction("test-destination", {}), "Test message delivered", "destination")}>Send test</Button>
            <Button disabled={other("setup:toggle")} busy={pending === "setup:toggle"} busyText="Saving…"
              onClick={() => void run("setup:toggle", () => teamAction("destination-enabled", { enabled: !destination?.enabled }), destination?.enabled ? "Alerts paused" : "Alerts enabled", "destination")}>
              {destination?.enabled ? "Pause alerts" : "Enable alerts"}
            </Button>
          </div>
        </div>
      )}
      {notice && <Notice tone={notice.tone} onDismiss={onDismiss}>{notice.text}</Notice>}
    </div>
  );
}
