#!/usr/bin/env python3
"""Build a redacted report of operator approvals blocking open-files progress.

This report is intentionally read-only. It combines the extraction approval
dashboard, adversarial packet verification, and ready todo queue so the next
human decisions are explicit without leaking private corpus identifiers.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
import time
from pathlib import Path
from typing import Any


DEFAULT_DASHBOARD = ".codewith/private-artifacts/extraction-approval-dashboard.json"
DEFAULT_ADVERSARIAL_VERIFICATION = ".codewith/private-artifacts/adversarial-review/adversarial-review-verification.json"
DEFAULT_APPROVAL_REQUEST_PACKET = ".codewith/private-artifacts/operator-approvals/approval-request-packet.json"
DEFAULT_APPROVAL_REQUEST_VERIFICATION = ".codewith/private-artifacts/operator-approvals/approval-request-packet-verification.json"
DEFAULT_STAGE_VERIFICATION = ".codewith/private-artifacts/stage-dependency-verification.json"
DEFAULT_REPLACEMENT_VERIFICATION = ".codewith/private-artifacts/replacement-readiness-verification.json"
DEFAULT_EXTRACTION_READINESS_VERIFICATION = ".codewith/private-artifacts/extraction-lane-readiness-verification.json"
DEFAULT_OUTPUT = ".codewith/private-artifacts/operator-approval-blocker-report.json"

MEDIA_TAGS = {"audio", "video", "transcription"}

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

APPROVAL_TODO_TITLES = {
    "ocr_vision_canary": "Run approved OCR/vision lane canary and collect review jobs",
    "large_file_canary": "Run approved balanced non-audio large-file canary and collect review jobs",
    "archive_worker_image": "Build and smoke archive extraction worker image with Docker access",
    "search_index_population": "Run approved search-index population canary and verify CLI search coverage",
    "llm_review_campaign": "Run approved sanitized LLM review canary and collect rename proposals",
}

STAGE_READINESS_SUMMARY_KEYS = (
    "search_index_canary_stage_status",
    "search_index_full_stage_status",
    "search_index_runtime_attestation_status",
    "search_index_scale_readiness_status",
    "search_index_search_probe_status",
    "search_index_remaining_jobs",
    "llm_rename_canary_stage_status",
    "llm_rename_full_stage_status",
    "llm_rename_campaign_status",
    "llm_rename_canary_verified",
    "llm_rename_full_run_verified",
    "llm_rename_scale_readiness_status",
    "llm_rename_gate_status",
    "llm_rename_runtime_attestation_gate_status",
    "llm_rename_remaining_jobs",
    "metadata_apply_stage_status",
    "metadata_apply_ready",
)


def now_utc() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


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


def load_json(path: Path | None) -> Any:
    if path is None or not path.exists():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def load_ready_todos(path: Path | None, project: str) -> list[dict[str, Any]]:
    if path:
        value = load_json(path)
        if not isinstance(value, list):
            raise SystemExit(f"expected ready todo JSON array: {path}")
        return [item for item in value if isinstance(item, dict)]

    proc = subprocess.run(
        ["todos", "--project", project, "ready", "--json"],
        check=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    value = json.loads(proc.stdout)
    if not isinstance(value, list):
        raise SystemExit("todos ready --json did not return a JSON array")
    return [item for item in value if isinstance(item, dict)]


def scan_text(text: str) -> dict[str, int]:
    counts: dict[str, int] = {}
    for code, pattern in SENSITIVE_PATTERNS:
        count = len(pattern.findall(text))
        if count:
            counts[code] = count
    return counts


def sanitize_text(value: Any, max_len: int = 220) -> str:
    text = str(value or "")
    for _code, pattern in SENSITIVE_PATTERNS:
        text = pattern.sub("[redacted]", text)
    text = " ".join(text.split())
    return text[:max_len]


def safe_tags(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    tags: list[str] = []
    for item in value:
        tag = sanitize_text(item, max_len=64)
        if tag:
            tags.append(tag)
    return sorted(set(tags))


def todo_summary(todo: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": sanitize_text(str(todo.get("id") or "")[:8], max_len=16),
        "priority": sanitize_text(todo.get("priority"), max_len=32),
        "title": sanitize_text(todo.get("title")),
        "requires_approval": bool(todo.get("requires_approval")),
        "tags": safe_tags(todo.get("tags")),
    }


def safe_approval_note(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict):
        return {"present": False, "valid": False, "approved": False, "status": None}
    errors = value.get("errors") if isinstance(value.get("errors"), list) else []
    return {
        "summary_present": value.get("summary_present") is True,
        "present": value.get("present") is True,
        "valid": value.get("valid") is True,
        "approved": value.get("approved") is True,
        "status": sanitize_text(value.get("status"), max_len=32),
        "scope": sanitize_text(value.get("scope"), max_len=48),
        "approved_at": sanitize_text(value.get("approved_at"), max_len=64),
        "expires_at": sanitize_text(value.get("expires_at"), max_len=64),
        "approved_by_present": value.get("approved_by_present") is True,
        "approval_note_present": value.get("approval_note_present") is True,
        "approval_note_sha256": sanitize_text(value.get("approval_note_sha256"), max_len=80),
        "artifact_sha256": sanitize_text(value.get("artifact_sha256"), max_len=80),
        "errors": [sanitize_text(item, max_len=96) for item in errors],
    }


def queue_summary(ready_todos: list[dict[str, Any]]) -> dict[str, Any]:
    approval: list[dict[str, Any]] = []
    media: list[dict[str, Any]] = []
    nonapproval_nonmedia: list[dict[str, Any]] = []

    for todo in ready_todos:
        tags = set(safe_tags(todo.get("tags")))
        summary = todo_summary(todo)
        if tags & MEDIA_TAGS:
            media.append(summary)
        elif todo.get("requires_approval"):
            approval.append(summary)
        else:
            nonapproval_nonmedia.append(summary)

    return {
        "ready_total": len(ready_todos),
        "ready_approval_tasks": len(approval),
        "ready_media_tasks": len(media),
        "ready_nonapproval_nonmedia_tasks": len(nonapproval_nonmedia),
        "approval_tasks": approval,
        "media_tasks": media,
        "nonapproval_nonmedia_tasks": nonapproval_nonmedia,
    }


def dashboard_decisions(dashboard: dict[str, Any] | None, ready_todos: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if not isinstance(dashboard, dict):
        return []
    ready_by_title = {
        sanitize_text(todo.get("title")): todo_summary(todo)
        for todo in ready_todos
        if isinstance(todo, dict)
    }
    items = dashboard.get("approval_items") if isinstance(dashboard.get("approval_items"), list) else []
    decisions: list[dict[str, Any]] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        item_id = sanitize_text(item.get("id"), max_len=80)
        if item_id == "deferred_media_final_pass":
            continue
        title = APPROVAL_TODO_TITLES.get(item_id)
        matching_todo = ready_by_title.get(title) if title else None
        decisions.append({
            "id": item_id,
            "priority": sanitize_text(item.get("priority"), max_len=32),
            "status": sanitize_text(item.get("status"), max_len=96),
            "ready_for_approval": item.get("ready_for_approval") is True,
            "approval_note": safe_approval_note(item.get("approval_note")),
            "reason": sanitize_text(item.get("reason")),
            "matching_ready_todo": matching_todo,
        })
    return decisions


def drive_approval_tasks(queue: dict[str, Any]) -> list[dict[str, Any]]:
    tasks = queue.get("approval_tasks") if isinstance(queue.get("approval_tasks"), list) else []
    selected: list[dict[str, Any]] = []
    for task in tasks:
        tags = set(task.get("tags") or [])
        if {"google-drive", "acl", "owners", "duplicates", "unassigned"} & tags:
            selected.append(task)
    return selected


def verifier_summary(value: dict[str, Any] | None, *, approved_key: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        return {"present": False, "status": None, "ok": False}
    errors = value.get("errors") if isinstance(value.get("errors"), list) else []
    warnings = value.get("warnings") if isinstance(value.get("warnings"), list) else []
    summary = value.get("summary") if isinstance(value.get("summary"), dict) else {}
    gates = value.get("gates") if isinstance(value.get("gates"), dict) else {}
    return {
        "present": True,
        "kind": sanitize_text(value.get("kind"), max_len=96),
        "status": sanitize_text(value.get("status"), max_len=96),
        "ok": value.get("status") == "ok" and not errors,
        "gate_status": sanitize_text(value.get("gate_status"), max_len=96),
        approved_key: value.get(approved_key),
        "summary": summary,
        "critical_gates": {
            key: gates.get(key)
            for key in (
                "redaction_ok",
                "source_artifacts_present",
                "source_artifact_hashes_ok",
                "source_artifact_current_hashes_ok",
                "stage_order_complete_set",
                "scale_rules_ok",
                "requirements_complete_set",
                "summary_consistent",
                "status_consistent",
                "approval_consistent",
            )
            if key in gates
        },
        "errors": [sanitize_text(item, max_len=96) for item in errors],
        "warnings": [sanitize_text(item, max_len=96) for item in warnings],
    }


def stage_readiness_summary(stage_verification_summary: dict[str, Any]) -> dict[str, Any]:
    summary = stage_verification_summary.get("summary")
    if not isinstance(summary, dict):
        return {}
    return {key: summary.get(key) for key in STAGE_READINESS_SUMMARY_KEYS if key in summary}


def approval_request_verification_summary(value: dict[str, Any] | None) -> dict[str, Any]:
    if not isinstance(value, dict):
        return {"present": False, "status": None, "ok": False}
    errors = value.get("errors") if isinstance(value.get("errors"), list) else []
    warnings = value.get("warnings") if isinstance(value.get("warnings"), list) else []
    gates = value.get("gates") if isinstance(value.get("gates"), dict) else {}
    source_status = value.get("source_status") if isinstance(value.get("source_status"), dict) else {}
    return {
        "present": True,
        "kind": sanitize_text(value.get("kind"), max_len=96),
        "status": sanitize_text(value.get("status"), max_len=96),
        "ok": value.get("status") == "ok" and not errors,
        "packet_status": sanitize_text(value.get("packet_status"), max_len=96),
        "template_count": value.get("template_count"),
        "decision_count": len(value.get("decision_ids")) if isinstance(value.get("decision_ids"), list) else None,
        "source_status": {
            "dashboard_status": sanitize_text(source_status.get("dashboard_status"), max_len=96),
            "approval_notes_status": sanitize_text(source_status.get("approval_notes_status"), max_len=96),
            "approved_required_decision_count": source_status.get("approved_required_decision_count"),
            "remediation_status": sanitize_text(source_status.get("remediation_status"), max_len=96),
            "remediation_action_count": source_status.get("remediation_action_count"),
        },
        "critical_gates": {
            key: gates.get(key)
            for key in (
                "kind_ok",
                "status_templates_ready",
                "redaction_ok",
                "non_mutation_attested",
                "source_status_ok",
                "source_artifacts_present",
                "source_artifact_hashes_ok",
                "source_artifact_current_hashes_ok",
                "required_decisions_present",
                "template_count_consistent",
                "template_hashes_valid",
                "template_files_present",
                "command_hashes_valid",
                "remediation_links_valid",
            )
            if key in gates
        },
        "errors": [sanitize_text(item, max_len=96) for item in errors],
        "warnings": [sanitize_text(item, max_len=96) for item in warnings],
    }


def extraction_readiness_verification_summary(value: dict[str, Any] | None) -> dict[str, Any]:
    if not isinstance(value, dict):
        return {"present": False, "status": None, "ok": False}
    errors = value.get("errors") if isinstance(value.get("errors"), list) else []
    warnings = value.get("warnings") if isinstance(value.get("warnings"), list) else []
    checks = value.get("checks") if isinstance(value.get("checks"), dict) else {}
    source_artifacts = value.get("source_artifacts") if isinstance(value.get("source_artifacts"), dict) else {}
    return {
        "present": True,
        "kind": sanitize_text(value.get("kind"), max_len=96),
        "status": sanitize_text(value.get("status"), max_len=96),
        "ok": value.get("status") == "ok" and not errors,
        "gate_status": sanitize_text(value.get("gate_status"), max_len=96),
        "summary": value.get("summary") if isinstance(value.get("summary"), dict) else {},
        "critical_checks": {
            key: checks.get(key)
            for key in (
                "kind_ok",
                "status_valid",
                "expected_lanes_present",
                "status_counts_consistent",
                "totals_consistent",
                "gate_flags_consistent",
                "redaction_ok",
                "source_artifacts_present",
                "source_artifacts_current",
                "semantic_projection_current",
            )
            if key in checks
        },
        "source_artifacts": {
            "expected_sources": source_artifacts.get("expected_sources"),
            "present_sources": source_artifacts.get("present_sources"),
            "current_checked": source_artifacts.get("current_checked") is True,
            "current_checked_count": len(source_artifacts.get("current_checked_labels"))
            if isinstance(source_artifacts.get("current_checked_labels"), list)
            else None,
            "current_mismatched_count": len(source_artifacts.get("current_mismatched"))
            if isinstance(source_artifacts.get("current_mismatched"), list)
            else None,
            "current_missing_paths_count": len(source_artifacts.get("current_missing_paths"))
            if isinstance(source_artifacts.get("current_missing_paths"), list)
            else None,
        },
        "errors": [sanitize_text(item, max_len=96) for item in errors],
        "warnings": [sanitize_text(item, max_len=96) for item in warnings],
    }


def extraction_readiness_verification_ok(summary: dict[str, Any]) -> bool:
    checks = summary.get("critical_checks") if isinstance(summary.get("critical_checks"), dict) else {}
    return (
        summary.get("ok") is True
        and summary.get("status") == "ok"
        and not summary.get("errors")
        and checks.get("redaction_ok") is True
        and checks.get("source_artifacts_present") is True
        and checks.get("source_artifacts_current") is True
        and checks.get("semantic_projection_current") is True
        and checks.get("expected_lanes_present") is True
        and checks.get("totals_consistent") is True
        and checks.get("gate_flags_consistent") is True
    )


def build_report(
    dashboard: dict[str, Any] | None,
    adversarial_verification: dict[str, Any] | None,
    approval_request_packet: dict[str, Any] | None,
    approval_request_verification: dict[str, Any] | None,
    stage_verification: dict[str, Any] | None,
    replacement_verification: dict[str, Any] | None,
    ready_todos: list[dict[str, Any]],
    extraction_readiness_verification: dict[str, Any] | None = None,
    sources: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    queue = queue_summary(ready_todos)
    decisions = dashboard_decisions(dashboard, ready_todos)
    dashboard_overall = dashboard.get("overall") if isinstance(dashboard, dict) and isinstance(dashboard.get("overall"), dict) else {}
    adversarial_gates = (
        adversarial_verification.get("gates")
        if isinstance(adversarial_verification, dict) and isinstance(adversarial_verification.get("gates"), dict)
        else {}
    )
    dashboard_ready = dashboard_overall.get("ready_for_operator_review") is True
    adversarial_ok = isinstance(adversarial_verification, dict) and adversarial_verification.get("status") == "ok"
    approval_request_summary = approval_request_verification_summary(approval_request_verification)
    approval_request_verification_ok = approval_request_summary.get("ok") is True
    stage_summary = verifier_summary(stage_verification, approved_key="approved_to_scale")
    stage_readiness = stage_readiness_summary(stage_summary)
    replacement_summary = verifier_summary(replacement_verification, approved_key="approved_to_replace_google_drive")
    extraction_readiness_summary = extraction_readiness_verification_summary(extraction_readiness_verification)
    extraction_readiness_ok = extraction_readiness_verification_ok(extraction_readiness_summary)
    final_gate_verifiers_ok = stage_summary.get("ok") is True and replacement_summary.get("ok") is True and extraction_readiness_ok
    template_items = approval_request_packet.get("templates") if isinstance(approval_request_packet, dict) and isinstance(approval_request_packet.get("templates"), list) else []
    approval_templates_ready = isinstance(approval_request_packet, dict) and approval_request_packet.get("status") == "templates_ready"
    nonmedia_nonapproval_ready = int(queue["ready_nonapproval_nonmedia_tasks"])

    if nonmedia_nonapproval_ready:
        status = "nonapproval_work_ready"
    elif dashboard_ready and adversarial_ok and approval_templates_ready and approval_request_verification_ok and final_gate_verifiers_ok and queue["ready_approval_tasks"]:
        status = "operator_approval_required"
    elif not dashboard_ready or not adversarial_ok or not approval_templates_ready or not approval_request_verification_ok or not final_gate_verifiers_ok:
        status = "needs_prep"
    else:
        status = "no_ready_work"

    report = {
        "kind": "open_files_operator_approval_blocker_report",
        "version": 1,
        "created_at": now_utc(),
        "status": status,
        "redaction": "aggregate-only; todo titles and tags are sanitized; no private filenames, file IDs, object keys, source refs, extracted text, transcripts, ACL payloads, row payloads, command logs, or secrets",
        "non_mutation_attestation": {
            "corpus_bytes_mutated": False,
            "s3_objects_mutated": False,
            "metadata_rows_mutated": False,
            "report_is_read_only": True,
        },
        "source_artifacts": sources or [],
        "dashboard": {
            "present": isinstance(dashboard, dict),
            "status": sanitize_text(dashboard.get("status") if isinstance(dashboard, dict) else None, max_len=96),
            "ready_for_operator_review": dashboard_ready,
            "ready_approval_items": dashboard_overall.get("ready_approval_items"),
            "approval_items": dashboard_overall.get("approval_items"),
            "approved_approval_notes": dashboard_overall.get("approved_approval_notes"),
            "approval_notes_complete": dashboard_overall.get("approval_notes_complete") is True,
            "pending_approval_note_items": [
                sanitize_text(item, max_len=96)
                for item in dashboard_overall.get("pending_approval_note_items", [])
            ] if isinstance(dashboard_overall.get("pending_approval_note_items"), list) else [],
            "blocked_or_missing_prep_items": [
                sanitize_text(item, max_len=96)
                for item in dashboard_overall.get("blocked_or_missing_prep_items", [])
            ] if isinstance(dashboard_overall.get("blocked_or_missing_prep_items"), list) else [],
            "final_media_pass_deferred": dashboard_overall.get("final_media_pass_deferred") is True,
        },
        "adversarial_packet_verification": {
            "present": isinstance(adversarial_verification, dict),
            "status": sanitize_text(adversarial_verification.get("status") if isinstance(adversarial_verification, dict) else None, max_len=96),
            "gates_ok": all(value is True for value in adversarial_gates.values()) if adversarial_gates else False,
            "errors": [
                sanitize_text(item, max_len=96)
                for item in adversarial_verification.get("errors", [])
            ] if isinstance(adversarial_verification, dict) and isinstance(adversarial_verification.get("errors"), list) else [],
            "warnings": [
                sanitize_text(item, max_len=96)
                for item in adversarial_verification.get("warnings", [])
            ] if isinstance(adversarial_verification, dict) and isinstance(adversarial_verification.get("warnings"), list) else [],
        },
        "extraction_readiness_verification": extraction_readiness_summary,
        "stage_dependency_verification": stage_summary,
        "replacement_readiness_verification": replacement_summary,
        "approval_request_verification": approval_request_summary,
        "approval_request_packet": {
            "present": isinstance(approval_request_packet, dict),
            "status": sanitize_text(approval_request_packet.get("status") if isinstance(approval_request_packet, dict) else None, max_len=96),
            "template_count": approval_request_packet.get("template_count") if isinstance(approval_request_packet, dict) else None,
            "template_decisions": [
                sanitize_text(item.get("decision_id"), max_len=96)
                for item in template_items
                if isinstance(item, dict)
            ],
            "redaction_check_passed": ((approval_request_packet.get("redaction_check") or {}).get("passed") is True)
            if isinstance(approval_request_packet, dict) and isinstance(approval_request_packet.get("redaction_check"), dict)
            else False,
            "non_mutation_attested": all((approval_request_packet.get("non_mutation_attestation") or {}).get(key) is expected for key, expected in {
                "templates_only": True,
                "approvals_granted": False,
                "execution_launched": False,
                "corpus_bytes_mutated": False,
                "s3_objects_mutated": False,
                "metadata_rows_mutated": False,
            }.items()) if isinstance(approval_request_packet, dict) and isinstance(approval_request_packet.get("non_mutation_attestation"), dict) else False,
        },
        "queue": queue,
        "operator_decision_groups": {
            "extraction_index_and_llm": decisions,
            "drive_acl_and_organization": drive_approval_tasks(queue),
            "media_final_pass": queue.get("media_tasks", []),
        },
        "safe_next_step": {
            "type": "operator_approval" if status == "operator_approval_required" else status,
            "final_gate_verifiers_ok": final_gate_verifiers_ok,
            "extraction_readiness_verification_ok": extraction_readiness_ok,
            "extraction_readiness_gate_status": extraction_readiness_summary.get("gate_status"),
            "extraction_readiness_source_current": dict(extraction_readiness_summary.get("critical_checks") or {}).get("source_artifacts_current"),
            "extraction_readiness_semantic_current": dict(extraction_readiness_summary.get("critical_checks") or {}).get("semantic_projection_current"),
            "stage_gate_status": stage_summary.get("gate_status"),
            "stage_readiness": stage_readiness,
            "replacement_gate_status": replacement_summary.get("gate_status"),
            "ready_dashboard_decisions": sum(1 for item in decisions if item.get("ready_for_approval") is True),
            "approved_dashboard_decisions": sum(1 for item in decisions if item.get("approval_note", {}).get("approved") is True),
            "approval_templates_ready": approval_templates_ready,
            "approval_request_packet_status": sanitize_text(approval_request_packet.get("status") if isinstance(approval_request_packet, dict) else None, max_len=96),
            "approval_request_verification_ok": approval_request_verification_ok,
            "ready_drive_approval_tasks": len(drive_approval_tasks(queue)),
            "ready_nonapproval_nonmedia_tasks": nonmedia_nonapproval_ready,
            "media_deferred_until_final_pass": bool(queue.get("media_tasks")) or dashboard_overall.get("final_media_pass_deferred") is True,
        },
    }
    marker_counts = scan_text(json.dumps(report, sort_keys=True))
    report["redaction_check"] = {
        "sensitive_marker_counts": marker_counts,
        "passed": not marker_counts,
    }
    if marker_counts:
        report["status"] = "redaction_failed"
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description="Build a redacted open-files operator approval blocker report.")
    parser.add_argument("--dashboard", default=DEFAULT_DASHBOARD)
    parser.add_argument("--adversarial-verification", default=DEFAULT_ADVERSARIAL_VERIFICATION)
    parser.add_argument("--approval-request-packet", default=DEFAULT_APPROVAL_REQUEST_PACKET)
    parser.add_argument("--approval-request-verification", default=DEFAULT_APPROVAL_REQUEST_VERIFICATION)
    parser.add_argument("--stage-verification", default=DEFAULT_STAGE_VERIFICATION)
    parser.add_argument("--replacement-verification", default=DEFAULT_REPLACEMENT_VERIFICATION)
    parser.add_argument("--extraction-readiness-verification", default=DEFAULT_EXTRACTION_READINESS_VERIFICATION)
    parser.add_argument("--ready-todos", help="Optional todos ready --json fixture/input path")
    parser.add_argument("--project", default=str(Path.cwd()))
    parser.add_argument("--output", default=DEFAULT_OUTPUT)
    args = parser.parse_args()

    dashboard_path = Path(args.dashboard).expanduser().resolve()
    adversarial_path = Path(args.adversarial_verification).expanduser().resolve()
    approval_request_path = Path(args.approval_request_packet).expanduser().resolve()
    approval_request_verification_path = Path(args.approval_request_verification).expanduser().resolve()
    stage_verification_path = Path(args.stage_verification).expanduser().resolve()
    replacement_verification_path = Path(args.replacement_verification).expanduser().resolve()
    extraction_readiness_verification_path = Path(args.extraction_readiness_verification).expanduser().resolve()
    ready_todos_path = Path(args.ready_todos).expanduser().resolve() if args.ready_todos else None
    dashboard = load_json(dashboard_path)
    adversarial = load_json(adversarial_path)
    approval_request = load_json(approval_request_path)
    approval_request_verification = load_json(approval_request_verification_path)
    stage_verification = load_json(stage_verification_path)
    replacement_verification = load_json(replacement_verification_path)
    extraction_readiness_verification = load_json(extraction_readiness_verification_path)
    ready_todos = load_ready_todos(ready_todos_path, args.project)
    sources = [
        source_entry("extraction_approval_dashboard", dashboard_path),
        source_entry("adversarial_packet_verification", adversarial_path),
        source_entry("approval_request_packet", approval_request_path),
        source_entry("approval_request_packet_verification", approval_request_verification_path),
        source_entry("stage_dependency_verification", stage_verification_path),
        source_entry("replacement_readiness_verification", replacement_verification_path),
        source_entry("extraction_readiness_verification", extraction_readiness_verification_path),
    ]
    if ready_todos_path is not None:
        sources.append(source_entry("ready_todos_fixture", ready_todos_path))
    else:
        sources.append({
            "label": "ready_todos_live_command",
            "present": True,
            "bytes": None,
            "sha256": None,
            "command": "todos ready --json",
        })
    report = build_report(
        dashboard,
        adversarial,
        approval_request,
        approval_request_verification,
        stage_verification,
        replacement_verification,
        ready_todos,
        extraction_readiness_verification=extraction_readiness_verification,
        sources=sources,
    )

    output = Path(args.output).expanduser().resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps({
        "kind": report["kind"],
        "status": report["status"],
        "dashboard": report["dashboard"],
        "safe_next_step": report["safe_next_step"],
        "redaction_check": report["redaction_check"],
    }, indent=2, sort_keys=True))
    return 0 if report["redaction_check"]["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
