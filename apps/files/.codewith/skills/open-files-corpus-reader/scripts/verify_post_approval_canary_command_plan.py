#!/usr/bin/env python3
"""Verify the aggregate post-approval canary command plan."""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import re
import time
from pathlib import Path
from types import ModuleType
from typing import Any


DEFAULT_PLAN = ".codewith/private-artifacts/operator-approvals/post-approval-canary-command-plan.json"
DEFAULT_INTAKE = ".codewith/private-artifacts/operator-approvals/approval-intake-readiness.json"
DEFAULT_DASHBOARD = ".codewith/private-artifacts/extraction-approval-dashboard.json"
DEFAULT_DRIVE_APPROVAL_NOTES_SUMMARY = ".codewith/private-artifacts/drive-approval/drive-approval-notes-summary.json"
DEFAULT_DRIVE_APPROVAL_NOTES_VERIFICATION = ".codewith/private-artifacts/drive-approval/drive-approval-notes-verification.json"
DEFAULT_OPERATOR_APPROVAL_BLOCKER_REPORT = ".codewith/private-artifacts/operator-approval-blocker-report.json"
DEFAULT_OUTPUT = ".codewith/private-artifacts/operator-approvals/post-approval-canary-command-plan-verification.json"

SCRIPT_DIR = Path(__file__).resolve().parent
BUILDER_PATH = SCRIPT_DIR / "build_post_approval_canary_command_plan.py"

EXPECTED_SOURCE_LABELS = {
    "operator_approval_intake",
    "extraction_approval_dashboard",
    "drive_approval_notes_summary",
    "drive_approval_notes_verification",
    "operator_approval_blocker_report",
}

ALLOWED_PLAN_STATUSES = {
    "blocked_no_unlocked_decisions",
    "ready_for_operator_execution",
    "blocked_drive_approval_notes",
    "blocked_operator_approval_blocker_report",
    "needs_command_mapping",
    "error",
}

ALLOWED_MUTATION_CLASSES = {
    "read_only_cli_stats",
    "read_only_verification",
    "private_artifact_write",
    "canary_private_artifact_execution",
    "canary_search_index_write",
    "manual_review_required",
}

EXPECTED_NON_MUTATION = {
    "commands_executed": False,
    "approvals_granted": False,
    "corpus_bytes_mutated": False,
    "s3_objects_mutated": False,
    "metadata_rows_mutated": False,
    "search_index_rows_mutated": False,
    "plan_is_read_only": True,
    "raw_commands_omitted": True,
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


def load_builder() -> ModuleType:
    spec = importlib.util.spec_from_file_location("post_approval_canary_command_plan_builder", BUILDER_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError("failed_to_load_builder")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


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


def missing_stage_readiness_keys(stage_readiness: dict[str, Any]) -> list[str]:
    return [key for key in STAGE_READINESS_REQUIRED_KEYS if key not in stage_readiness]


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


def default_source_paths() -> dict[str, Path]:
    return {
        "operator_approval_intake": Path(DEFAULT_INTAKE).expanduser().resolve(),
        "extraction_approval_dashboard": Path(DEFAULT_DASHBOARD).expanduser().resolve(),
        "drive_approval_notes_summary": Path(DEFAULT_DRIVE_APPROVAL_NOTES_SUMMARY).expanduser().resolve(),
        "drive_approval_notes_verification": Path(DEFAULT_DRIVE_APPROVAL_NOTES_VERIFICATION).expanduser().resolve(),
        "operator_approval_blocker_report": Path(DEFAULT_OPERATOR_APPROVAL_BLOCKER_REPORT).expanduser().resolve(),
    }


def source_by_label(plan: dict[str, Any]) -> dict[str, dict[str, Any]]:
    output: dict[str, dict[str, Any]] = {}
    for item in list_value(plan.get("source_artifacts")):
        if isinstance(item, dict) and isinstance(item.get("label"), str):
            output[item["label"]] = item
    return output


def semantic_projection(plan: dict[str, Any]) -> dict[str, Any]:
    return {
        "status": plan.get("status"),
        "summary": plan.get("summary"),
        "decisions": plan.get("decisions"),
        "operator_approval_blocker_snapshot": plan.get("operator_approval_blocker_snapshot"),
        "command_queue": plan.get("command_queue"),
        "missing_command_map_decisions": plan.get("missing_command_map_decisions"),
        "blocked_decisions": plan.get("blocked_decisions"),
        "blocker_blocked_decisions": plan.get("blocker_blocked_decisions"),
        "non_mutation_attestation": plan.get("non_mutation_attestation"),
        "errors": plan.get("errors"),
        "warnings": plan.get("warnings"),
        "redaction_check": plan.get("redaction_check"),
    }


def expected_plan_from_sources(source_paths: dict[str, Path]) -> dict[str, Any]:
    builder = load_builder()
    return builder.build_plan(
        intake=load_json(source_paths["operator_approval_intake"]),
        dashboard=load_json(source_paths["extraction_approval_dashboard"]),
        drive_approval_notes_summary=load_json(source_paths["drive_approval_notes_summary"]),
        drive_approval_notes_verification=load_json(source_paths["drive_approval_notes_verification"]),
        operator_approval_blocker_report=load_json(source_paths["operator_approval_blocker_report"]),
        source_artifacts=[
            builder.source_entry("operator_approval_intake", source_paths["operator_approval_intake"]),
            builder.source_entry("extraction_approval_dashboard", source_paths["extraction_approval_dashboard"]),
            builder.source_entry("drive_approval_notes_summary", source_paths["drive_approval_notes_summary"]),
            builder.source_entry("drive_approval_notes_verification", source_paths["drive_approval_notes_verification"]),
            builder.source_entry("operator_approval_blocker_report", source_paths["operator_approval_blocker_report"]),
        ],
    )


def verify_plan(
    plan_path: Path,
    *,
    source_paths: dict[str, Path] | None = None,
) -> dict[str, Any]:
    errors: list[str] = []
    warnings: list[str] = []
    plan = load_json(plan_path)

    if plan.get("kind") != "open_files_post_approval_canary_command_plan":
        add_error(errors, "invalid_kind")
    if plan.get("version") != 1:
        add_error(errors, "invalid_version")
    if plan.get("status") not in ALLOWED_PLAN_STATUSES:
        add_error(errors, "invalid_plan_status")

    marker_counts = scan_text(json.dumps(plan, sort_keys=True))
    if marker_counts:
        add_error(errors, "sensitive_marker_hits")
    redaction_check = dict_value(plan.get("redaction_check"))
    if redaction_check.get("passed") is not True:
        add_error(errors, "redaction_check_not_passed")
    if redaction_check.get("sensitive_marker_counts"):
        add_error(errors, "redaction_check_counts_nonempty")

    non_mutation = dict_value(plan.get("non_mutation_attestation"))
    for key, expected in EXPECTED_NON_MUTATION.items():
        if non_mutation.get(key) is not expected:
            add_error(errors, "non_mutation_mismatch", key)

    by_label = source_by_label(plan)
    missing_labels = sorted(EXPECTED_SOURCE_LABELS - set(by_label))
    for label in missing_labels:
        add_error(errors, "missing_source_artifact", label)
    for label, item in by_label.items():
        if label not in EXPECTED_SOURCE_LABELS:
            warnings.append(f"unexpected_source_artifact:{label}")
            continue
        if item.get("present") is not True:
            add_error(errors, "source_artifact_not_present", label)
        if int(item.get("bytes") or 0) <= 0:
            add_error(errors, "source_artifact_empty", label)
        if not isinstance(item.get("sha256"), str) or not re.fullmatch(r"[0-9a-f]{64}", item["sha256"]):
            add_error(errors, "source_artifact_sha256_invalid", label)

    current_checked_labels: list[str] = []
    current_mismatched_labels: list[str] = []
    current_missing_path_labels: list[str] = []
    if source_paths is not None:
        for label in sorted(EXPECTED_SOURCE_LABELS):
            path = source_paths.get(label)
            if path is None or not path.exists():
                current_missing_path_labels.append(label)
                add_error(errors, "source_artifact_current_path_missing", label)
                continue
            current_checked_labels.append(label)
            item = by_label.get(label, {})
            current_bytes = path.stat().st_size
            current_sha = file_sha256(path)
            if item.get("bytes") != current_bytes or item.get("sha256") != current_sha:
                current_mismatched_labels.append(label)
                add_error(errors, "source_artifact_current_sha256_mismatch", label)
        if not current_missing_path_labels:
            try:
                expected = expected_plan_from_sources(source_paths)
                if semantic_projection(plan) != semantic_projection(expected):
                    add_error(errors, "semantic_projection_mismatch")
            except Exception as exc:  # pragma: no cover - defensive CLI boundary
                add_error(errors, "expected_plan_rebuild_failed", f"{type(exc).__name__}:{exc}")

    command_queue = [item for item in list_value(plan.get("command_queue")) if isinstance(item, dict)]
    for index, item in enumerate(command_queue):
        label = f"command_queue[{index}]"
        if item.get("raw_command_omitted") is not True:
            add_error(errors, "raw_command_not_omitted", label)
        if "command" in item or "raw_command" in item:
            add_error(errors, "raw_command_field_present", label)
        if not isinstance(item.get("command_ref"), str) or not item["command_ref"].startswith("dashboard.sections."):
            add_error(errors, "invalid_command_ref", label)
        if not isinstance(item.get("command_sha256"), str) or not re.fullmatch(r"[0-9a-f]{64}", item["command_sha256"]):
            add_error(errors, "invalid_command_sha256", label)
        if int(item.get("command_bytes") or 0) <= 0:
            add_error(errors, "invalid_command_bytes", label)
        if item.get("mutation_class") not in ALLOWED_MUTATION_CLASSES:
            add_error(errors, "invalid_mutation_class", label)
        if item.get("requires_valid_approval_note") is not True:
            add_error(errors, "requires_valid_approval_note_not_true", label)
        if item.get("requires_valid_drive_approval_notes") is not True:
            add_error(errors, "requires_valid_drive_approval_notes_not_true", label)

    summary = dict_value(plan.get("summary"))
    decisions = [item for item in list_value(plan.get("decisions")) if isinstance(item, dict)]
    expected_summary_counts = {
        "unlocked_decisions": sum(1 for item in decisions if item.get("intake_unlocked") is True),
        "blocked_decisions": len(list_value(plan.get("blocked_decisions"))),
        "drive_blocked_decisions": len(list_value(plan.get("drive_blocked_decisions"))),
        "blocker_blocked_decisions": len(list_value(plan.get("blocker_blocked_decisions"))),
        "command_ready_decisions": sum(1 for item in decisions if item.get("approved_for_command_queue") is True and item.get("command_ready") is True),
        "missing_command_map_decisions": len(list_value(plan.get("missing_command_map_decisions"))),
        "planned_commands": len(command_queue),
    }
    for key, expected in expected_summary_counts.items():
        if summary.get(key) != expected:
            add_error(errors, "summary_count_mismatch", key)

    if plan.get("status") == "blocked_no_unlocked_decisions" and summary.get("unlocked_decisions") != 0:
        add_error(errors, "blocked_status_with_unlocked_decisions")
    if plan.get("status") == "ready_for_operator_execution" and len(command_queue) < 1:
        add_error(errors, "ready_status_without_commands")
    if plan.get("status") == "ready_for_operator_execution" and dict_value(plan.get("summary")).get("drive_approval_ready") is not True:
        add_error(errors, "ready_status_without_drive_approval")
    if plan.get("status") == "blocked_drive_approval_notes" and not plan.get("drive_blocked_decisions"):
        add_error(errors, "drive_blocked_status_without_drive_blocked_decisions")
    if plan.get("status") == "blocked_operator_approval_blocker_report" and not plan.get("blocker_blocked_decisions"):
        add_error(errors, "blocker_blocked_status_without_blocker_blocked_decisions")
    if plan.get("status") == "needs_command_mapping" and not plan.get("missing_command_map_decisions"):
        add_error(errors, "needs_command_mapping_without_missing_decisions")

    blocker_snapshot = dict_value(plan.get("operator_approval_blocker_snapshot"))
    blocker_stage_readiness = stage_readiness_snapshot(blocker_snapshot.get("stage_readiness"))
    summary_stage_readiness = stage_readiness_snapshot(summary.get("operator_approval_blocker_stage_readiness"))
    if not blocker_snapshot:
        add_error(errors, "missing_operator_approval_blocker_snapshot")
    elif summary.get("unlocked_decisions") == 0:
        if blocker_snapshot.get("status") != "operator_approval_required":
            add_error(errors, "blocked_plan_without_operator_approval_required_snapshot")
        if blocker_snapshot.get("safe_next_step_type") != "operator_approval":
            add_error(errors, "blocked_plan_without_operator_approval_safe_next_step")
        if blocker_snapshot.get("ready") is not True:
            add_error(errors, "blocked_plan_without_ready_blocker_snapshot")
    for key in missing_stage_readiness_keys(blocker_stage_readiness):
        add_error(errors, "operator_approval_blocker_stage_readiness_missing", key)
    if summary_stage_readiness != blocker_stage_readiness:
        add_error(errors, "operator_approval_blocker_stage_readiness_summary_mismatch")

    gates = {
        "kind_ok": plan.get("kind") == "open_files_post_approval_canary_command_plan",
        "status_valid": plan.get("status") in ALLOWED_PLAN_STATUSES,
        "redaction_ok": redaction_check.get("passed") is True and not redaction_check.get("sensitive_marker_counts") and not marker_counts,
        "non_mutation_attested": all(non_mutation.get(key) is expected for key, expected in EXPECTED_NON_MUTATION.items()),
        "source_artifacts_present": EXPECTED_SOURCE_LABELS <= set(by_label),
        "source_artifacts_current": not current_mismatched_labels and not current_missing_path_labels if source_paths is not None else None,
        "semantic_projection_current": "semantic_projection_mismatch" not in errors,
        "raw_commands_omitted": not any(error.startswith("raw_command") for error in errors),
        "summary_counts_consistent": not any(error.startswith("summary_count_mismatch") for error in errors),
        "operator_approval_blocker_stage_readiness_present": not any(
            error.startswith("operator_approval_blocker_stage_readiness_missing")
            for error in errors
        ),
    }

    return {
        "kind": "open_files_post_approval_canary_command_plan_verification",
        "version": 1,
        "created_at": now_utc(),
        "status": "ok" if not errors else "error",
        "plan_status": plan.get("status"),
        "summary": {
            "unlocked_decisions": summary.get("unlocked_decisions"),
            "blocked_decisions": summary.get("blocked_decisions"),
            "command_ready_decisions": summary.get("command_ready_decisions"),
            "drive_blocked_decisions": summary.get("drive_blocked_decisions"),
            "blocker_blocked_decisions": summary.get("blocker_blocked_decisions"),
            "missing_command_map_decisions": summary.get("missing_command_map_decisions"),
            "planned_commands": summary.get("planned_commands"),
            "operator_approval_blocker_status": summary.get("operator_approval_blocker_status"),
            "operator_approval_blocker_ready": summary.get("operator_approval_blocker_ready"),
            "operator_approval_blocker_stage_readiness": summary_stage_readiness,
        },
        "gates": gates,
        "source_artifacts": {
            "expected_sources": len(EXPECTED_SOURCE_LABELS),
            "present_sources": len(EXPECTED_SOURCE_LABELS & set(by_label)),
            "current_checked": source_paths is not None,
            "current_checked_labels": current_checked_labels,
            "current_mismatched": current_mismatched_labels,
            "current_missing_paths": current_missing_path_labels,
        },
        "sensitive_marker_counts": marker_counts,
        "errors": errors,
        "warnings": warnings,
        "redaction": "aggregate-only command-plan verification; no raw commands, approval note text, private filenames, file IDs, object keys, source refs, extracted text, transcripts, row payloads, command logs, or secrets",
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Verify the aggregate post-approval canary command plan.")
    parser.add_argument("--plan", default=DEFAULT_PLAN)
    parser.add_argument("--intake", default=DEFAULT_INTAKE)
    parser.add_argument("--dashboard", default=DEFAULT_DASHBOARD)
    parser.add_argument("--drive-approval-notes-summary", default=DEFAULT_DRIVE_APPROVAL_NOTES_SUMMARY)
    parser.add_argument("--drive-approval-notes-verification", default=DEFAULT_DRIVE_APPROVAL_NOTES_VERIFICATION)
    parser.add_argument("--operator-approval-blocker-report", default=DEFAULT_OPERATOR_APPROVAL_BLOCKER_REPORT)
    parser.add_argument("--output", default=DEFAULT_OUTPUT)
    parser.add_argument(
        "--source",
        action="append",
        default=[],
        type=parse_source,
        metavar="LABEL=PATH",
        help="Override or add a current source artifact path to recompute.",
    )
    parser.add_argument(
        "--skip-current-source-check",
        action="store_true",
        help="Skip current source artifact hash and semantic rebuild checks.",
    )
    args = parser.parse_args()

    source_paths: dict[str, Path] | None = None
    if not args.skip_current_source_check:
        source_paths = {
            "operator_approval_intake": Path(args.intake).expanduser().resolve(),
            "extraction_approval_dashboard": Path(args.dashboard).expanduser().resolve(),
            "drive_approval_notes_summary": Path(args.drive_approval_notes_summary).expanduser().resolve(),
            "drive_approval_notes_verification": Path(args.drive_approval_notes_verification).expanduser().resolve(),
            "operator_approval_blocker_report": Path(args.operator_approval_blocker_report).expanduser().resolve(),
        }
        for label, path in args.source:
            source_paths[label] = path

    result = verify_plan(
        Path(args.plan).expanduser().resolve(),
        source_paths=source_paths,
    )
    output = Path(args.output).expanduser().resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps({
        "kind": result["kind"],
        "status": result["status"],
        "plan_status": result["plan_status"],
        "summary": result["summary"],
        "errors": result["errors"],
        "warnings": result["warnings"],
    }, indent=2, sort_keys=True))
    return 0 if result["status"] == "ok" else 1


if __name__ == "__main__":
    raise SystemExit(main())
