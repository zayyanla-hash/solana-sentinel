#!/usr/bin/env python3
"""Operate one private Solana Sentinel installation on a macOS host.

No command prints credentials. Production data lives outside the Git checkout.
"""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import signal
import subprocess
import sys
import time
from urllib.parse import quote
import xml.etree.ElementTree as ET


ROOT = Path(__file__).resolve().parents[1]
BASE = Path(os.environ.get("SENTINEL_MAC_HOME", Path.home() / "Library/Application Support/Solana Sentinel")).expanduser().resolve()
AGENTS = Path.home() / "Library/LaunchAgents"
PREFIX = "io.solanasentinel.shared"
PORT_DB = 55433
PORT_WEB = 4318
MAX_LOG_BYTES = 5 * 1024 * 1024
LOG_COPIES = 3
BACKUP_COPIES = 14
PG_BIN = Path(os.environ.get("SENTINEL_PG_BIN", "/opt/homebrew/opt/postgresql@17/bin"))


def private_dir(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True, mode=0o700)
    path.chmod(0o700)


def atomic_private(path: Path, content: str) -> None:
    private_dir(path.parent)
    tmp = path.with_name(path.name + ".new")
    fd = os.open(tmp, os.O_CREAT | os.O_WRONLY | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as stream:
        stream.write(content)
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(tmp, path)
    path.chmod(0o600)


def read_json(path: Path, fallback: dict | None = None) -> dict:
    return json.loads(path.read_text()) if path.exists() else (fallback or {})


def write_json(path: Path, value: dict) -> None:
    atomic_private(path, json.dumps(value, indent=2, sort_keys=True) + "\n")


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def pg(name: str) -> str:
    path = PG_BIN / name
    if path.is_file():
        return str(path)
    found = shutil.which(name)
    if found:
        return found
    raise RuntimeError("PostgreSQL 17+ binaries are required; set SENTINEL_PG_BIN.")


def run(argv: list[str], *, password: str | None = None, input_text: str | None = None,
        capture: bool = False, cwd: Path | None = None) -> subprocess.CompletedProcess:
    environment = os.environ.copy()
    if password is not None:
        environment["PGPASSWORD"] = password
    return subprocess.run(argv, check=True, env=environment, cwd=cwd, text=True,
                          input=input_text, stdout=subprocess.PIPE if capture else subprocess.DEVNULL,
                          stderr=subprocess.PIPE if capture else None)


def secret(path: Path) -> str:
    if not path.exists():
        atomic_private(path, secrets.token_hex(32) + "\n")
    if path.stat().st_mode & 0o077:
        raise RuntimeError(f"Private file permissions are too broad: {path}")
    return path.read_text().strip()


def db_conn(db: str = "sentinel_live", *, admin: bool = False) -> list[str]:
    return ["-h", "127.0.0.1", "-p", str(PORT_DB), "-U", "sentinel_admin" if admin else "sentinel_app", "-d", db]


def pg_password(admin: bool = False) -> str:
    return secret(BASE / ("admin-password" if admin else "app-password"))


def ready() -> bool:
    try:
        return subprocess.run([pg("pg_isready"), "-h", "127.0.0.1", "-p", str(PORT_DB)],
                              stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0
    except RuntimeError:
        return False


def wait_ready(seconds: int = 45) -> None:
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        if ready():
            return
        time.sleep(0.5)
    raise RuntimeError("Production PostgreSQL did not become ready on loopback port 55433.")


def psql(sql: str, *, db: str = "postgres", admin: bool = True, capture: bool = False) -> str:
    result = run([pg("psql"), *db_conn(db, admin=admin), "-v", "ON_ERROR_STOP=1", "-tAc", sql],
                 password=pg_password(admin), capture=capture)
    return result.stdout.strip() if capture else ""


def ensure_our_cluster() -> None:
    actual = Path(psql("show data_directory", capture=True)).resolve()
    if actual != (BASE / "postgres").resolve():
        raise RuntimeError("Port 55433 belongs to a different PostgreSQL cluster.")


def setup() -> None:
    private_dir(BASE)
    private_dir(BASE / "logs")
    private_dir(BASE / "backups")
    data = BASE / "postgres"
    admin_pw = secret(BASE / "admin-password")
    app_pw = secret(BASE / "app-password")
    if not (data / "PG_VERSION").exists():
        run([pg("initdb"), "-D", str(data), "-U", "sentinel_admin", "--pwfile", str(BASE / "admin-password"),
             "--auth-host=scram-sha-256", "--auth-local=trust", "--encoding=UTF8", "--locale=C"])
        data.chmod(0o700)
    if (data / "PG_VERSION").read_text().strip().split(".")[0] != "17":
        raise RuntimeError("This installation expects PostgreSQL major version 17; migrate the cluster before upgrading.")
    started = not ready()
    if started:
        run([pg("pg_ctl"), "-D", str(data), "-l", str(BASE / "logs" / "postgres-setup.log"),
             "-o", f"-h 127.0.0.1 -p {PORT_DB} -c unix_socket_directories=''", "-w", "start"])
    try:
        ensure_our_cluster()
        if psql("select 1 from pg_roles where rolname='sentinel_app'", capture=True) != "1":
            # app_pw is generated hexadecimal, so it has no SQL quoting metacharacters.
            psql(f"create role sentinel_app login nosuperuser nocreatedb nocreaterole noreplication password '{app_pw}'")
        if psql("select 1 from pg_database where datname='sentinel_live'", capture=True) != "1":
            run([pg("createdb"), "-h", "127.0.0.1", "-p", str(PORT_DB), "-U", "sentinel_admin",
                 "-O", "sentinel_app", "sentinel_live"], password=admin_pw)
        else:
            psql("alter database sentinel_live owner to sentinel_app")
        config = BASE / "production.env"
        if not config.exists():
            url = f"postgresql://sentinel_app:{quote(app_pw)}@127.0.0.1:{PORT_DB}/sentinel_live"
            atomic_private(config, "\n".join([
                f"DATABASE_URL={url}", "NODE_ENV=production", "SENTINEL_TEAM_MODE=true",
                f"SAT_CONFIG_KEY={secret(BASE / 'config-key')}",
                f"SAT_PUBLIC_ORIGIN=http://127.0.0.1:{PORT_WEB}",
                f"SAT_ALLOWED_ORIGINS=http://127.0.0.1:{PORT_WEB}",
                "SAT_BIND_HOST=127.0.0.1", f"SAT_BIND_PORT={PORT_WEB}",
                "PUBLIC_DEMO=false", "DEMO_MODE=false", "SENTINEL_MONITOR_ONLY=true",
                "SENTINEL_ENABLE_PAPER_RESEARCH=false", "SAT_WALLET_HISTORY_SOURCE=journal",
                f"SENTINEL_MONITOR_HEALTH_FILE={BASE / 'monitor-health.json'}", "SOLANA_RPC_URL=",
                f"SENTINEL_BACKUP_HEALTH_FILE={BASE / 'backup-health.json'}",
                f"SENTINEL_BACKUP_COPY_HEALTH_FILE={BASE / 'backup-copy-health.json'}",
                "SENTINEL_MONITOR_INTERVAL_MS=30000", "SENTINEL_MONITOR_PAGE_SIZE=10",
                "SENTINEL_MONITOR_MAX_PAGES=2", "", ]))
        elif config.stat().st_mode & 0o077:
            raise RuntimeError("production.env permissions are too broad; use chmod 600.")
        else:
            current = config.read_text()
            additions = []
            for key, value in (("SENTINEL_BACKUP_HEALTH_FILE", BASE / "backup-health.json"),
                               ("SENTINEL_BACKUP_COPY_HEALTH_FILE", BASE / "backup-copy-health.json")):
                if not any(line.startswith(key + "=") for line in current.splitlines()):
                    additions.append(f"{key}={value}")
            if additions:
                atomic_private(config, current.rstrip("\n") + "\n" + "\n".join(additions) + "\n")
    finally:
        if started:
            run([pg("pg_ctl"), "-D", str(data), "-m", "fast", "-w", "stop"])
    print(f"Production database prepared separately from staging. Private config: {config}")


def env_values() -> dict[str, str]:
    path = BASE / "production.env"
    if not path.is_file() or path.stat().st_mode & 0o077:
        raise RuntimeError("Run setup first; production.env must exist with mode 0600.")
    result = {}
    for line in path.read_text().splitlines():
        if line and not line.startswith("#") and "=" in line:
            name, value = line.split("=", 1)
            result[name] = value
    return result


def node_path() -> str:
    found = os.environ.get("SENTINEL_NODE_BIN") or shutil.which("node")
    if not found:
        raise RuntimeError("Node.js 20.12+ is required.")
    version = subprocess.run([found, "--version"], capture_output=True, text=True, check=True).stdout.strip()
    match = re.fullmatch(r"v(\d+)\.(\d+)\.(\d+)", version)
    if not match or (int(match[1]), int(match[2])) < (20, 12):
        raise RuntimeError("Node.js 20.12+ is required.")
    return str(Path(found).resolve())


def service_command(which: str, checkout: Path) -> list[str]:
    if which == "postgres":
        return [pg("postgres"), "-D", str(BASE / "postgres"), "-h", "127.0.0.1", "-p", str(PORT_DB),
                "-c", "unix_socket_directories="]
    node = node_path()
    env_arg = f"--env-file={BASE / 'production.env'}"
    if which == "web":
        return [node, env_arg, str(checkout / "apps/web/node_modules/next/dist/bin/next"),
                "start", str(checkout / "apps/web"), "-H", "127.0.0.1", "-p", str(PORT_WEB)]
    if which == "worker":
        return [node, env_arg, "--import", "tsx", str(checkout / "apps/worker/src/monitor.ts")]
    if which == "backup":
        return [sys.executable, str(checkout / "scripts/mac-release.py"), "backup"]
    raise ValueError(which)


def plist_path(which: str) -> Path:
    return AGENTS / f"{PREFIX}.{which}.plist"


def label(which: str) -> str:
    return f"{PREFIX}.{which}"


def xml_value(parent: ET.Element, value) -> None:
    if isinstance(value, bool):
        ET.SubElement(parent, "true" if value else "false")
    elif isinstance(value, int):
        ET.SubElement(parent, "integer").text = str(value)
    elif isinstance(value, list):
        array = ET.SubElement(parent, "array")
        for item in value:
            xml_value(array, item)
    elif isinstance(value, dict):
        node = ET.SubElement(parent, "dict")
        for key, item in value.items():
            ET.SubElement(node, "key").text = key
            xml_value(node, item)
    else:
        ET.SubElement(parent, "string").text = str(value)


def create_plist(which: str, checkout: Path) -> None:
    root = ET.Element("plist", version="1.0")
    node = node_path()
    environment = {
        "LANG": "C", "LC_ALL": "C",
        "SENTINEL_NODE_BIN": node,
        "SENTINEL_PG_BIN": str(PG_BIN),
        "PATH": ":".join([str(Path(node).parent), str(PG_BIN), "/opt/homebrew/bin", "/usr/local/bin",
                          "/usr/bin", "/bin", "/usr/sbin", "/sbin"]),
    }
    entries = {"Label": label(which), "ProgramArguments": [sys.executable, str(checkout / "scripts/mac-release.py"),
               "service", which, "--checkout", str(checkout)], "RunAtLoad": which != "backup",
               "WorkingDirectory": str(checkout), "StandardOutPath": "/dev/null", "StandardErrorPath": "/dev/null",
               "EnvironmentVariables": environment}
    if which == "backup":
        entries["StartCalendarInterval"] = {"Hour": 3, "Minute": 15}
    else:
        entries["KeepAlive"] = True
        entries["ThrottleInterval"] = 15
    xml_value(root, entries)
    AGENTS.mkdir(parents=True, exist_ok=True)
    path = plist_path(which)
    path.write_bytes(ET.tostring(root, encoding="utf-8", xml_declaration=True))
    path.chmod(0o600)


def launch(which: str, action: str) -> None:
    path = plist_path(which)
    target = f"gui/{os.getuid()}"
    present = subprocess.run(["launchctl", "print", f"{target}/{label(which)}"],
                             stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0
    if (action == "bootout" and not present) or (action == "bootstrap" and present):
        return
    argv = ["launchctl", action, target, str(path)]
    result = subprocess.run(argv, text=True, capture_output=True)
    if result.returncode:
        # launchctl messages may contain paths, not credentials.
        raise RuntimeError(f"launchctl {action} failed for {which}: {result.stderr.strip()}")


def release_state() -> dict:
    return read_json(BASE / "release.json")


def installed_checkout() -> Path:
    value = release_state().get("checkout")
    if not value:
        raise RuntimeError("Install the shared Mac services first.")
    return Path(value)


def snapshot(source: Path) -> Path:
    """Copy runnable code into a private, stable release directory."""
    source = source.resolve()
    if source == BASE or BASE in source.parents:
        raise RuntimeError("A release source must be outside the private data directory.")
    if not (source / "apps/web/.next/BUILD_ID").is_file() or not (source / "node_modules/tsx").exists():
        raise RuntimeError("Build the supplied checkout and install dependencies before creating a release.")
    releases = BASE / "releases"
    private_dir(releases)
    dest = releases / (datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ") + "-" + secrets.token_hex(4))
    excluded = {".git", "runtime-history", "artifacts", "playwright-report", "test-results", ".pnpm-store", "__pycache__", "secrets"}
    def ignore(_directory: str, names: list[str]) -> set[str]:
        return {name for name in names if name in excluded or name == ".env" or name.startswith(".env.")
                or name.endswith(".log") or name.endswith(".pem") or name.endswith(".key")
                or name.startswith("id_rsa") or (name.startswith("wallet") and name.endswith(".json"))
                or (name.startswith("keypair") and name.endswith(".json"))}
    try:
        shutil.copytree(source, dest, symlinks=True, ignore=ignore)
        dest.chmod(0o700)
        if not (dest / "apps/web/.next/BUILD_ID").is_file():
            raise RuntimeError("The release copy does not contain a built web application.")
    except Exception:
        shutil.rmtree(dest, ignore_errors=True)
        raise
    return dest


def activate(checkout: Path, previous: str | None) -> None:
    if not (checkout / "apps/web/.next/BUILD_ID").is_file():
        raise RuntimeError("The production web build is missing; install dependencies and run pnpm build first.")
    if not (checkout / "node_modules/tsx").exists():
        raise RuntimeError("The worker dependencies are missing; run pnpm install --frozen-lockfile first.")
    config = env_values()
    if config.get("SENTINEL_TEAM_MODE") != "true" or config.get("SENTINEL_MONITOR_ONLY") != "true":
        raise RuntimeError("Production must enable team mode and monitor-only mode.")
    if not config.get("SAT_CONFIG_KEY"):
        raise RuntimeError("Production requires SAT_CONFIG_KEY.")
    private_dir(BASE / "logs")
    for which in ("backup", "worker", "web", "postgres"):
        if plist_path(which).exists():
            launch(which, "bootout")
    try:
        for which in ("postgres", "web", "worker", "backup"):
            create_plist(which, checkout)
            launch(which, "bootstrap")
    except Exception:
        for which in ("backup", "worker", "web", "postgres"):
            if plist_path(which).exists():
                try:
                    launch(which, "bootout")
                except Exception:
                    pass
        raise
    write_json(BASE / "release.json", {"checkout": str(checkout), "previous": previous, "activatedAt": now()})
    print("Shared Mac services installed; check status and complete local setup before private remote access.")


def stop() -> None:
    for which in ("backup", "worker", "web", "postgres"):
        if plist_path(which).exists():
            launch(which, "bootout")
    print("Shared Mac services stopped.")


def start() -> None:
    installed_checkout()
    for which in ("postgres", "web", "worker", "backup"):
        if not plist_path(which).exists():
            raise RuntimeError("Service files are missing; run install again.")
        launch(which, "bootstrap")
    print("Shared Mac services started.")


def status() -> None:
    state = release_state()
    backup_health = read_json(BASE / "backup-health.json")
    copy_health = read_json(BASE / "backup-copy-health.json")
    def age(entry: dict) -> int | None:
        try:
            return int((datetime.now(timezone.utc) - datetime.fromisoformat(entry["at"])).total_seconds())
        except (ValueError, TypeError, KeyError):
            return None
    backup_age = age(backup_health)
    copy_age = age(copy_health)
    data = {"installed": bool(state), "databaseReady": ready(), "webReachable": False,
            "webPort": PORT_WEB, "databasePort": PORT_DB, "checkout": state.get("checkout"),
            "backup": backup_health, "backupAgeSeconds": backup_age,
            "backupOverdue": backup_age is None or backup_age > 36 * 3600,
            "backupCopy": copy_health, "backupCopyAgeSeconds": copy_age,
            "backupCopyOverdue": copy_age is None or copy_age > 36 * 3600,
            "worker": read_json(BASE / "monitor-health.json")}
    try:
        import urllib.request
        with urllib.request.urlopen(f"http://127.0.0.1:{PORT_WEB}/", timeout=2) as response:
            data["webReachable"] = response.status < 500
    except Exception:
        pass
    for which in ("postgres", "web", "worker", "backup"):
        result = subprocess.run(["launchctl", "print", f"gui/{os.getuid()}/{label(which)}"],
                                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        data[f"{which}Loaded"] = result.returncode == 0
    print(json.dumps(data, indent=2))


def fingerprints(db: str) -> dict:
    names = psql("select tablename from pg_tables where schemaname='public' order by tablename",
                 db=db, admin=False, capture=True).split()
    result = {}
    for name in names:
        if not re.fullmatch(r"[a-z_][a-z0-9_]*", name):
            raise RuntimeError("Unexpected database table identifier.")
        sql = (f"select json_build_object('rows',count(*),'hash',"
               f"md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by md5(to_jsonb(t)::text)),''))) "
               f'from "{name}" t')
        result[name] = json.loads(psql(sql, db=db, admin=False, capture=True))
    return result


def restore_temp(dump: Path) -> dict:
    name = "sentinel_verify_" + secrets.token_hex(5)
    run([pg("createdb"), "-h", "127.0.0.1", "-p", str(PORT_DB), "-U", "sentinel_admin",
         "-O", "sentinel_app", name], password=pg_password(True))
    try:
        run([pg("pg_restore"), *db_conn(name), "--exit-on-error", "--no-owner", str(dump)],
            password=pg_password())
        return fingerprints(name)
    finally:
        run([pg("dropdb"), "-h", "127.0.0.1", "-p", str(PORT_DB), "-U", "sentinel_admin", name],
            password=pg_password(True))


def backup() -> None:
    wait_ready()
    ensure_our_cluster()
    private_dir(BASE / "backups")
    name = datetime.now(timezone.utc).strftime("sentinel-%Y%m%dT%H%M%SZ") + "-" + secrets.token_hex(3)
    dump = BASE / "backups" / f"{name}.dump"
    try:
        run([pg("pg_dump"), *db_conn(), "--format=custom", "--file", str(dump)], password=pg_password())
        dump.chmod(0o600)
        fingerprint = restore_temp(dump)
        manifest = {"createdAt": now(), "dump": dump.name, "sha256": hashlib.sha256(dump.read_bytes()).hexdigest(),
                    "fingerprints": fingerprint, "verifiedRestore": True}
        write_json(dump.with_suffix(".json"), manifest)
        write_json(BASE / "backup-health.json", {"status": "verified", "at": manifest["createdAt"],
                                                  "dump": dump.name, "tableCount": len(fingerprint)})
        old = sorted((BASE / "backups").glob("sentinel-*.dump"), reverse=True)[BACKUP_COPIES:]
        for item in old:
            item.unlink()
            item.with_suffix(".json").unlink(missing_ok=True)
        print(f"Backup created and restored into a disposable database: {dump}")
    except Exception:
        write_json(BASE / "backup-health.json", {"status": "failed", "at": now()})
        dump.unlink(missing_ok=True)
        raise
    copy_target = BASE / "backup-copy-target"
    if copy_target.exists():
        try:
            copy_backup(copy_target.read_text().strip())
        except Exception:
            write_json(BASE / "backup-copy-health.json", {"status": "failed", "at": now(), "dump": dump.name})
            raise


def restore_check(dump: Path | None = None) -> None:
    wait_ready()
    ensure_our_cluster()
    if dump is None:
        dumps = sorted((BASE / "backups").glob("sentinel-*.dump"), reverse=True)
        if not dumps:
            raise RuntimeError("No backup exists. Run backup first.")
        dump = dumps[0]
    manifest = read_json(dump.with_suffix(".json"))
    if not manifest or hashlib.sha256(dump.read_bytes()).hexdigest() != manifest.get("sha256"):
        raise RuntimeError("Backup checksum or manifest is invalid.")
    if restore_temp(dump) != manifest.get("fingerprints"):
        raise RuntimeError("Restored table row counts or hashes differ from the saved backup manifest.")
    print("PASS: archive checksum and disposable restored table contents match the saved manifest.")


def copy_backup(destination: str) -> None:
    if not re.fullmatch(r"[A-Za-z0-9_.-]+@[A-Za-z0-9_.-]+:/[A-Za-z0-9_./-]+", destination):
        raise RuntimeError("Destination must be an explicit user@host:/absolute/path SSH target.")
    dumps = sorted((BASE / "backups").glob("sentinel-*.dump"), reverse=True)
    if not dumps:
        raise RuntimeError("Run backup first.")
    dump = dumps[0]
    restore_check(dump)
    run(["scp", "-p", str(dump), str(dump.with_suffix(".json")), destination])
    write_json(BASE / "backup-copy-health.json", {"status": "copied", "at": now(), "dump": dump.name})
    print("Verified backup archive and manifest copied to the specified SSH destination.")


def configure_copy(destination: str) -> None:
    if not re.fullmatch(r"[A-Za-z0-9_.-]+@[A-Za-z0-9_.-]+:/[A-Za-z0-9_./-]+", destination):
        raise RuntimeError("Destination must be an explicit user@host:/absolute/path SSH target.")
    atomic_private(BASE / "backup-copy-target", destination + "\n")
    print("Future daily backups will copy to the configured SSH destination after verification.")


def rotate_log(path: Path, *, force: bool = False) -> None:
    if not path.exists() or (not force and path.stat().st_size < MAX_LOG_BYTES):
        return
    for n in range(LOG_COPIES, 0, -1):
        source = path.with_name(path.name if n == 1 else f"{path.name}.{n-1}")
        target = path.with_name(f"{path.name}.{n}")
        if source.exists():
            os.replace(source, target)


def service(which: str, checkout: Path) -> None:
    private_dir(BASE / "logs")
    log = BASE / "logs" / f"{which}.log"
    rotate_log(log)
    try:
        if which in ("web", "worker"):
            wait_ready(90)
        argv = service_command(which, checkout)
    except Exception as error:
        with log.open("a") as stream:
            stream.write(f"{now()} service-start-failed {type(error).__name__}\n")
        log.chmod(0o600)
        raise
    process = subprocess.Popen(argv, cwd=checkout, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                               env=os.environ.copy(), start_new_session=True)
    def relay(sig, _frame):
        if process.poll() is None:
            os.killpg(process.pid, sig)
    signal.signal(signal.SIGTERM, relay)
    signal.signal(signal.SIGINT, relay)
    stream = log.open("ab", buffering=0)
    try:
        os.chmod(log, 0o600)
        while chunk := process.stdout.read1(8192):
            if stream.tell() + len(chunk) > MAX_LOG_BYTES:
                stream.close()
                rotate_log(log, force=True)
                stream = log.open("ab", buffering=0)
                os.chmod(log, 0o600)
            stream.write(chunk)
    finally:
        stream.close()
    raise SystemExit(process.wait())


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["setup", "install", "start", "stop", "status", "backup", "restore-check",
                                           "copy-backup", "configure-copy", "update", "rollback", "uninstall", "service"])
    parser.add_argument("service_name", nargs="?", choices=["postgres", "web", "worker", "backup"])
    parser.add_argument("--checkout", type=Path)
    parser.add_argument("--destination")
    parser.add_argument("--dump", type=Path)
    args = parser.parse_args()
    if args.action == "setup":
        setup()
    elif args.action == "install":
        state = release_state()
        if state.get("checkout"):
            activate(Path(state["checkout"]), state.get("previous"))
        else:
            activate(snapshot(ROOT), None)
    elif args.action == "start":
        start()
    elif args.action == "stop":
        stop()
    elif args.action == "status":
        status()
    elif args.action == "backup":
        backup()
    elif args.action == "restore-check":
        restore_check(args.dump)
    elif args.action == "copy-backup":
        if not args.destination:
            raise RuntimeError("Provide --destination user@host:/absolute/path.")
        copy_backup(args.destination)
    elif args.action == "configure-copy":
        if not args.destination:
            raise RuntimeError("Provide --destination user@host:/absolute/path.")
        configure_copy(args.destination)
    elif args.action == "update":
        source = (args.checkout or ROOT).resolve()
        previous = installed_checkout().resolve()
        backup()
        prepared = snapshot(source)
        try:
            activate(prepared, str(previous))
        except Exception:
            activate(previous, release_state().get("previous"))
            raise
    elif args.action == "rollback":
        previous = release_state().get("previous")
        if not previous:
            raise RuntimeError("No prior release checkout is recorded.")
        backup()
        current = installed_checkout()
        try:
            activate(Path(previous), str(current))
        except Exception:
            activate(current, previous)
            raise
    elif args.action == "uninstall":
        stop()
        for which in ("postgres", "web", "worker", "backup"):
            plist_path(which).unlink(missing_ok=True)
        (BASE / "release.json").unlink(missing_ok=True)
        print(f"Services removed. Database, credentials and backups preserved under {BASE}")
    elif args.action == "service":
        if not args.service_name or not args.checkout:
            raise RuntimeError("Service wrapper requires a name and checkout.")
        service(args.service_name, args.checkout)


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, subprocess.CalledProcessError, OSError) as exc:
        # A command's stderr can contain credentials. Keep console errors generic.
        print(f"Mac release command failed: {type(exc).__name__}. See docs/SHARED_MAC.md.", file=sys.stderr)
        raise SystemExit(1)
