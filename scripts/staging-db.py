"""Manage this checkout's isolated loopback PostgreSQL staging cluster."""
import argparse
import os
from pathlib import Path
import secrets
import shutil
import subprocess
import json
import re

root = Path(__file__).resolve().parents[1]
base = root / "runtime-history" / "staging-postgres"
parser = argparse.ArgumentParser()
parser.add_argument("action", choices=["start", "stop", "backup", "restore-check"])
args = parser.parse_args()
binary = Path(os.environ.get("SENTINEL_PG_BIN", "/opt/homebrew/opt/postgresql@17/bin"))
if not (binary / "pg_ctl").exists():
    found = shutil.which("pg_ctl")
    if not found:
        raise SystemExit("PostgreSQL 17+ binaries required; set SENTINEL_PG_BIN.")
    binary = Path(found).parent
base.mkdir(parents=True, exist_ok=True)
base.chmod(0o700)
data = base / "data"
pwfile = base / "password"
if not pwfile.exists():
    pwfile.write_text(secrets.token_hex(24))
    pwfile.chmod(0o600)
pw = pwfile.read_text().strip()
env = dict(os.environ, PGPASSWORD=pw)
port = "55432"

def run(name, *params, capture=False):
    return subprocess.run([str(binary / name), *params], check=True, env=env,
                          stdout=subprocess.PIPE if capture else subprocess.DEVNULL,
                          text=True)

def conn(db):
    return ["-h", "127.0.0.1", "-p", port, "-U", "sentinel_test", "-d", db]

def fingerprints(db):
    names = run("psql", *conn(db), "-tAc",
                "select tablename from pg_tables where schemaname='public' order by tablename", capture=True).stdout.split()
    result = {}
    for name in names:
        if not re.fullmatch(r"[a-z_][a-z0-9_]*", name):
            raise SystemExit("Unexpected table identifier; restore comparison stopped.")
        sql = (f'select json_build_object(\'rows\',count(*),\'hash\','
               f'md5(coalesce(string_agg(md5(to_jsonb(t)::text),\'\' order by md5(to_jsonb(t)::text)),\'\'))) '
               f'from "{name}" t')
        result[name] = json.loads(run("psql", *conn(db), "-tAc", sql, capture=True).stdout)
    return result

if args.action == "stop":
    run("pg_ctl", "-D", str(data), "-m", "fast", "-w", "stop")
    print("Local staging cluster stopped.")
elif args.action == "start":
    if not (data / "PG_VERSION").exists():
        run("initdb", "-D", str(data), "-U", "sentinel_test", "--pwfile", str(pwfile),
            "--auth-host=scram-sha-256", "--auth-local=trust", "--encoding=UTF8", "--locale=C")
    status = subprocess.run([str(binary / "pg_ctl"), "-D", str(data), "status"],
                            stdout=subprocess.DEVNULL)
    if status.returncode:
        run("pg_ctl", "-D", str(data), "-l", str(base / "postgres.log"),
            "-o", f"-h 127.0.0.1 -p {port} -c unix_socket_directories=''", "-w", "start")
    for db in ["sentinel_test", "sentinel_stage"]:
        exists = run("psql", *conn("postgres"), "-tAc",
                     f"select 1 from pg_database where datname='{db}'", capture=True)
        if not exists.stdout.strip():
            run("createdb", "-h", "127.0.0.1", "-p", port, "-U", "sentinel_test", db)
    stage_pwfile = base / "stage-password"
    if not stage_pwfile.exists():
        stage_pwfile.write_text(secrets.token_hex(24))
        stage_pwfile.chmod(0o600)
    stage_pw = stage_pwfile.read_text().strip()
    # The staging application owns its database, but has no cluster administration privileges.
    role = run("psql", *conn("postgres"), "-tAc",
               "select 1 from pg_roles where rolname='sentinel_stage_app'", capture=True)
    if not role.stdout.strip():
        sql = f"create role sentinel_stage_app login nosuperuser nocreatedb nocreaterole noreplication password '{stage_pw}';"
        subprocess.run([str(binary / "psql"), *conn("postgres"), "-v", "ON_ERROR_STOP=1"],
                       input=sql, text=True, env=env, check=True, stdout=subprocess.DEVNULL)
    run("psql", *conn("postgres"), "-v", "ON_ERROR_STOP=1", "-c",
        "alter database sentinel_stage owner to sentinel_stage_app")
    config = root / ".env.staging.local"
    if not config.exists():
        config.write_text(
            f"DATABASE_URL=postgresql://sentinel_stage_app:{stage_pw}@127.0.0.1:{port}/sentinel_stage\n"
            f"SENTINEL_TEST_DATABASE_URL=postgresql://sentinel_test:{pw}@127.0.0.1:{port}/sentinel_test\n"
            "SOLANA_RPC_URL=https://api.mainnet-beta.solana.com\n"
            "SENTINEL_MONITOR_WALLETS=\nSENTINEL_MONITOR_INTERVAL_MS=30000\n")
        config.chmod(0o600)
    else:
        lines = config.read_text().splitlines()
        lines = [f"DATABASE_URL=postgresql://sentinel_stage_app:{stage_pw}@127.0.0.1:{port}/sentinel_stage"
                 if line.startswith("DATABASE_URL=postgresql://sentinel_test:") else line for line in lines]
        config.write_text("\n".join(lines) + "\n")
    if not any(line.startswith("SAT_API_TOKEN=") for line in config.read_text().splitlines()):
        with config.open("a") as out:
            out.write(f"SAT_API_TOKEN={secrets.token_hex(32)}\nSAT_API_KEYS={secrets.token_hex(32)}:API\n"
                      "SAT_BIND_HOST=127.0.0.1\nSAT_BIND_PORT=4317\nPUBLIC_DEMO=false\n"
                      "SAT_WALLET_HISTORY_SOURCE=journal\n"
                      "SENTINEL_MONITOR_HEALTH_FILE=runtime-history/monitor-health.json\n")
    config.chmod(0o600)
    print("Isolated staging and test databases ready on loopback. Config: .env.staging.local")
elif args.action == "backup":
    backup = base / "staging.dump"
    run("pg_dump", *conn("sentinel_stage"), "-Fc", "-f", str(backup))
    backup.chmod(0o600)
    print("Staging backup saved locally.")
else:
    backup = base / "staging.dump"
    if not backup.exists():
        raise SystemExit("Run backup first.")
    db = "sentinel_restore_" + secrets.token_hex(5)
    run("createdb", "-h", "127.0.0.1", "-p", port, "-U", "sentinel_test", db)
    try:
        run("pg_restore", *conn(db), "--exit-on-error", str(backup))
        tables = run("psql", *conn(db), "-tAc",
                     "select count(*) from information_schema.tables where table_schema='public'", capture=True)
        original = fingerprints("sentinel_stage")
        restored = fingerprints(db)
        if original != restored:
            raise SystemExit("Restored rows differ from staging. Stop writers, make a fresh backup, and retry.")
        evidence = {"status": "PASS", "tables": int(tables.stdout.strip()),
                    "rowsByTable": {name: value["rows"] for name, value in restored.items()},
                    "allRowHashesMatch": True, "scope": "quiescent local staging; disposable restore"}
        out = root / "artifacts" / "session-2" / "restore-check.json"
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps(evidence, indent=2) + "\n")
        print("Backup restored; all table row counts and content hashes match. Evidence:", out)
    finally:
        run("dropdb", "-h", "127.0.0.1", "-p", port, "-U", "sentinel_test", db)
