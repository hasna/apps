#!/usr/bin/env python3
"""Run or dry-run a verified post-approval canary command plan."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import shlex
import subprocess
import time
from pathlib import Path
from typing import Any


DEFAULT_PLAN = ".codewith/private-artifacts/operator-approvals/post-approval-canary-command-plan.json"
DEFAULT_PLAN_VERIFICATION = ".codewith/private-artifacts/operator-approvals/post-approval-canary-command-plan-verification.json"
DEFAULT_DASHBOARD = ".codewith/private-artifacts/extraction-approval-dashboard.json"
DEFAULT_DRIVE_APPROVAL_NOTES_SUMMARY = ".codewith/private-artifacts/drive-approval/drive-approval-notes-summary.json"
DEFAULT_DRIVE_APPROVAL_NOTES_VERIFICATION = ".codewith/private-artifacts/drive-approval/drive-approval-notes-verification.json"
DEFAULT_OPERATOR_APPROVAL_BLOCKER_REPORT = ".codewith/private-artifacts/operator-approval-blocker-report.json"
DEFAULT_OUTPUT = ".codewith/private-artifacts/operator-approvals/post-approval-canary-command-run-summary.json"
DEFAULT_LOG_DIR = ".codewith/private-artifacts/operator-approvals/post-approval-canary-command-logs"

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


def text_sha256(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


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


def validate_stage_readiness(stage_readiness: dict[str, Any], errors: list[str]) -> None:
    for key in STAGE_READINESS_REQUIRED_KEYS:
        if key not in stage_readiness:
            errors.append(f"operator_approval_blocker_stage_readiness_missing:{key}")


def source_entry(label: str, path: Path) -> dict[str, Any]:
    return {
        "label": label,
        "present": path.exists(),
        "bytes": path.stat().st_size if path.exists() else 0,
        "sha256": file_sha256(path) if path.exists() else None,
    }


def source_by_label(entries: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    output: dict[str, dict[str, Any]] = {}
    for item in entries:
        if isinstance(item, dict) and isinstance(item.get("label"), str):
            output[item["label"]] = item
    return output


def resolve_dashboard_command(dashboard: dict[str, Any], command_ref: str) -> str | None:
    prefix = "dashboard.sections."
    if not command_ref.startswith(prefix):
        return None
    rest = command_ref[len(prefix):]
    if ".commands." not in rest:
        return None
    section_name, command_name = rest.split(".commands.", 1)
    sections = dict_value(dashboard.get("sections"))
    section = dict_value(sections.get(section_name))
    commands = dict_value(section.get("commands"))
    command = commands.get(command_name)
    return command if isinstance(command, str) else None


def command_plan_entries(plan: dict[str, Any]) -> list[dict[str, Any]]:
    entries = [item for item in list_value(plan.get("command_queue")) if isinstance(item, dict)]
    return sorted(entries, key=lambda item: (str(item.get("decision_id")), int(item.get("order") or 0), str(item.get("name"))))


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


def blocker_report_gate(report: dict[str, Any]) -> dict[str, Any]:
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

    ready = (
        not errors
        and safe_next_step.get("final_gate_verifiers_ok") is True
        and safe_next_step.get("approval_request_verification_ok") is True
        and int(safe_next_step.get("ready_nonapproval_nonmedia_tasks") or 0) == 0
    )
    return {
        "ready": ready,
        "status": report.get("status"),
        "safe_next_step_type": safe_next_step.get("type"),
        "final_gate_verifiers_ok": safe_next_step.get("final_gate_verifiers_ok") is True,
        "approval_request_verification_ok": safe_next_step.get("approval_request_verification_ok") is True,
        "ready_nonapproval_nonmedia_tasks": safe_next_step.get("ready_nonapproval_nonmedia_tasks"),
        "stage_readiness": stage_readiness,
        "errors": errors,
    }


def execution_allowed(
    plan: dict[str, Any],
    verification: dict[str, Any],
    dashboard: dict[str, Any],
    execute: bool,
    *,
    drive_approval_notes_summary: dict[str, Any],
    drive_approval_notes_verification: dict[str, Any],
    operator_approval_blocker_report: dict[str, Any],
    source_artifacts: list[dict[str, Any]],
) -> tuple[bool, list[str], dict[str, Any]]:
    reasons: list[str] = []
    drive_gate = drive_approval_gate(drive_approval_notes_summary, drive_approval_notes_verification)
    blocker_gate = blocker_report_gate(operator_approval_blocker_report)
    if plan.get("kind") != "open_files_post_approval_canary_command_plan":
        reasons.append("invalid_plan_kind")
    if plan.get("version") != 1:
        reasons.append("invalid_plan_version")
    if verification.get("kind") != "open_files_post_approval_canary_command_plan_verification":
        reasons.append("invalid_plan_verification_kind")
    if verification.get("version") != 1:
        reasons.append("invalid_plan_verification_version")
    if verification.get("status") != "ok":
        reasons.append("plan_verification_not_ok")
    if verification.get("plan_status") != plan.get("status"):
        reasons.append("plan_verification_status_mismatch")
    if plan.get("status") != "ready_for_operator_execution":
        reasons.append(f"plan_not_ready:{plan.get('status')}")
    if not command_plan_entries(plan):
        reasons.append("empty_command_queue")
    if dashboard.get("kind") != "open_files_extraction_approval_dashboard":
        reasons.append("invalid_dashboard_kind")
    if dashboard.get("version") != 1:
        reasons.append("invalid_dashboard_version")
    if drive_approval_notes_summary.get("kind") != "open_files_drive_approval_notes_summary":
        reasons.append("invalid_drive_approval_notes_summary_kind")
    if drive_approval_notes_summary.get("version") != 1:
        reasons.append("invalid_drive_approval_notes_summary_version")
    if drive_approval_notes_verification.get("kind") != "open_files_drive_approval_notes_verification":
        reasons.append("invalid_drive_approval_notes_verification_kind")
    if drive_approval_notes_verification.get("version") != 1:
        reasons.append("invalid_drive_approval_notes_verification_version")
    if drive_approval_notes_summary.get("redaction_check", {}).get("passed") is not True:
        reasons.append("drive_approval_notes_summary_redaction_failed")
    if drive_approval_notes_verification.get("status") != "ok":
        reasons.append("drive_approval_notes_verification_not_ok")
    if drive_approval_notes_verification.get("sensitive_marker_counts", {}).get("summary"):
        reasons.append("drive_approval_notes_verification_redaction_failed")
    if drive_gate.get("ready") is not True:
        reasons.append(f"drive_approval_notes_not_ready:{drive_gate.get('notes_status')}")
    for error in list_value(blocker_gate.get("errors")):
        reasons.append(str(error))
    if blocker_gate.get("ready") is not True:
        reasons.append(f"operator_approval_blocker_report_not_ready:{blocker_gate.get('status')}")
    if plan.get("status") == "blocked_no_unlocked_decisions":
        if blocker_gate.get("status") != "operator_approval_required":
            reasons.append(f"operator_approval_blocker_report_status_mismatch:{blocker_gate.get('status')}")
        if blocker_gate.get("safe_next_step_type") != "operator_approval":
            reasons.append(f"operator_approval_blocker_safe_next_step_mismatch:{blocker_gate.get('safe_next_step_type')}")
    plan_blocker_snapshot = dict_value(plan.get("operator_approval_blocker_snapshot"))
    if stage_readiness_snapshot(plan_blocker_snapshot.get("stage_readiness")) != blocker_gate.get("stage_readiness"):
        reasons.append("operator_approval_blocker_stage_readiness_mismatch")

    plan_sources = source_by_label([item for item in list_value(plan.get("source_artifacts")) if isinstance(item, dict)])
    current_sources = source_by_label(source_artifacts)
    planned_blocker = plan_sources.get("operator_approval_blocker_report")
    current_blocker = current_sources.get("operator_approval_blocker_report")
    if not planned_blocker:
        reasons.append("plan_missing_operator_approval_blocker_report_source")
    elif not current_blocker:
        reasons.append("runner_missing_operator_approval_blocker_report_source")
    elif planned_blocker.get("bytes") != current_blocker.get("bytes") or planned_blocker.get("sha256") != current_blocker.get("sha256"):
        reasons.append("operator_approval_blocker_report_not_current_for_plan")

    if execute and reasons:
        return False, reasons, {"drive": drive_gate, "blocker": blocker_gate}
    return not reasons, reasons, {"drive": drive_gate, "blocker": blocker_gate}


def run_command(command: str, cwd: Path, log_path: Path, timeout_seconds: int) -> dict[str, Any]:
    started_at = now_utc()
    log_path.parent.mkdir(parents=True, exist_ok=True)
    try:
        argv = shlex.split(command)
        proc = subprocess.run(
            argv,
            cwd=str(cwd),
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            timeout=timeout_seconds,
            check=False,
        )
        log_text = proc.stdout or ""
        log_path.write_text(log_text, encoding="utf-8")
        return {
            "started_at": started_at,
            "finished_at": now_utc(),
            "exit_code": proc.returncode,
            "timed_out": False,
            "log_file": str(log_path),
            "log_bytes": len(log_text.encode("utf-8")),
            "log_sha256": text_sha256(log_text),
        }
    except subprocess.TimeoutExpired as exc:
        output = exc.stdout or ""
        if isinstance(output, bytes):
            output = output.decode("utf-8", errors="replace")
        log_path.write_text(output, encoding="utf-8")
        return {
            "started_at": started_at,
            "finished_at": now_utc(),
            "exit_code": None,
            "timed_out": True,
            "log_file": str(log_path),
            "log_bytes": len(output.encode("utf-8")),
            "log_sha256": text_sha256(output),
        }


def build_run_summary(
    *,
    plan: dict[str, Any],
    verification: dict[str, Any],
    dashboard: dict[str, Any],
    drive_approval_notes_summary: dict[str, Any],
    drive_approval_notes_verification: dict[str, Any],
    operator_approval_blocker_report: dict[str, Any],
    source_artifacts: list[dict[str, Any]],
    execute: bool,
    cwd: Path,
    log_dir: Path,
    timeout_seconds: int,
    max_commands: int | None = None,
) -> dict[str, Any]:
    errors: list[str] = []
    warnings: list[str] = []
    allowed, reasons, drive_gate = execution_allowed(
        plan,
        verification,
        dashboard,
        execute,
        drive_approval_notes_summary=drive_approval_notes_summary,
        drive_approval_notes_verification=drive_approval_notes_verification,
        operator_approval_blocker_report=operator_approval_blocker_report,
        source_artifacts=source_artifacts,
    )
    blocker_gate = dict_value(drive_gate.get("blocker"))
    drive_gate = dict_value(drive_gate.get("drive"))
    entries = command_plan_entries(plan)
    if max_commands is not None:
        entries = entries[:max_commands]

    resolved: list[dict[str, Any]] = []
    for index, entry in enumerate(entries):
        command_ref = entry.get("command_ref") if isinstance(entry.get("command_ref"), str) else ""
        command = resolve_dashboard_command(dashboard, command_ref)
        item_errors: list[str] = []
        if command is None:
            item_errors.append("command_ref_not_resolved")
            add_error(errors, "command_ref_not_resolved", str(index))
            command_sha = None
            command_bytes = 0
        else:
            command_sha = text_sha256(command)
            command_bytes = len(command.encode("utf-8"))
            if command_sha != entry.get("command_sha256"):
                item_errors.append("command_sha256_mismatch")
                add_error(errors, "command_sha256_mismatch", str(index))
            if command_bytes != entry.get("command_bytes"):
                item_errors.append("command_bytes_mismatch")
                add_error(errors, "command_bytes_mismatch", str(index))

        result: dict[str, Any] | None = None
        if execute and allowed and command and not item_errors:
            result = run_command(
                command,
                cwd=cwd,
                log_path=log_dir / f"{index:03d}-{entry.get('decision_id')}-{entry.get('name')}.log",
                timeout_seconds=timeout_seconds,
            )
            if result.get("timed_out") is True:
                add_error(errors, "command_timed_out", str(index))
            elif result.get("exit_code") != 0:
                add_error(errors, "command_failed", str(index))

        resolved.append({
            "index": index,
            "decision_id": entry.get("decision_id"),
            "name": entry.get("name"),
            "command_ref": command_ref,
            "command_resolved": command is not None,
            "command_sha256_matches": command_sha == entry.get("command_sha256") if command_sha else False,
            "command_bytes_matches": command_bytes == entry.get("command_bytes") if command else False,
            "mutation_class": entry.get("mutation_class"),
            "would_execute": execute and allowed and command is not None and not item_errors,
            "executed": bool(result),
            "result": result,
            "errors": item_errors,
            "raw_command_omitted": True,
        })

    if execute and not allowed:
        warnings.extend(reasons)
    status = "error" if errors else ("executed" if execute and allowed and resolved else "dry_run_blocked" if reasons else "dry_run_ready")
    summary = {
        "plan_status": plan.get("status"),
        "verification_status": verification.get("status"),
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
        "execution_requested": execute,
        "execution_allowed": allowed,
        "blocked_reasons": reasons,
        "planned_commands": len(command_plan_entries(plan)),
        "selected_commands": len(entries),
        "resolved_commands": sum(1 for item in resolved if item["command_resolved"]),
        "commands_executed": sum(1 for item in resolved if item["executed"]),
    }
    output = {
        "kind": "open_files_post_approval_canary_command_run_summary",
        "version": 1,
        "created_at": now_utc(),
        "status": status,
        "summary": summary,
        "commands": resolved,
        "source_artifacts": source_artifacts,
        "non_mutation_attestation": {
            "dry_run": not execute,
            "execute_requested": execute,
            "execution_allowed": allowed,
            "approvals_granted": False,
            "corpus_bytes_mutated_by_runner": False,
            "s3_objects_mutated_by_runner": False,
            "metadata_rows_mutated_by_runner": False,
            "search_index_rows_mutated_by_runner": False,
            "raw_commands_omitted": True,
        },
        "errors": errors,
        "warnings": warnings,
        "redaction": "aggregate-only run summary; raw commands, command logs, approval note text, private filenames, file IDs, object keys, source refs, extracted text, transcripts, row payloads, and secrets are omitted",
    }
    marker_counts = scan_text(json.dumps(output, sort_keys=True))
    output["redaction_check"] = {
        "passed": not marker_counts,
        "sensitive_marker_counts": marker_counts,
    }
    if marker_counts:
        output["status"] = "error"
        output["errors"].append("sensitive_marker_hits")
    return output


def main() -> int:
    parser = argparse.ArgumentParser(description="Dry-run or execute a verified post-approval canary command plan.")
    parser.add_argument("--plan", default=DEFAULT_PLAN)
    parser.add_argument("--plan-verification", default=DEFAULT_PLAN_VERIFICATION)
    parser.add_argument("--dashboard", default=DEFAULT_DASHBOARD)
    parser.add_argument("--drive-approval-notes-summary", default=DEFAULT_DRIVE_APPROVAL_NOTES_SUMMARY)
    parser.add_argument("--drive-approval-notes-verification", default=DEFAULT_DRIVE_APPROVAL_NOTES_VERIFICATION)
    parser.add_argument("--operator-approval-blocker-report", default=DEFAULT_OPERATOR_APPROVAL_BLOCKER_REPORT)
    parser.add_argument("--output", default=DEFAULT_OUTPUT)
    parser.add_argument("--log-dir", default=DEFAULT_LOG_DIR)
    parser.add_argument("--cwd", default=str(Path.cwd()))
    parser.add_argument("--execute", action="store_true", help="Run commands only when the verified plan is ready.")
    parser.add_argument("--timeout-seconds", type=int, default=1800)
    parser.add_argument("--max-commands", type=int)
    args = parser.parse_args()

    plan_path = Path(args.plan).expanduser().resolve()
    verification_path = Path(args.plan_verification).expanduser().resolve()
    dashboard_path = Path(args.dashboard).expanduser().resolve()
    drive_notes_path = Path(args.drive_approval_notes_summary).expanduser().resolve()
    drive_verification_path = Path(args.drive_approval_notes_verification).expanduser().resolve()
    blocker_report_path = Path(args.operator_approval_blocker_report).expanduser().resolve()
    result = build_run_summary(
        plan=load_json(plan_path),
        verification=load_json(verification_path),
        dashboard=load_json(dashboard_path),
        drive_approval_notes_summary=load_json(drive_notes_path),
        drive_approval_notes_verification=load_json(drive_verification_path),
        operator_approval_blocker_report=load_json(blocker_report_path),
        source_artifacts=[
            source_entry("post_approval_canary_command_plan", plan_path),
            source_entry("post_approval_canary_command_plan_verification", verification_path),
            source_entry("extraction_approval_dashboard", dashboard_path),
            source_entry("drive_approval_notes_summary", drive_notes_path),
            source_entry("drive_approval_notes_verification", drive_verification_path),
            source_entry("operator_approval_blocker_report", blocker_report_path),
        ],
        execute=args.execute,
        cwd=Path(args.cwd).expanduser().resolve(),
        log_dir=Path(args.log_dir).expanduser().resolve(),
        timeout_seconds=args.timeout_seconds,
        max_commands=args.max_commands,
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
