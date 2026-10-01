# Team dashboard - QA report (visual direction v2)

Branch: `frontend/opus-shared-dashboard`. Implements `docs/frontend/TEAM_DASHBOARD_DESIGN.md` including section 11.
No API route, guard, package, worker, migration, script, manifest, lockfile, `globals.css`, `layout.tsx` or
`ResearchDashboard.tsx` file was changed. The session/data layer (`useTeamWorkspace.ts`) is unchanged.

## Changes

- Presentation rewritten: top bar + bottom tab bar, Home (computed hero, step-line chart, needs attention, key
  statistics, recent activity by day, watchlist and system sidebar), Wallet detail with wallet-scoped alert form,
  Alerts (inbox, rules, your Telegram), Setup (stepper + serif step headline, team access, change history), sign-in,
  first-run, loading and offline states.
- New pure, unit-tested modules: `derive.ts` (wallets current, hero, needs attention, system rows, day grouping,
  wallet statistics, setup stepper), `derive-alerts.ts`, `chart.ts` (points, layout, filters, nearest point),
  `rules.ts` (scoped rule creation with delete-on-failure), additions to `format.ts`.
- `useActivityFeed.ts` replaces `ActivityPanel`: one request ticket per wallet (late responses discarded), refresh on the
  15 s cycle with a 10 s floor, only while Home or a wallet is visible, cleared when the session ends.
- Fonts: Geist and Geist Mono via `next/font/google` in `fonts.ts`, applied on the team root only.
- Removed: `ActivityPanel`, `DeliveriesPanel`, `HealthStrip`, `InboxPanel`, `MonitorStats`, `RulesPanel`,
  `SetupChecklist`, `WatchlistPanel` (replaced by the views above).

## Deviations from the mockups (with reasons)

- Verification code is one input, not six boxes: the code length is not part of the API contract.
- Rotate is offered only for the other member (with confirm); rotating your own credential ends your own session,
  so the one-time value could never be shown. The username form stays for adding a member or restoring access.
- Wallet rule default name is `<short address> buy|sell` (the mockup's "Wallet buy" would collide across wallets).
- "n of 1 wallet current" uses the singular for one wallet.
- Account menu holds Sign out; the mockup showed only the button.
- Mobile search sits under the header (the top-bar search is desktop only).
- A wallet list page exists behind the Wallets tab (the mockup only shows the detail).
- Journal capacity shows an em dash when the monitor does not report it; no value is ever invented.

## Scenarios

Live stack: staging Postgres, `next dev` on 127.0.0.1:4319, providers unconfigured. 44 of 44 steps passed. 22 console
errors are expected 401s (expired or revoked sessions), 4 are 400s from invalid input, 3 are 503/1 is the simulated 500.

| Scenario | Result |
|---|---|
| Sign-in two-column page, bad credential inline error, field cleared | pass |
| Credential not in URL/storage; session cookie HttpOnly | pass |
| First-run home (zero wallets) with setup progress | pass |
| Keyboard: skip link first, nav buttons `aria-current`, account menu Escape returns focus, neon focus ring | pass |
| Wallet add: invalid address, 88-character private-key-like input warns inline, real-format address added | pass |
| Needs attention cards from real flags, card opens the right setup step | pass |
| Watchlist search and Needs attention filter | pass |
| Reviewer signs in separately and sees the shared wallet and rules | pass |
| Wallet detail from watchlist: copy, statistics, empty states | pass |
| Wallet alert: buy rule created with wallet filter (verified through `/api/state`: wallet, cooldown, trigger) | pass |
| Wallet alert: sell tab by keyboard, invalid token blocked, token filter saved | pass |
| Wallet rule switch (`role=switch`, `aria-checked`) persists | pass |
| Patch failure simulated with `page.route` (FIXTURE): the just-created rule is deleted, error shown, rule count unchanged | pass |
| Alerts: empty inbox, unverified destination warning, empty deliveries | pass |
| Rules: add, edit with dirty tracking and validation, save persists after reload, reset, switch, delete with confirm | pass |
| Alert tab keyboard navigation | pass |
| Wallet remove with cancel/confirm, return to list; re-add | pass |
| RPC: http:// rejected inline, mainnet-beta rejected by server with mapped message, unreachable https stays not configured | pass |
| Telegram: invalid token scoped error, bot stays unsaved, destination blocked without bot | pass |
| Team: third member rejected, rotate with confirm shows one-time credential then Hide, rotation signs member out | pass |
| Revoke signs member out and refuses sign-in; Restore re-enables; credential cleared from DOM after sign-out | pass |
| Recent team changes with humanized actions | pass |
| Session expiry: cleared cookie then Refresh; 15 s poll with no click | pass |
| 360 / 768 / 1440: no horizontal scroll on sign-in, home, wallets, wallet, alerts, setup; bottom tab bar only on mobile | pass |

Fixture stack (Playwright `page.route` in the screenshot script only; names contain FIXTURE): 22 of 22 passed: hero and
reason computed from the monitor, healthy state hides Needs attention, chart scrub tooltip, keyboard scrub with
announcements, All/Buys/Sells and per-wallet filters, Unclassified filter on a wallet, wallet statistics and rules,
no activity requests while Alerts is visible, inbox with suppressed reason, UNCERTAIN box and Retry anyway confirm,
FAILED retry, completed setup with an incomplete audit entry, mobile order (watchlist after chart), mobile search,
populated 360/768, first-run, loading skeleton, offline/stale banner at 390 and 1440 with exact age and greyed data.

Not exercised against real providers (none available): successful RPC verification, bot save, destination
verification, test message, real delivery retry, real activity and monitor data (the live stack has no worker, so
charts and statistics use FIXTURE data in screenshots). Contrast was checked by token choice (muted on ground and
surface is above 4.5:1), not by an automated audit.

## Checks

| Command | Result |
|---|---|
| `pnpm --filter @sat/web typecheck` | pass |
| `pnpm --filter @sat/web lint` and `pnpm lint` | pass, zero warnings |
| `pnpm build` | pass |
| `pnpm test` | pass: 36 files / 376 tests passed, 4 files / 33 skipped (database-backed, no test DB configured) |
| `pnpm test:e2e` | pass (1 test). The installed Chromium is older than the pinned Playwright expects, so a temporary symlink outside the repo mapped the expected headless-shell path; it was removed afterwards. |

## Screenshots (`artifacts/frontend-screenshots/`)

Real stack: `01` sign-in, `02` bad credentials, `03` session expired, `04` first-run home, `06` home with a wallet and
real attention cards, `07` wallet detail (empty), `08` wallet alert created, `10` alerts inbox (empty), `11` rules,
`12` setup connection, `13` RPC error, `14` team access (credential masked before capture), `15` change history,
`16` sign-in 360, `17`-`20` home, wallet, alerts, setup at 360 and 768.

FIXTURE: `09` wallet alert patch failure, `21` home populated, `22` chart scrub, `23` chart sells filter, `24` wallet
populated, `25` alerts inbox and deliveries, `26` UNCERTAIN retry confirm, `27` completed setup and audit, `28`/`29`
home at 390, `30`/`31` home and wallet at 360 and 768, `32` first run at 390, `33` loading skeleton, `34` offline/stale
at 390 and 1440.

## Notes

- Team members are hard-limited to two; there is no way to remove one, only revoke.
- `/api/team/status` returns one generic 503 for any storage failure; the UI shows that message verbatim.
- Backend test `tests/signal-provenance.test.ts` (demo wallet scores) failed in an earlier database-enabled run; it
  is unrelated to the web app and was not re-run with the database in this pass.
