# Resume / project notes (honest)

## Claims you can make

- Built Solana Sentinel, a monorepo Solana **research** platform with discovery → historical/snapshot signals → token-risk → policy → portfolio risk → Jupiter quote planning → paper execution → experiments
- Emphasized safety gates, provenance, and explainability
- Implemented provider pattern with DEMO fallbacks
- Added Postgres persistence when `DATABASE_URL` is set, with labeled in-memory fallback
- Paper fills are a transactional unit-of-work (at most one fill per proposal) with execute-time portfolio-risk re-evaluation
- Required on-chain fields missing force `INSUFFICIENT_DATA` (no “unknown authorities + rich liquidity = lower risk”)
- GET `/api/state` is side-effect-free; remote bind requires `SAT_API_TOKEN`

## Claims you must not make

- Live profitable trading results or verified strategy alpha
- Audited smart-contract security or complete rug/honeypot detection
- Shariah certification / fatwa / complete compliance
- Production custody or mainnet settlement
- That Token-2022 / holder risk is complete when DAS fields are null
- That workspace lint was always real before V1.5 (it was stub `echo` except `@sat/web`)

## Demo evidence

Run the dashboard and paper-execute an APPROVED proposal; show `canBroadcast=false` in the UI and execution plan, DEMO / PAPER banners, and `health.liveTradingAllowed: false`.
