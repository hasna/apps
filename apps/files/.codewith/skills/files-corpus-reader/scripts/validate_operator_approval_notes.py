#!/usr/bin/env python3
"""Validate aggregate-safe operator approval-note artifacts.

Approval notes are private artifacts. This script reads them, validates their
shape, hashes note text when present, and writes a redacted aggregate summary
that can be consumed by approval dashboards and stage gates.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import time
from pathlib import Path
from typing import Any


DEFAULT_NOTES_DIR = ".codewith/private-artifacts/operator-approvals"
DEFAULT_OUTPUT = ".codewith/private-artifacts/operator-approvals/approval-notes-summary.json"
DEFAULT_APPROVAL_REQUEST_PACKET = ".codewith/private-artifacts/operator-approvals/approval-request-packet.json"

ALLOWED_DECISIONS = {
    "ocr_vision_canary",
    "large_file_canary",
    "archive_worker_image",
    "search_index_population",
    "llm_review_campaign",
    "deferred_media_final_pass",
}

DEFAULT_REQUIRED_DECISIONS = [
    "ocr_vision_canary",
    "large_file_canary",
    "archive_worker_image",
    "search_index_population",
    "llm_review_campaign",
]

IGNORED_APPROVAL_ARTIFACT_NAMES = {
    "approval-intake-readiness.json",
    "approval-notes-summary.json",
    "approval-request-packet.json",
    "approval-request-packet-verification.json",
    "post-approval-canary-command-plan.json",
    "post-approval-canary-command-plan-verification.json",
    "post-approval-canary-command-run-summary.json",
    "post-approval-canary-command-run-verification.json",
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


def load_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise ValueError("invalid_json") from exc
    if not isinstance(value, dict):
        raise ValueError("not_json_object")
    return value


def scan_text(text: str) -> dict[str, int]:
    counts: dict[str, int] = {}
    for code, pattern in SENSITIVE_PATTERNS:
        count = len(pattern.findall(text))
        if count:
            counts[code] = count
    return counts


def parse_required(value: str | None) -> list[str]:
    if not value:
        return list(DEFAULT_REQUIRED_DECISIONS)
    required = [item.strip() for item in value.split(",") if item.strip()]
    invalid = sorted(set(required) - ALLOWED_DECISIONS)
    if invalid:
        raise SystemExit(f"unknown required approval decision id: {', '.join(invalid)}")
    return required


def approval_request_expectations(packet: dict[str, Any] | None) -> dict[str, dict[str, Any]]:
    if not packet:
        return {}
    templates = packet.get("templates") if isinstance(packet.get("templates"), list) else []
    expectations: dict[str, dict[str, Any]] = {}
    for item in templates:
        if not isinstance(item, dict) or not isinstance(item.get("decision_id"), str):
            continue
        expectations[item["decision_id"]] = {
            "scope": item.get("scope"),
            "remediation_action_ids": item.get("remediation_action_ids") if isinstance(item.get("remediation_action_ids"), list) else [],
            "remediation_status": item.get("remediation_status"),
            "command_hashes": item.get("command_hashes") if isinstance(item.get("command_hashes"), list) else [],
        }
    return expectations


def is_generated_support_artifact(path: Path) -> bool:
    name = path.name
    return (
        name in IGNORED_APPROVAL_ARTIFACT_NAMES
        or name.endswith(".template.json")
        or name.startswith("post-approval-canary-command-")
    )


def validate_against_approval_request(note: dict[str, Any], expected: dict[str, Any] | None) -> tuple[list[str], dict[str, Any]]:
    if not expected:
        return [], {
            "approval_request_checked": False,
            "remediation_action_ids": [],
            "remediation_status": None,
            "command_hashes_match": None,
        }
    errors: list[str] = []
    remediation = note.get("remediation_context") if isinstance(note.get("remediation_context"), dict) else None
    linked_action_ids = remediation.get("linked_action_ids") if isinstance(remediation, dict) and isinstance(remediation.get("linked_action_ids"), list) else None
    remediation_status = remediation.get("status") if isinstance(remediation, dict) else None
    redaction = remediation.get("redaction_check") if isinstance(remediation, dict) and isinstance(remediation.get("redaction_check"), dict) else {}
    expected_ids = expected.get("remediation_action_ids") if isinstance(expected.get("remediation_action_ids"), list) else []
    if note.get("scope") != expected.get("scope"):
        errors.append("approval_request_scope_mismatch")
    if remediation is None:
        errors.append("missing_remediation_context")
    if linked_action_ids != expected_ids:
        errors.append("remediation_action_ids_mismatch")
    if remediation_status != expected.get("remediation_status"):
        errors.append("remediation_status_mismatch")
    if redaction.get("passed") is not True:
        errors.append("remediation_redaction_not_passed")
    command_hashes = note.get("command_hashes") if isinstance(note.get("command_hashes"), list) else []
    expected_command_hashes = expected.get("command_hashes") if isinstance(expected.get("command_hashes"), list) else []
    command_hashes_match = command_hashes == expected_command_hashes
    if not command_hashes_match:
        errors.append("command_hashes_mismatch")
    return errors, {
        "approval_request_checked": True,
        "remediation_action_ids": linked_action_ids if isinstance(linked_action_ids, list) else [],
        "remediation_status": remediation_status if isinstance(remediation_status, str) else None,
        "command_hashes_match": command_hashes_match,
    }


def validate_note(path: Path, request_expectations: dict[str, dict[str, Any]] | None = None) -> dict[str, Any]:
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

    decision_id = note.get("decision_id")
    status = note.get("status")
    scope = note.get("scope")
    approved_at = note.get("approved_at")
    expires_at = note.get("expires_at")
    note_text = note.get("approval_note")
    note_hash = note.get("approval_note_sha256")

    if note.get("kind") != "open_files_operator_approval_note":
        errors.append("invalid_kind")
    if note.get("version") != 1:
        errors.append("invalid_version")
    if decision_id not in ALLOWED_DECISIONS:
        errors.append("unknown_decision_id")
    if status not in {"approved", "denied", "deferred"}:
        errors.append("invalid_status")
    if not isinstance(scope, str) or scope not in {"canary", "full-run", "worker-build", "provider-use", "media-final-pass"}:
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
    request_errors: list[str] = []
    request_summary = {
        "approval_request_checked": False,
        "remediation_action_ids": [],
        "remediation_status": None,
        "command_hashes_match": None,
    }
    if isinstance(decision_id, str) and request_expectations is not None:
        expected = request_expectations.get(decision_id)
        if expected is None:
            request_errors.append("decision_missing_from_approval_request_packet")
        else:
            request_errors, request_summary = validate_against_approval_request(note, expected)
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
        "approval_request_checked": request_summary["approval_request_checked"],
        "remediation_action_ids": request_summary["remediation_action_ids"],
        "remediation_status": request_summary["remediation_status"],
        "command_hashes_match": request_summary["command_hashes_match"],
        "artifact_sha256": file_sha256(path),
        "errors": errors,
    }


def build_summary(notes_dir: Path, required_decisions: list[str], approval_request_packet: dict[str, Any] | None = None) -> dict[str, Any]:
    note_paths = sorted(
        path
        for path in notes_dir.glob("*.json")
        if path.is_file() and not is_generated_support_artifact(path)
    ) if notes_dir.exists() else []
    request_expectations = approval_request_expectations(approval_request_packet) if approval_request_packet else None
    notes = [validate_note(path, request_expectations) for path in note_paths]
    by_decision: dict[str, dict[str, Any]] = {}
    duplicate_decisions: set[str] = set()
    for note in notes:
        decision_id = note.get("decision_id")
        if not isinstance(decision_id, str):
            continue
        existing = by_decision.get(decision_id)
        if existing is not None:
            duplicate_decisions.add(decision_id)
            if existing.get("valid") is True and note.get("valid") is not True:
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
            "approval_request_checked": note.get("approval_request_checked") if note else bool(request_expectations),
            "remediation_action_ids": note.get("remediation_action_ids") if note else [],
            "remediation_status": note.get("remediation_status") if note else None,
            "command_hashes_match": note.get("command_hashes_match") if note else None,
            "artifact_sha256": note.get("artifact_sha256") if note else None,
            "errors": note.get("errors") if note else ["missing_approval_note_artifact"],
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
        "kind": "open_files_operator_approval_notes_summary",
        "version": 1,
        "created_at": now_utc(),
        "status": status,
        "notes_dir_present": notes_dir.exists(),
        "artifact_count": len(note_paths),
        "valid_artifact_count": sum(1 for note in notes if note.get("valid") is True),
        "approval_request_packet_present": bool(approval_request_packet),
        "approval_request_packet_status": approval_request_packet.get("status") if isinstance(approval_request_packet, dict) else None,
        "approval_request_template_count": approval_request_packet.get("template_count") if isinstance(approval_request_packet, dict) else None,
        "required_decision_count": len(required_items),
        "approved_required_decision_count": len(approved_required),
        "missing_required_decisions": missing_required,
        "invalid_required_decisions": invalid_required,
        "duplicate_decisions": sorted(duplicate_decisions),
        "required_decisions": required_items,
        "redaction": "summary omits approval note text, private filenames, file IDs, object keys, source refs, extracted text, transcripts, ACL payloads, row payloads, and secrets",
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
    parser = argparse.ArgumentParser(description="Validate private operator approval-note artifacts.")
    parser.add_argument("--notes-dir", default=DEFAULT_NOTES_DIR)
    parser.add_argument("--required-decisions", help="Comma-separated required approval decision ids")
    parser.add_argument("--approval-request-packet", help="Optional current approval request packet for remediation/template consistency checks")
    parser.add_argument("--output", default=DEFAULT_OUTPUT)
    args = parser.parse_args()

    notes_dir = Path(args.notes_dir).expanduser().resolve()
    request_packet = None
    if args.approval_request_packet:
        request_path = Path(args.approval_request_packet).expanduser().resolve()
        if not request_path.exists():
            raise SystemExit(f"approval request packet not found: {request_path}")
        request_packet = load_json(request_path)
    summary = build_summary(notes_dir, parse_required(args.required_decisions), request_packet)
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
