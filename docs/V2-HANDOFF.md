# V2 HANDOFF — Solana Sentinel

Iterative improvement on V1.5. Not a rewrite. Live broadcast remains disabled.

## What V2 adds

- Product naming: Solana Sentinel (SAT remains internal package scope)
- PUBLIC_DEMO read-only API + UI mutation hiding
- Jupiter Swap API v2 GET /order quote/route with v1 /quote fallback
- Hosted Postgres TLS detection for Supabase-style URLs
- Health fields: providers, persistence, publicDemo, last runs
- Experiment equal-weight baseline + hit-rate / avg gain-loss when sample allows
- Research brief length bounds and extra injection patterns
- Documentation aligned to main

## What did not change

- isLiveTradingAllowed() === false
- canBroadcast literal false
- Token-risk / policy / portfolio-risk authority
- In-memory fallback when DATABASE_URL is absent
- DEMO adapters labeled

## Human actions still required

1. Hosted DATABASE_URL
2. Birdeye API key
3. Helius API key
4. Optional OpenAI-compatible key
5. Optional Jupiter API key
6. Vercel + PUBLIC_DEMO=true + SAT_API_TOKEN + SAT_ALLOWED_ORIGINS
