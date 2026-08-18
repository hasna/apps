#!/usr/bin/env python3
"""Verify the aggregate Google Drive replacement readiness gate."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import time
from pathlib import Path
from typing import Any


DEFAULT_GATE = ".codewith/private-artifacts/replacement-readiness-gate.json"
DEFAULT_OUTPUT = ".codewith/private-artifacts/replacement-readiness-verification.json"

EXPECTED_REQUIREMENTS = [
    "active_file_mapping",
    "immutable_bytes_duplicate_preserve",
    "read_extraction_coverage",
    "deferred_media_completion",
    "operator_approval_gates",
    "files_cli_search_index",
    "semantic_rename_readiness",
    "metadata_apply_readiness",
    "adversarial_validation",
]

EXPECTED_SOURCE_LABELS = {
    "stage_dependency_gate",
    "extraction_readiness_gate",
    "extraction_readiness_verification",
    "deferred_media_summary",
    "extraction_approval_dashboard",
    "approval_notes_summary",
    "drive_approval_notes_summary",
    "drive_approval_notes_verification",
    "operator_approval_blocker_report",
    "search_index_runtime_summary",
    "llm_campaign_results_summary",
    "adversarial_review_results",
}

DEFAULT_SOURCE_PATHS = {
    "stage_dependency_gate": ".codewith/private-artifacts/stage-dependency-gate.json",
    "extraction_readiness_gate": ".codewith/private-artifacts/extraction-lane-readiness-gate.json",
    "extraction_readiness_verification": ".codewith/private-artifacts/extraction-lane-readiness-verification.json",
    "deferred_media_summary": ".codewith/private-artifacts/deferred-media-completion/deferred-media-completion-summary.json",
    "extraction_approval_dashboard": ".codewith/private-artifacts/extraction-approval-dashboard.json",
    "approval_notes_summary": ".codewith/private-artifacts/operator-approvals/approval-notes-summary.json",
    "drive_approval_notes_summary": ".codewith/private-artifacts/drive-approval/drive-approval-notes-summary.json",
    "drive_approval_notes_verification": ".codewith/private-artifacts/drive-approval/drive-approval-notes-verification.json",
    "operator_approval_blocker_report": ".codewith/private-artifacts/operator-approval-blocker-report.json",
    "search_index_runtime_summary": ".codewith/private-artifacts/search-index-nonmedia-plan/unapproved-execute-summary.json",
    "llm_campaign_results_summary": ".codewith/private-artifacts/llm-campaigns/sanitized-one-job/collected-results/campaign-results-summary.json",
    "adversarial_review_results": ".codewith/private-artifacts/adversarial-review/adversarial-review-results-verification.json",
}

DEFAULT_CYCLIC_SOURCE_LABELS = {"operator_approval_blocker_report", "adversarial_review_results"}

SENSITIVE_PATTERNS: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("json_file_id_key", re.compile(r'"file_id"\s*:')),
    ("private_file_id_value", re.compile(r'\bf_[A-Za-z0-9][A-Za-z0-9_-]{5,}\b')),
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


def requirement_map(gate: dict[str, Any]) -> tuple[list[dict[str, Any]], dict[str, dict[str, Any]]]:
    raw = gate.get("requirements") if isinstance(gate.get("requirements"), list) else []
    requirements = [item for item in raw if isinstance(item, dict)]
    return requirements, {
        str(item.get("key")): item
        for item in requirements
        if isinstance(item.get("key"), str)
    }


def evidence(req: dict[str, Any]) -> dict[str, Any]:
    return req.get("evidence") if isinstance(req.get("evidence"), dict) else {}


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


def verify_gate(
    gate_path: Path,
    *,
    require_ready: bool = False,
    source_paths: dict[str, Path] | None = None,
    allow_cyclic_source_labels: set[str] | None = None,
) -> dict[str, Any]:
    errors: list[str] = []
    warnings: list[str] = []
    gate = load_json(gate_path)
    allow_cyclic_source_labels = set(allow_cyclic_source_labels or set())

    if gate.get("kind") != "open_files_google_drive_replacement_readiness_gate":
        add_error(errors, "invalid_kind")
    if gate.get("version") != 1:
        add_error(errors, "invalid_version")

    marker_counts = scan_text(json.dumps(gate, sort_keys=True))
    if marker_counts:
        add_error(errors, "sensitive_marker_hits")

    source_artifacts = gate.get("source_artifacts") if isinstance(gate.get("source_artifacts"), list) else []
    source_labels = {
        str(item.get("label"))
        for item in source_artifacts
        if isinstance(item, dict) and item.get("label")
    }
    missing_source_labels = sorted(EXPECTED_SOURCE_LABELS - source_labels)
    if missing_source_labels:
        for label in missing_source_labels:
            add_error(errors, "missing_source_artifact", label)
    source_by_label: dict[str, dict[str, Any]] = {}
    for item in source_artifacts:
        if not isinstance(item, dict):
            add_error(errors, "invalid_source_artifact")
            continue
        label = str(item.get("label"))
        if label:
            source_by_label[label] = item
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
    cyclic_stale_labels: list[str] = []
    if source_paths:
        for label, raw_path in sorted(source_paths.items()):
            if label not in EXPECTED_SOURCE_LABELS:
                add_error(errors, "current_source_unexpected_label", label)
                continue
            current_checked_labels.append(label)
            item = source_by_label.get(label)
            if not item:
                add_error(errors, "current_source_not_recorded", label)
                continue
            path = Path(raw_path).expanduser().resolve()
            if not path.exists():
                current_missing_path_labels.append(label)
                if label in allow_cyclic_source_labels:
                    cyclic_stale_labels.append(label)
                    warnings.append(f"cyclic_source_artifact_unavailable:{label}")
                else:
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
            if label in allow_cyclic_source_labels:
                cyclic_stale_labels.append(label)
                warnings.append(f"cyclic_source_artifact_stale:{label}")
                continue
            if not bytes_match:
                add_error(errors, "source_artifact_current_bytes_mismatch", label)
            if not sha_match:
                add_error(errors, "source_artifact_current_sha256_mismatch", label)

    current_source_error_prefixes = (
        "current_source_",
        "source_artifact_current_",
    )
    source_artifact_current_hashes_ok = bool(source_paths) and not any(
        error.startswith(current_source_error_prefixes) for error in errors
    )

    requirements, by_key = requirement_map(gate)
    keys = [item.get("key") for item in requirements]
    if keys != EXPECTED_REQUIREMENTS:
        add_error(errors, "requirement_order_or_set_invalid")
    if len(set(keys)) != len(keys):
        add_error(errors, "duplicate_requirement_keys")

    counts = {"complete": 0, "blocked": 0, "deferred": 0, "missing": 0}
    valid_statuses = set(counts)
    first_incomplete = None
    for item in requirements:
        key = str(item.get("key"))
        status = item.get("status")
        complete = item.get("complete")
        blockers = item.get("blockers")
        item_evidence = item.get("evidence")
        if status not in valid_statuses:
            add_error(errors, "invalid_requirement_status", key)
            continue
        counts[str(status)] += 1
        if first_incomplete is None and status != "complete":
            first_incomplete = key
        if complete is not (status == "complete"):
            add_error(errors, "requirement_complete_flag_inconsistent", key)
        if not isinstance(blockers, list):
            add_error(errors, "requirement_blockers_not_list", key)
        elif status == "complete" and blockers:
            add_error(errors, "complete_requirement_has_blockers", key)
        elif status != "complete" and not blockers:
            add_error(errors, "incomplete_requirement_without_blocker", key)
        if not isinstance(item_evidence, dict):
            add_error(errors, "requirement_evidence_not_object", key)

    summary = gate.get("summary") if isinstance(gate.get("summary"), dict) else {}
    if as_int(summary.get("requirements")) != len(requirements):
        add_error(errors, "summary_requirement_count_mismatch")
    for status, count in counts.items():
        if as_int(summary.get(status)) != count:
            add_error(errors, "summary_status_count_mismatch", status)
    if summary.get("first_incomplete_requirement") != first_incomplete:
        add_error(errors, "first_incomplete_requirement_inconsistent")

    all_complete = bool(requirements) and counts["complete"] == len(requirements)
    expected_gate_status = "ready" if all_complete else "blocked"
    if not all_complete and counts["blocked"] == 0 and counts["deferred"] > 0:
        expected_gate_status = "deferred"
    if gate.get("status") != expected_gate_status:
        add_error(errors, "gate_status_inconsistent")
    if gate.get("approved_to_replace_google_drive") is not (expected_gate_status == "ready"):
        add_error(errors, "approval_flag_inconsistent")
    if require_ready and expected_gate_status != "ready":
        add_error(errors, "require_ready_not_satisfied")

    active = by_key.get("active_file_mapping", {})
    active_evidence = evidence(active)
    expected_extraction_verification_fields = (
        "verification_present",
        "verification_status",
        "verification_gate_status",
        "verification_source_artifacts_present",
        "verification_source_artifacts_current",
        "verification_semantic_projection_current",
        "verification_redaction_ok",
        "verification_current_checked",
        "verification_current_mismatched",
        "verification_current_missing_paths",
        "verification_ok",
    )
    for field in expected_extraction_verification_fields:
        if field not in active_evidence:
            add_error(errors, "active_mapping_verification_evidence_missing", field)
    if active.get("status") == "complete" and as_int(active_evidence.get("active_files")) <= 0:
        add_error(errors, "active_mapping_complete_without_active_files")
    if active.get("status") == "complete" and active_evidence.get("all_active_lanes_explicitly_routed") is not True:
        add_error(errors, "active_mapping_complete_without_routing")
    if active.get("status") == "complete":
        if active_evidence.get("verification_ok") is not True:
            add_error(errors, "active_mapping_complete_without_verification_ok")
        if active_evidence.get("verification_status") != "ok":
            add_error(errors, "active_mapping_complete_without_verification_status_ok")
        if active_evidence.get("verification_source_artifacts_current") is not True:
            add_error(errors, "active_mapping_complete_without_current_verification_sources")
        if active_evidence.get("verification_semantic_projection_current") is not True:
            add_error(errors, "active_mapping_complete_without_current_semantic_projection")
        if active_evidence.get("verification_redaction_ok") is not True:
            add_error(errors, "active_mapping_complete_without_verification_redaction")
        if active_evidence.get("verification_current_checked") is not True:
            add_error(errors, "active_mapping_complete_without_current_verification_check")

    duplicate = by_key.get("immutable_bytes_duplicate_preserve", {})
    duplicate_evidence = evidence(duplicate)
    if duplicate.get("status") == "complete" and duplicate_evidence.get("policy_ok") is not True:
        add_error(errors, "duplicate_policy_complete_without_policy_ok")

    extraction = by_key.get("read_extraction_coverage", {})
    extraction_evidence = evidence(extraction)
    for field in expected_extraction_verification_fields:
        if field not in extraction_evidence:
            add_error(errors, "extraction_verification_evidence_missing", field)
    if extraction_evidence.get("verification_gate_status") != extraction_evidence.get("status"):
        add_error(errors, "extraction_verification_gate_status_mismatch")
    if extraction.get("status") == "complete":
        if extraction_evidence.get("verification_present") is not True:
            add_error(errors, "extraction_complete_without_verification")
        if extraction_evidence.get("verification_status") != "ok":
            add_error(errors, "extraction_complete_without_verification_ok")
        if extraction_evidence.get("verification_ok") is not True:
            add_error(errors, "extraction_complete_without_verification_gate_ok")
        if extraction_evidence.get("verification_source_artifacts_present") is not True:
            add_error(errors, "extraction_complete_without_verification_sources")
        if extraction_evidence.get("verification_source_artifacts_current") is not True:
            add_error(errors, "extraction_complete_without_current_verification_sources")
        if extraction_evidence.get("verification_semantic_projection_current") is not True:
            add_error(errors, "extraction_complete_without_current_semantic_projection")
        if extraction_evidence.get("verification_redaction_ok") is not True:
            add_error(errors, "extraction_complete_without_verification_redaction")
        if extraction_evidence.get("verification_current_checked") is not True:
            add_error(errors, "extraction_complete_without_current_verification_check")
        if as_int(extraction_evidence.get("verification_current_mismatched")) != 0:
            add_error(errors, "extraction_complete_with_stale_verification_sources")
        if as_int(extraction_evidence.get("verification_current_missing_paths")) != 0:
            add_error(errors, "extraction_complete_with_missing_verification_sources")
        if as_int(extraction_evidence.get("pending_lanes")) != 0:
            add_error(errors, "extraction_complete_with_pending_lanes")
        if as_int(extraction_evidence.get("hard_blocker_lanes")) != 0:
            add_error(errors, "extraction_complete_with_hard_blockers")
    elif extraction.get("status") == "blocked" and as_int(extraction_evidence.get("pending_lanes")) == 0 and as_int(extraction_evidence.get("hard_blocker_lanes")) == 0:
        warnings.append("extraction_blocked_without_pending_or_hard_blocker_count")

    media = by_key.get("deferred_media_completion", {})
    media_evidence = evidence(media)
    if media.get("status") == "complete" and as_int(media_evidence.get("unresolved_media_files")) != 0:
        add_error(errors, "media_complete_with_unresolved_files")
    if media.get("status") == "deferred" and media_evidence.get("final_media_pass_required") is not True:
        add_error(errors, "media_deferred_without_final_pass_required")

    approvals = by_key.get("operator_approval_gates", {})
    approvals_evidence = evidence(approvals)
    if approvals.get("status") == "complete":
        if as_int(approvals_evidence.get("approved_approval_notes")) < as_int(approvals_evidence.get("approval_items")):
            add_error(errors, "approvals_complete_without_all_notes")
        if approvals_evidence.get("approval_notes_status") not in {"complete", "approved", "ok"}:
            add_error(errors, "approvals_complete_with_bad_notes_status")
        if approvals_evidence.get("drive_approval_notes_status") != "approved":
            add_error(errors, "approvals_complete_without_drive_notes_approved")
        if approvals_evidence.get("drive_approval_notes_verification_status") != "ok":
            add_error(errors, "approvals_complete_without_drive_notes_verification_ok")
        if as_int(approvals_evidence.get("drive_approved_required_decision_count")) < as_int(approvals_evidence.get("drive_required_decision_count")):
            add_error(errors, "approvals_complete_without_all_drive_notes")
        if as_int(approvals_evidence.get("drive_missing_required_decisions")) != 0:
            add_error(errors, "approvals_complete_with_missing_drive_notes")
        if as_int(approvals_evidence.get("drive_invalid_required_decisions")) != 0:
            add_error(errors, "approvals_complete_with_invalid_drive_notes")

    search = by_key.get("files_cli_search_index", {})
    search_evidence = evidence(search)
    if search.get("status") == "complete":
        if search_evidence.get("scale_readiness_status") != "full_run_verified":
            add_error(errors, "search_complete_without_full_run_verified")
        if as_int(search_evidence.get("remaining_jobs")) != 0:
            add_error(errors, "search_complete_with_remaining_jobs")
        if search_evidence.get("full_run_verified") is not True:
            add_error(errors, "search_complete_without_full_run_flag")

    rename = by_key.get("semantic_rename_readiness", {})
    rename_evidence = evidence(rename)
    if rename.get("status") == "complete":
        if rename_evidence.get("rename_gate_status") != "ok":
            add_error(errors, "rename_complete_without_ok_gate")
        if rename_evidence.get("metadata_apply_ready") is not True:
            add_error(errors, "rename_complete_without_metadata_apply_ready")
        if rename_evidence.get("runtime_attestation_gate_status") != "ok":
            add_error(errors, "rename_complete_without_runtime_attestation")

    metadata = by_key.get("metadata_apply_readiness", {})
    metadata_evidence = evidence(metadata)
    if metadata.get("status") == "complete" and metadata_evidence.get("metadata_apply_ready") is not True:
        add_error(errors, "metadata_complete_without_apply_ready")

    adversarial = by_key.get("adversarial_validation", {})
    adversarial_evidence = evidence(adversarial)
    if adversarial_evidence.get("present") is True and adversarial_evidence.get("freshness_all_input_attestations_match") is not True:
        add_error(errors, "adversarial_present_without_fresh_input_attestations")
    if adversarial.get("status") == "complete":
        if adversarial_evidence.get("approved_to_scale") is not True:
            add_error(errors, "adversarial_complete_without_scale_approval")
        if as_int(adversarial_evidence.get("reviewers_present")) < 2:
            add_error(errors, "adversarial_complete_without_two_reviewers")
        if as_int(adversarial_evidence.get("blockers")) != 0:
            add_error(errors, "adversarial_complete_with_blockers")
        if adversarial_evidence.get("freshness_all_input_attestations_match") is not True:
            add_error(errors, "adversarial_complete_without_fresh_input_attestations")

    gates = {
        "kind_ok": gate.get("kind") == "open_files_google_drive_replacement_readiness_gate",
        "redaction_ok": not marker_counts,
        "source_artifacts_present": not any(error.startswith("source_artifact_not_present") for error in errors),
        "source_artifact_hashes_ok": not any(error.startswith("source_artifact_sha256_invalid") for error in errors),
        "source_artifact_current_hashes_ok": source_artifact_current_hashes_ok if source_paths else None,
        "requirements_complete_set": keys == EXPECTED_REQUIREMENTS,
        "extraction_readiness_verification_consumed": all(
            field in active_evidence and field in extraction_evidence
            for field in expected_extraction_verification_fields
        ),
        "extraction_readiness_verification_ok": extraction_evidence.get("verification_ok"),
        "summary_consistent": not any(
            error.startswith("summary_") or error == "first_incomplete_requirement_inconsistent"
            for error in errors
        ),
        "approval_consistent": "approval_flag_inconsistent" not in errors,
        "status_consistent": "gate_status_inconsistent" not in errors,
        "replacement_ready": gate.get("approved_to_replace_google_drive") is True and expected_gate_status == "ready",
    }

    return {
        "kind": "open_files_replacement_readiness_gate_verification",
        "version": 1,
        "created_at": now_utc(),
        "status": "ok" if not errors else "error",
        "gate_status": gate.get("status"),
        "approved_to_replace_google_drive": gate.get("approved_to_replace_google_drive"),
        "require_ready": require_ready,
        "gates": gates,
        "summary": {
            "requirements": len(requirements),
            "complete": counts["complete"],
            "blocked": counts["blocked"],
            "deferred": counts["deferred"],
            "missing": counts["missing"],
            "first_incomplete_requirement": first_incomplete,
        },
        "source_artifacts": {
            "expected": len(EXPECTED_SOURCE_LABELS),
            "present": len(source_labels & EXPECTED_SOURCE_LABELS),
            "missing": missing_source_labels,
            "current_checked": bool(source_paths),
            "current_checked_labels": current_checked_labels,
            "current_mismatched": sorted(set(current_mismatched_labels)),
            "current_missing_paths": sorted(set(current_missing_path_labels)),
            "cyclic_allowed_stale": sorted(set(cyclic_stale_labels)),
        },
        "sensitive_marker_counts": marker_counts,
        "errors": errors,
        "warnings": warnings,
        "redaction": "aggregate-only verification; no private filenames, file IDs, object keys, source refs, extracted text, transcripts, row payloads, command logs, or secrets",
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Verify final Google Drive replacement readiness gate.")
    parser.add_argument("--gate", default=DEFAULT_GATE)
    parser.add_argument("--output", default=DEFAULT_OUTPUT)
    parser.add_argument("--require-ready", action="store_true")
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
    parser.add_argument(
        "--allow-cyclic-source",
        action="append",
        default=[],
        help="Allow a stale current-source hash for a known cyclic source label.",
    )
    parser.add_argument(
        "--no-default-cyclic-sources",
        action="store_true",
        help="Do not allow the default operator-blocker-report cyclic source warning.",
    )
    args = parser.parse_args()

    source_paths: dict[str, Path] | None = None
    if not args.skip_current_source_check:
        source_paths = resolved_default_source_paths()
        for label, path in args.source:
            source_paths[label] = path
    cyclic_sources = set(args.allow_cyclic_source)
    if not args.no_default_cyclic_sources:
        cyclic_sources.update(DEFAULT_CYCLIC_SOURCE_LABELS)

    result = verify_gate(
        Path(args.gate).expanduser().resolve(),
        require_ready=args.require_ready,
        source_paths=source_paths,
        allow_cyclic_source_labels=cyclic_sources,
    )
    output = Path(args.output).expanduser().resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps({
        "kind": result["kind"],
        "status": result["status"],
        "gate_status": result["gate_status"],
        "approved_to_replace_google_drive": result["approved_to_replace_google_drive"],
        "summary": result["summary"],
        "errors": result["errors"],
        "warnings": result["warnings"],
    }, indent=2, sort_keys=True))
    return 0 if result["status"] == "ok" else 1


if __name__ == "__main__":
    raise SystemExit(main())
