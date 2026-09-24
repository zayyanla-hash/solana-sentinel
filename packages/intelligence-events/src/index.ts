import { z } from "zod";

export const INTELLIGENCE_EVENT_VERSION = "intelligence-event-v1";

const FiniteNumber = z.number().finite();
const MetricValue = z.union([FiniteNumber, z.string(), z.boolean(), z.null()]);

export const IntelligenceEvidenceSchema = z.object({
  source: z.string().min(1),
  sourceId: z.string().min(1),
  observedAt: z.string().datetime(),
  detail: z.string().min(1).optional(),
}).strict();

export const IntelligenceEventSchema = z.object({
  id: z.string().min(1),
  version: z.literal(INTELLIGENCE_EVENT_VERSION),
  type: z.enum([
    "WALLET_MIGRATION", "WALLET_CONVERGENCE", "CLUSTER_ACTIVITY",
    "LIQUIDITY_SHIFT", "VOLUME_ACCELERATION", "MOMENTUM_EVENT",
    "REGIME_SHIFT", "UNUSUAL_FLOW",
  ]),
  chain: z.literal("SOLANA"),
  asset: z.string().min(1),
  timestamp: z.string().datetime(),
  score: FiniteNumber.min(0).max(100).nullable(),
  confidence: FiniteNumber.min(0).max(1).nullable(),
  severity: z.enum(["INFO", "LOW", "MEDIUM", "HIGH"]),
  metrics: z.record(MetricValue),
  evidence: z.array(IntelligenceEvidenceSchema).min(1),
  provenance: z.object({
    provider: z.string().min(1),
    datasetVersion: z.string().min(1),
    algorithmVersion: z.string().min(1),
    isDemo: z.boolean(),
  }).strict(),
  strategyVersion: z.string().min(1).nullable(),
  dataQuality: z.enum(["COMPLETE", "PARTIAL", "STALE", "DEMO", "INSUFFICIENT"]),
}).strict().refine((event) => event.provenance.isDemo === (event.dataQuality === "DEMO"), {
  message: "DEMO quality must match provenance.isDemo",
});

export type IntelligenceEvent = z.infer<typeof IntelligenceEventSchema>;
export type IntelligenceEventType = IntelligenceEvent["type"];

export interface IntelligenceQuery {
  type?: IntelligenceEventType;
  asset?: string;
  from?: string;
  through?: string;
  minSeverity?: IntelligenceEvent["severity"];
  isDemo?: boolean;
  offset?: number;
  limit?: number;
  order?: "NEWEST" | "OLDEST" | "SCORE_DESC";
}

export interface IntelligencePage {
  items: IntelligenceEvent[];
  total: number;
  offset: number;
  limit: number;
}

/** Read and append contract. Persistence adapters can implement this without changing callers. */
export interface IntelligenceEventStore {
  append(events: readonly IntelligenceEvent[]): Promise<void>;
  query(filter?: IntelligenceQuery): Promise<IntelligencePage>;
}

const severityRank: Record<IntelligenceEvent["severity"], number> = {
  INFO: 0, LOW: 1, MEDIUM: 2, HIGH: 3,
};

function validQuery(query: IntelligenceQuery): Required<Pick<IntelligenceQuery, "offset" | "limit" | "order">> {
  const offset = query.offset ?? 0;
  const limit = query.limit ?? 25;
  if (!Number.isSafeInteger(offset) || offset < 0) throw new Error("Invalid offset");
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error("Invalid limit");
  const hasZone = (value: string): boolean => /(?:Z|[+-]\d{2}:\d{2})$/i.test(value) && Number.isFinite(Date.parse(value));
  if (query.from && !hasZone(query.from)) throw new Error("Invalid from timestamp: timezone required");
  if (query.through && !hasZone(query.through)) throw new Error("Invalid through timestamp: timezone required");
  if (query.from && query.through && Date.parse(query.from) > Date.parse(query.through)) {
    throw new Error("from must not exceed through");
  }
  const order = query.order ?? "NEWEST";
  if (!["NEWEST", "OLDEST", "SCORE_DESC"].includes(order)) throw new Error("Invalid order");
  return { offset, limit, order };
}

/** Deterministic in-memory adapter for tests and demos; it does not claim durable storage. */
export class InMemoryIntelligenceEventStore implements IntelligenceEventStore {
  private readonly byId = new Map<string, IntelligenceEvent>();

  async append(events: readonly IntelligenceEvent[]): Promise<void> {
    const parsed = events.map((event) => IntelligenceEventSchema.parse(event));
    const batchIds = new Set<string>();
    for (const event of parsed) {
      if (batchIds.has(event.id) || this.byId.has(event.id)) throw new Error(`Duplicate intelligence event: ${event.id}`);
      batchIds.add(event.id);
      const eventTime = Date.parse(event.timestamp);
      if (event.evidence.some((item) => Date.parse(item.observedAt) > eventTime)) {
        throw new Error(`Evidence after event timestamp: ${event.id}`);
      }
    }
    for (const event of parsed) this.byId.set(event.id, structuredClone(event));
  }

  async query(filter: IntelligenceQuery = {}): Promise<IntelligencePage> {
    const { offset, limit, order } = validQuery(filter);
    const rows = [...this.byId.values()].filter((event) =>
      (!filter.type || event.type === filter.type) &&
      (!filter.asset || event.asset === filter.asset) &&
      (filter.isDemo === undefined || event.provenance.isDemo === filter.isDemo) &&
      (!filter.minSeverity || severityRank[event.severity] >= severityRank[filter.minSeverity]) &&
      (!filter.from || Date.parse(event.timestamp) >= Date.parse(filter.from)) &&
      (!filter.through || Date.parse(event.timestamp) <= Date.parse(filter.through)),
    );
    rows.sort((a, b) => {
      if (order === "SCORE_DESC") {
        const score = (b.score ?? -1) - (a.score ?? -1);
        if (score !== 0) return score;
      }
      const time = Date.parse(a.timestamp) - Date.parse(b.timestamp);
      if (time !== 0) return order === "OLDEST" ? time : -time;
      return a.id.localeCompare(b.id);
    });
    return { items: rows.slice(offset, offset + limit).map((row) => structuredClone(row)), total: rows.length, offset, limit };
  }
}

export { demoIntelligenceEvents } from "./demo";
export { eventFromWalletMigration, type MigrationEventSource } from "./migration";
