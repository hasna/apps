#!/usr/bin/env python3
"""Verify the aggregate ordered stage dependency gate."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import time
from pathlib import Path
from typing import Any


DEFAULT_GATE = ".codewith/private-artifacts/stage-dependency-gate.json"
DEFAULT_OUTPUT = ".codewith/private-artifacts/stage-dependency-verification.json"

EXPECTED_STAGE_ORDER = [
    "duplicate_preserve_policy",
    "extraction_lane_readiness",
    "deferred_media_final_pass",
    "operator_approval_dashboard",
    "search_index_canary",
    "search_index_full_population",
    "llm_provider_readiness",
    "llm_rename_canary",
    "llm_rename_full_campaign",
    "metadata_apply_readiness",
]

EXPECTED_STAGE_ORDERS = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100]

EXPECTED_SCALE_RULES = {
    "requires_duplicate_policy_attested",
    "requires_extraction_lanes_complete",
    "requires_final_media_pass_for_full_replacement",
    "requires_operator_approval_items_resolved",
    "requires_search_index_canary_and_full_population",
    "requires_llm_provider_readiness",
    "requires_llm_rename_canary_full_campaign_and_runtime_attestation",
    "requires_metadata_apply_after_review_only",
}

EXPECTED_SOURCE_LABELS = {
    "extraction_readiness_gate",
    "extraction_readiness_verification",
    "deferred_media_summary",
    "search_index_runtime_summary",
    "llm_provider_readiness",
    "llm_campaign_results_summary",
    "duplicate_preserve_attestation",
    "extraction_approval_dashboard",
    "drive_approval_notes_summary",
    "drive_approval_notes_verification",
}

DEFAULT_SOURCE_PATHS = {
    "extraction_readiness_gate": ".codewith/private-artifacts/extraction-lane-readiness-gate.json",
    "extraction_readiness_verification": ".codewith/private-artifacts/extraction-lane-readiness-verification.json",
    "deferred_media_summary": ".codewith/private-artifacts/deferred-media-completion/deferred-media-completion-summary.json",
    "search_index_runtime_summary": ".codewith/private-artifacts/search-index-nonmedia-plan/unapproved-execute-summary.json",
    "llm_provider_readiness": ".codewith/private-artifacts/llm-campaigns/sanitized-one-job/provider-readiness.json",
    "llm_campaign_results_summary": ".codewith/private-artifacts/llm-campaigns/sanitized-one-job/collected-results/campaign-results-summary.json",
    "duplicate_preserve_attestation": ".codewith/private-artifacts/search-index-current-plan/duplicate-preserve-attestation.json",
    "extraction_approval_dashboard": ".codewith/private-artifacts/extraction-approval-dashboard.json",
    "drive_approval_notes_summary": ".codewith/private-artifacts/drive-approval/drive-approval-notes-summary.json",
    "drive_approval_notes_verification": ".codewith/private-artifacts/drive-approval/drive-approval-notes-verification.json",
}

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


def stage_map(stages: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    return {
        str(stage.get("key")): stage
        for stage in stages
        if isinstance(stage.get("key"), str)
    }


def evidence(stage: dict[str, Any]) -> dict[str, Any]:
    return stage.get("evidence") if isinstance(stage.get("evidence"), dict) else {}


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
) -> dict[str, Any]:
    errors: list[str] = []
    warnings: list[str] = []
    gate = load_json(gate_path)

    if gate.get("kind") != "open_files_stage_dependency_gate":
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

    stages_raw = gate.get("stages") if isinstance(gate.get("stages"), list) else []
    stages = [item for item in stages_raw if isinstance(item, dict)]
    by_key = stage_map(stages)
    stage_keys = [item.get("key") for item in stages]
    stage_orders = [item.get("order") for item in stages]
    if stage_keys != EXPECTED_STAGE_ORDER:
        add_error(errors, "stage_order_or_set_invalid")
    if stage_orders != EXPECTED_STAGE_ORDERS:
        add_error(errors, "stage_order_numbers_invalid")
    if len(set(stage_keys)) != len(stage_keys):
        add_error(errors, "duplicate_stage_keys")

    valid_statuses = {"complete", "blocked", "deferred"}
    for item in stages:
        key = str(item.get("key"))
        status = item.get("status")
        complete = item.get("complete")
        deferred = item.get("deferred_until_final_pass")
        blockers = item.get("blockers")
        if status not in valid_statuses:
            add_error(errors, "invalid_stage_status", key)
            continue
        if complete is not (status == "complete"):
            add_error(errors, "stage_complete_flag_inconsistent", key)
        if status == "deferred" and deferred is not True:
            add_error(errors, "deferred_stage_flag_inconsistent", key)
        if status == "complete" and deferred is True:
            add_error(errors, "complete_stage_deferred_flag_true", key)
        if not isinstance(blockers, list):
            add_error(errors, "stage_blockers_not_list", key)
        elif status == "complete" and blockers:
            add_error(errors, "complete_stage_has_blockers", key)
        elif status != "complete" and not blockers:
            add_error(errors, "incomplete_stage_without_blocker", key)
        if not isinstance(item.get("evidence"), dict):
            add_error(errors, "stage_evidence_not_object", key)

    blocking = [
        item
        for item in stages
        if item.get("required_for_scale") is True and item.get("complete") is not True
    ]
    hard_blocking = [
        item
        for item in blocking
        if item.get("deferred_until_final_pass") is not True
    ]
    first_blocking_key = blocking[0].get("key") if blocking else None
    first_incomplete_order = next(
        (item.get("order") for item in stages if item.get("complete") is not True),
        None,
    )
    expected_status = "ready_to_scale" if not blocking else "blocked"
    if gate.get("status") != expected_status:
        add_error(errors, "gate_status_inconsistent")
    if gate.get("approved_to_scale") is not (not blocking):
        add_error(errors, "approval_flag_inconsistent")
    if gate.get("first_blocking_stage") != first_blocking_key:
        add_error(errors, "first_blocking_stage_inconsistent")
    if gate.get("current_stage_order") != first_incomplete_order:
        add_error(errors, "current_stage_order_inconsistent")
    if as_int(gate.get("blocking_stage_count")) != len(blocking):
        add_error(errors, "blocking_stage_count_inconsistent")
    if as_int(gate.get("hard_blocking_stage_count")) != len(hard_blocking):
        add_error(errors, "hard_blocking_stage_count_inconsistent")
    if as_int(gate.get("deferred_stage_count")) != sum(1 for item in stages if item.get("status") == "deferred"):
        add_error(errors, "deferred_stage_count_inconsistent")
    if require_ready and blocking:
        add_error(errors, "require_ready_not_satisfied")

    scale_rules = gate.get("scale_rules") if isinstance(gate.get("scale_rules"), dict) else {}
    if set(scale_rules.keys()) != EXPECTED_SCALE_RULES:
        add_error(errors, "scale_rule_set_invalid")
    for key in EXPECTED_SCALE_RULES:
        if scale_rules.get(key) is not True:
            add_error(errors, "scale_rule_not_true", key)

    duplicate = by_key.get("duplicate_preserve_policy", {})
    duplicate_evidence = evidence(duplicate)
    if duplicate.get("status") == "complete" and duplicate_evidence.get("policy_ok") is not True:
        add_error(errors, "duplicate_complete_without_policy_ok")

    extraction = by_key.get("extraction_lane_readiness", {})
    extraction_evidence = evidence(extraction)
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
    if extraction.get("status") == "complete":
        if extraction_evidence.get("full_extraction_complete") is not True:
            add_error(errors, "extraction_complete_without_full_completion")
        if as_int(extraction_evidence.get("pending_lanes")) != 0:
            add_error(errors, "extraction_complete_with_pending_lanes")
        if as_int(extraction_evidence.get("hard_blocker_lanes")) != 0:
            add_error(errors, "extraction_complete_with_hard_blockers")
        if as_int(extraction_evidence.get("sampled_no_usable_lanes")) != 0:
            add_error(errors, "extraction_complete_with_no_usable_lanes")
        if extraction_evidence.get("requires_provider_or_tool_work") is True:
            add_error(errors, "extraction_complete_with_provider_or_tool_work")
        if extraction_evidence.get("final_media_pass_required") is True:
            add_error(errors, "extraction_complete_with_final_media_required")

    media = by_key.get("deferred_media_final_pass", {})
    media_evidence = evidence(media)
    if media.get("status") == "complete":
        if as_int(media_evidence.get("unresolved_media_files")) != 0:
            add_error(errors, "media_complete_with_unresolved_files")
        if media_evidence.get("completion_gate_complete") is not True:
            add_error(errors, "media_complete_without_completion_gate")
    if media.get("status") == "deferred" and media_evidence.get("final_media_pass_required") is not True:
        warnings.append("media_deferred_without_final_media_pass_required")

    approval = by_key.get("operator_approval_dashboard", {})
    approval_evidence = evidence(approval)
    if approval.get("status") == "complete":
        if approval_evidence.get("approval_notes_complete") is not True:
            add_error(errors, "approval_complete_without_notes_complete")
        if as_int(approval_evidence.get("approved_approval_notes")) < as_int(approval_evidence.get("approval_items")):
            add_error(errors, "approval_complete_without_all_notes")
        if as_int(approval_evidence.get("blocked_or_missing_prep_items")) != 0:
            add_error(errors, "approval_complete_with_blocked_prep_items")
        if approval_evidence.get("drive_approval_notes_status") != "approved":
            add_error(errors, "approval_complete_without_drive_notes_approved")
        if approval_evidence.get("drive_approval_notes_verification_status") != "ok":
            add_error(errors, "approval_complete_without_drive_notes_verification_ok")
        if as_int(approval_evidence.get("drive_approved_required_decision_count")) < as_int(approval_evidence.get("drive_required_decision_count")):
            add_error(errors, "approval_complete_without_all_drive_notes")
        if as_int(approval_evidence.get("drive_missing_required_decisions")) != 0:
            add_error(errors, "approval_complete_with_missing_drive_notes")
        if as_int(approval_evidence.get("drive_invalid_required_decisions")) != 0:
            add_error(errors, "approval_complete_with_invalid_drive_notes")

    search_canary = by_key.get("search_index_canary", {})
    search_full = by_key.get("search_index_full_population", {})
    search_evidence = evidence(search_canary)
    if search_canary.get("status") == "complete":
        if search_evidence.get("runtime_attestation_status") != "ok":
            add_error(errors, "search_canary_complete_without_runtime_ok")
        if search_evidence.get("canary_verified") is not True:
            add_error(errors, "search_canary_complete_without_verified_flag")
        if search_evidence.get("search_probe_status") != "ok":
            add_error(errors, "search_canary_complete_without_search_probe_ok")
    full_evidence = evidence(search_full)
    if search_full.get("status") == "complete":
        if full_evidence.get("full_run_verified") is not True:
            add_error(errors, "search_full_complete_without_verified_flag")
        if as_int(full_evidence.get("remaining_jobs")) != 0:
            add_error(errors, "search_full_complete_with_remaining_jobs")
        if full_evidence.get("search_probe_status") != "ok":
            add_error(errors, "search_full_complete_without_search_probe_ok")

    provider = by_key.get("llm_provider_readiness", {})
    provider_evidence = evidence(provider)
    if provider.get("status") == "complete":
        if provider_evidence.get("status") != "ok":
            add_error(errors, "provider_complete_without_ok_status")
        if provider_evidence.get("policy_status") != "ok":
            add_error(errors, "provider_complete_without_policy_ok")
        if provider_evidence.get("schedule_status") != "ok":
            add_error(errors, "provider_complete_without_schedule_ok")
        if as_int(provider_evidence.get("invalid_account_count")) != 0:
            add_error(errors, "provider_complete_with_invalid_accounts")
        for key in ("provider_calls_made", "corpus_bytes_mutated", "s3_objects_mutated", "metadata_rows_mutated", "search_index_rows_mutated"):
            if provider_evidence.get(key) is not False:
                add_error(errors, "provider_complete_with_mutation_or_calls", key)
        if provider_evidence.get("redaction_passed") is not True:
            add_error(errors, "provider_complete_without_redaction_passed")

    llm_canary = by_key.get("llm_rename_canary", {})
    llm_full = by_key.get("llm_rename_full_campaign", {})
    metadata = by_key.get("metadata_apply_readiness", {})
    llm_evidence = evidence(llm_canary)
    if llm_canary.get("status") == "complete":
        if llm_evidence.get("canary_verified") is not True:
            add_error(errors, "llm_canary_complete_without_verified_flag")
        if llm_evidence.get("rename_gate_status") != "ok":
            add_error(errors, "llm_canary_complete_without_rename_ok")
        if llm_evidence.get("runtime_attestation_gate_status") != "ok":
            add_error(errors, "llm_canary_complete_without_runtime_ok")
    full_llm_evidence = evidence(llm_full)
    if llm_full.get("status") == "complete":
        if full_llm_evidence.get("full_run_verified") is not True:
            add_error(errors, "llm_full_complete_without_verified_flag")
        if as_int(full_llm_evidence.get("remaining_jobs")) != 0:
            add_error(errors, "llm_full_complete_with_remaining_jobs")
    metadata_evidence = evidence(metadata)
    if metadata.get("status") == "complete" and metadata_evidence.get("metadata_apply_ready") is not True:
        add_error(errors, "metadata_complete_without_apply_ready")

    gates = {
        "kind_ok": gate.get("kind") == "open_files_stage_dependency_gate",
        "redaction_ok": not marker_counts,
        "source_artifacts_present": not any(error.startswith("source_artifact_not_present") for error in errors),
        "source_artifact_hashes_ok": not any(error.startswith("source_artifact_sha256_invalid") for error in errors),
        "source_artifact_current_hashes_ok": source_artifact_current_hashes_ok if source_paths else None,
        "stage_order_complete_set": stage_keys == EXPECTED_STAGE_ORDER,
        "stage_order_numbers_ok": stage_orders == EXPECTED_STAGE_ORDERS,
        "scale_rules_ok": set(scale_rules.keys()) == EXPECTED_SCALE_RULES and all(scale_rules.get(key) is True for key in EXPECTED_SCALE_RULES),
        "extraction_readiness_verification_consumed": all(field in extraction_evidence for field in expected_extraction_verification_fields),
        "extraction_readiness_verification_ok": extraction_evidence.get("verification_ok"),
        "counts_consistent": not any(error.endswith("_count_inconsistent") for error in errors),
        "first_blocker_consistent": "first_blocking_stage_inconsistent" not in errors,
        "status_consistent": "gate_status_inconsistent" not in errors,
        "approval_consistent": "approval_flag_inconsistent" not in errors,
        "scale_ready": gate.get("approved_to_scale") is True and not blocking,
    }

    return {
        "kind": "open_files_stage_dependency_gate_verification",
        "version": 1,
        "created_at": now_utc(),
        "status": "ok" if not errors else "error",
        "gate_status": gate.get("status"),
        "approved_to_scale": gate.get("approved_to_scale"),
        "require_ready": require_ready,
        "gates": gates,
        "summary": {
            "stages": len(stages),
            "blocking_stage_count": len(blocking),
            "hard_blocking_stage_count": len(hard_blocking),
            "deferred_stage_count": sum(1 for item in stages if item.get("status") == "deferred"),
            "first_blocking_stage": first_blocking_key,
            "current_stage_order": first_incomplete_order,
            "search_index_canary_stage_status": search_canary.get("status"),
            "search_index_full_stage_status": search_full.get("status"),
            "search_index_runtime_attestation_status": search_evidence.get("runtime_attestation_status"),
            "search_index_scale_readiness_status": search_evidence.get("scale_readiness_status"),
            "search_index_search_probe_status": search_evidence.get("search_probe_status"),
            "search_index_search_probe_probes": search_evidence.get("search_probe_probes"),
            "search_index_search_probe_latency_budget_ms": search_evidence.get("search_probe_latency_budget_ms"),
            "search_index_search_probe_max_latency_ms": search_evidence.get("search_probe_max_latency_ms"),
            "search_index_remaining_jobs": full_evidence.get("remaining_jobs"),
            "llm_rename_canary_stage_status": llm_canary.get("status"),
            "llm_rename_full_stage_status": llm_full.get("status"),
            "llm_rename_campaign_status": llm_evidence.get("status"),
            "llm_rename_canary_verified": llm_evidence.get("canary_verified"),
            "llm_rename_full_run_verified": full_llm_evidence.get("full_run_verified"),
            "llm_rename_scale_readiness_status": llm_evidence.get("scale_readiness_status"),
            "llm_rename_gate_status": llm_evidence.get("rename_gate_status"),
            "llm_rename_runtime_attestation_gate_status": llm_evidence.get("runtime_attestation_gate_status"),
            "llm_rename_remaining_jobs": full_llm_evidence.get("remaining_jobs"),
            "metadata_apply_stage_status": metadata.get("status"),
            "metadata_apply_ready": metadata_evidence.get("metadata_apply_ready"),
        },
        "source_artifacts": {
            "expected": len(EXPECTED_SOURCE_LABELS),
            "present": len(source_labels & EXPECTED_SOURCE_LABELS),
            "missing": missing_source_labels,
            "current_checked": bool(source_paths),
            "current_checked_labels": current_checked_labels,
            "current_mismatched": sorted(set(current_mismatched_labels)),
            "current_missing_paths": sorted(set(current_missing_path_labels)),
        },
        "stage_keys": stage_keys,
        "sensitive_marker_counts": marker_counts,
        "errors": errors,
        "warnings": warnings,
        "redaction": "aggregate-only verification; no private filenames, file IDs, object keys, source refs, extracted text, transcripts, row payloads, command logs, or secrets",
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Verify ordered stage dependency gate.")
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
    args = parser.parse_args()

    source_paths: dict[str, Path] | None = None
    if not args.skip_current_source_check:
        source_paths = resolved_default_source_paths()
        for label, path in args.source:
            source_paths[label] = path

    result = verify_gate(
        Path(args.gate).expanduser().resolve(),
        require_ready=args.require_ready,
        source_paths=source_paths,
    )
    output = Path(args.output).expanduser().resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps({
        "kind": result["kind"],
        "status": result["status"],
        "gate_status": result["gate_status"],
        "approved_to_scale": result["approved_to_scale"],
        "summary": result["summary"],
        "errors": result["errors"],
        "warnings": result["warnings"],
    }, indent=2, sort_keys=True))
    return 0 if result["status"] == "ok" else 1


if __name__ == "__main__":
    raise SystemExit(main())
