# Intelligence events

`@sat/intelligence-events` defines a versioned, runtime-validated event contract for read-only market intelligence. It is intentionally separate from trade proposals, policy decisions, and execution. An event cannot authorize a paper or live order.

An event includes its type, Solana asset, event time, optional score and confidence, severity, metrics, evidence references, provider and dataset versions, data quality, and an explicit demo flag. Score and confidence may be `null` when no calibrated model exists. Producers must preserve source transaction identifiers and source observation times. The store rejects evidence later than the event timestamp.

`IntelligenceEventStore` has `append` and `query` methods. The included `InMemoryIntelligenceEventStore` is a deterministic demo/test adapter. It validates complete batches before writing, rejects duplicate IDs, returns defensive copies, and supports type, asset, time, demo, and severity filters plus stable sorting and bounded offset pagination. It is not durable storage. A database adapter or API route can implement the same interface after integration review.

```ts
import { InMemoryIntelligenceEventStore } from "@sat/intelligence-events";

const store = new InMemoryIntelligenceEventStore();
const page = await store.query({ type: "WALLET_MIGRATION", limit: 25 });
```

No real-time feed, subscriber alerts, billing, or customer API is claimed by this package. Its fixtures in tests are synthetic and should not be interpreted as market evidence or profitable signals.

`demoIntelligenceEvents()` returns one explicitly synthetic event for presentations and query demonstrations. It has no calibrated score or dollar-flow estimate.

`eventFromWalletMigration(signal, origin)` converts a validated wallet migration result into the contract while keeping the two packages separate. The caller must supply real provider, dataset, and algorithm versions. It preserves each transaction signature and observation time, leaves uncalibrated score and confidence as `null`, and uses the latest BUY completion as the event timestamp. Its quality remains `PARTIAL` even with complete valuation because the module cannot establish complete wallet-history coverage. The adapter does not trigger trading.
