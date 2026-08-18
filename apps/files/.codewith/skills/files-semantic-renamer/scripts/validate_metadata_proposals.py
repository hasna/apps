#!/usr/bin/env python3
"""Validate semantic rename proposal JSONL without mutating open-files."""

from __future__ import annotations

import argparse
import json
import os
import re
import sqlite3
from pathlib import Path
from typing import Any


CONFIDENCE = {"high", "medium", "low"}
REQUIRED_FIELDS = {
    "file_id",
    "canonical_name",
    "target_path",
    "document_kind",
    "confidence",
    "requires_review",
    "reason",
}
ALLOWED_FIELDS = REQUIRED_FIELDS
SEGMENT = re.compile(r"^[a-z0-9][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*)?$")
FILENAME = re.compile(r"^[a-z0-9][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*)?$")
LEAK_PATTERNS = [
    re.compile(r"s3://", re.IGNORECASE),
    re.compile(r"objects/sha256", re.IGNORECASE),
    re.compile(r"source_ref", re.IGNORECASE),
    re.compile(r"google", re.IGNORECASE),
    re.compile(r"https?://", re.IGNORECASE),
]


def default_db_path() -> Path:
    if os.environ.get("HASNA_FILES_DB_PATH"):
        return Path(os.environ["HASNA_FILES_DB_PATH"]).expanduser()
    if os.environ.get("FILES_DB_PATH"):
        return Path(os.environ["FILES_DB_PATH"]).expanduser()
    data_dir = Path(os.environ.get("HASNA_FILES_DATA_DIR", "~/.hasna/files")).expanduser()
    return data_dir / "files.db"


def load_jsonl(path: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    with path.open("r", encoding="utf-8") as handle:
        for line_no, line in enumerate(handle, start=1):
            stripped = line.strip()
            if not stripped:
                continue
            try:
                value = json.loads(stripped)
            except json.JSONDecodeError as exc:
                rows.append({"_line": line_no, "_error": f"invalid json: {exc}"})
                continue
            if not isinstance(value, dict):
                rows.append({"_line": line_no, "_error": "row is not a JSON object"})
                continue
            value["_line"] = line_no
            rows.append(value)
    return rows


def load_manifest(path: Path | None) -> dict[str, dict[str, Any]]:
    if path is None:
        return {}
    jobs: dict[str, dict[str, Any]] = {}
    for row in load_jsonl(path):
        file_id = row.get("file_id")
        if isinstance(file_id, str):
            jobs[file_id] = row
    return jobs


def valid_target_path(path: str) -> bool:
    if not path or path.startswith("/") or "//" in path or len(path) > 512:
        return False
    return all(SEGMENT.match(part) for part in path.split("/"))


def expected_extension(job: dict[str, Any] | None) -> str | None:
    if not job:
        return None
    expected_ext = job.get("expected_ext")
    if isinstance(expected_ext, str) and expected_ext.strip():
        return expected_ext.lower().lstrip(".")
    ext = job.get("ext")
    if isinstance(ext, str) and ext.strip():
        normalized = ext.lower().lstrip(".")
        return normalized if re.fullmatch(r"[a-z0-9][a-z0-9-]*", normalized) else None
    mime = str(job.get("mime") or "").split(";")[0].lower()
    return {
        "application/pdf": "pdf",
        "image/jpeg": "jpg",
        "image/png": "png",
        "image/gif": "gif",
        "text/plain": "txt",
        "text/csv": "csv",
        "application/json": "json",
        "application/zip": "zip",
    }.get(mime)


def reason_has_leak(value: str) -> bool:
    return any(pattern.search(value) for pattern in LEAK_PATTERNS)


def validate_row(row: dict[str, Any], manifest: dict[str, dict[str, Any]], require_review: bool) -> list[str]:
    if row.get("_error"):
        return [str(row["_error"])]
    errors: list[str] = []

    unknown_fields = sorted(set(row) - ALLOWED_FIELDS - {"_line"})
    if unknown_fields:
        errors.append(f"unknown fields: {', '.join(unknown_fields)}")
    for field in sorted(REQUIRED_FIELDS):
        if field not in row:
            errors.append(f"missing {field}")

    file_id = row.get("file_id")
    if not isinstance(file_id, str) or not file_id:
        errors.append("file_id must be a non-empty string")
    elif manifest and file_id not in manifest:
        errors.append("file_id is not in manifest")

    canonical_name = row.get("canonical_name")
    if not isinstance(canonical_name, str) or not canonical_name:
        errors.append("canonical_name must be a non-empty string")
    elif len(canonical_name) > 160 or not FILENAME.match(canonical_name):
        errors.append("canonical_name must be lowercase kebab-case filename")

    target_path = row.get("target_path")
    if not isinstance(target_path, str) or not valid_target_path(target_path):
        errors.append("target_path must be lowercase kebab-case path segments")
    elif isinstance(canonical_name, str) and target_path.split("/")[-1] != canonical_name:
        errors.append("target_path basename must equal canonical_name")

    job = manifest.get(file_id) if isinstance(file_id, str) else None
    ext = expected_extension(job)
    if ext and isinstance(canonical_name, str):
        suffix = f".{ext}"
        if not canonical_name.endswith(suffix):
            errors.append(f"canonical_name must preserve expected extension .{ext}")

    document_kind = row.get("document_kind")
    if not isinstance(document_kind, str) or not document_kind or len(document_kind) > 80:
        errors.append("document_kind must be a non-empty short string")
    elif not re.fullmatch(r"[a-z0-9][a-z0-9-]*", document_kind):
        errors.append("document_kind must be lowercase kebab-case")

    confidence = row.get("confidence")
    if confidence not in CONFIDENCE:
        errors.append("confidence must be high, medium, or low")

    requires_review = row.get("requires_review")
    if not isinstance(requires_review, bool):
        errors.append("requires_review must be boolean")
    elif require_review and requires_review is not True:
        errors.append("requires_review must be true for this validation mode")
    if confidence == "low" and requires_review is not True:
        errors.append("low-confidence proposals must require review")

    reason = row.get("reason")
    if not isinstance(reason, str) or not reason:
        errors.append("reason must be a non-empty string")
    elif len(reason) > 300:
        errors.append("reason must be at most 300 characters")
    elif reason_has_leak(reason):
        errors.append("reason appears to contain private provenance or URL text")

    return errors


def existing_target_conflicts(db_path: Path, scheduled_ids: set[str], proposed_targets: set[str]) -> list[str]:
    if not proposed_targets or not db_path.exists():
        return []
    db = sqlite3.connect(db_path)
    rows = db.execute(
        """
        SELECT r.target_path, r.file_id
        FROM file_organization_reviews r
        JOIN files f ON f.id = r.file_id
        WHERE f.status = 'active'
          AND COALESCE(r.review_status, '') != 'duplicate'
          AND r.target_path IS NOT NULL
          AND r.target_path != ''
        """
    ).fetchall()
    conflicts: list[str] = []
    for target_path, file_id in rows:
        if target_path in proposed_targets and file_id not in scheduled_ids:
            conflicts.append(str(target_path))
    return sorted(set(conflicts))


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate semantic rename proposal JSONL.")
    parser.add_argument("proposal_jsonl", help="Proposal JSONL file")
    parser.add_argument("--errors-output", help="Optional JSONL file for validation errors")
    parser.add_argument("--manifest", help="Manifest JSONL used to schedule this proposal batch")
    parser.add_argument("--require-all-manifest-ids", action="store_true", help="Require one proposal for every manifest file_id")
    parser.add_argument("--require-review", action="store_true", help="Require requires_review=true on every proposal")
    parser.add_argument("--db", default=str(default_db_path()), help="SQLite DB path for global target uniqueness checks")
    parser.add_argument("--skip-db-check", action="store_true", help="Skip global target_path uniqueness check")
    args = parser.parse_args()

    path = Path(args.proposal_jsonl).expanduser()
    rows = load_jsonl(path)
    manifest = load_manifest(Path(args.manifest).expanduser() if args.manifest else None)
    scheduled_ids = set(manifest)

    errors: list[dict[str, Any]] = []
    target_paths: dict[str, int] = {}
    file_ids: dict[str, int] = {}
    confidence_counts = {key: 0 for key in sorted(CONFIDENCE)}

    for row in rows:
        row_errors = validate_row(row, manifest, args.require_review)
        if row_errors:
            errors.append({"line": row.get("_line"), "file_id": row.get("file_id"), "errors": row_errors})
        target = row.get("target_path")
        if isinstance(target, str):
            target_paths[target] = target_paths.get(target, 0) + 1
        file_id = row.get("file_id")
        if isinstance(file_id, str):
            file_ids[file_id] = file_ids.get(file_id, 0) + 1
        confidence = row.get("confidence")
        if confidence in confidence_counts:
            confidence_counts[confidence] += 1

    for target, count in sorted(target_paths.items()):
        if count > 1:
            errors.append({"line": None, "file_id": None, "errors": [f"duplicate target_path: {target}"]})
    for file_id, count in sorted(file_ids.items()):
        if count > 1:
            errors.append({"line": None, "file_id": file_id, "errors": ["duplicate file_id proposal"]})

    if args.require_all_manifest_ids and manifest:
        missing = sorted(scheduled_ids - set(file_ids))
        for file_id in missing:
            errors.append({"line": None, "file_id": file_id, "errors": ["missing proposal for manifest file_id"]})

    if not args.skip_db_check:
        conflicts = existing_target_conflicts(Path(args.db).expanduser(), scheduled_ids, set(target_paths))
        for target in conflicts:
            errors.append({"line": None, "file_id": None, "errors": [f"target_path conflicts with existing active file: {target}"]})

    if args.errors_output:
        output_path = Path(args.errors_output).expanduser().resolve()
        output_path.parent.mkdir(parents=True, exist_ok=True)
        with output_path.open("w", encoding="utf-8") as handle:
            for error in errors:
                handle.write(json.dumps(error, sort_keys=True) + "\n")

    duplicate_targets = sum(1 for count in target_paths.values() if count > 1)
    duplicate_file_ids = sum(1 for count in file_ids.values() if count > 1)
    print(json.dumps({
        "status": "valid" if not errors else "invalid",
        "rows": len(rows),
        "errors": len(errors),
        "duplicate_target_paths": duplicate_targets,
        "duplicate_file_ids": duplicate_file_ids,
        "confidence": confidence_counts,
        "manifest_ids": len(manifest),
        "errors_output": str(Path(args.errors_output).expanduser().resolve()) if args.errors_output else None,
    }, indent=2, sort_keys=True))
    return 0 if not errors else 1


if __name__ == "__main__":
    raise SystemExit(main())
