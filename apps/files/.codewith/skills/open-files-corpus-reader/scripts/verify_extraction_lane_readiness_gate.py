#!/usr/bin/env python3
"""Verify aggregate extraction lane readiness gate freshness and consistency."""

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


DEFAULT_GATE = ".codewith/private-artifacts/extraction-lane-readiness-gate.json"
DEFAULT_CORPUS_MAP = ".codewith/private-artifacts/corpus-map/corpus-map-public.json"
DEFAULT_TOOL_INVENTORY = ".codewith/private-artifacts/extraction-tool-inventory.json"
DEFAULT_WORKER_TOOL_INVENTORY = ".codewith/private-artifacts/extraction-worker-tool-inventory.json"
DEFAULT_SMOKE_SUMMARY = ".codewith/private-artifacts/extraction-smoke-summary.json"
DEFAULT_DEFERRED_MEDIA_SUMMARY = ".codewith/private-artifacts/deferred-media-completion/deferred-media-completion-summary.json"
DEFAULT_OUTPUT = ".codewith/private-artifacts/extraction-lane-readiness-verification.json"

SCRIPT_DIR = Path(__file__).resolve().parent
BUILDER_PATH = SCRIPT_DIR / "extraction_lane_readiness_gate.py"

EXPECTED_SOURCE_LABELS = {
    "corpus_map",
    "tool_inventory",
    "worker_tool_inventory",
    "smoke_summary",
    "deferred_media_summary",
}

ALLOWED_STATUSES = {"ready", "pending_completion", "blocked"}

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


def load_builder() -> ModuleType:
    spec = importlib.util.spec_from_file_location("extraction_lane_readiness_gate_builder", BUILDER_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError("failed_to_load_extraction_lane_readiness_gate_builder")
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
        "corpus_map": Path(DEFAULT_CORPUS_MAP).expanduser().resolve(),
        "tool_inventory": Path(DEFAULT_TOOL_INVENTORY).expanduser().resolve(),
        "worker_tool_inventory": Path(DEFAULT_WORKER_TOOL_INVENTORY).expanduser().resolve(),
        "smoke_summary": Path(DEFAULT_SMOKE_SUMMARY).expanduser().resolve(),
        "deferred_media_summary": Path(DEFAULT_DEFERRED_MEDIA_SUMMARY).expanduser().resolve(),
    }


def source_by_label(gate: dict[str, Any]) -> dict[str, dict[str, Any]]:
    output: dict[str, dict[str, Any]] = {}
    for item in list_value(gate.get("source_artifacts")):
        if isinstance(item, dict) and isinstance(item.get("label"), str):
            output[item["label"]] = item
    return output


def lane_by_name(gate: dict[str, Any]) -> dict[str, dict[str, Any]]:
    output: dict[str, dict[str, Any]] = {}
    for item in list_value(gate.get("lanes")):
        if isinstance(item, dict) and isinstance(item.get("lane"), str):
            output[item["lane"]] = item
    return output


def semantic_projection(gate: dict[str, Any]) -> dict[str, Any]:
    return {
        "kind": gate.get("kind"),
        "version": gate.get("version"),
        "status": gate.get("status"),
        "redaction": gate.get("redaction"),
        "source_artifacts": gate.get("source_artifacts"),
        "totals": gate.get("totals"),
        "status_counts": gate.get("status_counts"),
        "gate": gate.get("gate"),
        "lanes": gate.get("lanes"),
    }


def expected_gate_from_sources(source_paths: dict[str, Path]) -> dict[str, Any]:
    builder = load_builder()
    worker_path = source_paths["worker_tool_inventory"]
    deferred_path = source_paths["deferred_media_summary"]
    worker_inventory = load_json(worker_path) if worker_path.exists() else None
    deferred_media = load_json(deferred_path) if deferred_path.exists() else None
    return builder.build_gate(
        corpus_map=load_json(source_paths["corpus_map"]),
        tool_inventory=load_json(source_paths["tool_inventory"]),
        smoke_summary=load_json(source_paths["smoke_summary"]),
        deferred_media_summary=deferred_media,
        sources=[
            builder.source_entry("corpus_map", source_paths["corpus_map"]),
            builder.source_entry("tool_inventory", source_paths["tool_inventory"]),
            builder.source_entry("worker_tool_inventory", worker_path),
            builder.source_entry("smoke_summary", source_paths["smoke_summary"]),
            builder.source_entry("deferred_media_summary", deferred_path),
        ],
        worker_tool_inventory=worker_inventory,
    )


def expected_status_from_lanes(gate: dict[str, Any]) -> tuple[str, list[str], list[str]]:
    builder = load_builder()
    hard = [
        lane
        for lane in list_value(gate.get("lanes"))
        if isinstance(lane, dict) and lane.get("route_status") in builder.HARD_BLOCKING_STATUSES
    ]
    pending = [
        lane
        for lane in list_value(gate.get("lanes"))
        if isinstance(lane, dict) and lane.get("route_status") in builder.PENDING_STATUSES
    ]
    status = "blocked" if hard else "pending_completion" if pending else "ready"
    return status, [str(item.get("lane")) for item in hard], [str(item.get("lane")) for item in pending]


def verify_gate(
    gate_path: Path,
    *,
    source_paths: dict[str, Path] | None = None,
) -> dict[str, Any]:
    errors: list[str] = []
    warnings: list[str] = []
    gate = load_json(gate_path)

    if gate.get("kind") != "open_files_extraction_lane_readiness_gate":
        add_error(errors, "invalid_kind")
    if gate.get("version") != 1:
        add_error(errors, "invalid_version")
    if gate.get("status") not in ALLOWED_STATUSES:
        add_error(errors, "invalid_status")

    marker_counts = scan_text(json.dumps(gate, sort_keys=True))
    if marker_counts:
        add_error(errors, "sensitive_marker_hits")

    lanes = lane_by_name(gate)
    expected_lanes = set(load_builder().EXPECTED_LANES)
    missing_lanes = sorted(expected_lanes - set(lanes))
    extra_lanes = sorted(set(lanes) - expected_lanes)
    for lane in missing_lanes:
        add_error(errors, "missing_lane", lane)
    for lane in extra_lanes:
        add_error(errors, "unexpected_lane", lane)

    status_counts: dict[str, int] = {}
    for lane_name, lane in lanes.items():
        status = lane.get("route_status")
        if not isinstance(status, str):
            add_error(errors, "lane_missing_route_status", lane_name)
            continue
        status_counts[status] = status_counts.get(status, 0) + 1
        for field in ("active_files", "active_bytes", "large_file_runner_required_files", "deferred_media_files"):
            if int(lane.get(field) or 0) < 0:
                add_error(errors, "negative_lane_count", f"{lane_name}:{field}")
    if dict(sorted(status_counts.items())) != gate.get("status_counts"):
        add_error(errors, "status_counts_mismatch")

    expected_status, hard_lanes, pending_lanes = expected_status_from_lanes(gate)
    if gate.get("status") != expected_status:
        add_error(errors, "status_mismatch", str(expected_status))

    totals = dict_value(gate.get("totals"))
    expected_totals = {
        "active_files": sum(int(lane.get("active_files") or 0) for lane in lanes.values()),
        "active_bytes": sum(int(lane.get("active_bytes") or 0) for lane in lanes.values()),
        "sampled_files": sum(int(dict_value(lane.get("smoke")).get("samples") or 0) for lane in lanes.values()),
        "sampled_routed_files": sum(int(dict_value(lane.get("smoke")).get("routed") or 0) for lane in lanes.values()),
        "sampled_usable_files": sum(int(dict_value(lane.get("smoke")).get("usable") or 0) for lane in lanes.values()),
        "sampled_failed_files": sum(int(dict_value(lane.get("smoke")).get("failed") or 0) for lane in lanes.values()),
        "sampled_not_implemented_files": sum(int(dict_value(lane.get("smoke")).get("not_implemented") or 0) for lane in lanes.values()),
        "large_file_runner_required_files": sum(int(lane.get("large_file_runner_required_files") or 0) for lane in lanes.values()),
        "deferred_media_files": sum(int(lane.get("deferred_media_files") or 0) for lane in lanes.values()),
        "pending_lanes": len(pending_lanes),
        "hard_blocker_lanes": len(hard_lanes),
        "sampled_no_usable_lanes": len([lane for lane in lanes.values() if lane.get("route_status") == "sampled_no_usable_output"]),
        "no_active_lanes": len([lane for lane in lanes.values() if lane.get("route_status") == "no_active_files"]),
    }
    for key, expected in expected_totals.items():
        if totals.get(key) != expected:
            add_error(errors, "totals_mismatch", key)

    gate_flags = dict_value(gate.get("gate"))
    if sorted(gate_flags.get("hard_blocker_lanes") or []) != sorted(hard_lanes):
        add_error(errors, "gate_hard_blocker_lanes_mismatch")
    if sorted(gate_flags.get("pending_lanes") or []) != sorted(pending_lanes):
        add_error(errors, "gate_pending_lanes_mismatch")
    if gate_flags.get("all_active_lanes_explicitly_routed") is not (len(hard_lanes) == 0):
        add_error(errors, "gate_all_active_lanes_explicitly_routed_mismatch")
    if gate_flags.get("full_extraction_complete") is True and gate.get("status") != "ready":
        add_error(errors, "full_extraction_complete_without_ready_status")

    by_label = source_by_label(gate)
    missing_source_labels = sorted(EXPECTED_SOURCE_LABELS - set(by_label))
    for label in missing_source_labels:
        add_error(errors, "missing_source_artifact", label)
    for label, item in by_label.items():
        if label not in EXPECTED_SOURCE_LABELS:
            warnings.append(f"unexpected_source_artifact:{label}")
            continue
        if item.get("present") is True:
            if int(item.get("bytes") or 0) <= 0:
                add_error(errors, "source_artifact_empty", label)
            if not isinstance(item.get("sha256"), str) or not re.fullmatch(r"[0-9a-f]{64}", item["sha256"]):
                add_error(errors, "source_artifact_sha256_invalid", label)
        elif label != "worker_tool_inventory":
            add_error(errors, "source_artifact_not_present", label)

    current_checked_labels: list[str] = []
    current_mismatched_labels: list[str] = []
    current_missing_path_labels: list[str] = []
    semantic_current = None
    if source_paths is not None:
        for label in sorted(EXPECTED_SOURCE_LABELS):
            path = source_paths.get(label)
            item = by_label.get(label, {})
            if path is None:
                current_missing_path_labels.append(label)
                add_error(errors, "source_artifact_current_path_missing", label)
                continue
            current_checked_labels.append(label)
            if not path.exists():
                if item.get("present") is True:
                    current_missing_path_labels.append(label)
                    add_error(errors, "source_artifact_current_path_missing", label)
                continue
            if item.get("bytes") != path.stat().st_size or item.get("sha256") != file_sha256(path):
                current_mismatched_labels.append(label)
                add_error(errors, "source_artifact_current_sha256_mismatch", label)
        if not current_missing_path_labels:
            try:
                expected = expected_gate_from_sources(source_paths)
                semantic_current = semantic_projection(gate) == semantic_projection(expected)
                if not semantic_current:
                    add_error(errors, "semantic_projection_mismatch")
            except Exception as exc:  # pragma: no cover - defensive CLI boundary
                add_error(errors, "expected_gate_rebuild_failed", f"{type(exc).__name__}:{exc}")

    checks = {
        "kind_ok": gate.get("kind") == "open_files_extraction_lane_readiness_gate",
        "status_valid": gate.get("status") in ALLOWED_STATUSES,
        "expected_lanes_present": not missing_lanes and not extra_lanes,
        "status_counts_consistent": "status_counts_mismatch" not in errors,
        "totals_consistent": not any(error.startswith("totals_mismatch") for error in errors),
        "gate_flags_consistent": not any(error.startswith("gate_") for error in errors),
        "redaction_ok": not marker_counts,
        "source_artifacts_present": EXPECTED_SOURCE_LABELS <= set(by_label),
        "source_artifacts_current": not current_mismatched_labels and not current_missing_path_labels if source_paths is not None else None,
        "semantic_projection_current": semantic_current,
    }

    return {
        "kind": "open_files_extraction_lane_readiness_gate_verification",
        "version": 1,
        "created_at": now_utc(),
        "status": "ok" if not errors else "error",
        "gate_status": gate.get("status"),
        "summary": {
            "active_files": totals.get("active_files"),
            "active_bytes": totals.get("active_bytes"),
            "sampled_files": totals.get("sampled_files"),
            "sampled_usable_files": totals.get("sampled_usable_files"),
            "large_file_runner_required_files": totals.get("large_file_runner_required_files"),
            "deferred_media_files": totals.get("deferred_media_files"),
            "pending_lanes": totals.get("pending_lanes"),
            "hard_blocker_lanes": totals.get("hard_blocker_lanes"),
            "status_counts": gate.get("status_counts"),
        },
        "checks": checks,
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
        "redaction": "aggregate-only extraction-readiness verification; no private filenames, file IDs, object keys, source refs, extracted text, transcripts, row payloads, command logs, or secrets",
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Verify aggregate extraction lane readiness gate.")
    parser.add_argument("--gate", default=DEFAULT_GATE)
    parser.add_argument("--corpus-map", default=DEFAULT_CORPUS_MAP)
    parser.add_argument("--tool-inventory", default=DEFAULT_TOOL_INVENTORY)
    parser.add_argument("--worker-tool-inventory", default=DEFAULT_WORKER_TOOL_INVENTORY)
    parser.add_argument("--smoke-summary", default=DEFAULT_SMOKE_SUMMARY)
    parser.add_argument("--deferred-media-summary", default=DEFAULT_DEFERRED_MEDIA_SUMMARY)
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
    args = parser.parse_args()

    source_paths: dict[str, Path] | None = None
    if not args.skip_current_source_check:
        source_paths = {
            "corpus_map": Path(args.corpus_map).expanduser().resolve(),
            "tool_inventory": Path(args.tool_inventory).expanduser().resolve(),
            "worker_tool_inventory": Path(args.worker_tool_inventory).expanduser().resolve(),
            "smoke_summary": Path(args.smoke_summary).expanduser().resolve(),
            "deferred_media_summary": Path(args.deferred_media_summary).expanduser().resolve(),
        }
        for label, path in args.source:
            source_paths[label] = path

    result = verify_gate(
        Path(args.gate).expanduser().resolve(),
        source_paths=source_paths,
    )
    output = Path(args.output).expanduser().resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps({
        "kind": result["kind"],
        "status": result["status"],
        "gate_status": result["gate_status"],
        "summary": result["summary"],
        "errors": result["errors"],
        "warnings": result["warnings"],
    }, indent=2, sort_keys=True))
    return 0 if result["status"] == "ok" else 1


if __name__ == "__main__":
    raise SystemExit(main())
