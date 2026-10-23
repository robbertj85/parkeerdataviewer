"""
Hourly occupancy history (SQLite). Replaces the per-day snapshot JSON files
(webapp/public/data/snapshots/YYYY/MM/DD.json) that used to be committed to git
every hour.

    facility  id <-> RDW facility uuid
    snap_hour one row per hourly run: UTC day + hour, timestamp, facility count
    fac_day   one row per (facility, UTC day): 24 hourly slots of SLOT bytes

Days and hours are UTC, like the old day files, so an imported file maps 1:1.
A slot is struct "<iiB": vacantSpaces, parkingCapacity, flags (see F_*).
~330 facilities x 365 days x 216 bytes ≈ 26 MB/year, no rollup needed.

The webapp reads this file read-only (webapp/lib/history.ts; keep the layout
in sync). WAL mode, so the hourly writer never blocks readers.
"""

from __future__ import annotations

import json
import os
import sqlite3
import struct
from datetime import date, datetime, timezone
from pathlib import Path

SLOT = struct.Struct("<iiB")
HOURS = 24
F_SAMPLE, F_V, F_C, F_O_SET, F_O, F_F_SET, F_F = (1 << i for i in range(7))
INT32 = (-(2**31), 2**31 - 1)

EMPTY_DAY = bytes(SLOT.size * HOURS)


def connect(path: str | os.PathLike, readonly: bool = False, immutable: bool = False) -> sqlite3.Connection:
    """immutable: a file nobody writes (an uploaded import DB); leaves no -wal/-shm behind."""
    if readonly or immutable:
        return sqlite3.connect(f"file:{path}?mode=ro{'&immutable=1' if immutable else ''}", uri=True, timeout=120)
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(path, timeout=120)
    db.execute("PRAGMA journal_mode = WAL")
    db.execute("PRAGMA synchronous = NORMAL")
    db.execute("PRAGMA busy_timeout = 120000")
    db.executescript(
        """
        CREATE TABLE IF NOT EXISTS facility (
          id   INTEGER PRIMARY KEY,
          uuid TEXT NOT NULL UNIQUE
        );
        CREATE TABLE IF NOT EXISTS snap_hour (
          day  INTEGER NOT NULL,   -- days since 1970-01-01 (UTC date)
          hour INTEGER NOT NULL,   -- 0-23 UTC
          ts   TEXT    NOT NULL,   -- ISO timestamp of the run
          n    INTEGER NOT NULL,   -- facilities in the snapshot
          PRIMARY KEY (day, hour)
        ) WITHOUT ROWID;
        CREATE TABLE IF NOT EXISTS fac_day (
          fac  INTEGER NOT NULL REFERENCES facility(id),
          day  INTEGER NOT NULL,
          data BLOB    NOT NULL,   -- 24 x SLOT
          PRIMARY KEY (fac, day)
        ) WITHOUT ROWID;
        CREATE INDEX IF NOT EXISTS fac_day_day ON fac_day(day);
        """
    )
    return db


def day_number(iso_date: str) -> int:
    return date.fromisoformat(iso_date).toordinal() - date(1970, 1, 1).toordinal()


def day_string(day: int) -> str:
    return date.fromordinal(day + date(1970, 1, 1).toordinal()).isoformat()


def _int32(value) -> int | None:
    if value is None or isinstance(value, bool):
        return None
    try:
        n = int(value)
    except (TypeError, ValueError):
        return None
    return n if INT32[0] <= n <= INT32[1] else None


def _bool(value) -> bool | None:
    # Some feeds send "true"/"false" strings (and numbers as strings, see _int32).
    if isinstance(value, bool):
        return value
    if isinstance(value, str) and value.lower() in ("true", "false"):
        return value.lower() == "true"
    return None


def encode_slot(entry: dict) -> bytes:
    """Compact snapshot entry {v, c, o, f} (as in the old day files) -> slot."""
    v, c = _int32(entry.get("v")), _int32(entry.get("c"))
    flags = F_SAMPLE
    if v is not None:
        flags |= F_V
    if c is not None:
        flags |= F_C
    for key, is_set, bit in (("o", F_O_SET, F_O), ("f", F_F_SET, F_F)):
        value = _bool(entry.get(key))
        if value is not None:
            flags |= is_set | (bit if value else 0)
    return SLOT.pack(v or 0, c or 0, flags)


def decode_slot(buf: bytes, hour: int) -> dict | None:
    v, c, flags = SLOT.unpack_from(buf, hour * SLOT.size)
    if not flags & F_SAMPLE:
        return None
    entry = {}
    if flags & F_V:
        entry["v"] = v
    if flags & F_C:
        entry["c"] = c
    if flags & F_O_SET:
        entry["o"] = bool(flags & F_O)
    if flags & F_F_SET:
        entry["f"] = bool(flags & F_F)
    return entry


class Recorder:
    """Writes hourly snapshots. Call inside a transaction (`with db:`).

    replace=True  live snapshot: the hour is overwritten (a re-run in the same
                  hour wins, like the old day file).
    replace=False import/merge: existing samples are kept, only gaps are filled,
                  so imports are re-runnable.
    """

    def __init__(self, db: sqlite3.Connection, replace: bool):
        self.db = db
        self.replace = replace
        self.ids: dict[str, int] = {}

    def _fac(self, uuid: str) -> int:
        fid = self.ids.get(uuid)
        if fid is None:
            self.db.execute("INSERT OR IGNORE INTO facility (uuid) VALUES (?)", (uuid,))
            fid = self.db.execute("SELECT id FROM facility WHERE uuid = ?", (uuid,)).fetchone()[0]
            self.ids[uuid] = fid
        return fid

    def snapshot(self, day: int, hour: int, ts: str, facilities: dict[str, dict]) -> int:
        """Record one hourly snapshot; returns the number of slots written."""
        verb = "REPLACE" if self.replace else "IGNORE"
        self.db.execute(
            f"INSERT OR {verb} INTO snap_hour (day, hour, ts, n) VALUES (?, ?, ?, ?)",
            (day, hour, ts, len(facilities)),
        )
        written = 0
        offset = hour * SLOT.size
        for uuid, entry in facilities.items():
            fid = self._fac(uuid)
            row = self.db.execute("SELECT data FROM fac_day WHERE fac = ? AND day = ?", (fid, day)).fetchone()
            buf = bytearray(row[0] if row else EMPTY_DAY)
            has_sample = SLOT.unpack_from(buf, offset)[2] & F_SAMPLE
            if has_sample and not self.replace:
                continue
            buf[offset : offset + SLOT.size] = encode_slot(entry)
            self.db.execute("INSERT OR REPLACE INTO fac_day (fac, day, data) VALUES (?, ?, ?)", (fid, day, bytes(buf)))
            written += 1
        return written


def record_live(db_path, facilities: dict[str, dict], now: datetime | None = None) -> None:
    now = now or datetime.now(timezone.utc)
    db = connect(db_path)
    try:
        with db:
            Recorder(db, replace=True).snapshot(
                day_number(now.date().isoformat()), now.hour, now.isoformat(), facilities
            )
    finally:
        db.close()


def import_day_files(db_path, snapshots_dir: Path) -> dict:
    """Merge old YYYY/MM/DD.json day files into the DB (gaps only)."""
    db = connect(db_path)
    rec = Recorder(db, replace=False)
    files = sorted(snapshots_dir.glob("[0-9][0-9][0-9][0-9]/[0-9][0-9]/[0-9][0-9].json"))
    stats = {"files": 0, "hours": 0, "slots": 0}
    try:
        for path in files:
            daily = json.loads(path.read_text())
            day = day_number(daily["date"])
            with db:
                for hour, snap in daily.get("snapshots", {}).items():
                    stats["slots"] += rec.snapshot(day, int(hour), snap.get("timestamp", ""), snap.get("facilities", {}))
                    stats["hours"] += 1
            stats["files"] += 1
    finally:
        db.close()
    return stats


def merge_db(db_path, other_path) -> dict:
    """Merge another history DB into this one (gaps only)."""
    db = connect(db_path)
    other = connect(other_path, immutable=True)
    rec = Recorder(db, replace=False)
    stats = {"hours": 0, "slots": 0}
    try:
        uuids = dict(other.execute("SELECT id, uuid FROM facility"))
        for day, hour, ts, _n in other.execute("SELECT day, hour, ts, n FROM snap_hour ORDER BY day, hour").fetchall():
            facs = {}
            for fac, data in other.execute("SELECT fac, data FROM fac_day WHERE day = ?", (day,)):
                entry = decode_slot(data, hour)
                if entry is not None:
                    facs[uuids[fac]] = entry
            with db:
                stats["slots"] += rec.snapshot(day, hour, ts, facs)
            stats["hours"] += 1
    finally:
        other.close()
        db.close()
    return stats


def day_snapshots(db: sqlite3.Connection, iso_date: str) -> dict | None:
    """Rebuild an old-style day file (used by tests and the export check)."""
    day = day_number(iso_date)
    hours = db.execute("SELECT hour, ts FROM snap_hour WHERE day = ? ORDER BY hour", (day,)).fetchall()
    if not hours:
        return None
    rows = db.execute(
        "SELECT f.uuid, d.data FROM fac_day d JOIN facility f ON f.id = d.fac WHERE d.day = ?", (day,)
    ).fetchall()
    out = {"date": iso_date, "snapshots": {}}
    for hour, ts in hours:
        facs = {}
        for uuid, data in rows:
            entry = decode_slot(data, hour)
            if entry is not None:
                facs[uuid] = entry
        out["snapshots"][f"{hour:02d}"] = {"timestamp": ts, "facility_count": len(facs), "facilities": facs}
    return out


def backup(db_path, backup_dir: Path, keep: int = 14) -> Path:
    backup_dir.mkdir(parents=True, exist_ok=True)
    target = backup_dir / f"history-{datetime.now(timezone.utc):%Y%m%d}.db"
    src = connect(db_path)
    dst = sqlite3.connect(target)
    try:
        src.backup(dst)
    finally:
        dst.close()
        src.close()
    for old in sorted(backup_dir.glob("history-*.db"))[:-keep]:
        old.unlink()
    return target


def stats(db_path) -> dict:
    db = connect(db_path, readonly=True)
    try:
        lo, hi = db.execute("SELECT MIN(day), MAX(day) FROM snap_hour").fetchone()
        return {
            "facilities": db.execute("SELECT COUNT(*) FROM facility").fetchone()[0],
            "hours": db.execute("SELECT COUNT(*) FROM snap_hour").fetchone()[0],
            "fac_days": db.execute("SELECT COUNT(*) FROM fac_day").fetchone()[0],
            "from": day_string(lo) if lo is not None else None,
            "to": day_string(hi) if hi is not None else None,
        }
    finally:
        db.close()
