# Shared Mac release

Solana Sentinel runs on one designated Mac. PostgreSQL, the dashboard, and one monitoring worker run on that Mac; two members use one shared watchlist and alert workspace. This release only reads finalized Solana transactions and sends alerts. Keep the host awake and connected when monitoring matters: collection stops while it sleeps, then resumes from the saved cursor after waking. A provider that prunes history before catch-up finishes can leave an explicit coverage gap.

The production database and credentials live under `~/Library/Application Support/Solana Sentinel`, outside this checkout and apart from the staging database. The database listens only on `127.0.0.1:55433`; the web server listens only on `127.0.0.1:4318`. The database application role cannot administer the cluster. Installation never deletes the staging cluster or production data.

## Prepare this host

Install Node.js 20.12 or later, pnpm 10.33.3, and PostgreSQL 17. PostgreSQL 17 from Homebrew is detected at `/opt/homebrew/opt/postgresql@17/bin`; set `SENTINEL_PG_BIN` to a different installation's binary directory if needed. Run from the intended immutable release checkout:

```sh
pnpm install --frozen-lockfile
pnpm build
python3 scripts/mac-release.py setup
```

`setup` creates a production cluster and non-superuser application database role, then writes `production.env` with mode 0600. It generates the database passwords and configuration encryption key without printing them. It leaves the cluster stopped. Never commit or send this file or the password files. The setup page and team administration command provision member credentials; store each credential in a password manager and revoke lost credentials.

The local team administration command accepts `add USERNAME --generate /absolute/private/credential-file`, `revoke USERNAME`, and `list`. Run it with the private environment loaded, for example:

```sh
node --env-file="$HOME/Library/Application Support/Solana Sentinel/production.env" --import tsx scripts/team-admin.ts add first-member --generate "$HOME/Library/Application Support/Solana Sentinel/first-member-credential"
```

Repeat for the collaborator with a separate credential file. Give that file to its member through a private channel, import the credential into a password manager, and delete the temporary file after confirming login. The generated credential is not printed in the terminal. The member account setup can happen after installing services, when PostgreSQL is running.

The private configuration initially sets `SAT_PUBLIC_ORIGIN` and `SAT_ALLOWED_ORIGINS` to `http://127.0.0.1:4318`. Once private HTTPS access is configured, change both to the **exact** Tailscale HTTPS origin, for example `https://host.example-tailnet.ts.net`, then restart the web service. Browser state changing requests from any other origin must fail. Use the setup page locally first to configure the dedicated HTTPS mainnet RPC endpoint and verify it before enabling monitoring. The public Solana RPC is intentionally not inserted as a silent fallback. Add the two member accounts, monitored wallets, and Telegram destinations in setup. Keep any bot token in protected setup storage or `production.env`; never put it in chat or a Git file.

```sh
python3 scripts/mac-release.py install
python3 scripts/mac-release.py status
```

`install` copies the built application into a private release snapshot and writes user LaunchAgents for PostgreSQL, the dashboard, the worker, and a daily 03:15 local backup. They restart after failure and at user login. The wrapper bounds service logs to 5 MiB with three older copies; logs are private. The worker can report degraded until an RPC endpoint and at least one wallet are configured. `status` is JSON containing port reachability, service registration, backup health, and worker health. It never includes passwords. The web root serving an error or setup page counts only as reachable; use the dashboard monitor status to judge operational health.

```sh
python3 scripts/mac-release.py stop
python3 scripts/mac-release.py start
python3 scripts/mac-release.py uninstall
```

`stop` unloads all four services. `uninstall` removes LaunchAgents and release registration after stopping services; it **preserves** database, credentials, backups, and logs. Remove that private directory only as a separate, deliberate data deletion after confirming an off-machine backup.
If Tailscale Serve was configured separately, disable its route as part of uninstall with `tailscale serve 4318 off` and inspect `tailscale serve status`.

## Private access from the second Mac

Sign both Macs into [Tailscale](https://tailscale.com/kb/). Use an access policy that grants the host's web service only to the two intended member identities. On the host, configure [Tailscale Serve](https://tailscale.com/docs/features/tailscale-serve) to proxy its tailnet HTTPS URL to `http://127.0.0.1:4318`:

```sh
tailscale serve --bg 4318
tailscale serve status
```

Serve may first prompt you to enable HTTPS certificates for the tailnet. Do not enable Funnel. Check that the web and PostgreSQL sockets still bind only to loopback; neither port needs a firewall opening. Update the exact public origin values in the private environment and restart the web service. Verify that each Mac can log in independently, that logout and revocation work, and that a non-member tailnet account cannot reach the app.

Tailscale identity restricts who can reach the host. The application's member sessions separately control who can act inside Sentinel. The connection and access policy cannot be completed by this installer until both Tailscale accounts are enrolled and the host's tailnet URL is known.

## Backup, restore, and upgrade

Backups use PostgreSQL's transactionally consistent custom archive format. Every backup is restored into a randomly named disposable database, where each public table's row count and content hash are recorded in a private manifest. The archive and manifest stay together. The daily job retains fourteen verified local backups; a failed backup does not replace the previous successful one.

```sh
python3 scripts/mac-release.py backup
python3 scripts/mac-release.py restore-check
python3 scripts/mac-release.py copy-backup --destination 'member@collaborator-mac:/absolute/private/backup-directory'
python3 scripts/mac-release.py configure-copy --destination 'member@collaborator-mac:/absolute/private/backup-directory'
```

Prepare the collaborator's Mac with an SSH account, a private destination directory owned by that member, and noninteractive key based SSH access from the host. The explicit copy command verifies the newest archive again, then copies the dump and manifest. `configure-copy` stores that destination privately so each daily backup copies automatically after local restore verification; check `backup-copy-health.json` for the last successful copy. A copy failure marks off-machine copy failed while preserving the verified local archive. A successful `scp` establishes transfer, not a second Mac restore test: periodically transfer a backup back to a disposable host and run `restore-check --dump PATH` against it. Both Macs should retain access to a recent verified copy. The dashboard should report overdue backups and failed copies separately.

Before upgrading, prepare and build the intended source checkout. The command makes and verifies a pre-upgrade backup, copies that checkout into a new private release snapshot, then switches launchd services to the snapshot. The prior snapshot remains in place for rollback. Source `.env*`, runtime data, Git metadata, and other private files are excluded from release snapshots.

```sh
python3 scripts/mac-release.py update --checkout /absolute/path/to/new/checkout
python3 scripts/mac-release.py status
```

If the new release fails, `rollback` first makes another verified backup, then points services back at the prior release snapshot. Database migrations must remain additive and compatible with the prior release for this code rollback to work. For an incompatible migration, stop services and restore a pre-upgrade backup into a separate database, verify it, then switch the app only after confirming the restored database and preserving the failed version for investigation. The installer never overwrites the active database as part of rollback.

```sh
python3 scripts/mac-release.py rollback
```

## Operating checks

At each startup, confirm the database is ready, the web server responds, the worker has a recent poll, at least one wallet is current, the Telegram queue is draining, and the newest backup is within the expected interval. If a worker restarts or the Mac wakes from sleep, inspect coverage and the head observation age before trusting new alert silence. A public RPC quota or a pruned anchor must leave a visible degraded state; do not relabel it as healthy. If a Telegram send returns an ambiguous result, look up its stable event identifier before manually retrying because the recipient may have received it.

The worker moves old, settled alert facts to compressed database storage while retaining their event IDs and exact replay result. A live alert stays in the active table until every already verified eligible recipient has a durable delivery record. The active table still fails closed at its capacity when alerts arrive faster than the retention window permits safe archiving; inspect capacity warnings and delivery backlog before that point. Cold archive rows remain part of database backups and consume disk space.

Rotate a member credential through the team administration command, revoke the old session, and verify access from each Mac. Rotate the bot token through protected setup, run a connection test, and confirm a new message reaches each destination. Rotate the RPC endpoint in setup, verify mainnet genesis and method availability, then confirm the worker catches up.

Before calling the installation ready for use, record the two Mac login checks, a real supported transaction flowing to the dashboard and both Telegram recipients, a fresh backup restore, a copied off-machine archive, and actual sustained-run duration and failures. Synthetic replay and short pilot runs must be labeled as such.
