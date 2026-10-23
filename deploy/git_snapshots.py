"""
Write the last committed version of every snapshot day file ever in git
(webapp/public/data/snapshots/YYYY/MM/DD.json) to OUT_DIR, also for files that
were later deleted or untracked. Day files only grow during their day, so the
last version is the complete one.

    python deploy/git_snapshots.py REPO REV OUT_DIR
"""

import subprocess
import sys
from pathlib import Path

PREFIX = "webapp/public/data/snapshots/"


def git(repo, *args, **kw):
    return subprocess.run(["git", "-C", repo, *args], check=True, capture_output=True, **kw).stdout


def main(repo: str, rev: str, out_dir: str) -> None:
    out = Path(out_dir)
    # Newest commit first: the first time a path shows up is its last change.
    log = git(repo, "log", "--format=@%H", "--name-status", "--no-renames", rev, "--", PREFIX, text=True)
    latest: dict[str, str] = {}
    commit = None
    for line in log.splitlines():
        if line.startswith("@"):
            commit = line[1:]
        elif line.strip():
            status, path = line.split("\t", 1)
            if path.endswith(".json") and path not in latest:
                # Deleted in this commit: its content is in the parent.
                latest[path] = f"{commit}^:{path}" if status == "D" else f"{commit}:{path}"
    objects = list(latest.items())
    batch = git(repo, "cat-file", "--batch", input="".join(f"{spec}\n" for _, spec in objects).encode())
    pos = 0
    for path, spec in objects:
        header_end = batch.index(b"\n", pos)
        header = batch[pos:header_end].split()
        if header[1] == b"missing":
            raise SystemExit(f"missing in git: {spec}")
        size = int(header[2])
        data = batch[header_end + 1 : header_end + 1 + size]
        pos = header_end + 1 + size + 1
        target = out / path[len(PREFIX):]
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
    print(f"{len(objects)} day files from {rev}")


if __name__ == "__main__":
    main(*sys.argv[1:])
