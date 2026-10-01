"use client";
import { useState, type FormEvent } from "react";
import { teamAction } from "./api";
import { formatCooldown, isBase58Address, shortAddress } from "./format";
import type { Rule, Run } from "./types";
import s from "./team.module.css";
import { Button, ConfirmInline, Switch, TagPill, TextInput, cx } from "./ui";

export function RuleCard({ rule, run, pending }: { rule: Rule; run: Run; pending: string | null }) {
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
  const side = rule.trigger.replace("TRACKED_WALLET_", "");

  function save(event: FormEvent) {
    event.preventDefault();
    if (!valid || !dirty) return;
    void run(key("save"), () => teamAction("rule", { id: rule.id, patch: { name, wallet: wallet || null, mint: mint || null, cooldownMinutes: cooldownNumber } }), "Rule saved");
  }
  const reset = () => { setName(rule.name); setCooldown(String(rule.cooldownMinutes)); setWallet(rule.wallet ?? ""); setMint(rule.mint ?? ""); };

  return (
    <form onSubmit={save} noValidate aria-label={`Rule ${rule.name}`} className={cx(s.panel, "flex flex-col gap-4 !p-5")}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <TagPill>{side}</TagPill>
            <span className="font-semibold break-words">{rule.name}</span>
            {dirty && <span className="text-xs font-semibold" style={{ color: "#FFB01F" }}>Unsaved changes</span>}
          </div>
          <span className={cx(s.muted, "text-[13px]")}>
            {rule.wallet ? <><span className={s.mono} title={rule.wallet}>{shortAddress(rule.wallet)}</span></> : "any wallet"} · {rule.mint ? <span className={s.mono} title={rule.mint}>{shortAddress(rule.mint)}</span> : "any token"} · {formatCooldown(rule.cooldownMinutes)} cooldown
          </span>
        </div>
        <span className="inline-flex items-center gap-2.5 text-sm">
          <span className={s.soft} aria-hidden="true">{rule.enabled ? "Enabled" : "Disabled"}</span>
          <Switch checked={rule.enabled} label={`${rule.name} enabled`} busy={pending === key("toggle")} disabled={!!pending}
            onChange={() => void run(key("toggle"), () => teamAction("rule", { id: rule.id, patch: { enabled: !rule.enabled } }), rule.enabled ? "Rule disabled" : "Rule enabled")} />
        </span>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <TextInput label="Name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} error={errors.name} required />
        <TextInput label="Cooldown (minutes)" type="number" inputMode="numeric" min={0} max={10080} value={cooldown} onChange={(e) => setCooldown(e.target.value)} hint="0–10080; 1440 = 1 day" error={errors.cooldown} required />
        <TextInput label="Wallet filter" optional value={wallet} onChange={(e) => setWallet(e.target.value)} className={cx(s.mono, s.fieldSm)} spellCheck={false} hint="Leave blank for any wallet." error={errors.wallet} />
        <TextInput label="Token filter" optional value={mint} onChange={(e) => setMint(e.target.value)} className={cx(s.mono, s.fieldSm)} spellCheck={false} hint="Token mint address. Leave blank for any token." error={errors.mint} />
      </div>
      <div className="flex flex-wrap items-start gap-2">
        <Button type="submit" small disabled={!dirty || !valid || !!pending} busy={pending === key("save")} busyText="Saving…">Save rule</Button>
        <Button small disabled={!dirty || !!pending} onClick={reset}>Reset</Button>
        <ConfirmInline trigger="Delete" message="Delete this rule? This cannot be undone." confirmLabel="Delete rule" busy={pending === key("delete")}
          onConfirm={() => run(key("delete"), () => teamAction("delete-rule", { id: rule.id }), "Rule deleted")} />
      </div>
    </form>
  );
}
