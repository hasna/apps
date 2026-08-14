#!/usr/bin/env python3
"""Build redacted public and private full-corpus maps for open-files.

The public map is aggregate-only. The optional private JSONL map contains file
IDs and non-name scheduling metadata for extraction/index workers. Neither map
contains filenames, paths, object keys, source refs, extracted text, transcripts,
or ACL payloads.
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

from lane_resolver import corpus_lane_for, expected_extension_for, semantic_lane_for


LARGE_FILE_THRESHOLD = 25 * 1024 * 1024


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


def column_exists(db: sqlite3.Connection, table: str, column: str) -> bool:
    return any(row[1] == column for row in db.execute(f"PRAGMA table_info({table})").fetchall())


def split_csv(raw: str | None) -> list[str]:
    if not raw:
        return []
    return sorted({item.strip() for item in raw.split(",") if item.strip()})


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


def provider_requirement_for(lane: str, index_coverage: str) -> str:
    if index_coverage == "indexed":
        return "none_already_indexed"
    return {
        "readable_now_text": "files_cli_text_snapshot",
        "needs_pdf_extractor": "local_pdftotext",
        "needs_office_extractor": "local_libreoffice",
        "needs_ocr_or_vision": "tesseract_or_vision_model",
        "needs_transcription": "ffmpeg_plus_transcription_provider",
        "needs_video_pipeline": "ffmpeg_keyframes_plus_transcription_provider",
        "needs_archive_inventory": "local_archive_inventory_tool",
        "needs_design_raw_pipeline": "metadata_preview_or_vision_model",
        "metadata_only_or_unknown": "agent_or_human_metadata_review",
    }[lane]


def readiness_for(lane: str, size: int, review_status: str, ready_count: int, stale_count: int) -> str:
    if review_status == "duplicate":
        return "deferred_duplicate_preserve"
    if ready_count > 0:
        return "indexed_ready"
    if stale_count > 0:
        return "stale_refresh_required"
    if size >= LARGE_FILE_THRESHOLD:
        return "large_file_runner_required"
    return {
        "readable_now_text": "local_text_snapshot_ready",
        "needs_pdf_extractor": "local_pdf_extractor_ready",
        "needs_office_extractor": "local_office_extractor_ready",
        "needs_ocr_or_vision": "ocr_or_vision_required",
        "needs_transcription": "audio_transcription_required",
        "needs_video_pipeline": "video_keyframes_transcription_required",
        "needs_archive_inventory": "archive_inventory_ready",
        "needs_design_raw_pipeline": "design_raw_preview_required",
        "metadata_only_or_unknown": "metadata_review_ready",
    }[lane]


def next_action_for(lane: str, size: int, review_status: str, index_coverage: str) -> str:
    if review_status == "duplicate":
        return "preserve_duplicate_skip_until_survivor_review"
    if index_coverage == "indexed":
        return "search_ready_keep_current_index"
    if index_coverage == "stale_only":
        return "refresh_derived_search_document"
    action = {
        "readable_now_text": "extract_text_snapshot_then_index",
        "needs_pdf_extractor": "extract_pdf_text_summarize_then_index",
        "needs_office_extractor": "extract_office_text_summarize_then_index",
        "needs_ocr_or_vision": "run_ocr_or_vision_summary_then_index",
        "needs_transcription": "transcribe_audio_then_index",
        "needs_video_pipeline": "transcribe_video_keyframes_then_index",
        "needs_archive_inventory": "inventory_archive_then_index",
        "needs_design_raw_pipeline": "extract_design_metadata_preview_then_index",
        "metadata_only_or_unknown": "metadata_summary_review_then_index",
    }[lane]
    if size >= LARGE_FILE_THRESHOLD:
        return f"large_file_runner_{action}"
    return action


def risk_for(row: dict[str, Any]) -> dict[str, Any]:
    reasons: list[str] = []
    score = 0
    lane = row["lane"]
    owner = row["owner"]
    review_status = row["review_status"]
    acl_status = row["acl_review_status"]
    size = int(row["size"] or 0)
    index_coverage = row["index_coverage"]

    if review_status == "duplicate":
        score = max(score, 1)
        reasons.append("duplicate_non_survivor")
    elif review_status not in {"approved", "_none", "ready", "reviewed"}:
        score = max(score, 1)
        reasons.append("review_status_not_final")

    if acl_status not in {"ok", "approved", "none", "_none", ""}:
        score = max(score, 3)
        reasons.append("acl_review_required")

    if owner in {"intake", "personal-review"}:
        score = max(score, 2)
        reasons.append(f"owner_{owner}")

    if lane in {"needs_transcription", "needs_video_pipeline"}:
        score = max(score, 2)
        reasons.append("media_pipeline_required")
    elif lane in {"needs_ocr_or_vision", "needs_design_raw_pipeline"}:
        score = max(score, 2)
        reasons.append("vision_pipeline_required")
    elif lane == "metadata_only_or_unknown":
        score = max(score, 1)
        reasons.append("unknown_metadata_only_lane")

    if index_coverage == "stale_only":
        score = max(score, 1)
        reasons.append("stale_search_document")
    elif index_coverage == "missing":
        reasons.append("missing_search_document")

    if size >= 100 * 1024 * 1024:
        score = max(score, 3)
        reasons.append("massive_file")
    elif size >= LARGE_FILE_THRESHOLD:
        score = max(score, 2)
        reasons.append("large_file")

    tiers = ["low", "medium", "high", "critical"]
    return {"risk_tier": tiers[score], "risk_reasons": reasons or ["standard_lane"]}


def fetch_rows(db_path: Path, lanes: set[str] | None, exclude_duplicates: bool) -> list[dict[str, Any]]:
    db = sqlite3.connect(db_path)
    db.row_factory = sqlite3.Row
    has_ext = column_exists(db, "files", "ext")
    has_search_documents = table_exists(db, "file_search_documents")
    ext_column = "f.ext AS ext" if has_ext else "NULL AS ext"
    duplicate_clause = "AND COALESCE(r.review_status, '') != 'duplicate'" if exclude_duplicates else ""

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
          {ext_column},
          f.size AS size,
          COALESCE(NULLIF(r.owner, ''), '_unassigned') AS owner,
          COALESCE(r.review_status, '_none') AS review_status,
          COALESCE(r.acl_review_status, '_none') AS acl_review_status,
          {search_columns}
        FROM files f
        LEFT JOIN file_organization_reviews r ON r.file_id = f.id
        {search_join}
        WHERE f.status = 'active'
          {duplicate_clause}
        """
    ).fetchall()
    db.close()

    mapped: list[dict[str, Any]] = []
    for row in rows:
        size = int(row["size"] or 0)
        lane = corpus_lane_for(row["mime"], None, row["ext"])
        if lanes is not None and lane not in lanes:
            continue
        ready_count = int(row["ready_document_count"] or 0)
        stale_count = int(row["stale_document_count"] or 0)
        index_coverage = "indexed" if ready_count > 0 else "stale_only" if stale_count > 0 else "missing"
        review_status = row["review_status"]
        base = {
            "file_id": row["file_id"],
            "lane": lane,
            "semantic_lane": semantic_lane_for(row["mime"], None, row["ext"]),
            "mime": row["mime"] or "application/octet-stream",
            "expected_ext": expected_extension_for(row["mime"], row["ext"]),
            "size": size,
            "size_bucket": size_bucket(size),
            "owner": row["owner"],
            "review_status": review_status,
            "acl_review_status": row["acl_review_status"],
            "index_coverage": index_coverage,
            "search_document_count": int(row["search_document_count"] or 0),
            "ready_document_count": ready_count,
            "stale_document_count": stale_count,
            "search_document_kinds": split_csv(row["search_document_kinds"]),
            "search_document_statuses": split_csv(row["search_document_statuses"]),
            "recommended_kind": recommended_kind_for(lane),
            "readiness": readiness_for(lane, size, review_status, ready_count, stale_count),
            "provider_requirement": provider_requirement_for(lane, index_coverage),
            "next_action": next_action_for(lane, size, review_status, index_coverage),
            "requires_execution_approval": index_coverage != "indexed" and review_status != "duplicate",
            "requires_private_content_access": lane not in {"metadata_only_or_unknown"} and review_status != "duplicate",
        }
        base.update(risk_for(base))
        mapped.append(base)

    mapped.sort(key=lambda item: (item["risk_tier"], item["lane"], item["owner"], item["size"], item["file_id"]))
    return mapped


def bump(table: dict[str, dict[str, int]], key: str, row: dict[str, Any]) -> None:
    entry = table.setdefault(key, {"count": 0, "bytes": 0})
    entry["count"] += 1
    entry["bytes"] += int(row.get("size") or 0)


def table_rows(table: dict[str, dict[str, int]], limit: int | None = None) -> list[dict[str, Any]]:
    rows = [{"key": key, **value} for key, value in table.items()]
    rows.sort(key=lambda item: (-item["count"], -item["bytes"], item["key"]))
    return rows if limit is None else rows[:limit]


def summarize(rows: list[dict[str, Any]], top: int) -> dict[str, Any]:
    tables: dict[str, dict[str, dict[str, int]]] = {
        "by_lane": {},
        "by_semantic_lane": {},
        "by_owner": {},
        "by_review_status": {},
        "by_acl_review_status": {},
        "by_size_bucket": {},
        "by_index_coverage": {},
        "by_readiness": {},
        "by_provider_requirement": {},
        "by_next_action": {},
        "by_risk_tier": {},
        "by_recommended_kind": {},
        "by_lane_owner": {},
        "by_lane_size": {},
        "by_lane_readiness": {},
        "by_owner_risk": {},
        "by_mime": {},
    }
    for row in rows:
        bump(tables["by_lane"], row["lane"], row)
        bump(tables["by_semantic_lane"], row["semantic_lane"], row)
        bump(tables["by_owner"], row["owner"], row)
        bump(tables["by_review_status"], row["review_status"], row)
        bump(tables["by_acl_review_status"], row["acl_review_status"], row)
        bump(tables["by_size_bucket"], row["size_bucket"], row)
        bump(tables["by_index_coverage"], row["index_coverage"], row)
        bump(tables["by_readiness"], row["readiness"], row)
        bump(tables["by_provider_requirement"], row["provider_requirement"], row)
        bump(tables["by_next_action"], row["next_action"], row)
        bump(tables["by_risk_tier"], row["risk_tier"], row)
        bump(tables["by_recommended_kind"], row["recommended_kind"], row)
        bump(tables["by_lane_owner"], f"{row['lane']}|{row['owner']}", row)
        bump(tables["by_lane_size"], f"{row['lane']}|{row['size_bucket']}", row)
        bump(tables["by_lane_readiness"], f"{row['lane']}|{row['readiness']}", row)
        bump(tables["by_owner_risk"], f"{row['owner']}|{row['risk_tier']}", row)
        bump(tables["by_mime"], row["mime"], row)
    return {
        key if key != "by_mime" else "by_mime_top": table_rows(value, top if key == "by_mime" else None)
        for key, value in tables.items()
    }


def write_jsonl(path: Path, rows: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, sort_keys=True) + "\n")


def main() -> int:
    parser = argparse.ArgumentParser(description="Build redacted public/private corpus maps.")
    parser.add_argument("--db", default=str(default_db_path()), help="SQLite DB path")
    parser.add_argument("--output", help="Optional public JSON output path")
    parser.add_argument("--output-dir", help="Optional directory for public JSON plus private JSONL map")
    parser.add_argument("--private-map", help="Optional explicit private JSONL output path")
    parser.add_argument("--top", type=int, default=50, help="Top MIME rows to include")
    parser.add_argument("--lanes", help="Comma-separated lane allowlist")
    parser.add_argument("--exclude-duplicates", action="store_true", help="Exclude rows marked duplicate from the map")
    args = parser.parse_args()

    db_path = Path(args.db).expanduser().resolve()
    if not db_path.exists():
        raise SystemExit(f"database not found: {db_path}")

    output_dir = Path(args.output_dir).expanduser().resolve() if args.output_dir else None
    public_output = Path(args.output).expanduser().resolve() if args.output else None
    if output_dir and public_output is None:
        public_output = output_dir / "corpus-map-public.json"
    private_map = Path(args.private_map).expanduser().resolve() if args.private_map else None
    if output_dir and private_map is None:
        private_map = output_dir / "corpus-private-map.jsonl"

    rows = fetch_rows(db_path, parse_lanes(args.lanes), args.exclude_duplicates)
    total_bytes = sum(int(row["size"] or 0) for row in rows)
    summary: dict[str, Any] = {
        "version": 1,
        "created_at": now_utc(),
        "db": str(db_path),
        "lanes": sorted(parse_lanes(args.lanes) or []),
        "exclude_duplicates": bool(args.exclude_duplicates),
        "redaction": "public map omits file IDs, filenames, paths, object keys, source refs, extracted text, transcripts, ACL payloads, and row payloads",
        "totals": {
            "active_files": len(rows),
            "active_bytes": total_bytes,
            "duplicate_review_rows": sum(1 for row in rows if row["review_status"] == "duplicate"),
            "requires_execution_approval": sum(1 for row in rows if row["requires_execution_approval"]),
            "requires_private_content_access": sum(1 for row in rows if row["requires_private_content_access"]),
            "indexed_files": sum(1 for row in rows if row["index_coverage"] == "indexed"),
            "stale_only_files": sum(1 for row in rows if row["index_coverage"] == "stale_only"),
            "missing_index_files": sum(1 for row in rows if row["index_coverage"] == "missing"),
        },
        "aggregate": summarize(rows, args.top),
        "private_map": None,
    }

    if private_map:
        write_jsonl(private_map, rows)
        summary["private_map"] = {
            "manifest": str(private_map),
            "rows": len(rows),
            "bytes": total_bytes,
            "sha256": file_sha256(private_map),
            "redaction": "private JSONL contains file IDs plus non-name scheduling metadata only",
        }

    if public_output:
        public_output.parent.mkdir(parents=True, exist_ok=True)
        public_output.write_text(json.dumps(summary, indent=2, sort_keys=True), encoding="utf-8")

    print(json.dumps(summary, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
