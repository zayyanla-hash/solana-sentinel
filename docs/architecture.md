# Architecture

Monorepo (`pnpm` workspaces) with `apps/web` (Next.js App Router dashboard), `apps/worker` (batch research cycles), and `packages/*` domain libraries.

## Data flow

1. **Discovery** pulls trending candidates from MarketDataProvider (Birdeye if keyed, else DEMO).
2. Each candidate is Zod-validated (`CandidateAssetSchema`); malformed rows emit `TOKEN_REJECTED`.
3. **Token-risk** scores mint authorities, liquidity, concentration, age, Token-2022 flags. Helius DAS `getAsset` maps `token_info.mint_authority` / `freeze_authority` (not `authorities[].type`).
4. **Policy engine** applies spot-only / keyword / list rules → APPROVED | REJECTED | MANUAL_REVIEW.
5. **Signals** compute modular deterministic features from OHLCV when available (5m/15m/1h/optional 4h); snapshot fallback is labeled and cannot invent bars. **Scoring** blends versioned weights.
6. **Research agent** (optional LLM, else mock) synthesizes a brief; injection patterns → low confidence.
7. **Risk engine** enforces capital, exposure, drawdown, liquidity, slippage, cooldowns.
8. **Execution** requests Jupiter Swap API V2 `GET /swap/v2/order` quote/route metadata when keyed; otherwise a labeled DEMO provider. Fail-closed on live provider errors. `/execute` and `/submit` are not implemented.
8b. **Wallet intelligence** scores observed wallets with sample-size and anti-moonshot corrections. **Wallet graph** emits POSSIBLE_CLUSTER labels only. **Sentinel signals** combine credible wallets with market confirmation.
8c. **Strategy Lab / backtest** walks bars with next-open fills, costs, and optional train/validation/OOS split.
9. **Paper trading** simulates fill realism and writes provenance-rich orders/positions.
10. **Experiments** replay **observed** paper equity vs optional SOL/BTC series. Short history → INSUFFICIENT HISTORY (metrics hidden). No sine-wave stand-in.

## Persistence

`supabase/migrations` defines Postgres tables. Runtime:

- `DATABASE_URL` unset → `InMemoryDatabase` (`health.persistence = "memory"`)
- `DATABASE_URL` set → `PostgresDatabase` JSONB store (`health.persistence = "postgres"`), source of truth across Next workers

## Safety

`getOperatingMode()` remaps `LIVE` → `PAPER`. `READ_ONLY` blocks paper execution. Execution plans set `canBroadcast: false`. `isLiveTradingAllowed()` is hard-false. `PUBLIC_DEMO=true` makes anonymous POSTs read-only; operator mutations require `SAT_API_TOKEN`. Default HTTP bind is loopback.
