"use client";
import { useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { changeState, teamAction } from "./api";
import { formatCooldown, isBase58Address, shortAddress } from "./format";
import { createScopedRule } from "./rules";
import type { Notice as NoticeT, Rule, Run, TeamStatus } from "./types";
import s from "./team.module.css";
import { Button, Notice, Switch, TextInput, cx } from "./ui";

type Side = "BUY" | "SELL";
const SIDES: { side: Side; label: string }[] = [{ side: "BUY", label: "Alert on buys" }, { side: "SELL", label: "Alert on sells" }];
const defaultName = (address: string, side: Side) => `${shortAddress(address)} ${side === "BUY" ? "buy" : "sell"}`;

export function WalletAlertPanel({ address, team, rules, run, pending, notice, onDismiss, onEditRules }: {
  address: string; team: TeamStatus; rules: Rule[]; run: Run; pending: string | null; notice: NoticeT | null; onDismiss: () => void; onEditRules: () => void;
}) {
  const [side, setSide] = useState<Side>("BUY");
  const [name, setName] = useState(defaultName(address, "BUY"));
  const [named, setNamed] = useState(false);
  const [mint, setMint] = useState("");
  const [cooldown, setCooldown] = useState("60");
  const [touched, setTouched] = useState(false);
  const tabRefs = useRef<Partial<Record<Side, HTMLButtonElement | null>>>({});
  const cooldownNumber = Number(cooldown);
  const errors = {
    name: name.trim() ? null : "Name is required.",
    mint: !mint || isBase58Address(mint.trim()) ? null : "Enter a valid token mint or leave blank.",
    cooldown: cooldown.trim() !== "" && Number.isInteger(cooldownNumber) && cooldownNumber >= 0 && cooldownNumber <= 10080 ? null : "Enter a whole number from 0 to 10080.",
  };
  const valid = !Object.values(errors).some(Boolean);
  const busy = pending === "rule:new:wallet";
  const delivery = team.destination?.verified && team.destination.enabled ? "Shared inbox + verified Telegram" : "Shared inbox only — verify Telegram in Setup";

  function pickSide(next: Side) {
    setSide(next);
    if (!named) setName(defaultName(address, next));
  }
  function onTabKey(event: KeyboardEvent, index: number) {
    const to = event.key === "ArrowRight" ? (index + 1) % 2 : event.key === "ArrowLeft" ? (index + 1) % 2 : event.key === "Home" ? 0 : event.key === "End" ? 1 : null;
    if (to === null) return;
    event.preventDefault();
    pickSide(SIDES[to]!.side);
    tabRefs.current[SIDES[to]!.side]?.focus();
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setTouched(true);
    if (!valid) return;
    const ok = await run("rule:new:wallet", async () => {
      await createScopedRule(
        { side, name: name.trim(), wallet: address, mint: mint.trim(), cooldownMinutes: cooldownNumber },
        {
          create: (ruleName, trigger) => changeState("alert_create", { name: ruleName, trigger }) as Promise<{ rule?: { id?: string } }>,
          patch: (id, patch) => teamAction("rule", { id, patch }),
          remove: (id) => teamAction("delete-rule", { id }),
        },
      );
    }, `${side === "BUY" ? "Buy" : "Sell"} alert created for ${shortAddress(address)}`, "wallet-alert");
    if (ok) { setMint(""); setTouched(false); setNamed(false); setName(defaultName(address, side)); }
  }

  const toggle = (rule: Rule) => void run(`rule:${rule.id}:toggle`, () => teamAction("rule", { id: rule.id, patch: { enabled: !rule.enabled } }), rule.enabled ? "Rule disabled" : "Rule enabled", "wallet-alert");
  const show = touched;

  return (
    <aside aria-label="Alert on this wallet" className="flex flex-col gap-6">
      <form onSubmit={submit} noValidate className={cx(s.panel, "flex flex-col gap-5")} aria-label="Create a wallet alert">
        <div role="tablist" aria-label="Alert side" className="flex gap-6 border-b border-[var(--t-hair)]">
          {SIDES.map(({ side: value, label }, index) => (
            <button key={value} ref={(el) => { tabRefs.current[value] = el; }} type="button" role="tab" id={`alert-tab-${value}`} aria-selected={side === value} aria-controls="alert-fields" tabIndex={side === value ? 0 : -1}
              onClick={() => pickSide(value)} onKeyDown={(event) => onTabKey(event, index)}
              className="min-h-11 border-0 border-b-2 bg-transparent pb-3 text-base font-semibold" style={{ borderBottomColor: side === value ? "#CCFF00" : "transparent", color: side === value ? "#F4F1EA" : "#A39C8E" }}>
              {label}
            </button>
          ))}
        </div>
        <div id="alert-fields" role="tabpanel" aria-labelledby={`alert-tab-${side}`} className="flex flex-col gap-5">
          <TextInput label="Rule name" value={name} maxLength={80} onChange={(event) => { setName(event.target.value); setNamed(true); }} error={show ? errors.name : null} required />
          <TextInput label="Token filter" optional value={mint} onChange={(event) => setMint(event.target.value)} className={cx(s.mono, s.fieldSm)} spellCheck={false} autoComplete="off" placeholder="Any token" hint="Token mint address. Leave blank for any token." error={show ? errors.mint : null} />
          <div>
            <label htmlFor="alert-cooldown" className={s.label}>Cooldown</label>
            <span className="flex items-center gap-2.5">
              <input id="alert-cooldown" type="number" inputMode="numeric" min={0} max={10080} value={cooldown} onChange={(event) => setCooldown(event.target.value)} aria-invalid={show && errors.cooldown ? true : undefined} aria-describedby="alert-cooldown-hint" className={s.field} style={{ width: 120 }} />
              <span className={s.muted}>minutes</span>
            </span>
            <p id="alert-cooldown-hint" className={s.hint}>0–10080. Repeat alerts within the cooldown are suppressed.</p>
            {show && errors.cooldown && <p className={s.fieldError}>{errors.cooldown}</p>}
          </div>
        </div>
        <div className="flex justify-between gap-4 border-t border-[var(--t-hair)] pt-3 text-sm">
          <span className={s.muted}>Delivered to</span><span className="text-right">{delivery}</span>
        </div>
        <Button type="submit" variant="primary" className="w-full" busy={busy} busyText="Creating…" disabled={!!pending && !busy}>Create {side === "BUY" ? "buy" : "sell"} alert</Button>
        <p className={cx(s.hint, "!-mt-2 text-center")}>Applies to future finalized, supported activity only. Filtered to {shortAddress(address)}.</p>
        {notice && <Notice tone={notice.tone} onDismiss={onDismiss}>{notice.text}</Notice>}
      </form>

      <section aria-label="Rules on this wallet" className={cx(s.panel, "!px-6 !py-2")}>
        {rules.length === 0 && <p className={cx(s.muted, "py-4 text-sm")}>No rules name this wallet yet. A rule without a wallet filter alerts on every watched wallet; manage those in Alerts.</p>}
        <ul>
          {rules.map((rule, index) => (
            <li key={rule.id} className={cx(s.row, index === rules.length - 1 && s.rowLast)}>
              <span className="flex min-w-0 flex-col">
                <span className="font-semibold break-words">{rule.name}</span>
                <span className={cx(s.muted, "text-[13px]")}>{rule.trigger.replace("TRACKED_WALLET_", "")} · this wallet · {rule.mint ? <span className={s.mono} title={rule.mint}>{shortAddress(rule.mint)}</span> : "any token"} · {formatCooldown(rule.cooldownMinutes)} cooldown</span>
              </span>
              <Switch checked={rule.enabled} label={`${rule.name} enabled`} busy={pending === `rule:${rule.id}:toggle`} disabled={!!pending} onChange={() => toggle(rule)} />
            </li>
          ))}
        </ul>
        {rules.length > 0 && <div className="pb-3"><button type="button" onClick={onEditRules} className={cx(s.link, "border-0 bg-transparent p-0 text-sm")}>Edit rules in Alerts</button></div>}
      </section>
    </aside>
  );
}
