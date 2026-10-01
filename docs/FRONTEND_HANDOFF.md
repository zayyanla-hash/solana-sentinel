# Opus frontend handoff — Solana Sentinel shared Mac release

Implement a polished frontend for the existing shared wallet-monitoring app. This is a frontend improvement task, not a new product or a trading interface.

## Starting point and isolation

Repository: https://github.com/zayyanla-hash/solana-sentinel.git

The implementation checkout is `/Users/farhanfaisal/Documents/Codex/2026-09-30/solana-sentinel-hardening`. Use a separate branch/worktree from the checkpoint supplied with this handoff. Do not modify the active checkout or its running service snapshots. The backend/release work is continuing concurrently.

Own `apps/web/src/app/TeamDashboard.tsx` and new components/styles dedicated to that dashboard. You may improve its metadata in `apps/web/src/app/layout.tsx`, but coordinate before editing shared global styles. Keep the separate `ResearchDashboard.tsx` behavior intact. Do not edit API routes, request guards, database packages, parser, worker, delivery system, migrations, release scripts, or dependency manifests without identifying a concrete blocker first.

## Product and visual direction

Two equal team members share watched wallets and alert rules. One Mac runs the application; both use it privately. Design an excellent desktop-first monitoring workspace, with a usable narrow layout, clear typography, restrained color, strong information hierarchy and accessible forms. Avoid decorative trading-terminal clutter, invented metrics and financial-performance promises. Improve empty, loading, success, failure, stale and partial-configuration states as carefully as populated views.

Preserve these workflows:

- Personal sign-in and sign-out, without exposing credentials in URLs, localStorage or logs.
- Shared watchlist add/remove and recent transaction activity.
- Monitor freshness, catch-up coverage, unsupported outcomes, worker status, backup status and off-host copy status.
- Create BUY/SELL rules; edit names, wallet/token filters and cooldowns; enable, disable and delete.
- Shared inbox and each member's private Telegram delivery list. An uncertain send can already have arrived: warn before manual retry.
- Setup for a dedicated Helius-compatible HTTPS RPC endpoint, shared Telegram bot and individually verified destinations.
- Two equal member accounts, credential rotation/revocation and recent change history. One-time credentials must disappear after logout/session expiry.

## Existing API contract

Use same-origin requests and browser-managed HttpOnly session cookies. Never replace this with a shared bearer token.

- `GET /api/state`: live watchlist, live alertRules, live alertEvents, monitorOnly.
- `POST /api/state`: watchlist_add (`kind: WALLET`, address), watchlist_remove (id), alert_create (name, supported trigger).
- `GET /api/monitor`: status, scope, statistics, wallet coverage/freshness, worker, backup and backupCopy health.
- `GET /api/team/status`: current member, member list, configured flags, that member's destination and deliveries, recent audit entries. Secrets are never returned.
- `GET /api/team/activity?wallet=...`: latest 50 observations, parser revision and supported trade legs.
- `POST /api/team/login`: username, credential. `logout`: empty object.
- Team POST actions: rpc, telegram, destination, verify-destination, destination-enabled, test-destination, member, revoke, rule, delete-rule, retry-delivery. Read the existing component and routes for exact request shapes; preserve them.

Requests that change state must originate from the configured exact origin. Missing/expired credentials require sign-in. Failed configuration must not appear connected; waiting for RPC, missing backups and stale monitoring are distinct states.

## Evidence boundaries

Only finalized transactions in supported parser shapes become BUY/SELL alerts. UNKNOWN is abstention, not proof of no trade. Coverage is a bounded recent window, not complete lifetime history or all token-account activity. Show absent USD prices as unavailable, never zero-valued performance. The app never signs, broadcasts, executes or promises profitable trades. Do not show sample data as live. RPC, Telegram and remote access may remain unconfigured in the host installation.

## Verification and delivery

Use a separate test port and isolated test database; do not repurpose the host's production database or credentials. The host app on port 4318 is for read-only visual reference unless the user explicitly configures it. The existing QA setup on 4319 is temporary and may be stopped by the release task.

Run web typecheck, lint and build. Exercise both members' sign-in, shared wallet/rule updates, credential expiry, alert states, setup validation and narrow-screen usability. Preserve the existing demo/paper end-to-end test. Include screenshots and a concise list of changes, tested scenarios and any backend blockers. Return a reviewable frontend branch/PR; do not deploy it over the running release or merge it automatically.
