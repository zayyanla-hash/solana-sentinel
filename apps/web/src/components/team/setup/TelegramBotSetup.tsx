"use client";
import { useState, type FormEvent } from "react";
import { teamAction } from "../api";
import { presentTelegram } from "../status";
import type { Notice as NoticeT, Run, TeamStatus } from "../types";
import { Button, Notice, Panel, PanelHeader, StatusPill, TextInput } from "../ui";

export function TelegramBotSetup({ team, run, pending, notice, onDismiss }: { team: TeamStatus; run: Run; pending: string | null; notice: NoticeT | null; onDismiss: () => void }) {
  const [token, setToken] = useState("");
  const busy = pending === "setup:telegram";
  async function submit(event: FormEvent) {
    event.preventDefault();
    const ok = await run("setup:telegram", () => teamAction("telegram", { token }), "Bot token saved; verify your destination below", "telegram");
    if (ok) setToken("");
  }
  return (
    <Panel id="setup-telegram" tabIndex={-1}>
      <PanelHeader title="Shared Telegram bot" action={<StatusPill presented={presentTelegram(team.telegramConfigured)} />}
        hint={team.telegramConfigured ? "A token is saved. Enter a new one to replace it." : "No token is saved."} />
      <ol className="mb-4 list-decimal space-y-1 pl-5 text-sm text-[var(--muted)]">
        <li>Open Telegram and message BotFather to create a bot.</li>
        <li>Copy the token BotFather gives you and paste it below.</li>
        <li>Each member then starts the bot and verifies their own destination.</li>
      </ol>
      <form onSubmit={submit} className="space-y-3">
        <TextInput label="Bot token" type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} hint="Stored encrypted. Never displayed after saving." required />
        <Button type="submit" variant="primary" busy={busy} busyText="Checking bot…" disabled={!!pending && !busy}>Save bot token</Button>
      </form>
      {notice && <Notice tone={notice.tone} onDismiss={onDismiss} className="mt-3">{notice.text}</Notice>}
    </Panel>
  );
}
