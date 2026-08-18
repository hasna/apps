#!/usr/bin/env python3
"""Verify aggregate-safe adversarial review packet readiness.

This is a preflight for reviewer agents. It checks packet structure, source
artifact coverage, approval dashboard readiness, immutable/non-mutation
invariants, generated reviewer files, and sensitive-marker absence.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import time
from pathlib import Path
from typing import Any


DEFAULT_PACKET = ".codewith/private-artifacts/adversarial-review/adversarial-review-packet.json"
DEFAULT_OUTPUT = ".codewith/private-artifacts/adversarial-review/adversarial-review-verification.json"

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

REQUIRED_ARTIFACT_KEYS = {
    "stage_dependency_gate",
    "stage_dependency_verification",
    "search_index",
    "llm_campaign",
    "llm_provider_readiness",
    "llm_campaign_results",
    "deferred_media_completion",
    "extraction_readiness",
    "extraction_readiness_verification",
    "extraction_worker_image",
    "extraction_approval_dashboard",
    "approval_request_packet",
    "approval_request_verification",
    "replacement_readiness_gate",
    "locked_worker_bundle",
}

REQUIRED_SOURCE_LABELS = {
    "search_index_approval_packet",
    "search_index_validation",
    "search_index_runtime_summary",
    "duplicate_preserve_attestation",
    "stage_dependency_gate",
    "stage_dependency_verification",
    "llm_campaign_plan",
    "llm_campaign_runtime_summary",
    "llm_provider_readiness",
    "llm_campaign_results_summary",
    "deferred_media_summary",
    "extraction_readiness_gate",
    "extraction_readiness_verification",
    "extraction_worker_image_verification",
    "extraction_approval_dashboard",
    "approval_request_packet",
    "approval_request_packet_verification",
    "replacement_readiness_gate",
}

DEFAULT_SOURCE_PATHS = {
    "search_index_approval_packet": ".codewith/private-artifacts/search-index-current-plan/search-index-approval-packet.json",
    "search_index_validation": ".codewith/private-artifacts/search-index-current-plan/search-index-plan-validation.json",
    "search_index_runtime_summary": ".codewith/private-artifacts/search-index-nonmedia-plan/unapproved-execute-summary.json",
    "duplicate_preserve_attestation": ".codewith/private-artifacts/search-index-current-plan/duplicate-preserve-attestation.json",
    "stage_dependency_gate": ".codewith/private-artifacts/stage-dependency-gate.json",
    "stage_dependency_verification": ".codewith/private-artifacts/stage-dependency-verification.json",
    "llm_campaign_plan": ".codewith/private-artifacts/llm-campaigns/sanitized-one-job/campaign-plan.json",
    "llm_campaign_runtime_summary": ".codewith/private-artifacts/llm-campaigns/sanitized-one-job/unapproved-execute-summary.json",
    "llm_provider_readiness": ".codewith/private-artifacts/llm-campaigns/sanitized-one-job/provider-readiness.json",
    "llm_campaign_results_summary": ".codewith/private-artifacts/llm-campaigns/sanitized-one-job/collected-results/campaign-results-summary.json",
    "deferred_media_summary": ".codewith/private-artifacts/deferred-media-completion/deferred-media-completion-summary.json",
    "extraction_readiness_gate": ".codewith/private-artifacts/extraction-lane-readiness-gate.json",
    "extraction_readiness_verification": ".codewith/private-artifacts/extraction-lane-readiness-verification.json",
    "extraction_worker_image_verification": ".codewith/private-artifacts/extraction-worker-image-verification.json",
    "extraction_approval_dashboard": ".codewith/private-artifacts/extraction-approval-dashboard.json",
    "approval_request_packet": ".codewith/private-artifacts/operator-approvals/approval-request-packet.json",
    "approval_request_packet_verification": ".codewith/private-artifacts/operator-approvals/approval-request-packet-verification.json",
    "replacement_readiness_gate": ".codewith/private-artifacts/replacement-readiness-gate.json",
    "locked_worker_bundle/bundle-summary.json": ".codewith/private-artifacts/locked-worker-bundles/mimo-one-direct-api/bundle-summary.json",
    "locked_worker_bundle/command.json": ".codewith/private-artifacts/locked-worker-bundles/mimo-one-direct-api/command.json",
    "locked_worker_bundle/environment-policy.json": ".codewith/private-artifacts/locked-worker-bundles/mimo-one-direct-api/environment-policy.json",
    "locked_worker_bundle/bundle-integrity.json": ".codewith/private-artifacts/locked-worker-bundles/mimo-one-direct-api/bundle-integrity.json",
    "locked_worker_bundle/locked-worker-bundle-verification.json": ".codewith/private-artifacts/locked-worker-bundles/mimo-one-direct-api/locked-worker-bundle-verification.json",
    "locked_worker_bundle/prompt.md": ".codewith/private-artifacts/locked-worker-bundles/mimo-one-direct-api/prompt.md",
    "locked_worker_bundle/run-worker.sh": ".codewith/private-artifacts/locked-worker-bundles/mimo-one-direct-api/run-worker.sh",
}

GENERATED_REVIEW_FILES = [
    "adversarial-review-packet.json",
    "reviewer-final.schema.json",
    "reviewer-a-prompt.md",
    "reviewer-b-prompt.md",
    "reviewer-a-input-attestation.json",
    "reviewer-b-input-attestation.json",
    "reviewer-a-direct-prompt.md",
    "reviewer-b-direct-prompt.md",
]

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

EXPECTED_REPLACEMENT_REQUIREMENTS = [
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


def now_utc() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_json(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise SystemExit(f"expected JSON object: {path}")
    return value


def scan_text(text: str) -> dict[str, int]:
    counts: dict[str, int] = {}
    for code, pattern in SENSITIVE_PATTERNS:
        count = len(pattern.findall(text))
        if count:
            counts[code] = count
    return counts


def scan_file(path: Path) -> dict[str, int]:
    try:
        return scan_text(path.read_text(encoding="utf-8"))
    except UnicodeDecodeError:
        return {"non_utf8_artifact": 1}


def bool_is(value: Any, expected: bool) -> bool:
    return isinstance(value, bool) and value is expected


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


def generated_file_checks(packet_dir: Path) -> list[dict[str, Any]]:
    checks: list[dict[str, Any]] = []
    for name in GENERATED_REVIEW_FILES:
        path = packet_dir / name
        checks.append({
            "file": name,
            "present": path.exists(),
            "bytes": path.stat().st_size if path.exists() else 0,
            "sha256": file_sha256(path) if path.exists() else None,
            "sensitive_marker_counts": scan_file(path) if path.exists() else {},
        })
    return checks


def verify_packet(
    packet_path: Path,
    min_source_artifacts: int,
    min_ready_approval_items: int,
    *,
    source_paths: dict[str, Path] | None = None,
) -> dict[str, Any]:
    errors: list[str] = []
    warnings: list[str] = []
    packet = load_json(packet_path)
    packet_dir = packet_path.parent

    if packet.get("kind") != "open_files_adversarial_review_packet":
        errors.append("invalid_kind")

    output_scan = scan_text(json.dumps(packet, sort_keys=True))
    declared_scan = ((packet.get("redaction_contract") or {}).get("output_sensitive_marker_counts") or {})
    if output_scan:
        errors.append("packet_sensitive_marker_hits")
    if declared_scan:
        errors.append("declared_redaction_counts_nonempty")

    artifacts = packet.get("artifacts") if isinstance(packet.get("artifacts"), dict) else {}
    missing_artifacts = sorted(REQUIRED_ARTIFACT_KEYS - set(artifacts.keys()))
    if missing_artifacts:
        errors.extend(f"missing_artifact:{key}" for key in missing_artifacts)

    current_state = packet.get("current_state") if isinstance(packet.get("current_state"), dict) else {}
    for key in (
        "canonical_s3_keys_immutable",
        "metadata_only_organization",
        "legacy_sources_preserved_until_final_audit",
        "audio_video_deferred_until_end",
        "scaled_agent_execution_requires_approval",
    ):
        if current_state.get(key) is not True:
            errors.append(f"invariant_not_true:{key}")

    source_entries = packet.get("source_artifact_checks") if isinstance(packet.get("source_artifact_checks"), list) else []
    if len(source_entries) < min_source_artifacts:
        errors.append("too_few_source_artifacts")
    labels = {entry.get("label") for entry in source_entries if isinstance(entry, dict)}
    missing_labels = sorted(REQUIRED_SOURCE_LABELS - labels)
    if missing_labels:
        errors.extend(f"missing_source_label:{label}" for label in missing_labels)
    source_by_label: dict[str, dict[str, Any]] = {}
    for entry in source_entries:
        if not isinstance(entry, dict):
            errors.append("invalid_source_artifact_entry")
            continue
        label = str(entry.get("label") or "")
        if label:
            source_by_label[label] = entry
        if entry.get("present") is not True:
            continue
        if int(entry.get("bytes") or 0) <= 0:
            errors.append(f"source_artifact_bytes_invalid:{label}")
        sha = entry.get("sha256")
        if not isinstance(sha, str) or not re.fullmatch(r"[a-f0-9]{64}", sha):
            errors.append(f"source_artifact_sha256_invalid:{label}")
    source_sensitive = [
        entry.get("label")
        for entry in source_entries
        if isinstance(entry, dict) and entry.get("sensitive_marker_counts")
    ]
    if source_sensitive:
        errors.append("source_artifact_sensitive_marker_hits")
    missing_sources = [
        entry.get("label")
        for entry in source_entries
        if isinstance(entry, dict) and not entry.get("present")
    ]
    if missing_sources:
        errors.append("source_artifacts_missing")

    current_checked_labels: list[str] = []
    current_mismatched_labels: list[str] = []
    current_missing_path_labels: list[str] = []
    if source_paths:
        for label, raw_path in sorted(source_paths.items()):
            if label not in labels:
                errors.append(f"current_source_not_recorded:{label}")
                continue
            current_checked_labels.append(label)
            entry = source_by_label.get(label)
            if not entry:
                errors.append(f"current_source_not_recorded:{label}")
                continue
            path = Path(raw_path).expanduser().resolve()
            if not path.exists():
                current_missing_path_labels.append(label)
                errors.append(f"source_artifact_current_path_missing:{label}")
                continue
            expected_bytes = int(entry.get("bytes") or 0)
            expected_sha = entry.get("sha256")
            actual_bytes = path.stat().st_size
            actual_sha = file_sha256(path)
            bytes_match = expected_bytes == actual_bytes
            sha_match = expected_sha == actual_sha
            if bytes_match and sha_match:
                continue
            current_mismatched_labels.append(label)
            if not bytes_match:
                errors.append(f"source_artifact_current_bytes_mismatch:{label}")
            if not sha_match:
                errors.append(f"source_artifact_current_sha256_mismatch:{label}")

    source_artifact_current_hashes_ok = bool(source_paths) and not any(
        error.startswith("current_source_") or error.startswith("source_artifact_current_")
        for error in errors
    )

    stage_gate = artifacts.get("stage_dependency_gate") if isinstance(artifacts.get("stage_dependency_gate"), dict) else {}
    stage_items = stage_gate.get("stages") if isinstance(stage_gate.get("stages"), list) else []
    stage_keys = [item.get("key") for item in stage_items if isinstance(item, dict)]
    stage_orders = [item.get("order") for item in stage_items if isinstance(item, dict)]
    stage_ordered = stage_keys == EXPECTED_STAGE_ORDER and stage_orders == sorted(stage_orders)
    blocking_stage = next(
        (
            item.get("key")
            for item in stage_items
            if isinstance(item, dict)
            and item.get("required_for_scale") is True
            and item.get("complete") is not True
        ),
        None,
    )
    first_blocker_consistent = stage_gate.get("first_blocking_stage") == blocking_stage
    any_incomplete_required = blocking_stage is not None
    approved_consistent = (
        stage_gate.get("approved_to_scale") is False
        if any_incomplete_required
        else stage_gate.get("approved_to_scale") is True
    )
    scale_rules = stage_gate.get("scale_rules") if isinstance(stage_gate.get("scale_rules"), dict) else {}
    if stage_gate.get("present") is not True:
        errors.append("stage_dependency_gate_not_present")
    if not stage_ordered:
        errors.append("stage_dependency_order_invalid")
    if not first_blocker_consistent:
        errors.append("stage_dependency_first_blocker_inconsistent")
    if not approved_consistent:
        errors.append("stage_dependency_approval_inconsistent")
    for key in (
        "requires_duplicate_policy_attested",
        "requires_extraction_lanes_complete",
        "requires_final_media_pass_for_full_replacement",
        "requires_operator_approval_items_resolved",
        "requires_search_index_canary_and_full_population",
        "requires_llm_provider_readiness",
        "requires_llm_rename_canary_full_campaign_and_runtime_attestation",
        "requires_metadata_apply_after_review_only",
    ):
        if scale_rules.get(key) is not True:
            errors.append(f"stage_dependency_scale_rule_not_true:{key}")

    stage_verification = artifacts.get("stage_dependency_verification") if isinstance(artifacts.get("stage_dependency_verification"), dict) else {}
    stage_verification_gates = stage_verification.get("gates") if isinstance(stage_verification.get("gates"), dict) else {}
    stage_verification_summary = stage_verification.get("summary") if isinstance(stage_verification.get("summary"), dict) else {}
    if stage_verification.get("present") is not True:
        errors.append("stage_dependency_verification_not_present")
    if stage_verification.get("status") != "ok":
        errors.append("stage_dependency_verification_not_ok")
    if stage_verification.get("gate_status") != stage_gate.get("status"):
        errors.append("stage_dependency_verification_status_mismatch")
    if stage_verification.get("approved_to_scale") != stage_gate.get("approved_to_scale"):
        errors.append("stage_dependency_verification_approval_mismatch")
    if stage_verification_summary.get("first_blocking_stage") != stage_gate.get("first_blocking_stage"):
        errors.append("stage_dependency_verification_first_blocker_mismatch")
    if stage_verification_summary.get("blocking_stage_count") != stage_gate.get("blocking_stage_count"):
        errors.append("stage_dependency_verification_blocking_count_mismatch")
    if stage_verification_summary.get("hard_blocking_stage_count") != stage_gate.get("hard_blocking_stage_count"):
        errors.append("stage_dependency_verification_hard_blocking_count_mismatch")
    if stage_verification_summary.get("deferred_stage_count") != stage_gate.get("deferred_stage_count"):
        errors.append("stage_dependency_verification_deferred_count_mismatch")
    for key in (
        "stage_order_complete_set",
        "stage_order_numbers_ok",
        "scale_rules_ok",
        "counts_consistent",
        "first_blocker_consistent",
        "status_consistent",
        "approval_consistent",
        "source_artifact_current_hashes_ok",
    ):
        if stage_verification_gates.get(key) is not True:
            errors.append(f"stage_dependency_verification_gate_not_true:{key}")

    dashboard = artifacts.get("extraction_approval_dashboard") if isinstance(artifacts.get("extraction_approval_dashboard"), dict) else {}
    dashboard_overall = dashboard.get("overall") if isinstance(dashboard.get("overall"), dict) else {}
    if dashboard.get("status") != "ready_for_operator_review":
        errors.append("dashboard_not_ready_for_operator_review")
    if dashboard_overall.get("ready_for_operator_review") is not True:
        errors.append("dashboard_overall_not_ready")
    if int(dashboard_overall.get("ready_approval_items") or 0) < min_ready_approval_items:
        errors.append("dashboard_ready_approval_items_below_minimum")
    for key in ("corpus_bytes_mutated", "s3_objects_mutated", "metadata_rows_mutated"):
        if dashboard_overall.get(key) is not False:
            errors.append(f"dashboard_non_mutation_not_false:{key}")
    if dashboard_overall.get("final_media_pass_deferred") is not True:
        errors.append("dashboard_media_not_deferred")

    approval_request = artifacts.get("approval_request_packet") if isinstance(artifacts.get("approval_request_packet"), dict) else {}
    approval_request_verification = artifacts.get("approval_request_verification") if isinstance(artifacts.get("approval_request_verification"), dict) else {}
    approval_request_nonmutation = approval_request.get("non_mutation_attestation") if isinstance(approval_request.get("non_mutation_attestation"), dict) else {}
    approval_request_redaction = approval_request.get("redaction_check") if isinstance(approval_request.get("redaction_check"), dict) else {}
    approval_request_verification_gates = approval_request_verification.get("gates") if isinstance(approval_request_verification.get("gates"), dict) else {}
    if approval_request.get("present") is not True:
        errors.append("approval_request_packet_not_present")
    if approval_request.get("status") != "templates_ready":
        errors.append("approval_request_packet_not_templates_ready")
    if int(approval_request.get("template_count") or 0) < 5:
        errors.append("approval_request_packet_template_count_below_minimum")
    if approval_request_redaction.get("passed") is not True:
        errors.append("approval_request_packet_redaction_not_passed")
    for key, expected in (
        ("templates_only", True),
        ("approvals_granted", False),
        ("execution_launched", False),
        ("corpus_bytes_mutated", False),
        ("s3_objects_mutated", False),
        ("metadata_rows_mutated", False),
    ):
        if approval_request_nonmutation.get(key) is not expected:
            errors.append(f"approval_request_nonmutation_mismatch:{key}")
    if approval_request_verification.get("present") is not True:
        errors.append("approval_request_verification_not_present")
    if approval_request_verification.get("status") != "ok":
        errors.append("approval_request_verification_not_ok")
    if approval_request_verification.get("packet_status") != approval_request.get("status"):
        errors.append("approval_request_verification_packet_status_inconsistent")
    if int(approval_request_verification.get("template_count") or 0) != int(approval_request.get("template_count") or 0):
        errors.append("approval_request_verification_template_count_inconsistent")
    for key in (
        "kind_ok",
        "status_templates_ready",
        "redaction_ok",
        "non_mutation_attested",
        "source_status_ok",
        "source_artifacts_present",
        "source_artifact_hashes_ok",
        "source_artifact_current_hashes_ok",
        "required_decisions_present",
        "template_count_consistent",
        "template_hashes_valid",
        "template_files_present",
        "command_hashes_valid",
        "remediation_links_valid",
    ):
        if approval_request_verification_gates.get(key) is not True:
            errors.append(f"approval_request_verification_gate_not_true:{key}")

    extraction_readiness = artifacts.get("extraction_readiness") if isinstance(artifacts.get("extraction_readiness"), dict) else {}
    extraction_gate = extraction_readiness.get("gate") if isinstance(extraction_readiness.get("gate"), dict) else {}
    extraction_verification = artifacts.get("extraction_readiness_verification") if isinstance(artifacts.get("extraction_readiness_verification"), dict) else {}
    extraction_verification_checks = extraction_verification.get("checks") if isinstance(extraction_verification.get("checks"), dict) else {}
    extraction_verification_sources = extraction_verification.get("source_artifacts") if isinstance(extraction_verification.get("source_artifacts"), dict) else {}
    if extraction_gate.get("all_active_lanes_explicitly_routed") is not True:
        errors.append("extraction_lanes_not_explicitly_routed")
    if extraction_gate.get("no_failed_smoke_samples") is not True:
        errors.append("extraction_failed_smoke_samples_present")
    if extraction_gate.get("no_not_implemented_samples") is not True:
        errors.append("extraction_not_implemented_samples_present")
    if extraction_gate.get("full_extraction_complete") is True:
        warnings.append("extraction_gate_reports_full_completion")
    if extraction_verification.get("present") is not True:
        errors.append("extraction_readiness_verification_not_present")
    if extraction_verification.get("status") != "ok":
        errors.append("extraction_readiness_verification_not_ok")
    if extraction_verification.get("gate_status") != extraction_readiness.get("status"):
        errors.append("extraction_readiness_verification_gate_status_mismatch")
    for key in (
        "source_artifacts_present",
        "source_artifacts_current",
        "semantic_projection_current",
        "redaction_ok",
        "expected_lanes_present",
        "totals_consistent",
        "gate_flags_consistent",
    ):
        if extraction_verification_checks.get(key) is not True:
            errors.append(f"extraction_readiness_verification_check_not_true:{key}")
    if extraction_verification_sources.get("current_checked") is not True:
        errors.append("extraction_readiness_verification_current_check_missing")
    if extraction_verification_sources.get("current_mismatched"):
        errors.append("extraction_readiness_verification_current_mismatched_sources")
    if extraction_verification_sources.get("current_missing_paths"):
        errors.append("extraction_readiness_verification_current_missing_sources")

    worker_image = artifacts.get("extraction_worker_image") if isinstance(artifacts.get("extraction_worker_image"), dict) else {}
    if worker_image.get("static_status") != "ok":
        errors.append("worker_image_static_not_ok")
    if worker_image.get("docker_status") not in {"permission_denied", "available", "daemon_unavailable", "not_found"}:
        warnings.append("worker_image_unexpected_docker_status")
    worker_policy = worker_image.get("worker_runtime_policy") if isinstance(worker_image.get("worker_runtime_policy"), dict) else {}
    if worker_policy.get("present") is not True:
        errors.append("worker_image_runtime_policy_missing")
    if worker_policy.get("status") != "ok":
        errors.append("worker_image_runtime_policy_not_ok")
    if worker_policy.get("network_mode") != "none" or worker_policy.get("network_disabled") is not True:
        errors.append("worker_image_runtime_network_not_disabled")
    for key in (
        "provider_egress_allowed",
        "arbitrary_url_fetch_allowed",
        "google_drive_access_allowed",
        "s3_object_access_allowed",
        "db_access_allowed",
        "corpus_mounts_allowed",
        "secret_env_allowed",
        "private_values_in_command",
    ):
        if worker_policy.get(key) is not False:
            errors.append(f"worker_image_runtime_policy_allows:{key}")
    for key in (
        "read_only_rootfs",
        "cap_drop_all",
        "no_new_privileges",
        "command_logs_hashed_only",
    ):
        if worker_policy.get(key) is not True:
            errors.append(f"worker_image_runtime_policy_missing:{key}")

    llm_campaign = artifacts.get("llm_campaign") if isinstance(artifacts.get("llm_campaign"), dict) else {}
    campaign_direct_policy = llm_campaign.get("direct_provider_policy_attestation") if isinstance(llm_campaign.get("direct_provider_policy_attestation"), dict) else {}
    campaign_allowed_hosts = campaign_direct_policy.get("allowed_hosts") if isinstance(campaign_direct_policy.get("allowed_hosts"), list) else []

    locked_bundle = artifacts.get("locked_worker_bundle") if isinstance(artifacts.get("locked_worker_bundle"), dict) else {}
    locked_verification = locked_bundle.get("verification") if isinstance(locked_bundle.get("verification"), dict) else {}
    locked_command_policy = locked_bundle.get("command_policy") if isinstance(locked_bundle.get("command_policy"), dict) else {}
    locked_integrity = locked_bundle.get("integrity") if isinstance(locked_bundle.get("integrity"), dict) else {}
    locked_gates = locked_verification.get("gates") if isinstance(locked_verification.get("gates"), dict) else {}
    locked_egress_policy_ok = True
    if locked_bundle.get("present") is True and locked_verification.get("status") != "ok":
        errors.append("locked_worker_bundle_verification_not_ok")
    if locked_bundle.get("present") is True:
        for key in (
            "bundle_validation_ok",
            "no_sandbox_bypass",
            "skip_git_repo_check_policy_valid",
            "cwd_confined_to_bundle",
            "output_confined_to_output_dir",
            "schema_confined_to_input_dir",
            "sandbox_mode_limited",
            "minimal_env_allowlist",
            "no_secret_env_allowed",
            "controlled_home_tmp",
            "runner_uses_env_i",
            "execution_surface_attested",
            "network_egress_policy_attested",
            "only_declared_writable_runtime_dirs",
        ):
            if locked_gates.get(key) is not True:
                errors.append(f"locked_worker_bundle_gate_not_true:{key}")
        command_egress = locked_command_policy.get("network_egress_policy") if isinstance(locked_command_policy.get("network_egress_policy"), dict) else {}
        integrity_egress = locked_integrity.get("network_egress_policy") if isinstance(locked_integrity.get("network_egress_policy"), dict) else {}
        verification_egress = locked_verification.get("network_egress_policy") if isinstance(locked_verification.get("network_egress_policy"), dict) else {}
        for label, egress_policy in (
            ("command", command_egress),
            ("integrity", integrity_egress),
            ("verification", verification_egress),
        ):
            hosts = egress_policy.get("provider_endpoint_hosts")
            safe_hosts = (
                isinstance(hosts, list)
                and len(hosts) > 0
                and all(isinstance(host, str) and host and "/" not in host and "*" not in host for host in hosts)
            )
            if egress_policy.get("mode") != "provider-egress-allowlist":
                locked_egress_policy_ok = False
                errors.append(f"locked_worker_bundle_egress_policy_invalid:{label}:mode")
            if egress_policy.get("deny_by_default") is not True:
                locked_egress_policy_ok = False
                errors.append(f"locked_worker_bundle_egress_policy_invalid:{label}:deny_by_default")
            if not safe_hosts:
                locked_egress_policy_ok = False
                errors.append(f"locked_worker_bundle_egress_policy_invalid:{label}:provider_endpoint_hosts")
            if egress_policy.get("allowed_purposes") != ["model_inference_only"]:
                locked_egress_policy_ok = False
                errors.append(f"locked_worker_bundle_egress_policy_invalid:{label}:allowed_purposes")
            if egress_policy.get("provider_data_collection") != "deny":
                locked_egress_policy_ok = False
                errors.append(f"locked_worker_bundle_egress_policy_invalid:{label}:provider_data_collection")
            for key in (
                "arbitrary_url_fetch_allowed",
                "google_drive_access_allowed",
                "raw_file_bytes_allowed",
                "s3_object_access_allowed",
                "secret_values_in_payload_allowed",
            ):
                if egress_policy.get(key) is not False:
                    locked_egress_policy_ok = False
                    errors.append(f"locked_worker_bundle_egress_policy_invalid:{label}:{key}")
        if command_egress != integrity_egress:
            locked_egress_policy_ok = False
            errors.append("locked_worker_bundle_egress_policy_command_integrity_mismatch")
        if campaign_allowed_hosts:
            command_hosts = command_egress.get("provider_endpoint_hosts") if isinstance(command_egress.get("provider_endpoint_hosts"), list) else []
            if sorted(str(host) for host in command_hosts) != sorted(str(host) for host in campaign_allowed_hosts):
                locked_egress_policy_ok = False
                errors.append("locked_worker_bundle_egress_policy_campaign_host_mismatch")
        if locked_command_policy.get("dangerous_bypass") is not False:
            errors.append("locked_worker_bundle_dangerous_bypass")
        if locked_command_policy.get("skip_git_repo_check") is True:
            if locked_command_policy.get("skip_git_repo_check_attested") is not True:
                errors.append("locked_worker_bundle_skip_git_not_attested")
            if not locked_command_policy.get("skip_git_repo_check_justification"):
                errors.append("locked_worker_bundle_skip_git_missing_justification")
            if locked_integrity.get("skip_git_repo_check") is not True:
                errors.append("locked_worker_bundle_skip_git_integrity_mismatch")
        elif locked_command_policy.get("skip_git_repo_check") is not False:
            errors.append("locked_worker_bundle_skip_git_policy_missing")

    provider_readiness = artifacts.get("llm_provider_readiness") if isinstance(artifacts.get("llm_provider_readiness"), dict) else {}
    provider_policy = provider_readiness.get("direct_provider_policy_gate") if isinstance(provider_readiness.get("direct_provider_policy_gate"), dict) else {}
    provider_policy_checks = provider_policy.get("checks") if isinstance(provider_policy.get("checks"), dict) else {}
    provider_schedule = provider_readiness.get("schedule_gate") if isinstance(provider_readiness.get("schedule_gate"), dict) else {}
    provider_nonmutation = provider_readiness.get("non_mutation_attestation") if isinstance(provider_readiness.get("non_mutation_attestation"), dict) else {}
    provider_redaction = provider_readiness.get("redaction_check") if isinstance(provider_readiness.get("redaction_check"), dict) else {}
    if provider_readiness.get("present") is not True:
        errors.append("llm_provider_readiness_not_present")
    if provider_readiness.get("status") != "ok":
        errors.append("llm_provider_readiness_not_ok")
    if provider_policy.get("status") != "ok":
        errors.append("llm_provider_policy_not_ok")
    for key in (
        "status_ok",
        "real_file_ids_not_sent",
        "raw_file_bytes_not_sent",
        "raw_extracts_not_sent",
        "secret_values_not_sent",
        "provider_data_collection_denied",
        "provider_data_collection_allowed_count_zero",
        "allowed_hosts_safe",
    ):
        if provider_policy_checks.get(key) is not True:
            errors.append(f"llm_provider_policy_check_not_true:{key}")
    if provider_schedule.get("status") != "ok":
        errors.append("llm_provider_schedule_not_ok")
    if int(provider_schedule.get("invalid_account_count") or 0) != 0:
        errors.append("llm_provider_schedule_invalid_accounts")
    if not isinstance(provider_schedule.get("max_campaign_parallel"), int) or provider_schedule.get("max_campaign_parallel") < 1:
        errors.append("llm_provider_schedule_parallel_invalid")
    for key in (
        "provider_calls_made",
        "corpus_bytes_mutated",
        "s3_objects_mutated",
        "metadata_rows_mutated",
        "search_index_rows_mutated",
    ):
        if provider_nonmutation.get(key) is not False:
            errors.append(f"llm_provider_nonmutation_mismatch:{key}")
    if provider_redaction.get("passed") is not True:
        errors.append("llm_provider_redaction_not_passed")
    if provider_redaction.get("sensitive_marker_counts"):
        errors.append("llm_provider_redaction_counts_nonempty")

    replacement_gate = artifacts.get("replacement_readiness_gate") if isinstance(artifacts.get("replacement_readiness_gate"), dict) else {}
    replacement_requirements = replacement_gate.get("requirements") if isinstance(replacement_gate.get("requirements"), list) else []
    replacement_keys = [
        item.get("key")
        for item in replacement_requirements
        if isinstance(item, dict)
    ]
    replacement_summary = replacement_gate.get("summary") if isinstance(replacement_gate.get("summary"), dict) else {}
    replacement_complete = sum(1 for item in replacement_requirements if isinstance(item, dict) and item.get("status") == "complete")
    replacement_blocked = sum(1 for item in replacement_requirements if isinstance(item, dict) and item.get("status") == "blocked")
    replacement_deferred = sum(1 for item in replacement_requirements if isinstance(item, dict) and item.get("status") == "deferred")
    replacement_all_complete = bool(replacement_requirements) and replacement_complete == len(replacement_requirements)
    replacement_expected_status = "ready" if replacement_all_complete else "blocked"
    if not replacement_all_complete and replacement_blocked == 0 and replacement_deferred > 0:
        replacement_expected_status = "deferred"
    if replacement_gate.get("present") is not True:
        errors.append("replacement_readiness_gate_not_present")
    if replacement_keys != EXPECTED_REPLACEMENT_REQUIREMENTS:
        errors.append("replacement_readiness_requirements_invalid")
    if replacement_gate.get("status") != replacement_expected_status:
        errors.append("replacement_readiness_status_inconsistent")
    if replacement_gate.get("approved_to_replace_google_drive") is not (replacement_expected_status == "ready"):
        errors.append("replacement_readiness_approval_inconsistent")
    if int(replacement_summary.get("requirements") or 0) != len(replacement_requirements):
        errors.append("replacement_readiness_summary_count_mismatch")
    if int(replacement_summary.get("complete") or 0) != replacement_complete:
        errors.append("replacement_readiness_summary_complete_mismatch")
    if int(replacement_summary.get("blocked") or 0) != replacement_blocked:
        errors.append("replacement_readiness_summary_blocked_mismatch")
    if int(replacement_summary.get("deferred") or 0) != replacement_deferred:
        errors.append("replacement_readiness_summary_deferred_mismatch")
    first_replacement_incomplete = next(
        (
            item.get("key")
            for item in replacement_requirements
            if isinstance(item, dict) and item.get("status") != "complete"
        ),
        None,
    )
    if replacement_summary.get("first_incomplete_requirement") != first_replacement_incomplete:
        errors.append("replacement_readiness_first_incomplete_inconsistent")

    generated_checks = generated_file_checks(packet_dir)
    generated_missing = [entry["file"] for entry in generated_checks if not entry["present"]]
    if generated_missing:
        errors.append("generated_review_files_missing")
    generated_sensitive = [entry["file"] for entry in generated_checks if entry["sensitive_marker_counts"]]
    if generated_sensitive:
        errors.append("generated_review_files_sensitive_marker_hits")

    status = "ok" if not errors else "failed"
    return {
        "kind": "open_files_adversarial_review_packet_verification",
        "version": 1,
        "created_at": now_utc(),
        "status": status,
        "redaction": "aggregate-only verifier output; no private filenames, file IDs, object keys, source refs, extracted text, transcripts, ACL payloads, row payloads, or command logs",
        "packet": {
            "path": str(packet_path),
            "bytes": packet_path.stat().st_size,
            "sha256": file_sha256(packet_path),
            "source_artifacts": len(source_entries),
            "artifact_keys": sorted(artifacts.keys()),
        },
        "source_artifacts": {
            "expected_required": len(REQUIRED_SOURCE_LABELS),
            "present_required": len(set(labels) & REQUIRED_SOURCE_LABELS),
            "missing_required": missing_labels,
            "current_checked": bool(source_paths),
            "current_checked_labels": current_checked_labels,
            "current_mismatched": sorted(set(current_mismatched_labels)),
            "current_missing_paths": sorted(set(current_missing_path_labels)),
        },
        "gates": {
            "required_artifacts_present": not missing_artifacts,
            "required_source_labels_present": not missing_labels,
            "source_artifacts_present": not missing_sources,
            "source_artifact_hashes_ok": not any(error.startswith("source_artifact_sha256_invalid") or error.startswith("source_artifact_bytes_invalid") for error in errors),
            "source_artifact_current_hashes_ok": source_artifact_current_hashes_ok if source_paths else None,
            "source_artifacts_redacted": not source_sensitive,
            "generated_review_files_present": not generated_missing,
            "generated_review_files_redacted": not generated_sensitive,
            "stage_dependency_gate_present": stage_gate.get("present") is True,
            "stage_dependency_ordered": stage_ordered,
            "stage_dependency_first_blocker_consistent": first_blocker_consistent,
            "stage_dependency_approval_consistent": approved_consistent,
            "stage_dependency_verification_ok": stage_verification.get("present") is True
            and stage_verification.get("status") == "ok"
            and stage_verification.get("gate_status") == stage_gate.get("status")
            and stage_verification.get("approved_to_scale") == stage_gate.get("approved_to_scale")
            and all(stage_verification_gates.get(key) is True for key in (
                "stage_order_complete_set",
                "stage_order_numbers_ok",
                "scale_rules_ok",
                "counts_consistent",
                "first_blocker_consistent",
                "status_consistent",
                "approval_consistent",
                "source_artifact_current_hashes_ok",
            )),
            "dashboard_ready_for_operator_review": dashboard.get("status") == "ready_for_operator_review",
            "dashboard_non_mutation_attested": all(dashboard_overall.get(key) is False for key in ("corpus_bytes_mutated", "s3_objects_mutated", "metadata_rows_mutated")),
            "approval_request_packet_ready": approval_request.get("present") is True and approval_request.get("status") == "templates_ready",
            "approval_request_packet_redacted": approval_request_redaction.get("passed") is True,
            "approval_request_non_mutation_attested": all(approval_request_nonmutation.get(key) is expected for key, expected in (
                ("templates_only", True),
                ("approvals_granted", False),
                ("execution_launched", False),
                ("corpus_bytes_mutated", False),
                ("s3_objects_mutated", False),
                ("metadata_rows_mutated", False),
            )),
            "approval_request_verification_ok": (
                approval_request_verification.get("present") is True
                and approval_request_verification.get("status") == "ok"
                and approval_request_verification.get("packet_status") == approval_request.get("status")
                and int(approval_request_verification.get("template_count") or 0) == int(approval_request.get("template_count") or 0)
                and all(approval_request_verification_gates.get(key) is True for key in (
                    "status_templates_ready",
                    "redaction_ok",
                    "non_mutation_attested",
                    "source_status_ok",
                    "source_artifacts_present",
                    "source_artifact_hashes_ok",
                    "source_artifact_current_hashes_ok",
                    "required_decisions_present",
                    "template_count_consistent",
                    "template_hashes_valid",
                    "template_files_present",
                    "command_hashes_valid",
                    "remediation_links_valid",
                ))
            ),
            "current_state_invariants_ok": all(current_state.get(key) is True for key in (
                "canonical_s3_keys_immutable",
                "metadata_only_organization",
                "legacy_sources_preserved_until_final_audit",
                "audio_video_deferred_until_end",
                "scaled_agent_execution_requires_approval",
            )),
            "packet_redaction_counts_empty": not output_scan and not declared_scan,
            "extraction_routes_safe": extraction_gate.get("all_active_lanes_explicitly_routed") is True and extraction_gate.get("no_failed_smoke_samples") is True and extraction_gate.get("no_not_implemented_samples") is True,
            "extraction_readiness_verification_ok": (
                extraction_verification.get("present") is True
                and extraction_verification.get("status") == "ok"
                and extraction_verification.get("gate_status") == extraction_readiness.get("status")
                and all(extraction_verification_checks.get(key) is True for key in (
                    "source_artifacts_present",
                    "source_artifacts_current",
                    "semantic_projection_current",
                    "redaction_ok",
                    "expected_lanes_present",
                    "totals_consistent",
                    "gate_flags_consistent",
                ))
                and extraction_verification_sources.get("current_checked") is True
                and not extraction_verification_sources.get("current_mismatched")
                and not extraction_verification_sources.get("current_missing_paths")
            ),
            "worker_image_static_ok": worker_image.get("static_status") == "ok",
            "locked_worker_bundle_verification_ok": locked_bundle.get("present") is not True or locked_verification.get("status") == "ok",
            "locked_worker_bundle_policy_ok": (
                locked_bundle.get("present") is not True
                or (
                    locked_verification.get("status") == "ok"
                    and all(locked_gates.get(key) is True for key in (
                        "bundle_validation_ok",
                        "no_sandbox_bypass",
                        "skip_git_repo_check_policy_valid",
                        "cwd_confined_to_bundle",
                        "output_confined_to_output_dir",
                        "schema_confined_to_input_dir",
                        "sandbox_mode_limited",
                        "minimal_env_allowlist",
                        "no_secret_env_allowed",
                        "controlled_home_tmp",
                        "runner_uses_env_i",
                        "execution_surface_attested",
                        "network_egress_policy_attested",
                        "only_declared_writable_runtime_dirs",
                    ))
                    and locked_egress_policy_ok
                    and locked_command_policy.get("dangerous_bypass") is False
                    and (
                        locked_command_policy.get("skip_git_repo_check") is False
                        or (
                            locked_command_policy.get("skip_git_repo_check") is True
                            and locked_command_policy.get("skip_git_repo_check_attested") is True
                            and bool(locked_command_policy.get("skip_git_repo_check_justification"))
                            and locked_integrity.get("skip_git_repo_check") is True
                        )
                    )
                )
            ),
            "llm_provider_readiness_ok": provider_readiness.get("present") is True and provider_readiness.get("status") == "ok",
            "llm_provider_policy_ok": provider_policy.get("status") == "ok" and all(provider_policy_checks.get(key) is True for key in (
                "status_ok",
                "real_file_ids_not_sent",
                "raw_file_bytes_not_sent",
                "raw_extracts_not_sent",
                "secret_values_not_sent",
                "provider_data_collection_denied",
                "provider_data_collection_allowed_count_zero",
                "allowed_hosts_safe",
            )),
            "llm_provider_schedule_ok": provider_schedule.get("status") == "ok"
            and int(provider_schedule.get("invalid_account_count") or 0) == 0
            and isinstance(provider_schedule.get("max_campaign_parallel"), int)
            and provider_schedule.get("max_campaign_parallel") >= 1,
            "llm_provider_non_mutation_attested": all(provider_nonmutation.get(key) is False for key in (
                "provider_calls_made",
                "corpus_bytes_mutated",
                "s3_objects_mutated",
                "metadata_rows_mutated",
                "search_index_rows_mutated",
            )),
            "llm_provider_redacted": provider_redaction.get("passed") is True and not provider_redaction.get("sensitive_marker_counts"),
            "replacement_readiness_gate_present": replacement_gate.get("present") is True,
            "replacement_readiness_requirements_complete_set": replacement_keys == EXPECTED_REPLACEMENT_REQUIREMENTS,
            "replacement_readiness_status_consistent": replacement_gate.get("status") == replacement_expected_status,
            "replacement_readiness_approval_consistent": replacement_gate.get("approved_to_replace_google_drive") is (replacement_expected_status == "ready"),
        },
        "stage_dependency_gate": {
            "status": stage_gate.get("status"),
            "approved_to_scale": stage_gate.get("approved_to_scale"),
            "first_blocking_stage": stage_gate.get("first_blocking_stage"),
            "blocking_stage_count": stage_gate.get("blocking_stage_count"),
            "hard_blocking_stage_count": stage_gate.get("hard_blocking_stage_count"),
            "deferred_stage_count": stage_gate.get("deferred_stage_count"),
            "stage_keys": stage_keys,
        },
        "stage_dependency_verification": {
            "status": stage_verification.get("status"),
            "gate_status": stage_verification.get("gate_status"),
            "approved_to_scale": stage_verification.get("approved_to_scale"),
            "summary": stage_verification_summary,
            "errors_count": stage_verification.get("errors_count"),
            "warnings_count": stage_verification.get("warnings_count"),
        },
        "dashboard": {
            "status": dashboard.get("status"),
            "ready_approval_items": dashboard_overall.get("ready_approval_items"),
            "approval_items": dashboard_overall.get("approval_items"),
            "final_media_pass_deferred": dashboard_overall.get("final_media_pass_deferred"),
            "blocked_or_missing_prep_items": dashboard_overall.get("blocked_or_missing_prep_items") if isinstance(dashboard_overall.get("blocked_or_missing_prep_items"), list) else [],
        },
        "approval_request_verification": {
            "status": approval_request_verification.get("status"),
            "packet_status": approval_request_verification.get("packet_status"),
            "template_count": approval_request_verification.get("template_count"),
            "errors_count": approval_request_verification.get("errors_count"),
            "warnings_count": approval_request_verification.get("warnings_count"),
        },
        "llm_provider_readiness": {
            "status": provider_readiness.get("status"),
            "policy_status": provider_policy.get("status"),
            "schedule_status": provider_schedule.get("status"),
            "invalid_account_count": provider_schedule.get("invalid_account_count"),
            "max_campaign_parallel": provider_schedule.get("max_campaign_parallel"),
            "redaction_passed": provider_redaction.get("passed"),
        },
        "replacement_readiness_gate": {
            "status": replacement_gate.get("status"),
            "approved_to_replace_google_drive": replacement_gate.get("approved_to_replace_google_drive"),
            "summary": replacement_summary,
            "requirement_keys": replacement_keys,
        },
        "generated_files": generated_checks,
        "errors": errors,
        "warnings": warnings,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Verify aggregate-safe adversarial review packet readiness.")
    parser.add_argument("--packet", default=DEFAULT_PACKET)
    parser.add_argument("--output", default=DEFAULT_OUTPUT)
    parser.add_argument("--min-source-artifacts", type=int, default=20)
    parser.add_argument("--min-ready-approval-items", type=int, default=5)
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

    result = verify_packet(
        packet_path=Path(args.packet).expanduser().resolve(),
        min_source_artifacts=args.min_source_artifacts,
        min_ready_approval_items=args.min_ready_approval_items,
        source_paths=source_paths,
    )
    output = Path(args.output).expanduser().resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps({key: result[key] for key in ("kind", "status", "gates", "dashboard", "errors", "warnings")}, indent=2, sort_keys=True))
    return 0 if result["status"] == "ok" else 1


if __name__ == "__main__":
    raise SystemExit(main())
