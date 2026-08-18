#!/usr/bin/env python3
"""Verify operator approval intake and canary unlock readiness."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import time
from pathlib import Path
from typing import Any


DEFAULT_APPROVAL_NOTES_SUMMARY = ".codewith/private-artifacts/operator-approvals/approval-notes-summary.json"
DEFAULT_APPROVAL_REQUEST_PACKET = ".codewith/private-artifacts/operator-approvals/approval-request-packet.json"
DEFAULT_APPROVAL_REQUEST_VERIFICATION = ".codewith/private-artifacts/operator-approvals/approval-request-packet-verification.json"
DEFAULT_DRIVE_APPROVAL_NOTES_SUMMARY = ".codewith/private-artifacts/drive-approval/drive-approval-notes-summary.json"
DEFAULT_DRIVE_APPROVAL_NOTES_VERIFICATION = ".codewith/private-artifacts/drive-approval/drive-approval-notes-verification.json"
DEFAULT_DASHBOARD = ".codewith/private-artifacts/extraction-approval-dashboard.json"
DEFAULT_BLOCKER_REPORT = ".codewith/private-artifacts/operator-approval-blocker-report.json"
DEFAULT_OUTPUT = ".codewith/private-artifacts/operator-approvals/approval-intake-readiness.json"

EXPECTED_DECISIONS = [
    "ocr_vision_canary",
    "large_file_canary",
    "archive_worker_image",
    "search_index_population",
    "llm_review_campaign",
]

DECISION_TASK_TAGS = {
    "ocr_vision_canary": {"ocr", "vision"},
    "large_file_canary": {"large-files"},
    "archive_worker_image": {"archives", "worker-image", "docker"},
    "search_index_population": {"search-index"},
    "llm_review_campaign": {"llm-review", "semantic-rename"},
}

POST_APPROVAL_REGENERATION_STEPS = [
    "validate_operator_approval_notes",
    "validate_drive_approval_notes",
    "verify_drive_approval_notes",
    "build_extraction_approval_dashboard",
    "verify_extraction_approval_dashboard",
    "build_operator_approval_note_templates",
    "verify_operator_approval_request_packet",
    "build_stage_dependency_gate",
    "verify_stage_dependency_gate",
    "build_replacement_readiness_gate",
    "build_adversarial_review_packet",
    "verify_adversarial_review_packet",
    "rerun_two_adversarial_reviewers",
    "verify_adversarial_review_results",
    "verify_replacement_readiness_gate",
    "build_operator_approval_blocker_report",
    "verify_operator_approval_blocker_report",
    "verify_operator_approval_evidence_bundle",
]

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


def load_json(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise SystemExit(f"expected JSON object: {path}")
    return value


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def text_sha256(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def source_entry(label: str, path: Path) -> dict[str, Any]:
    return {
        "label": label,
        "present": path.exists(),
        "bytes": path.stat().st_size if path.exists() else 0,
        "sha256": file_sha256(path) if path.exists() else None,
    }


def scan_text(text: str) -> dict[str, int]:
    counts: dict[str, int] = {}
    for code, pattern in SENSITIVE_PATTERNS:
        count = len(pattern.findall(text))
        if count:
            counts[code] = count
    return counts


def dict_value(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def list_value(value: Any) -> list[Any]:
    return value if isinstance(value, list) else []


def safe_str_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return sorted(str(item) for item in value if isinstance(item, str))


def as_int(value: Any, default: int = 0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def add_error(errors: list[str], code: str, detail: str | None = None) -> None:
    errors.append(f"{code}:{detail}" if detail else code)


def by_key(items: list[Any], key: str) -> dict[str, dict[str, Any]]:
    output: dict[str, dict[str, Any]] = {}
    for item in items:
        if isinstance(item, dict) and isinstance(item.get(key), str):
            output[item[key]] = item
    return output


def task_matches_decision(task: dict[str, Any], decision_id: str) -> bool:
    tags = set(safe_str_list(task.get("tags")))
    return bool(tags & DECISION_TASK_TAGS.get(decision_id, set()))


def matching_tasks(blocker_report: dict[str, Any], decision_id: str) -> list[dict[str, Any]]:
    queue = dict_value(blocker_report.get("queue"))
    approval_tasks = [item for item in list_value(queue.get("approval_tasks")) if isinstance(item, dict)]
    matches: list[dict[str, Any]] = []
    for task in approval_tasks:
        if not task_matches_decision(task, decision_id):
            continue
        title = task.get("title") if isinstance(task.get("title"), str) else ""
        matches.append({
            "id": task.get("id") if isinstance(task.get("id"), str) else None,
            "priority": task.get("priority") if isinstance(task.get("priority"), str) else None,
            "requires_approval": task.get("requires_approval") is True,
            "tags": safe_str_list(task.get("tags")),
            "title_sha256": text_sha256(title) if title else None,
        })
    return matches


def unlock_state(note: dict[str, Any] | None, match_count: int) -> str:
    if note is None or note.get("present") is not True:
        return "blocked_missing_approval_note"
    if note.get("valid") is not True:
        return "blocked_invalid_approval_note"
    if note.get("status") == "denied":
        return "blocked_denied"
    if note.get("status") == "deferred":
        return "blocked_deferred"
    if note.get("status") != "approved":
        return "blocked_not_approved"
    if match_count < 1:
        return "approved_missing_ready_task"
    return "approval_note_ready_for_canary_task"


def drive_approval_gate(summary: dict[str, Any], verification: dict[str, Any]) -> dict[str, Any]:
    required_count = int(summary.get("required_decision_count") or 0)
    approved_count = int(summary.get("approved_required_decision_count") or 0)
    missing_count = len(list_value(summary.get("missing_required_decisions")))
    invalid_count = len(list_value(summary.get("invalid_required_decisions")))
    notes_status = summary.get("status")
    verification_status = verification.get("status")
    verification_notes_status = verification.get("notes_status")
    ready = (
        notes_status == "approved"
        and verification_status == "ok"
        and verification_notes_status == notes_status
        and required_count > 0
        and approved_count >= required_count
        and missing_count == 0
        and invalid_count == 0
    )
    return {
        "ready": ready,
        "notes_status": notes_status,
        "verification_status": verification_status,
        "verification_notes_status": verification_notes_status,
        "required_decisions": required_count,
        "approved_required_decisions": approved_count,
        "missing_required_decisions": missing_count,
        "invalid_required_decisions": invalid_count,
    }


def approval_request_verification_gate(
    packet: dict[str, Any],
    verification: dict[str, Any],
    errors: list[str],
) -> dict[str, Any]:
    gates = dict_value(verification.get("gates"))
    source_status = dict_value(verification.get("source_status"))
    packet_source_status = dict_value(packet.get("source_status"))
    verification_source_artifacts = dict_value(verification.get("source_artifacts"))
    packet_templates = list_value(packet.get("templates"))
    packet_decision_ids = [
        str(item.get("decision_id"))
        for item in packet_templates
        if isinstance(item, dict) and isinstance(item.get("decision_id"), str)
    ]
    packet_template_count = as_int(packet.get("template_count"), len(packet_templates))
    stage_readiness = dict_value(verification.get("stage_readiness"))
    packet_stage_readiness = dict_value(packet.get("stage_readiness"))

    if verification.get("kind") != "open_files_operator_approval_request_packet_verification":
        add_error(errors, "invalid_approval_request_verification_kind")
    if verification.get("version") != 1:
        add_error(errors, "invalid_approval_request_verification_version")
    if verification.get("status") != "ok":
        add_error(errors, "approval_request_verification_not_ok")
    if verification.get("packet_status") != packet.get("status"):
        add_error(errors, "approval_request_verification_packet_status_mismatch")
    if as_int(verification.get("template_count"), -1) != packet_template_count:
        add_error(errors, "approval_request_verification_template_count_mismatch")
    if list_value(verification.get("decision_ids")) != packet_decision_ids:
        add_error(errors, "approval_request_verification_decision_ids_mismatch")
    if gates.get("stage_readiness_present") is not True:
        add_error(errors, "approval_request_verification_stage_readiness_missing")
    if gates.get("template_stage_readiness_valid") is not True:
        add_error(errors, "approval_request_verification_template_stage_readiness_invalid")
    if gates.get("source_artifact_current_hashes_ok") is not True:
        add_error(errors, "approval_request_verification_current_sources_not_ok")
    if gates.get("redaction_ok") is not True:
        add_error(errors, "approval_request_verification_redaction_failed")
    if verification.get("sensitive_marker_counts"):
        add_error(errors, "approval_request_verification_sensitive_marker_hits")
    if verification_source_artifacts.get("current_checked") is not True:
        add_error(errors, "approval_request_verification_current_sources_not_checked")
    if verification_source_artifacts.get("current_mismatched"):
        add_error(errors, "approval_request_verification_current_sources_mismatched")
    if source_status.get("stage_verification_status") != "ok":
        add_error(errors, "approval_request_verification_stage_verification_not_ok")
    if source_status.get("stage_gate_status") not in {"blocked", "ready_to_scale"}:
        add_error(errors, "approval_request_verification_stage_gate_invalid")

    for key in (
        "dashboard_status",
        "approval_notes_status",
        "approved_required_decision_count",
        "stage_verification_status",
        "stage_gate_status",
        "remediation_status",
        "remediation_action_count",
    ):
        if source_status.get(key) != packet_source_status.get(key):
            add_error(errors, "approval_request_verification_source_status_mismatch", key)
    if stage_readiness != packet_stage_readiness:
        add_error(errors, "approval_request_verification_stage_readiness_mismatch")

    return {
        "status": verification.get("status"),
        "packet_status": verification.get("packet_status"),
        "template_count": verification.get("template_count"),
        "stage_gate_status": source_status.get("stage_gate_status"),
        "stage_verification_status": source_status.get("stage_verification_status"),
        "stage_readiness_present": gates.get("stage_readiness_present") is True,
        "template_stage_readiness_valid": gates.get("template_stage_readiness_valid") is True,
        "current_sources_ok": gates.get("source_artifact_current_hashes_ok") is True,
    }


def build_decision_status(
    decision_id: str,
    *,
    notes_by_decision: dict[str, dict[str, Any]],
    templates_by_decision: dict[str, dict[str, Any]],
    dashboard_by_decision: dict[str, dict[str, Any]],
    blocker_report: dict[str, Any],
    drive_gate: dict[str, Any],
) -> dict[str, Any]:
    note = notes_by_decision.get(decision_id)
    template = templates_by_decision.get(decision_id)
    dashboard_item = dashboard_by_decision.get(decision_id)
    tasks = matching_tasks(blocker_report, decision_id)
    state = unlock_state(note, len(tasks))
    if state == "approval_note_ready_for_canary_task" and drive_gate.get("ready") is not True:
        state = "blocked_drive_approval_notes"
    note_errors = safe_str_list(note.get("errors")) if isinstance(note, dict) else ["missing_approval_note_artifact"]
    command_hashes = template.get("command_hashes") if isinstance(template, dict) and isinstance(template.get("command_hashes"), list) else []
    remediation_ids = template.get("remediation_action_ids") if isinstance(template, dict) and isinstance(template.get("remediation_action_ids"), list) else []

    return {
        "decision_id": decision_id,
        "unlock_state": state,
        "approval_note": {
            "present": bool(note and note.get("present") is True),
            "valid": bool(note and note.get("valid") is True),
            "status": note.get("status") if isinstance(note, dict) else None,
            "scope": note.get("scope") if isinstance(note, dict) else None,
            "approval_request_checked": note.get("approval_request_checked") if isinstance(note, dict) else None,
            "command_hashes_match": note.get("command_hashes_match") if isinstance(note, dict) else None,
            "artifact_sha256": note.get("artifact_sha256") if isinstance(note, dict) else None,
            "errors": note_errors,
        },
        "approval_request_template": {
            "present": template is not None,
            "scope": template.get("scope") if isinstance(template, dict) else None,
            "remediation_action_ids": safe_str_list(remediation_ids),
            "remediation_status": template.get("remediation_status") if isinstance(template, dict) else None,
            "command_hash_count": len(command_hashes),
            "command_hashes_valid": all(
                isinstance(item, dict)
                and isinstance(item.get("sha256"), str)
                and re.fullmatch(r"[0-9a-f]{64}", item["sha256"])
                for item in command_hashes
            ),
        },
        "dashboard": {
            "present": dashboard_item is not None,
            "ready_for_approval": dashboard_item.get("ready_for_approval") if isinstance(dashboard_item, dict) else None,
            "status": dashboard_item.get("status") if isinstance(dashboard_item, dict) else None,
            "priority": dashboard_item.get("priority") if isinstance(dashboard_item, dict) else None,
        },
        "ready_task": {
            "matched_count": len(tasks),
            "first": tasks[0] if tasks else None,
        },
        "drive_approval_gate": {
            "ready": drive_gate.get("ready") is True,
            "notes_status": drive_gate.get("notes_status"),
            "verification_status": drive_gate.get("verification_status"),
        },
    }


def build_intake(
    *,
    approval_notes_summary: dict[str, Any],
    approval_request_packet: dict[str, Any],
    approval_request_verification: dict[str, Any],
    drive_approval_notes_summary: dict[str, Any],
    drive_approval_notes_verification: dict[str, Any],
    dashboard: dict[str, Any],
    blocker_report: dict[str, Any],
    source_artifacts: list[dict[str, Any]],
    require_all_sources_present: bool = True,
) -> dict[str, Any]:
    errors: list[str] = []
    warnings: list[str] = []

    if approval_notes_summary.get("kind") != "open_files_operator_approval_notes_summary":
        add_error(errors, "invalid_notes_summary_kind")
    if approval_notes_summary.get("version") != 1:
        add_error(errors, "invalid_notes_summary_version")
    if approval_request_packet.get("kind") != "open_files_operator_approval_note_template_packet":
        add_error(errors, "invalid_approval_request_packet_kind")
    if approval_request_packet.get("version") != 1:
        add_error(errors, "invalid_approval_request_packet_version")
    if drive_approval_notes_summary.get("kind") != "open_files_drive_approval_notes_summary":
        add_error(errors, "invalid_drive_approval_notes_summary_kind")
    if drive_approval_notes_summary.get("version") != 1:
        add_error(errors, "invalid_drive_approval_notes_summary_version")
    if drive_approval_notes_verification.get("kind") != "open_files_drive_approval_notes_verification":
        add_error(errors, "invalid_drive_approval_notes_verification_kind")
    if drive_approval_notes_verification.get("version") != 1:
        add_error(errors, "invalid_drive_approval_notes_verification_version")
    if dashboard.get("kind") != "open_files_extraction_approval_dashboard":
        add_error(errors, "invalid_dashboard_kind")
    if dashboard.get("version") != 1:
        add_error(errors, "invalid_dashboard_version")
    if blocker_report.get("kind") != "open_files_operator_approval_blocker_report":
        add_error(errors, "invalid_blocker_report_kind")
    if blocker_report.get("version") != 1:
        add_error(errors, "invalid_blocker_report_version")

    if require_all_sources_present:
        for entry in source_artifacts:
            if entry.get("present") is not True:
                add_error(errors, "missing_source_artifact", str(entry.get("label")))
            if entry.get("present") is True and not re.fullmatch(r"[0-9a-f]{64}", str(entry.get("sha256") or "")):
                add_error(errors, "invalid_source_artifact_sha256", str(entry.get("label")))

    notes_by_decision = by_key(list_value(approval_notes_summary.get("required_decisions")), "decision_id")
    templates_by_decision = by_key(list_value(approval_request_packet.get("templates")), "decision_id")
    dashboard_by_decision = by_key(list_value(dashboard.get("approval_items")), "id")
    drive_gate = drive_approval_gate(drive_approval_notes_summary, drive_approval_notes_verification)
    approval_request_gate = approval_request_verification_gate(
        approval_request_packet,
        approval_request_verification,
        errors,
    )

    missing_template_decisions = sorted(set(EXPECTED_DECISIONS) - set(templates_by_decision))
    for decision_id in missing_template_decisions:
        add_error(errors, "missing_approval_request_template", decision_id)
    missing_dashboard_decisions = sorted(set(EXPECTED_DECISIONS) - set(dashboard_by_decision))
    for decision_id in missing_dashboard_decisions:
        add_error(errors, "missing_dashboard_decision", decision_id)

    decisions = [
        build_decision_status(
            decision_id,
            notes_by_decision=notes_by_decision,
            templates_by_decision=templates_by_decision,
            dashboard_by_decision=dashboard_by_decision,
            blocker_report=blocker_report,
            drive_gate=drive_gate,
        )
        for decision_id in EXPECTED_DECISIONS
    ]

    missing = [item["decision_id"] for item in decisions if item["unlock_state"] == "blocked_missing_approval_note"]
    invalid = [item["decision_id"] for item in decisions if item["unlock_state"] == "blocked_invalid_approval_note"]
    denied = [item["decision_id"] for item in decisions if item["unlock_state"] == "blocked_denied"]
    deferred = [item["decision_id"] for item in decisions if item["unlock_state"] == "blocked_deferred"]
    drive_blocked = [item["decision_id"] for item in decisions if item["unlock_state"] == "blocked_drive_approval_notes"]
    unlocked = [item["decision_id"] for item in decisions if item["unlock_state"] == "approval_note_ready_for_canary_task"]
    approved_missing_task = [item["decision_id"] for item in decisions if item["unlock_state"] == "approved_missing_ready_task"]

    for decision_id in invalid:
        add_error(errors, "invalid_required_approval_note", decision_id)
    for decision_id in approved_missing_task:
        add_error(errors, "approved_decision_missing_ready_task", decision_id)
    if approval_notes_summary.get("redaction_check", {}).get("passed") is not True:
        add_error(errors, "approval_notes_summary_redaction_failed")
    if approval_request_packet.get("redaction_check", {}).get("passed") is not True:
        add_error(errors, "approval_request_packet_redaction_failed")
    if drive_approval_notes_summary.get("redaction_check", {}).get("passed") is not True:
        add_error(errors, "drive_approval_notes_summary_redaction_failed")
    if drive_approval_notes_verification.get("status") != "ok":
        add_error(errors, "drive_approval_notes_verification_not_ok")
    if drive_approval_notes_verification.get("sensitive_marker_counts", {}).get("summary"):
        add_error(errors, "drive_approval_notes_verification_redaction_failed")
    if dashboard.get("redaction_check", {}).get("passed") is not True:
        add_error(errors, "dashboard_redaction_failed")
    if blocker_report.get("redaction_check", {}).get("passed") is not True:
        add_error(errors, "blocker_report_redaction_failed")

    if errors:
        status = "error"
    elif unlocked:
        status = "canary_tasks_unlocked"
    elif drive_blocked:
        status = "drive_approval_required"
    elif invalid:
        status = "invalid"
    elif denied:
        status = "denied"
    elif deferred:
        status = "deferred"
    elif missing:
        status = "missing_required"
    else:
        status = "not_fully_approved"

    result = {
        "kind": "open_files_operator_approval_intake_readiness",
        "version": 1,
        "created_at": now_utc(),
        "status": status,
        "summary": {
            "required_decisions": len(EXPECTED_DECISIONS),
            "approval_notes_status": approval_notes_summary.get("status"),
            "approval_request_packet_status": approval_request_packet.get("status"),
            "approval_request_verification_status": approval_request_gate.get("status"),
            "approval_request_verification_packet_status": approval_request_gate.get("packet_status"),
            "approval_request_verification_stage_gate_status": approval_request_gate.get("stage_gate_status"),
            "approval_request_verification_stage_verification_status": approval_request_gate.get("stage_verification_status"),
            "approval_request_stage_readiness_present": approval_request_gate.get("stage_readiness_present"),
            "approval_request_template_stage_readiness_valid": approval_request_gate.get("template_stage_readiness_valid"),
            "approval_request_current_sources_ok": approval_request_gate.get("current_sources_ok"),
            "drive_approval_notes_status": drive_gate.get("notes_status"),
            "drive_approval_notes_verification_status": drive_gate.get("verification_status"),
            "drive_approval_ready": drive_gate.get("ready") is True,
            "drive_approval_required_decisions": drive_gate.get("required_decisions"),
            "drive_approval_approved_decisions": drive_gate.get("approved_required_decisions"),
            "drive_approval_missing_decisions": drive_gate.get("missing_required_decisions"),
            "drive_approval_invalid_decisions": drive_gate.get("invalid_required_decisions"),
            "dashboard_status": dashboard.get("status"),
            "blocker_report_status": blocker_report.get("status"),
            "missing_required_decisions": len(missing),
            "invalid_required_decisions": len(invalid),
            "denied_decisions": len(denied),
            "deferred_decisions": len(deferred),
            "drive_blocked_decisions": len(drive_blocked),
            "unlocked_canary_tasks": len(unlocked),
            "approved_missing_ready_tasks": len(approved_missing_task),
        },
        "unlocked_decisions": unlocked,
        "blocked_decisions": {
            "missing": missing,
            "invalid": invalid,
            "denied": denied,
            "deferred": deferred,
            "drive_approval_notes": drive_blocked,
            "approved_missing_ready_task": approved_missing_task,
        },
        "decisions": decisions,
        "post_approval_regeneration_steps": POST_APPROVAL_REGENERATION_STEPS if unlocked else [],
        "source_artifacts": source_artifacts,
        "non_mutation_attestation": {
            "approvals_granted": False,
            "execution_launched": False,
            "corpus_bytes_mutated": False,
            "s3_objects_mutated": False,
            "metadata_rows_mutated": False,
            "search_index_rows_mutated": False,
            "intake_is_read_only": True,
        },
        "errors": errors,
        "warnings": warnings,
        "redaction": "aggregate-only approval intake; omits approval note text, private filenames, file IDs, object keys, source refs, extracted text, transcripts, row payloads, command logs, and secrets",
    }
    marker_counts = scan_text(json.dumps(result, sort_keys=True))
    result["redaction_check"] = {
        "passed": not marker_counts,
        "sensitive_marker_counts": marker_counts,
    }
    if marker_counts:
        result["status"] = "error"
        result["errors"].append("sensitive_marker_hits")
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description="Verify operator approval intake and canary unlock readiness.")
    parser.add_argument("--approval-notes-summary", default=DEFAULT_APPROVAL_NOTES_SUMMARY)
    parser.add_argument("--approval-request-packet", default=DEFAULT_APPROVAL_REQUEST_PACKET)
    parser.add_argument("--approval-request-verification", default=DEFAULT_APPROVAL_REQUEST_VERIFICATION)
    parser.add_argument("--drive-approval-notes-summary", default=DEFAULT_DRIVE_APPROVAL_NOTES_SUMMARY)
    parser.add_argument("--drive-approval-notes-verification", default=DEFAULT_DRIVE_APPROVAL_NOTES_VERIFICATION)
    parser.add_argument("--dashboard", default=DEFAULT_DASHBOARD)
    parser.add_argument("--blocker-report", default=DEFAULT_BLOCKER_REPORT)
    parser.add_argument("--output", default=DEFAULT_OUTPUT)
    args = parser.parse_args()

    paths = {
        "approval_notes_summary": Path(args.approval_notes_summary).expanduser().resolve(),
        "approval_request_packet": Path(args.approval_request_packet).expanduser().resolve(),
        "approval_request_verification": Path(args.approval_request_verification).expanduser().resolve(),
        "drive_approval_notes_summary": Path(args.drive_approval_notes_summary).expanduser().resolve(),
        "drive_approval_notes_verification": Path(args.drive_approval_notes_verification).expanduser().resolve(),
        "extraction_approval_dashboard": Path(args.dashboard).expanduser().resolve(),
        "operator_approval_blocker_report": Path(args.blocker_report).expanduser().resolve(),
    }
    source_artifacts = [source_entry(label, path) for label, path in paths.items()]
    result = build_intake(
        approval_notes_summary=load_json(paths["approval_notes_summary"]),
        approval_request_packet=load_json(paths["approval_request_packet"]),
        approval_request_verification=load_json(paths["approval_request_verification"]),
        drive_approval_notes_summary=load_json(paths["drive_approval_notes_summary"]),
        drive_approval_notes_verification=load_json(paths["drive_approval_notes_verification"]),
        dashboard=load_json(paths["extraction_approval_dashboard"]),
        blocker_report=load_json(paths["operator_approval_blocker_report"]),
        source_artifacts=source_artifacts,
    )
    output = Path(args.output).expanduser().resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps({
        "kind": result["kind"],
        "status": result["status"],
        "summary": result["summary"],
        "unlocked_decisions": result["unlocked_decisions"],
        "errors": result["errors"],
        "warnings": result["warnings"],
        "redaction_check": result["redaction_check"],
    }, indent=2, sort_keys=True))
    return 0 if result["status"] != "error" else 1


if __name__ == "__main__":
    raise SystemExit(main())
