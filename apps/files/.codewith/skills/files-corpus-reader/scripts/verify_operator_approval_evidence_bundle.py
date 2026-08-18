#!/usr/bin/env python3
"""Verify the full aggregate operator-approval evidence bundle."""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import time
from pathlib import Path
from types import ModuleType
from typing import Any, Callable


DEFAULT_OUTPUT = ".codewith/private-artifacts/operator-approval-evidence-bundle-verification.json"

SCRIPT_DIR = Path(__file__).resolve().parent
SKILLS_DIR = SCRIPT_DIR.parents[1]
SEMANTIC_RENAMER_SCRIPT_DIR = SKILLS_DIR / "files-semantic-renamer" / "scripts"

MODULE_PATHS = {
    "dashboard": SCRIPT_DIR / "verify_extraction_approval_dashboard.py",
    "approval_request": SCRIPT_DIR / "verify_operator_approval_request_packet.py",
    "approval_intake": SCRIPT_DIR / "verify_operator_approval_intake.py",
    "post_approval_plan": SCRIPT_DIR / "verify_post_approval_canary_command_plan.py",
    "post_approval_run": SCRIPT_DIR / "verify_post_approval_canary_command_run.py",
    "extraction_readiness": SCRIPT_DIR / "verify_extraction_lane_readiness_gate.py",
    "drive_queue": SCRIPT_DIR / "verify_drive_approval_queue.py",
    "drive_approval_notes": SCRIPT_DIR / "verify_drive_approval_notes.py",
    "stage": SCRIPT_DIR / "verify_stage_dependency_gate.py",
    "replacement": SCRIPT_DIR / "verify_replacement_readiness_gate.py",
    "blocker": SCRIPT_DIR / "verify_operator_approval_blocker_report.py",
    "adversarial_packet": SEMANTIC_RENAMER_SCRIPT_DIR / "verify_adversarial_review_packet.py",
    "adversarial_results": SEMANTIC_RENAMER_SCRIPT_DIR / "verify_adversarial_review_results.py",
}

SCAN_ARTIFACT_PATHS = {
    "dashboard": ".codewith/private-artifacts/extraction-approval-dashboard.json",
    "dashboard_verification": ".codewith/private-artifacts/extraction-approval-dashboard-verification.json",
    "extraction_readiness_verification": ".codewith/private-artifacts/extraction-lane-readiness-verification.json",
    "approval_intake_readiness": ".codewith/private-artifacts/operator-approvals/approval-intake-readiness.json",
    "post_approval_canary_command_plan": ".codewith/private-artifacts/operator-approvals/post-approval-canary-command-plan.json",
    "post_approval_canary_command_plan_verification": ".codewith/private-artifacts/operator-approvals/post-approval-canary-command-plan-verification.json",
    "post_approval_canary_command_run_summary": ".codewith/private-artifacts/operator-approvals/post-approval-canary-command-run-summary.json",
    "post_approval_canary_command_run_verification": ".codewith/private-artifacts/operator-approvals/post-approval-canary-command-run-verification.json",
    "drive_approval_queue": ".codewith/private-artifacts/drive-approval/drive-approval-queue.json",
    "drive_approval_queue_verification": ".codewith/private-artifacts/drive-approval/drive-approval-queue-verification.json",
    "drive_approval_request_packet": ".codewith/private-artifacts/drive-approval/drive-approval-request-packet.json",
    "drive_approval_notes_summary": ".codewith/private-artifacts/drive-approval/drive-approval-notes-summary.json",
    "drive_approval_notes_verification": ".codewith/private-artifacts/drive-approval/drive-approval-notes-verification.json",
    "approval_request_packet": ".codewith/private-artifacts/operator-approvals/approval-request-packet.json",
    "approval_request_verification": ".codewith/private-artifacts/operator-approvals/approval-request-packet-verification.json",
    "stage_gate": ".codewith/private-artifacts/stage-dependency-gate.json",
    "stage_verification": ".codewith/private-artifacts/stage-dependency-verification.json",
    "replacement_gate": ".codewith/private-artifacts/replacement-readiness-gate.json",
    "replacement_verification": ".codewith/private-artifacts/replacement-readiness-verification.json",
    "adversarial_packet": ".codewith/private-artifacts/adversarial-review/adversarial-review-packet.json",
    "adversarial_packet_verification": ".codewith/private-artifacts/adversarial-review/adversarial-review-verification.json",
    "adversarial_results_verification": ".codewith/private-artifacts/adversarial-review/adversarial-review-results-verification.json",
    "reviewer_a_result": ".codewith/private-artifacts/adversarial-review/reviewer-a-current-result.json",
    "reviewer_b_result": ".codewith/private-artifacts/adversarial-review/reviewer-b-current-result.json",
    "reviewer_a_prompt": ".codewith/private-artifacts/adversarial-review/reviewer-a-prompt.md",
    "reviewer_b_prompt": ".codewith/private-artifacts/adversarial-review/reviewer-b-prompt.md",
    "reviewer_a_direct_prompt": ".codewith/private-artifacts/adversarial-review/reviewer-a-direct-prompt.md",
    "reviewer_b_direct_prompt": ".codewith/private-artifacts/adversarial-review/reviewer-b-direct-prompt.md",
    "blocker_report": ".codewith/private-artifacts/operator-approval-blocker-report.json",
    "blocker_report_verification": ".codewith/private-artifacts/operator-approval-blocker-report-verification.json",
}

ALLOWED_REPLACEMENT_WARNINGS = {
    "cyclic_source_artifact_stale:adversarial_review_results",
    "cyclic_source_artifact_stale:operator_approval_blocker_report",
}

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


def load_module(name: str, path: Path) -> ModuleType:
    spec = importlib.util.spec_from_file_location(f"operator_approval_bundle_{name}", path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"failed_to_load_module:{name}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def load_modules() -> dict[str, ModuleType]:
    return {name: load_module(name, path) for name, path in MODULE_PATHS.items()}


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def artifact_summary(label: str, path: Path) -> dict[str, Any]:
    if not path.exists():
        return {"label": label, "present": False}
    return {
        "label": label,
        "present": True,
        "bytes": path.stat().st_size,
        "sha256": file_sha256(path),
    }


def load_json(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError(f"expected_json_object:{path}")
    return value


def dict_value(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def list_value(value: Any) -> list[Any]:
    return value if isinstance(value, list) else []


def add_error(errors: list[str], code: str, detail: str | None = None) -> None:
    errors.append(f"{code}:{detail}" if detail else code)


def status_ok(result: dict[str, Any]) -> bool:
    return result.get("status") == "ok"


def stage_readiness_projection(summary: dict[str, Any]) -> dict[str, Any]:
    return {
        key: summary.get(key)
        for key in STAGE_READINESS_REQUIRED_KEYS
        if key in summary
    }


def run_guarded(name: str, func: Callable[[], dict[str, Any]]) -> dict[str, Any]:
    try:
        return func()
    except Exception as exc:  # pragma: no cover - defensive CLI boundary
        return {
            "kind": f"open_files_{name}_verification_exception",
            "status": "exception",
            "errors": [f"{type(exc).__name__}:{exc}"],
            "warnings": [],
        }


def combined_sensitive_patterns(modules: dict[str, ModuleType]) -> list[tuple[str, Any]]:
    seen: set[tuple[str, str]] = set()
    patterns: list[tuple[str, Any]] = []
    for module in modules.values():
        for code, pattern in getattr(module, "SENSITIVE_PATTERNS", ()):
            key = (str(code), str(getattr(pattern, "pattern", pattern)))
            if key in seen:
                continue
            seen.add(key)
            patterns.append((str(code), pattern))
    return patterns


def scan_text(text: str, patterns: list[tuple[str, Any]]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for code, pattern in patterns:
        count = len(pattern.findall(text))
        if count:
            counts[code] = count
    return counts


def scan_artifacts(paths: dict[str, Path], patterns: list[tuple[str, Any]]) -> dict[str, Any]:
    files: list[dict[str, Any]] = []
    aggregate_counts: dict[str, int] = {}
    for label, path in sorted(paths.items()):
        if not path.exists():
            files.append({"label": label, "present": False, "sensitive_marker_counts": {}})
            continue
        counts = scan_text(path.read_text(encoding="utf-8"), patterns)
        for code, count in counts.items():
            aggregate_counts[code] = aggregate_counts.get(code, 0) + count
        files.append({"label": label, "present": True, "sensitive_marker_counts": counts})
    return {
        "passed": not aggregate_counts,
        "sensitive_marker_counts": aggregate_counts,
        "scanned_files": sum(1 for item in files if item["present"] is True),
        "missing_files": [item["label"] for item in files if item["present"] is False],
        "files_with_hits": [item["label"] for item in files if item["sensitive_marker_counts"]],
        "pattern_count": len(patterns),
    }


def approval_intake_semantic_projection(value: dict[str, Any]) -> dict[str, Any]:
    return {
        "kind": value.get("kind"),
        "version": value.get("version"),
        "status": value.get("status"),
        "summary": value.get("summary"),
        "unlocked_decisions": value.get("unlocked_decisions"),
        "blocked_decisions": value.get("blocked_decisions"),
        "decisions": value.get("decisions"),
        "post_approval_regeneration_steps": value.get("post_approval_regeneration_steps"),
        "source_artifacts": value.get("source_artifacts"),
        "non_mutation_attestation": value.get("non_mutation_attestation"),
        "errors": value.get("errors"),
        "warnings": value.get("warnings"),
        "redaction_check": value.get("redaction_check"),
    }


def verify_approval_intake_current(module: ModuleType, *, current_source_check: bool = True) -> dict[str, Any]:
    errors: list[str] = []
    warnings: list[str] = []
    paths = {
        "approval_notes_summary": Path(module.DEFAULT_APPROVAL_NOTES_SUMMARY).expanduser().resolve(),
        "approval_request_packet": Path(module.DEFAULT_APPROVAL_REQUEST_PACKET).expanduser().resolve(),
        "approval_request_verification": Path(module.DEFAULT_APPROVAL_REQUEST_VERIFICATION).expanduser().resolve(),
        "drive_approval_notes_summary": Path(module.DEFAULT_DRIVE_APPROVAL_NOTES_SUMMARY).expanduser().resolve(),
        "drive_approval_notes_verification": Path(module.DEFAULT_DRIVE_APPROVAL_NOTES_VERIFICATION).expanduser().resolve(),
        "extraction_approval_dashboard": Path(module.DEFAULT_DASHBOARD).expanduser().resolve(),
        "operator_approval_blocker_report": Path(module.DEFAULT_BLOCKER_REPORT).expanduser().resolve(),
    }
    intake_path = Path(module.DEFAULT_OUTPUT).expanduser().resolve()
    intake = load_json(intake_path)

    if intake.get("kind") != "open_files_operator_approval_intake_readiness":
        add_error(errors, "invalid_intake_kind")
    redaction_check = dict_value(intake.get("redaction_check"))
    if redaction_check.get("passed") is not True:
        add_error(errors, "redaction_check_not_passed")
    if redaction_check.get("sensitive_marker_counts"):
        add_error(errors, "redaction_check_counts_nonempty")
    for error in list_value(intake.get("errors")):
        add_error(errors, "intake_error", str(error))

    current_checked_labels: list[str] = []
    current_mismatched = False
    if current_source_check:
        expected = module.build_intake(
            approval_notes_summary=load_json(paths["approval_notes_summary"]),
            approval_request_packet=load_json(paths["approval_request_packet"]),
            approval_request_verification=load_json(paths["approval_request_verification"]),
            drive_approval_notes_summary=load_json(paths["drive_approval_notes_summary"]),
            drive_approval_notes_verification=load_json(paths["drive_approval_notes_verification"]),
            dashboard=load_json(paths["extraction_approval_dashboard"]),
            blocker_report=load_json(paths["operator_approval_blocker_report"]),
            source_artifacts=[module.source_entry(label, path) for label, path in paths.items()],
        )
        current_checked_labels = sorted(paths)
        if approval_intake_semantic_projection(intake) != approval_intake_semantic_projection(expected):
            current_mismatched = True
            add_error(errors, "semantic_projection_mismatch")

    summary = dict_value(intake.get("summary"))
    return {
        "kind": "open_files_operator_approval_intake_readiness_verification",
        "version": 1,
        "created_at": now_utc(),
        "status": "ok" if not errors else "error",
        "intake_status": intake.get("status"),
        "summary": {
            "unlocked_canary_tasks": summary.get("unlocked_canary_tasks"),
            "missing_required_decisions": summary.get("missing_required_decisions"),
            "approval_request_verification_status": summary.get("approval_request_verification_status"),
            "approval_request_stage_readiness_present": summary.get("approval_request_stage_readiness_present"),
            "approval_request_template_stage_readiness_valid": summary.get("approval_request_template_stage_readiness_valid"),
            "approval_request_current_sources_ok": summary.get("approval_request_current_sources_ok"),
            "drive_approval_notes_status": summary.get("drive_approval_notes_status"),
            "drive_approval_notes_verification_status": summary.get("drive_approval_notes_verification_status"),
            "drive_approval_ready": summary.get("drive_approval_ready"),
            "drive_blocked_decisions": summary.get("drive_blocked_decisions"),
        },
        "source_artifacts": {
            "current_checked": current_source_check,
            "current_checked_labels": current_checked_labels,
            "semantic_projection_current": current_source_check and not current_mismatched if current_source_check else None,
        },
        "errors": errors,
        "warnings": warnings,
        "redaction": "aggregate-only approval-intake verification; no approval note text, private filenames, file IDs, object keys, source refs, extracted text, transcripts, row payloads, command logs, or secrets",
    }


def run_subverifiers(
    modules: dict[str, ModuleType],
    *,
    project: str,
    current_source_check: bool = True,
    ready_todos_current_check: bool = True,
) -> dict[str, dict[str, Any]]:
    dashboard = modules["dashboard"]
    approval_request = modules["approval_request"]
    approval_intake = modules["approval_intake"]
    post_approval_plan = modules["post_approval_plan"]
    post_approval_run = modules["post_approval_run"]
    extraction_readiness = modules["extraction_readiness"]
    drive_queue = modules["drive_queue"]
    drive_approval_notes = modules["drive_approval_notes"]
    stage = modules["stage"]
    replacement = modules["replacement"]
    blocker = modules["blocker"]
    adversarial_packet = modules["adversarial_packet"]
    adversarial_results = modules["adversarial_results"]

    dashboard_sources = dashboard.resolved_default_source_paths() if current_source_check else None
    approval_sources = approval_request.resolved_default_source_paths() if current_source_check else None
    stage_sources = stage.resolved_default_source_paths() if current_source_check else None
    replacement_sources = replacement.resolved_default_source_paths() if current_source_check else None
    blocker_sources = blocker.resolved_default_file_source_paths() if current_source_check else None
    adversarial_sources = adversarial_packet.resolved_default_source_paths() if current_source_check else None

    return {
        "dashboard": run_guarded(
            "dashboard",
            lambda: dashboard.verify_dashboard(
                Path(dashboard.DEFAULT_DASHBOARD).expanduser().resolve(),
                source_paths=dashboard_sources,
            ),
        ),
        "approval_request": run_guarded(
            "approval_request",
            lambda: approval_request.verify_packet(
                Path(approval_request.DEFAULT_PACKET).expanduser().resolve(),
                source_paths=approval_sources,
            ),
        ),
        "approval_intake": run_guarded(
            "approval_intake",
            lambda: verify_approval_intake_current(
                approval_intake,
                current_source_check=current_source_check,
            ),
        ),
        "post_approval_plan": run_guarded(
            "post_approval_plan",
            lambda: post_approval_plan.verify_plan(
                Path(post_approval_plan.DEFAULT_PLAN).expanduser().resolve(),
                source_paths=post_approval_plan.default_source_paths() if current_source_check else None,
            ),
        ),
        "post_approval_run": run_guarded(
            "post_approval_run",
            lambda: post_approval_run.verify_run_summary(
                Path(post_approval_run.DEFAULT_RUN_SUMMARY).expanduser().resolve(),
                source_paths=post_approval_run.default_source_paths() if current_source_check else None,
            ),
        ),
        "extraction_readiness": run_guarded(
            "extraction_readiness",
            lambda: extraction_readiness.verify_gate(
                Path(extraction_readiness.DEFAULT_GATE).expanduser().resolve(),
                source_paths=extraction_readiness.default_source_paths() if current_source_check else None,
            ),
        ),
        "drive_queue": run_guarded(
            "drive_queue",
            lambda: drive_queue.verify_queue(
                Path(drive_queue.DEFAULT_QUEUE).expanduser().resolve(),
                check_ready_todos=ready_todos_current_check,
                ready_todos_project=project,
                check_current_docs=current_source_check,
                doc_root=Path(project).expanduser().resolve(),
            ),
        ),
        "drive_approval_notes": run_guarded(
            "drive_approval_notes",
            lambda: drive_approval_notes.verify_artifacts(
                packet_path=Path(drive_approval_notes.DEFAULT_PACKET).expanduser().resolve(),
                summary_path=Path(drive_approval_notes.DEFAULT_NOTES_SUMMARY).expanduser().resolve(),
                packet_source_paths=(
                    {label: Path(path).expanduser().resolve() for label, path in drive_approval_notes.DEFAULT_PACKET_SOURCE_PATHS.items()}
                    if current_source_check
                    else None
                ),
                summary_source_paths=(
                    {label: Path(path).expanduser().resolve() for label, path in drive_approval_notes.DEFAULT_SUMMARY_SOURCE_PATHS.items()}
                    if current_source_check
                    else None
                ),
            ),
        ),
        "stage": run_guarded(
            "stage",
            lambda: stage.verify_gate(
                Path(stage.DEFAULT_GATE).expanduser().resolve(),
                source_paths=stage_sources,
            ),
        ),
        "adversarial_packet": run_guarded(
            "adversarial_packet",
            lambda: adversarial_packet.verify_packet(
                Path(adversarial_packet.DEFAULT_PACKET).expanduser().resolve(),
                min_source_artifacts=20,
                min_ready_approval_items=5,
                source_paths=adversarial_sources,
            ),
        ),
        "adversarial_results": run_guarded(
            "adversarial_results",
            lambda: adversarial_results.build_summary(
                Path(adversarial_results.DEFAULT_DIR, "reviewer-a-current-result.json").expanduser().resolve(),
                Path(adversarial_results.DEFAULT_DIR, "reviewer-b-current-result.json").expanduser().resolve(),
                packet=Path(adversarial_results.DEFAULT_PACKET).expanduser().resolve(),
                schema=Path(adversarial_results.DEFAULT_SCHEMA).expanduser().resolve(),
                reviewer_a_prompt=Path(adversarial_results.DEFAULT_REVIEWER_A_PROMPT).expanduser().resolve(),
                reviewer_b_prompt=Path(adversarial_results.DEFAULT_REVIEWER_B_PROMPT).expanduser().resolve(),
            ),
        ),
        "replacement": run_guarded(
            "replacement",
            lambda: replacement.verify_gate(
                Path(replacement.DEFAULT_GATE).expanduser().resolve(),
                source_paths=replacement_sources,
                allow_cyclic_source_labels=set(replacement.DEFAULT_CYCLIC_SOURCE_LABELS),
            ),
        ),
        "blocker": run_guarded(
            "blocker",
            lambda: blocker.verify_report(
                Path(blocker.DEFAULT_REPORT).expanduser().resolve(),
                source_paths=blocker_sources,
                check_ready_todos=ready_todos_current_check,
                ready_todos_project=project,
            ),
        ),
    }


def summarize_results(
    results: dict[str, dict[str, Any]],
    *,
    redaction_check: dict[str, Any],
    artifacts: list[dict[str, Any]],
    require_operator_approval_required: bool = False,
) -> dict[str, Any]:
    errors: list[str] = []
    warnings: list[str] = []

    for name in (
        "dashboard",
        "approval_request",
        "approval_intake",
        "post_approval_plan",
        "post_approval_run",
        "extraction_readiness",
        "drive_queue",
        "drive_approval_notes",
        "stage",
        "adversarial_packet",
        "replacement",
        "blocker",
    ):
        result = dict_value(results.get(name))
        if not status_ok(result):
            add_error(errors, "component_not_ok", name)
        for error in list_value(result.get("errors")):
            add_error(errors, "component_error", f"{name}:{error}")
        if name != "replacement":
            for warning in list_value(result.get("warnings")):
                warnings.append(f"{name}:{warning}")

    adversarial_result = dict_value(results.get("adversarial_results"))
    if adversarial_result.get("status") not in {"reviewed_with_blockers", "approved_to_scale", "reviewed_not_approved"}:
        add_error(errors, "adversarial_results_not_reviewed", str(adversarial_result.get("status")))
    for error in list_value(adversarial_result.get("errors")):
        add_error(errors, "component_error", f"adversarial_results:{error}")
    for warning in list_value(adversarial_result.get("warnings")):
        warnings.append(f"adversarial_results:{warning}")

    replacement = dict_value(results.get("replacement"))
    replacement_warnings = {str(item) for item in list_value(replacement.get("warnings"))}
    unexpected_replacement_warnings = sorted(replacement_warnings - ALLOWED_REPLACEMENT_WARNINGS)
    for warning in unexpected_replacement_warnings:
        add_error(errors, "unexpected_replacement_warning", warning)

    if redaction_check.get("passed") is not True:
        add_error(errors, "redaction_scan_failed")
    for label in redaction_check.get("missing_files") or []:
        add_error(errors, "scan_artifact_missing", str(label))

    blocker = dict_value(results.get("blocker"))
    blocker_summary = dict_value(blocker.get("summary"))
    approval_intake = dict_value(results.get("approval_intake"))
    approval_intake_summary = dict_value(approval_intake.get("summary"))
    report_status = blocker.get("report_status")
    ready_nonapproval = blocker_summary.get("ready_nonapproval_nonmedia_tasks")
    post_approval_plan_summary = dict_value(dict_value(results.get("post_approval_plan")).get("summary"))
    post_approval_run_summary = dict_value(dict_value(results.get("post_approval_run")).get("summary"))
    post_approval_plan_blocker_ready = post_approval_plan_summary.get("operator_approval_blocker_ready")
    post_approval_run_blocker_ready = post_approval_run_summary.get("operator_approval_blocker_ready")
    post_approval_plan_blocker_status = post_approval_plan_summary.get("operator_approval_blocker_status")
    post_approval_run_blocker_status = post_approval_run_summary.get("operator_approval_blocker_status")
    stage_summary = dict_value(dict_value(results.get("stage")).get("summary"))
    search_index_search_probe_status = stage_summary.get("search_index_search_probe_status")
    search_index_runtime_attestation_status = stage_summary.get("search_index_runtime_attestation_status")
    search_index_scale_readiness_status = stage_summary.get("search_index_scale_readiness_status")
    llm_rename_gate_status = stage_summary.get("llm_rename_gate_status")
    llm_rename_runtime_attestation_gate_status = stage_summary.get("llm_rename_runtime_attestation_gate_status")
    llm_rename_scale_readiness_status = stage_summary.get("llm_rename_scale_readiness_status")
    metadata_apply_ready = stage_summary.get("metadata_apply_ready")
    stage_readiness = stage_readiness_projection(stage_summary)
    post_approval_plan_stage_readiness = stage_readiness_projection(
        dict_value(post_approval_plan_summary.get("operator_approval_blocker_stage_readiness"))
    )
    post_approval_run_stage_readiness = stage_readiness_projection(
        dict_value(post_approval_run_summary.get("operator_approval_blocker_stage_readiness"))
    )
    if require_operator_approval_required and report_status != "operator_approval_required":
        add_error(errors, "operator_approval_required_status_missing", str(report_status))
    if require_operator_approval_required and ready_nonapproval != 0:
        add_error(errors, "nonapproval_nonmedia_ready_tasks_present", str(ready_nonapproval))
    if require_operator_approval_required and post_approval_plan_blocker_ready is not True:
        add_error(errors, "post_approval_plan_blocker_not_ready", str(post_approval_plan_blocker_status))
    if require_operator_approval_required and post_approval_run_blocker_ready is not True:
        add_error(errors, "post_approval_run_blocker_not_ready", str(post_approval_run_blocker_status))
    if require_operator_approval_required and search_index_search_probe_status is None:
        add_error(errors, "search_index_search_probe_status_missing")
    if require_operator_approval_required and search_index_runtime_attestation_status is None:
        add_error(errors, "search_index_runtime_attestation_status_missing")
    if require_operator_approval_required and llm_rename_gate_status is None:
        add_error(errors, "semantic_rename_gate_status_missing")
    if require_operator_approval_required and llm_rename_runtime_attestation_gate_status is None:
        add_error(errors, "semantic_rename_runtime_attestation_status_missing")
    if require_operator_approval_required and llm_rename_scale_readiness_status is None:
        add_error(errors, "semantic_rename_scale_readiness_status_missing")
    if require_operator_approval_required and metadata_apply_ready is None:
        add_error(errors, "metadata_apply_ready_missing")
    if require_operator_approval_required and post_approval_plan_stage_readiness != stage_readiness:
        add_error(errors, "post_approval_plan_stage_readiness_mismatch")
    if require_operator_approval_required and post_approval_run_stage_readiness != stage_readiness:
        add_error(errors, "post_approval_run_stage_readiness_mismatch")
    if (
        require_operator_approval_required
        and approval_intake_summary.get("approval_request_verification_status") != "ok"
    ):
        add_error(
            errors,
            "approval_intake_request_verification_not_ok",
            str(approval_intake_summary.get("approval_request_verification_status")),
        )
    if (
        require_operator_approval_required
        and approval_intake_summary.get("approval_request_stage_readiness_present") is not True
    ):
        add_error(errors, "approval_intake_request_stage_readiness_not_present")
    if (
        require_operator_approval_required
        and approval_intake_summary.get("approval_request_template_stage_readiness_valid") is not True
    ):
        add_error(errors, "approval_intake_request_template_stage_readiness_invalid")
    if (
        require_operator_approval_required
        and approval_intake_summary.get("approval_request_current_sources_ok") is not True
    ):
        add_error(errors, "approval_intake_request_current_sources_not_ok")

    if report_status == "operator_approval_required" and ready_nonapproval == 0:
        bundle_status = "operator_approval_required"
    elif replacement.get("approved_to_replace_google_drive") is True:
        bundle_status = "approved_to_replace_google_drive"
    elif ready_nonapproval not in {None, 0}:
        bundle_status = "nonapproval_work_available"
    else:
        bundle_status = "blocked"

    checks = {
        "dashboard_verifier_ok": status_ok(dict_value(results.get("dashboard"))),
        "approval_request_verifier_ok": status_ok(dict_value(results.get("approval_request"))),
        "approval_intake_verifier_ok": status_ok(approval_intake),
        "approval_intake_request_verification_ok": approval_intake_summary.get("approval_request_verification_status") == "ok",
        "approval_intake_request_stage_readiness_present": approval_intake_summary.get("approval_request_stage_readiness_present") is True,
        "approval_intake_request_template_stage_readiness_valid": approval_intake_summary.get("approval_request_template_stage_readiness_valid") is True,
        "approval_intake_request_current_sources_ok": approval_intake_summary.get("approval_request_current_sources_ok") is True,
        "post_approval_plan_verifier_ok": status_ok(dict_value(results.get("post_approval_plan"))),
        "post_approval_run_verifier_ok": status_ok(dict_value(results.get("post_approval_run"))),
        "extraction_readiness_verifier_ok": status_ok(dict_value(results.get("extraction_readiness"))),
        "drive_queue_verifier_ok": status_ok(dict_value(results.get("drive_queue"))),
        "drive_approval_notes_verifier_ok": status_ok(dict_value(results.get("drive_approval_notes"))),
        "stage_verifier_ok": status_ok(dict_value(results.get("stage"))),
        "adversarial_packet_verifier_ok": status_ok(dict_value(results.get("adversarial_packet"))),
        "adversarial_results_reviewed": adversarial_result.get("status") in {"reviewed_with_blockers", "approved_to_scale", "reviewed_not_approved"},
        "replacement_verifier_ok": status_ok(replacement),
        "replacement_warnings_allowed": not unexpected_replacement_warnings,
        "blocker_report_verifier_ok": status_ok(blocker),
        "redaction_scan_ok": redaction_check.get("passed") is True and not redaction_check.get("missing_files"),
        "operator_approval_required": report_status == "operator_approval_required",
        "no_nonapproval_nonmedia_ready": ready_nonapproval == 0,
        "post_approval_plan_blocker_ready": post_approval_plan_blocker_ready is True,
        "post_approval_run_blocker_ready": post_approval_run_blocker_ready is True,
        "search_index_search_probe_status_reported": search_index_search_probe_status is not None,
        "search_index_runtime_attestation_status_reported": search_index_runtime_attestation_status is not None,
        "semantic_rename_gate_status_reported": llm_rename_gate_status is not None,
        "semantic_rename_runtime_attestation_status_reported": llm_rename_runtime_attestation_gate_status is not None,
        "semantic_rename_scale_readiness_status_reported": llm_rename_scale_readiness_status is not None,
        "metadata_apply_ready_reported": metadata_apply_ready is not None,
        "post_approval_plan_stage_readiness_reported": post_approval_plan_stage_readiness == stage_readiness,
        "post_approval_run_stage_readiness_reported": post_approval_run_stage_readiness == stage_readiness,
    }

    return {
        "kind": "open_files_operator_approval_evidence_bundle_verification",
        "version": 1,
        "created_at": now_utc(),
        "status": "ok" if not errors else "error",
        "bundle_status": bundle_status,
        "checks": checks,
        "summary": {
            "dashboard_status": dict_value(results.get("dashboard")).get("dashboard_status"),
            "approval_request_packet_status": dict_value(results.get("approval_request")).get("packet_status"),
            "approval_intake_status": approval_intake.get("intake_status"),
            "approval_intake_request_verification_status": approval_intake_summary.get("approval_request_verification_status"),
            "approval_intake_request_stage_readiness_present": approval_intake_summary.get("approval_request_stage_readiness_present"),
            "approval_intake_request_template_stage_readiness_valid": approval_intake_summary.get("approval_request_template_stage_readiness_valid"),
            "approval_intake_request_current_sources_ok": approval_intake_summary.get("approval_request_current_sources_ok"),
            "post_approval_plan_status": dict_value(results.get("post_approval_plan")).get("plan_status"),
            "post_approval_run_status": dict_value(results.get("post_approval_run")).get("run_status"),
            "post_approval_execution_allowed": post_approval_run_summary.get("execution_allowed"),
            "post_approval_plan_blocker_status": post_approval_plan_blocker_status,
            "post_approval_plan_blocker_ready": post_approval_plan_blocker_ready,
            "post_approval_run_blocker_status": post_approval_run_blocker_status,
            "post_approval_run_blocker_ready": post_approval_run_blocker_ready,
            "post_approval_plan_stage_readiness": post_approval_plan_stage_readiness,
            "post_approval_run_stage_readiness": post_approval_run_stage_readiness,
            "extraction_readiness_status": dict_value(results.get("extraction_readiness")).get("gate_status"),
            "drive_queue_status": dict_value(results.get("drive_queue")).get("queue_status"),
            "drive_queue_tasks": dict_value(dict_value(results.get("drive_queue")).get("summary")).get("ready_drive_approval_tasks"),
            "drive_approval_notes_status": dict_value(results.get("drive_approval_notes")).get("notes_status"),
            "drive_approval_template_count": dict_value(results.get("drive_approval_notes")).get("template_count"),
            "stage_gate_status": dict_value(results.get("stage")).get("gate_status"),
            "search_index_canary_stage_status": stage_summary.get("search_index_canary_stage_status"),
            "search_index_full_stage_status": stage_summary.get("search_index_full_stage_status"),
            "search_index_runtime_attestation_status": search_index_runtime_attestation_status,
            "search_index_scale_readiness_status": search_index_scale_readiness_status,
            "search_index_search_probe_status": search_index_search_probe_status,
            "search_index_search_probe_probes": stage_summary.get("search_index_search_probe_probes"),
            "search_index_search_probe_latency_budget_ms": stage_summary.get("search_index_search_probe_latency_budget_ms"),
            "search_index_search_probe_max_latency_ms": stage_summary.get("search_index_search_probe_max_latency_ms"),
            "search_index_remaining_jobs": stage_summary.get("search_index_remaining_jobs"),
            "llm_rename_canary_stage_status": stage_summary.get("llm_rename_canary_stage_status"),
            "llm_rename_full_stage_status": stage_summary.get("llm_rename_full_stage_status"),
            "llm_rename_campaign_status": stage_summary.get("llm_rename_campaign_status"),
            "llm_rename_canary_verified": stage_summary.get("llm_rename_canary_verified"),
            "llm_rename_full_run_verified": stage_summary.get("llm_rename_full_run_verified"),
            "llm_rename_scale_readiness_status": llm_rename_scale_readiness_status,
            "llm_rename_gate_status": llm_rename_gate_status,
            "llm_rename_runtime_attestation_gate_status": llm_rename_runtime_attestation_gate_status,
            "llm_rename_remaining_jobs": stage_summary.get("llm_rename_remaining_jobs"),
            "metadata_apply_stage_status": stage_summary.get("metadata_apply_stage_status"),
            "metadata_apply_ready": metadata_apply_ready,
            "adversarial_results_status": adversarial_result.get("status"),
            "adversarial_reviewers_present": dict_value(adversarial_result.get("totals")).get("reviewers_present"),
            "adversarial_blockers": dict_value(adversarial_result.get("totals")).get("blockers"),
            "replacement_gate_status": replacement.get("gate_status"),
            "replacement_warnings": sorted(replacement_warnings),
            "blocker_report_status": report_status,
            "ready_total": blocker_summary.get("ready_total"),
            "ready_approval_tasks": blocker_summary.get("ready_approval_tasks"),
            "ready_drive_approval_tasks": blocker_summary.get("ready_drive_approval_tasks"),
            "ready_media_tasks": blocker_summary.get("ready_media_tasks"),
            "ready_nonapproval_nonmedia_tasks": ready_nonapproval,
            "ready_dashboard_decisions": blocker_summary.get("ready_dashboard_decisions"),
        },
        "artifacts": artifacts,
        "redaction_check": redaction_check,
        "errors": errors,
        "warnings": warnings,
        "redaction": "aggregate-only bundle verification; no private filenames, file IDs, object keys, source refs, extracted text, transcripts, row payloads, command logs, or secrets",
    }


def build_bundle_verification(
    *,
    project: str,
    current_source_check: bool = True,
    ready_todos_current_check: bool = True,
    require_operator_approval_required: bool = False,
) -> dict[str, Any]:
    modules = load_modules()
    results = run_subverifiers(
        modules,
        project=project,
        current_source_check=current_source_check,
        ready_todos_current_check=ready_todos_current_check,
    )
    artifact_paths = {label: Path(path).expanduser().resolve() for label, path in SCAN_ARTIFACT_PATHS.items()}
    artifacts = [artifact_summary(label, path) for label, path in sorted(artifact_paths.items())]
    redaction_check = scan_artifacts(artifact_paths, combined_sensitive_patterns(modules))
    return summarize_results(
        results,
        redaction_check=redaction_check,
        artifacts=artifacts,
        require_operator_approval_required=require_operator_approval_required,
    )


def main() -> int:
    parser = argparse.ArgumentParser(description="Verify the aggregate operator-approval evidence bundle.")
    parser.add_argument("--output", default=DEFAULT_OUTPUT)
    parser.add_argument(
        "--project",
        default=str(Path.cwd()),
        help="Project path to pass to the live todos ready aggregate check.",
    )
    parser.add_argument(
        "--skip-current-source-check",
        action="store_true",
        help="Skip lower-level current source hash recomputation.",
    )
    parser.add_argument(
        "--skip-ready-todos-current-check",
        action="store_true",
        help="Skip live todos ready aggregate recomputation in the blocker verifier.",
    )
    parser.add_argument(
        "--require-operator-approval-required",
        action="store_true",
        help="Fail unless the bundle's final safe next step is operator approval with no non-approval non-media task ready.",
    )
    args = parser.parse_args()

    result = build_bundle_verification(
        project=args.project,
        current_source_check=not args.skip_current_source_check,
        ready_todos_current_check=not args.skip_ready_todos_current_check,
        require_operator_approval_required=args.require_operator_approval_required,
    )
    output = Path(args.output).expanduser().resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps({
        "kind": result["kind"],
        "status": result["status"],
        "bundle_status": result["bundle_status"],
        "summary": result["summary"],
        "errors": result["errors"],
        "warnings": result["warnings"],
    }, indent=2, sort_keys=True))
    return 0 if result["status"] == "ok" else 1


if __name__ == "__main__":
    raise SystemExit(main())
