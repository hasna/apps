#!/usr/bin/env python3
"""Validate private Drive approval-note artifacts into a redacted summary."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import time
from pathlib import Path
from typing import Any


DEFAULT_NOTES_DIR = ".codewith/private-artifacts/drive-approval"
DEFAULT_REQUEST_PACKET = ".codewith/private-artifacts/drive-approval/drive-approval-request-packet.json"
DEFAULT_OUTPUT = ".codewith/private-artifacts/drive-approval/drive-approval-notes-summary.json"

IGNORED_APPROVAL_ARTIFACT_NAMES = {
    "drive-approval-queue.json",
    "drive-approval-queue-verification.json",
    "drive-approval-request-packet.json",
    "drive-approval-request-verification.json",
    "drive-approval-notes-summary.json",
    "drive-approval-notes-verification.json",
}

ALLOWED_SCOPES = {
    "acl-owner-approval",
    "duplicate-owner-assignment",
    "metadata-apply-audit",
    "backup-rollback-evidence",
    "unassigned-folder-review",
    "drive-approval",
}

SENSITIVE_PATTERNS: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("json_file_id_key", re.compile(r'"file_id"\s*:')),
    ("private_file_id_value", re.compile(r"\bf_[A-Za-z0-9][A-Za-z0-9_-]{5,}\b")),
    ("open_files_ref", re.compile(r"open-files://")),
    ("s3_uri", re.compile(r"s3://")),
    ("object_sha_key", re.compile(r"objects/sha256/")),
    ("json_object_key", re.compile(r'"object_key"\s*:')),
    ("json_s3_key", re.compile(r'"s3_key"\s*:')),
    ("json_source_ref", re.compile(r'"source_ref"\s*:')),
    ("json_extracted_text", re.compile(r'"extracted_text"\s*:')),
    ("json_transcript", re.compile(r'"transcript"\s*:')),
    ("json_private_metadata", re.compile(r'"private_metadata"\s*:')),
    ("google_drive_url", re.compile(r"(drive|docs)\.google\.com/")),
)


def now_utc() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def sha256_text(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def source_entry(label: str, path: Path | None) -> dict[str, Any]:
    return {
        "label": label,
        "present": bool(path and path.exists()),
        "bytes": path.stat().st_size if path and path.exists() else 0,
        "sha256": file_sha256(path) if path and path.exists() else None,
    }


def load_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise ValueError("invalid_json") from exc
    if not isinstance(value, dict):
        raise ValueError("not_json_object")
    return value


def load_packet(path: Path | None) -> dict[str, Any] | None:
    if path is None or not path.exists():
        return None
    return load_json(path)


def scan_text(text: str) -> dict[str, int]:
    counts: dict[str, int] = {}
    for code, pattern in SENSITIVE_PATTERNS:
        count = len(pattern.findall(text))
        if count:
            counts[code] = count
    return counts


def list_value(value: Any) -> list[Any]:
    return value if isinstance(value, list) else []


def dict_value(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def request_expectations(packet: dict[str, Any] | None) -> dict[str, dict[str, Any]]:
    expectations: dict[str, dict[str, Any]] = {}
    if not isinstance(packet, dict):
        return expectations
    for item in list_value(packet.get("templates")):
        if not isinstance(item, dict) or not isinstance(item.get("decision_id"), str):
            continue
        expectations[item["decision_id"]] = {
            "scope": item.get("scope"),
            "task_id_sha256": item.get("task_id_sha256"),
            "title_sha256": item.get("title_sha256"),
            "root_type": item.get("root_type"),
            "business_area": item.get("business_area"),
            "approval_type": item.get("approval_type"),
            "primary_row_hint": item.get("primary_row_hint"),
            "source_doc_hashes": item.get("source_doc_hashes") if isinstance(item.get("source_doc_hashes"), list) else [],
        }
    return expectations


def source_doc_hash_projection(value: Any) -> list[dict[str, Any]]:
    output: list[dict[str, Any]] = []
    for item in list_value(value):
        if not isinstance(item, dict):
            continue
        output.append({
            "path": item.get("path"),
            "present": item.get("present"),
            "bytes": item.get("bytes"),
            "sha256": item.get("sha256"),
        })
    return output


def validate_against_request(note: dict[str, Any], expected: dict[str, Any] | None) -> tuple[list[str], dict[str, Any]]:
    if expected is None:
        return ["decision_missing_from_drive_request_packet"], {
            "drive_request_checked": True,
            "context_matches": False,
            "source_doc_hashes_match": False,
        }
    errors: list[str] = []
    context = dict_value(note.get("queue_entry_context"))
    if note.get("scope") != expected.get("scope"):
        errors.append("drive_request_scope_mismatch")
    for key in ("task_id_sha256", "title_sha256", "root_type", "business_area", "approval_type", "primary_row_hint"):
        if context.get(key) != expected.get(key):
            errors.append(f"context_{key}_mismatch")
    source_doc_hashes_match = source_doc_hash_projection(context.get("source_doc_hashes")) == source_doc_hash_projection(expected.get("source_doc_hashes"))
    if not source_doc_hashes_match:
        errors.append("source_doc_hashes_mismatch")
    return errors, {
        "drive_request_checked": True,
        "context_matches": not errors,
        "source_doc_hashes_match": source_doc_hashes_match,
        "root_type": context.get("root_type"),
        "business_area": context.get("business_area"),
        "approval_type": context.get("approval_type"),
        "primary_row_hint": context.get("primary_row_hint"),
    }


def validate_note(path: Path, expectations: dict[str, dict[str, Any]] | None) -> dict[str, Any]:
    errors: list[str] = []
    try:
        note = load_json(path)
    except ValueError as exc:
        return {
            "valid": False,
            "decision_id": None,
            "status": None,
            "errors": [str(exc)],
            "artifact_sha256": file_sha256(path),
        }

    if note.get("kind") != "open_files_drive_approval_note":
        errors.append("invalid_kind")
    if note.get("version") != 1:
        errors.append("invalid_version")
    decision_id = note.get("decision_id")
    status = note.get("status")
    scope = note.get("scope")
    approved_at = note.get("approved_at")
    expires_at = note.get("expires_at")
    note_text = note.get("approval_note")
    note_hash = note.get("approval_note_sha256")

    if not isinstance(decision_id, str) or not decision_id.startswith("drive_"):
        errors.append("invalid_decision_id")
    if status not in {"approved", "denied", "deferred"}:
        errors.append("invalid_status")
    if not isinstance(scope, str) or scope not in ALLOWED_SCOPES:
        errors.append("invalid_scope")
    if not isinstance(approved_at, str) or not approved_at:
        errors.append("missing_approved_at")
    if expires_at is not None and not isinstance(expires_at, str):
        errors.append("invalid_expires_at")
    if not isinstance(note.get("approved_by"), str) or not note.get("approved_by"):
        errors.append("missing_approved_by")
    if isinstance(note_text, str) and note_text:
        computed_hash = sha256_text(note_text)
        if isinstance(note_hash, str) and note_hash and note_hash != computed_hash:
            errors.append("approval_note_hash_mismatch")
        note_hash = computed_hash
    elif not isinstance(note_hash, str) or not re.fullmatch(r"[a-f0-9]{64}", note_hash):
        errors.append("missing_approval_note_hash")

    request_summary = {
        "drive_request_checked": False,
        "context_matches": None,
        "source_doc_hashes_match": None,
    }
    if isinstance(decision_id, str) and expectations is not None:
        request_errors, request_summary = validate_against_request(note, expectations.get(decision_id))
        errors.extend(request_errors)

    return {
        "valid": not errors,
        "decision_id": decision_id if isinstance(decision_id, str) else None,
        "status": status if isinstance(status, str) else None,
        "scope": scope if isinstance(scope, str) else None,
        "approved_at": approved_at if isinstance(approved_at, str) else None,
        "expires_at": expires_at if isinstance(expires_at, str) else None,
        "approved_by_present": isinstance(note.get("approved_by"), str) and bool(note.get("approved_by")),
        "approval_note_present": isinstance(note_text, str) and bool(note_text),
        "approval_note_sha256": note_hash if isinstance(note_hash, str) and re.fullmatch(r"[a-f0-9]{64}", note_hash) else None,
        "drive_request_checked": request_summary.get("drive_request_checked"),
        "context_matches": request_summary.get("context_matches"),
        "source_doc_hashes_match": request_summary.get("source_doc_hashes_match"),
        "root_type": request_summary.get("root_type"),
        "business_area": request_summary.get("business_area"),
        "approval_type": request_summary.get("approval_type"),
        "primary_row_hint": request_summary.get("primary_row_hint"),
        "artifact_sha256": file_sha256(path),
        "errors": errors,
    }


def required_decisions_from_packet(packet: dict[str, Any] | None, required: str | None) -> list[str]:
    if required:
        return [item.strip() for item in required.split(",") if item.strip()]
    if isinstance(packet, dict) and isinstance(packet.get("required_decisions"), list):
        return [str(item) for item in packet["required_decisions"] if isinstance(item, str)]
    return []


def note_paths(notes_dir: Path) -> list[Path]:
    if not notes_dir.exists():
        return []
    return sorted(
        path
        for path in notes_dir.glob("*.json")
        if path.is_file()
        and path.name not in IGNORED_APPROVAL_ARTIFACT_NAMES
        and not path.name.endswith(".template.json")
    )


def build_summary(notes_dir: Path, required_decisions: list[str], request_packet: dict[str, Any] | None, source_artifacts: list[dict[str, Any]]) -> dict[str, Any]:
    expectations = request_expectations(request_packet) if isinstance(request_packet, dict) else None
    paths = note_paths(notes_dir)
    notes = [validate_note(path, expectations) for path in paths]
    by_decision: dict[str, dict[str, Any]] = {}
    duplicate_decisions: set[str] = set()
    for note in notes:
        decision_id = note.get("decision_id")
        if not isinstance(decision_id, str):
            continue
        if decision_id in by_decision:
            duplicate_decisions.add(decision_id)
            if by_decision[decision_id].get("valid") is True and note.get("valid") is not True:
                continue
        by_decision[decision_id] = note

    required_items: list[dict[str, Any]] = []
    for decision_id in required_decisions:
        note = by_decision.get(decision_id)
        required_items.append({
            "decision_id": decision_id,
            "present": note is not None,
            "valid": bool(note and note.get("valid") is True),
            "status": note.get("status") if note else None,
            "scope": note.get("scope") if note else None,
            "approved_at": note.get("approved_at") if note else None,
            "expires_at": note.get("expires_at") if note else None,
            "approved_by_present": note.get("approved_by_present") if note else False,
            "approval_note_present": note.get("approval_note_present") if note else False,
            "approval_note_sha256": note.get("approval_note_sha256") if note else None,
            "drive_request_checked": note.get("drive_request_checked") if note else bool(expectations),
            "context_matches": note.get("context_matches") if note else None,
            "source_doc_hashes_match": note.get("source_doc_hashes_match") if note else None,
            "root_type": note.get("root_type") if note else None,
            "business_area": note.get("business_area") if note else None,
            "approval_type": note.get("approval_type") if note else None,
            "primary_row_hint": note.get("primary_row_hint") if note else None,
            "artifact_sha256": note.get("artifact_sha256") if note else None,
            "errors": note.get("errors") if note else ["missing_drive_approval_note_artifact"],
        })

    missing_required = [item["decision_id"] for item in required_items if item["present"] is not True]
    invalid_required = [item["decision_id"] for item in required_items if item["present"] is True and item["valid"] is not True]
    approved_required = [
        item["decision_id"]
        for item in required_items
        if item["valid"] is True and item["status"] == "approved"
    ]
    if invalid_required:
        status = "invalid"
    elif missing_required:
        status = "missing_required"
    elif len(approved_required) == len(required_items):
        status = "approved"
    else:
        status = "not_fully_approved"

    summary = {
        "kind": "open_files_drive_approval_notes_summary",
        "version": 1,
        "created_at": now_utc(),
        "status": status,
        "notes_dir_present": notes_dir.exists(),
        "artifact_count": len(paths),
        "valid_artifact_count": sum(1 for note in notes if note.get("valid") is True),
        "drive_request_packet_present": bool(request_packet),
        "drive_request_packet_status": request_packet.get("status") if isinstance(request_packet, dict) else None,
        "drive_request_template_count": request_packet.get("template_count") if isinstance(request_packet, dict) else None,
        "required_decision_count": len(required_items),
        "approved_required_decision_count": len(approved_required),
        "missing_required_decisions": missing_required,
        "invalid_required_decisions": invalid_required,
        "duplicate_decisions": sorted(duplicate_decisions),
        "required_decisions": required_items,
        "source_artifacts": source_artifacts,
        "redaction": "summary omits Drive approval note text, private filenames, file IDs, object keys, source refs, extracted text, transcripts, ACL payloads, row payloads, and secrets",
    }
    marker_counts = scan_text(json.dumps(summary, sort_keys=True))
    summary["redaction_check"] = {
        "sensitive_marker_counts": marker_counts,
        "passed": not marker_counts,
    }
    if marker_counts:
        summary["status"] = "redaction_failed"
    return summary


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate private Drive approval-note artifacts.")
    parser.add_argument("--notes-dir", default=DEFAULT_NOTES_DIR)
    parser.add_argument("--required-decisions", help="Comma-separated required Drive approval decision ids")
    parser.add_argument("--drive-request-packet", default=DEFAULT_REQUEST_PACKET)
    parser.add_argument("--output", default=DEFAULT_OUTPUT)
    args = parser.parse_args()

    notes_dir = Path(args.notes_dir).expanduser().resolve()
    packet_path = Path(args.drive_request_packet).expanduser().resolve() if args.drive_request_packet else None
    request_packet = load_packet(packet_path)
    required = required_decisions_from_packet(request_packet, args.required_decisions)
    summary = build_summary(
        notes_dir,
        required,
        request_packet,
        source_artifacts=[source_entry("drive_approval_request_packet", packet_path)],
    )
    output = Path(args.output).expanduser().resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(summary, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps({
        "kind": summary["kind"],
        "status": summary["status"],
        "artifact_count": summary["artifact_count"],
        "valid_artifact_count": summary["valid_artifact_count"],
        "approved_required_decision_count": summary["approved_required_decision_count"],
        "missing_required_decisions": summary["missing_required_decisions"],
        "invalid_required_decisions": summary["invalid_required_decisions"],
        "redaction_check": summary["redaction_check"],
    }, indent=2, sort_keys=True))
    return 0 if summary["redaction_check"]["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
