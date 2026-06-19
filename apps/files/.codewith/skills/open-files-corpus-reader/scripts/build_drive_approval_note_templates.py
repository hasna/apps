#!/usr/bin/env python3
"""Build private Drive approval-note templates and a redacted request packet."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import time
from pathlib import Path
from typing import Any


DEFAULT_QUEUE = ".codewith/private-artifacts/drive-approval/drive-approval-queue.json"
DEFAULT_QUEUE_VERIFICATION = ".codewith/private-artifacts/drive-approval/drive-approval-queue-verification.json"
DEFAULT_NOTES_SUMMARY = ".codewith/private-artifacts/drive-approval/drive-approval-notes-summary.json"
DEFAULT_OUTPUT_DIR = ".codewith/private-artifacts/drive-approval/templates"
DEFAULT_PACKET_OUTPUT = ".codewith/private-artifacts/drive-approval/drive-approval-request-packet.json"

SCOPE_BY_APPROVAL_TYPE = {
    "acl_owner_approval": "acl-owner-approval",
    "duplicate_owner_assignment": "duplicate-owner-assignment",
    "metadata_apply_and_audit": "metadata-apply-audit",
    "backup_rollback_evidence": "backup-rollback-evidence",
    "unassigned_folder_review": "unassigned-folder-review",
    "drive_approval": "drive-approval",
}

ALLOWED_ACTIONS_BY_APPROVAL_TYPE = {
    "acl_owner_approval": [
        "approve the aggregate owner and ACL handling decision for this Drive slice",
        "keep organization changes metadata-only until the separate apply gate is approved",
        "preserve original Google Drive provenance and legacy bucket rollback evidence",
    ],
    "duplicate_owner_assignment": [
        "approve owner assignment and survivor/non-survivor metadata for duplicate groups",
        "preserve duplicate rows and source objects; do not delete or rewrite bytes",
        "require deterministic survivor evidence before any metadata apply step",
    ],
    "metadata_apply_and_audit": [
        "approve the metadata-only Drive policy apply and audit export after prerequisite approvals remain valid",
        "run only reviewed open-files metadata commands; do not rename S3 keys",
        "emit before/after aggregate audit evidence",
    ],
    "backup_rollback_evidence": [
        "approve backup and rollback evidence collection",
        "preserve legacy/import buckets until final retirement approval",
        "do not mutate corpus objects, metadata rows, or permissions",
    ],
    "unassigned_folder_review": [
        "approve ownership and target-path classification for the aggregate unassigned My Drive slice",
        "keep uncertain folders/files marked for human review instead of forcing names",
        "apply only reviewed metadata after the metadata apply gate is separately approved",
    ],
    "drive_approval": [
        "approve only the aggregate Drive organization decision represented by this queue item",
        "preserve immutable S3 object keys and Google Drive provenance",
        "require separate metadata apply approval before writes",
    ],
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


def text_sha256(value: str) -> str:
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


def load_json(path: Path | None) -> dict[str, Any] | None:
    if path is None or not path.exists():
        return None
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise SystemExit(f"expected JSON object: {path}")
    return value


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


def decision_id(entry: dict[str, Any]) -> str:
    return f"drive_{entry.get('task_id_short')}"


def source_doc_hashes(queue: dict[str, Any], expected_docs: list[dict[str, Any]]) -> list[dict[str, Any]]:
    docs_by_path = {
        str(item.get("path")): item
        for item in list_value(queue.get("source_docs"))
        if isinstance(item, dict) and isinstance(item.get("path"), str)
    }
    output: list[dict[str, Any]] = []
    for doc in expected_docs:
        if not isinstance(doc, dict) or not isinstance(doc.get("path"), str):
            continue
        source = docs_by_path.get(doc["path"], {})
        output.append({
            "path": doc["path"],
            "present": doc.get("present") is True and source.get("present") is True,
            "bytes": source.get("bytes"),
            "sha256": source.get("sha256"),
        })
    return output


def queue_entry_context(queue: dict[str, Any], entry: dict[str, Any]) -> dict[str, Any]:
    return {
        "task_id_short": entry.get("task_id_short"),
        "task_id_sha256": entry.get("task_id_sha256"),
        "title": entry.get("title"),
        "title_sha256": entry.get("title_sha256"),
        "priority": entry.get("priority"),
        "root_type": entry.get("root_type"),
        "business_area": entry.get("business_area"),
        "approval_type": entry.get("approval_type"),
        "primary_row_hint": entry.get("primary_row_hint"),
        "count_hints": entry.get("count_hints") if isinstance(entry.get("count_hints"), list) else [],
        "expected_source_docs": entry.get("expected_source_docs") if isinstance(entry.get("expected_source_docs"), list) else [],
        "source_doc_hashes": source_doc_hashes(queue, list_value(entry.get("expected_source_docs"))),
    }


def template_for_entry(
    queue: dict[str, Any],
    entry: dict[str, Any],
    generated_at: str,
    expires_at: str | None,
) -> dict[str, Any]:
    approval_type = str(entry.get("approval_type") or "drive_approval")
    return {
        "kind": "open_files_drive_approval_note",
        "version": 1,
        "template_status": "pending_operator_fill",
        "decision_id": decision_id(entry),
        "status": "approved",
        "scope": SCOPE_BY_APPROVAL_TYPE.get(approval_type, "drive-approval"),
        "approved_by": "<operator-name-or-handle>",
        "approved_at": generated_at,
        "expires_at": expires_at,
        "approval_note": "<replace with private Drive operator approval note>",
        "approval_note_sha256": "<optional; validator computes this from approval_note when omitted>",
        "allowed_actions": ALLOWED_ACTIONS_BY_APPROVAL_TYPE.get(approval_type, ALLOWED_ACTIONS_BY_APPROVAL_TYPE["drive_approval"]),
        "explicitly_not_approved": [
            "canonical S3 object mutation or key rewrite",
            "Google Drive source deletion or permission mutation",
            "duplicate row deletion",
            "unreviewed metadata apply",
            "full replacement approval",
            "private filename, object-key, source-ref, ACL payload, row payload, transcript, or extracted-text disclosure",
        ],
        "queue_entry_context": queue_entry_context(queue, entry),
        "operator_checklist": [
            "review the matching aggregate approval-prep document(s)",
            "confirm the approval scope matches this Drive queue item only",
            "confirm uncertain rows remain human-review-required",
            "save the completed note in the Drive approval directory, not the templates directory",
            "rerun validate_drive_approval_notes.py and verify_drive_approval_notes.py before any metadata apply command",
        ],
        "redaction": "template contains aggregate Drive evidence and hashes only; replace approval_note privately before moving to the Drive approval directory",
    }


def template_file_name(item_id: str) -> str:
    return f"{item_id}.template.json"


def build_templates(
    *,
    queue: dict[str, Any],
    queue_verification: dict[str, Any] | None,
    notes_summary: dict[str, Any] | None,
    output_dir: Path,
    expires_at: str | None,
    sources: list[dict[str, Any]],
) -> dict[str, Any]:
    generated_at = now_utc()
    output_dir.mkdir(parents=True, exist_ok=True)
    queue_entries = [item for item in list_value(queue.get("queue_entries")) if isinstance(item, dict)]
    template_entries: list[dict[str, Any]] = []

    for entry in queue_entries:
        item_id = decision_id(entry)
        template = template_for_entry(queue, entry, generated_at, expires_at)
        template_path = output_dir / template_file_name(item_id)
        template_path.write_text(json.dumps(template, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        template_scan = scan_text(json.dumps(template, sort_keys=True))
        context = dict_value(template.get("queue_entry_context"))
        template_entries.append({
            "decision_id": item_id,
            "task_id_short": entry.get("task_id_short"),
            "task_id_sha256": entry.get("task_id_sha256"),
            "title_sha256": entry.get("title_sha256"),
            "priority": entry.get("priority"),
            "scope": template.get("scope"),
            "root_type": entry.get("root_type"),
            "business_area": entry.get("business_area"),
            "approval_type": entry.get("approval_type"),
            "primary_row_hint": entry.get("primary_row_hint"),
            "source_doc_hashes": context.get("source_doc_hashes"),
            "template_file": template_path.name,
            "template_sha256": text_sha256(template_path.read_text(encoding="utf-8")),
            "ready_for_approval": entry.get("requires_approval") is True,
            "sensitive_marker_counts": template_scan,
        })

    source_summary = dict_value(queue.get("summary"))
    packet = {
        "kind": "open_files_drive_approval_note_template_packet",
        "version": 1,
        "created_at": generated_at,
        "status": "templates_ready" if template_entries else "no_pending_templates",
        "redaction": "aggregate-only Drive approval request packet; approval note text is not included and templates remain private fill-in artifacts",
        "source_status": {
            "queue_status": queue.get("status"),
            "queue_verification_status": queue_verification.get("status") if isinstance(queue_verification, dict) else None,
            "queue_verification_queue_status": queue_verification.get("queue_status") if isinstance(queue_verification, dict) else None,
            "ready_drive_approval_tasks": source_summary.get("ready_drive_approval_tasks"),
            "expected_source_docs_missing": source_summary.get("expected_source_docs_missing"),
            "drive_notes_status": notes_summary.get("status") if isinstance(notes_summary, dict) else None,
            "approved_required_decision_count": notes_summary.get("approved_required_decision_count") if isinstance(notes_summary, dict) else None,
        },
        "source_artifacts": sources,
        "non_mutation_attestation": {
            "templates_only": True,
            "approvals_granted": False,
            "execution_launched": False,
            "corpus_bytes_mutated": False,
            "s3_objects_mutated": False,
            "metadata_rows_mutated": False,
            "search_index_rows_mutated": False,
            "drive_permissions_mutated": False,
        },
        "template_dir": str(output_dir),
        "template_count": len(template_entries),
        "required_decisions": [item["decision_id"] for item in template_entries],
        "templates": template_entries,
    }
    marker_counts = scan_text(json.dumps(packet, sort_keys=True))
    packet["redaction_check"] = {
        "sensitive_marker_counts": marker_counts,
        "passed": not marker_counts and all(not entry["sensitive_marker_counts"] for entry in template_entries),
    }
    if not packet["redaction_check"]["passed"]:
        packet["status"] = "redaction_failed"
    return packet


def main() -> int:
    parser = argparse.ArgumentParser(description="Build private Drive approval-note templates.")
    parser.add_argument("--queue", default=DEFAULT_QUEUE)
    parser.add_argument("--queue-verification", default=DEFAULT_QUEUE_VERIFICATION)
    parser.add_argument("--drive-notes-summary", default=DEFAULT_NOTES_SUMMARY)
    parser.add_argument("--output-dir", default=DEFAULT_OUTPUT_DIR)
    parser.add_argument("--packet-output", default=DEFAULT_PACKET_OUTPUT)
    parser.add_argument("--expires-at", help="Optional ISO timestamp copied into each template")
    args = parser.parse_args()

    queue_path = Path(args.queue).expanduser().resolve()
    queue_verification_path = Path(args.queue_verification).expanduser().resolve()
    notes_summary_path = Path(args.drive_notes_summary).expanduser().resolve()
    queue = load_json(queue_path)
    if queue is None:
        raise SystemExit("Drive approval queue artifact is required")
    queue_verification = load_json(queue_verification_path)
    notes_summary = load_json(notes_summary_path)
    output_dir = Path(args.output_dir).expanduser().resolve()
    packet = build_templates(
        queue=queue,
        queue_verification=queue_verification,
        notes_summary=notes_summary,
        output_dir=output_dir,
        expires_at=args.expires_at,
        sources=[
            source_entry("drive_approval_queue", queue_path),
            source_entry("drive_approval_queue_verification", queue_verification_path),
        ],
    )
    packet_output = Path(args.packet_output).expanduser().resolve()
    packet_output.parent.mkdir(parents=True, exist_ok=True)
    packet_output.write_text(json.dumps(packet, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps({
        "kind": packet["kind"],
        "status": packet["status"],
        "template_count": packet["template_count"],
        "redaction_check": packet["redaction_check"],
    }, indent=2, sort_keys=True))
    return 0 if packet["redaction_check"]["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
