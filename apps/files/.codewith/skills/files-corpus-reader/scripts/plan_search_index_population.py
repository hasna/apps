#!/usr/bin/env python3
"""Plan derived search-index population without reading file contents.

The planner writes private shard manifests containing file IDs and non-name
metadata needed by extraction/index workers. Shared stdout and the plan JSON
are aggregate-only: no filenames, paths, object keys, source refs, extracted
text, transcripts, or row payloads.
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

from lane_resolver import corpus_lane_for, expected_extension_for, semantic_lane_for


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


def recommended_kind_for(lane: str) -> str:
    return {
        "readable_now_text": "extracted_text",
        "needs_pdf_extractor": "extraction_summary",
        "needs_office_extractor": "extraction_summary",
        "needs_ocr_or_vision": "ocr_text",
        "needs_transcription": "transcript",
        "needs_video_pipeline": "transcript",
        "needs_archive_inventory": "semantic_metadata",
        "needs_design_raw_pipeline": "vision_summary",
        "metadata_only_or_unknown": "semantic_metadata",
    }[lane]


def strategy_for(lane: str) -> dict[str, Any]:
    if lane == "readable_now_text":
        return {
            "strategy": "text-snapshot-to-search-index",
            "bounded_action": "files-extract-snapshot-then-files-search-index-add",
            "recommended_kind": "extracted_text",
        }
    if lane == "needs_pdf_extractor":
        return {
            "strategy": "pdf-text-summary-to-search-index",
            "bounded_action": "pdftotext-private-artifact-then-summary-index",
            "recommended_kind": "extraction_summary",
        }
    if lane == "needs_office_extractor":
        return {
            "strategy": "office-text-summary-to-search-index",
            "bounded_action": "libreoffice-private-conversion-then-summary-index",
            "recommended_kind": "extraction_summary",
        }
    if lane == "needs_ocr_or_vision":
        return {
            "strategy": "image-ocr-or-vision-to-search-index",
            "bounded_action": "ocr-or-approved-vision-artifact-then-index",
            "recommended_kind": "ocr_text",
        }
    if lane == "needs_transcription":
        return {
            "strategy": "audio-transcript-to-search-index",
            "bounded_action": "approved-transcription-artifact-then-index",
            "recommended_kind": "transcript",
        }
    if lane == "needs_video_pipeline":
        return {
            "strategy": "video-transcript-keyframe-summary-to-search-index",
            "bounded_action": "approved-transcription-keyframe-artifacts-then-index",
            "recommended_kind": "transcript",
        }
    if lane == "needs_archive_inventory":
        return {
            "strategy": "archive-inventory-to-search-index",
            "bounded_action": "archive-inventory-artifact-then-semantic-metadata-index",
            "recommended_kind": "semantic_metadata",
        }
    if lane == "needs_design_raw_pipeline":
        return {
            "strategy": "design-preview-summary-to-search-index",
            "bounded_action": "metadata-preview-or-approved-vision-summary-then-index",
            "recommended_kind": "vision_summary",
        }
    return {
        "strategy": "metadata-summary-to-search-index",
        "bounded_action": "metadata-only-summary-then-human-or-agent-review",
        "recommended_kind": "semantic_metadata",
    }


def parse_lanes(value: str | None) -> set[str] | None:
    if not value:
        return None
    lanes = {item.strip() for item in value.split(",") if item.strip()}
    if not lanes:
        raise SystemExit("--lanes produced no lane names")
    return lanes


def table_exists(db: sqlite3.Connection, table: str) -> bool:
    row = db.execute(
        "SELECT 1 FROM sqlite_master WHERE type IN ('table', 'view') AND name = ?",
        (table,),
    ).fetchone()
    return row is not None


def load_rows(
    db_path: Path,
    lanes: set[str] | None,
    exclude_lanes: set[str] | None,
    include_indexed: bool,
    include_duplicates: bool,
    max_jobs: int | None,
    max_jobs_per_lane: int | None,
    order: str,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]]]:
    db = sqlite3.connect(db_path)
    db.row_factory = sqlite3.Row
    has_search_documents = table_exists(db, "file_search_documents")
    if has_search_documents:
        search_join = """
        LEFT JOIN (
          SELECT
            file_id,
            COUNT(*) AS search_document_count,
            SUM(CASE WHEN status IN ('ready', 'partial') THEN 1 ELSE 0 END) AS ready_document_count,
            SUM(CASE WHEN status = 'stale' THEN 1 ELSE 0 END) AS stale_document_count,
            group_concat(DISTINCT kind) AS search_document_kinds,
            group_concat(DISTINCT status) AS search_document_statuses
          FROM file_search_documents
          GROUP BY file_id
        ) sd ON sd.file_id = f.id
        """
        search_columns = """
          COALESCE(sd.search_document_count, 0) AS search_document_count,
          COALESCE(sd.ready_document_count, 0) AS ready_document_count,
          COALESCE(sd.stale_document_count, 0) AS stale_document_count,
          COALESCE(sd.search_document_kinds, '') AS search_document_kinds,
          COALESCE(sd.search_document_statuses, '') AS search_document_statuses
        """
    else:
        search_join = ""
        search_columns = """
          0 AS search_document_count,
          0 AS ready_document_count,
          0 AS stale_document_count,
          '' AS search_document_kinds,
          '' AS search_document_statuses
        """

    rows = db.execute(
        f"""
        SELECT
          f.id AS file_id,
          f.mime AS mime,
          f.ext AS ext,
          f.size AS size,
          COALESCE(NULLIF(r.owner, ''), '_unassigned') AS owner,
          COALESCE(r.review_status, '_none') AS review_status,
          COALESCE(r.acl_review_status, '_none') AS acl_review_status,
          {search_columns}
        FROM files f
        LEFT JOIN file_organization_reviews r ON r.file_id = f.id
        {search_join}
        WHERE f.status = 'active'
        """
    ).fetchall()
    db.close()

    inventory_rows: list[dict[str, Any]] = []
    candidates: list[dict[str, Any]] = []
    coverage_rows: list[dict[str, Any]] = []
    for row in rows:
        size = int(row["size"] or 0)
        lane = corpus_lane_for(row["mime"], None, row["ext"])
        ready_count = int(row["ready_document_count"] or 0)
        stale_count = int(row["stale_document_count"] or 0)
        coverage_status = "indexed" if ready_count > 0 else "stale_only" if stale_count > 0 else "missing"
        base = {
            "file_id": row["file_id"],
            "lane": lane,
            "semantic_lane": semantic_lane_for(row["mime"], None, row["ext"]),
            "mime": row["mime"] or "application/octet-stream",
            "expected_ext": expected_extension_for(row["mime"], row["ext"]),
            "size": size,
            "size_bucket": size_bucket(size),
            "owner": row["owner"],
            "review_status": row["review_status"],
            "acl_review_status": row["acl_review_status"],
            "coverage_status": coverage_status,
            "search_document_count": int(row["search_document_count"] or 0),
            "ready_document_count": ready_count,
            "stale_document_count": stale_count,
            "search_document_kinds": split_csv(row["search_document_kinds"]),
            "search_document_statuses": split_csv(row["search_document_statuses"]),
            **strategy_for(lane),
        }
        inventory_rows.append(base)
        if lanes is not None and lane not in lanes:
            continue
        if exclude_lanes is not None and lane in exclude_lanes:
            continue
        if not include_duplicates and base["review_status"] == "duplicate":
            continue
        coverage_rows.append(base)
        if include_indexed or coverage_status != "indexed":
            candidates.append(base)

    candidates.sort(key=sort_key(order))
    planned: list[dict[str, Any]] = []
    per_lane_counts: dict[str, int] = {}
    for row in candidates:
        lane = row["lane"]
        if max_jobs_per_lane is not None and per_lane_counts.get(lane, 0) >= max_jobs_per_lane:
            continue
        planned.append(row)
        per_lane_counts[lane] = per_lane_counts.get(lane, 0) + 1
        if max_jobs is not None and len(planned) >= max_jobs:
            break
    return planned, coverage_rows, inventory_rows


def split_csv(raw: str | None) -> list[str]:
    if not raw:
        return []
    return sorted({item.strip() for item in raw.split(",") if item.strip()})


def sort_key(order: str):
    if order == "size-desc":
        return lambda row: (-int(row["size"]), row["file_id"])
    if order == "size-asc":
        return lambda row: (int(row["size"]), row["file_id"])
    if order == "lane-size-desc":
        return lambda row: (row["lane"], -int(row["size"]), row["file_id"])
    return lambda row: (row["lane"], int(row["size"]), row["file_id"])


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


def summarize(rows: list[dict[str, Any]]) -> dict[str, Any]:
    by_lane: dict[str, dict[str, int]] = {}
    by_lane_coverage: dict[str, dict[str, int]] = {}
    by_owner: dict[str, dict[str, int]] = {}
    by_strategy: dict[str, dict[str, int]] = {}
    by_coverage_status: dict[str, dict[str, int]] = {}
    by_recommended_kind: dict[str, dict[str, int]] = {}
    by_size: dict[str, dict[str, int]] = {}
    for row in rows:
        size = int(row.get("size") or 0)
        lane = str(row.get("lane") or "unknown")
        coverage = str(row.get("coverage_status") or "unknown")
        bump(by_lane, lane, 1, size)
        bump(by_lane_coverage, f"{lane}|{coverage}", 1, size)
        bump(by_owner, str(row.get("owner") or "_unassigned"), 1, size)
        bump(by_strategy, str(row.get("strategy") or "unknown"), 1, size)
        bump(by_coverage_status, coverage, 1, size)
        bump(by_recommended_kind, str(row.get("recommended_kind") or recommended_kind_for(lane)), 1, size)
        bump(by_size, f"{lane}|{row.get('size_bucket')}", 1, size)

    def rows_out(table: dict[str, dict[str, int]]) -> list[dict[str, Any]]:
        values = [{"key": key, **value} for key, value in table.items()]
        values.sort(key=lambda item: (-item["count"], -item["bytes"], item["key"]))
        return values

    output = {
        "by_lane": rows_out(by_lane),
        "by_lane_coverage": rows_out(by_lane_coverage),
        "by_owner": rows_out(by_owner),
        "by_strategy": rows_out(by_strategy),
        "by_coverage_status": rows_out(by_coverage_status),
        "by_recommended_kind": rows_out(by_recommended_kind),
        "by_lane_size": rows_out(by_size),
    }
    output["totals"] = {
        "rows": len(rows),
        "bytes": sum(int(row.get("size") or 0) for row in rows),
        "dimensions": {
            name: {
                "count": sum(int(item.get("count") or 0) for item in values),
                "bytes": sum(int(item.get("bytes") or 0) for item in values),
            }
            for name, values in output.items()
        },
    }
    return output


def summarize_completeness(
    inventory_rows: list[dict[str, Any]],
    planned_rows: list[dict[str, Any]],
    lanes: set[str] | None,
    exclude_lanes: set[str] | None,
    include_indexed: bool,
    include_duplicates: bool,
) -> dict[str, Any]:
    planned_ids = {row["file_id"] for row in planned_rows if isinstance(row.get("file_id"), str)}
    by_outcome: dict[str, dict[str, int]] = {}
    by_outcome_lane: dict[str, dict[str, int]] = {}
    by_outcome_coverage: dict[str, dict[str, int]] = {}
    for row in inventory_rows:
        size = int(row.get("size") or 0)
        lane = str(row.get("lane") or "unknown")
        coverage = str(row.get("coverage_status") or "unknown")
        review_status = str(row.get("review_status") or "_none")
        file_id = row.get("file_id")
        if isinstance(file_id, str) and file_id in planned_ids:
            outcome = "planned"
        elif not include_duplicates and review_status == "duplicate":
            outcome = "exempt_duplicate"
        elif lanes is not None and lane not in lanes:
            outcome = "exempt_lane_not_selected"
        elif exclude_lanes is not None and lane in exclude_lanes:
            outcome = "exempt_excluded_lane"
        elif not include_indexed and coverage == "indexed":
            outcome = "already_indexed"
        else:
            outcome = "unplanned_in_scope"
        bump(by_outcome, outcome, 1, size)
        bump(by_outcome_lane, f"{outcome}|{lane}", 1, size)
        bump(by_outcome_coverage, f"{outcome}|{coverage}", 1, size)

    def rows_out(table: dict[str, dict[str, int]]) -> list[dict[str, Any]]:
        values = [{"key": key, **value} for key, value in table.items()]
        values.sort(key=lambda item: (-item["count"], -item["bytes"], item["key"]))
        return values

    output = {
        "by_outcome": rows_out(by_outcome),
        "by_outcome_lane": rows_out(by_outcome_lane),
        "by_outcome_coverage": rows_out(by_outcome_coverage),
    }
    output["totals"] = {
        "rows": len(inventory_rows),
        "bytes": sum(int(row.get("size") or 0) for row in inventory_rows),
        "dimensions": {
            name: {
                "count": sum(int(item.get("count") or 0) for item in values),
                "bytes": sum(int(item.get("bytes") or 0) for item in values),
            }
            for name, values in output.items()
        },
    }
    planned_outcome = by_outcome.get("planned", {"count": 0, "bytes": 0})
    already_indexed = by_outcome.get("already_indexed", {"count": 0, "bytes": 0})
    exempt = {
        "count": sum(value["count"] for key, value in by_outcome.items() if key.startswith("exempt_")),
        "bytes": sum(value["bytes"] for key, value in by_outcome.items() if key.startswith("exempt_")),
    }
    unplanned = by_outcome.get("unplanned_in_scope", {"count": 0, "bytes": 0})
    output["declared_totals"] = {
        "active_files": len(inventory_rows),
        "active_bytes": output["totals"]["bytes"],
        "planned_jobs": planned_outcome["count"],
        "planned_bytes": planned_outcome["bytes"],
        "already_indexed_files": already_indexed["count"],
        "already_indexed_bytes": already_indexed["bytes"],
        "exempt_files": exempt["count"],
        "exempt_bytes": exempt["bytes"],
        "unplanned_in_scope_files": unplanned["count"],
        "unplanned_in_scope_bytes": unplanned["bytes"],
        "reconciled_files": planned_outcome["count"] + already_indexed["count"] + exempt["count"] + unplanned["count"],
        "reconciled": planned_outcome["count"] + already_indexed["count"] + exempt["count"] + unplanned["count"] == len(inventory_rows),
    }
    return output


def main() -> int:
    parser = argparse.ArgumentParser(description="Plan derived search-index population without reading contents.")
    parser.add_argument("--db", default=str(default_db_path()), help="SQLite DB path")
    parser.add_argument("--output-dir", required=True, help="Private output directory")
    parser.add_argument("--max-jobs", type=int, help="Maximum planned jobs")
    parser.add_argument("--max-jobs-per-lane", type=int, help="Maximum planned jobs per computed lane")
    parser.add_argument("--jobs-per-shard", type=int, default=500)
    parser.add_argument("--lanes", help="Comma-separated lane allowlist")
    parser.add_argument("--exclude-lanes", help="Comma-separated lane denylist, useful for deferred media/OCR lanes")
    parser.add_argument(
        "--order",
        choices=["size-desc", "size-asc", "lane-size-asc", "lane-size-desc"],
        default="lane-size-asc",
        help="Private shard planning order",
    )
    parser.add_argument("--campaign-id", default=time.strftime("search-index-%Y%m%dT%H%M%S"))
    parser.add_argument("--include-indexed", action="store_true", help="Include files that already have ready/partial search documents")
    parser.add_argument("--include-duplicates", action="store_true", help="Include organization rows marked duplicate")
    parser.add_argument("--approved", action="store_true", help="Mark this plan approved for later search-index population")
    parser.add_argument("--approval-note", help="Required when --approved is set")
    parser.add_argument("--approval-note-file", help="Private approval note file or JSON artifact used instead of --approval-note")
    args = parser.parse_args()

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
    exclude_lanes = parse_lanes(args.exclude_lanes)
    planned_rows, coverage_rows, inventory_rows = load_rows(
        db_path,
        lanes,
        exclude_lanes,
        args.include_indexed,
        args.include_duplicates,
        args.max_jobs,
        args.max_jobs_per_lane,
        args.order,
    )

    shard_entries: list[dict[str, Any]] = []
    for index, row_chunk in enumerate(chunks(planned_rows, args.jobs_per_shard), start=1):
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

    coverage = summarize(coverage_rows)
    planned = summarize(planned_rows)
    completeness = summarize_completeness(
        inventory_rows,
        planned_rows,
        lanes,
        exclude_lanes,
        args.include_indexed,
        args.include_duplicates,
    )
    plan = {
        "version": 1,
        "campaign_id": args.campaign_id,
        "created_at": now_utc(),
        "status": "approved" if args.approved else "approval_required",
        "approved": bool(args.approved),
        "approval_note": note_info.get("text") if args.approved and note_info else None,
        "db": str(db_path),
        "lanes": sorted(lanes) if lanes else None,
        "exclude_lanes": sorted(exclude_lanes) if exclude_lanes else None,
        "include_indexed": bool(args.include_indexed),
        "include_duplicates": bool(args.include_duplicates),
        "order": args.order,
        "max_jobs": args.max_jobs,
        "max_jobs_per_lane": args.max_jobs_per_lane,
        "jobs_planned": len(planned_rows),
        "bytes_planned": sum(int(row.get("size") or 0) for row in planned_rows),
        "jobs_per_shard": args.jobs_per_shard,
        "shards": len(shard_entries),
        "declared_totals": completeness["declared_totals"],
        "coverage": {
            "active_files": len(coverage_rows),
            "indexed_files": sum(1 for row in coverage_rows if row["coverage_status"] == "indexed"),
            "missing_files": sum(1 for row in coverage_rows if row["coverage_status"] == "missing"),
            "stale_only_files": sum(1 for row in coverage_rows if row["coverage_status"] == "stale_only"),
            "aggregate": coverage,
        },
        "planned": {
            "aggregate": planned,
        },
        "completeness": {
            "aggregate": completeness,
            "outcome_policy": {
                "planned": "row is selected for a derived search-index job",
                "already_indexed": "row already has a ready/partial search document and --include-indexed is false",
                "exempt_duplicate": "row is marked duplicate and --include-duplicates is false",
                "exempt_lane_not_selected": "row is outside the explicit --lanes allowlist",
                "exempt_excluded_lane": "row is inside the explicit --exclude-lanes denylist",
                "unplanned_in_scope": "row is eligible but not selected because of max job caps or other planner limits",
            },
        },
        "shard_entries": shard_entries,
        "approval_gate": {
            "required": True,
            "approved": bool(args.approved),
            "rule": "Extraction/index workers must not execute until approved with an approval note.",
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
        "execution_gate": {
            "planner_only": True,
            "rule": "Execution remains separate: approved runners must use private shard manifests and write derived text through files search-index add.",
        },
        "redaction": "plan omits filenames, paths, object keys, source refs, extracted text, transcripts, file IDs, and row payloads; shard manifests are private artifacts",
    }
    plan_path = output_dir / "search-index-population-plan.json"
    plan_path.write_text(json.dumps(plan, indent=2, sort_keys=True), encoding="utf-8")
    print(json.dumps({
        "status": plan["status"],
        "campaign_id": args.campaign_id,
        "plan": str(plan_path),
        "approved": bool(args.approved),
        "active_files": plan["coverage"]["active_files"],
        "declared_active_files": plan["declared_totals"]["active_files"],
        "declared_exempt_files": plan["declared_totals"]["exempt_files"],
        "declared_reconciled": plan["declared_totals"]["reconciled"],
        "indexed_files": plan["coverage"]["indexed_files"],
        "missing_files": plan["coverage"]["missing_files"],
        "stale_only_files": plan["coverage"]["stale_only_files"],
        "jobs_planned": plan["jobs_planned"],
        "bytes_planned": plan["bytes_planned"],
        "shards": plan["shards"],
        "redaction": plan["redaction"],
    }, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
