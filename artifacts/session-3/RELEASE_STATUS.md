# Shared Mac release verification

The shared monitoring release is installed on the previous host Mac; migration to the collaborator’s Mac is pending. It is a release candidate pending external setup and two-Mac acceptance, not a fully operational shared deployment.

## Verified locally

- Full repository validation: 409 tests in 40 files, with PostgreSQL integration tests enabled; typecheck, lint, production builds and basic secret scan passed.
- Existing Playwright demo/paper regression: one Chromium test passed.
- Mac tooling: five PostgreSQL-backed Python tests passed on isolated ports while production remained running, including restored data hashes, archive tamper detection, release snapshot isolation, service environment configuration and bounded child-process shutdown.
- Real launchd installation: PostgreSQL and dashboard reachable; worker remains in `waiting-for-rpc` with no fabricated collection. Fixed the explicit locale and executable PATH needed by launchd.
- Two distinct member accounts were provisioned locally; credentials reside in mode-0600 private files outside the repository. No credentials are in this report.
- Shared browser QA against an isolated database: separate member sign-ins, shared wallet creation, rule name/cooldown editing, disable/enable, second-member visibility, revocation, recent activity empty state and configuration screens. This used one Mac/browser, not two physical Macs.
- Real production database backup restored into a disposable database and compared to its saved fingerprint manifest; 32 initialized tables were included. No off-host copy is configured.
- Update and rollback were exercised between local release snapshots; member records survived. The updated frontend is installed in release snapshot `20261001T091302Z-1dac1240` after a verified 32-table backup. A Mac-specific chart import collision was fixed before this deployment.
- Read-only mainnet pilot: five minutes, ten healthy cycles, one new observation, zero alerts. This is short staging evidence, not long-term reliability or Telegram delivery proof.
- Route-specific mainnet evidence: see MAINNET_VALIDATION.md. A fresh labeled sample matched ten of eleven directional cases; the remaining BUY safely abstained. The failed case was correctly identified. No general accuracy claim.

## Remaining acceptance gates

- Enter the dedicated Helius HTTPS RPC endpoint in protected Setup and pass the connection probe. Having an integration elsewhere does not establish this worker's configured credentials or capacity.
- Create/configure the shared Telegram bot and verify each member's destination. No real Telegram message has been sent during verification; transport and queue failures were tested with controlled responses.
- The previous host has private Tailscale HTTPS Serve, an exact origin, and an HTTPS-only access policy for the two intended identities. Independent app logins over HTTPS, secure cookies, logout and rejected old-origin mutations were verified on that Mac. The collaborator’s exact Tailscale identity was approved; no device was registered under it at the latest check. New-host enrollment, Serve and both physical Mac checks remain pending.
- Configure off-host backup copying and restore from a copied backup.
- Verify both actual Macs can log in and receive a real supported live transaction alert; run a sustained production pilot and report its actual duration.
- The merged frontend and shared-release PR checks passed. PR #4’s checkpoint `59877ec` passed all three hosted checks. The follow-up changes below remain reviewable and have not been installed into the running services.

No wallet keys are required or requested. The app does not sign, broadcast or execute transactions. Jupiter quoting/routing remains separate from monitoring.

## Follow-up recovery and capacity fixes

- Local validation of the follow-up source: 421 tests in 41 files passed with disposable PostgreSQL integration enabled; typecheck, lint, complete production builds and basic secret scan passed.
- Six PostgreSQL-backed Mac tooling tests passed. Backups now include a private, checksummed recovery configuration sidecar alongside the database archive and fingerprint manifest. Checks reject sidecar tampering and broad permissions before restoration, preserve the previous archive when the encryption key changes mid-backup, verify all three files in the copy workflow, and explicitly distinguish legacy database-only backups.
- The root font families and their licenses are bundled from a pinned upstream revision, preserving the existing families while removing build-time Google font downloads.
- Monitoring status and the shared dashboard report physical filesystem capacity, warn below 5 GiB or 10% available, and keep unknown capacity visible. Shared monitoring cannot report healthy with low or unknown capacity. Evidence is never automatically deleted by these warnings.
- These changes were tested against staging and temporary isolated Mac databases. The installed release, production settings and database were not changed. An update and a new complete backup are required before the installed runtime gains these fixes.

No real Telegram delivery, second-Mac acceptance, off-host restoration or sustained live monitoring was added by these checks.

## Upstream integration follow-up

Upstream PR #5 renamed the same chart module as the Mac-build fix in this release branch. The integration retains upstream `chart-model.ts`, removes the duplicate module, and preserves the recovery, capacity and isolated database-test changes. The combined source passed 421 tests in 41 files with disposable PostgreSQL integration, typecheck, lint, complete production builds and basic secret scanning. The previous running installation was not updated.
