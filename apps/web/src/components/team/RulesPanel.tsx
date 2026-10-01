"use client";
import { useState, type FormEvent } from "react";
import { changeState, teamAction } from "./api";
import { isBase58Address } from "./format";
import type { Rule, Run, StateSnapshot } from "./types";
import { Button, ConfirmInline, EmptyState, Notice, Panel, PanelHeader, Skeleton, StatusPill, TextInput } from "./ui";

export function RulesPanel({ state, error, run, pending }: { state: StateSnapshot | null; error?: string; run: Run; pending: string | null }) {
  return (
    <Panel>
      <PanelHeader title="Shared alert rules" hint="Verified Telegram destinations receive the same eligible alerts as the shared inbox."
        action={<div className="flex flex-wrap gap-2">{(["BUY", "SELL"] as const).map((side) => (
          <Button key={side} variant="primary" disabled={!!pending} busy={pending === `rule:new:${side}`} busyText="Adding…"
            onClick={() => void run(`rule:new:${side}`, () => changeState("alert_create", { name: `Wallet ${side.toLowerCase()}`, trigger: `TRACKED_WALLET_${side}` }), "Rule added")}>
            Add {side} rule
          </Button>))}
        </div>} />
      {error && <Notice tone="error" className="mb-3">Could not load rules: {error}</Notice>}
      {!state && !error && <Skeleton className="h-32" />}
      {state && !state.alertRules.length && (
        <EmptyState title="No alert rules yet.">Rules apply to future supported, finalized activity only. Add a BUY or SELL rule to start.</EmptyState>
      )}
      <div className="space-y-3">
        {state?.alertRules.map((rule) => <RuleCard key={`${rule.id}:${JSON.stringify(rule)}`} rule={rule} run={run} pending={pending} />)}
      </div>
    </Panel>
  );
}

function RuleCard({ rule, run, pending }: { rule: Rule; run: Run; pending: string | null }) {
  const [name, setName] = useState(rule.name);
  const [cooldown, setCooldown] = useState(String(rule.cooldownMinutes));
  const [wallet, setWallet] = useState(rule.wallet ?? "");
  const [mint, setMint] = useState(rule.mint ?? "");
  const dirty = name !== rule.name || cooldown !== String(rule.cooldownMinutes) || wallet !== (rule.wallet ?? "") || mint !== (rule.mint ?? "");
  const cooldownNumber = Number(cooldown);
  const errors = {
    name: name.trim() ? null : "Name is required.",
    cooldown: cooldown.trim() !== "" && Number.isInteger(cooldownNumber) && cooldownNumber >= 0 && cooldownNumber <= 10080 ? null : "Enter a whole number from 0 to 10080.",
    wallet: !wallet || isBase58Address(wallet) ? null : "Enter a valid public address or leave blank.",
    mint: !mint || isBase58Address(mint) ? null : "Enter a valid token mint or leave blank.",
  };
  const valid = !Object.values(errors).some(Boolean);
  const key = (suffix: string) => `rule:${rule.id}:${suffix}`;
  const busy = pending === key("save");

  function save(event: FormEvent) {
    event.preventDefault();
    if (!valid || !dirty) return;
    void run(key("save"), () => teamAction("rule", { id: rule.id, patch: { name, wallet: wallet || null, mint: mint || null, cooldownMinutes: cooldownNumber } }), "Rule saved");
  }
  const reset = () => { setName(rule.name); setCooldown(String(rule.cooldownMinutes)); setWallet(rule.wallet ?? ""); setMint(rule.mint ?? ""); };

  return (
    <form onSubmit={save} noValidate aria-label={`Rule ${rule.name}`} className="space-y-3 rounded-md border border-[var(--line)] bg-[var(--bg-0)] p-4">
      <div className="flex flex-wrap items-center gap-2">
        <StatusPill tone="neutral" label={rule.trigger.replace("TRACKED_WALLET_", "")} title={rule.trigger} />
        <StatusPill tone={rule.enabled ? "ok" : "neutral"} label={rule.enabled ? "Enabled" : "Disabled"} />
        {dirty && <span className="text-xs text-[#f0cb6a]">Unsaved changes</span>}
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <TextInput label="Name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} error={errors.name} required />
        <TextInput label="Cooldown (minutes)" type="number" inputMode="numeric" min={0} max={10080} value={cooldown} onChange={(e) => setCooldown(e.target.value)} hint="0–10080; 1440 = 1 day" error={errors.cooldown} required />
        <TextInput label="Wallet filter" optional value={wallet} onChange={(e) => setWallet(e.target.value)} className="mono" spellCheck={false} hint="Leave blank for any wallet." error={errors.wallet} />
        <TextInput label="Token filter" optional value={mint} onChange={(e) => setMint(e.target.value)} className="mono" spellCheck={false} hint="Token mint address. Leave blank for any token." error={errors.mint} />
      </div>
      <div className="flex flex-wrap items-start gap-2">
        <Button type="submit" variant="primary" disabled={!dirty || !valid || !!pending} busy={busy} busyText="Saving…">Save rule</Button>
        <Button disabled={!dirty || !!pending} onClick={reset}>Reset</Button>
        <Button disabled={!!pending} busy={pending === key("toggle")} busyText="Saving…"
          onClick={() => void run(key("toggle"), () => teamAction("rule", { id: rule.id, patch: { enabled: !rule.enabled } }), rule.enabled ? "Rule disabled" : "Rule enabled")}>
          {rule.enabled ? "Disable" : "Enable"}
        </Button>
        <ConfirmInline trigger="Delete" message="Delete this rule? This cannot be undone." confirmLabel="Delete rule" busy={pending === key("delete")}
          onConfirm={() => run(key("delete"), () => teamAction("delete-rule", { id: rule.id }), "Rule deleted")} />
      </div>
    </form>
  );
}
