"use client";
import { useState, type FormEvent } from "react";
import { teamAction } from "../api";
import { presentTelegram } from "../status";
import type { Notice as NoticeT, Run, TeamStatus } from "../types";
import s from "../team.module.css";
import { Button, Notice, StatusPill, TextInput, cx } from "../ui";

export function TelegramBotSetup({ team, run, pending, notice, onDismiss }: { team: TeamStatus; run: Run; pending: string | null; notice: NoticeT | null; onDismiss: () => void }) {
  const [token, setToken] = useState("");
  const busy = pending === "setup:telegram";
  async function submit(event: FormEvent) {
    event.preventDefault();
    const ok = await run("setup:telegram", () => teamAction("telegram", { token }), "Bot token saved; verify your destination next", "telegram");
    if (ok) setToken("");
  }
  return (
    <div id="setup-telegram" tabIndex={-1} className="flex flex-col gap-5 outline-none">
      <div className="flex flex-wrap items-center gap-3">
        <StatusPill presented={presentTelegram(team.telegramConfigured)} />
        <span className={cx(s.muted, "text-sm")}>{team.telegramConfigured ? "A token is saved. Enter a new one to replace it." : "No token is saved."}</span>
      </div>
      <ol className={cx(s.muted, "space-y-1 pl-5 text-sm")} style={{ listStyle: "decimal" }}>
        <li>Open Telegram and message BotFather to create a bot.</li>
        <li>Copy the token BotFather gives you and paste it below.</li>
        <li>Each member then starts the bot and verifies their own destination.</li>
      </ol>
      <form onSubmit={submit} className="flex flex-col gap-5">
        <TextInput label="Bot token" type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} hint="Stored encrypted. Never displayed after saving." required />
        <Button type="submit" variant="primary" className="self-start" busy={busy} busyText="Checking bot…" disabled={!!pending && !busy}>Save bot token</Button>
      </form>
      {notice && <Notice tone={notice.tone} onDismiss={onDismiss}>{notice.text}</Notice>}
    </div>
  );
}
