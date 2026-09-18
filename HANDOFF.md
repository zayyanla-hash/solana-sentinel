# HANDOFF — Solana Sentinel

## STATUS

**V3 PAPER/DEMO research + intelligence platform** — V1/V2 safety architecture preserved; live broadcast still hard-disabled. Wallet credibility, smart-money signals, walk-forward Strategy Lab, versioned API, entitlements, and a flag-off x402 PoC are implemented. Postgres persistence remains available when `DATABASE_URL` is set; default runtime without that URL is labeled in-memory.

## WHAT WAS BUILT

- pnpm monorepo: `apps/web`, `apps/worker`, `packages/*`
- Discovery → historical/snapshot signals → token-risk v1.5 → policy → scoring → research → portfolio risk → Jupiter quote/plan → paper fill → experiments
- Next.js research terminal (DEMO/PAPER banner, `canBroadcast=false` in UI, NAV, feed, provenance, ledger)
- `PostgresDatabase` when `DATABASE_URL` is set; `InMemoryDatabase` fallback
- Vitest **106** tests + Playwright critical flow (paper fill, backtest, alert, `/api/v1/health`); GitHub Actions (lint, typecheck, vitest, web build, gitleaks, Playwright)
- Safety gates: LIVE remapped to PAPER; `canBroadcast: false`; `isLiveTradingAllowed()` always false; `READ_ONLY` blocks paper fills; proposal upsert-by-id; CSRF origin check on mutating POST

## WHAT ACTUALLY RUNS

| Surface | Status |
|---------|--------|
| Dashboard | `pnpm --filter @sat/web run dev` → [http://127.0.0.1:4317](http://127.0.0.1:4317) (loopback) |
| API `/api/state` | Dynamic Node route; discovery + research on cold start |
| Worker | `pnpm --filter @sat/worker run start` |
| Persistence | memory unless `DATABASE_URL` is set |
| Market data | DEMO default (Birdeye OHLCV v3 if keyed) |
| On-chain | DEMO default (Helius DAS + largest-accounts if keyed) |
| Execution | Jupiter Swap API V2 GET `/order` when keyed; labeled DEMO otherwise; fail-closed; never broadcast |
| Research LLM | Mock default |

## TEST RESULTS

Re-run `pnpm exec vitest run` in this checkout. Do not trust stale counts in V1.5 docs.

## ARCHITECTURE

See [docs/architecture.md](./docs/architecture.md) and [docs/V1.5-HANDOFF.md](./docs/V1.5-HANDOFF.md).

## SECURITY

- No wallet secrets; gitleaks in CI + `scripts/secret-scan.sh`
- Default bind 127.0.0.1; mutating POST origin/Host check
- LLM cannot override policy/risk; execution never broadcasts

## LIMITATIONS

See [docs/limitations.md](./docs/limitations.md).

## HUMAN ACTIONS

1. Review safety posture before any future LIVE design
2. Provision API keys in `.env.local` for non-demo providers
3. Set `DATABASE_URL` and apply `supabase/migrations` for durable store
4. Do **not** enable live broadcast without independent security review

---

**Mode:** PAPER · LIVE broadcasting disabled  
**Branch:** `sentinel-v3-readiness`  
**Audit:** [docs/AUDIT-GROK.md](./docs/AUDIT-GROK.md)  
**V1.5:** [docs/V1.5-HANDOFF.md](./docs/V1.5-HANDOFF.md)
