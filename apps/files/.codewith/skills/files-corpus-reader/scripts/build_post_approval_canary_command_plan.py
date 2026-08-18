#!/usr/bin/env python3
"""Build an aggregate post-approval canary command plan without executing it."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import time
from pathlib import Path
from typing import Any


DEFAULT_INTAKE = ".codewith/private-artifacts/operator-approvals/approval-intake-readiness.json"
DEFAULT_DASHBOARD = ".codewith/private-artifacts/extraction-approval-dashboard.json"
DEFAULT_DRIVE_APPROVAL_NOTES_SUMMARY = ".codewith/private-artifacts/drive-approval/drive-approval-notes-summary.json"
DEFAULT_DRIVE_APPROVAL_NOTES_VERIFICATION = ".codewith/private-artifacts/drive-approval/drive-approval-notes-verification.json"
DEFAULT_OPERATOR_APPROVAL_BLOCKER_REPORT = ".codewith/private-artifacts/operator-approval-blocker-report.json"
DEFAULT_OUTPUT = ".codewith/private-artifacts/operator-approvals/post-approval-canary-command-plan.json"

DECISION_SECTION = {
    "ocr_vision_canary": "ocr_vision_canary",
    "large_file_canary": "large_file_canary",
    "archive_worker_image": "archive_worker_image",
    "search_index_population": "search_index_population",
    "llm_review_campaign": "llm_review_campaign",
}

COMMAND_ORDER = {
    "pre_stats": 10,
    "refresh_static_verification": 10,
    "regenerate_approved_plan": 20,
    "approved_build_smoke_and_inventory": 30,
    "execute_canary_after_approval": 30,
    "verify_canary_after_execution": 40,
    "collect_review_manifest_after_verification": 50,
    "post_stats": 60,
    "rerun_readiness_gate_with_worker_inventory": 70,
    "rebuild_adversarial_packet": 80,
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

STAGE_READINESS_REQUIRED_KEYS = (
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


def add_error(errors: list[str], code: str, detail: str | None = None) -> None:
    errors.append(f"{code}:{detail}" if detail else code)


def stage_readiness_snapshot(value: Any) -> dict[str, Any]:
    stage_readiness = dict_value(value)
    return {
        key: stage_readiness.get(key)
        for key in STAGE_READINESS_REQUIRED_KEYS
        if key in stage_readiness
    }


def validate_stage_readiness(stage_readiness: dict[str, Any], errors: list[str]) -> None:
    for key in STAGE_READINESS_REQUIRED_KEYS:
        if key not in stage_readiness:
            errors.append(f"operator_approval_blocker_stage_readiness_missing:{key}")


def classify_command(name: str, command: str) -> str:
    if "--execute" in command:
        if "run_search_index_population_plan.py" in command:
            return "canary_search_index_write"
        return "canary_private_artifact_execution"
    if " search-index stats " in command:
        return "read_only_cli_stats"
    if "verify_" in command or name.startswith("verify_") or name.startswith("refresh_"):
        return "read_only_verification"
    if "build_" in command or "plan_" in command or "collect_" in command:
        return "private_artifact_write"
    return "manual_review_required"


def command_entry(decision_id: str, section_name: str, name: str, command: str) -> dict[str, Any]:
    mutation_class = classify_command(name, command)
    return {
        "decision_id": decision_id,
        "section": section_name,
        "name": name,
        "order": COMMAND_ORDER.get(name, 100),
        "command_ref": f"dashboard.sections.{section_name}.commands.{name}",
        "command_sha256": text_sha256(command),
        "command_bytes": len(command.encode("utf-8")),
        "mutation_class": mutation_class,
        "requires_valid_approval_note": True,
        "requires_valid_drive_approval_notes": True,
        "raw_command_omitted": True,
    }


def unlocked_decisions(intake: dict[str, Any]) -> set[str]:
    values = intake.get("unlocked_decisions")
    if isinstance(values, list):
        return {str(item) for item in values if isinstance(item, str)}
    return set()


def intake_decision_map(intake: dict[str, Any]) -> dict[str, dict[str, Any]]:
    output: dict[str, dict[str, Any]] = {}
    for item in list_value(intake.get("decisions")):
        if isinstance(item, dict) and isinstance(item.get("decision_id"), str):
            output[item["decision_id"]] = item
    return output


def section_commands(dashboard: dict[str, Any], section_name: str) -> dict[str, str]:
    sections = dict_value(dashboard.get("sections"))
    section = dict_value(sections.get(section_name))
    commands = dict_value(section.get("commands"))
    return {
        str(name): command
        for name, command in commands.items()
        if isinstance(name, str) and isinstance(command, str)
    }


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


def blocker_report_gate(report: dict[str, Any], *, unlocked_decision_count: int) -> dict[str, Any]:
    safe_next_step = dict_value(report.get("safe_next_step"))
    stage_readiness = stage_readiness_snapshot(safe_next_step.get("stage_readiness"))
    non_mutation = dict_value(report.get("non_mutation_attestation"))
    redaction_check = dict_value(report.get("redaction_check"))
    errors: list[str] = []
    if report.get("kind") != "open_files_operator_approval_blocker_report":
        errors.append("invalid_operator_approval_blocker_report_kind")
    if report.get("version") != 1:
        errors.append("invalid_operator_approval_blocker_report_version")
    if redaction_check.get("passed") is not True or redaction_check.get("sensitive_marker_counts"):
        errors.append("operator_approval_blocker_report_redaction_failed")
    for key, expected in {
        "corpus_bytes_mutated": False,
        "s3_objects_mutated": False,
        "metadata_rows_mutated": False,
        "report_is_read_only": True,
    }.items():
        if non_mutation.get(key) is not expected:
            errors.append(f"operator_approval_blocker_report_non_mutation_mismatch:{key}")
    validate_stage_readiness(stage_readiness, errors)

    status = report.get("status")
    safe_type = safe_next_step.get("type")
    baseline_ready = (
        not errors
        and safe_next_step.get("final_gate_verifiers_ok") is True
        and safe_next_step.get("approval_request_verification_ok") is True
        and int(safe_next_step.get("ready_nonapproval_nonmedia_tasks") or 0) == 0
    )
    before_approval_ready = status == "operator_approval_required" and safe_type == "operator_approval"
    ready = baseline_ready and (before_approval_ready if unlocked_decision_count == 0 else True)
    if unlocked_decision_count == 0 and not before_approval_ready:
        errors.append("operator_approval_blocker_report_not_at_operator_approval_step")

    return {
        "ready": ready,
        "status": status,
        "safe_next_step_type": safe_type,
        "final_gate_verifiers_ok": safe_next_step.get("final_gate_verifiers_ok") is True,
        "approval_request_verification_ok": safe_next_step.get("approval_request_verification_ok") is True,
        "ready_dashboard_decisions": safe_next_step.get("ready_dashboard_decisions"),
        "approved_dashboard_decisions": safe_next_step.get("approved_dashboard_decisions"),
        "ready_drive_approval_tasks": safe_next_step.get("ready_drive_approval_tasks"),
        "ready_nonapproval_nonmedia_tasks": safe_next_step.get("ready_nonapproval_nonmedia_tasks"),
        "media_deferred_until_final_pass": safe_next_step.get("media_deferred_until_final_pass") is True,
        "stage_readiness": stage_readiness,
        "errors": errors,
    }


def build_plan(
    *,
    intake: dict[str, Any],
    dashboard: dict[str, Any],
    drive_approval_notes_summary: dict[str, Any],
    drive_approval_notes_verification: dict[str, Any],
    operator_approval_blocker_report: dict[str, Any],
    source_artifacts: list[dict[str, Any]],
) -> dict[str, Any]:
    errors: list[str] = []
    warnings: list[str] = []
    if intake.get("kind") != "open_files_operator_approval_intake_readiness":
        add_error(errors, "invalid_intake_kind")
    if intake.get("version") != 1:
        add_error(errors, "invalid_intake_version")
    if dashboard.get("kind") != "open_files_extraction_approval_dashboard":
        add_error(errors, "invalid_dashboard_kind")
    if dashboard.get("version") != 1:
        add_error(errors, "invalid_dashboard_version")
    if drive_approval_notes_summary.get("kind") != "open_files_drive_approval_notes_summary":
        add_error(errors, "invalid_drive_approval_notes_summary_kind")
    if drive_approval_notes_summary.get("version") != 1:
        add_error(errors, "invalid_drive_approval_notes_summary_version")
    if drive_approval_notes_verification.get("kind") != "open_files_drive_approval_notes_verification":
        add_error(errors, "invalid_drive_approval_notes_verification_kind")
    if drive_approval_notes_verification.get("version") != 1:
        add_error(errors, "invalid_drive_approval_notes_verification_version")
    if drive_approval_notes_summary.get("redaction_check", {}).get("passed") is not True:
        add_error(errors, "drive_approval_notes_summary_redaction_failed")
    if drive_approval_notes_verification.get("status") != "ok":
        add_error(errors, "drive_approval_notes_verification_not_ok")
    if drive_approval_notes_verification.get("sensitive_marker_counts", {}).get("summary"):
        add_error(errors, "drive_approval_notes_verification_redaction_failed")
    for entry in source_artifacts:
        if entry.get("present") is not True:
            add_error(errors, "missing_source_artifact", str(entry.get("label")))

    unlocked = unlocked_decisions(intake)
    decision_status = intake_decision_map(intake)
    drive_gate = drive_approval_gate(drive_approval_notes_summary, drive_approval_notes_verification)
    blocker_gate = blocker_report_gate(operator_approval_blocker_report, unlocked_decision_count=len(unlocked))
    for error in list_value(blocker_gate.get("errors")):
        add_error(errors, str(error))
    decisions: list[dict[str, Any]] = []
    command_queue: list[dict[str, Any]] = []
    missing_command_map: list[str] = []
    blocked_decisions: list[str] = []
    drive_blocked_decisions: list[str] = []
    blocker_blocked_decisions: list[str] = []

    for decision_id, section_name in DECISION_SECTION.items():
        intake_item = decision_status.get(decision_id, {})
        commands = section_commands(dashboard, section_name)
        intake_unlocked = decision_id in unlocked
        is_unlocked = intake_unlocked and drive_gate.get("ready") is True and blocker_gate.get("ready") is True
        entries = [
            command_entry(decision_id, section_name, name, command)
            for name, command in sorted(commands.items(), key=lambda item: (COMMAND_ORDER.get(item[0], 100), item[0]))
        ]
        if is_unlocked and not entries:
            missing_command_map.append(decision_id)
            warnings.append(f"unlocked_decision_missing_command_map:{decision_id}")
        if not is_unlocked:
            blocked_decisions.append(decision_id)
            if intake_unlocked and drive_gate.get("ready") is not True:
                drive_blocked_decisions.append(decision_id)
            if intake_unlocked and blocker_gate.get("ready") is not True:
                blocker_blocked_decisions.append(decision_id)
        command_queue.extend(entries if is_unlocked else [])
        decisions.append({
            "decision_id": decision_id,
            "section": section_name,
            "unlock_state": intake_item.get("unlock_state"),
            "approved_for_command_queue": is_unlocked,
            "intake_unlocked": intake_unlocked,
            "drive_approval_gate_ready": drive_gate.get("ready") is True,
            "operator_approval_blocker_gate_ready": blocker_gate.get("ready") is True,
            "command_ready": bool(entries),
            "command_count": len(entries),
            "command_names": [entry["name"] for entry in entries],
        })

    command_queue = sorted(command_queue, key=lambda item: (str(item["decision_id"]), int(item["order"]), str(item["name"])))
    if errors:
        status = "error"
    elif missing_command_map:
        status = "needs_command_mapping"
    elif command_queue:
        status = "ready_for_operator_execution"
    elif drive_blocked_decisions:
        status = "blocked_drive_approval_notes"
    elif blocker_blocked_decisions:
        status = "blocked_operator_approval_blocker_report"
    else:
        status = "blocked_no_unlocked_decisions"

    result = {
        "kind": "open_files_post_approval_canary_command_plan",
        "version": 1,
        "created_at": now_utc(),
        "status": status,
        "summary": {
            "intake_status": intake.get("status"),
            "dashboard_status": dashboard.get("status"),
            "drive_approval_notes_status": drive_gate.get("notes_status"),
            "drive_approval_notes_verification_status": drive_gate.get("verification_status"),
            "drive_approval_ready": drive_gate.get("ready") is True,
            "drive_approval_required_decisions": drive_gate.get("required_decisions"),
            "drive_approval_approved_decisions": drive_gate.get("approved_required_decisions"),
            "drive_approval_missing_decisions": drive_gate.get("missing_required_decisions"),
            "drive_approval_invalid_decisions": drive_gate.get("invalid_required_decisions"),
            "operator_approval_blocker_status": blocker_gate.get("status"),
            "operator_approval_blocker_safe_next_step_type": blocker_gate.get("safe_next_step_type"),
            "operator_approval_blocker_ready": blocker_gate.get("ready") is True,
            "operator_approval_blocker_ready_nonapproval_nonmedia_tasks": blocker_gate.get("ready_nonapproval_nonmedia_tasks"),
            "operator_approval_blocker_stage_readiness": blocker_gate.get("stage_readiness"),
            "unlocked_decisions": len(unlocked),
            "blocked_decisions": len(blocked_decisions),
            "drive_blocked_decisions": len(drive_blocked_decisions),
            "blocker_blocked_decisions": len(blocker_blocked_decisions),
            "command_ready_decisions": sum(1 for item in decisions if item["approved_for_command_queue"] and item["command_ready"]),
            "missing_command_map_decisions": len(missing_command_map),
            "planned_commands": len(command_queue),
        },
        "operator_approval_blocker_snapshot": {
            "status": blocker_gate.get("status"),
            "safe_next_step_type": blocker_gate.get("safe_next_step_type"),
            "ready": blocker_gate.get("ready") is True,
            "final_gate_verifiers_ok": blocker_gate.get("final_gate_verifiers_ok") is True,
            "approval_request_verification_ok": blocker_gate.get("approval_request_verification_ok") is True,
            "ready_dashboard_decisions": blocker_gate.get("ready_dashboard_decisions"),
            "approved_dashboard_decisions": blocker_gate.get("approved_dashboard_decisions"),
            "ready_drive_approval_tasks": blocker_gate.get("ready_drive_approval_tasks"),
            "ready_nonapproval_nonmedia_tasks": blocker_gate.get("ready_nonapproval_nonmedia_tasks"),
            "media_deferred_until_final_pass": blocker_gate.get("media_deferred_until_final_pass") is True,
            "stage_readiness": blocker_gate.get("stage_readiness"),
        },
        "decisions": decisions,
        "command_queue": command_queue,
        "missing_command_map_decisions": missing_command_map,
        "blocked_decisions": blocked_decisions,
        "drive_blocked_decisions": drive_blocked_decisions,
        "blocker_blocked_decisions": blocker_blocked_decisions,
        "source_artifacts": source_artifacts,
        "non_mutation_attestation": {
            "commands_executed": False,
            "approvals_granted": False,
            "corpus_bytes_mutated": False,
            "s3_objects_mutated": False,
            "metadata_rows_mutated": False,
            "search_index_rows_mutated": False,
            "plan_is_read_only": True,
            "raw_commands_omitted": True,
        },
        "errors": errors,
        "warnings": warnings,
        "redaction": "aggregate-only post-approval command plan; raw commands, approval note text, private filenames, file IDs, object keys, source refs, extracted text, transcripts, row payloads, command logs, and secrets are omitted",
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
    parser = argparse.ArgumentParser(description="Build a read-only post-approval canary command plan.")
    parser.add_argument("--intake", default=DEFAULT_INTAKE)
    parser.add_argument("--dashboard", default=DEFAULT_DASHBOARD)
    parser.add_argument("--drive-approval-notes-summary", default=DEFAULT_DRIVE_APPROVAL_NOTES_SUMMARY)
    parser.add_argument("--drive-approval-notes-verification", default=DEFAULT_DRIVE_APPROVAL_NOTES_VERIFICATION)
    parser.add_argument("--operator-approval-blocker-report", default=DEFAULT_OPERATOR_APPROVAL_BLOCKER_REPORT)
    parser.add_argument("--output", default=DEFAULT_OUTPUT)
    args = parser.parse_args()

    paths = {
        "operator_approval_intake": Path(args.intake).expanduser().resolve(),
        "extraction_approval_dashboard": Path(args.dashboard).expanduser().resolve(),
        "drive_approval_notes_summary": Path(args.drive_approval_notes_summary).expanduser().resolve(),
        "drive_approval_notes_verification": Path(args.drive_approval_notes_verification).expanduser().resolve(),
        "operator_approval_blocker_report": Path(args.operator_approval_blocker_report).expanduser().resolve(),
    }
    result = build_plan(
        intake=load_json(paths["operator_approval_intake"]),
        dashboard=load_json(paths["extraction_approval_dashboard"]),
        drive_approval_notes_summary=load_json(paths["drive_approval_notes_summary"]),
        drive_approval_notes_verification=load_json(paths["drive_approval_notes_verification"]),
        operator_approval_blocker_report=load_json(paths["operator_approval_blocker_report"]),
        source_artifacts=[source_entry(label, path) for label, path in paths.items()],
    )
    output = Path(args.output).expanduser().resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps({
        "kind": result["kind"],
        "status": result["status"],
        "summary": result["summary"],
        "errors": result["errors"],
        "warnings": result["warnings"],
        "redaction_check": result["redaction_check"],
    }, indent=2, sort_keys=True))
    return 0 if result["status"] != "error" else 1


if __name__ == "__main__":
    raise SystemExit(main())
