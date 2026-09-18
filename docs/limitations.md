# Limitations

- Default data path is DEMO unless API keys provided
- Without `DATABASE_URL`, persistence is in-memory and resets on process restart; Next.js multi-worker memory split still applies
- With `DATABASE_URL`, runtime uses Postgres JSONB store (`health.persistence = "postgres"`). Verified against local PostgreSQL 16 in this environment; do not assume a hosted Supabase project is wired unless you set the URL and apply migrations
- Historical signals require enough OHLCV bars; missing windows yield `INSUFFICIENT_DATA` / reduced confidence. DEMO OHLCV is deterministic simulated history, labeled via `isDemo`
- Jupiter `/execute`, `/submit`, and `/swap` build-and-send are intentionally not used. Swap API V2 `GET /order` is quote/route only. Ultra is superseded and not called. Missing Jupiter keys use the labeled DEMO provider; live quote failures do not silently become demo quotes.
- Helius Token-2022 decode covers `mint_extensions` keys when DAS returns them; missing `mint_extensions` on Token-2022 stays null/UNKNOWN, not “no extensions”
- Holder concentration uses `getTokenLargestAccounts` (top 20) + `getTokenSupply`; failure → null, not a fake-clean distribution
- Helius `getAsset` failure on non-demo mints yields `UNKNOWN`/null authorities rather than a fake clean profile
- `READ_ONLY` blocks paper fills; dashboard paper-trade is disabled in that mode
- Local `/api/state` GET is read-only except public-demo empty-state seed. Mutations are POST. Default bind is `127.0.0.1:4317`. Remote bind (`0.0.0.0`) requires `SAT_API_TOKEN` plus `SAT_ALLOWED_ORIGINS`. `PUBLIC_DEMO=true` rejects anonymous mutations with `PUBLIC_DEMO_READONLY`.
- Unknown mint/freeze/program on-chain data forces token-risk `INSUFFICIENT_DATA` even when market liquidity looks rich
- Portfolio-risk is re-evaluated at paper execute; proposals expire after 15 minutes
- Paper fill is a single store unit-of-work (at most one order per consumed proposal)
- Experiment metrics with fewer than 10 equity points are hidden as **INSUFFICIENT HISTORY** — no sine-wave stand-in
- No claim of profitable live performance, complete rug detection, or Shariah certification
