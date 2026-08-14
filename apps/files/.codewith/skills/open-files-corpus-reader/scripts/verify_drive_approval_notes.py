#!/usr/bin/env python3
"""Verify Drive approval request packet and notes summary artifacts."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import time
from pathlib import Path
from typing import Any


DEFAULT_PACKET = ".codewith/private-artifacts/drive-approval/drive-approval-request-packet.json"
DEFAULT_NOTES_SUMMARY = ".codewith/private-artifacts/drive-approval/drive-approval-notes-summary.json"
DEFAULT_OUTPUT = ".codewith/private-artifacts/drive-approval/drive-approval-notes-verification.json"

EXPECTED_PACKET_SOURCE_LABELS = {
    "drive_approval_queue",
    "drive_approval_queue_verification",
}

DEFAULT_PACKET_SOURCE_PATHS = {
    "drive_approval_queue": ".codewith/private-artifacts/drive-approval/drive-approval-queue.json",
    "drive_approval_queue_verification": ".codewith/private-artifacts/drive-approval/drive-approval-queue-verification.json",
}

EXPECTED_SUMMARY_SOURCE_LABELS = {
    "drive_approval_request_packet",
}

DEFAULT_SUMMARY_SOURCE_PATHS = {
    "drive_approval_request_packet": ".codewith/private-artifacts/drive-approval/drive-approval-request-packet.json",
}

ALLOWED_SUMMARY_STATUSES = {
    "missing_required",
    "invalid",
    "not_fully_approved",
    "approved",
    "redaction_failed",
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


def list_value(value: Any) -> list[Any]:
    return value if isinstance(value, list) else []


def dict_value(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


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


def source_by_label(items: Any) -> dict[str, dict[str, Any]]:
    output: dict[str, dict[str, Any]] = {}
    for item in list_value(items):
        if isinstance(item, dict) and isinstance(item.get("label"), str):
            output[item["label"]] = item
    return output


def current_source_check(
    *,
    recorded: dict[str, dict[str, Any]],
    expected_labels: set[str],
    source_paths: dict[str, Path] | None,
    errors: list[str],
    prefix: str,
) -> dict[str, Any]:
    missing_labels = sorted(expected_labels - set(recorded))
    for label in missing_labels:
        add_error(errors, f"{prefix}_missing_source_artifact", label)
    for label, item in sorted(recorded.items()):
        if label not in expected_labels:
            continue
        if item.get("present") is not True:
            add_error(errors, f"{prefix}_source_artifact_not_present", label)
        if as_int(item.get("bytes")) <= 0:
            add_error(errors, f"{prefix}_source_artifact_empty", label)
        if not isinstance(item.get("sha256"), str) or not re.fullmatch(r"[0-9a-f]{64}", item["sha256"]):
            add_error(errors, f"{prefix}_source_artifact_sha256_invalid", label)

    checked: list[str] = []
    mismatched: list[str] = []
    missing_paths: list[str] = []
    if source_paths:
        for label, path in sorted(source_paths.items()):
            if label not in expected_labels:
                continue
            checked.append(label)
            recorded_item = recorded.get(label)
            if recorded_item is None:
                add_error(errors, f"{prefix}_current_source_not_recorded", label)
                continue
            path = path.expanduser().resolve()
            if not path.exists():
                missing_paths.append(label)
                add_error(errors, f"{prefix}_source_artifact_current_path_missing", label)
                continue
            if recorded_item.get("bytes") != path.stat().st_size or recorded_item.get("sha256") != file_sha256(path):
                mismatched.append(label)
                add_error(errors, f"{prefix}_source_artifact_current_hash_mismatch", label)
    return {
        "expected": len(expected_labels),
        "present": len(set(recorded) & expected_labels),
        "missing": missing_labels,
        "current_checked": bool(source_paths),
        "current_checked_labels": checked,
        "current_mismatched": sorted(set(mismatched)),
        "current_missing_paths": sorted(set(missing_paths)),
    }


def verify_template_files(packet: dict[str, Any], errors: list[str]) -> list[dict[str, Any]]:
    template_dir_raw = packet.get("template_dir")
    template_dir = Path(template_dir_raw).expanduser() if isinstance(template_dir_raw, str) and template_dir_raw else None
    output: list[dict[str, Any]] = []
    if template_dir is None:
        add_error(errors, "packet_template_dir_missing")
        return output
    for item in list_value(packet.get("templates")):
        if not isinstance(item, dict):
            continue
        decision_id = str(item.get("decision_id") or "")
        template_file = item.get("template_file")
        summary = {"decision_id": decision_id, "template_file": template_file, "present": None, "sha256_matches": None}
        if not isinstance(template_file, str):
            add_error(errors, "template_file_invalid", decision_id)
            output.append(summary)
            continue
        path = (template_dir / template_file).resolve()
        present = path.exists() and path.is_file()
        summary["present"] = present
        if not present:
            add_error(errors, "template_file_missing", decision_id)
            output.append(summary)
            continue
        actual_sha = file_sha256(path)
        summary["sha256_matches"] = actual_sha == item.get("template_sha256")
        summary["bytes"] = path.stat().st_size
        if actual_sha != item.get("template_sha256"):
            add_error(errors, "template_file_sha256_mismatch", decision_id)
        if scan_text(path.read_text(encoding="utf-8")):
            add_error(errors, "template_file_sensitive_marker_hits", decision_id)
        output.append(summary)
    return output


def packet_expectations(packet: dict[str, Any]) -> dict[str, dict[str, Any]]:
    output: dict[str, dict[str, Any]] = {}
    for item in list_value(packet.get("templates")):
        if isinstance(item, dict) and isinstance(item.get("decision_id"), str):
            output[item["decision_id"]] = item
    return output


def verify_artifacts(
    *,
    packet_path: Path,
    summary_path: Path,
    packet_source_paths: dict[str, Path] | None = None,
    summary_source_paths: dict[str, Path] | None = None,
) -> dict[str, Any]:
    errors: list[str] = []
    warnings: list[str] = []
    packet = load_json(packet_path)
    summary = load_json(summary_path)

    if packet.get("kind") != "open_files_drive_approval_note_template_packet":
        add_error(errors, "packet_invalid_kind")
    if packet.get("version") != 1:
        add_error(errors, "packet_invalid_version")
    if packet.get("status") != "templates_ready":
        add_error(errors, "packet_status_not_templates_ready")
    packet_markers = scan_text(json.dumps(packet, sort_keys=True))
    if packet_markers:
        add_error(errors, "packet_sensitive_marker_hits")
    packet_redaction = dict_value(packet.get("redaction_check"))
    if packet_redaction.get("passed") is not True or packet_redaction.get("sensitive_marker_counts"):
        add_error(errors, "packet_redaction_check_not_passed")

    packet_non_mutation = dict_value(packet.get("non_mutation_attestation"))
    for key, expected in {
        "templates_only": True,
        "approvals_granted": False,
        "execution_launched": False,
        "corpus_bytes_mutated": False,
        "s3_objects_mutated": False,
        "metadata_rows_mutated": False,
        "search_index_rows_mutated": False,
        "drive_permissions_mutated": False,
    }.items():
        if packet_non_mutation.get(key) is not expected:
            add_error(errors, "packet_non_mutation_mismatch", key)

    source_status = dict_value(packet.get("source_status"))
    if source_status.get("queue_status") != "operator_drive_approval_required":
        add_error(errors, "packet_queue_status_invalid")
    if source_status.get("queue_verification_status") != "ok":
        add_error(errors, "packet_queue_verification_not_ok")
    if source_status.get("expected_source_docs_missing") not in ([], None):
        add_error(errors, "packet_expected_source_docs_missing")

    templates = [item for item in list_value(packet.get("templates")) if isinstance(item, dict)]
    if as_int(packet.get("template_count")) != len(templates):
        add_error(errors, "packet_template_count_inconsistent")
    decisions = [item.get("decision_id") for item in templates]
    if decisions != list_value(packet.get("required_decisions")):
        add_error(errors, "packet_required_decisions_inconsistent")
    if len(set(decisions)) != len(decisions):
        add_error(errors, "packet_duplicate_decision_ids")
    for item in templates:
        decision_id = str(item.get("decision_id") or "")
        if not decision_id.startswith("drive_"):
            add_error(errors, "packet_decision_id_invalid", decision_id)
        if item.get("ready_for_approval") is not True:
            add_error(errors, "packet_template_not_ready", decision_id)
        for key in ("task_id_sha256", "title_sha256", "template_sha256"):
            if not isinstance(item.get(key), str) or not re.fullmatch(r"[0-9a-f]{64}", item[key]):
                add_error(errors, "packet_template_hash_invalid", f"{decision_id}:{key}")
        source_hashes = list_value(item.get("source_doc_hashes"))
        if not source_hashes and item.get("approval_type") not in {"backup_rollback_evidence"}:
            warnings.append(f"template_without_source_doc_hashes:{decision_id}")
        for source in source_hashes:
            if not isinstance(source, dict):
                add_error(errors, "packet_source_doc_hash_not_object", decision_id)
                continue
            if source.get("present") is not True:
                add_error(errors, "packet_source_doc_not_present", decision_id)
            if not isinstance(source.get("sha256"), str) or not re.fullmatch(r"[0-9a-f]{64}", source["sha256"]):
                add_error(errors, "packet_source_doc_sha256_invalid", decision_id)

    template_files = verify_template_files(packet, errors)
    packet_source_artifacts = current_source_check(
        recorded=source_by_label(packet.get("source_artifacts")),
        expected_labels=EXPECTED_PACKET_SOURCE_LABELS,
        source_paths=packet_source_paths,
        errors=errors,
        prefix="packet",
    )

    if summary.get("kind") != "open_files_drive_approval_notes_summary":
        add_error(errors, "summary_invalid_kind")
    if summary.get("version") != 1:
        add_error(errors, "summary_invalid_version")
    if summary.get("status") not in ALLOWED_SUMMARY_STATUSES:
        add_error(errors, "summary_status_invalid")
    summary_markers = scan_text(json.dumps(summary, sort_keys=True))
    if summary_markers:
        add_error(errors, "summary_sensitive_marker_hits")
    summary_redaction = dict_value(summary.get("redaction_check"))
    if summary_redaction.get("passed") is not True or summary_redaction.get("sensitive_marker_counts"):
        add_error(errors, "summary_redaction_check_not_passed")
    if summary.get("drive_request_packet_status") != packet.get("status"):
        add_error(errors, "summary_packet_status_inconsistent")
    if summary.get("drive_request_template_count") != packet.get("template_count"):
        add_error(errors, "summary_packet_template_count_inconsistent")
    if as_int(summary.get("required_decision_count")) != len(decisions):
        add_error(errors, "summary_required_decision_count_inconsistent")
    required_items = [item for item in list_value(summary.get("required_decisions")) if isinstance(item, dict)]
    required_ids = [item.get("decision_id") for item in required_items]
    if required_ids != decisions:
        add_error(errors, "summary_required_decision_set_mismatch")
    missing = list_value(summary.get("missing_required_decisions"))
    invalid = list_value(summary.get("invalid_required_decisions"))
    if as_int(summary.get("approved_required_decision_count")) > len(decisions):
        add_error(errors, "summary_approved_count_impossible")
    if summary.get("status") == "missing_required" and not missing:
        add_error(errors, "summary_missing_required_status_without_missing")
    if summary.get("status") == "invalid" and not invalid:
        add_error(errors, "summary_invalid_status_without_invalid")
    if summary.get("status") == "approved" and as_int(summary.get("approved_required_decision_count")) != len(decisions):
        add_error(errors, "summary_approved_status_count_mismatch")
    for item in required_items:
        decision_id = str(item.get("decision_id") or "")
        if decision_id not in packet_expectations(packet):
            add_error(errors, "summary_unknown_required_decision", decision_id)
        if item.get("present") is True and item.get("drive_request_checked") is not True:
            add_error(errors, "summary_present_note_not_request_checked", decision_id)

    summary_source_artifacts = current_source_check(
        recorded=source_by_label(summary.get("source_artifacts")),
        expected_labels=EXPECTED_SUMMARY_SOURCE_LABELS,
        source_paths=summary_source_paths,
        errors=errors,
        prefix="summary",
    )

    packet_current_ok = bool(packet_source_paths) and not any(error.startswith("packet_source_artifact_current") or error.startswith("packet_current_source") for error in errors)
    summary_current_ok = bool(summary_source_paths) and not any(error.startswith("summary_source_artifact_current") or error.startswith("summary_current_source") for error in errors)
    gates = {
        "packet_kind_ok": packet.get("kind") == "open_files_drive_approval_note_template_packet",
        "packet_status_templates_ready": packet.get("status") == "templates_ready",
        "packet_redaction_ok": not packet_markers and packet_redaction.get("passed") is True,
        "packet_non_mutation_attested": not any(error.startswith("packet_non_mutation") for error in errors),
        "packet_source_artifact_current_hashes_ok": packet_current_ok if packet_source_paths else None,
        "template_files_present": not any(error.startswith("template_file_missing") for error in errors),
        "template_hashes_valid": not any(error.startswith("template_file_sha256_mismatch") or error.startswith("packet_template_hash_invalid") for error in errors),
        "summary_kind_ok": summary.get("kind") == "open_files_drive_approval_notes_summary",
        "summary_redaction_ok": not summary_markers and summary_redaction.get("passed") is True,
        "summary_source_artifact_current_hashes_ok": summary_current_ok if summary_source_paths else None,
        "summary_decisions_match_packet": "summary_required_decision_set_mismatch" not in errors,
        "status_consistent": not any(error.startswith("summary_") and "status" in error for error in errors),
    }
    return {
        "kind": "open_files_drive_approval_notes_verification",
        "version": 1,
        "created_at": now_utc(),
        "status": "ok" if not errors else "error",
        "packet_status": packet.get("status"),
        "notes_status": summary.get("status"),
        "template_count": len(templates),
        "required_decision_count": summary.get("required_decision_count"),
        "approved_required_decision_count": summary.get("approved_required_decision_count"),
        "gates": gates,
        "source_artifacts": {
            "packet": packet_source_artifacts,
            "summary": summary_source_artifacts,
        },
        "template_files": template_files,
        "sensitive_marker_counts": {
            "packet": packet_markers,
            "summary": summary_markers,
        },
        "errors": errors,
        "warnings": warnings,
        "redaction": "aggregate-only verification; no private filenames, file IDs, object keys, source refs, extracted text, transcripts, ACL payloads, row payloads, approval-note text, command text, or secrets",
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Verify Drive approval request packet and notes summary.")
    parser.add_argument("--packet", default=DEFAULT_PACKET)
    parser.add_argument("--notes-summary", default=DEFAULT_NOTES_SUMMARY)
    parser.add_argument("--output", default=DEFAULT_OUTPUT)
    parser.add_argument(
        "--packet-source",
        action="append",
        default=[],
        type=parse_source,
        metavar="LABEL=PATH",
        help="Override or add a current packet source artifact path to recompute.",
    )
    parser.add_argument(
        "--summary-source",
        action="append",
        default=[],
        type=parse_source,
        metavar="LABEL=PATH",
        help="Override or add a current summary source artifact path to recompute.",
    )
    parser.add_argument("--skip-current-source-check", action="store_true")
    args = parser.parse_args()

    packet_source_paths: dict[str, Path] | None = None
    summary_source_paths: dict[str, Path] | None = None
    if not args.skip_current_source_check:
        packet_source_paths = {label: Path(path).expanduser().resolve() for label, path in DEFAULT_PACKET_SOURCE_PATHS.items()}
        summary_source_paths = {label: Path(path).expanduser().resolve() for label, path in DEFAULT_SUMMARY_SOURCE_PATHS.items()}
        for label, path in args.packet_source:
            packet_source_paths[label] = path
        for label, path in args.summary_source:
            summary_source_paths[label] = path

    result = verify_artifacts(
        packet_path=Path(args.packet).expanduser().resolve(),
        summary_path=Path(args.notes_summary).expanduser().resolve(),
        packet_source_paths=packet_source_paths,
        summary_source_paths=summary_source_paths,
    )
    output = Path(args.output).expanduser().resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps({
        "kind": result["kind"],
        "status": result["status"],
        "packet_status": result["packet_status"],
        "notes_status": result["notes_status"],
        "template_count": result["template_count"],
        "errors": result["errors"],
        "warnings": result["warnings"],
    }, indent=2, sort_keys=True))
    return 0 if result["status"] == "ok" else 1


if __name__ == "__main__":
    raise SystemExit(main())
