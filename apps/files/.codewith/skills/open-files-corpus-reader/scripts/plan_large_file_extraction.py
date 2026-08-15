#!/usr/bin/env python3
"""Plan approved large-file extraction work without downloading objects.

The planner writes private shard manifests containing file IDs and non-name
metadata needed by workers. Shared stdout and the plan JSON are aggregate-only:
no filenames, object keys, source refs, OCR text, transcripts, or row payloads.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sqlite3
import time
from pathlib import Path
from typing import Any

from lane_resolver import corpus_lane_for, expected_extension_for


DEFAULT_LANES = {
    "needs_pdf_extractor",
    "needs_office_extractor",
    "needs_archive_inventory",
    "needs_ocr_or_vision",
    "needs_design_raw_pipeline",
    "metadata_only_or_unknown",
}


def default_db_path() -> Path:
    if os.environ.get("HASNA_FILES_DB_PATH"):
        return Path(os.environ["HASNA_FILES_DB_PATH"]).expanduser()
    if os.environ.get("FILES_DB_PATH"):
        return Path(os.environ["FILES_DB_PATH"]).expanduser()
    data_dir = Path(os.environ.get("HASNA_FILES_DATA_DIR", "~/.hasna/files")).expanduser()
    return data_dir / "files.db"


def now_utc() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def text_sha256(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def approval_note_info(inline_note: str | None, note_file: str | None) -> dict[str, Any] | None:
    if inline_note and note_file:
        raise SystemExit("--approval-note and --approval-note-file are mutually exclusive")
    if inline_note:
        return {
            "source": "inline",
            "text": inline_note,
            "sha256": text_sha256(inline_note),
            "file": None,
            "file_sha256": None,
            "decision_id": None,
        }
    if not note_file:
        return None
    path = Path(note_file).expanduser().resolve()
    if not path.exists():
        raise SystemExit(f"approval note file not found: {path}")
    text = path.read_text(encoding="utf-8")
    try:
        value = json.loads(text)
    except json.JSONDecodeError:
        return {
            "source": "file_text",
            "text": None,
            "sha256": text_sha256(text),
            "file": str(path),
            "file_sha256": file_sha256(path),
            "decision_id": None,
        }
    if not isinstance(value, dict):
        raise SystemExit("--approval-note-file JSON must be an object")
    if value.get("status") != "approved":
        raise SystemExit("--approval-note-file JSON must have status approved")
    note_text = value.get("approval_note")
    note_hash = value.get("approval_note_sha256")
    if isinstance(note_text, str) and note_text:
        computed_hash = text_sha256(note_text)
        if isinstance(note_hash, str) and note_hash and note_hash != computed_hash:
            raise SystemExit("--approval-note-file approval_note_sha256 does not match approval_note")
        note_hash = computed_hash
    if not isinstance(note_hash, str) or not re.fullmatch(r"[a-f0-9]{64}", note_hash):
        raise SystemExit("--approval-note-file JSON must include approval_note_sha256 or approval_note")
    return {
        "source": "file_json",
        "text": None,
        "sha256": note_hash,
        "file": str(path),
        "file_sha256": file_sha256(path),
        "decision_id": value.get("decision_id") if isinstance(value.get("decision_id"), str) else None,
    }


def size_bucket(size: int) -> str:
    if size < 10 * 1024 * 1024:
        return "large-1m-10m"
    if size < 100 * 1024 * 1024:
        return "huge-10m-100m"
    if size < 1024 * 1024 * 1024:
        return "massive-100m-1g"
    return "extreme-gte1g"


def strategy_for(lane: str, size: int) -> dict[str, Any]:
    if lane == "needs_pdf_extractor":
        return {
            "strategy": "large-pdf-windowed-text",
            "bounded_action": "download-to-private-temp-then-pdftotext-page-window",
            "max_pages_per_pass": 20,
            "requires_approval": True,
        }
    if lane == "needs_office_extractor":
        return {
            "strategy": "large-office-private-conversion",
            "bounded_action": "download-to-private-temp-then-libreoffice-text-conversion",
            "max_output_chars": 200_000,
            "requires_approval": True,
        }
    if lane == "needs_archive_inventory":
        return {
            "strategy": "large-archive-inventory-only",
            "bounded_action": "download-to-private-temp-then-entry-inventory-no-extraction",
            "max_entries": 5000,
            "requires_approval": True,
        }
    if lane == "needs_ocr_or_vision":
        return {
            "strategy": "large-image-metadata-ocr-vision-review",
            "bounded_action": "metadata-first-ocr-or-vision-only-after-tool-provider-approval",
            "max_pixels": 36_000_000,
            "requires_approval": True,
        }
    if lane == "needs_design_raw_pipeline":
        return {
            "strategy": "large-design-raw-metadata-preview",
            "bounded_action": "metadata-first-preview-or-vision-only-after-tool-provider-approval",
            "requires_approval": True,
        }
    return {
        "strategy": "large-unknown-metadata-human-review",
        "bounded_action": "metadata-only-until-specific-extractor-exists",
        "requires_approval": True,
    }


def parse_lanes(value: str | None) -> set[str]:
    if not value:
        return set(DEFAULT_LANES)
    lanes = {item.strip() for item in value.split(",") if item.strip()}
    if not lanes:
        raise SystemExit("--lanes produced no lane names")
    return lanes


def load_rows(
    db_path: Path,
    min_size: int,
    max_size: int | None,
    lanes: set[str],
    max_jobs: int | None,
    max_jobs_per_lane: int | None,
    order: str,
) -> list[dict[str, Any]]:
    db = sqlite3.connect(db_path)
    db.row_factory = sqlite3.Row
    size_conditions = ["COALESCE(f.size, 0) > ?"]
    params: list[Any] = [min_size]
    if max_size is not None:
        size_conditions.append("COALESCE(f.size, 0) <= ?")
        params.append(max_size)
    order_sql = {
        "size-desc": "f.size DESC, f.id",
        "size-asc": "f.size ASC, f.id",
        "lane-size-asc": "f.mime, f.size ASC, f.id",
        "lane-size-desc": "f.mime, f.size DESC, f.id",
    }[order]
    rows = db.execute(
        f"""
        SELECT
          f.id AS file_id,
          f.mime AS mime,
          f.ext AS ext,
          f.size AS size,
          COALESCE(NULLIF(r.owner, ''), '_unassigned') AS owner,
          COALESCE(r.review_status, '_none') AS review_status,
          COALESCE(r.acl_review_status, '_none') AS acl_review_status
        FROM files f
        LEFT JOIN file_organization_reviews r ON r.file_id = f.id
        WHERE f.status = 'active'
          AND COALESCE(r.review_status, '') != 'duplicate'
          AND {" AND ".join(size_conditions)}
        ORDER BY {order_sql}
        """,
        params,
    ).fetchall()
    planned: list[dict[str, Any]] = []
    per_lane_counts: dict[str, int] = {}
    for row in rows:
        size = int(row["size"] or 0)
        lane = corpus_lane_for(row["mime"], None, row["ext"])
        if lane not in lanes:
            continue
        if max_jobs_per_lane is not None and per_lane_counts.get(lane, 0) >= max_jobs_per_lane:
            continue
        strategy = strategy_for(lane, size)
        planned.append({
            "file_id": row["file_id"],
            "lane": lane,
            "mime": row["mime"] or "application/octet-stream",
            "expected_ext": expected_extension_for(row["mime"], row["ext"]),
            "size": size,
            "size_bucket": size_bucket(size),
            "owner": row["owner"],
            "review_status": row["review_status"],
            "acl_review_status": row["acl_review_status"],
            **strategy,
        })
        per_lane_counts[lane] = per_lane_counts.get(lane, 0) + 1
        if max_jobs is not None and len(planned) >= max_jobs:
            break
    return planned


def chunks(rows: list[dict[str, Any]], size: int) -> list[list[dict[str, Any]]]:
    return [rows[index : index + size] for index in range(0, len(rows), size)]


def write_jsonl(path: Path, rows: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, sort_keys=True) + "\n")


def bump(table: dict[str, dict[str, int]], key: str, count: int, bytes_: int) -> None:
    entry = table.setdefault(key, {"count": 0, "bytes": 0})
    entry["count"] += count
    entry["bytes"] += bytes_


def summarize(rows: list[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    by_lane: dict[str, dict[str, int]] = {}
    by_lane_size: dict[str, dict[str, int]] = {}
    by_owner: dict[str, dict[str, int]] = {}
    by_strategy: dict[str, dict[str, int]] = {}
    by_acl: dict[str, dict[str, int]] = {}
    for row in rows:
        size = int(row.get("size") or 0)
        bump(by_lane, str(row.get("lane") or "unknown"), 1, size)
        bump(by_lane_size, f"{row.get('lane')}|{row.get('size_bucket')}", 1, size)
        bump(by_owner, str(row.get("owner") or "_unassigned"), 1, size)
        bump(by_strategy, str(row.get("strategy") or "unknown"), 1, size)
        bump(by_acl, str(row.get("acl_review_status") or "_none"), 1, size)

    def rows_out(table: dict[str, dict[str, int]]) -> list[dict[str, Any]]:
        values = [{"key": key, **value} for key, value in table.items()]
        values.sort(key=lambda item: (-item["count"], -item["bytes"], item["key"]))
        return values

    return {
        "by_lane": rows_out(by_lane),
        "by_lane_size": rows_out(by_lane_size),
        "by_owner": rows_out(by_owner),
        "by_strategy": rows_out(by_strategy),
        "by_acl_review_status": rows_out(by_acl),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Plan large-file extraction work without downloading objects.")
    parser.add_argument("--db", default=str(default_db_path()), help="SQLite DB path")
    parser.add_argument("--output-dir", required=True, help="Private output directory")
    parser.add_argument("--min-size-bytes", type=int, default=1024 * 1024, help="Plan rows larger than this size")
    parser.add_argument("--max-size-bytes", type=int, help="Plan rows at or below this size")
    parser.add_argument("--max-jobs", type=int, help="Maximum planned jobs")
    parser.add_argument("--max-jobs-per-lane", type=int, help="Maximum planned jobs per computed lane")
    parser.add_argument("--jobs-per-shard", type=int, default=100)
    parser.add_argument("--lanes", help="Comma-separated lane allowlist")
    parser.add_argument(
        "--order",
        choices=["size-desc", "size-asc", "lane-size-asc", "lane-size-desc"],
        default="size-desc",
        help="Private shard planning order",
    )
    parser.add_argument("--campaign-id", default=time.strftime("large-files-%Y%m%dT%H%M%S"))
    parser.add_argument("--approved", action="store_true", help="Mark this plan approved for later heavy extraction")
    parser.add_argument("--approval-note", help="Required when --approved is set")
    parser.add_argument("--approval-note-file", help="Private approval note file or JSON artifact used instead of --approval-note")
    args = parser.parse_args()

    if args.min_size_bytes < 0:
        raise SystemExit("--min-size-bytes cannot be negative")
    if args.max_size_bytes is not None and args.max_size_bytes < 0:
        raise SystemExit("--max-size-bytes cannot be negative")
    if args.max_size_bytes is not None and args.max_size_bytes <= args.min_size_bytes:
        raise SystemExit("--max-size-bytes must be greater than --min-size-bytes")
    if args.jobs_per_shard <= 0:
        raise SystemExit("--jobs-per-shard must be positive")
    if args.max_jobs is not None and args.max_jobs < 0:
        raise SystemExit("--max-jobs cannot be negative")
    if args.max_jobs_per_lane is not None and args.max_jobs_per_lane <= 0:
        raise SystemExit("--max-jobs-per-lane must be positive")
    note_info = approval_note_info(args.approval_note, args.approval_note_file)
    if args.approved and note_info is None:
        raise SystemExit("--approval-note or --approval-note-file is required with --approved")

    db_path = Path(args.db).expanduser().resolve()
    if not db_path.exists():
        raise SystemExit(f"database not found: {db_path}")
    output_dir = Path(args.output_dir).expanduser().resolve()
    shard_dir = output_dir / "shards"
    output_dir.mkdir(parents=True, exist_ok=True)
    lanes = parse_lanes(args.lanes)
    rows = load_rows(
        db_path,
        args.min_size_bytes,
        args.max_size_bytes,
        lanes,
        args.max_jobs,
        args.max_jobs_per_lane,
        args.order,
    )
    shard_entries: list[dict[str, Any]] = []
    for index, row_chunk in enumerate(chunks(rows, args.jobs_per_shard), start=1):
        shard_id = f"shard-{index:04d}"
        shard_path = shard_dir / f"{shard_id}.jsonl"
        write_jsonl(shard_path, row_chunk)
        shard_entries.append({
            "shard": shard_id,
            "jobs": len(row_chunk),
            "bytes": sum(int(row.get("size") or 0) for row in row_chunk),
            "manifest": str(shard_path),
            "manifest_sha256": file_sha256(shard_path),
            "aggregate": summarize(row_chunk),
        })

    plan = {
        "version": 1,
        "campaign_id": args.campaign_id,
        "created_at": now_utc(),
        "status": "approved" if args.approved else "approval_required",
        "approved": bool(args.approved),
        "approval_note": note_info.get("text") if args.approved and note_info else None,
        "db": str(db_path),
        "min_size_bytes": args.min_size_bytes,
        "max_size_bytes": args.max_size_bytes,
        "max_jobs_per_lane": args.max_jobs_per_lane,
        "order": args.order,
        "lanes": sorted(lanes),
        "jobs_planned": len(rows),
        "bytes_planned": sum(int(row.get("size") or 0) for row in rows),
        "shards": len(shard_entries),
        "jobs_per_shard": args.jobs_per_shard,
        "aggregate": summarize(rows),
        "shard_entries": shard_entries,
        "approval_gate": {
            "required": True,
            "approved": bool(args.approved),
            "rule": "Heavy download/extraction runners must not execute until approved with an approval note.",
        },
        "approval_attestation": {
            "status": "approved" if args.approved else "approval_required",
            "approved": bool(args.approved),
            "approval_note_present": bool(note_info),
            "approval_note_sha256": note_info.get("sha256") if note_info else None,
            "approval_note_source": note_info.get("source") if note_info else None,
            "approval_note_file_sha256": note_info.get("file_sha256") if note_info else None,
            "approval_note_decision_id": note_info.get("decision_id") if note_info else None,
            "rule": "Planner only creates an approved executable plan when --approved and an approval note or approval-note file are present.",
            "redaction": "approval note is represented only by SHA-256 when present",
        },
        "redaction": "plan omits filenames, paths, object keys, source refs, OCR text, transcripts, file IDs, and row payloads; shard manifests are private artifacts",
    }
    plan_path = output_dir / "large-file-extraction-plan.json"
    plan_path.write_text(json.dumps(plan, indent=2, sort_keys=True), encoding="utf-8")
    print(json.dumps({
        "status": plan["status"],
        "campaign_id": args.campaign_id,
        "plan": str(plan_path),
        "jobs_planned": len(rows),
        "bytes_planned": plan["bytes_planned"],
        "shards": len(shard_entries),
        "lanes": plan["lanes"],
        "approved": bool(args.approved),
        "redaction": plan["redaction"],
    }, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
