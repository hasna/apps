#!/usr/bin/env python3
"""Verify the aggregate operator approval blocker report."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
import time
from pathlib import Path
from typing import Any


DEFAULT_REPORT = ".codewith/private-artifacts/operator-approval-blocker-report.json"
DEFAULT_OUTPUT = ".codewith/private-artifacts/operator-approval-blocker-report-verification.json"

EXPECTED_FILE_SOURCE_LABELS = {
    "extraction_approval_dashboard",
    "adversarial_packet_verification",
    "approval_request_packet",
    "approval_request_packet_verification",
    "stage_dependency_verification",
    "replacement_readiness_verification",
    "extraction_readiness_verification",
}

DEFAULT_FILE_SOURCE_PATHS = {
    "extraction_approval_dashboard": ".codewith/private-artifacts/extraction-approval-dashboard.json",
    "adversarial_packet_verification": ".codewith/private-artifacts/adversarial-review/adversarial-review-verification.json",
    "approval_request_packet": ".codewith/private-artifacts/operator-approvals/approval-request-packet.json",
    "approval_request_packet_verification": ".codewith/private-artifacts/operator-approvals/approval-request-packet-verification.json",
    "stage_dependency_verification": ".codewith/private-artifacts/stage-dependency-verification.json",
    "replacement_readiness_verification": ".codewith/private-artifacts/replacement-readiness-verification.json",
    "extraction_readiness_verification": ".codewith/private-artifacts/extraction-lane-readiness-verification.json",
}

MEDIA_TAGS = {"audio", "video", "transcription"}
DRIVE_APPROVAL_TAGS = {"google-drive", "acl", "owners", "duplicates", "unassigned"}

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


def scan_text(text: str) -> dict[str, int]:
    counts: dict[str, int] = {}
    for code, pattern in SENSITIVE_PATTERNS:
        count = len(pattern.findall(text))
        if count:
            counts[code] = count
    return counts


def as_int(value: Any) -> int:
    try:
        return int(value or 0)
    except (TypeError, ValueError):
        return 0


def add_error(errors: list[str], code: str, detail: str | None = None) -> None:
    errors.append(f"{code}:{detail}" if detail else code)


def list_value(value: Any) -> list[Any]:
    return value if isinstance(value, list) else []


def dict_value(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def safe_tag_set(value: Any) -> set[str]:
    if not isinstance(value, list):
        return set()
    return {str(item) for item in value if isinstance(item, str)}


def ready_todo_aggregate_counts(ready_todos: list[dict[str, Any]]) -> dict[str, int]:
    approval_tasks = 0
    media_tasks = 0
    nonapproval_nonmedia_tasks = 0
    drive_approval_tasks = 0

    for todo in ready_todos:
        tags = safe_tag_set(todo.get("tags"))
        if tags & MEDIA_TAGS:
            media_tasks += 1
        elif todo.get("requires_approval"):
            approval_tasks += 1
            if tags & DRIVE_APPROVAL_TAGS:
                drive_approval_tasks += 1
        else:
            nonapproval_nonmedia_tasks += 1

    return {
        "ready_total": len(ready_todos),
        "ready_approval_tasks": approval_tasks,
        "ready_media_tasks": media_tasks,
        "ready_nonapproval_nonmedia_tasks": nonapproval_nonmedia_tasks,
        "ready_drive_approval_tasks": drive_approval_tasks,
    }


def load_live_ready_todos(project: str) -> list[dict[str, Any]]:
    try:
        proc = subprocess.run(
            ["todos", "--project", project, "ready", "--json"],
            check=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
    except (FileNotFoundError, subprocess.CalledProcessError) as exc:
        raise RuntimeError("todos_ready_command_failed") from exc

    try:
        value = json.loads(proc.stdout)
    except json.JSONDecodeError as exc:
        raise RuntimeError("todos_ready_command_invalid_json") from exc
    if not isinstance(value, list):
        raise RuntimeError("todos_ready_command_not_array")
    return [item for item in value if isinstance(item, dict)]


def parse_source(value: str) -> tuple[str, Path]:
    if "=" not in value:
        raise argparse.ArgumentTypeError("expected label=path")
    label, path = value.split("=", 1)
    label = label.strip()
    if not label:
        raise argparse.ArgumentTypeError("source label cannot be empty")
    if not path:
        raise argparse.ArgumentTypeError("source path cannot be empty")
    return label, Path(path).expanduser().resolve()


def resolved_default_file_source_paths() -> dict[str, Path]:
    return {label: Path(path).expanduser().resolve() for label, path in DEFAULT_FILE_SOURCE_PATHS.items()}


def expected_status(report: dict[str, Any]) -> str:
    queue = dict_value(report.get("queue"))
    dashboard = dict_value(report.get("dashboard"))
    adversarial = dict_value(report.get("adversarial_packet_verification"))
    approval_request = dict_value(report.get("approval_request_packet"))
    approval_request_verification = dict_value(report.get("approval_request_verification"))
    stage = dict_value(report.get("stage_dependency_verification"))
    replacement = dict_value(report.get("replacement_readiness_verification"))
    extraction_readiness = dict_value(report.get("extraction_readiness_verification"))
    ready_nonapproval = as_int(queue.get("ready_nonapproval_nonmedia_tasks"))
    ready_approval = as_int(queue.get("ready_approval_tasks"))
    dashboard_ready = dashboard.get("ready_for_operator_review") is True
    adversarial_ok = adversarial.get("status") == "ok"
    approval_templates_ready = approval_request.get("status") == "templates_ready"
    approval_request_verification_ok = (
        approval_request_verification.get("ok") is True
        and approval_request_verification.get("status") == "ok"
        and not approval_request_verification.get("errors")
    )
    final_ok = (
        stage.get("ok") is True
        and stage.get("status") == "ok"
        and not stage.get("errors")
        and replacement.get("ok") is True
        and replacement.get("status") == "ok"
        and not replacement.get("errors")
        and extraction_readiness_ok(extraction_readiness)
    )
    if ready_nonapproval:
        return "nonapproval_work_ready"
    if dashboard_ready and adversarial_ok and approval_templates_ready and approval_request_verification_ok and final_ok and ready_approval:
        return "operator_approval_required"
    if not dashboard_ready or not adversarial_ok or not approval_templates_ready or not approval_request_verification_ok or not final_ok:
        return "needs_prep"
    return "no_ready_work"


def extraction_readiness_ok(section: dict[str, Any]) -> bool:
    checks = dict_value(section.get("critical_checks"))
    return (
        section.get("present") is True
        and section.get("ok") is True
        and section.get("status") == "ok"
        and not section.get("errors")
        and checks.get("redaction_ok") is True
        and checks.get("source_artifacts_present") is True
        and checks.get("source_artifacts_current") is True
        and checks.get("semantic_projection_current") is True
        and checks.get("expected_lanes_present") is True
        and checks.get("totals_consistent") is True
        and checks.get("gate_flags_consistent") is True
    )


def stage_readiness_summary(section: dict[str, Any]) -> dict[str, Any]:
    summary = dict_value(section.get("summary"))
    return {key: summary.get(key) for key in STAGE_READINESS_SUMMARY_KEYS if key in summary}


def verify_report(
    report_path: Path,
    *,
    source_paths: dict[str, Path] | None = None,
    ready_todos: list[dict[str, Any]] | None = None,
    check_ready_todos: bool = False,
    ready_todos_project: str | None = None,
) -> dict[str, Any]:
    errors: list[str] = []
    warnings: list[str] = []
    report = load_json(report_path)

    if report.get("kind") != "open_files_operator_approval_blocker_report":
        add_error(errors, "invalid_kind")
    if report.get("version") != 1:
        add_error(errors, "invalid_version")

    marker_counts = scan_text(json.dumps(report, sort_keys=True))
    if marker_counts:
        add_error(errors, "sensitive_marker_hits")
    redaction_check = dict_value(report.get("redaction_check"))
    if redaction_check.get("passed") is not True:
        add_error(errors, "redaction_check_not_passed")
    if redaction_check.get("sensitive_marker_counts"):
        add_error(errors, "redaction_check_counts_nonempty")

    non_mutation = dict_value(report.get("non_mutation_attestation"))
    for key, expected in {
        "corpus_bytes_mutated": False,
        "s3_objects_mutated": False,
        "metadata_rows_mutated": False,
        "report_is_read_only": True,
    }.items():
        if non_mutation.get(key) is not expected:
            add_error(errors, "non_mutation_mismatch", key)

    source_artifacts = list_value(report.get("source_artifacts"))
    labels = {str(item.get("label")) for item in source_artifacts if isinstance(item, dict) and item.get("label")}
    file_sources_by_label: dict[str, dict[str, Any]] = {}
    missing_file_sources = sorted(EXPECTED_FILE_SOURCE_LABELS - labels)
    for label in missing_file_sources:
        add_error(errors, "missing_source_artifact", label)
    if not ({"ready_todos_fixture", "ready_todos_live_command"} & labels):
        add_error(errors, "missing_ready_todos_source")
    for item in source_artifacts:
        if not isinstance(item, dict):
            add_error(errors, "invalid_source_artifact")
            continue
        label = str(item.get("label"))
        if label in EXPECTED_FILE_SOURCE_LABELS:
            file_sources_by_label[label] = item
        if item.get("present") is not True:
            add_error(errors, "source_artifact_not_present", label)
        if label in EXPECTED_FILE_SOURCE_LABELS or label == "ready_todos_fixture":
            if as_int(item.get("bytes")) <= 0:
                add_error(errors, "source_artifact_empty", label)
            sha = item.get("sha256")
            if not isinstance(sha, str) or not re.fullmatch(r"[0-9a-f]{64}", sha):
                add_error(errors, "source_artifact_sha256_invalid", label)
        elif label == "ready_todos_live_command":
            if item.get("command") != "todos ready --json":
                add_error(errors, "ready_todos_live_command_invalid")

    current_checked_labels: list[str] = []
    current_mismatched_labels: list[str] = []
    current_missing_path_labels: list[str] = []
    if source_paths:
        for label, raw_path in sorted(source_paths.items()):
            if label not in EXPECTED_FILE_SOURCE_LABELS:
                add_error(errors, "current_source_unexpected_label", label)
                continue
            current_checked_labels.append(label)
            item = file_sources_by_label.get(label)
            if not item:
                add_error(errors, "current_source_not_recorded", label)
                continue
            path = Path(raw_path).expanduser().resolve()
            if not path.exists():
                current_missing_path_labels.append(label)
                add_error(errors, "source_artifact_current_path_missing", label)
                continue
            expected_bytes = as_int(item.get("bytes"))
            expected_sha = item.get("sha256")
            actual_bytes = path.stat().st_size
            actual_sha = file_sha256(path)
            bytes_match = expected_bytes == actual_bytes
            sha_match = expected_sha == actual_sha
            if bytes_match and sha_match:
                continue
            current_mismatched_labels.append(label)
            if not bytes_match:
                add_error(errors, "source_artifact_current_bytes_mismatch", label)
            if not sha_match:
                add_error(errors, "source_artifact_current_sha256_mismatch", label)

    source_artifact_current_hashes_ok = bool(source_paths) and not any(
        error.startswith("current_source_") or error.startswith("source_artifact_current_")
        for error in errors
    )

    queue = dict_value(report.get("queue"))
    approval_tasks = list_value(queue.get("approval_tasks"))
    media_tasks = list_value(queue.get("media_tasks"))
    nonapproval_tasks = list_value(queue.get("nonapproval_nonmedia_tasks"))
    if as_int(queue.get("ready_total")) != len(approval_tasks) + len(media_tasks) + len(nonapproval_tasks):
        add_error(errors, "queue_ready_total_inconsistent")
    if as_int(queue.get("ready_approval_tasks")) != len(approval_tasks):
        add_error(errors, "queue_approval_count_inconsistent")
    if as_int(queue.get("ready_media_tasks")) != len(media_tasks):
        add_error(errors, "queue_media_count_inconsistent")
    if as_int(queue.get("ready_nonapproval_nonmedia_tasks")) != len(nonapproval_tasks):
        add_error(errors, "queue_nonapproval_count_inconsistent")

    dashboard = dict_value(report.get("dashboard"))
    approval_request = dict_value(report.get("approval_request_packet"))
    approval_request_verification = dict_value(report.get("approval_request_verification"))
    adversarial = dict_value(report.get("adversarial_packet_verification"))
    stage = dict_value(report.get("stage_dependency_verification"))
    replacement = dict_value(report.get("replacement_readiness_verification"))
    extraction_readiness = dict_value(report.get("extraction_readiness_verification"))
    safe_next = dict_value(report.get("safe_next_step"))

    report_ready_counts = {
        "ready_total": as_int(queue.get("ready_total")),
        "ready_approval_tasks": as_int(queue.get("ready_approval_tasks")),
        "ready_media_tasks": as_int(queue.get("ready_media_tasks")),
        "ready_nonapproval_nonmedia_tasks": as_int(queue.get("ready_nonapproval_nonmedia_tasks")),
        "ready_drive_approval_tasks": as_int(safe_next.get("ready_drive_approval_tasks")),
    }
    ready_todos_current_checked = False
    ready_todos_current_counts: dict[str, int] = {}
    ready_todos_current_mismatched: list[str] = []
    ready_todos_current_source: str | None = None
    if check_ready_todos:
        ready_todos_current_checked = True
        if ready_todos is None:
            ready_todos_current_source = "live_command"
            try:
                ready_todos = load_live_ready_todos(ready_todos_project or str(Path.cwd()))
            except RuntimeError as exc:
                add_error(errors, "ready_todos_current_unavailable", str(exc))
                ready_todos = []
        else:
            ready_todos_current_source = "supplied"
        ready_todos_current_counts = ready_todo_aggregate_counts(ready_todos)
        if not any(error.startswith("ready_todos_current_unavailable") for error in errors):
            for key, expected_value in report_ready_counts.items():
                actual_value = ready_todos_current_counts.get(key)
                if actual_value != expected_value:
                    ready_todos_current_mismatched.append(key)
                    add_error(errors, "ready_todos_current_count_mismatch", key)

    decisions = list_value(dict_value(report.get("operator_decision_groups")).get("extraction_index_and_llm"))
    if as_int(safe_next.get("ready_dashboard_decisions")) != sum(1 for item in decisions if isinstance(item, dict) and item.get("ready_for_approval") is True):
        add_error(errors, "safe_next_ready_dashboard_count_inconsistent")
    if as_int(safe_next.get("approved_dashboard_decisions")) != sum(1 for item in decisions if isinstance(item, dict) and dict_value(item.get("approval_note")).get("approved") is True):
        add_error(errors, "safe_next_approved_dashboard_count_inconsistent")
    if as_int(safe_next.get("ready_drive_approval_tasks")) != len(list_value(dict_value(report.get("operator_decision_groups")).get("drive_acl_and_organization"))):
        add_error(errors, "safe_next_drive_count_inconsistent")
    if as_int(safe_next.get("ready_nonapproval_nonmedia_tasks")) != as_int(queue.get("ready_nonapproval_nonmedia_tasks")):
        add_error(errors, "safe_next_nonapproval_count_inconsistent")
    if safe_next.get("approval_templates_ready") is not (approval_request.get("status") == "templates_ready"):
        add_error(errors, "safe_next_approval_templates_inconsistent")
    if safe_next.get("approval_request_packet_status") != approval_request.get("status"):
        add_error(errors, "safe_next_approval_request_packet_status_inconsistent")

    approval_request_verification_ok = (
        approval_request_verification.get("ok") is True
        and approval_request_verification.get("status") == "ok"
        and not approval_request_verification.get("errors")
    )
    if safe_next.get("approval_request_verification_ok") is not approval_request_verification_ok:
        add_error(errors, "safe_next_approval_request_verification_inconsistent")

    stage_ok = stage.get("ok") is True and stage.get("status") == "ok" and not stage.get("errors")
    replacement_ok = replacement.get("ok") is True and replacement.get("status") == "ok" and not replacement.get("errors")
    extraction_ok = extraction_readiness_ok(extraction_readiness)
    if safe_next.get("final_gate_verifiers_ok") is not (stage_ok and replacement_ok and extraction_ok):
        add_error(errors, "safe_next_final_gate_verifiers_inconsistent")
    if safe_next.get("extraction_readiness_verification_ok") is not extraction_ok:
        add_error(errors, "safe_next_extraction_readiness_verification_inconsistent")
    if safe_next.get("extraction_readiness_gate_status") != extraction_readiness.get("gate_status"):
        add_error(errors, "safe_next_extraction_readiness_gate_status_inconsistent")
    extraction_checks = dict_value(extraction_readiness.get("critical_checks"))
    if safe_next.get("extraction_readiness_source_current") is not extraction_checks.get("source_artifacts_current"):
        add_error(errors, "safe_next_extraction_readiness_source_current_inconsistent")
    if safe_next.get("extraction_readiness_semantic_current") is not extraction_checks.get("semantic_projection_current"):
        add_error(errors, "safe_next_extraction_readiness_semantic_current_inconsistent")
    if safe_next.get("stage_gate_status") != stage.get("gate_status"):
        add_error(errors, "safe_next_stage_gate_status_inconsistent")
    expected_stage_readiness = stage_readiness_summary(stage)
    safe_next_stage_readiness = dict_value(safe_next.get("stage_readiness"))
    if safe_next_stage_readiness != expected_stage_readiness:
        add_error(errors, "safe_next_stage_readiness_inconsistent")
    if safe_next.get("replacement_gate_status") != replacement.get("gate_status"):
        add_error(errors, "safe_next_replacement_gate_status_inconsistent")

    for section_name, section, approved_key in (
        ("stage", stage, "approved_to_scale"),
        ("replacement", replacement, "approved_to_replace_google_drive"),
    ):
        critical = dict_value(section.get("critical_gates"))
        if section.get("present") is not True:
            add_error(errors, f"{section_name}_verification_not_present")
        if section.get("ok") is not True:
            add_error(errors, f"{section_name}_verification_not_ok")
        if section.get("status") != "ok":
            add_error(errors, f"{section_name}_verification_status_not_ok")
        if section.get(approved_key) is True and section.get("gate_status") == "blocked":
            add_error(errors, f"{section_name}_approval_true_while_blocked")
        for key, value in critical.items():
            if value is not True:
                add_error(errors, f"{section_name}_critical_gate_not_true", key)

    extraction_critical = dict_value(extraction_readiness.get("critical_checks"))
    if extraction_readiness.get("present") is not True:
        add_error(errors, "extraction_readiness_verification_not_present")
    if extraction_readiness.get("ok") is not True:
        add_error(errors, "extraction_readiness_verification_not_ok")
    if extraction_readiness.get("status") != "ok":
        add_error(errors, "extraction_readiness_verification_status_not_ok")
    for key in (
        "redaction_ok",
        "source_artifacts_present",
        "source_artifacts_current",
        "semantic_projection_current",
        "expected_lanes_present",
        "totals_consistent",
        "gate_flags_consistent",
    ):
        if extraction_critical.get(key) is not True:
            add_error(errors, "extraction_readiness_critical_check_not_true", key)

    approval_request_critical = dict_value(approval_request_verification.get("critical_gates"))
    if approval_request_verification.get("present") is not True:
        add_error(errors, "approval_request_verification_not_present")
    if approval_request_verification.get("ok") is not True:
        add_error(errors, "approval_request_verification_not_ok")
    if approval_request_verification.get("status") != "ok":
        add_error(errors, "approval_request_verification_status_not_ok")
    if approval_request_verification.get("packet_status") != approval_request.get("status"):
        add_error(errors, "approval_request_verification_packet_status_inconsistent")
    if approval_request_verification.get("template_count") != approval_request.get("template_count"):
        add_error(errors, "approval_request_verification_template_count_inconsistent")
    for key, value in approval_request_critical.items():
        if value is not True:
            add_error(errors, "approval_request_verification_critical_gate_not_true", key)

    if dashboard.get("ready_for_operator_review") is True and as_int(dashboard.get("ready_approval_items")) != len(decisions):
        add_error(errors, "dashboard_ready_items_decision_count_inconsistent")
    if approval_request.get("template_count") is not None and as_int(approval_request.get("template_count")) != len(list_value(approval_request.get("template_decisions"))):
        add_error(errors, "approval_request_template_count_inconsistent")
    if approval_request.get("status") == "templates_ready" and approval_request.get("redaction_check_passed") is not True:
        add_error(errors, "approval_request_redaction_not_passed")
    if approval_request.get("status") == "templates_ready" and approval_request.get("non_mutation_attested") is not True:
        add_error(errors, "approval_request_non_mutation_not_attested")
    if adversarial.get("present") is True and adversarial.get("status") != "ok":
        add_error(errors, "adversarial_packet_verification_not_ok")
    if adversarial.get("present") is True and adversarial.get("errors"):
        add_error(errors, "adversarial_packet_verification_errors_present")

    expected = expected_status(report)
    if report.get("status") != expected:
        add_error(errors, "report_status_inconsistent")
    expected_type = "operator_approval" if expected == "operator_approval_required" else expected
    if safe_next.get("type") != expected_type:
        add_error(errors, "safe_next_type_inconsistent")

    gates = {
        "kind_ok": report.get("kind") == "open_files_operator_approval_blocker_report",
        "redaction_ok": not marker_counts and redaction_check.get("passed") is True,
        "non_mutation_attested": not any(error.startswith("non_mutation_mismatch") for error in errors),
        "source_artifacts_present": not any(error.startswith("missing_source_artifact") or error.startswith("source_artifact_not_present") for error in errors),
        "source_artifact_hashes_ok": not any(error.startswith("source_artifact_sha256_invalid") for error in errors),
        "source_artifact_current_hashes_ok": source_artifact_current_hashes_ok if source_paths else None,
        "ready_todos_current_counts_ok": (
            not any(error.startswith("ready_todos_current_") for error in errors)
            if ready_todos_current_checked
            else None
        ),
        "queue_counts_consistent": not any(error.startswith("queue_") for error in errors),
        "safe_next_consistent": not any(error.startswith("safe_next_") for error in errors),
        "stage_readiness_consistent": "safe_next_stage_readiness_inconsistent" not in errors,
        "final_gate_verifiers_ok": stage_ok and replacement_ok and extraction_ok,
        "extraction_readiness_verification_ok": extraction_ok,
        "approval_request_verification_ok": approval_request_verification_ok,
        "status_consistent": "report_status_inconsistent" not in errors,
    }

    return {
        "kind": "open_files_operator_approval_blocker_report_verification",
        "version": 1,
        "created_at": now_utc(),
        "status": "ok" if not errors else "error",
        "report_status": report.get("status"),
        "expected_report_status": expected,
        "safe_next_type": safe_next.get("type"),
        "gates": gates,
        "summary": {
            "ready_total": queue.get("ready_total"),
            "ready_approval_tasks": queue.get("ready_approval_tasks"),
            "ready_media_tasks": queue.get("ready_media_tasks"),
            "ready_nonapproval_nonmedia_tasks": queue.get("ready_nonapproval_nonmedia_tasks"),
            "ready_dashboard_decisions": safe_next.get("ready_dashboard_decisions"),
            "ready_drive_approval_tasks": safe_next.get("ready_drive_approval_tasks"),
            "extraction_readiness_gate_status": safe_next.get("extraction_readiness_gate_status"),
            "extraction_readiness_verification_ok": safe_next.get("extraction_readiness_verification_ok"),
            "extraction_readiness_source_current": safe_next.get("extraction_readiness_source_current"),
            "extraction_readiness_semantic_current": safe_next.get("extraction_readiness_semantic_current"),
            "stage_gate_status": safe_next.get("stage_gate_status"),
            "stage_readiness": safe_next_stage_readiness,
            "replacement_gate_status": safe_next.get("replacement_gate_status"),
            "final_gate_verifiers_ok": safe_next.get("final_gate_verifiers_ok"),
            "approval_request_packet_status": safe_next.get("approval_request_packet_status"),
            "approval_request_verification_ok": safe_next.get("approval_request_verification_ok"),
        },
        "source_artifacts": {
            "expected_file_sources": len(EXPECTED_FILE_SOURCE_LABELS),
            "present_file_sources": len(labels & EXPECTED_FILE_SOURCE_LABELS),
            "ready_todos_source_present": bool({"ready_todos_fixture", "ready_todos_live_command"} & labels),
            "current_checked": bool(source_paths),
            "current_checked_labels": current_checked_labels,
            "current_mismatched": sorted(set(current_mismatched_labels)),
            "current_missing_paths": sorted(set(current_missing_path_labels)),
        },
        "ready_todos_current": {
            "checked": ready_todos_current_checked,
            "source": ready_todos_current_source,
            "expected_counts": report_ready_counts if ready_todos_current_checked else {},
            "current_counts": ready_todos_current_counts if ready_todos_current_checked else {},
            "mismatched": sorted(set(ready_todos_current_mismatched)),
        },
        "sensitive_marker_counts": marker_counts,
        "errors": errors,
        "warnings": warnings,
        "redaction": "aggregate-only verification; no private filenames, file IDs, object keys, source refs, extracted text, transcripts, row payloads, command logs, or secrets",
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Verify operator approval blocker report.")
    parser.add_argument("--report", default=DEFAULT_REPORT)
    parser.add_argument("--output", default=DEFAULT_OUTPUT)
    parser.add_argument(
        "--source",
        action="append",
        default=[],
        type=parse_source,
        metavar="LABEL=PATH",
        help="Override or add a current file source artifact path to recompute.",
    )
    parser.add_argument(
        "--skip-current-source-check",
        action="store_true",
        help="Skip recomputing current file source artifact bytes and hashes.",
    )
    parser.add_argument(
        "--skip-ready-todos-current-check",
        action="store_true",
        help="Skip recomputing live todos ready aggregate counts.",
    )
    parser.add_argument(
        "--project",
        default=str(Path.cwd()),
        help="Project path to pass to the live todos ready aggregate check.",
    )
    args = parser.parse_args()

    source_paths: dict[str, Path] | None = None
    if not args.skip_current_source_check:
        source_paths = resolved_default_file_source_paths()
        for label, path in args.source:
            source_paths[label] = path

    result = verify_report(
        Path(args.report).expanduser().resolve(),
        source_paths=source_paths,
        check_ready_todos=not args.skip_ready_todos_current_check,
        ready_todos_project=args.project,
    )
    output = Path(args.output).expanduser().resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps({
        "kind": result["kind"],
        "status": result["status"],
        "report_status": result["report_status"],
        "expected_report_status": result["expected_report_status"],
        "summary": result["summary"],
        "errors": result["errors"],
        "warnings": result["warnings"],
    }, indent=2, sort_keys=True))
    return 0 if result["status"] == "ok" else 1


if __name__ == "__main__":
    raise SystemExit(main())
