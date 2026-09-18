import {
  type AlertRule,
  type AlertEvent,
  type AlertChannel,
  AlertRuleSchema,
  AlertEventSchema,
  newId,
  nowIso,
} from "@sat/shared";

export interface AlertProvider {
  readonly channel: AlertChannel;
  send(event: AlertEvent): Promise<{ delivered: boolean; reason?: string }>;
}

export class InternalAlertProvider implements AlertProvider {
  readonly channel = "INTERNAL" as const;
  readonly inbox: AlertEvent[] = [];
  async send(event: AlertEvent) {
    this.inbox.unshift(event);
    return { delivered: true };
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
  private lastByKey = new Map<string, number>();
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
    const now = this.clock();
    const hour = now.getUTCHours();
    const out: AlertEvent[] = [];
    for (const rule of this.rules.filter((r) => r.enabled && r.trigger === input.trigger)) {
      if (rule.mint && input.mint && rule.mint !== input.mint) continue;
      if (rule.wallet && input.wallet && rule.wallet !== input.wallet) continue;
      if (rule.threshold != null && input.value != null && input.value < rule.threshold) continue;
      if (rule.quietHoursUtc) {
        const [start, end] = rule.quietHoursUtc;
        const quiet = start <= end ? hour >= start && hour < end : hour >= start || hour < end;
        if (quiet) {
          out.push(await this.record(rule, input, false, "quiet hours"));
          continue;
        }
      }
      const key = `${rule.id}:${input.mint ?? ""}:${input.wallet ?? ""}`;
      const last = this.lastByKey.get(key) ?? 0;
      if (now.getTime() - last < rule.cooldownMinutes * 60_000) {
        out.push(await this.record(rule, input, false, "cooldown"));
        continue;
      }
      const delivered = await this.deliver(rule, input);
      this.lastByKey.set(key, now.getTime());
      out.push(delivered);
    }
    return out;
  }

  private async record(
    rule: AlertRule,
    input: {
      trigger: AlertRule["trigger"];
      title: string;
      body: string;
      payload?: Record<string, unknown>;
      isDemo?: boolean;
    },
    delivered: boolean,
    suppressedReason: string | null,
  ): Promise<AlertEvent> {
    const event = AlertEventSchema.parse({
      id: newId(),
      ruleId: rule.id,
      trigger: input.trigger,
      channel: rule.channel,
      title: input.title,
      body: input.body,
      payload: input.payload ?? {},
      delivered,
      suppressedReason,
      createdAt: nowIso(),
      isDemo: input.isDemo ?? rule.isDemo,
    });
    this.history.unshift(event);
    return event;
  }

  private async deliver(
    rule: AlertRule,
    input: {
      trigger: AlertRule["trigger"];
      title: string;
      body: string;
      payload?: Record<string, unknown>;
      isDemo?: boolean;
    },
  ): Promise<AlertEvent> {
    const event = await this.record(rule, input, false, null);
    const provider =
      this.providers.find((p) => p.channel === rule.channel) ??
      this.providers.find((p) => p.channel === "INTERNAL");
    if (!provider) return { ...event, suppressedReason: "no provider" };
    const result = await provider.send(event);
    const updated = { ...event, delivered: result.delivered, suppressedReason: result.reason ?? null };
    this.history[0] = updated;
    return updated;
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
