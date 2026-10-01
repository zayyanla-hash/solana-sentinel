"use client";
import { useState, type FormEvent } from "react";
import { teamAction } from "../api";
import type { Notice as NoticeT, Run, TeamStatus } from "../types";
import s from "../team.module.css";
import { Button, ConfirmInline, CopyButton, Notice, StatusPill, TextInput, cx } from "../ui";
import { Icon } from "../icons";

export function TeamAccess({ team, issued, run, pending, notice, onGenerate, onHide, onDismiss }: {
  team: TeamStatus; issued: string | null; run: Run; pending: string | null; notice: NoticeT | null;
  onGenerate: (username: string) => Promise<boolean>; onHide: () => void; onDismiss: () => void;
}) {
  const [name, setName] = useState("");
  const [issuedFor, setIssuedFor] = useState("");
  async function generate(username: string) {
    if (await onGenerate(username)) { setIssuedFor(username); return true; }
    return false;
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (await generate(name)) setName("");
  }
  return (
    <section id="setup-team" tabIndex={-1} aria-labelledby="team-title" className="flex flex-col outline-none">
      <div className="flex items-baseline justify-between border-b border-[var(--t-hair)] pb-2">
        <h2 id="team-title" className={s.h2}>Team access</h2>
        <span className={cx(s.muted, "text-[13px]")}>Two equal members</span>
      </div>
      <ul>
        {team.members.map((m) => {
          const self = m.id === team.member.id;
          return (
            <li key={m.id} className={cx(s.row, "flex-wrap")}>
              <span className="flex items-center gap-3">
                <span aria-hidden="true" className="inline-flex size-9 items-center justify-center rounded-full bg-[var(--t-neutral)] font-semibold uppercase">{m.username.slice(0, 1)}</span>
                <span className="flex flex-col">
                  <span className="font-semibold">{m.username}{self && <span className={cx(s.muted, "font-normal")}> · you</span>}</span>
                  {m.enabled
                    ? <span className={cx(s.muted, "text-[13px]")}>Enabled{self ? " · signed in here" : ""}</span>
                    : <StatusPill tone="bad" label="Revoked" className="mt-0.5 self-start" />}
                </span>
              </span>
              <span className="flex flex-wrap items-start gap-2">
                {!self && (
                  <ConfirmInline tone="warn" trigger={m.enabled ? "Rotate credential" : "Restore access"} confirmLabel={m.enabled ? "Rotate" : "Restore"} busy={pending === "team:member"}
                    message={m.enabled ? `${m.username} will be signed out immediately and you will get a new one-time credential to share.` : `${m.username} gets a new one-time credential and can sign in again.`}
                    onConfirm={() => generate(m.username)} />
                )}
                {!self && m.enabled && (
                  <ConfirmInline trigger="Revoke" confirmLabel="Revoke access" busy={pending === `team:${m.id}:revoke`}
                    message="They will be signed out immediately and their Telegram delivery paused."
                    onConfirm={() => run(`team:${m.id}:revoke`, () => teamAction("revoke", { id: m.id }), "Access revoked", "team")} />
                )}
              </span>
            </li>
          );
        })}
      </ul>
      {issued && (
        <div className={cx(s.secretBox, "mt-5 flex flex-col gap-3")} role="group" aria-label="One-time credential">
          <span className="inline-flex items-center gap-2 font-semibold"><Icon name="lock" color="#CCFF00" />New credential{issuedFor ? ` for ${issuedFor}` : ""}</span>
          <div className="flex flex-wrap items-center gap-2">
            <code data-secret className={cx(s.mono, "min-w-0 flex-1 rounded-[10px] bg-[var(--t-ground)] px-3.5 py-3 text-sm break-all")}>{issued}</code>
            <CopyButton value={issued} label="Copy credential" small={false}>Copy</CopyButton>
          </div>
          <p className={cx(s.hint, "!mt-0")}>Shown once. It disappears when you hide it, sign out or your session ends. Share it privately.</p>
          <Button small className="self-start" onClick={onHide}>Hide credential</Button>
        </div>
      )}
      <form onSubmit={submit} className="mt-6 flex flex-col gap-4 border-t border-[var(--t-hair)] pt-5">
        <TextInput label="New or existing username" value={name} onChange={(e) => setName(e.target.value)} pattern="[a-z0-9][a-z0-9_\-]{1,39}" autoComplete="off"
          hint="Lowercase letters, digits, _ or -, 2–40 characters. The workspace is limited to two members. Generating a credential for an existing username rotates it and signs that member out. To change your own credential, ask the other member to rotate it." required />
        <Button type="submit" className="self-start" busy={pending === "team:member"} busyText="Generating…" disabled={!!pending && pending !== "team:member"}>Generate personal credential</Button>
      </form>
      {notice && <Notice tone={notice.tone} onDismiss={onDismiss} className="mt-3">{notice.text}</Notice>}
    </section>
  );
}
