# Team dashboard - QA report

Branch: `frontend/opus-shared-dashboard`. Implements `docs/frontend/TEAM_DASHBOARD_DESIGN.md`.
No API route, guard, package, worker, migration, script, manifest or `globals.css` file was changed.

## Changes

- `TeamDashboard.tsx` is now a thin root rendering `components/team/TeamWorkspace.tsx`.
- New `apps/web/src/components/team/`: `types`, `api`, `status` (pure presenters, error mapping, setup progress,
  audit collapsing), `format`, `useTeamWorkspace` (session/data hook), `ui` primitives, `SignIn`, `HealthStrip`,
  `SetupChecklist`, `WatchlistPanel`, `ActivityPanel`, `MonitorStats`, `RulesPanel`, `InboxPanel`,
  `DeliveriesPanel`, and `setup/{ConnectionSetup,TelegramBotSetup,DestinationSetup,TeamAccess,AuditLog}`.
- Session handling: 15 s poll (paused while hidden, immediate on tab focus), per-source partial failures, stale-data
  banner, "session ended" sign-in on 401, secrets/one-time credential cleared on logout and expiry, nothing in
  storage, URLs or console.
- Confirmations for wallet removal, rule deletion, member revocation and retrying an UNCERTAIN delivery.
- `layout.tsx`: added `viewport` (theme colour, dark colour scheme). Metadata titles unchanged.
- `tests/team-dashboard-status.test.ts`: 16 unit tests for status presenters and formatters.

## Deviations from the spec (with reasons)

- `CLASSIFIED` activity outcome is presented as a success pill ("Classified trade"); the ingestion store emits it
  and the spec only listed OK/TRADE. SENDING/RETRYING deliveries are shown as pending.
- Audit log hides a "requested" entry once a matching completed/failed entry exists (the server writes both for
  every change); only unresolved requests read "Incomplete". The spec's table implied this ("requested, no completion").
- Added `MonitorStats.tsx`, not in the spec's file list, for the statistics tiles.
- Client-side pre-check rejects RPC endpoints that do not start with `https://` (inline error). The server remains
  authoritative and its `DEDICATED_HTTPS_RPC_REQUIRED` error is mapped to a sentence (tested with the mainnet-beta URL).
- The username `pattern` attribute is written `[a-z0-9][a-z0-9_\-]{1,39}`: the original unescaped form is an invalid
  regular expression under the browser's `v` flag and was silently ignored.
- Sign out is never blocked by an in-flight action (found during QA: it was silently ignored mid-action). If the
  logout request fails for any reason other than an already-ended session (401), the workspace stays signed in and
  shows an error, because the session cookie is still valid.
- No new dependency; "[designer v]" in the header is a plain label (no menu).

## Scenarios (live stack: staging Postgres, `next dev` on 127.0.0.1:4319, providers unconfigured)

All 37 steps of the Playwright run passed (script kept outside the repo).

| Scenario | Result |
|---|---|
| Sign-in page, bad credential inline error, field cleared | pass |
| Designer sign-in; no credential in URL/localStorage/sessionStorage; session cookie HttpOnly | pass |
| Reviewer signs in in a separate context and sees the shared wallet and rules | pass |
| Monitor empty/unconfigured state, setup checklist, empty activity prompt | pass |
| Tab keyboard navigation (Right, End, Home) | pass |
| Wallet add: invalid address blocked inline; real-format address added; input cleared | pass |
| Wallet "waiting for first poll" with no RPC; View activity (empty) with `aria-pressed` | pass |
| Wallet remove with confirm/cancel; selection cleared | pass |
| Create BUY and SELL rules | pass |
| Edit name, cooldown, wallet and token filters; dirty tracking; invalid values block save; persists after reload; Reset | pass |
| Disable / enable rule; delete rule with confirm | pass |
| Empty inbox, unverified-destination warning, empty deliveries | pass |
| RPC `http://` rejected inline; mainnet-beta rejected by server with mapped message; unreachable https shows a server error and RPC stays "not configured" | pass |
| Invalid bot token shows a scoped error; bot stays "No bot"; destination form disabled without a bot | pass |
| Third member rejected with the two-member limit message | pass |
| One-time credential box shown, hidden on request | pass |
| Rotation signs the other member out; new credential works | pass |
| Revoke signs the member out immediately; sign-in refused afterwards; rotation re-enables | pass |
| One-time credential not in the DOM after sign-out and sign-in | pass |
| Session expiry: cookie cleared then Refresh shows "Your session ended" | pass |
| Session expiry detected by the 15 s poll with no interaction | pass |
| Login rate limit (30 per 5 min, global) shows "Too many attempts" (hit incidentally; not screenshotted) | pass |
| 360 / 768 / 1440 widths: no horizontal page scroll on sign-in, monitor, alerts, setup | pass |

Browser console showed only the expected 400/401 resource errors from the deliberate invalid/expired requests.
Not exercised against real providers (no RPC/Telegram available): successful RPC verification, bot save,
destination verification, test message, real delivery retry. Their copy is covered only by code review and the
FIXTURE screenshots.

## Checks

| Command | Result |
|---|---|
| `pnpm --filter @sat/web typecheck` | pass |
| `pnpm --filter @sat/web lint` (and root `pnpm lint`) | pass, zero warnings |
| `pnpm build` | pass |
| `pnpm test` | pass: 36 files / 355 tests passed, 4 files / 33 skipped (database-backed, no test DB configured) |
| `pnpm test` with `.env.staging.local` loaded (database tests enabled) | 39 files passed, 1 failed: `tests/signal-provenance.test.ts` "does not return or persist demo wallet scores in live-only state". Backend test unrelated to the web app; not investigated further. |
| `pnpm test:e2e` | pass (1 test). The installed Chromium is older than the pinned Playwright expects, so a temporary symlink outside the repo mapped the expected headless-shell path to the installed one. |

## Screenshots (`artifacts/frontend-screenshots/`)

Real stack: `01` sign-in, `02` bad credentials, `03` session-expired sign-in, `04`/`05` monitor empty at 1440/360,
`06` monitor with a wallet (waiting for first poll), `07` empty activity, `08` alerts empty, `09` alerts with rules,
`10` setup, `11` error notice (RPC rejected by server), `12` team access with one-time credential (value replaced
before capture), `13` setup with change history, `14` sign-in 360, `15`/`16`/`17` monitor-activity, alerts and setup
at 360 and 768.

FIXTURE (Playwright `page.route` responses inside the screenshot script only; not real data):
`20` populated monitor and activity, `21` inbox and deliveries, `22` UNCERTAIN retry warning, `23` completed setup
with change history including an incomplete request, `24` populated monitor at 360, `25` stale-data banner from a
simulated network failure.

## Backend blockers / notes

- None blocking. Note: team members are hard-limited to two; there is no way to remove a member, only revoke.
- `/api/team/status` returns one generic 503 for any storage failure; the UI shows that message verbatim.
