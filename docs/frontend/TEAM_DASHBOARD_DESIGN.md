# Team dashboard — architecture & design spec

Scope: the shared-monitor UI rendered when `SENTINEL_TEAM_MODE=true` (`apps/web/src/app/TeamDashboard.tsx`).
Constraints come from `docs/FRONTEND_HANDOFF.md`: no API/guard/DB/worker/migration/manifest edits, no edits to
`globals.css`, `ResearchDashboard.tsx` untouched, every existing request shape preserved byte-for-byte.

## 1. Goals

1. A calm, desktop-first monitoring workspace that answers, at a glance: *Is monitoring working right now? What
   needs my attention? What happened on the wallets we watch?*
2. Every state is designed: loading, empty, populated, success, failure, stale, partial configuration, signed out,
   session expired, storage unavailable.
3. Evidence honesty: UNKNOWN = abstention, coverage = bounded recent window, no USD/performance, no sample data
   presented as live.
4. Accessible: labelled fields with hints/errors, status conveyed by text + icon (never color alone), keyboard
   tabs, visible focus rings, ≥4.5:1 text contrast, usable at 360 px wide.

## 2. Module architecture

Split the 117-line monolith into a dedicated folder. `TeamDashboard.tsx` becomes a thin composition root.

```
apps/web/src/app/TeamDashboard.tsx          // "use client"; renders <TeamWorkspace/>
apps/web/src/components/team/
  types.ts            // Member, Rule, Delivery, TeamStatus, StateSnapshot, MonitorHealth, Activity (moved verbatim + optional fields)
  api.ts              // HttpError, api<T>() (unchanged semantics), teamAction(), changeState()
  status.ts           // PURE presenters: raw status -> { tone, label, detail }  (unit-tested)
  format.ts           // PURE: shortAddress, formatAge(ms), formatTime(iso), formatQty
  useTeamWorkspace.ts // data + session hook (see §3)
  ui.tsx              // primitives: Panel, PanelHeader, StatusPill, Button, Field, TextInput, Notice, EmptyState,
                      //             Skeleton, Address (mono, truncated, full value in title + copy button), ConfirmInline
  TeamWorkspace.tsx   // shell: header, health strip, tabs, toast region; picks SignIn / loading / workspace
  SignIn.tsx
  HealthStrip.tsx     // persistent summary across all tabs
  SetupChecklist.tsx  // partial-configuration guidance (shown on Monitor tab until complete)
  WatchlistPanel.tsx
  ActivityPanel.tsx
  RulesPanel.tsx      // + RuleCard (replaces RuleEditor)
  InboxPanel.tsx
  DeliveriesPanel.tsx
  setup/ConnectionSetup.tsx  setup/TelegramBotSetup.tsx  setup/DestinationSetup.tsx
  setup/TeamAccess.tsx       setup/AuditLog.tsx
tests/team-dashboard-status.test.ts   // vitest for status.ts + format.ts
```

Rules:
- Components receive data + callbacks via props; only `TeamWorkspace` calls the hook. No context needed.
- No new dependencies. Tailwind v4 utilities only; colors via existing CSS variables
  (`bg-[var(--bg-1)]`, `border-[var(--line)]`, `text-[var(--muted)]`, `--accent`, `--good`, `--warn`, `--bad`).
  Do not touch `globals.css`. If a dashboard-only rule is unavoidable, use a CSS module beside the component.
- Keep files small (< ~200 lines). Readable, formatted code — not the current one-line-per-panel style.

## 3. Data & session layer — `useTeamWorkspace`

State:
```ts
phase: "loading" | "signedOut" | "ready" | "unavailable"
signOutReason: null | "expired" | "signedOut"      // drives the sign-in banner copy
team, state, monitor (each nullable)
errors: { state?: string; monitor?: string }        // per-source partial failures
lastSuccessAt: number | null; refreshError: string | null
pending: string | null                               // key of the in-flight action, e.g. "rule:<id>:save"
notice: { tone: "success" | "error"; text: string; scope?: string } | null
```

Behavior:
- `refresh()`: fetch `/api/team/status` first (auth gate). 401 → `signedOut` (reason `expired` if we were
  `ready`, else none). 503/network → if we already have data keep it and set `refreshError` (stale banner);
  otherwise `phase = "unavailable"` with retry. Then `Promise.allSettled([state, monitor])` so one failing source
  shows a scoped error in its panel instead of blanking the app. `/api/monitor` can return 503 with a JSON body
  containing `status: "DEGRADED"` — treat as monitor error "Monitor storage unavailable".
- Poll every 15 s; skip while `document.hidden`; refresh immediately on `visibilitychange` → visible.
- `perform(key, fn, successText)`: sets `pending=key`, clears notice, runs, refreshes, sets notice. Only the
  control with that key shows a spinner/"Saving…"; other controls are disabled only while a mutation is in
  flight (prevents double submission). Return `boolean` success so forms can clear inputs only on success.
- On any 401 or logout: clear team/state/monitor/activity, the issued one-time credential, and all secret form
  fields (credential, RPC endpoint, bot token). Nothing goes to `localStorage`, URLs or `console`.
- Error copy: the API returns codes like `DEDICATED HTTPS RPC REQUIRED`; map known codes to human sentences in
  `status.ts#describeError(code)` and fall back to the server message.

## 4. Status presenters (`status.ts`) — single source of truth for wording

Tones: `ok | warn | bad | neutral | pending`. Each pill = icon glyph + label; `detail` goes in a hint line.

| Input | Value | Tone | Label | Detail |
|---|---|---|---|---|
| monitor.status | HEALTHY | ok | Monitoring current | All watched wallets polled within 2 min |
| | DEGRADED | warn | Monitoring degraded | Some wallets stale, erroring, or alerts pending |
| | WAITING_FOR_WALLETS | neutral | No wallets yet | Add a wallet to start monitoring |
| | NOT_CONFIGURED | neutral | Monitor not configured | Journal history source is not enabled on the host |
| | fetch error | bad | Monitor unavailable | server message |
| worker.status | healthy | ok | Worker running | heartbeat Ns ago |
| | NO_HEARTBEAT | bad | No worker heartbeat | Worker not started or not reporting |
| | STALE | warn | Worker heartbeat stale | last seen N min ago |
| | other | warn | Worker: {raw} | |
| backup / backupCopy | VERIFIED / OVERDUE / FAILED / NOT_CONFIGURED | ok / warn / bad / neutral | Backup verified · Backup overdue · Backup failed · Backups not configured (copy: Off-host copy …) | last success time |
| rpcConfigured | true / false | ok / warn | RPC connected* / RPC not configured | *“Saved & verified at setup”; live capacity is the monitor status |
| telegramConfigured | true / false | ok / neutral | Bot saved / No bot | |
| wallet coverage + pollAgeMs + lastError | lastError | bad | Error | lastError |
| | no poll | pending | Waiting for first poll | |
| | age > 120 s | warn | Stale · 4m | |
| | CURRENT & fresh | ok | Current · 12s | |
| | HISTORICAL/UNKNOWN coverage | warn | Catching up / Coverage unknown | |
| delivery.status | SENT/DELIVERED | ok; PENDING/QUEUED pending; FAILED bad; UNCERTAIN warn “May have arrived”; other neutral raw |
| activity outcome | OK/TRADE | ok; FAILED bad; UNKNOWN neutral “Unclassified” + tooltip “Not proof of no trade” |
| audit outcome | completed ok; failed bad; requested (no completion) warn “Incomplete — may have been interrupted” |

Unknown raw values always render as neutral pills showing the raw value — never hide or invent.

## 5. Layout

```
┌───────────────────────────────────────────────────────────────────────────┐
│ Solana Sentinel  · Shared wallet monitor        [designer ▾]  Sign out    │  header (sticky)
│ Read-only chain access · no signing or trading                            │
├───────────────────────────────────────────────────────────────────────────┤
│ ● Monitoring current  ● Worker running  ● Backup verified  ○ Off-host copy │  HealthStrip (wraps)
│ ● RPC connected  ○ No bot        Updated 12s ago  [Refresh]               │
├───────────────────────────────────────────────────────────────────────────┤
│ [ Wallets & activity ] [ Alerts (3) ] [ Setup & team (2 to do) ]          │  tablist
├───────────────────────────────────────────────────────────────────────────┤
│ Monitor tab (lg: 12-col grid)                                             │
│  ┌ Setup checklist (only if incomplete) ─────────────────────────────────┐ │
│  ┌ Watchlist (col 7) ───────────────┐ ┌ Activity (col 5, sticky) ──────┐ │
│  │ add form                          │ │ selected wallet’s last 50 obs  │ │
│  │ table: address | status | actions │ │ or empty prompt “Select…”      │ │
│  └───────────────────────────────────┘ └────────────────────────────────┘ │
│  ┌ Monitor statistics (4 stat tiles + scope/evidence note) ─────────────┐ │
└───────────────────────────────────────────────────────────────────────────┘
```
- Alerts tab: Rules (col 7) | Inbox (col 5) stacked over Your Telegram deliveries (col 5).
- Setup tab: progress header “Setup 2 of 4 complete”; 2-col grid: Connection · Telegram bot · Your destination ·
  Team access; Recent team changes full width (table on desktop, stacked rows on mobile).
- < 768 px: single column, tabs become a horizontally scrollable segmented control, wallet table becomes cards,
  activity panel appears below the watchlist and the selected wallet scrolls into view. No horizontal page scroll.
- Max content width 1280 px, 24 px gutters (16 px mobile).

## 6. Visual language

- Surfaces: page uses the existing global gradient. Panels `bg-[var(--bg-1)]/90 border border-[var(--line)]
  rounded-lg`; inner wells `bg-[var(--bg-0)]`. No glows, no neon, no ticker clutter.
- Accent `--accent` (#3d9cf0) for primary buttons, links, focus rings (`focus-visible:ring-2 ring-[var(--accent)]
  ring-offset-2 ring-offset-[var(--bg-0)]`). Status colors only inside pills/notices.
- Type: IBM Plex Sans (already loaded) — page title `brand` serif 24–28 px; panel titles 16 px/600; body 14 px;
  meta 12 px `--muted`. Addresses, signatures, chat IDs, mints in `.mono`, truncated middle (`7xKX…9fQa`) with the
  full value in `title` and a copy button; full value wraps (`break-all`) inside activity detail.
- Buttons: primary (accent fill), secondary (outline), danger (outline `--bad`, used only for Delete/Revoke/Remove),
  ghost (Refresh). Height 36 px, min touch target 40 px on mobile.
- Numbers: `tabular-nums`. Absent values “—” with an explanation, never `0` for unknowns.

## 7. Workflow details

**Sign in** — centered card (max 400 px). Banner if `signOutReason === "expired"`: “Your session ended. Sign in
again.” Credential field `type=password`, autocomplete as today. Inline error for 401 “Those credentials were not
accepted.” and 429 “Too many attempts — wait a minute.” Pending button text “Signing in…”. Clear the credential
field on both success and failure.

**Health strip** — always visible when signed in; pills per §4; “Updated Ns ago” ticking each second; if
`refreshError` or `now − lastSuccessAt > 45 s`: warn notice “Showing data from HH:MM:SS — refresh failing:
{reason}”. Footnote: “Monitoring pauses while the host Mac is asleep or offline.”

**Setup checklist** (Monitor tab, hidden when all done): 1 RPC endpoint verified · 2 Telegram bot saved · 3 Your
destination verified · 4 At least one wallet watched. Each row: state pill + “Go to setup” button that switches tab
and focuses the matching section.

**Watchlist** — add form: field with hint “Public address only. Never paste a private key or seed phrase.”
Client-side pre-check (base58 alphabet, length 32–44) shows inline error before submitting; server remains
authoritative. Wallet row: Address, status pill (§4), “last head observation Ns ago”, lastError text in `--bad`,
actions: View activity (selected state highlighted, `aria-pressed`), Remove → ConfirmInline (“Remove wallet? Its
history is kept.” Confirm / Cancel). Empty state: “No wallets watched yet. Add a public wallet address to begin.
No sample wallets are added automatically.”

**Activity** — header: Address + “Most recent 50 observations · parser revision N”. Scope note (muted): “Bounded
recent window. Unclassified means the parser abstained — not proof that no trade happened. Reinterpretations do not
send historical alerts.” Per row: outcome pill, slot, relative time if available, explorer link (signature
truncated, `target=_blank rel=noreferrer`, “opens Solana Explorer”), reason, trade legs as `BUY 1,250.5 <mint>` —
quantity only, label “USD unavailable” once in the header. Loading skeleton while fetching; per-panel error with
retry. Clear selection if the wallet is removed.

**Rules** — “Add BUY rule” / “Add SELL rule” (create shapes unchanged). Empty state explains rules apply to future
supported, finalized activity only. RuleCard: trigger pill (BUY/SELL) + Enabled/Disabled pill; fields Name,
Cooldown (minutes, hint “0–10080; 1440 = 1 day”), Wallet filter, Token filter (both “optional — leave blank for
any”). Track dirty state: Save disabled until dirty, “Unsaved changes” hint, Reset button. Enable/Disable toggle
saves immediately. Delete → ConfirmInline. Patch payload exactly `{ name, wallet: wallet||null, mint: mint||null,
cooldownMinutes }` / `{ enabled }` as today. Rule cards re-key on server change as today so edits reset after save.

**Inbox** — newest first; title, body, time (relative + absolute in `title`), pill: Delivered to inbox (ok) or
Suppressed · {reason} (neutral). Empty: “No live alerts yet. Alerts appear when a rule matches finalized,
supported activity.”

**Your Telegram deliveries** — if destination missing/unverified: notice linking to setup. Rows: status pill,
attempts, event id (mono, truncated), last error. Retry: FAILED → single click; UNCERTAIN → ConfirmInline with warn
copy “This message may already have arrived. Check Telegram first — retrying can send a duplicate.” Confirm label
“Retry anyway”.

**Connection (RPC)** — status pill; hint lists requirements (dedicated HTTPS, Helius-compatible, not the public
mainnet-beta endpoint, no credentials in user:pass form); probe wallet field hint “An active public wallet with
recent transactions, used only to test read methods.” Pending text “Verifying with mainnet… (up to 30 s)”. Success
notice shows `probeDurationMs` and the returned `scope` sentence. Never echo the endpoint back.

**Telegram bot** — 3-step guidance list (BotFather → copy token → each member starts the bot). Token field
password-type; never displayed after save.

**Your destination** — stepper: ① Send code (chat ID, hint how to find numeric chat ID) ② Enter code ③ Verified —
Send test / Pause or Enable alerts. Disable step ① with explanation if no bot saved. Show “Alerts paused” warn pill
when verified but disabled.

**Team access** — member list (you marked “You”), Enabled/Revoked pills, Revoke → ConfirmInline (“They will be
signed out immediately and their Telegram delivery paused.”). Generate/rotate form; hint explains rotation signs the
member out. One-time credential box: warn styling, mono value, Copy button (clipboard API, “Copied” feedback),
“Shown once. It disappears when you hide it, sign out or your session expires.” Hide button.

**Recent team changes** — up to 20 entries: time, member (“Host setup” fallback), action humanized
(`verify-destination` → “Verify destination”), outcome pill per §4.

## 8. Accessibility checklist

- Tabs: `role=tablist/tab/tabpanel`, `aria-selected`, `aria-controls`, Left/Right/Home/End keys.
- Every input has a `<label>`, hint via `aria-describedby`, errors via `aria-invalid` + described error text.
- Global notices: success `role=status` (polite), errors `role=alert`. Auto-dismiss success after 5 s; errors stay
  until dismissed or next action.
- Pending buttons keep width and use `aria-busy`.
- Respect `prefers-reduced-motion` (no pulsing when reduced).

## 9. Metadata

`layout.tsx`: keep titles; add `export const viewport = { themeColor: "#0c1117", colorScheme: "dark" }` only if it
does not alter the research dashboard’s behavior (it is purely a meta tag — acceptable).

## 10. Verification plan

- `pnpm --filter @sat/web typecheck`, `pnpm --filter @sat/web lint`, `pnpm build`, `pnpm test` (incl. new
  `tests/team-dashboard-status.test.ts`), `pnpm test:e2e` (existing research demo flow must still pass).
- Live isolated stack (staging Postgres on 55432, `next dev` on 4319, team mode, providers unconfigured): sign in as
  `designer` and `reviewer`, add/remove wallet, create/edit/toggle/delete rules, rotate and revoke credentials,
  expire a session (delete `sentinel_session` cookie → next poll shows “session ended”), invalid RPC/bot input
  errors, 360/768/1440 px widths.
- Screenshots: real stack for empty / unconfigured / signed-out / expired / error states. Populated
  activity/inbox/delivery views may use Playwright `page.route` fixtures **only inside the screenshot script (not
  the app)**, and every such screenshot file name and caption must contain `FIXTURE`.
