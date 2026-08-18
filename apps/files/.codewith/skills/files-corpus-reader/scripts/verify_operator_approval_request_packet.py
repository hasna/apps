#!/usr/bin/env python3
"""Verify the aggregate operator approval request packet."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import time
from pathlib import Path
from typing import Any


DEFAULT_PACKET = ".codewith/private-artifacts/operator-approvals/approval-request-packet.json"
DEFAULT_OUTPUT = ".codewith/private-artifacts/operator-approvals/approval-request-packet-verification.json"

EXPECTED_DECISIONS = [
    "ocr_vision_canary",
    "large_file_canary",
    "archive_worker_image",
    "search_index_population",
    "llm_review_campaign",
]

EXPECTED_SCOPES = {
    "ocr_vision_canary": "provider-use",
    "large_file_canary": "canary",
    "archive_worker_image": "worker-build",
    "search_index_population": "canary",
    "llm_review_campaign": "canary",
}

EXPECTED_REMEDIATION_ACTION_IDS = {
    "ocr_vision_canary": ["enable_ocr_or_vision_lane"],
    "large_file_canary": ["approve_large_file_runner_canary"],
    "archive_worker_image": ["enable_archive_inventory_tools", "grant_worker_docker_access_or_ci"],
    "search_index_population": [],
    "llm_review_campaign": [],
}

EXPECTED_SOURCE_LABELS = {
    "extraction_approval_dashboard",
    "approval_notes_summary",
    "stage_dependency_verification",
}

DEFAULT_SOURCE_PATHS = {
    "extraction_approval_dashboard": ".codewith/private-artifacts/extraction-approval-dashboard.json",
    "approval_notes_summary": ".codewith/private-artifacts/operator-approvals/approval-notes-summary.json",
    "stage_dependency_verification": ".codewith/private-artifacts/stage-dependency-verification.json",
}

MIN_COMMAND_HASHES = {
    "ocr_vision_canary": 0,
    "large_file_canary": 1,
    "archive_worker_image": 1,
    "search_index_population": 1,
    "llm_review_campaign": 0,
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


def as_int(value: Any) -> int:
    try:
        return int(value or 0)
    except (TypeError, ValueError):
        return 0


def add_error(errors: list[str], code: str, detail: str | None = None) -> None:
    errors.append(f"{code}:{detail}" if detail else code)


def text_sha256(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def dict_value(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def stage_readiness_projection(value: Any) -> dict[str, Any]:
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


def resolved_default_source_paths() -> dict[str, Path]:
    return {label: Path(path).expanduser().resolve() for label, path in DEFAULT_SOURCE_PATHS.items()}


def verify_packet(
    packet_path: Path,
    *,
    verify_template_files: bool = True,
    source_paths: dict[str, Path] | None = None,
) -> dict[str, Any]:
    errors: list[str] = []
    warnings: list[str] = []
    packet = load_json(packet_path)

    if packet.get("kind") != "open_files_operator_approval_note_template_packet":
        add_error(errors, "invalid_kind")
    if packet.get("version") != 1:
        add_error(errors, "invalid_version")
    if packet.get("status") != "templates_ready":
        add_error(errors, "packet_status_not_templates_ready")

    marker_counts = scan_text(json.dumps(packet, sort_keys=True))
    if marker_counts:
        add_error(errors, "sensitive_marker_hits")
    redaction_check = packet.get("redaction_check") if isinstance(packet.get("redaction_check"), dict) else {}
    if redaction_check.get("passed") is not True:
        add_error(errors, "redaction_check_not_passed")
    if redaction_check.get("sensitive_marker_counts"):
        add_error(errors, "redaction_check_counts_nonempty")

    non_mutation = packet.get("non_mutation_attestation") if isinstance(packet.get("non_mutation_attestation"), dict) else {}
    for key, expected in {
        "templates_only": True,
        "approvals_granted": False,
        "execution_launched": False,
        "corpus_bytes_mutated": False,
        "s3_objects_mutated": False,
        "metadata_rows_mutated": False,
    }.items():
        if non_mutation.get(key) is not expected:
            add_error(errors, "non_mutation_mismatch", key)

    source = packet.get("source_status") if isinstance(packet.get("source_status"), dict) else {}
    if source.get("dashboard_status") != "ready_for_operator_review":
        add_error(errors, "source_dashboard_not_ready")
    if source.get("ready_for_operator_review") is not True:
        add_error(errors, "source_ready_for_operator_review_not_true")
    if source.get("approval_notes_status") not in {"missing_required", "invalid", "not_fully_approved", "approved"}:
        add_error(errors, "source_approval_notes_status_invalid")
    if source.get("stage_verification_status") != "ok":
        add_error(errors, "source_stage_verification_status_not_ok")
    if source.get("stage_gate_status") not in {"blocked", "ready_to_scale"}:
        add_error(errors, "source_stage_gate_status_invalid")
    if as_int(source.get("approved_required_decision_count")) != 0 and packet.get("status") == "templates_ready":
        warnings.append("templates_ready_with_existing_approved_decisions")
    if source.get("remediation_status") != "operator_remediation_required":
        add_error(errors, "source_remediation_status_invalid")
    if as_int(source.get("remediation_action_count")) < 1:
        add_error(errors, "source_remediation_action_count_missing")

    source_artifacts = packet.get("source_artifacts") if isinstance(packet.get("source_artifacts"), list) else []
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

    templates = packet.get("templates") if isinstance(packet.get("templates"), list) else []
    stage_readiness = stage_readiness_projection(packet.get("stage_readiness"))
    for key in missing_stage_readiness_keys(stage_readiness):
        add_error(errors, "stage_readiness_missing", key)
    stage_readiness_sha256 = packet.get("stage_readiness_sha256")
    expected_stage_readiness_sha256 = text_sha256(json.dumps(stage_readiness, sort_keys=True))
    if not isinstance(stage_readiness_sha256, str) or not re.fullmatch(r"[a-f0-9]{64}", stage_readiness_sha256):
        add_error(errors, "stage_readiness_sha256_invalid")
    elif stage_readiness_sha256 != expected_stage_readiness_sha256:
        add_error(errors, "stage_readiness_sha256_mismatch")
    decisions = [item.get("decision_id") for item in templates if isinstance(item, dict)]
    if decisions != EXPECTED_DECISIONS:
        add_error(errors, "decision_order_or_set_invalid")
    if len(set(decisions)) != len(decisions):
        add_error(errors, "duplicate_decision_ids")
    if as_int(packet.get("template_count")) != len(templates):
        add_error(errors, "template_count_inconsistent")

    template_dir_raw = packet.get("template_dir")
    template_dir = Path(template_dir_raw).expanduser() if isinstance(template_dir_raw, str) and template_dir_raw else None
    if verify_template_files and template_dir is None:
        add_error(errors, "template_dir_missing")

    template_file_summaries: list[dict[str, Any]] = []
    for item in templates:
        if not isinstance(item, dict):
            add_error(errors, "template_entry_not_object")
            continue
        decision_id = str(item.get("decision_id") or "")
        if item.get("scope") != EXPECTED_SCOPES.get(decision_id):
            add_error(errors, "template_scope_invalid", decision_id)
        if item.get("ready_for_approval") is not True:
            add_error(errors, "template_not_ready_for_approval", decision_id)
        if item.get("remediation_action_ids") != EXPECTED_REMEDIATION_ACTION_IDS.get(decision_id):
            add_error(errors, "template_remediation_action_ids_invalid", decision_id)
        if item.get("remediation_status") != "operator_remediation_required":
            add_error(errors, "template_remediation_status_invalid", decision_id)
        if item.get("sensitive_marker_counts"):
            add_error(errors, "template_sensitive_marker_counts_nonempty", decision_id)
        template_sha = item.get("template_sha256")
        if not isinstance(template_sha, str) or not re.fullmatch(r"[a-f0-9]{64}", template_sha):
            add_error(errors, "template_sha256_invalid", decision_id)
        template_file = item.get("template_file")
        if not isinstance(template_file, str) or not template_file.endswith(".template.json"):
            add_error(errors, "template_file_invalid", decision_id)
        command_hashes = item.get("command_hashes") if isinstance(item.get("command_hashes"), list) else []
        if len(command_hashes) < MIN_COMMAND_HASHES.get(decision_id, 0):
            add_error(errors, "template_command_hash_count_below_minimum", decision_id)
        if item.get("stage_readiness_sha256") != stage_readiness_sha256:
            add_error(errors, "template_stage_readiness_sha256_mismatch", decision_id)
        seen_command_names: set[str] = set()
        for command in command_hashes:
            if not isinstance(command, dict):
                add_error(errors, "command_hash_entry_not_object", decision_id)
                continue
            name = command.get("name")
            if not isinstance(name, str) or not name:
                add_error(errors, "command_hash_name_invalid", decision_id)
            elif name in seen_command_names:
                add_error(errors, "duplicate_command_hash_name", decision_id)
            else:
                seen_command_names.add(name)
            if not isinstance(command.get("sha256"), str) or not re.fullmatch(r"[a-f0-9]{64}", command.get("sha256") or ""):
                add_error(errors, "command_hash_sha256_invalid", decision_id)
            if as_int(command.get("bytes")) <= 0:
                add_error(errors, "command_hash_bytes_invalid", decision_id)

        file_summary: dict[str, Any] = {
            "decision_id": decision_id,
            "template_file": template_file,
            "present": None,
            "sha256_matches": None,
        }
        if verify_template_files and template_dir is not None and isinstance(template_file, str):
            path = (template_dir / template_file).resolve()
            present = path.exists() and path.is_file()
            file_summary["present"] = present
            if not present:
                add_error(errors, "template_file_missing", decision_id)
            else:
                actual_sha = file_sha256(path)
                file_summary["sha256_matches"] = actual_sha == template_sha
                file_summary["bytes"] = path.stat().st_size
                if actual_sha != template_sha:
                    add_error(errors, "template_file_sha256_mismatch", decision_id)
                template_text = path.read_text(encoding="utf-8")
                if scan_text(template_text):
                    add_error(errors, "template_file_sensitive_marker_hits", decision_id)
                try:
                    template_json = json.loads(template_text)
                except json.JSONDecodeError:
                    template_json = None
                    add_error(errors, "template_file_json_invalid", decision_id)
                if isinstance(template_json, dict):
                    template_stage_readiness = stage_readiness_projection(template_json.get("stage_readiness_context"))
                    if template_stage_readiness != stage_readiness:
                        add_error(errors, "template_file_stage_readiness_mismatch", decision_id)
        template_file_summaries.append(file_summary)

    gates = {
        "kind_ok": packet.get("kind") == "open_files_operator_approval_note_template_packet",
        "status_templates_ready": packet.get("status") == "templates_ready",
        "redaction_ok": not marker_counts and redaction_check.get("passed") is True,
        "non_mutation_attested": not any(error.startswith("non_mutation_mismatch") for error in errors),
        "source_status_ok": not any(error.startswith("source_") for error in errors),
        "source_artifacts_present": not any(error.startswith("missing_source_artifact") or error.startswith("source_artifact_not_present") for error in errors),
        "source_artifact_hashes_ok": not any(error.startswith("source_artifact_sha256_invalid") for error in errors),
        "source_artifact_current_hashes_ok": source_artifact_current_hashes_ok if source_paths else None,
        "stage_readiness_present": not any(error.startswith("stage_readiness_") for error in errors),
        "template_stage_readiness_valid": not any(error.startswith("template_stage_readiness_") or error.startswith("template_file_stage_readiness_") for error in errors),
        "required_decisions_present": decisions == EXPECTED_DECISIONS,
        "template_count_consistent": "template_count_inconsistent" not in errors,
        "template_hashes_valid": not any(error.startswith("template_sha256_invalid") or error.startswith("template_file_sha256_mismatch") for error in errors),
        "template_files_present": not any(error.startswith("template_file_missing") for error in errors),
        "command_hashes_valid": not any(error.startswith("command_hash_") or error.startswith("template_command_hash_count") or error.startswith("duplicate_command_hash_name") for error in errors),
        "remediation_links_valid": not any(error.startswith("template_remediation_") for error in errors),
    }

    return {
        "kind": "open_files_operator_approval_request_packet_verification",
        "version": 1,
        "created_at": now_utc(),
        "status": "ok" if not errors else "error",
        "packet_status": packet.get("status"),
        "template_count": len(templates),
        "expected_decisions": EXPECTED_DECISIONS,
        "decision_ids": decisions,
        "gates": gates,
        "source_status": {
            "dashboard_status": source.get("dashboard_status"),
            "approval_notes_status": source.get("approval_notes_status"),
            "approved_required_decision_count": source.get("approved_required_decision_count"),
            "stage_verification_status": source.get("stage_verification_status"),
            "stage_gate_status": source.get("stage_gate_status"),
            "remediation_status": source.get("remediation_status"),
            "remediation_action_count": source.get("remediation_action_count"),
        },
        "stage_readiness": stage_readiness,
        "source_artifacts": {
            "expected": len(EXPECTED_SOURCE_LABELS),
            "present": len(source_labels & EXPECTED_SOURCE_LABELS),
            "missing": missing_source_labels,
            "current_checked": bool(source_paths),
            "current_checked_labels": current_checked_labels,
            "current_mismatched": sorted(set(current_mismatched_labels)),
            "current_missing_paths": sorted(set(current_missing_path_labels)),
        },
        "template_files": template_file_summaries,
        "sensitive_marker_counts": marker_counts,
        "errors": errors,
        "warnings": warnings,
        "redaction": "aggregate-only verification; no private filenames, file IDs, object keys, source refs, extracted text, transcripts, row payloads, approval-note text, command text, or secrets",
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Verify operator approval request packet.")
    parser.add_argument("--packet", default=DEFAULT_PACKET)
    parser.add_argument("--output", default=DEFAULT_OUTPUT)
    parser.add_argument("--skip-template-file-check", action="store_true")
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
        Path(args.packet).expanduser().resolve(),
        verify_template_files=not args.skip_template_file_check,
        source_paths=source_paths,
    )
    output = Path(args.output).expanduser().resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps({
        "kind": result["kind"],
        "status": result["status"],
        "packet_status": result["packet_status"],
        "template_count": result["template_count"],
        "errors": result["errors"],
        "warnings": result["warnings"],
    }, indent=2, sort_keys=True))
    return 0 if result["status"] == "ok" else 1


if __name__ == "__main__":
    raise SystemExit(main())
