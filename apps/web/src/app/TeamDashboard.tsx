"use client";
import { useCallback, useEffect, useState, type FormEvent } from "react";

type Member = { id: string; username: string; enabled: boolean };
type Rule = { id: string; name: string; trigger: string; enabled: boolean; cooldownMinutes: number; wallet: string | null; mint: string | null };
type Delivery = { id: string; eventId: string; status: string; attempts: number; lastError: string | null };
type Team = { member: Member; members: Member[]; rpcConfigured: boolean; telegramConfigured: boolean;
  destination: { verified: boolean; chatId: string | null; enabled: boolean } | null;
  deliveries: Delivery[]; audit: { id: string; username: string; action: string; outcome: string; created_at: string }[] };
type State = { watchlist: { id: string; address: string; kind: string }[]; alertRules: Rule[];
  alertEvents: { id: string; title: string; body: string; delivered: boolean; suppressedReason: string | null; createdAt: string; isDemo: boolean }[] };
type Monitor = { status: string; scope: string; observedAt: string; stats: { observations: number; trades: number; pendingAlerts: number;
  outcomes: { UNKNOWN: number; FAILED: number }; archivedObservations?: number; observationCapacityPercent?: number } | null;
  wallets: { wallet: string; coverage: string; pollAgeMs: number | null; lastError: string | null }[];
  backup?: { status: string; lastSuccessAt?: string | null }; backupCopy?: { status: string }; worker?: { status: string; ageMs: number | null } };
class HttpError extends Error { constructor(message: string, readonly status: number) { super(message); } }
async function api<T>(path: string, payload?: unknown): Promise<T> {
  const response = await fetch(path, { method: payload === undefined ? "GET" : "POST", cache: "no-store",
    ...(payload === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }) });
  const data = await response.json();
  if (!response.ok) throw new HttpError(data.error || "Request failed", response.status);
  return data as T;
}
const field = "w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100";
const button = "rounded bg-teal-400 px-3 py-2 text-sm font-semibold text-slate-950 disabled:opacity-40";
const secondary = "rounded border border-slate-600 px-3 py-2 text-sm disabled:opacity-40";
const panel = "rounded-xl border border-slate-800 bg-slate-900 p-5";

export default function TeamDashboard() {
  const [team, setTeam] = useState<Team | null>(null), [state, setState] = useState<State | null>(null), [monitor, setMonitor] = useState<Monitor | null>(null);
  const [signedOut, setSignedOut] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(""), [message, setMessage] = useState("");
  const [tab, setTab] = useState<"monitor" | "alerts" | "setup">("monitor");
  const [username, setUsername] = useState(""), [credential, setCredential] = useState("");
  const [wallet, setWallet] = useState(""), [rpc, setRpc] = useState(""), [probeWallet, setProbeWallet] = useState("");
  const [bot, setBot] = useState(""), [chatId, setChatId] = useState(""), [code, setCode] = useState(""), [inviteName, setInviteName] = useState("");
  const [activity, setActivity] = useState<{ wallet: string; activity: { signature: string; slot: number; outcome: string; reason: string; parserVersion: number; trades: { side: string; mint: string; qty: number }[] }[] } | null>(null);
  const [issued, setIssued] = useState<string | null>(null);
  const fail = useCallback((e: unknown) => {
    if (e instanceof HttpError && e.status === 401) { setSignedOut(true); setTeam(null); setState(null); setMonitor(null); setIssued(null); setActivity(null); }
    setError(e instanceof HttpError && e.status === 401 && e.message === "Sign in required" ? "" : e instanceof Error ? e.message : "Request failed");
  }, []);
  const refresh = useCallback(async () => {
    try {
      const next = await api<Team>("/api/team/status");
      const [snapshot, health] = await Promise.all([api<State>("/api/state"), api<Monitor>("/api/monitor")]);
      setTeam(next); setState(snapshot); setMonitor(health); setSignedOut(false); setError("");
    } catch (e) { fail(e); }
  }, [fail]);
  useEffect(() => { void refresh(); const timer = setInterval(() => void refresh(), 15000); return () => clearInterval(timer); }, [refresh]);
  async function perform(action: () => Promise<unknown>, success = "Saved") {
    setBusy(true); setError(""); setMessage("");
    try { await action(); setMessage(success); await refresh(); } catch (e) { fail(e); } finally { setBusy(false); }
  }
  function submit(event: FormEvent, action: () => Promise<unknown>, success?: string) { event.preventDefault(); void perform(action, success); }
  const teamAction = (action: string, data: unknown) => api(`/api/team/${action}`, data);
  const changeState = (action: string, data: Record<string, unknown>) => api("/api/state", { action, ...data });

  return <main className="min-h-screen bg-slate-950 p-5 text-slate-100 md:p-10">
    <div className="mx-auto max-w-6xl space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 pb-5">
        <div><p className="text-xs uppercase tracking-widest text-teal-300">Shared workspace · Read-only chain access</p><h1 className="mt-2 text-3xl font-semibold">Solana Sentinel</h1><p className="mt-2 text-sm text-slate-400">Wallet activity and alerts. No signing or trading.</p></div>
        {team && <div className="flex items-center gap-3"><span>{team.member.username}</span><button className={secondary} disabled={busy} onClick={() => void perform(async () => {
          await teamAction("logout", {}); setTeam(null); setState(null); setMonitor(null); setSignedOut(true); setIssued(null);
        }, "Signed out")}>Sign out</button></div>}
      </header>
      {error && <p role="alert" className="rounded border border-rose-700 bg-rose-950 p-3">{error}</p>}
      {message && <p role="status" className="text-teal-300">{message}</p>}
      {!team ? signedOut ? <form className={`${panel} max-w-md space-y-4`} onSubmit={(e) => submit(e, async () => {
        await teamAction("login", { username, credential }); setCredential("");
      }, "Signed in")}>
        <h2 className="text-xl font-semibold">Team sign in</h2><p className="text-sm text-slate-400">Use the personal access credential supplied by your teammate or saved during host setup.</p>
        <label className="block">Username<input className={field} autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required /></label>
        <label className="block">Access credential<input className={field} type="password" autoComplete="current-password" value={credential} onChange={(e) => setCredential(e.target.value)} required /></label>
        <button className={button} disabled={busy}>Sign in</button>
      </form> : <p>Connecting to your workspace…</p> : <>
        <nav className="flex gap-3" aria-label="Workspace">{(["monitor", "alerts", "setup"] as const).map((view) => <button key={view} className={tab === view ? button : secondary} onClick={() => setTab(view)}>{view === "monitor" ? "Wallets & activity" : view === "alerts" ? "Alerts" : "Setup & team"}</button>)}</nav>
        {tab === "monitor" && <>
          <section className={panel}><div className="flex justify-between"><h2 className="text-xl font-semibold">Monitor · {monitor?.status ?? "Unavailable"}</h2><button className={secondary} onClick={() => void refresh()}>Refresh</button></div>
            <p className="mt-2 text-sm text-slate-400">{monitor?.scope}. Unsupported transactions remain unclassified. USD values and research performance are unavailable in this workspace.</p>
            {monitor?.stats && <div className="my-4 grid grid-cols-2 gap-3 md:grid-cols-4">{[["Stored observations", monitor.stats.observations], ["Archived", monitor.stats.archivedObservations ?? 0], ["Trade legs", monitor.stats.trades], ["Unclassified", monitor.stats.outcomes.UNKNOWN]].map(([label, value]) => <div key={label} className="rounded bg-slate-950 p-3"><p className="text-xs text-slate-400">{label}</p><p className="mt-1 text-2xl">{value}</p></div>)}</div>}
            <p className="text-sm">Worker: {monitor?.worker?.status ?? "No heartbeat"} · Backup: {monitor?.backup?.status ?? "Not verified"} · Off-host copy: {monitor?.backupCopy?.status ?? "Not configured"}</p>
            <p className="mt-2 text-xs text-slate-400">Monitoring pauses while the host Mac is asleep or offline. Status checked {monitor ? new Date(monitor.observedAt).toLocaleTimeString() : "—"}.</p>
          </section>
          <section className={panel}><h2 className="text-xl font-semibold">Shared watchlist</h2>
            <form className="my-4 flex gap-3" onSubmit={(e) => submit(e, async () => { await changeState("watchlist_add", { kind: "WALLET", address: wallet.trim() }); setWallet(""); }, "Wallet added; monitoring picks it up automatically")}><label className="grow"><span className="sr-only">Wallet address</span><input className={field} placeholder="Public Solana wallet address" value={wallet} onChange={(e) => setWallet(e.target.value)} required /></label><button className={button} disabled={busy}>Watch wallet</button></form>
            {!state?.watchlist.length && <p className="text-slate-400">Add a wallet to begin. No sample wallets are added automatically.</p>}
            {state?.watchlist.filter((w) => w.kind === "WALLET").map((w) => { const health = monitor?.wallets.find((h) => h.wallet === w.address); return <div key={w.id} className="flex flex-wrap justify-between gap-3 border-t border-slate-800 py-4"><div className="min-w-0"><p className="break-all font-mono text-sm">{w.address}</p><p className="mt-1 text-xs text-slate-400">{health?.coverage ?? "Waiting for first poll"} · {health?.pollAgeMs == null ? "No completed poll" : `${Math.round(health.pollAgeMs / 1000)}s since last head observation`}{health?.lastError ? ` · ${health.lastError}` : ""}</p></div><button className={secondary} disabled={busy} onClick={() => void perform(async () => { setActivity(await api(`/api/team/activity?wallet=${encodeURIComponent(w.address)}`)); }, "Activity loaded")}>View activity</button><button className={secondary} disabled={busy} onClick={() => void perform(() => changeState("watchlist_remove", { id: w.id }), "Wallet removed")}>Remove</button></div>; })}
          </section>
        </>}
        {tab === "monitor" && activity && <section className={panel}><h2 className="text-xl font-semibold">Recent activity</h2><p className="my-2 break-all text-sm text-slate-400">{activity.wallet} · Most recent 50 observations. Reinterpretations do not send historical alerts.</p>{!activity.activity.length && <p>No observations yet.</p>}{activity.activity.map((a) => <article className="border-t border-slate-800 py-3" key={a.signature}><p>{a.outcome} · Slot {a.slot} · Interpretation {a.parserVersion}</p><a className="break-all text-xs text-teal-300 underline" href={`https://explorer.solana.com/tx/${a.signature}`} target="_blank" rel="noreferrer">{a.signature}</a><p className="text-sm text-slate-400">{a.reason}</p>{a.trades.map((t, i) => <p className="break-all text-sm" key={i}>{t.side} · {t.qty} · {t.mint}</p>)}</article>)}</section>}
        {tab === "alerts" && <>
          <section className={panel}><h2 className="text-xl font-semibold">Shared alert rules</h2><p className="my-2 text-sm text-slate-400">Rules apply to future supported activity. Verified Telegram destinations receive the same eligible alerts as the shared inbox.</p>
            <div className="my-4 flex gap-3">{["BUY", "SELL"].map((side) => <button key={side} className={button} disabled={busy} onClick={() => void perform(() => changeState("alert_create", { name: `Wallet ${side.toLowerCase()}`, trigger: `TRACKED_WALLET_${side}` }))}>Add {side.toLowerCase()} rule</button>)}</div>
            {state?.alertRules.map((rule) => <RuleEditor key={`${rule.id}:${JSON.stringify(rule)}`} rule={rule} busy={busy} save={(patch) => void perform(() => teamAction("rule", { id: rule.id, patch }))} remove={() => void perform(() => teamAction("delete-rule", { id: rule.id }), "Rule deleted")} />)}
          </section>
          <section className={panel}><h2 className="text-xl font-semibold">Shared inbox</h2>{!state?.alertEvents.filter((e) => !e.isDemo).length && <p className="mt-3 text-slate-400">No live alerts yet.</p>}{state?.alertEvents.filter((e) => !e.isDemo).map((event) => <article key={event.id} className="border-t border-slate-800 py-4"><h3>{event.title}</h3><p className="mt-1 break-words text-sm text-slate-400">{event.body}</p><p className="mt-2 text-xs">{new Date(event.createdAt).toLocaleString()} · {event.delivered ? "In inbox" : event.suppressedReason}</p></article>)}</section>
          <section className={panel}><h2 className="text-xl font-semibold">Your Telegram deliveries</h2><p className="my-2 text-sm text-slate-400">An uncertain send may already have arrived. Check Telegram before retrying; a retry can create a duplicate.</p>{!team.deliveries.length && <p>No deliveries yet.</p>}{team.deliveries.map((d) => <div key={d.id} className="flex flex-wrap justify-between gap-3 border-t border-slate-800 py-3"><div><p>{d.status} · {d.attempts} attempts</p><p className="text-xs text-slate-400">{d.eventId} {d.lastError}</p></div>{["FAILED", "UNCERTAIN"].includes(d.status) && <button className={secondary} disabled={busy} onClick={() => void perform(() => teamAction("retry-delivery", { id: d.id }), "Retry queued")}>Retry delivery</button>}</div>)}</section>
        </>}
        {tab === "setup" && <div className="grid gap-5 md:grid-cols-2">
          <section className={panel}><h2 className="text-xl font-semibold">Solana connection</h2><p className="my-2 text-sm text-slate-400">{team.rpcConfigured ? "Configured. Enter a new endpoint to replace it." : "A dedicated RPC endpoint is required."} Secrets are stored encrypted and never displayed again.</p>
            <form className="space-y-3" onSubmit={(e) => submit(e, async () => { await teamAction("rpc", { endpoint: rpc, wallet: probeWallet }); setRpc(""); }, "Mainnet connection verified and saved")}><label className="block">HTTPS RPC endpoint<input className={field} type="password" autoComplete="off" value={rpc} onChange={(e) => setRpc(e.target.value)} required /></label><label className="block">Active wallet for connection test<input className={field} value={probeWallet} onChange={(e) => setProbeWallet(e.target.value)} required /></label><button className={button} disabled={busy}>Verify & save connection</button></form>
          </section>
          <section className={panel}><h2 className="text-xl font-semibold">Shared Telegram bot</h2><p className="my-2 text-sm text-slate-400">Create a bot with Telegram’s BotFather. Each member must start the bot and verify their own destination. {team.telegramConfigured ? "A token is saved." : "No token is saved."}</p><form className="space-y-3" onSubmit={(e) => submit(e, async () => { await teamAction("telegram", { token: bot }); setBot(""); }, "Bot token saved; verify your destination below")}><label className="block">Bot token<input className={field} type="password" autoComplete="off" value={bot} onChange={(e) => setBot(e.target.value)} required /></label><button className={button} disabled={busy}>Save bot token</button></form></section>
          <section className={panel}><h2 className="text-xl font-semibold">Your Telegram destination</h2><p className="my-2 text-sm text-slate-400">{team.destination?.verified ? `Verified: ${team.destination.chatId}` : "Not verified"}. Enter your numeric chat ID, then enter the code received in Telegram.</p><form className="space-y-3" onSubmit={(e) => submit(e, () => teamAction("destination", { chatId }), "Verification code sent to Telegram")}><label className="block">Chat ID<input className={field} value={chatId} onChange={(e) => setChatId(e.target.value)} required /></label><button className={button} disabled={busy}>Send verification code</button></form><form className="my-4 space-y-3" onSubmit={(e) => submit(e, async () => { await teamAction("verify-destination", { code }); setCode(""); }, "Destination verified")}><label className="block">Verification code<input className={field} autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} required /></label><button className={button} disabled={busy}>Verify destination</button></form>{team.destination?.verified && <div className="flex gap-2"><button className={secondary} disabled={busy} onClick={() => void perform(() => teamAction("test-destination", {}), "Test message delivered")}>Send test</button><button className={secondary} disabled={busy} onClick={() => void perform(() => teamAction("destination-enabled", { enabled: !team.destination?.enabled }))}>{team.destination.enabled ? "Pause alerts" : "Enable alerts"}</button></div>}</section>
          <section className={panel}><h2 className="text-xl font-semibold">Team access</h2><p className="my-2 text-sm text-slate-400">Two equal members. Generating a credential for an existing username rotates their credential and signs them out.</p>{team.members.map((m) => <div className="my-3 flex justify-between" key={m.id}><span>{m.username} · {m.enabled ? "Enabled" : "Revoked"}</span>{m.id !== team.member.id && m.enabled && <button className={secondary} disabled={busy} onClick={() => void perform(() => teamAction("revoke", { id: m.id }), "Access revoked")}>Revoke</button>}</div>)}<form className="space-y-3" onSubmit={(e) => submit(e, async () => { const result = await api<{ credential: string }>("/api/team/member", { username: inviteName }); setIssued(result.credential); }, "Credential generated")}><label className="block">New or existing username<input className={field} pattern="[a-z0-9][a-z0-9_-]{1,39}" value={inviteName} onChange={(e) => setInviteName(e.target.value)} required /></label><button className={button} disabled={busy}>Generate personal credential</button></form>{issued && <div className="mt-4 rounded border border-teal-700 p-3"><p className="text-sm">Copy this once and share it privately:</p><code className="break-all">{issued}</code><button className={`${secondary} mt-2`} onClick={() => setIssued(null)}>Hide credential</button></div>}</section>
          <section className={`${panel} md:col-span-2`}><h2 className="text-xl font-semibold">Recent team changes</h2><p className="my-2 text-sm text-slate-400">A requested change without a completed entry may have been interrupted.</p>{team.audit.slice(0, 20).map((a) => <p key={a.id} className="border-t border-slate-800 py-2 text-sm">{new Date(a.created_at).toLocaleString()} · {a.username || "Host setup"} · {a.action} · {a.outcome}</p>)}</section>
        </div>}
      </>}
    </div>
  </main>;
}
function RuleEditor({ rule, busy, save, remove }: { rule: Rule; busy: boolean; save: (patch: unknown) => void; remove: () => void }) {
  const [name, setName] = useState(rule.name), [wallet, setWallet] = useState(rule.wallet ?? ""), [mint, setMint] = useState(rule.mint ?? ""), [cooldown, setCooldown] = useState(rule.cooldownMinutes);
  return <form className="my-3 space-y-3 rounded border border-slate-700 p-4" onSubmit={(e) => { e.preventDefault(); save({ name, wallet: wallet || null, mint: mint || null, cooldownMinutes: cooldown }); }}>
    <p>{rule.trigger} · {rule.enabled ? "Enabled" : "Disabled"}</p><div className="grid gap-3 md:grid-cols-2"><label>Name<input className={field} value={name} maxLength={80} onChange={(e) => setName(e.target.value)} required /></label><label>Cooldown (minutes)<input className={field} type="number" min={0} max={10080} value={cooldown} onChange={(e) => setCooldown(Number(e.target.value))} required /></label><label>Wallet filter (optional)<input className={field} value={wallet} onChange={(e) => setWallet(e.target.value)} /></label><label>Token filter (optional)<input className={field} value={mint} onChange={(e) => setMint(e.target.value)} /></label></div><div className="flex gap-3"><button className={button} disabled={busy}>Save rule</button><button type="button" className={secondary} disabled={busy} onClick={() => save({ enabled: !rule.enabled })}>{rule.enabled ? "Disable" : "Enable"}</button><button type="button" className={secondary} disabled={busy} onClick={remove}>Delete</button></div>
  </form>;
}
