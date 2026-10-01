"use client";
import { useState, type FormEvent } from "react";
import { Mark } from "./icons";
import type { SignOutReason } from "./types";
import s from "./team.module.css";
import { Button, Notice, TagPill, TextInput, cx } from "./ui";

export function SignIn({ reason, pending, onSignIn }: { reason: SignOutReason; pending: boolean; onSignIn: (username: string, credential: string) => Promise<string | null> }) {
  const [username, setUsername] = useState("");
  const [credential, setCredential] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const submitted = credential;
    setCredential(""); // clear on success and failure alike
    setError(await onSignIn(username, submitted));
  }

  return (
    <div className="mx-auto w-full max-w-[1280px]">
      <div className="flex items-center gap-2.5 px-5 py-6 sm:px-8">
        <Mark />
        <span className={cx(s.serif, "text-2xl font-semibold tracking-[-0.01em]")}>Sentinel</span>
      </div>
      <div className="grid items-center gap-10 px-5 pt-6 pb-20 sm:px-8 lg:grid-cols-[minmax(0,1fr)_440px] lg:gap-24 lg:pt-16 lg:pb-24">
        <section className="flex flex-col gap-6 max-lg:order-2">
          <h1 className={cx(s.serif, "text-5xl leading-[1.04] font-medium tracking-[-0.02em] sm:text-6xl lg:text-7xl")}>Watch the wallets<br className="max-sm:hidden" /> that matter.</h1>
          <p className={cx(s.muted, "max-w-[520px] text-lg")}>A private, shared monitor for two. Read-only chain access — Sentinel never signs, broadcasts or trades.</p>
          <div className="flex flex-wrap gap-2"><TagPill>Finalized transactions only</TagPill><TagPill>Telegram alerts</TagPill><TagPill>Runs on your Mac</TagPill></div>
        </section>
        <form onSubmit={submit} aria-labelledby="signin-title" className="flex flex-col gap-5 rounded-[20px] border border-[var(--t-hair)] bg-[var(--t-surface)] p-6 sm:p-8 max-lg:order-1">
          <h2 id="signin-title" className={s.h2}>Sign in</h2>
          {reason === "expired" && <Notice tone="warn">Your session ended. Sign in again.</Notice>}
          {reason === "signedOut" && <Notice tone="info">You signed out. Your credentials were cleared from this page.</Notice>}
          {error && <Notice tone="error">{error}</Notice>}
          <TextInput label="Username" ground autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required />
          <TextInput label="Access credential" ground type="password" autoComplete="current-password" value={credential} onChange={(e) => setCredential(e.target.value)} required />
          <Button type="submit" variant="primary" className="w-full" busy={pending} busyText="Signing in…">Sign in</Button>
          <p className={s.hint} style={{ marginTop: 0 }}>Use the personal credential your teammate shared or you saved during host setup.</p>
        </form>
      </div>
    </div>
  );
}
