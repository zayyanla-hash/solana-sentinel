"use client";
import { useState, type FormEvent } from "react";
import { changeState } from "./api";
import { addressProblem, isBase58Address } from "./format";
import type { Run } from "./types";
import s from "./team.module.css";
import { Button, TextInput, cx } from "./ui";

/** Add a public wallet to the shared watchlist. The submit button is the one neon action while the form is open. */
export function AddWalletForm({ run, pending, hero, onDone, autoFocus }: { run: Run; pending: string | null; hero?: boolean; onDone?: () => void; autoFocus?: boolean }) {
  const [wallet, setWallet] = useState("");
  const [touched, setTouched] = useState(false);
  const trimmed = wallet.trim();
  const problem = touched ? addressProblem(trimmed) : null;
  const busy = pending === "wallet:add";

  async function submit(event: FormEvent) {
    event.preventDefault();
    setTouched(true);
    if (!isBase58Address(trimmed)) return;
    const ok = await run("wallet:add", async () => {
      await changeState("watchlist_add", { kind: "WALLET", address: trimmed });
    }, "Wallet added; monitoring picks it up automatically");
    if (ok) { setWallet(""); setTouched(false); onDone?.(); }
  }

  return (
    <form onSubmit={submit} noValidate className={cx("flex flex-col gap-3", hero && "gap-4")}>
      <TextInput
        label="Public wallet address" srLabel value={wallet} onChange={(event) => setWallet(event.target.value)} onBlur={() => setTouched(true)}
        placeholder="Paste a public address" autoComplete="off" spellCheck={false} autoFocus={autoFocus}
        className={cx(s.mono, !hero && s.fieldSm)} hint="Public address only. Never paste a private key or seed phrase." error={problem}
      />
      <Button type="submit" variant="primary" className={hero ? "w-full" : "self-start"} busy={busy} busyText="Adding…" disabled={!!pending && !busy}>Watch wallet</Button>
    </form>
  );
}
