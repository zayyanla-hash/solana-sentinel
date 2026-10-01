# Host Sentinel on the collaborator's Mac

The collaborator's Mac will run PostgreSQL, the web dashboard and the monitoring worker. Both people keep separate Tailscale identities and separate Sentinel logins. The other Mac becomes a dashboard client and can retain an off-host backup copy.

## Current cutover boundary

The previous installation was checked before this handoff: zero watched wallets, zero rules, zero inbox events, no configured RPC and no configured Telegram bot. A fresh installation is appropriate for that empty live workspace. Existing account/audit records remain in a verified backup on the previous host; a fresh installation issues new member credentials. If anyone configures the previous workspace before cutover, pause the fresh-install route and migrate its database and configuration encryption key instead. Do not discard new data or copy the old `production.env` into the new installation: its passwords, paths and public origin belong to the previous Mac.

Prepare and verify the new host before retiring the previous one. Leave RPC and Telegram unconfigured during preparation, so two independent workers cannot monitor/deliver against copied or independently configured databases. Only enable collection on the designated host after cutover.

## Install the release

Use macOS 12+, Node 22 LTS, Python 3, pnpm 10.33.3 and PostgreSQL 17. If the frontend development clone already exists, use a separate host checkout. The Mac-specific chart and database-test fixes are currently in PR #4; use this branch until those fixes are merged into main.

```sh
git clone --branch fix/shared-mac-install https://github.com/zayyanla-hash/solana-sentinel.git solana-sentinel-host
cd solana-sentinel-host
```

Checkpoint `7c96f57` passed the local 409-test suite, production builds and five PostgreSQL-backed Mac tests; its hosted build, end-to-end and Mac checks passed. Verify the fetched branch includes that checkpoint. Do not install a frontend-only branch.

On a Mac with Homebrew:

```sh
brew install postgresql@17
export SENTINEL_PG_BIN="$(brew --prefix postgresql@17)/bin"
pnpm install --frozen-lockfile
pnpm build
python3 scripts/mac-release.py setup
python3 scripts/mac-release.py install
python3 scripts/mac-release.py status
```

Install Node/pnpm/Python first if absent. Use the pinned pnpm version rather than an unrelated global version. Wait until status reports `databaseReady: true` and `webReachable: true` before provisioning members. The database is restricted to loopback port 55433 and the web service to loopback port 4318. Staging uses a separate database and port. Do not manually run another production worker.

Generate separate credentials locally:

```sh
node --env-file="$HOME/Library/Application Support/Solana Sentinel/production.env" --import tsx scripts/team-admin.ts add farhan --generate "$HOME/Library/Application Support/Solana Sentinel/farhan-credential"
node --env-file="$HOME/Library/Application Support/Solana Sentinel/production.env" --import tsx scripts/team-admin.ts add collaborator --generate "$HOME/Library/Application Support/Solana Sentinel/collaborator-credential"
```

Each recipient gets only their own credential through a private channel. These new credentials replace the previous host's credentials for access to the new installation. The script refuses to overwrite an existing credential file; inspect existing members instead of regenerating credentials blindly. Test both accounts locally at `http://127.0.0.1:4318` before changing the origin.

## Join the existing private network

Install the standalone Tailscale app, accept the existing invitation using the collaborator's own account, and have the tailnet owner approve that exact account. Join the existing shared tailnet rather than creating an unrelated network. Sign in on the Mac itself as well as in the browser. Use ego-lite for all browser work.

After the client reports connected:

```sh
tailscale status
tailscale serve --bg 4318
tailscale serve status
```

Complete any Serve/HTTPS approval in the account's browser. Use private Serve. Do not enable public Funnel. Send the new Mac's Tailscale DNS name and addresses to the tailnet owner. The existing access rule points to the previous host; it must be updated to the new host's addresses while preserving the two intended identities and HTTPS-only access. Never replace it with allow-all access.

Set the exact new HTTPS origin in protected local configuration. This script obtains the name from the local Tailscale client, preserves secrets, and writes with restricted permissions:

```sh
python3 - <<'PY'
from pathlib import Path
import json, os, shutil, subprocess
base = Path.home() / 'Library/Application Support/Solana Sentinel'
client = shutil.which('tailscale') or '/Applications/Tailscale.app/Contents/MacOS/Tailscale'
status = json.loads(subprocess.check_output([client, 'status', '--json'], text=True))
assert status.get('BackendState') == 'Running', 'Sign in to Tailscale first'
name = status['Self']['DNSName'].rstrip('.')
assert name.endswith('.ts.net'), 'Expected the private Tailscale DNS name'
config = base / 'production.env'
assert config.stat().st_mode & 0o077 == 0, 'Configuration permissions are too broad'
values = dict(line.split('=', 1) for line in config.read_text().splitlines() if '=' in line)
values['SAT_PUBLIC_ORIGIN'] = 'https://' + name
values['SAT_ALLOWED_ORIGINS'] = values['SAT_PUBLIC_ORIGIN']
temporary = config.with_name('production.env.new')
fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
with os.fdopen(fd, 'w') as output:
    output.write('\n'.join(f'{key}={value}' for key, value in values.items()) + '\n')
    output.flush()
    os.fsync(output.fileno())
os.chmod(temporary, 0o600)
os.replace(temporary, config)
print('Protected private HTTPS origin configured')
PY
python3 scripts/mac-release.py stop
python3 scripts/mac-release.py start
python3 scripts/mac-release.py status
```

After this change, use the new HTTPS URL for browser actions. Direct loopback page viewing does not authorize mutations from the old origin.

## Verify and switch hosts

From both physical Macs, verify independent sign-in, shared watchlist/rule changes, logout/revocation, private HTTPS and current service status. Clean up deliberate acceptance-test wallets/rules afterward. Check that database/web ports are still loopback-only. Create and restore-check a new-host backup:

```sh
python3 scripts/mac-release.py backup
python3 scripts/mac-release.py restore-check
```

Once both Macs pass these checks, retire the old installation on the previous Mac. This preserves its database, backups and credentials while removing its service registrations. Verify its Serve configuration contains only Sentinel before resetting that route:

```sh
python3 scripts/mac-release.py uninstall
tailscale serve status
tailscale serve reset
```

Do not reset Serve if it hosts unrelated routes. Do not copy launchd files or a PostgreSQL data directory between machines. Do not delete the previous host's saved data during this cutover. If the new host fails before collection starts, reinstall the previous host's existing release and restore its private Serve route.

Only then configure the dedicated mainnet RPC, actual watched wallets, shared bot and separately verified Telegram destinations on the new host. Confirm a real supported live transaction reaches the inbox and both recipients. Configure verified backup copying from the new host to the other Mac using the shared runbook. SSH backup-copy access is a separate, scoped network rule; the dashboard's HTTPS grant does not enable SSH automatically.

The host must stay awake and connected. The service stops while it is asleep/offline and catches up after return within the provider's retained coverage. Complete the sustained live-run and recovery acceptance before calling the deployment production-ready.

See [shared Mac operations](SHARED_MAC.md) for updates, rollback, retention, backup copies and recovery.
