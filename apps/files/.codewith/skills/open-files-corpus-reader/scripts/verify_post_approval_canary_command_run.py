#!/usr/bin/env python3
"""Verify a post-approval canary command run summary."""

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


DEFAULT_RUN_SUMMARY = ".codewith/private-artifacts/operator-approvals/post-approval-canary-command-run-summary.json"
DEFAULT_PLAN = ".codewith/private-artifacts/operator-approvals/post-approval-canary-command-plan.json"
DEFAULT_PLAN_VERIFICATION = ".codewith/private-artifacts/operator-approvals/post-approval-canary-command-plan-verification.json"
DEFAULT_DASHBOARD = ".codewith/private-artifacts/extraction-approval-dashboard.json"
DEFAULT_DRIVE_APPROVAL_NOTES_SUMMARY = ".codewith/private-artifacts/drive-approval/drive-approval-notes-summary.json"
DEFAULT_DRIVE_APPROVAL_NOTES_VERIFICATION = ".codewith/private-artifacts/drive-approval/drive-approval-notes-verification.json"
DEFAULT_OPERATOR_APPROVAL_BLOCKER_REPORT = ".codewith/private-artifacts/operator-approval-blocker-report.json"
DEFAULT_OUTPUT = ".codewith/private-artifacts/operator-approvals/post-approval-canary-command-run-verification.json"

SCRIPT_DIR = Path(__file__).resolve().parent
RUNNER_PATH = SCRIPT_DIR / "run_post_approval_canary_command_plan.py"

EXPECTED_SOURCE_LABELS = {
    "post_approval_canary_command_plan",
    "post_approval_canary_command_plan_verification",
    "extraction_approval_dashboard",
    "drive_approval_notes_summary",
    "drive_approval_notes_verification",
    "operator_approval_blocker_report",
}

ALLOWED_STATUSES = {"dry_run_blocked", "dry_run_ready", "executed", "error"}

EXPECTED_NON_MUTATION_KEYS = {
    "approvals_granted": False,
    "corpus_bytes_mutated_by_runner": False,
    "s3_objects_mutated_by_runner": False,
    "metadata_rows_mutated_by_runner": False,
    "search_index_rows_mutated_by_runner": False,
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


def load_runner() -> ModuleType:
    spec = importlib.util.spec_from_file_location("post_approval_canary_command_runner", RUNNER_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError("failed_to_load_runner")
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
        "post_approval_canary_command_plan": Path(DEFAULT_PLAN).expanduser().resolve(),
        "post_approval_canary_command_plan_verification": Path(DEFAULT_PLAN_VERIFICATION).expanduser().resolve(),
        "extraction_approval_dashboard": Path(DEFAULT_DASHBOARD).expanduser().resolve(),
        "drive_approval_notes_summary": Path(DEFAULT_DRIVE_APPROVAL_NOTES_SUMMARY).expanduser().resolve(),
        "drive_approval_notes_verification": Path(DEFAULT_DRIVE_APPROVAL_NOTES_VERIFICATION).expanduser().resolve(),
        "operator_approval_blocker_report": Path(DEFAULT_OPERATOR_APPROVAL_BLOCKER_REPORT).expanduser().resolve(),
    }


def source_by_label(summary: dict[str, Any]) -> dict[str, dict[str, Any]]:
    output: dict[str, dict[str, Any]] = {}
    for item in list_value(summary.get("source_artifacts")):
        if isinstance(item, dict) and isinstance(item.get("label"), str):
            output[item["label"]] = item
    return output


def command_entries(summary: dict[str, Any]) -> list[dict[str, Any]]:
    return [item for item in list_value(summary.get("commands")) if isinstance(item, dict)]


def semantic_projection(summary: dict[str, Any]) -> dict[str, Any]:
    return {
        "status": summary.get("status"),
        "summary": summary.get("summary"),
        "commands": summary.get("commands"),
        "non_mutation_attestation": summary.get("non_mutation_attestation"),
        "errors": summary.get("errors"),
        "warnings": summary.get("warnings"),
        "redaction_check": summary.get("redaction_check"),
    }


def expected_dry_run_summary(source_paths: dict[str, Path], run_summary: dict[str, Any]) -> dict[str, Any]:
    runner = load_runner()
    return runner.build_run_summary(
        plan=load_json(source_paths["post_approval_canary_command_plan"]),
        verification=load_json(source_paths["post_approval_canary_command_plan_verification"]),
        dashboard=load_json(source_paths["extraction_approval_dashboard"]),
        drive_approval_notes_summary=load_json(source_paths["drive_approval_notes_summary"]),
        drive_approval_notes_verification=load_json(source_paths["drive_approval_notes_verification"]),
        operator_approval_blocker_report=load_json(source_paths["operator_approval_blocker_report"]),
        source_artifacts=[
            runner.source_entry("post_approval_canary_command_plan", source_paths["post_approval_canary_command_plan"]),
            runner.source_entry("post_approval_canary_command_plan_verification", source_paths["post_approval_canary_command_plan_verification"]),
            runner.source_entry("extraction_approval_dashboard", source_paths["extraction_approval_dashboard"]),
            runner.source_entry("drive_approval_notes_summary", source_paths["drive_approval_notes_summary"]),
            runner.source_entry("drive_approval_notes_verification", source_paths["drive_approval_notes_verification"]),
            runner.source_entry("operator_approval_blocker_report", source_paths["operator_approval_blocker_report"]),
        ],
        execute=False,
        cwd=Path.cwd(),
        log_dir=Path(DEFAULT_RUN_SUMMARY).expanduser().resolve().parent / "post-approval-canary-command-logs",
        timeout_seconds=1800,
        max_commands=dict_value(run_summary.get("summary")).get("selected_commands"),
    )


def verify_run_summary(
    run_summary_path: Path,
    *,
    source_paths: dict[str, Path] | None = None,
    check_logs: bool = True,
) -> dict[str, Any]:
    errors: list[str] = []
    warnings: list[str] = []
    run_summary = load_json(run_summary_path)

    if run_summary.get("kind") != "open_files_post_approval_canary_command_run_summary":
        add_error(errors, "invalid_kind")
    if run_summary.get("version") != 1:
        add_error(errors, "invalid_version")
    if run_summary.get("status") not in ALLOWED_STATUSES:
        add_error(errors, "invalid_status")
    if run_summary.get("status") == "error":
        add_error(errors, "run_summary_status_error")

    marker_counts = scan_text(json.dumps(run_summary, sort_keys=True))
    if marker_counts:
        add_error(errors, "sensitive_marker_hits")
    redaction_check = dict_value(run_summary.get("redaction_check"))
    if redaction_check.get("passed") is not True:
        add_error(errors, "redaction_check_not_passed")
    if redaction_check.get("sensitive_marker_counts"):
        add_error(errors, "redaction_check_counts_nonempty")

    non_mutation = dict_value(run_summary.get("non_mutation_attestation"))
    for key, expected in EXPECTED_NON_MUTATION_KEYS.items():
        if non_mutation.get(key) is not expected:
            add_error(errors, "non_mutation_mismatch", key)

    summary = dict_value(run_summary.get("summary"))
    summary_stage_readiness = stage_readiness_snapshot(summary.get("operator_approval_blocker_stage_readiness"))
    for key in missing_stage_readiness_keys(summary_stage_readiness):
        add_error(errors, "operator_approval_blocker_stage_readiness_missing", key)
    commands = command_entries(run_summary)
    executed_commands = [item for item in commands if item.get("executed") is True]
    resolved_commands = [item for item in commands if item.get("command_resolved") is True]

    expected_counts = {
        "selected_commands": len(commands),
        "resolved_commands": len(resolved_commands),
        "commands_executed": len(executed_commands),
    }
    for key, expected in expected_counts.items():
        if summary.get(key) != expected:
            add_error(errors, "summary_count_mismatch", key)

    execution_requested = summary.get("execution_requested")
    execution_allowed = summary.get("execution_allowed")
    if execution_requested is not non_mutation.get("execute_requested"):
        add_error(errors, "execution_requested_attestation_mismatch")
    if execution_allowed is not non_mutation.get("execution_allowed"):
        add_error(errors, "execution_allowed_attestation_mismatch")
    if non_mutation.get("dry_run") is not (execution_requested is False):
        add_error(errors, "dry_run_attestation_mismatch")

    if run_summary.get("status") == "dry_run_blocked":
        if execution_requested is not False:
            add_error(errors, "dry_run_blocked_execution_requested")
        if execution_allowed is not False:
            add_error(errors, "dry_run_blocked_execution_allowed")
        if summary.get("commands_executed") != 0:
            add_error(errors, "dry_run_blocked_executed_commands")
        if not list_value(summary.get("blocked_reasons")):
            add_error(errors, "dry_run_blocked_missing_reasons")
    if run_summary.get("status") == "dry_run_ready":
        if execution_requested is not False or execution_allowed is not True:
            add_error(errors, "dry_run_ready_gate_mismatch")
        if summary.get("commands_executed") != 0:
            add_error(errors, "dry_run_ready_executed_commands")
    if run_summary.get("status") == "executed":
        if execution_requested is not True or execution_allowed is not True:
            add_error(errors, "executed_gate_mismatch")
        if summary.get("commands_executed", 0) < 1:
            add_error(errors, "executed_without_commands")

    for index, item in enumerate(commands):
        label = f"commands[{index}]"
        if item.get("raw_command_omitted") is not True:
            add_error(errors, "raw_command_not_omitted", label)
        if "command" in item or "raw_command" in item:
            add_error(errors, "raw_command_field_present", label)
        if item.get("command_resolved") is True:
            if item.get("command_sha256_matches") is not True:
                add_error(errors, "command_sha256_not_matched", label)
            if item.get("command_bytes_matches") is not True:
                add_error(errors, "command_bytes_not_matched", label)
        if item.get("executed") is True:
            result = dict_value(item.get("result"))
            if not result:
                add_error(errors, "executed_command_missing_result", label)
                continue
            if result.get("timed_out") is True:
                add_error(errors, "executed_command_timed_out", label)
            if result.get("exit_code") != 0:
                add_error(errors, "executed_command_failed", label)
            if check_logs:
                log_file = result.get("log_file")
                if not isinstance(log_file, str):
                    add_error(errors, "executed_command_missing_log_file", label)
                    continue
                log_path = Path(log_file).expanduser()
                if not log_path.is_absolute():
                    log_path = run_summary_path.parent / log_path
                if not log_path.exists():
                    add_error(errors, "executed_command_log_missing", label)
                    continue
                if result.get("log_bytes") != log_path.stat().st_size:
                    add_error(errors, "executed_command_log_bytes_mismatch", label)
                if result.get("log_sha256") != file_sha256(log_path):
                    add_error(errors, "executed_command_log_sha256_mismatch", label)

    by_label = source_by_label(run_summary)
    missing_labels = sorted(EXPECTED_SOURCE_LABELS - set(by_label))
    for label in missing_labels:
        add_error(errors, "missing_source_artifact", label)
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
        if not current_missing_path_labels and summary.get("execution_requested") is False:
            try:
                expected = expected_dry_run_summary(source_paths, run_summary)
                if semantic_projection(run_summary) != semantic_projection(expected):
                    add_error(errors, "dry_run_semantic_projection_mismatch")
            except Exception as exc:  # pragma: no cover - defensive CLI boundary
                add_error(errors, "expected_dry_run_rebuild_failed", f"{type(exc).__name__}:{exc}")

    gates = {
        "kind_ok": run_summary.get("kind") == "open_files_post_approval_canary_command_run_summary",
        "status_accepted": run_summary.get("status") in (ALLOWED_STATUSES - {"error"}),
        "redaction_ok": redaction_check.get("passed") is True and not redaction_check.get("sensitive_marker_counts") and not marker_counts,
        "non_mutation_attested": all(non_mutation.get(key) is expected for key, expected in EXPECTED_NON_MUTATION_KEYS.items()),
        "summary_counts_consistent": not any(error.startswith("summary_count_mismatch") for error in errors),
        "raw_commands_omitted": not any(error.startswith("raw_command") for error in errors),
        "source_artifacts_present": EXPECTED_SOURCE_LABELS <= set(by_label),
        "source_artifacts_current": not current_mismatched_labels and not current_missing_path_labels if source_paths is not None else None,
        "dry_run_semantic_current": "dry_run_semantic_projection_mismatch" not in errors if summary.get("execution_requested") is False else None,
        "operator_approval_blocker_stage_readiness_present": not any(
            error.startswith("operator_approval_blocker_stage_readiness_missing")
            for error in errors
        ),
        "logs_verified": check_logs,
    }

    return {
        "kind": "open_files_post_approval_canary_command_run_verification",
        "version": 1,
        "created_at": now_utc(),
        "status": "ok" if not errors else "error",
        "run_status": run_summary.get("status"),
        "summary": {
            "execution_requested": summary.get("execution_requested"),
            "execution_allowed": summary.get("execution_allowed"),
            "drive_approval_ready": summary.get("drive_approval_ready"),
            "drive_approval_notes_status": summary.get("drive_approval_notes_status"),
            "drive_approval_notes_verification_status": summary.get("drive_approval_notes_verification_status"),
            "operator_approval_blocker_status": summary.get("operator_approval_blocker_status"),
            "operator_approval_blocker_ready": summary.get("operator_approval_blocker_ready"),
            "operator_approval_blocker_stage_readiness": summary_stage_readiness,
            "selected_commands": summary.get("selected_commands"),
            "resolved_commands": summary.get("resolved_commands"),
            "commands_executed": summary.get("commands_executed"),
            "planned_commands": summary.get("planned_commands"),
            "blocked_reasons": summary.get("blocked_reasons"),
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
        "redaction": "aggregate-only run-summary verification; no raw commands, command logs, approval note text, private filenames, file IDs, object keys, source refs, extracted text, transcripts, row payloads, or secrets",
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Verify a post-approval canary command run summary.")
    parser.add_argument("--run-summary", default=DEFAULT_RUN_SUMMARY)
    parser.add_argument("--plan", default=DEFAULT_PLAN)
    parser.add_argument("--plan-verification", default=DEFAULT_PLAN_VERIFICATION)
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
    parser.add_argument("--skip-current-source-check", action="store_true")
    parser.add_argument("--skip-log-check", action="store_true")
    args = parser.parse_args()

    source_paths: dict[str, Path] | None = None
    if not args.skip_current_source_check:
        source_paths = {
            "post_approval_canary_command_plan": Path(args.plan).expanduser().resolve(),
            "post_approval_canary_command_plan_verification": Path(args.plan_verification).expanduser().resolve(),
            "extraction_approval_dashboard": Path(args.dashboard).expanduser().resolve(),
            "drive_approval_notes_summary": Path(args.drive_approval_notes_summary).expanduser().resolve(),
            "drive_approval_notes_verification": Path(args.drive_approval_notes_verification).expanduser().resolve(),
            "operator_approval_blocker_report": Path(args.operator_approval_blocker_report).expanduser().resolve(),
        }
        for label, path in args.source:
            source_paths[label] = path

    result = verify_run_summary(
        Path(args.run_summary).expanduser().resolve(),
        source_paths=source_paths,
        check_logs=not args.skip_log_check,
    )
    output = Path(args.output).expanduser().resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps({
        "kind": result["kind"],
        "status": result["status"],
        "run_status": result["run_status"],
        "summary": result["summary"],
        "errors": result["errors"],
        "warnings": result["warnings"],
    }, indent=2, sort_keys=True))
    return 0 if result["status"] == "ok" else 1


if __name__ == "__main__":
    raise SystemExit(main())
