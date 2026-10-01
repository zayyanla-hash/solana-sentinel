# Shared Mac release verification

The shared monitoring release is installed on the designated Mac. It is a release candidate pending external setup and two-Mac acceptance, not a fully operational shared deployment.

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
- Enroll both Macs in Tailscale; restrict access to the two members and configure the exact private HTTPS origin. Tailscale is installed and this host is enrolled. Serve activation, access-policy restriction and collaborator enrollment remain pending.
- Configure off-host backup copying and restore from a copied backup.
- Verify both actual Macs can log in and receive a real supported live transaction alert; run a sustained production pilot and report its actual duration.
- The merged frontend and shared-release PR checks passed. Mac-specific follow-up fixes are in PR #4; its latest hosted checks are pending at this checkpoint.

No wallet keys are required or requested. The app does not sign, broadcast or execute transactions. Jupiter quoting/routing remains separate from monitoring.
