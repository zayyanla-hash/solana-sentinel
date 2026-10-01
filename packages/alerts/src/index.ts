import {
  type AlertRule,
  type AlertEvent,
  type AlertChannel,
  AlertRuleSchema,
  AlertEventSchema,
  newId,
} from "@sat/shared";

export interface AlertProvider {
  readonly channel: AlertChannel;
  send(event: AlertEvent): Promise<{ delivered: boolean; reason?: string }>;
}

export interface AlertCooldownClaim {
  key: string;
  expiresAt: string;
}

export type AlertEventRecorder = (event: AlertEvent, cooldown?: AlertCooldownClaim) => Promise<void | AlertEvent>;

export class InternalAlertProvider implements AlertProvider {
  readonly channel = "INTERNAL" as const;
  readonly inbox: AlertEvent[] = [];
  private readonly evictedOnSend = new Map<string, AlertEvent | null>();
  async send(event: AlertEvent) {
    this.inbox.unshift({ ...event, delivered: true, suppressedReason: null });
    this.evictedOnSend.set(event.id, this.inbox.length > 500 ? this.inbox.pop() ?? null : null);
    if (this.evictedOnSend.size > 1000) this.evictedOnSend.delete(this.evictedOnSend.keys().next().value!);
    return { delivered: true };
  }
  finalize(id: string): void {
    this.evictedOnSend.delete(id);
  }
  retract(id: string): void {
    const index = this.inbox.findIndex((event) => event.id === id);
    if (index >= 0) this.inbox.splice(index, 1);
    const evicted = this.evictedOnSend.get(id);
    if (evicted && this.inbox.length < 500) this.inbox.push(evicted);
    this.evictedOnSend.delete(id);
  }
}

export class StubExternalAlertProvider implements AlertProvider {
  constructor(readonly channel: Exclude<AlertChannel, "INTERNAL">) {}
  async send(_event: AlertEvent) {
    return { delivered: false, reason: `${this.channel} provider not configured` };
  }
}

export class AlertEngine {
  private rules: AlertRule[] = [];
  private history: AlertEvent[] = [];
  private lastByKey = new Map<string, { last: number; expiresAt: number }>();
  private eventRecorder: AlertEventRecorder | null = null;
  private pendingEmit: Promise<void> = Promise.resolve();
  private readonly maxHistory = 500;
  private readonly maxCooldownKeys = 10_000;
  constructor(
    private readonly providers: AlertProvider[] = [new InternalAlertProvider()],
    private readonly clock: () => Date = () => new Date(),
  ) {}

  listRules(): AlertRule[] {
    return [...this.rules];
  }
  listHistory(limit = 50): AlertEvent[] {
    return this.history.slice(0, limit);
  }

  restoreRules(rules: AlertRule[]): void {
    this.rules = rules.map((rule) => AlertRuleSchema.parse(rule));
    this.rebuildCooldown();
  }

  restoreHistory(events: AlertEvent[]): void {
    this.history = events.map((event) => AlertEventSchema.parse(event))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, this.maxHistory);
    this.rebuildCooldown();
  }

  private cooldownExpiry(last: number, minutes: number): number {
    return Math.min(Number.MAX_SAFE_INTEGER, last + minutes * 60_000);
  }

  private rebuildCooldown(): void {
    this.lastByKey.clear();
    const now = this.clock().getTime();
    for (const event of this.history) {
      if (!event.delivered) continue;
      const rule = this.rules.find((candidate) => candidate.id === event.ruleId);
      if (!rule || rule.cooldownMinutes === 0) continue;
      const key = `${event.ruleId}:${String(event.payload.mint ?? "")}:${String(event.payload.wallet ?? "")}`;
      const timestamp = Date.parse(event.createdAt);
      const expiresAt = this.cooldownExpiry(timestamp, rule.cooldownMinutes);
      if (!Number.isFinite(timestamp) || expiresAt <= now) continue;
      const old = this.lastByKey.get(key);
      if (!old || timestamp > old.last) this.lastByKey.set(key, { last: timestamp, expiresAt });
    }
  }

  setEventRecorder(recorder: AlertEventRecorder): void {
    this.eventRecorder = recorder;
  }

  upsertRule(rule: AlertRule): AlertRule {
    const parsed = AlertRuleSchema.parse(rule);
    this.rules = [parsed, ...this.rules.filter((r) => r.id !== parsed.id)];
    return parsed;
  }

  deleteRule(id: string): void {
    this.rules = this.rules.filter((r) => r.id !== id);
  }

  async emit(input: {
    trigger: AlertRule["trigger"];
    title: string;
    body: string;
    mint?: string | null;
    wallet?: string | null;
    value?: number | null;
    payload?: Record<string, unknown>;
    isDemo?: boolean;
  }): Promise<AlertEvent[]> {
    const result = this.pendingEmit.then(() => this.emitSerial(input));
    this.pendingEmit = result.then(() => undefined, () => undefined);
    return result;
  }

  private async emitSerial(input: {
    trigger: AlertRule["trigger"];
    title: string;
    body: string;
    mint?: string | null;
    wallet?: string | null;
    value?: number | null;
    payload?: Record<string, unknown>;
    isDemo?: boolean;
  }): Promise<AlertEvent[]> {
    const now = this.clock();
    const hour = now.getUTCHours();
    const out: AlertEvent[] = [];
    for (const [key, value] of this.lastByKey) {
      if (value.expiresAt <= now.getTime()) this.lastByKey.delete(key);
    }
    for (const rule of this.rules.filter((r) => r.enabled && r.trigger === input.trigger)) {
      if (rule.mint && rule.mint !== input.mint) continue;
      if (rule.wallet && rule.wallet !== input.wallet) continue;
      if (rule.threshold != null && (input.value == null || !Number.isFinite(input.value) || input.value < rule.threshold)) continue;
      if (rule.isDemo !== (input.isDemo ?? true)) continue;
      if (rule.quietHoursUtc) {
        const [start, end] = rule.quietHoursUtc;
        const quiet = start <= end ? hour >= start && hour < end : hour >= start || hour < end;
        if (quiet) {
          out.push(await this.commit(this.makeEvent(rule, input, false, "quiet hours")));
          continue;
        }
      }
      const key = `${rule.id}:${input.mint ?? ""}:${input.wallet ?? ""}`;
      const last = this.lastByKey.get(key);
      if (last && now.getTime() < last.expiresAt) {
        out.push(await this.commit(this.makeEvent(rule, input, false, "cooldown")));
        continue;
      }
      if (rule.cooldownMinutes > 0 && !last && this.lastByKey.size >= this.maxCooldownKeys) {
        out.push(await this.commit(this.makeEvent(rule, input, false, "cooldown-capacity")));
        continue;
      }
      const delivered = await this.deliver(rule, input);
      const expiresAt = this.cooldownExpiry(now.getTime(), rule.cooldownMinutes);
      const cooldown = delivered.event.delivered && delivered.provider instanceof InternalAlertProvider && rule.cooldownMinutes > 0
        ? { key, expiresAt: new Date(Math.min(expiresAt, Date.UTC(9999, 11, 31, 23, 59, 59, 999))).toISOString() }
        : undefined;
      const committed = await this.commit(delivered.event, delivered.provider, cooldown);
      if (committed.delivered && rule.cooldownMinutes > 0) {
        this.lastByKey.set(key, { last: now.getTime(), expiresAt });
      }
      out.push(committed);
    }
    return out;
  }

  private async commit(event: AlertEvent, provider?: AlertProvider, cooldown?: AlertCooldownClaim): Promise<AlertEvent> {
    let persisted = event;
    try {
      const result = await this.eventRecorder?.(event, cooldown);
      if (result) {
        persisted = AlertEventSchema.parse(result);
        if (persisted.id !== event.id) throw new Error("alert-recorder-id-mismatch");
      }
    } catch (error) {
      if (provider instanceof InternalAlertProvider) provider.retract(event.id);
      throw error;
    }
    if (!persisted.delivered && provider instanceof InternalAlertProvider) provider.retract(event.id);
    else if (provider instanceof InternalAlertProvider) provider.finalize(event.id);
    this.history.unshift(persisted);
    if (this.history.length > this.maxHistory) this.history.length = this.maxHistory;
    return persisted;
  }

  private makeEvent(
    rule: AlertRule,
    input: {
      trigger: AlertRule["trigger"];
      title: string;
      body: string;
      payload?: Record<string, unknown>;
      mint?: string | null;
      wallet?: string | null;
      isDemo?: boolean;
    },
    delivered: boolean,
    suppressedReason: string | null,
  ): AlertEvent {
    const event = AlertEventSchema.parse({
      id: newId(),
      ruleId: rule.id,
      trigger: input.trigger,
      channel: rule.channel,
      title: input.title,
      body: input.body,
      payload: { ...input.payload, mint: input.mint ?? null, wallet: input.wallet ?? null },
      delivered,
      suppressedReason,
      createdAt: this.clock().toISOString(),
      isDemo: input.isDemo ?? rule.isDemo,
    });
    return event;
  }

  private async deliver(
    rule: AlertRule,
    input: {
      trigger: AlertRule["trigger"];
      title: string;
      body: string;
      payload?: Record<string, unknown>;
      mint?: string | null;
      wallet?: string | null;
      isDemo?: boolean;
    },
  ): Promise<{ event: AlertEvent; provider?: AlertProvider }> {
    const event = this.makeEvent(rule, input, false, null);
    const provider =
      this.providers.find((p) => p.channel === rule.channel);
    if (!provider) {
      const failed = { ...event, suppressedReason: `${rule.channel} provider not configured` };
      return { event: failed };
    }
    let result: Awaited<ReturnType<AlertProvider["send"]>>;
    try {
      result = await provider.send(event);
    } catch (error) {
      result = { delivered: false, reason: error instanceof Error ? error.message : String(error) };
    }
    const updated = { ...event, delivered: result.delivered, suppressedReason: result.reason ?? null };
    return { event: updated, provider };
  }
}

export function createDefaultAlertEngine(): AlertEngine {
  return new AlertEngine([
    new InternalAlertProvider(),
    new StubExternalAlertProvider("TELEGRAM"),
    new StubExternalAlertProvider("DISCORD"),
    new StubExternalAlertProvider("EMAIL"),
    new StubExternalAlertProvider("WEB_PUSH"),
  ]);
}

export { TelegramClient, formatTelegramAlert } from "./telegram";
export type { TelegramSendResult } from "./telegram";
