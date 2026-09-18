# Helius migration (Enhanced Transactions → Parsed Events)

**Status:** IMPLEMENTED adapter. Parsed Events is preferred. Enhanced Transactions is compatibility fallback only. Parsed Streams ingest the **same** `normalizeParsedEventsItem` → `classifyWalletActivity` pipeline (not enabled in production this session).

## Providers

| Name | Role |
|------|------|
| `helius-parsed-events` | `POST /v1/parsed-events/transaction-history` |
| `helius-enhanced-tx` | `GET /v0/addresses/{addr}/transactions` fallback |
| `helius-parsed-stream` | Same envelope as Parsed Events items |
| `fixture` / `demo` | Tests / unlabeled-keyless local |

Application code consumes `NormalizedChainEvent`, never raw Helius types.

## Classification

BUY/SELL only when a swap is evidenced (summary `swap` / `events.swap` / type SWAP) **and** wallet asset deltas confirm spend of input and receipt of output. Transfers, ATA rent, wrap/unwrap (quote→quote), failed txs, and dust are not trades.

## CLI

```bash
pnpm --filter @sat/cli start -- analyze-wallet --live <ADDRESS>
pnpm --filter @sat/cli start -- compare-providers <ADDRESS>
```

`--live` **requires** `HELIUS_API_KEY`. It will not silently use DEMO fixtures.
