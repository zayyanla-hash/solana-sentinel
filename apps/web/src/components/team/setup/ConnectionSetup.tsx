"use client";
import { useState, type FormEvent } from "react";
import { teamAction } from "../api";
import { isBase58Address } from "../format";
import { presentRpc } from "../status";
import type { Notice as NoticeT, RpcResult, Run, TeamStatus } from "../types";
import { Button, Notice, Panel, PanelHeader, StatusPill, TextInput } from "../ui";

export function ConnectionSetup({ team, run, pending, notice, onDismiss }: { team: TeamStatus; run: Run; pending: string | null; notice: NoticeT | null; onDismiss: () => void }) {
  const [endpoint, setEndpoint] = useState("");
  const [probe, setProbe] = useState("");
  const [touched, setTouched] = useState(false);
  const [result, setResult] = useState<RpcResult | null>(null);
  const trimmedProbe = probe.trim();
  const walletError = touched && !isBase58Address(trimmedProbe) ? "Enter a valid public wallet address (32–44 base58 characters)." : null;
  const endpointError = touched && endpoint && !endpoint.startsWith("https://") ? "The endpoint must start with https://" : null;
  const busy = pending === "setup:rpc";

  async function submit(event: FormEvent) {
    event.preventDefault();
    setTouched(true);
    if (!isBase58Address(trimmedProbe) || !endpoint.startsWith("https://")) return;
    setResult(null);
    const ok = await run("setup:rpc", async () => {
      const outcome = await teamAction<RpcResult>("rpc", { endpoint, wallet: trimmedProbe });
      setResult(outcome);
    }, "Mainnet connection verified and saved", "rpc");
    if (ok) { setEndpoint(""); setProbe(""); setTouched(false); } // never keep the endpoint in the page
  }

  return (
    <Panel id="setup-rpc" tabIndex={-1}>
      <PanelHeader title="Solana connection" action={<StatusPill presented={presentRpc(team.rpcConfigured)} />}
        hint={team.rpcConfigured ? "Configured. Enter a new endpoint to replace it. Secrets are stored encrypted and never displayed again." : "A dedicated RPC endpoint is required. Secrets are stored encrypted and never displayed again."} />
      <ul className="mb-4 list-disc space-y-1 pl-5 text-xs text-[var(--muted)]">
        <li>Dedicated HTTPS endpoint, Helius-compatible.</li>
        <li>Not the public mainnet-beta endpoint.</li>
        <li>No credentials in user:pass form; keep the API key in the path or query as your provider supplies it.</li>
      </ul>
      <form onSubmit={submit} noValidate className="space-y-3">
        <TextInput label="HTTPS RPC endpoint" type="password" autoComplete="off" value={endpoint} onChange={(e) => setEndpoint(e.target.value)} error={endpointError} hint="Hidden while you type and never shown again after saving." required />
        <TextInput label="Active wallet for connection test" value={probe} onChange={(e) => setProbe(e.target.value)} className="mono" spellCheck={false} autoComplete="off" error={walletError} hint="An active public wallet with recent transactions, used only to test read methods." required />
        <Button type="submit" variant="primary" busy={busy} busyText="Verifying with mainnet… (up to 30 s)" disabled={!!pending && !busy}>Verify &amp; save connection</Button>
      </form>
      {notice && <Notice tone={notice.tone} onDismiss={onDismiss} className="mt-3">
        {notice.text}
        {notice.tone === "success" && result?.probeDurationMs !== undefined && ` Probe took ${result.probeDurationMs} ms.`}
        {notice.tone === "success" && result?.scope && ` ${result.scope}`}
      </Notice>}
    </Panel>
  );
}
