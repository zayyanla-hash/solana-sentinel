"""Run validation with only the disposable test URL from private staging config."""
import os
from pathlib import Path
import subprocess
import sys
from urllib.parse import urlparse

root = Path(__file__).resolve().parents[1]
config = root / ".env.staging.local"
if not config.exists():
    raise SystemExit("Run staging:start first.")
values = dict(line.split("=", 1) for line in config.read_text().splitlines()
              if "=" in line and not line.lstrip().startswith("#"))
url = values.get("SENTINEL_TEST_DATABASE_URL")
if not url:
    raise SystemExit("Disposable staging test database is not configured.")
parsed = urlparse(url)
if parsed.hostname not in {"localhost", "127.0.0.1", "::1"} or "test" not in parsed.path.lower():
    raise SystemExit("Validation requires an explicitly named local test database.")
env = dict(os.environ, SENTINEL_TEST_DATABASE_URL=url)
command = "benchmark:monitor" if "--benchmark" in sys.argv else "validate"
raise SystemExit(subprocess.run(["pnpm", command], cwd=root, env=env).returncode)
