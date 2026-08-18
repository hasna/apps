#!/usr/bin/env python3
"""Build aggregate remediation guidance for blocked extraction lanes.

This script consumes existing aggregate artifacts only. It does not read corpus
files, manifests, S3 objects, databases, extracted text, or provider secrets.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import time
from pathlib import Path
from typing import Any


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
    ("google_drive_url", re.compile(r"(drive|docs)\.google\.com/", re.I)),
)


def now_utc() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def load_json(path: Path | None) -> dict[str, Any] | None:
    if path is None or not path.exists():
        return None
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


def source_entry(label: str, path: Path | None) -> dict[str, Any]:
    return {
        "label": label,
        "present": bool(path and path.exists()),
        "bytes": path.stat().st_size if path and path.exists() else 0,
        "sha256": file_sha256(path) if path and path.exists() else None,
    }


def valid_sha256(value: Any) -> bool:
    return isinstance(value, str) and bool(re.fullmatch(r"[0-9a-f]{64}", value))


def scan_text(text: str) -> dict[str, int]:
    counts: dict[str, int] = {}
    for code, pattern in SENSITIVE_PATTERNS:
        count = len(pattern.findall(text))
        if count:
            counts[code] = count
    return counts


def lane_index(readiness: dict[str, Any] | None) -> dict[str, dict[str, Any]]:
    lanes = readiness.get("lanes") if isinstance(readiness, dict) and isinstance(readiness.get("lanes"), list) else []
    output: dict[str, dict[str, Any]] = {}
    for lane in lanes:
        if isinstance(lane, dict) and isinstance(lane.get("lane"), str):
            output[lane["lane"]] = lane
    return output


def lanes_with_requirement(lanes: dict[str, dict[str, Any]], requirement: str) -> list[str]:
    selected: list[str] = []
    for lane, details in lanes.items():
        requirements = details.get("requirements") if isinstance(details.get("requirements"), list) else []
        if requirement in requirements:
            selected.append(lane)
    return sorted(selected)


def lanes_with_missing_block(lanes: dict[str, dict[str, Any]], block: str) -> list[str]:
    selected: list[str] = []
    needle = f"missing_block:{block}"
    for lane, details in lanes.items():
        requirements = details.get("requirements") if isinstance(details.get("requirements"), list) else []
        host_missing = details.get("host_missing_blocks") if isinstance(details.get("host_missing_blocks"), list) else []
        worker_missing = details.get("worker_missing_blocks") if isinstance(details.get("worker_missing_blocks"), list) else []
        if needle in requirements or block in host_missing or block in worker_missing:
            selected.append(lane)
    return sorted(selected)


def active_files_for(lanes: dict[str, dict[str, Any]], selected: list[str]) -> int:
    return sum(int((lanes.get(lane) or {}).get("active_files") or 0) for lane in selected)


def action(
    action_id: str,
    title: str,
    category: str,
    priority: str,
    lanes: list[str],
    active_files: int,
    *,
    approval_required: bool,
    package_candidates: list[str] | None = None,
    provider_or_operator_action: str | None = None,
    deferred_until_final_pass: bool = False,
    worker_image_can_help: bool = False,
    safe_next_action: str | None = None,
) -> dict[str, Any]:
    return {
        "id": action_id,
        "title": title,
        "category": category,
        "priority": priority,
        "lanes": lanes,
        "active_files": active_files,
        "approval_required": approval_required,
        "deferred_until_final_pass": deferred_until_final_pass,
        "worker_image_can_help": worker_image_can_help,
        "package_candidates": package_candidates or [],
        "provider_or_operator_action": provider_or_operator_action,
        "safe_next_action": safe_next_action,
    }


def build_packet(
    tool_inventory_path: Path,
    lane_readiness_path: Path,
    worker_approval_packet_path: Path | None = None,
) -> dict[str, Any]:
    tool_inventory = load_json(tool_inventory_path) or {}
    lane_readiness = load_json(lane_readiness_path) or {}
    worker_packet = load_json(worker_approval_packet_path)
    lanes = lane_index(lane_readiness)
    gate = lane_readiness.get("gate") if isinstance(lane_readiness.get("gate"), dict) else {}
    tool_lanes = tool_inventory.get("lanes") if isinstance(tool_inventory.get("lanes"), dict) else {}
    modules = tool_inventory.get("python_modules") if isinstance(tool_inventory.get("python_modules"), dict) else {}

    actions: list[dict[str, Any]] = []

    media_lanes = sorted(set(lanes_with_requirement(lanes, "run_final_media_transcription_keyframe_pass")))
    large_lanes = [
        lane
        for lane in lanes_with_requirement(lanes, "approved_large_file_runner_canary")
        if lane not in media_lanes
    ]
    if large_lanes:
        actions.append(action(
            "approve_large_file_runner_canary",
            "Approve and run bounded large-file extraction canary",
            "operator_approval",
            "critical",
            large_lanes,
            active_files_for(lanes, large_lanes),
            approval_required=True,
            provider_or_operator_action="approve large-file canary before PDF/Office/archive/unknown large rows can be fully extracted",
            safe_next_action="validate approval note, run bounded canary, then verify extraction run and review manifest",
        ))

    ocr_lanes = sorted({
        lane
        for lane in set(lanes_with_missing_block(lanes, "ocr") + lanes_with_missing_block(lanes, "vision_provider_approval"))
        if lane == "needs_ocr_or_vision"
    })
    if ocr_lanes:
        actions.append(action(
            "enable_ocr_or_vision_lane",
            "Install OCR or approve bounded vision provider lane",
            "tool_or_provider",
            "critical",
            ocr_lanes,
            active_files_for(lanes, ocr_lanes),
            approval_required=True,
            package_candidates=["tesseract-ocr"],
            provider_or_operator_action="approve sanitized vision requests or install local OCR for scanned/image rows",
            safe_next_action="prefer local OCR for text-like scans; use approved provider only with bounded redacted request artifacts",
        ))

    archive_lanes = sorted(set(lanes_with_missing_block(lanes, "7z_inventory") + lanes_with_missing_block(lanes, "rar_inventory")))
    if archive_lanes:
        actions.append(action(
            "enable_archive_inventory_tools",
            "Install archive inventory tools or use verified worker image",
            "tooling",
            "high",
            archive_lanes,
            active_files_for(lanes, archive_lanes),
            approval_required=False,
            package_candidates=["p7zip-full", "libarchive-tools", "unrar"],
            worker_image_can_help=True,
            provider_or_operator_action="install host archive tools or approve worker image build/smoke with archive packages",
            safe_next_action="verify archive smoke hashes and member-name redaction before using archive inventories for review jobs",
        ))

    design_lanes = sorted({
        lane
        for lane in set(
            lanes_with_missing_block(lanes, "exif_metadata")
            + lanes_with_missing_block(lanes, "preview")
            + lanes_with_missing_block(lanes, "vision_provider_approval")
        )
        if lane == "needs_design_raw_pipeline"
    })
    if design_lanes:
        actions.append(action(
            "enable_design_raw_preview_metadata",
            "Install EXIF/preview tooling or approve bounded design/raw vision lane",
            "tool_or_provider",
            "high",
            design_lanes,
            active_files_for(lanes, design_lanes),
            approval_required=True,
            package_candidates=["exiftool", "imagemagick"],
            provider_or_operator_action="install EXIF/preview tooling for broad local coverage or approve sanitized vision summaries",
            safe_next_action="keep PIL as best-effort fallback only; do not treat broad design/raw preview coverage as complete without EXIF/preview or approved vision",
        ))

    if media_lanes:
        actions.append(action(
            "run_final_media_transcription_keyframe_pass",
            "Run final audio/video transcription and keyframe pass",
            "deferred_media",
            "deferred",
            media_lanes,
            active_files_for(lanes, media_lanes),
            approval_required=True,
            package_candidates=["ffmpeg"],
            provider_or_operator_action="final-pass media extraction/transcription approval",
            deferred_until_final_pass=True,
            safe_next_action="defer until the final media phase, then require transcripts/keyframes and completion gate before scale",
        ))

    docker_remediation = worker_packet.get("docker_access_remediation") if isinstance(worker_packet, dict) and isinstance(worker_packet.get("docker_access_remediation"), dict) else {}
    if docker_remediation.get("required") is True:
        actions.append(action(
            "grant_worker_docker_access_or_ci",
            "Grant Docker socket access or run worker build/smoke in CI",
            "worker_environment",
            "high",
            sorted({
                lane
                for item in actions
                if item.get("worker_image_can_help") is True
                for lane in item.get("lanes", [])
            }),
            0,
            approval_required=True,
            provider_or_operator_action="grant Docker access to operator session or run approved build/smoke in CI",
            safe_next_action=str(docker_remediation.get("safe_next_action") or "run approved worker image build/smoke with Docker access"),
        ))

    non_deferred_actions = [item for item in actions if item.get("deferred_until_final_pass") is not True]
    approval_actions = [item for item in actions if item.get("approval_required") is True]
    status = "ready" if not non_deferred_actions else "operator_remediation_required"

    source_artifacts = [
        source_entry("tool_inventory", tool_inventory_path),
        source_entry("lane_readiness_gate", lane_readiness_path),
        source_entry("worker_approval_packet", worker_approval_packet_path),
    ]
    required_source_labels = {"tool_inventory", "lane_readiness_gate"}
    if worker_approval_packet_path is not None:
        required_source_labels.add("worker_approval_packet")

    packet = {
        "kind": "open_files_extraction_tool_remediation_packet",
        "version": 1,
        "created_at": now_utc(),
        "status": status,
        "summary": {
            "action_count": len(actions),
            "non_deferred_action_count": len(non_deferred_actions),
            "approval_required_action_count": len(approval_actions),
            "deferred_action_count": len(actions) - len(non_deferred_actions),
            "pending_lanes": gate.get("pending_lanes") if isinstance(gate.get("pending_lanes"), list) else [],
            "requires_operator_approval_before_scale": gate.get("requires_operator_approval_before_scale"),
            "requires_provider_or_tool_work": gate.get("requires_provider_or_tool_work"),
            "final_media_pass_required": gate.get("final_media_pass_required"),
            "python_pil_available": (modules.get("PIL") or {}).get("present") if isinstance(modules.get("PIL"), dict) else None,
        },
        "tool_inventory_status": tool_inventory.get("status"),
        "lane_readiness_status": lane_readiness.get("status"),
        "tool_lane_statuses": {
            lane: details.get("status")
            for lane, details in tool_lanes.items()
            if isinstance(details, dict)
        },
        "actions": actions,
        "non_mutation_attestation": {
            "corpus_files_read": False,
            "corpus_bytes_mutated": False,
            "s3_objects_mutated": False,
            "metadata_rows_mutated": False,
            "search_index_rows_mutated": False,
            "provider_calls_made": False,
        },
        "source_artifacts": source_artifacts,
        "redaction": "aggregate-only remediation packet; no private filenames, file IDs, object keys, source refs, extracted text, transcripts, ACL payloads, row payloads, command logs, or secrets",
    }
    marker_counts = scan_text(json.dumps(packet, sort_keys=True))
    source_by_label = {
        str(item.get("label")): item
        for item in source_artifacts
        if isinstance(item, dict) and item.get("label")
    }
    missing_sources = sorted(
        label
        for label in required_source_labels
        if source_by_label.get(label, {}).get("present") is not True
    )
    invalid_source_hashes = sorted(
        label
        for label in required_source_labels
        if source_by_label.get(label, {}).get("present") is True
        and not valid_sha256(source_by_label.get(label, {}).get("sha256"))
    )
    non_mutation = packet["non_mutation_attestation"]
    non_mutation_attested = (
        non_mutation["corpus_files_read"] is False
        and non_mutation["corpus_bytes_mutated"] is False
        and non_mutation["s3_objects_mutated"] is False
        and non_mutation["metadata_rows_mutated"] is False
        and non_mutation["search_index_rows_mutated"] is False
        and non_mutation["provider_calls_made"] is False
    )
    packet_errors = [f"source_artifact_missing:{label}" for label in missing_sources]
    packet_errors.extend(f"source_artifact_sha256_invalid:{label}" for label in invalid_source_hashes)
    if marker_counts:
        packet_errors.append("sensitive_marker_hits")
    if not non_mutation_attested:
        packet_errors.append("non_mutation_attestation_invalid")
    packet["redaction_check"] = {
        "passed": not marker_counts,
        "sensitive_marker_counts": marker_counts,
    }
    packet["packet_checks"] = {
        "redaction_ok": not marker_counts,
        "required_source_artifacts_present": not missing_sources,
        "source_artifact_hashes_ok": not invalid_source_hashes,
        "non_mutation_attested": non_mutation_attested,
    }
    packet["packet_errors"] = packet_errors
    return packet


def main() -> int:
    parser = argparse.ArgumentParser(description="Build aggregate extraction tool remediation packet.")
    parser.add_argument("--tool-inventory", required=True)
    parser.add_argument("--lane-readiness-gate", required=True)
    parser.add_argument("--worker-approval-packet")
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    packet = build_packet(
        tool_inventory_path=Path(args.tool_inventory).expanduser().resolve(),
        lane_readiness_path=Path(args.lane_readiness_gate).expanduser().resolve(),
        worker_approval_packet_path=Path(args.worker_approval_packet).expanduser().resolve() if args.worker_approval_packet else None,
    )
    output = Path(args.output).expanduser().resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(packet, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print_summary = packet["summary"] if packet["redaction_check"]["passed"] else {
        "action_count": packet["summary"].get("action_count"),
        "non_deferred_action_count": packet["summary"].get("non_deferred_action_count"),
        "approval_required_action_count": packet["summary"].get("approval_required_action_count"),
        "deferred_action_count": packet["summary"].get("deferred_action_count"),
    }
    print(json.dumps({
        "kind": packet["kind"],
        "status": packet["status"],
        "summary": print_summary,
        "redaction_check": packet["redaction_check"],
        "packet_checks": packet["packet_checks"],
        "packet_errors": packet["packet_errors"],
    }, indent=2, sort_keys=True))
    return 0 if not packet["packet_errors"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
