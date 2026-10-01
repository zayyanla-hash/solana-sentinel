"use client";
import { useState, type FormEvent } from "react";
import type { SignOutReason } from "./types";
import { Button, Notice, Panel, TextInput } from "./ui";

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
    <div className="mx-auto w-full max-w-[400px] pt-6 sm:pt-12">
      <Panel>
        <form onSubmit={submit} className="space-y-4" aria-labelledby="signin-title">
          <div>
            <h2 id="signin-title" className="text-xl font-semibold">Team sign in</h2>
            <p className="mt-1 text-sm text-[var(--muted)]">
              Use the personal access credential supplied by your teammate or saved during host setup.
            </p>
          </div>
          {reason === "expired" && <Notice tone="warn">Your session ended. Sign in again.</Notice>}
          {reason === "signedOut" && <Notice tone="info">You signed out. Your credentials were cleared from this page.</Notice>}
          {error && <Notice tone="error">{error}</Notice>}
          <TextInput label="Username" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required />
          <TextInput label="Access credential" type="password" autoComplete="current-password" value={credential} onChange={(e) => setCredential(e.target.value)} required />
          <Button type="submit" variant="primary" className="w-full" busy={pending} busyText="Signing in…">Sign in</Button>
        </form>
      </Panel>
    </div>
  );
}
