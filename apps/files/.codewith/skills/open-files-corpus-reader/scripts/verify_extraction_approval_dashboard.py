#!/usr/bin/env python3
"""Verify the aggregate extraction approval dashboard."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import time
from pathlib import Path
from typing import Any


DEFAULT_DASHBOARD = ".codewith/private-artifacts/extraction-approval-dashboard.json"
DEFAULT_OUTPUT = ".codewith/private-artifacts/extraction-approval-dashboard-verification.json"

EXPECTED_SOURCE_LABELS = {
    "extraction_readiness",
    "tool_remediation",
    "ocr_smoke",
    "worker_image_verification",
    "worker_image_approval",
    "search_index_approval",
    "search_index_validation",
    "search_index_runtime",
    "large_file_approval",
    "large_file_validation",
    "large_file_dry_run_verification",
    "llm_campaign_plan",
    "llm_campaign_validation",
    "llm_campaign_runtime",
    "llm_campaign_results",
    "deferred_media",
    "approval_notes_summary",
}

DEFAULT_SOURCE_PATHS = {
    "extraction_readiness": ".codewith/private-artifacts/extraction-lane-readiness-gate.json",
    "tool_remediation": ".codewith/private-artifacts/extraction-tool-remediation-packet.json",
    "ocr_smoke": ".codewith/private-artifacts/extraction-smoke-ocr-summary.json",
    "worker_image_verification": ".codewith/private-artifacts/extraction-worker-image-verification.json",
    "worker_image_approval": ".codewith/private-artifacts/extraction-worker-image-approval-packet.json",
    "search_index_approval": ".codewith/private-artifacts/search-index-current-plan/search-index-approval-packet.json",
    "search_index_validation": ".codewith/private-artifacts/search-index-current-plan/search-index-plan-validation.json",
    "search_index_runtime": ".codewith/private-artifacts/search-index-nonmedia-plan/unapproved-execute-summary.json",
    "large_file_approval": ".codewith/private-artifacts/large-file-canary-balanced-nonaudio/large-file-approval-packet.json",
    "large_file_validation": ".codewith/private-artifacts/large-file-canary-balanced-nonaudio/large-file-extraction-validation-summary.json",
    "large_file_dry_run_verification": ".codewith/private-artifacts/large-file-canary-balanced-nonaudio/large-file-dry-run-verification.json",
    "llm_campaign_plan": ".codewith/private-artifacts/llm-campaigns/sanitized-one-job/campaign-plan.json",
    "llm_campaign_validation": ".codewith/private-artifacts/llm-campaigns/sanitized-one-job/campaign-validation.json",
    "llm_campaign_runtime": ".codewith/private-artifacts/llm-campaigns/sanitized-one-job/unapproved-execute-summary.json",
    "llm_campaign_results": ".codewith/private-artifacts/llm-campaigns/sanitized-one-job/collected-results/campaign-results-summary.json",
    "deferred_media": ".codewith/private-artifacts/deferred-media-completion/deferred-media-completion-summary.json",
    "approval_notes_summary": ".codewith/private-artifacts/operator-approvals/approval-notes-summary.json",
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
    ("google_drive_url", re.compile(r"(drive|docs)\.google\.com/", re.I)),
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


def list_value(value: Any) -> list[Any]:
    return value if isinstance(value, list) else []


def dict_value(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def add_error(errors: list[str], code: str, detail: str | None = None) -> None:
    errors.append(f"{code}:{detail}" if detail else code)


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


def resolved_default_source_paths() -> dict[str, Path]:
    return {label: Path(path).expanduser().resolve() for label, path in DEFAULT_SOURCE_PATHS.items()}


def source_label_map(dashboard: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {
        str(item.get("label")): item
        for item in list_value(dashboard.get("source_artifacts"))
        if isinstance(item, dict) and item.get("label")
    }


def verify_dashboard(
    dashboard_path: Path,
    *,
    source_paths: dict[str, Path] | None = None,
) -> dict[str, Any]:
    errors: list[str] = []
    warnings: list[str] = []
    dashboard = load_json(dashboard_path)

    if dashboard.get("kind") != "open_files_extraction_approval_dashboard":
        add_error(errors, "invalid_kind")
    if dashboard.get("version") != 1:
        add_error(errors, "invalid_version")

    marker_counts = scan_text(json.dumps(dashboard, sort_keys=True))
    if marker_counts:
        add_error(errors, "sensitive_marker_hits")
    redaction_check = dict_value(dashboard.get("redaction_check"))
    if redaction_check.get("passed") is not True:
        add_error(errors, "redaction_check_not_passed")
    if redaction_check.get("sensitive_marker_counts"):
        add_error(errors, "redaction_check_counts_nonempty")

    checks = dict_value(dashboard.get("dashboard_checks"))
    for key in (
        "redaction_ok",
        "source_artifacts_present",
        "source_artifact_hashes_ok",
        "non_mutation_attested",
        "tool_remediation_redaction_ok",
        "approval_notes_redaction_ok",
    ):
        if checks.get(key) is not True:
            add_error(errors, "dashboard_check_not_true", key)
    if dashboard.get("dashboard_errors"):
        add_error(errors, "dashboard_errors_present")

    sources = source_label_map(dashboard)
    missing_sources = sorted(EXPECTED_SOURCE_LABELS - set(sources))
    for label in missing_sources:
        add_error(errors, "missing_source_artifact", label)
    for label, item in sorted(sources.items()):
        if label not in EXPECTED_SOURCE_LABELS:
            add_error(errors, "unexpected_source_artifact", label)
            continue
        if item.get("present") is not True:
            add_error(errors, "source_artifact_not_present", label)
        if as_int(item.get("bytes")) <= 0:
            add_error(errors, "source_artifact_empty", label)
        sha = item.get("sha256")
        if not isinstance(sha, str) or not re.fullmatch(r"[0-9a-f]{64}", sha):
            add_error(errors, "source_artifact_sha256_invalid", label)

    current_checked_labels: list[str] = []
    current_mismatched_labels: list[str] = []
    current_missing_path_labels: list[str] = []
    if source_paths:
        for label, raw_path in sorted(source_paths.items()):
            if label not in EXPECTED_SOURCE_LABELS:
                add_error(errors, "current_source_unexpected_label", label)
                continue
            current_checked_labels.append(label)
            item = sources.get(label)
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
            if expected_bytes == actual_bytes and expected_sha == actual_sha:
                continue
            current_mismatched_labels.append(label)
            if expected_bytes != actual_bytes:
                add_error(errors, "source_artifact_current_bytes_mismatch", label)
            if expected_sha != actual_sha:
                add_error(errors, "source_artifact_current_sha256_mismatch", label)

    overall = dict_value(dashboard.get("overall"))
    approval_items = [item for item in list_value(dashboard.get("approval_items")) if isinstance(item, dict)]
    non_deferred = [item for item in approval_items if item.get("id") != "deferred_media_final_pass"]
    ready_items = [item for item in approval_items if item.get("ready_for_approval") is True]
    approved_notes = [
        item
        for item in non_deferred
        if dict_value(item.get("approval_note")).get("approved") is True
    ]
    pending_notes = [
        str(item.get("id"))
        for item in non_deferred
        if dict_value(item.get("approval_note")).get("approved") is not True
    ]
    prep_blockers = [
        str(item.get("id"))
        for item in non_deferred
        if item.get("ready_for_approval") is not True
    ]
    if as_int(overall.get("ready_approval_items")) != len(ready_items):
        add_error(errors, "overall_ready_approval_items_inconsistent")
    if as_int(overall.get("approval_items")) != len(non_deferred):
        add_error(errors, "overall_approval_items_inconsistent")
    if as_int(overall.get("approved_approval_notes")) != len(approved_notes):
        add_error(errors, "overall_approved_approval_notes_inconsistent")
    if sorted(str(item) for item in list_value(overall.get("pending_approval_note_items"))) != sorted(pending_notes):
        add_error(errors, "overall_pending_approval_notes_inconsistent")
    if sorted(str(item) for item in list_value(overall.get("blocked_or_missing_prep_items"))) != sorted(prep_blockers):
        add_error(errors, "overall_blocked_prep_items_inconsistent")
    if overall.get("approval_notes_complete") is not (not pending_notes):
        add_error(errors, "overall_approval_notes_complete_inconsistent")
    expected_status = "ready_for_operator_review" if not prep_blockers else "needs_prep"
    if dashboard.get("status") != expected_status:
        add_error(errors, "dashboard_status_inconsistent")
    if overall.get("ready_for_operator_review") is not (dashboard.get("status") == "ready_for_operator_review"):
        add_error(errors, "overall_ready_flag_inconsistent")
    for key in ("corpus_bytes_mutated", "s3_objects_mutated", "metadata_rows_mutated"):
        if overall.get(key) is not False:
            add_error(errors, "non_mutation_mismatch", key)
    if overall.get("final_media_pass_deferred") is not True:
        add_error(errors, "final_media_deferred_flag_not_true")

    sections = dict_value(dashboard.get("sections"))
    tool_remediation = dict_value(sections.get("tool_remediation"))
    tool_redaction = dict_value(tool_remediation.get("redaction_check"))
    if tool_remediation.get("present") is not True:
        add_error(errors, "tool_remediation_not_present")
    if tool_redaction.get("passed") is not True:
        add_error(errors, "tool_remediation_redaction_not_passed")
    approval_notes = dict_value(sections.get("operator_approval_notes"))
    notes_redaction = dict_value(approval_notes.get("redaction_check"))
    if approval_notes.get("present") is not True:
        add_error(errors, "approval_notes_not_present")
    if notes_redaction and notes_redaction.get("passed") is not True:
        add_error(errors, "approval_notes_redaction_not_passed")

    source_error = any(error.startswith("current_source_") or error.startswith("source_artifact_current_") for error in errors)
    gates = {
        "kind_ok": dashboard.get("kind") == "open_files_extraction_approval_dashboard",
        "redaction_ok": not marker_counts and redaction_check.get("passed") is True,
        "dashboard_checks_ok": not any(error.startswith("dashboard_check_not_true") or error == "dashboard_errors_present" for error in errors),
        "source_artifacts_present": not any(error.startswith("missing_source_artifact") or error.startswith("source_artifact_not_present") for error in errors),
        "source_artifact_hashes_ok": not any(error.startswith("source_artifact_sha256_invalid") for error in errors),
        "source_artifact_current_hashes_ok": (not source_error if source_paths else None),
        "overall_counts_consistent": not any(error.startswith("overall_") for error in errors),
        "non_mutation_attested": not any(error.startswith("non_mutation_mismatch") for error in errors),
        "tool_remediation_ok": "tool_remediation_not_present" not in errors and "tool_remediation_redaction_not_passed" not in errors,
        "approval_notes_ok": "approval_notes_not_present" not in errors and "approval_notes_redaction_not_passed" not in errors,
        "status_consistent": "dashboard_status_inconsistent" not in errors,
    }

    return {
        "kind": "open_files_extraction_approval_dashboard_verification",
        "version": 1,
        "created_at": now_utc(),
        "status": "ok" if not errors else "error",
        "dashboard_status": dashboard.get("status"),
        "expected_dashboard_status": expected_status,
        "gates": gates,
        "summary": {
            "approval_items": overall.get("approval_items"),
            "ready_approval_items": overall.get("ready_approval_items"),
            "approved_approval_notes": overall.get("approved_approval_notes"),
            "pending_approval_note_items": len(list_value(overall.get("pending_approval_note_items"))),
            "blocked_or_missing_prep_items": len(list_value(overall.get("blocked_or_missing_prep_items"))),
            "source_artifacts": len(sources),
        },
        "source_artifacts": {
            "expected": len(EXPECTED_SOURCE_LABELS),
            "present": len(set(sources) & EXPECTED_SOURCE_LABELS),
            "current_checked": bool(source_paths),
            "current_checked_labels": current_checked_labels,
            "current_mismatched": sorted(set(current_mismatched_labels)),
            "current_missing_paths": sorted(set(current_missing_path_labels)),
        },
        "sensitive_marker_counts": marker_counts,
        "errors": errors,
        "warnings": warnings,
        "redaction": "aggregate-only dashboard verification; no private filenames, file IDs, object keys, source refs, extracted text, transcripts, ACL payloads, row payloads, command logs, or secrets",
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Verify extraction approval dashboard.")
    parser.add_argument("--dashboard", default=DEFAULT_DASHBOARD)
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
        help="Skip recomputing current source artifact bytes and hashes.",
    )
    args = parser.parse_args()

    source_paths: dict[str, Path] | None = None
    if not args.skip_current_source_check:
        source_paths = resolved_default_source_paths()
        for label, path in args.source:
            source_paths[label] = path

    result = verify_dashboard(Path(args.dashboard).expanduser().resolve(), source_paths=source_paths)
    output = Path(args.output).expanduser().resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps({
        "kind": result["kind"],
        "status": result["status"],
        "dashboard_status": result["dashboard_status"],
        "expected_dashboard_status": result["expected_dashboard_status"],
        "summary": result["summary"],
        "errors": result["errors"],
        "warnings": result["warnings"],
    }, indent=2, sort_keys=True))
    return 0 if result["status"] == "ok" else 1


if __name__ == "__main__":
    raise SystemExit(main())
