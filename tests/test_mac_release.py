"""Integration checks for the isolated Mac database and verified backup path."""

import importlib.util
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import unittest
import xml.etree.ElementTree as ET
from unittest.mock import patch


SCRIPT = Path(__file__).resolve().parents[1] / "scripts/mac-release.py"
PG_BIN = Path(os.environ.get("SENTINEL_PG_BIN", "/opt/homebrew/opt/postgresql@17/bin"))


@unittest.skipUnless((PG_BIN / "initdb").exists() and (PG_BIN / "pg_ctl").exists(), "PostgreSQL 17 unavailable")
class MacReleaseTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="sentinel-mac-release-")
        os.environ["SENTINEL_MAC_HOME"] = self.temp.name
        os.environ["SENTINEL_PG_BIN"] = str(PG_BIN)
        spec = importlib.util.spec_from_file_location("mac_release", SCRIPT)
        self.module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.module)
        self.module.AGENTS = Path(self.temp.name) / "LaunchAgents"
        # Each test owns a separate database port, including on an installed host.
        with socket.socket() as probe:
            probe.bind(("127.0.0.1", 0))
            self.module.PORT_DB = probe.getsockname()[1]

    def tearDown(self):
        data = Path(self.temp.name) / "postgres"
        if (data / "postmaster.pid").exists():
            subprocess.run([str(PG_BIN / "pg_ctl"), "-D", str(data), "-m", "immediate", "-w", "stop"],
                           check=True, stdout=subprocess.DEVNULL)
        self.temp.cleanup()
        os.environ.pop("SENTINEL_MAC_HOME", None)

    def test_setup_and_backup_restore_integrity(self):
        mac = self.module
        mac.setup()
        config = mac.BASE / "production.env"
        self.assertEqual(config.stat().st_mode & 0o777, 0o600)
        self.assertIn("SENTINEL_TEAM_MODE=true", config.read_text())
        self.assertFalse(mac.ready())
        subprocess.run([str(PG_BIN / "pg_ctl"), "-D", str(mac.BASE / "postgres"),
                        "-l", str(mac.BASE / "logs/test-postgres.log"),
                        "-o", f"-h 127.0.0.1 -p {mac.PORT_DB} -c unix_socket_directories=''", "-w", "start"],
                       check=True, stdout=subprocess.DEVNULL)
        mac.psql("create table if not exists backup_probe (id integer primary key, value text)",
                 db="sentinel_live", admin=False)
        mac.psql("insert into backup_probe values (1, 'saved')", db="sentinel_live", admin=False)
        mac.backup()
        dumps = list((mac.BASE / "backups").glob("*.dump"))
        self.assertEqual(len(dumps), 1)
        manifest = json.loads(dumps[0].with_suffix(".json").read_text())
        self.assertEqual(manifest["fingerprints"]["backup_probe"]["rows"], 1)
        recovery = dumps[0].with_suffix(".config.json")
        recovery_bytes = recovery.read_bytes()
        recovered = json.loads(recovery_bytes)["settings"]
        self.assertEqual(recovery.stat().st_mode & 0o777, 0o600)
        self.assertEqual(recovered["SAT_CONFIG_KEY"], mac.env_values()["SAT_CONFIG_KEY"])
        self.assertNotIn("DATABASE_URL", recovered)
        self.assertNotIn("SENTINEL_TEAM_ORIGIN", recovered)
        self.assertTrue(mac.restore_check())
        recovery.write_bytes(recovery_bytes + b"tampered")
        with patch.object(mac, "restore_temp") as restore:
            with self.assertRaisesRegex(RuntimeError, "configuration checksum"):
                mac.restore_check()
            restore.assert_not_called()
        recovery.write_bytes(recovery_bytes)
        recovery.chmod(0o644)
        with self.assertRaisesRegex(RuntimeError, "private file"):
            mac.restore_check()
        recovery.chmod(0o600)
        actual_run = mac.run
        copied = []
        def capture_copy(command, **kwargs):
            if command[0] == "scp":
                copied.append(command)
                return None
            return actual_run(command, **kwargs)
        with patch.object(mac, "run", side_effect=capture_copy):
            mac.copy_backup("member@backup-mac:/private/backups")
        self.assertEqual(copied[0][2:-1], [str(dumps[0]), str(dumps[0].with_suffix(".json")), str(recovery)])
        manifest_path = dumps[0].with_suffix(".json")
        manifest_bytes = manifest_path.read_bytes()
        manifest.pop("recoveryConfig")
        manifest["formatVersion"] = 1
        manifest_path.write_text(json.dumps(manifest))
        self.assertFalse(mac.restore_check())
        with self.assertRaisesRegex(RuntimeError, "new backup"):
            mac.copy_backup("member@backup-mac:/private/backups")
        manifest_path.write_bytes(manifest_bytes)
        mac.psql("update backup_probe set value='changed' where id=1", db="sentinel_live", admin=False)
        mac.restore_check()  # compares the archive's consistent snapshot, not the now-changing live DB
        with dumps[0].open("ab") as stream:
            stream.write(b"tampered")
        with self.assertRaisesRegex(RuntimeError, "checksum"):
            mac.restore_check()

    def test_rotation_during_backup_preserves_previous_verified_archive(self):
        mac = self.module
        mac.setup()
        subprocess.run([str(PG_BIN / "pg_ctl"), "-D", str(mac.BASE / "postgres"),
                        "-l", str(mac.BASE / "logs/test-postgres.log"),
                        "-o", f"-h 127.0.0.1 -p {mac.PORT_DB} -c unix_socket_directories=''", "-w", "start"],
                       check=True, stdout=subprocess.DEVNULL)
        mac.backup()
        before = {p.name: p.read_bytes() for p in (mac.BASE / "backups").iterdir()}
        settings = mac.recovery_settings()
        with patch.object(mac, "recovery_settings", side_effect=[settings, {**settings, "SAT_CONFIG_KEY": "f" * 64}]):
            with self.assertRaisesRegex(RuntimeError, "changed during backup"):
                mac.backup()
        self.assertEqual(before, {p.name: p.read_bytes() for p in (mac.BASE / "backups").iterdir()})
        self.assertEqual(json.loads((mac.BASE / "backup-health.json").read_text())["status"], "failed")
        self.assertTrue(mac.restore_check())

    def test_private_service_files_and_bounded_logs(self):
        mac = self.module
        mac.create_plist("web", SCRIPT.parents[1])
        mac.create_plist("backup", SCRIPT.parents[1])
        web = mac.plist_path("web")
        self.assertEqual(web.stat().st_mode & 0o777, 0o600)
        parsed = ET.parse(web)
        self.assertIn("io.solanasentinel.shared.web", "".join(parsed.getroot().itertext()))
        self.assertNotIn("DATABASE_URL", web.read_text())
        self.assertIn("<key>LC_ALL</key><string>C</string>", web.read_text())
        self.assertIn("<key>SENTINEL_NODE_BIN</key>", web.read_text())
        self.assertIn("<key>ExitTimeOut</key><integer>30</integer>", web.read_text())
        node = mac.node_path()
        prior_path, prior_node = os.environ.get("PATH"), os.environ.get("SENTINEL_NODE_BIN")
        try:
            os.environ["PATH"] = "/usr/bin:/bin"
            os.environ["SENTINEL_NODE_BIN"] = node
            self.assertEqual(mac.node_path(), node)
        finally:
            if prior_path is None: os.environ.pop("PATH", None)
            else: os.environ["PATH"] = prior_path
            if prior_node is None: os.environ.pop("SENTINEL_NODE_BIN", None)
            else: os.environ["SENTINEL_NODE_BIN"] = prior_node
        self.assertIn("StartCalendarInterval", mac.plist_path("backup").read_text())
        logs = mac.BASE / "logs"
        mac.private_dir(logs)
        log = logs / "web.log"
        log.write_bytes(b"x" * (mac.MAX_LOG_BYTES + 1))
        mac.rotate_log(log)
        self.assertFalse(log.exists())
        self.assertEqual(log.with_name("web.log.1").stat().st_size, mac.MAX_LOG_BYTES + 1)

    def test_release_snapshot_preserves_code_and_omits_private_files(self):
        mac = self.module
        source = Path(self.temp.name).parent / ("sentinel-source-" + Path(self.temp.name).name)
        try:
            (source / "apps/web/.next").mkdir(parents=True)
            (source / "node_modules/tsx").mkdir(parents=True)
            (source / "scripts").mkdir()
            (source / "runtime-history").mkdir()
            (source / "apps/web/.next/BUILD_ID").write_text("built")
            (source / "scripts/mac-release.py").write_text("code")
            (source / ".env.private.local").write_text("secret")
            (source / "runtime-history/data").write_text("private")
            copied = mac.snapshot(source)
            self.assertTrue((copied / "apps/web/.next/BUILD_ID").exists())
            self.assertTrue((copied / "scripts/mac-release.py").exists())
            self.assertFalse((copied / ".env.private.local").exists())
            self.assertFalse((copied / "runtime-history").exists())
        finally:
            shutil.rmtree(source, ignore_errors=True)

    def test_child_shutdown_uses_fast_database_signal_and_bounds_exit(self):
        mac = self.module
        code = """import signal, sys, time
from pathlib import Path
def handle(sig, frame):
    Path(sys.argv[1]).write_text(signal.Signals(sig).name)
    raise SystemExit(0)
signal.signal(signal.SIGINT, handle)
signal.signal(signal.SIGTERM, handle)
Path(sys.argv[1] + '.ready').touch()
while True: time.sleep(0.1)
"""
        for service, expected in (("postgres", "SIGINT"), ("web", "SIGTERM")):
            marker = Path(self.temp.name) / service
            process = subprocess.Popen([sys.executable, "-c", code, str(marker)],
                                       start_new_session=True, stdout=subprocess.DEVNULL)
            try:
                for _ in range(100):
                    if marker.with_name(marker.name + ".ready").exists(): break
                    time.sleep(0.02)
                self.assertTrue(marker.with_name(marker.name + ".ready").exists())
                mac.shutdown_child(process, service, timeout=1)
                self.assertEqual(marker.read_text(), expected)
                self.assertIsNotNone(process.poll())
            finally:
                if process.poll() is None:
                    process.kill()
                    process.wait(timeout=2)

    def test_child_shutdown_kills_unresponsive_owned_group(self):
        marker = Path(self.temp.name) / "hung.ready"
        code = """import signal, sys, time
from pathlib import Path
signal.signal(signal.SIGTERM, signal.SIG_IGN)
Path(sys.argv[1]).touch()
while True: time.sleep(0.1)
"""
        process = subprocess.Popen([sys.executable, "-c", code, str(marker)],
                                   start_new_session=True, stdout=subprocess.DEVNULL)
        try:
            for _ in range(100):
                if marker.exists(): break
                time.sleep(0.02)
            self.assertTrue(marker.exists())
            self.module.shutdown_child(process, "worker", timeout=0.2)
            self.assertEqual(process.returncode, -9)
        finally:
            if process.poll() is None:
                process.kill()
                process.wait(timeout=2)


if __name__ == "__main__":
    unittest.main()
