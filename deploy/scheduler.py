"""
Data worker for the VPS deployment (replaces .github/workflows/fetch-parking-data.yml).

    python deploy/scheduler.py serve                 long-running: hourly fetch + nightly backup
    python deploy/scheduler.py run                   one fetch, now
    python deploy/scheduler.py import-snapshots DIR  merge old YYYY/MM/DD.json day files into history.db
    python deploy/scheduler.py merge OTHER.db        merge another history DB into history.db
    python deploy/scheduler.py backup                snapshot history.db into backups/
    python deploy/scheduler.py stats                 row counts + date range of history.db

Volumes (see docker-compose.yaml):

    $PARKING_PUBLIC_DIR   latest.json, parking_facilities.geojson, summary.json,
                          municipalities/  (served by nginx, rewritten every hour)
    $PARKING_STATE_DIR    history.db + backups/  <- irreplaceable
    $PARKING_CACHE_DIR    RDW index/static + geocode caches (safe to delete)

Imports and merges only fill gaps, so they are safe to re-run against the live DB.
"""

from __future__ import annotations

import fcntl
import os
import subprocess
import sys
import time
from contextlib import contextmanager
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

APP_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(APP_DIR / "scripts"))
import history  # noqa: E402

PUBLIC_DIR = Path(os.environ.get("PARKING_PUBLIC_DIR", "/srv/parking/public"))
STATE_DIR = Path(os.environ.get("PARKING_STATE_DIR", "/srv/parking/state"))
HISTORY_DB = Path(os.environ.get("PARKING_HISTORY_DB", STATE_DIR / "history.db"))
LOCK_FILE = STATE_DIR / ".worker.lock"

TZ = ZoneInfo("Europe/Amsterdam")
# Same slot as the GitHub Action (minute 5 of every hour).
FETCH_MINUTE = int(os.environ.get("PARKING_FETCH_MINUTE", "5"))
FETCH_TIMEOUT_MIN = 15
BACKUP_AT = os.environ.get("PARKING_BACKUP_AT", "03:30")
KEEP_BACKUPS = int(os.environ.get("PARKING_BACKUP_KEEP", "14"))


def log(message: str) -> None:
    print(f"[{datetime.now(TZ):%Y-%m-%d %H:%M:%S}] {message}", flush=True)


@contextmanager
def worker_lock():
    """One fetch at a time: a manual run must not race the scheduled one."""
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    with open(LOCK_FILE, "w") as handle:
        try:
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise SystemExit("another fetch is in progress")
        yield


def run_fetch() -> int:
    env = {**os.environ, "PARKING_PUBLIC_DIR": str(PUBLIC_DIR), "PARKING_HISTORY_DB": str(HISTORY_DB)}
    log("▶ fetch_parking_data.py")
    started = time.monotonic()
    try:
        with worker_lock():
            code = subprocess.run(
                [sys.executable, "scripts/fetch_parking_data.py"],
                cwd=APP_DIR, env=env, timeout=FETCH_TIMEOUT_MIN * 60,
            ).returncode
    except subprocess.TimeoutExpired:
        log(f"✗ fetch timed out after {FETCH_TIMEOUT_MIN} min")
        return 124
    log(f"{'✓' if code == 0 else '✗'} fetch exit {code} ({time.monotonic() - started:.0f}s)")
    return code


def run_backup() -> None:
    target = history.backup(HISTORY_DB, STATE_DIR / "backups", KEEP_BACKUPS)
    log(f"backup {target.name} ({target.stat().st_size / 1e6:.1f} MB)")


def next_fetch(now: datetime) -> datetime:
    slot = now.replace(minute=FETCH_MINUTE, second=0, microsecond=0)
    return slot if slot > now else slot + timedelta(hours=1)


def next_backup(now: datetime) -> datetime:
    hh, mm = (int(x) for x in BACKUP_AT.split(":"))
    slot = now.replace(hour=hh, minute=mm, second=0, microsecond=0)
    return slot if slot > now else slot + timedelta(days=1)


def serve() -> None:
    log(f"worker up: fetch hourly at :{FETCH_MINUTE:02d}, backup daily at {BACKUP_AT} ({TZ.key})")
    # Empty volume (first deploy) or a stale one (worker was down): fetch right away.
    geojson = PUBLIC_DIR / "parking_facilities.geojson"
    if not geojson.exists() or time.time() - geojson.stat().st_mtime > 3600:
        run_fetch()
    fetch_at = next_fetch(datetime.now(TZ))
    backup_at = next_backup(datetime.now(TZ))
    while True:
        now = datetime.now(TZ)
        if now >= fetch_at:
            run_fetch()
            fetch_at = next_fetch(datetime.now(TZ))
        if now >= backup_at:
            try:
                if HISTORY_DB.exists():
                    run_backup()
            except Exception as e:  # a failed backup must not stop the fetches
                log(f"✗ backup failed: {e}")
            backup_at = next_backup(datetime.now(TZ))
        time.sleep(max(1, min((fetch_at - datetime.now(TZ)).total_seconds(), 60)))


def main(argv: list[str]) -> None:
    cmd = argv[0] if argv else "serve"
    if cmd == "serve":
        serve()
    elif cmd == "run":
        sys.exit(run_fetch())
    elif cmd == "import-snapshots" and len(argv) == 2:
        log(f"import {argv[1]}: {history.import_day_files(HISTORY_DB, Path(argv[1]))}")
        log(f"history: {history.stats(HISTORY_DB)}")
    elif cmd == "merge" and len(argv) == 2:
        log(f"merge {argv[1]}: {history.merge_db(HISTORY_DB, argv[1])}")
        log(f"history: {history.stats(HISTORY_DB)}")
    elif cmd == "backup":
        run_backup()
    elif cmd == "stats":
        print(history.stats(HISTORY_DB))
    else:
        raise SystemExit(__doc__)


if __name__ == "__main__":
    main(sys.argv[1:])
