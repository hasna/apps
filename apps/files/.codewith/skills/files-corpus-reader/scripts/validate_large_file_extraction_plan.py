#!/usr/bin/env python3
"""Validate a redacted large-file extraction plan before execution.

This reads private shard manifests to verify counts, checksums, duplicate file
coverage, and redaction. Stdout is aggregate-only and never includes file IDs,
filenames, object keys, source refs, OCR text, transcripts, or row payloads.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any


SENSITIVE_SUBSTRINGS = (
    "file_id",
    "source_ref",
    "s3://",
    "objects/sha256/",
)


@dataclass(frozen=True)
class Issue:
    code: str
    location: str
    message: str

    def to_json(self) -> dict[str, str]:
        return {"code": self.code, "location": self.location, "message": self.message}


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise SystemExit(f"invalid JSON: {path}") from exc
    if not isinstance(value, dict):
        raise SystemExit(f"invalid JSON object: {path}")
    return value


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
                raise SystemExit(f"invalid shard JSONL at line {line_no}") from exc
            if not isinstance(value, dict):
                raise SystemExit(f"invalid shard JSONL at line {line_no}: row is not an object")
            rows.append(value)
    return rows


def resolve_path(value: Any, base: Path) -> Path | None:
    if not isinstance(value, str) or not value:
        return None
    path = Path(value).expanduser()
    if not path.is_absolute():
        path = base / path
    return path.resolve()


def bump(table: dict[str, dict[str, int]], key: str, count: int, bytes_: int) -> None:
    entry = table.setdefault(key, {"count": 0, "bytes": 0})
    entry["count"] += count
    entry["bytes"] += bytes_


def summarize(rows: list[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    by_lane: dict[str, dict[str, int]] = {}
    by_strategy: dict[str, dict[str, int]] = {}
    for row in rows:
        size = int(row.get("size") or 0)
        bump(by_lane, str(row.get("lane") or "unknown"), 1, size)
        bump(by_strategy, str(row.get("strategy") or "unknown"), 1, size)

    def rows_out(table: dict[str, dict[str, int]]) -> list[dict[str, Any]]:
        values = [{"key": key, **value} for key, value in table.items()]
        values.sort(key=lambda item: (-item["count"], -item["bytes"], item["key"]))
        return values

    return {"by_lane": rows_out(by_lane), "by_strategy": rows_out(by_strategy)}


def validate_plan(plan_path: Path) -> dict[str, Any]:
    plan_path = plan_path.expanduser().resolve()
    plan_root = plan_path.parent
    plan_text = plan_path.read_text(encoding="utf-8")
    plan = load_json(plan_path)
    errors: list[Issue] = []
    warnings: list[Issue] = []
    approved = bool(plan.get("approved"))

    if approved and plan.get("status") != "approved":
        errors.append(Issue("approval_status_mismatch", "plan", "approved plan has wrong status"))
    if not approved and plan.get("status") != "approval_required":
        errors.append(Issue("approval_status_mismatch", "plan", "unapproved plan has wrong status"))
    gate = plan.get("approval_gate")
    if not isinstance(gate, dict) or gate.get("required") is not True:
        errors.append(Issue("approval_gate_missing", "plan", "approval gate is missing or disabled"))
    elif bool(gate.get("approved")) != approved:
        errors.append(Issue("approval_gate_mismatch", "plan", "approval gate does not match plan approved value"))
    approval_attestation = plan.get("approval_attestation")
    if not isinstance(approval_attestation, dict):
        errors.append(Issue("approval_attestation_missing", "plan", "approval attestation is missing"))
    else:
        expected_status = "approved" if approved else "approval_required"
        if approval_attestation.get("status") != expected_status:
            errors.append(Issue("approval_attestation_mismatch", "plan", "approval attestation status does not match plan"))
        if bool(approval_attestation.get("approved")) != approved:
            errors.append(Issue("approval_attestation_mismatch", "plan", "approval attestation approved value does not match plan"))
        note_present = approval_attestation.get("approval_note_present") is True
        note_hash = approval_attestation.get("approval_note_sha256")
        if approved and not note_present:
            errors.append(Issue("approved_plan_missing_note", "plan", "approved plan is missing approval note attestation"))
        if isinstance(plan.get("approval_note"), str) and plan.get("approval_note"):
            expected_note_hash = hashlib.sha256(plan["approval_note"].encode("utf-8")).hexdigest()
            if note_hash != expected_note_hash:
                errors.append(Issue("approval_attestation_mismatch", "plan", "approval note hash does not match plan"))
        elif note_present and (not isinstance(note_hash, str) or not re.fullmatch(r"[a-f0-9]{64}", note_hash)):
            errors.append(Issue("approval_attestation_mismatch", "plan", "approval note hash is missing or invalid"))

    entries = plan.get("shard_entries")
    if not isinstance(entries, list):
        errors.append(Issue("invalid_shard_entries", "plan", "shard_entries must be a list"))
        entries = []

    all_rows: list[dict[str, Any]] = []
    all_file_ids: list[str] = []
    for index, entry in enumerate(entries, start=1):
        location = str(entry.get("shard") or f"shard-{index:04d}") if isinstance(entry, dict) else f"shard-{index:04d}"
        if not isinstance(entry, dict):
            errors.append(Issue("invalid_shard_entry", location, "shard entry is not an object"))
            continue
        shard = resolve_path(entry.get("manifest"), plan_root)
        if shard is None:
            errors.append(Issue("missing_shard_manifest", location, "shard manifest is missing"))
            continue
        if not shard.exists():
            errors.append(Issue("shard_manifest_not_found", location, "shard manifest does not exist"))
            continue
        expected_sha = entry.get("manifest_sha256")
        if isinstance(expected_sha, str) and file_sha256(shard) != expected_sha:
            errors.append(Issue("shard_manifest_sha_mismatch", location, "shard manifest checksum changed"))
        rows = load_jsonl(shard)
        all_rows.extend(rows)
        if entry.get("jobs") != len(rows):
            errors.append(Issue("shard_job_count_mismatch", location, "shard job count does not match manifest"))
        bytes_sum = sum(int(row.get("size") or 0) for row in rows)
        if entry.get("bytes") != bytes_sum:
            errors.append(Issue("shard_bytes_mismatch", location, "shard byte total does not match manifest"))
        for row in rows:
            file_id = row.get("file_id")
            if isinstance(file_id, str) and file_id:
                all_file_ids.append(file_id)
            else:
                errors.append(Issue("row_missing_file_id", location, "private row is missing file ID"))
            if any(key in row for key in ("name", "file_name", "source_ref", "object_key", "s3_key", "path")):
                errors.append(Issue("private_shard_contains_disallowed_field", location, "private shard contains disallowed provenance/name field"))

    jobs = len(all_rows)
    bytes_planned = sum(int(row.get("size") or 0) for row in all_rows)
    if plan.get("jobs_planned") != jobs:
        errors.append(Issue("jobs_planned_mismatch", "plan", "jobs_planned does not match shard manifests"))
    if plan.get("bytes_planned") != bytes_planned:
        errors.append(Issue("bytes_planned_mismatch", "plan", "bytes_planned does not match shard manifests"))
    if plan.get("shards") != len(entries):
        errors.append(Issue("shard_count_mismatch", "plan", "shard count does not match shard entries"))

    duplicates = len(all_file_ids) - len(set(all_file_ids))
    if duplicates:
        errors.append(Issue("duplicate_private_file_ids", "plan", "private shard manifests contain duplicate file IDs"))

    sensitive_hits = sum(1 for marker in SENSITIVE_SUBSTRINGS if marker in plan_text)
    leaked_ids = sum(1 for file_id in set(all_file_ids) if file_id in plan_text)
    if sensitive_hits or leaked_ids:
        errors.append(Issue("plan_redaction_failure", "plan", "plan contains sensitive private markers or IDs"))

    aggregate = summarize(all_rows)
    return {
        "status": "ok" if not errors else "error",
        "plan": str(plan_path),
        "approved": approved,
        "jobs_planned": plan.get("jobs_planned"),
        "jobs_from_shards": jobs,
        "bytes_planned": plan.get("bytes_planned"),
        "bytes_from_shards": bytes_planned,
        "shards": len(entries),
        "duplicate_private_file_ids": duplicates,
        "plan_sensitive_marker_hits": sensitive_hits,
        "plan_private_id_leaks": leaked_ids,
        "aggregate": aggregate,
        "errors": [issue.to_json() for issue in errors],
        "warnings": [issue.to_json() for issue in warnings],
        "redaction": "summary omits file IDs, filenames, paths, object keys, source refs, OCR text, transcripts, and row payloads",
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate a large-file extraction plan without executing it.")
    parser.add_argument("--plan", required=True, help="Path to large-file-extraction-plan.json")
    parser.add_argument("--summary-output", help="Optional redacted validation summary JSON path")
    args = parser.parse_args()

    summary = validate_plan(Path(args.plan))
    output = json.dumps(summary, indent=2, sort_keys=True)
    print(output)
    if args.summary_output:
        output_path = Path(args.summary_output).expanduser().resolve()
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(output + "\n", encoding="utf-8")
    return 0 if summary["status"] == "ok" else 1


if __name__ == "__main__":
    raise SystemExit(main())
