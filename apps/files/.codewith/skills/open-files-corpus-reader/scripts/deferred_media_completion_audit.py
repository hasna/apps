#!/usr/bin/env python3
"""Audit deferred audio/video completion buckets without reading media content.

The output is aggregate-only. It does not print filenames, paths, object keys,
source refs, extracted text, transcripts, row payloads, or private IDs.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sqlite3
import time
from pathlib import Path
from typing import Any

from lane_resolver import corpus_lane_for


MEDIA_LANES = {"needs_transcription", "needs_video_pipeline"}


def default_db_path() -> Path:
    if os.environ.get("HASNA_FILES_DB_PATH"):
        return Path(os.environ["HASNA_FILES_DB_PATH"]).expanduser()
    if os.environ.get("FILES_DB_PATH"):
        return Path(os.environ["FILES_DB_PATH"]).expanduser()
    data_dir = Path(os.environ.get("HASNA_FILES_DATA_DIR", "~/.hasna/files")).expanduser()
    return data_dir / "files.db"


def now_utc() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def text_sha256(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def hash_private_ids(ids: list[str]) -> str:
    digest = hashlib.sha256()
    for private_id in sorted(ids):
        digest.update(private_id.encode("utf-8"))
        digest.update(b"\n")
    return digest.hexdigest()


def table_exists(db: sqlite3.Connection, table: str) -> bool:
    row = db.execute(
        "SELECT 1 FROM sqlite_master WHERE type IN ('table', 'view') AND name = ?",
        (table,),
    ).fetchone()
    return row is not None


def size_bucket(size: int) -> str:
    if size < 16 * 1024:
        return "small-lt16k"
    if size < 256 * 1024:
        return "small-16k-256k"
    if size < 1024 * 1024:
        return "medium-256k-1m"
    if size < 10 * 1024 * 1024:
        return "large-1m-10m"
    if size < 100 * 1024 * 1024:
        return "huge-10m-100m"
    return "massive-gte100m"


def load_private_id_jsonl(path: Path) -> list[str]:
    ids: list[str] = []
    with path.open("r", encoding="utf-8") as handle:
        for line_no, line in enumerate(handle, start=1):
            stripped = line.strip()
            if not stripped:
                continue
            try:
                value = json.loads(stripped)
            except json.JSONDecodeError as exc:
                raise SystemExit(f"invalid queued manifest JSONL at line {line_no}") from exc
            if not isinstance(value, dict):
                raise SystemExit(f"invalid queued manifest JSONL at line {line_no}: row is not an object")
            private_id = value.get("file_id")
            if isinstance(private_id, str) and private_id:
                ids.append(private_id)
    return ids


def queued_private_ids(paths: list[str] | None) -> set[str]:
    queued: set[str] = set()
    for raw_path in paths or []:
        path = Path(raw_path).expanduser().resolve()
        if not path.exists():
            raise SystemExit(f"queued manifest not found: {path}")
        queued.update(load_private_id_jsonl(path))
    return queued


def load_media_rows(db_path: Path, include_duplicates: bool) -> list[dict[str, Any]]:
    db = sqlite3.connect(db_path)
    db.row_factory = sqlite3.Row
    has_reviews = table_exists(db, "file_organization_reviews")
    has_search = table_exists(db, "file_search_documents")
    review_join = "LEFT JOIN file_organization_reviews r ON r.file_id = f.id" if has_reviews else ""
    review_columns = """
      COALESCE(NULLIF(r.owner, ''), '_unassigned') AS owner,
      COALESCE(r.review_status, '_none') AS review_status
    """ if has_reviews else """
      '_unassigned' AS owner,
      '_none' AS review_status
    """
    search_join = """
      LEFT JOIN (
        SELECT
          file_id,
          COUNT(*) AS document_count,
          SUM(CASE WHEN status IN ('ready', 'partial') THEN 1 ELSE 0 END) AS indexed_count,
          SUM(CASE WHEN status = 'stale' THEN 1 ELSE 0 END) AS stale_count,
          SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS error_count,
          SUM(CASE WHEN status = 'unsupported' THEN 1 ELSE 0 END) AS unsupported_count,
          SUM(CASE WHEN kind = 'transcript' THEN 1 ELSE 0 END) AS transcript_count,
          SUM(CASE WHEN kind = 'vision_summary' THEN 1 ELSE 0 END) AS keyframe_summary_count
        FROM file_search_documents
        GROUP BY file_id
      ) sd ON sd.file_id = f.id
    """ if has_search else ""
    search_columns = """
      COALESCE(sd.document_count, 0) AS document_count,
      COALESCE(sd.indexed_count, 0) AS indexed_count,
      COALESCE(sd.stale_count, 0) AS stale_count,
      COALESCE(sd.error_count, 0) AS error_count,
      COALESCE(sd.unsupported_count, 0) AS unsupported_count,
      COALESCE(sd.transcript_count, 0) AS transcript_count,
      COALESCE(sd.keyframe_summary_count, 0) AS keyframe_summary_count
    """ if has_search else """
      0 AS document_count,
      0 AS indexed_count,
      0 AS stale_count,
      0 AS error_count,
      0 AS unsupported_count,
      0 AS transcript_count,
      0 AS keyframe_summary_count
    """
    duplicate_clause = "" if include_duplicates or not has_reviews else "AND COALESCE(r.review_status, '') != 'duplicate'"
    rows = db.execute(
        f"""
        SELECT
          f.id AS private_id,
          f.mime AS mime,
          f.ext AS ext,
          f.size AS size,
          {review_columns},
          {search_columns}
        FROM files f
        {review_join}
        {search_join}
        WHERE f.status = 'active'
          {duplicate_clause}
        """
    ).fetchall()
    db.close()
    media_rows: list[dict[str, Any]] = []
    for row in rows:
        lane = corpus_lane_for(row["mime"], None, row["ext"])
        if lane not in MEDIA_LANES:
            continue
        media_rows.append({
            "private_id": row["private_id"],
            "lane": lane,
            "media_kind": "audio" if lane == "needs_transcription" else "video",
            "owner": row["owner"],
            "review_status": row["review_status"],
            "size": int(row["size"] or 0),
            "size_bucket": size_bucket(int(row["size"] or 0)),
            "document_count": int(row["document_count"] or 0),
            "indexed_count": int(row["indexed_count"] or 0),
            "stale_count": int(row["stale_count"] or 0),
            "error_count": int(row["error_count"] or 0),
            "unsupported_count": int(row["unsupported_count"] or 0),
            "transcript_count": int(row["transcript_count"] or 0),
            "keyframe_summary_count": int(row["keyframe_summary_count"] or 0),
        })
    return media_rows


def completion_bucket(row: dict[str, Any], queued: set[str]) -> str:
    if row.get("review_status") == "duplicate":
        return "duplicate_preserve"
    private_id = row.get("private_id")
    if isinstance(private_id, str) and private_id in queued and int(row.get("indexed_count") or 0) == 0:
        return "queued"
    if int(row.get("indexed_count") or 0) > 0:
        return "indexed"
    if int(row.get("error_count") or 0) > 0:
        return "failed"
    if int(row.get("document_count") or 0) > 0:
        return "extracted"
    return "deferred"


def retry_bucket(row: dict[str, Any], queued: set[str]) -> str:
    private_id = row.get("private_id")
    document_count = int(row.get("document_count") or 0)
    error_count = int(row.get("error_count") or 0)
    if document_count > 1 or (error_count > 0 and isinstance(private_id, str) and private_id in queued):
        return "retried"
    return "not_retried"


def bump(table: dict[str, dict[str, int]], key: str, row: dict[str, Any]) -> None:
    entry = table.setdefault(key, {"count": 0, "bytes": 0})
    entry["count"] += 1
    entry["bytes"] += int(row.get("size") or 0)


def rows_out(table: dict[str, dict[str, int]]) -> list[dict[str, Any]]:
    rows = [{"key": key, **value} for key, value in table.items()]
    rows.sort(key=lambda item: (-item["count"], -item["key"].count("|"), item["key"]))
    return rows


def build_summary(rows: list[dict[str, Any]], queued: set[str], db_path: Path, queued_manifest_count: int) -> dict[str, Any]:
    by_lane: dict[str, dict[str, int]] = {}
    by_media_kind: dict[str, dict[str, int]] = {}
    by_completion: dict[str, dict[str, int]] = {}
    by_lane_completion: dict[str, dict[str, int]] = {}
    by_retry: dict[str, dict[str, int]] = {}
    by_owner: dict[str, dict[str, int]] = {}
    by_size: dict[str, dict[str, int]] = {}
    active_private_ids: list[str] = []
    queued_media_ids = 0
    for row in rows:
        active_private_ids.append(str(row["private_id"]))
        completion = completion_bucket(row, queued)
        retry = retry_bucket(row, queued)
        if row["private_id"] in queued:
            queued_media_ids += 1
        bump(by_lane, str(row["lane"]), row)
        bump(by_media_kind, str(row["media_kind"]), row)
        bump(by_completion, completion, row)
        bump(by_lane_completion, f"{row['lane']}|{completion}", row)
        bump(by_retry, retry, row)
        bump(by_owner, str(row.get("owner") or "_unassigned"), row)
        bump(by_size, f"{row['lane']}|{row['size_bucket']}", row)

    required_keys = ["deferred", "queued", "extracted", "indexed", "failed", "duplicate_preserve"]
    for key in required_keys:
        by_completion.setdefault(key, {"count": 0, "bytes": 0})
    for key in ("retried", "not_retried"):
        by_retry.setdefault(key, {"count": 0, "bytes": 0})
    active_count = len(rows)
    indexed_count = by_completion.get("indexed", {}).get("count", 0)
    unresolved_count = active_count - indexed_count - by_completion.get("duplicate_preserve", {}).get("count", 0)
    if active_count == 0:
        status = "no_media"
    elif unresolved_count == 0:
        status = "complete"
    else:
        status = "deferred"
    return {
        "kind": "open_files_deferred_media_completion_audit",
        "version": 1,
        "generated_at": now_utc(),
        "status": status,
        "db_sha256": text_sha256(str(db_path)),
        "queued_manifest_count": queued_manifest_count,
        "queued_private_ids_sha256": hash_private_ids(sorted(queued)) if queued else None,
        "active_media_private_ids_sha256": hash_private_ids(active_private_ids) if active_private_ids else None,
        "totals": {
            "active_media_files": active_count,
            "active_media_bytes": sum(int(row.get("size") or 0) for row in rows),
            "queued_media_files": queued_media_ids,
            "indexed_media_files": indexed_count,
            "unresolved_media_files": unresolved_count,
        },
        "completion_buckets": rows_out(by_completion),
        "retry_buckets": rows_out(by_retry),
        "by_lane": rows_out(by_lane),
        "by_media_kind": rows_out(by_media_kind),
        "by_lane_completion": rows_out(by_lane_completion),
        "by_owner": rows_out(by_owner),
        "by_lane_size": rows_out(by_size),
        "completion_gate": {
            "final_media_pass_required": unresolved_count > 0,
            "complete": unresolved_count == 0,
            "requires_transcription_for_audio": by_lane.get("needs_transcription", {}).get("count", 0) > 0,
            "requires_transcription_and_keyframes_for_video": by_lane.get("needs_video_pipeline", {}).get("count", 0) > 0,
            "cannot_hide_behind_boolean_deferral": True,
        },
        "redaction": "summary contains aggregate counts, byte totals, and hashes only; no file IDs, filenames, paths, object keys, source refs, transcripts, extracted text, row payloads, or secrets",
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Audit deferred media completion buckets without reading media files.")
    parser.add_argument("--db", default=str(default_db_path()), help="SQLite DB path")
    parser.add_argument("--queued-manifest", action="append", help="Private queued media JSONL manifest; may be repeated")
    parser.add_argument("--include-duplicates", action="store_true", help="Include duplicate-preserve media rows in totals")
    parser.add_argument("--output", help="Optional JSON summary output path")
    args = parser.parse_args()

    db_path = Path(args.db).expanduser().resolve()
    if not db_path.exists():
        raise SystemExit(f"database not found: {db_path}")
    queued = queued_private_ids(args.queued_manifest)
    rows = load_media_rows(db_path, args.include_duplicates)
    summary = build_summary(rows, queued, db_path, len(args.queued_manifest or []))
    output = json.dumps(summary, indent=2, sort_keys=True)
    print(output)
    if args.output:
        output_path = Path(args.output).expanduser().resolve()
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(output + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
