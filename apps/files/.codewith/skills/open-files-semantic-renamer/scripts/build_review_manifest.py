#!/usr/bin/env python3
"""Build a dry-run JSONL manifest for future semantic review agents.

The default manifest avoids private names, paths, object keys, and content.
Pass --include-private-metadata only for local artifacts intended for trusted
review agents.
"""

from __future__ import annotations

import argparse
import json
import os
import sqlite3
import sys
from pathlib import Path
from typing import Any

CORPUS_SCRIPT_DIR = Path(__file__).resolve().parents[2] / "files-corpus-reader" / "scripts"
sys.path.insert(0, str(CORPUS_SCRIPT_DIR))
from lane_resolver import expected_extension_for, semantic_lane_for  # noqa: E402


def default_db_path() -> Path:
    if os.environ.get("HASNA_FILES_DB_PATH"):
        return Path(os.environ["HASNA_FILES_DB_PATH"]).expanduser()
    if os.environ.get("FILES_DB_PATH"):
        return Path(os.environ["FILES_DB_PATH"]).expanduser()
    data_dir = Path(os.environ.get("HASNA_FILES_DATA_DIR", "~/.hasna/files")).expanduser()
    return data_dir / "files.db"


def content_strategy(lane: str) -> str:
    return {
        "text": "files_extract_snapshot",
        "pdf": "pdftotext_then_ai_summary",
        "office": "libreoffice_text_then_ai_summary",
        "image_ocr_or_vision": "vision_or_ocr_required",
        "audio_transcription": "speech_to_text_required",
        "video_transcription_keyframes": "speech_to_text_and_keyframes_required",
        "archive_inventory": "inventory_first_then_child_jobs",
        "design_raw_metadata_preview": "metadata_preview_or_vision_required",
        "metadata_only_or_unknown": "metadata_only_until_supported",
    }.get(lane, "metadata_only_until_supported")


def build_query(args: argparse.Namespace) -> tuple[str, list[Any]]:
    conditions = ["f.status = 'active'"]
    params: list[Any] = []
    if args.owner:
        conditions.append("r.owner = ?")
        params.append(args.owner)
    if args.status:
        conditions.append("r.review_status = ?")
        params.append(args.status)
    if not args.include_duplicates:
        conditions.append("COALESCE(r.review_status, '') != 'duplicate'")
    sql = f"""
        SELECT
          f.id AS file_id,
          f.name AS file_name,
          f.path AS file_path,
          f.ext AS ext,
          f.size AS size,
          f.mime AS mime,
          f.modified_at AS modified_at,
          r.id AS review_id,
          r.root_type AS root_type,
          r.owner AS owner,
          r.review_status AS review_status,
          r.acl_review_status AS acl_review_status,
          r.permission_scope AS permission_scope,
          r.permission_risk AS permission_risk,
          r.duplicate_group_id AS duplicate_group_id,
          r.target_path AS target_path,
          r.labels AS labels,
          v.id AS revision_id,
          v.source_ref AS source_ref,
          v.storage_provider AS storage_provider
        FROM files f
        LEFT JOIN file_organization_reviews r ON r.file_id = f.id
        LEFT JOIN file_versions v
          ON v.id = (
            SELECT id FROM file_versions latest
            WHERE latest.file_id = f.id
            ORDER BY latest.created_at DESC, latest.id DESC
            LIMIT 1
          )
        WHERE {" AND ".join(conditions)}
        ORDER BY COALESCE(r.owner, '_unassigned'), f.mime, f.size DESC, f.id
        LIMIT ?
    """
    params.append(args.scan_limit)
    return sql, params


def parse_labels(raw: str | None) -> list[str]:
    if not raw:
        return []
    try:
        value = json.loads(raw)
        return value if isinstance(value, list) else []
    except json.JSONDecodeError:
        return []


def row_to_job(row: sqlite3.Row, include_private: bool) -> dict[str, Any]:
    lane = semantic_lane_for(row["mime"], row["file_name"], row["ext"])
    job: dict[str, Any] = {
        "job_id": row["review_id"] or row["file_id"],
        "file_id": row["file_id"],
        "review_id": row["review_id"],
        "mime": row["mime"],
        "ext": row["ext"],
        "expected_ext": expected_extension_for(row["mime"], row["ext"]),
        "size": row["size"],
        "modified_at": row["modified_at"],
        "owner": row["owner"] or "intake",
        "root_type": row["root_type"] or "unknown",
        "review_status": row["review_status"] or "unreviewed",
        "duplicate_group_id": row["duplicate_group_id"],
        "storage_provider": row["storage_provider"] or "unknown",
        "extractor_lane": lane,
        "content_strategy": content_strategy(lane),
        "proposal_contract": {
            "canonical_name": "lowercase kebab-case filename with extension",
            "target_path": "owner/domain-or-project/file-name.ext",
            "confidence": "high|medium|low",
            "requires_review": True,
        },
    }
    if include_private:
        job["private_metadata"] = {
            "file_name": row["file_name"],
            "file_path": row["file_path"],
            "target_path": row["target_path"],
            "source_ref": row["source_ref"],
            "revision_id": row["revision_id"],
            "acl_review_status": row["acl_review_status"] or "unknown",
            "permission_scope": row["permission_scope"] or "unknown",
            "permission_risk": row["permission_risk"] or "unknown",
            "labels": parse_labels(row["labels"]),
        }
    return job


def main() -> int:
    parser = argparse.ArgumentParser(description="Build a JSONL manifest for future semantic review agents.")
    parser.add_argument("--db", default=str(default_db_path()), help="SQLite DB path")
    parser.add_argument("--output", required=True, help="Output JSONL manifest path")
    parser.add_argument("--owner", help="Filter by organization owner")
    parser.add_argument("--status", help="Filter by review_status")
    parser.add_argument("--lane", help="Filter by computed extractor lane")
    parser.add_argument("--limit", type=int, default=100, help="Maximum jobs to write")
    parser.add_argument("--scan-limit", type=int, help="Maximum database rows to scan before computed lane filtering; defaults to --limit")
    parser.add_argument("--include-duplicates", action="store_true", help="Include duplicate rows")
    parser.add_argument("--include-private-metadata", action="store_true", help="Write private names/paths to the local manifest artifact")
    args = parser.parse_args()
    if args.scan_limit is None:
        args.scan_limit = args.limit

    db_path = Path(args.db).expanduser()
    if not db_path.exists():
        raise SystemExit(f"database not found: {db_path}")

    db = sqlite3.connect(db_path)
    db.row_factory = sqlite3.Row
    sql, params = build_query(args)
    rows = db.execute(sql, params).fetchall()
    jobs = [row_to_job(row, args.include_private_metadata) for row in rows]
    if args.lane:
        jobs = [job for job in jobs if job["extractor_lane"] == args.lane]
    jobs = jobs[: args.limit]

    output_path = Path(args.output).expanduser().resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("w", encoding="utf-8") as handle:
        for job in jobs:
            handle.write(json.dumps(job, sort_keys=True) + "\n")

    by_lane: dict[str, int] = {}
    by_owner: dict[str, int] = {}
    for job in jobs:
        by_lane[job["extractor_lane"]] = by_lane.get(job["extractor_lane"], 0) + 1
        by_owner[job["owner"]] = by_owner.get(job["owner"], 0) + 1

    print(json.dumps({
        "status": "ready",
        "output": str(output_path),
        "jobs": len(jobs),
        "private_metadata": bool(args.include_private_metadata),
        "by_lane": by_lane,
        "by_owner": by_owner,
    }, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
