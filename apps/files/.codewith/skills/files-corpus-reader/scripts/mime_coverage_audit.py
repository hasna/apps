#!/usr/bin/env python3
"""Redacted MIME coverage audit for open-files.

Outputs aggregate JSON only: no filenames, paths, object keys, extracted text, or
private row payloads.
"""

from __future__ import annotations

import argparse
import json
import os
import sqlite3
from pathlib import Path
from typing import Any

from lane_resolver import corpus_lane_for


def default_db_path() -> Path:
    if os.environ.get("HASNA_FILES_DB_PATH"):
        return Path(os.environ["HASNA_FILES_DB_PATH"]).expanduser()
    if os.environ.get("FILES_DB_PATH"):
        return Path(os.environ["FILES_DB_PATH"]).expanduser()
    data_dir = Path(os.environ.get("HASNA_FILES_DATA_DIR", "~/.hasna/files")).expanduser()
    return data_dir / "files.db"


def lane_for_mime(mime: str) -> str:
    return corpus_lane_for(mime)


def fetch_rows(db: sqlite3.Connection) -> list[sqlite3.Row]:
    db.row_factory = sqlite3.Row
    return db.execute(
        """
        SELECT
          f.mime AS mime,
          COUNT(*) AS count,
          COALESCE(SUM(f.size), 0) AS bytes,
          COALESCE(NULLIF(r.owner, ''), '_unassigned') AS owner,
          COALESCE(r.review_status, '_none') AS review_status
        FROM files f
        LEFT JOIN file_organization_reviews r ON r.file_id = f.id
        WHERE f.status = 'active'
        GROUP BY f.mime, owner, review_status
        ORDER BY count DESC, bytes DESC, mime ASC
        """
    ).fetchall()


def main() -> int:
    parser = argparse.ArgumentParser(description="Redacted MIME coverage audit for open-files.")
    parser.add_argument("--db", default=str(default_db_path()), help="SQLite DB path")
    parser.add_argument("--top", type=int, default=50, help="Top MIME rows to include")
    args = parser.parse_args()

    db_path = Path(args.db).expanduser()
    if not db_path.exists():
        raise SystemExit(f"database not found: {db_path}")

    db = sqlite3.connect(db_path)
    rows = fetch_rows(db)

    by_lane: dict[str, dict[str, int]] = {}
    by_mime: list[dict[str, Any]] = []
    for row in rows:
        lane = lane_for_mime(row["mime"])
        lane_entry = by_lane.setdefault(lane, {"count": 0, "bytes": 0})
        lane_entry["count"] += int(row["count"])
        lane_entry["bytes"] += int(row["bytes"])
        by_mime.append({
            "mime": row["mime"],
            "lane": lane,
            "owner": row["owner"],
            "review_status": row["review_status"],
            "count": int(row["count"]),
            "bytes": int(row["bytes"]),
        })

    output = {
        "db": str(db_path),
        "redaction": "aggregate-only; no filenames, paths, object keys, extracted text, or row payloads",
        "total_count": sum(v["count"] for v in by_lane.values()),
        "total_bytes": sum(v["bytes"] for v in by_lane.values()),
        "by_lane": [
            {"lane": lane, **values}
            for lane, values in sorted(by_lane.items(), key=lambda item: (-item[1]["count"], item[0]))
        ],
        "top_mime_owner_status": by_mime[: args.top],
    }
    print(json.dumps(output, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
