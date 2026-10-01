"use client";
import { useState, type FormEvent } from "react";
import { teamAction } from "../api";
import type { Notice as NoticeT, Run, TeamStatus } from "../types";
import { Button, ConfirmInline, CopyButton, Notice, Panel, PanelHeader, StatusPill, TextInput } from "../ui";

export function TeamAccess({ team, issued, run, pending, notice, onGenerate, onHide, onDismiss }: {
  team: TeamStatus; issued: string | null; run: Run; pending: string | null; notice: NoticeT | null;
  onGenerate: (username: string) => Promise<boolean>; onHide: () => void; onDismiss: () => void;
}) {
  const [name, setName] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (await onGenerate(name)) setName("");
  }
  return (
    <Panel id="setup-team" tabIndex={-1}>
      <PanelHeader title="Team access" hint="Two equal members; the workspace is limited to two. Each signs in with a personal credential." />
      <ul className="mb-4 divide-y divide-[var(--line)] border-y border-[var(--line)]">
        {team.members.map((m) => (
          <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <span className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-medium">{m.username}</span>
              {m.id === team.member.id && <StatusPill tone="neutral" label="You" />}
              <StatusPill tone={m.enabled ? "ok" : "bad"} label={m.enabled ? "Enabled" : "Revoked"} />
            </span>
            {m.id !== team.member.id && m.enabled && (
              <ConfirmInline trigger="Revoke" confirmLabel="Revoke access" busy={pending === `team:${m.id}:revoke`}
                message="They will be signed out immediately and their Telegram delivery paused."
                onConfirm={() => run(`team:${m.id}:revoke`, () => teamAction("revoke", { id: m.id }), "Access revoked", "team")} />
            )}
          </li>
        ))}
      </ul>
      <form onSubmit={submit} className="space-y-3">
        <TextInput label="New or existing username" value={name} onChange={(e) => setName(e.target.value)} pattern="[a-z0-9][a-z0-9_\-]{1,39}" autoComplete="off"
          hint="Lowercase letters, digits, _ or -, 2–40 characters. Generating a credential for an existing username rotates it and signs that member out." required />
        <Button type="submit" variant="primary" busy={pending === "team:member"} busyText="Generating…" disabled={!!pending && pending !== "team:member"}>Generate personal credential</Button>
      </form>
      {issued && (
        <div className="mt-4 rounded-md border border-[var(--warn)]/60 bg-[var(--warn)]/10 p-3" role="group" aria-label="One-time credential">
          <p className="text-sm font-medium text-[#f5dc99]">Copy this now and share it privately.</p>
          <div className="mt-2 flex flex-wrap items-center gap-2 rounded bg-[var(--bg-0)] p-2">
            <code data-secret className="mono min-w-0 flex-1 break-all text-sm">{issued}</code>
            <CopyButton value={issued} label="Copy credential" />
          </div>
          <p className="mt-2 text-xs text-[var(--muted)]">Shown once. It disappears when you hide it, sign out or your session expires.</p>
          <Button className="mt-2" onClick={onHide}>Hide credential</Button>
        </div>
      )}
      {notice && <Notice tone={notice.tone} onDismiss={onDismiss} className="mt-3">{notice.text}</Notice>}
    </Panel>
  );
}
