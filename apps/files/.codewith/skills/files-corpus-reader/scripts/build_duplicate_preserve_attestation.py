#!/usr/bin/env python3
"""Build an aggregate-only duplicate-preserve policy attestation.

The attestation proves that duplicate-exempt rows in a search-index plan are
intentional non-survivor rows and that each active duplicate group has a
survivor row planned for indexing or already indexed. It never prints file IDs,
filenames, paths, object keys, source refs, or row payloads.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sqlite3
import time
from pathlib import Path
from typing import Any


def now_utc() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_json(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise SystemExit(f"invalid JSON object: {path}")
    return value


def load_jsonl(path: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    if not path.exists():
        return rows
    with path.open("r", encoding="utf-8") as handle:
        for line_no, line in enumerate(handle, start=1):
            stripped = line.strip()
            if not stripped:
                continue
            try:
                value = json.loads(stripped)
            except json.JSONDecodeError as exc:
                raise SystemExit(f"invalid JSONL at line {line_no}: {path}") from exc
            if isinstance(value, dict):
                rows.append(value)
    return rows


def resolve_path(value: Any, base: Path) -> Path | None:
    if not isinstance(value, str) or not value:
        return None
    path = Path(value).expanduser()
    if not path.is_absolute():
        path = base / path
    return path.resolve()


def table_exists(db: sqlite3.Connection, table: str) -> bool:
    row = db.execute(
        "SELECT 1 FROM sqlite_master WHERE type IN ('table', 'view') AND name = ?",
        (table,),
    ).fetchone()
    return row is not None


def column_exists(db: sqlite3.Connection, table: str, column: str) -> bool:
    return any(row[1] == column for row in db.execute(f"PRAGMA table_info({table})").fetchall())


def count_for(rows: list[dict[str, Any]], key: str) -> dict[str, int]:
    for row in rows:
        if row.get("key") == key:
            return {"count": int(row.get("count") or 0), "bytes": int(row.get("bytes") or 0)}
    return {"count": 0, "bytes": 0}


def load_planned_ids(plan: dict[str, Any], plan_root: Path) -> tuple[set[str], int, int]:
    planned_ids: set[str] = set()
    shard_entries = plan.get("shard_entries")
    if not isinstance(shard_entries, list):
        return planned_ids, 0, 0
    shard_count = 0
    manifest_errors = 0
    for entry in shard_entries:
        if not isinstance(entry, dict):
            continue
        manifest = resolve_path(entry.get("manifest"), plan_root)
        if manifest is None or not manifest.exists():
            manifest_errors += 1
            continue
        shard_count += 1
        for row in load_jsonl(manifest):
            file_id = row.get("file_id")
            if isinstance(file_id, str) and file_id:
                planned_ids.add(file_id)
    return planned_ids, shard_count, manifest_errors


def db_duplicate_summary(db_path: Path, planned_ids: set[str]) -> dict[str, Any]:
    db = sqlite3.connect(db_path)
    db.row_factory = sqlite3.Row
    if not table_exists(db, "file_organization_reviews") or not table_exists(db, "files"):
        db.close()
        raise SystemExit("database missing files or file_organization_reviews table")
    if not column_exists(db, "file_organization_reviews", "duplicate_group_id"):
        db.close()
        raise SystemExit("file_organization_reviews.duplicate_group_id column missing")

    has_search_documents = table_exists(db, "file_search_documents")
    if has_search_documents:
        search_join = """
        LEFT JOIN (
          SELECT
            file_id,
            SUM(CASE WHEN status IN ('ready', 'partial') THEN 1 ELSE 0 END) AS ready_document_count
          FROM file_search_documents
          GROUP BY file_id
        ) sd ON sd.file_id = f.id
        """
        ready_column = "COALESCE(sd.ready_document_count, 0) AS ready_document_count"
    else:
        search_join = ""
        ready_column = "0 AS ready_document_count"

    rows = db.execute(
        f"""
        SELECT
          f.id AS file_id,
          COALESCE(f.size, 0) AS size,
          COALESCE(r.review_status, '_none') AS review_status,
          r.duplicate_group_id AS duplicate_group_id,
          {ready_column}
        FROM files f
        JOIN file_organization_reviews r ON r.file_id = f.id
        {search_join}
        WHERE f.status = 'active'
          AND r.duplicate_group_id IS NOT NULL
          AND r.duplicate_group_id != ''
        """
    ).fetchall()
    db.close()

    groups: dict[str, list[sqlite3.Row]] = {}
    for row in rows:
        groups.setdefault(str(row["duplicate_group_id"]), []).append(row)

    total_rows = len(rows)
    total_bytes = sum(int(row["size"] or 0) for row in rows)
    duplicate_rows = [row for row in rows if row["review_status"] == "duplicate"]
    survivor_rows = [row for row in rows if row["review_status"] != "duplicate"]
    duplicate_bytes = sum(int(row["size"] or 0) for row in duplicate_rows)
    survivor_bytes = sum(int(row["size"] or 0) for row in survivor_rows)
    groups_without_active_survivor = 0
    groups_with_multiple_survivors = 0
    groups_without_planned_or_indexed_survivor = 0
    groups_with_planned_survivor = 0
    groups_with_indexed_survivor = 0
    survivor_rows_planned = 0
    survivor_rows_indexed = 0
    duplicate_rows_planned = 0
    for group_rows in groups.values():
        survivors = [row for row in group_rows if row["review_status"] != "duplicate"]
        if not survivors:
            groups_without_active_survivor += 1
        if len(survivors) > 1:
            groups_with_multiple_survivors += 1
        planned_survivors = [row for row in survivors if row["file_id"] in planned_ids]
        indexed_survivors = [row for row in survivors if int(row["ready_document_count"] or 0) > 0]
        if planned_survivors:
            groups_with_planned_survivor += 1
        if indexed_survivors:
            groups_with_indexed_survivor += 1
        if not planned_survivors and not indexed_survivors:
            groups_without_planned_or_indexed_survivor += 1
        survivor_rows_planned += len(planned_survivors)
        survivor_rows_indexed += len(indexed_survivors)
        duplicate_rows_planned += sum(1 for row in group_rows if row["review_status"] == "duplicate" and row["file_id"] in planned_ids)

    return {
        "active_duplicate_groups": len(groups),
        "active_duplicate_group_rows": total_rows,
        "active_duplicate_group_bytes": total_bytes,
        "duplicate_non_survivor_rows": len(duplicate_rows),
        "duplicate_non_survivor_bytes": duplicate_bytes,
        "duplicate_survivor_rows": len(survivor_rows),
        "duplicate_survivor_bytes": survivor_bytes,
        "groups_without_active_survivor": groups_without_active_survivor,
        "groups_with_multiple_survivors": groups_with_multiple_survivors,
        "groups_with_planned_survivor": groups_with_planned_survivor,
        "groups_with_indexed_survivor": groups_with_indexed_survivor,
        "groups_without_planned_or_indexed_survivor": groups_without_planned_or_indexed_survivor,
        "survivor_rows_planned": survivor_rows_planned,
        "survivor_rows_indexed": survivor_rows_indexed,
        "duplicate_non_survivor_rows_accidentally_planned": duplicate_rows_planned,
    }


def build_attestation(plan_path: Path, db_path: Path) -> dict[str, Any]:
    plan = load_json(plan_path)
    plan_root = plan_path.parent
    planned_ids, shard_manifests_read, shard_manifest_errors = load_planned_ids(plan, plan_root)
    completeness = plan.get("completeness") if isinstance(plan.get("completeness"), dict) else {}
    aggregate = completeness.get("aggregate") if isinstance(completeness.get("aggregate"), dict) else {}
    outcome_rows = aggregate.get("by_outcome") if isinstance(aggregate.get("by_outcome"), list) else []
    outcome_coverage_rows = aggregate.get("by_outcome_coverage") if isinstance(aggregate.get("by_outcome_coverage"), list) else []
    declared_totals = plan.get("declared_totals") if isinstance(plan.get("declared_totals"), dict) else {}
    coverage = plan.get("coverage") if isinstance(plan.get("coverage"), dict) else {}

    db_summary = db_duplicate_summary(db_path, planned_ids)
    planned = count_for(outcome_rows, "planned")
    exempt_duplicate = count_for(outcome_rows, "exempt_duplicate")
    duplicate_missing = count_for(outcome_coverage_rows, "exempt_duplicate|missing")
    duplicate_indexed = count_for(outcome_coverage_rows, "exempt_duplicate|indexed")
    duplicate_stale = count_for(outcome_coverage_rows, "exempt_duplicate|stale_only")

    duplicate_counts_match = exempt_duplicate["count"] == db_summary["duplicate_non_survivor_rows"]
    duplicate_bytes_match = exempt_duplicate["bytes"] == db_summary["duplicate_non_survivor_bytes"]
    declared_reconciled = declared_totals.get("reconciled") is True
    no_unplanned = int(declared_totals.get("unplanned_in_scope_files") or 0) == 0
    survivor_coverage_ok = (
        db_summary["groups_without_active_survivor"] == 0
        and db_summary["groups_without_planned_or_indexed_survivor"] == 0
        and db_summary["duplicate_non_survivor_rows_accidentally_planned"] == 0
    )
    policy_ok = (
        shard_manifest_errors == 0
        and duplicate_counts_match
        and duplicate_bytes_match
        and declared_reconciled
        and no_unplanned
        and survivor_coverage_ok
    )
    search_index_ready = int(coverage.get("missing_files") or 0) == 0 and int(coverage.get("stale_only_files") or 0) == 0
    if policy_ok and search_index_ready:
        status = "attested"
    elif policy_ok:
        status = "attested_with_pending_index"
    else:
        status = "blocked"

    blockers: list[str] = []
    if shard_manifest_errors:
        blockers.append("private shard manifests missing or unreadable")
    if not duplicate_counts_match or not duplicate_bytes_match:
        blockers.append("planner duplicate-exempt totals do not match organization duplicate non-survivors")
    if not declared_reconciled or not no_unplanned:
        blockers.append("search-index plan declared totals do not fully reconcile active rows")
    if db_summary["groups_without_active_survivor"]:
        blockers.append("active duplicate groups without an active survivor")
    if db_summary["groups_without_planned_or_indexed_survivor"]:
        blockers.append("active duplicate groups without planned or indexed survivor")
    if db_summary["duplicate_non_survivor_rows_accidentally_planned"]:
        blockers.append("duplicate non-survivor rows accidentally planned for unique search documents")
    if not search_index_ready:
        blockers.append("search index population still pending for planned survivor rows")

    return {
        "kind": "open_files_duplicate_preserve_policy_attestation",
        "generated_at": now_utc(),
        "status": status,
        "policy_ok": policy_ok,
        "search_index_ready": search_index_ready,
        "blockers": blockers,
        "plan": {
            "status": plan.get("status"),
            "approved": bool(plan.get("approved")),
            "include_duplicates": bool(plan.get("include_duplicates")),
            "jobs_planned": int(plan.get("jobs_planned") or 0),
            "planned_outcome_rows": planned["count"],
            "planned_outcome_bytes": planned["bytes"],
            "declared_totals": declared_totals,
            "coverage": {
                "indexed_files": int(coverage.get("indexed_files") or 0),
                "missing_files": int(coverage.get("missing_files") or 0),
                "stale_only_files": int(coverage.get("stale_only_files") or 0),
            },
            "sha256": file_sha256(plan_path),
        },
        "private_manifest_audit": {
            "shard_manifests_read": shard_manifests_read,
            "shard_manifest_errors": shard_manifest_errors,
            "planned_private_ids_count": len(planned_ids),
            "redaction": "private IDs are counted only, never emitted",
        },
        "duplicate_policy": {
            "duplicate_non_survivors_are_preserved": True,
            "duplicate_non_survivors_are_not_unique_search_documents": True,
            "survivor_must_be_planned_or_already_indexed": True,
            "canonical_s3_bytes_remain_immutable": True,
            "duplicate_source_rows_remain_metadata_provenance": True,
            "metadata_apply_must_not_delete_duplicate_rows": True,
        },
        "planner_reconciliation": {
            "exempt_duplicate_rows": exempt_duplicate["count"],
            "exempt_duplicate_bytes": exempt_duplicate["bytes"],
            "exempt_duplicate_missing_rows": duplicate_missing["count"],
            "exempt_duplicate_indexed_rows": duplicate_indexed["count"],
            "exempt_duplicate_stale_only_rows": duplicate_stale["count"],
            "duplicate_counts_match_db": duplicate_counts_match,
            "duplicate_bytes_match_db": duplicate_bytes_match,
            "declared_totals_reconciled": declared_reconciled,
            "unplanned_in_scope_files": int(declared_totals.get("unplanned_in_scope_files") or 0),
        },
        "organization_duplicates": db_summary,
        "scale_readiness": {
            "duplicate_policy_attested": policy_ok,
            "requires_search_index_ready": True,
            "requires_zero_groups_without_planned_or_indexed_survivor": True,
            "requires_zero_duplicate_non_survivors_planned": True,
            "approved_to_scale": bool(policy_ok and search_index_ready),
        },
        "redaction": "attestation contains aggregate counts, booleans, and artifact hashes only; no file IDs, filenames, target paths, object keys, source refs, extracted text, transcripts, row payloads, or secrets",
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Build aggregate duplicate-preserve policy attestation.")
    parser.add_argument("--plan", required=True, help="search-index-population-plan.json")
    parser.add_argument("--db", required=True, help="SQLite files DB path")
    parser.add_argument("--output", required=True, help="Output JSON path")
    args = parser.parse_args()

    plan_path = Path(args.plan).expanduser().resolve()
    db_path = Path(args.db).expanduser().resolve()
    output_path = Path(args.output).expanduser().resolve()
    if not plan_path.exists():
        raise SystemExit(f"plan not found: {plan_path}")
    if not db_path.exists():
        raise SystemExit(f"database not found: {db_path}")

    attestation = build_attestation(plan_path, db_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(attestation, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps(attestation, indent=2, sort_keys=True))
    return 0 if attestation["status"] != "blocked" else 1


if __name__ == "__main__":
    raise SystemExit(main())
