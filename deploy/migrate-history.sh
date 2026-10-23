#!/usr/bin/env bash
# Port the hourly history that the GitHub Action committed to git into the
# server's history.db. Safe to run repeatedly (hour-level merge: existing
# samples win, only gaps are filled).
#
#   ./deploy/migrate-history.sh            # REV=origin/main by default
#
# 1. fetch origin and extract the last version of EVERY snapshot day file ever
#    committed (also ones that were deleted/untracked later: git kept them),
# 2. build an import DB from them locally (scripts/history.py),
# 3. copy it into the worker container's state volume and merge it there.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$ROOT/deploy/lib.sh"
REV="${REV:-origin/main}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

WORKER="$(require_container worker)"

echo "==> git fetch + dagbestanden uit $REV"
git -C "$ROOT" fetch -q origin
python3 "$ROOT/deploy/git_snapshots.py" "$ROOT" "$REV" "$TMP/snapshots"
PARKING_STATE_DIR="$TMP" PARKING_HISTORY_DB="$TMP/import.db" \
  python3 "$ROOT/deploy/scheduler.py" import-snapshots "$TMP/snapshots"

echo "==> uploaden naar $WORKER ($(du -h "$TMP/import.db" | cut -f1))"
REMOTE_TMP="/tmp/pdv-import-$$.db"
scp -q "$TMP/import.db" "$HOST:$REMOTE_TMP"
ssh "$HOST" "docker cp '$REMOTE_TMP' '$WORKER:/srv/parking/state/import.db' && rm -f '$REMOTE_TMP'"

echo "==> mergen in live history.db"
ssh "$HOST" "docker exec '$WORKER' python deploy/scheduler.py merge /srv/parking/state/import.db \
  && docker exec '$WORKER' rm -f /srv/parking/state/import.db /srv/parking/state/import.db-wal /srv/parking/state/import.db-shm"
echo "==> klaar"
