# Adversarial audit — SAT Research (Grok 4.6)

Historical V1 audit. Product is now branded Solana Sentinel.

Date: 2026-09-08  
Auditor branch: `cursor/audit-safety-gates-d1d1`  
Base at start of this pass: `cursor/final-qa-fixes-6a3e` @ `f7e5bec` (prior QA already hard-disabled `isLiveTradingAllowed()`).  
Demo: `http://localhost:4317` (Next.js still running during audit).

## Verdict

Paper/DEMO research platform is **not** a live trading system. No `sendTransaction`, no Jupiter `POST /swap` submit, no wallet/seed handling. Several **high-confidence safety and honesty bugs** existed in the paper path and Helius adapter; those are fixed on this branch. Residual risk is mainly unauthenticated local API, stub package lint, unwired Postgres, and incomplete on-chain decode.

## Verification actually run

| Check | Result |
|-------|--------|
| `pnpm exec vitest run` | **36 passed** (5 files) |
| `pnpm run typecheck` | **pass** (workspace) |
| `pnpm --filter @sat/web run lint` | **pass** (`--max-warnings 0`) |
| `pnpm --filter @sat/web run build` | **pass** (Next.js 16.3.4) |
| `bash scripts/secret-scan.sh` | **clean** (pattern scan only) |
| `GET /api/state` | HTTP 200; `liveTradingAllowed: false`; `canBroadcast: false`; 8 DEMO candidates; SCAMX `REJECTED` / `HIGH_RISK` / `REJECT` |
| `POST paper_execute` (WIF) | `FILLED`, `canBroadcast: false`; second call **400 already paper-executed**; SCAMX **400 rejected** |

Did **not** run Playwright. Dashboard HTML serves `DEMO / PAPER ONLY`; paper-execute verified via API against the live process (client buttons are JS).

Official API spot-check: Jupiter `GET /swap/v1/quote` is real (v1 is legacy vs v2). Helius DAS `getAsset` + `showFungible` is real. Birdeye `/defi/token_trending` + `/defi/token_overview` are real; adapter was missing `x-chain: solana` (now added; docs say default is solana).

---

## Findings

### High

| ID | Finding | Status |
|----|---------|--------|
| H1 | `InMemoryDatabase.addProposal` **unshifted duplicates**. `getState()` returns `structuredClone`, so `executePaperProposal` mutated a clone and inserted a second row with the same id. UI `find()` hit `ACCEPTED_PAPER` first but the original `PROPOSED` remained; **the same proposal could be paper-filled repeatedly**. | **Fixed** — upsert-by-id; reject `ACCEPTED_PAPER`; only consume proposal on `FILLED`/`PARTIAL`. |
| H2 | README promised `READ_ONLY` = research without paper fills. `executePaperProposal` **never checked mode**. Dashboard button stayed enabled. | **Fixed** — throws in `READ_ONLY`; UI disables paper-trade. |
| H3 | `HeliusOnChainProvider` catch path called `DemoOnChainProvider`, which returns a **synthetic clean** profile (mint/freeze revoked, 28% concentration) for any non-SCAMX mint. With `HELIUS_API_KEY` set and RPC failure, **real unknown tokens would look LOWER_RISK**. | **Fixed** — unknown mints get null/UNKNOWN inputs (→ `INSUFFICIENT_DATA` / reject path). Demo list only uses demo profiles. |
| H4 | Helius parsed `authorities[].type` for mint/freeze. DAS `getAsset` puts authorities on **`token_info.mint_authority` / `freeze_authority`**. Live Helius would often report **no mint authority when one exists**, understating token risk. | **Fixed** — read `token_info`; treat missing as `null` not `false`. |

### Medium

| ID | Finding | Status |
|----|---------|--------|
| M1 | Jupiter `plan()` notes always claimed a live Jupiter quote even when `quote.isDemo === true` (silent lite-API fallback). | **Fixed** — DEMO notes when `isDemo`. |
| M2 | Failed/stale paper fills still marked `ACCEPTED_PAPER` (would lock retries after H1 upsert). | **Fixed** — only consume on fill. |
| M3 | Token-risk test named “INSUFFICIENT_DATA” accepted **any** tier. SCAMX pipeline test used OR across gates. Paper-execute test accepted **all** order statuses including `FAILED` (3% RNG). | **Fixed** — assertions tightened; fill retried; re-execute asserted. |
| M4 | CI typechecked only 4 packages while HANDOFF claimed full typecheck. | **Fixed** — `pnpm run typecheck` in CI. |
| M5 | `/api/state` is **unauthenticated** and the demo server binds `0.0.0.0:4317`. Anyone who can reach the port can reset/paper-trade. | **Documented** in SECURITY.md / threat-model. Not adding auth in this pass (local demo). |
| M6 | Package `lint` scripts are `echo "lint ok"` except `@sat/web`. CI only lints web. | **Residual** — do not treat workspace `pnpm lint` as real. |
| M7 | `secret-scan.sh` is a few regexes and **ignores `*.md`**. `.gitleaks.toml` allowlists docs. Not a substitute for gitleaks in CI. | **Residual** |
| M8 | HANDOFF “V1 COMPLETE” / “29 then 31 tests” overclaimed vs unwired Postgres, stub lint, snapshot signals. | **Tonered down** in HANDOFF. |
| M9 | Jupiter Swap **v1** is the documented legacy quote path; v2 (`/swap/v2/order`) is current. Quote-only use is still valid; do not treat this as a hallucinated URL. | **Residual** — migrate when going beyond quotes. |

### Low

| ID | Finding | Status |
|----|---------|--------|
| L1 | shadcn `Button`/`Badge` unused; dashboard uses raw buttons + `Pill`. | Residual |
| L2 | API action `discover` has no dashboard button (research pass covers discovery). | Residual |
| L3 | SCAMX mint is Solana **System Program** `1111…11` (valid base58, odd choice). | Residual |
| L4 | Relative-strength signal uses a hardcoded +2% “benchmark”, not live SOL. | Residual |
| L5 | Experiment UI can plot a **synthetic sine-wave** equity path when history &lt; 10 points; notes say not live. Sparkline uses real NAV history (often flat). Easy to misread vs strategy (demo) %. | Residual — labeled |
| L6 | Next.js in-memory singleton can split across workers in production; documented memory store. | Residual |
| L7 | LLM injection guard is a short regex list; model cannot call execute, but a keyed OpenAI path can still emit high `confidence` (5% score weight). Policy/risk/token-risk remain authoritative. | Residual — acceptable for V1 |
| L8 | No Playwright smoke in CI (roadmap). | Residual |

## What was already solid (not over-claimed here)

- `ExecutionPlanSchema.canBroadcast` is `z.literal(false)`.
- `getOperatingMode()` remaps `LIVE` → `PAPER`.
- Prior QA (`f7e5bec`): `isLiveTradingAllowed()` **always returns false**; tests cover unlock env trio.
- No private keys in client; `.env` gitignored; LLM prompts do not include API keys.
- Policy/risk/token-risk are deterministic; pipeline rejects HIGH_RISK / INSUFFICIENT_DATA / policy not APPROVED before paper fill (now also re-checked at execute).
- Demo candidates carry `isDemo: true`; UI banner is explicit.
- Zod rejects malformed mints.

## What I fixed (this branch)

1. Proposal upsert + block re-execute + do not consume on FAILED/STALE.
2. `READ_ONLY` execute gate + UI disable for READ_ONLY / ACCEPTED_PAPER.
3. Token-risk re-check on paper execute.
4. Helius `token_info` authority mapping; unknown-mint fallback is UNKNOWN/nulls.
5. Demo on-chain provider: unknown mints no longer get a fake clean profile.
6. Jupiter plan notes distinguish demo fallback quotes.
7. Birdeye `x-chain: solana` header.
8. Health reports `isLiveTradingAllowed()` + `canBroadcast: false`.
9. Tests: 31 → **36**; meaningful SCAMX / INSUFFICIENT_DATA / re-execute / READ_ONLY / Helius parse.
10. CI full typecheck; SECURITY / threat-model / limitations / architecture / HANDOFF honesty.

## Residual risks / next actions

1. **Do not expose `:4317` on an untrusted network** without auth (or bind localhost).
2. Wire `DATABASE_URL` to Postgres or keep labeling memory reset — migration exists, runtime ignores it.
3. Replace package `echo` lint with real ESLint or drop the scripts; run gitleaks in CI.
4. If using Helius for real tokens: still missing holder concentration, Token-2022 permanent delegate / transfer hooks → those stay `null` (safer than fake-clean, but incomplete).
5. If using Birdeye: confirm plan-tier response shapes; silent demo fallback of the **whole list** is labeled `isDemo` but can surprise operators who think the key is live.
6. Add Playwright: load `/`, research pass, reject SCAMX, paper-trade an APPROVED mint, assert `canBroadcast` false and DEMO banner.
7. Keep live broadcast unimplemented until independent review; do not “flip” `isLiveTradingAllowed()`.

## Adapter honesty

| Adapter | Invented? | Notes |
|---------|-----------|--------|
| Jupiter lite `/swap/v1/quote` | No | Quote-only; `/swap` not used for submit |
| Helius `getAsset` | No | Field mapping was wrong; now aligned with DAS `token_info` |
| Birdeye trending/overview | No | Added `x-chain` |
| OpenAI `/v1/chat/completions` | No | Mock default |
| Demo market / on-chain / research | Labeled | `isDemo` / MOCK LLM / DEMO banner |
