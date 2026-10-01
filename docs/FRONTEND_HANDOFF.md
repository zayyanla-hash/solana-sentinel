# Opus frontend handoff — Solana Sentinel shared Mac release

Implement a polished frontend for the existing shared wallet-monitoring app. This is a frontend improvement task, not a new product or a trading interface.

## Starting point and isolation

Repository: https://github.com/zayyanla-hash/solana-sentinel.git

The source branch is `release/shared-mac-20261001`, with backend checkpoint `ceb1099` and draft PR https://github.com/zayyanla-hash/solana-sentinel/pull/1. Clone this branch on your own computer; `main` does not yet contain the shared release. No files from the host Mac are needed. Repository access is required if GitHub prompts for authentication.

```sh
git clone --branch release/shared-mac-20261001 https://github.com/zayyanla-hash/solana-sentinel.git
cd solana-sentinel
git switch -c frontend/opus-shared-dashboard
```

The backend/release work continues concurrently on the release branch. Keep frontend commits on your own branch, and target a frontend PR at `release/shared-mac-20261001`. Do not push frontend changes directly to the release branch or merge/deploy automatically. Fetch and incorporate later backend changes deliberately; never overwrite either history.

## Development setup on another computer

Use Node 22 LTS, Python 3, pnpm 10.33.3 and PostgreSQL 17 binaries. On macOS with Homebrew, install PostgreSQL with `brew install postgresql@17`, then set `SENTINEL_PG_BIN="$(brew --prefix postgresql@17)/bin"` with `export`. On other systems set that variable to your installed PostgreSQL binary directory. The development script starts its own database on loopback port 55432; do not start a second global PostgreSQL service on that port.

```sh
pnpm install --frozen-lockfile
pnpm staging:start
pnpm -r --filter='./packages/*' run build
```

Create a private frontend configuration from the generated local staging configuration. Run this once in your fresh clone. It intentionally leaves provider integrations unconfigured, so no paid RPC, Telegram bot, Tailscale enrollment or host credentials are needed to improve the interface.

```sh
python3 - <<'PYCONFIG'
from pathlib import Path
import secrets
source = dict(line.split('=', 1) for line in Path('.env.staging.local').read_text().splitlines() if '=' in line)
source.update({
    'SENTINEL_TEAM_MODE': 'true',
    'SENTINEL_MONITOR_ONLY': 'true',
    'SAT_PUBLIC_ORIGIN': 'http://127.0.0.1:4319',
    'SAT_ALLOWED_ORIGINS': 'http://127.0.0.1:4319',
    'SAT_CONFIG_KEY': secrets.token_hex(32),
    'PUBLIC_DEMO': 'false',
    'DEMO_MODE': 'false',
    'SOLANA_RPC_URL': '',
    'SENTINEL_MONITOR_WALLETS': '',
})
with Path('.env.frontend.local').open('x', opener=lambda path, flags: __import__('os').open(path, flags, 0o600)) as output:
    output.write('\n'.join(f'{key}={value}' for key, value in source.items()) + '\n')
PYCONFIG
node --env-file=.env.frontend.local --import tsx scripts/team-admin.ts add designer --generate "$PWD/runtime-history/designer-credential"
node --env-file=.env.frontend.local --import tsx scripts/team-admin.ts add reviewer --generate "$PWD/runtime-history/reviewer-credential"
node --env-file=.env.frontend.local apps/web/node_modules/next/dist/bin/next dev apps/web -H 127.0.0.1 -p 4319
```

Open `http://127.0.0.1:4319` and sign in with `designer` or `reviewer`, using the corresponding private credential file. Use ego-lite for all browser work. Do not paste credentials into chat, screenshots, commits or logs. The ignored `.env.frontend.local` and `runtime-history/` files belong only to this development clone. A missing worker or provider should appear unavailable; that is an expected development state. Populated delivery and activity views require explicitly labeled development fixtures or separate test integrations; never fabricate live results. Stop the web process before `pnpm staging:stop` when finished.

For verification:

```sh
pnpm --filter @sat/web typecheck
pnpm --filter @sat/web lint
pnpm build
pnpm test:e2e
```

A fresh clone needs Playwright's Chromium installed for the automated end-to-end suite (`pnpm exec playwright install chromium`). Manual browser work still uses ego-lite. Include any failed or unrun checks in the handoff.

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
