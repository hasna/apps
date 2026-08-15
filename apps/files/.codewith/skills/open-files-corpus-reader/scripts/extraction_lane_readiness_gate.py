#!/usr/bin/env python3
"""Build an aggregate-only readiness gate for extraction lanes.

This script consumes private extraction smoke output but emits only lane-level
counts and statuses. It is intended for adversarial review packets and scale
gates where file IDs, filenames, object keys, and extracted content must not be
exposed.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import time
from pathlib import Path
from typing import Any


EXPECTED_LANES = [
    "readable_now_text",
    "needs_pdf_extractor",
    "needs_office_extractor",
    "needs_ocr_or_vision",
    "needs_transcription",
    "needs_video_pipeline",
    "needs_archive_inventory",
    "needs_design_raw_pipeline",
    "metadata_only_or_unknown",
]

MEDIA_LANES = {"needs_transcription", "needs_video_pipeline"}
PROVIDER_OR_PREVIEW_LANES = {"needs_ocr_or_vision", "needs_design_raw_pipeline"}
HARD_BLOCKING_STATUSES = {
    "failed",
    "missing_tool_inventory",
    "not_implemented",
    "not_sampled",
    "sampled_no_usable_output",
    "tool_required",
    "unrouted_samples",
}
PENDING_STATUSES = {
    "approval_required_large_file_runner",
    "deferred_media",
    "degraded_provider_required",
}
TOOL_STATUS_RANK = {
    "missing": 0,
    "tool_required": 1,
    "deferred": 1,
    "degraded": 2,
    "ready": 3,
}


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


def source_entry(label: str, path: Path | None) -> dict[str, Any]:
    return {
        "label": label,
        "present": bool(path and path.exists()),
        "bytes": path.stat().st_size if path and path.exists() else 0,
        "sha256": file_sha256(path) if path and path.exists() else None,
    }


def table_lookup(rows: Any) -> dict[str, dict[str, int]]:
    output: dict[str, dict[str, int]] = {}
    if not isinstance(rows, list):
        return output
    for row in rows:
        if not isinstance(row, dict):
            continue
        key = row.get("key")
        if not isinstance(key, str):
            continue
        output[key] = {
            "count": int(row.get("count") or 0),
            "bytes": int(row.get("bytes") or 0),
        }
    return output


def nested_lane_readiness(rows: Any) -> dict[str, dict[str, dict[str, int]]]:
    output: dict[str, dict[str, dict[str, int]]] = {}
    for key, stats in table_lookup(rows).items():
        if "|" not in key:
            continue
        lane, readiness = key.split("|", 1)
        output.setdefault(lane, {})[readiness] = stats
    return output


def tool_status(details: dict[str, Any] | None) -> str:
    return str((details or {}).get("status") or "missing")


def missing_blocks(details: dict[str, Any] | None) -> list[str]:
    raw = (details or {}).get("missing_blocks")
    if not isinstance(raw, list):
        return []
    return [str(block) for block in raw]


def select_effective_tool_details(
    host_details: dict[str, Any] | None,
    worker_details: dict[str, Any] | None,
) -> tuple[dict[str, Any] | None, str]:
    if not worker_details:
        return host_details, "host"
    if not host_details:
        return worker_details, "worker"

    host_status = tool_status(host_details)
    worker_status = tool_status(worker_details)
    host_rank = TOOL_STATUS_RANK.get(host_status, 0)
    worker_rank = TOOL_STATUS_RANK.get(worker_status, 0)
    if worker_rank > host_rank:
        return worker_details, "worker"
    if worker_rank == host_rank and len(missing_blocks(worker_details)) < len(missing_blocks(host_details)):
        return worker_details, "worker"
    return host_details, "host"


def smoke_by_lane(summary: dict[str, Any]) -> dict[str, dict[str, int]]:
    raw = summary.get("by_lane")
    if not isinstance(raw, dict):
        return {}
    output: dict[str, dict[str, int]] = {}
    for lane, stats in raw.items():
        if not isinstance(lane, str) or not isinstance(stats, dict):
            continue
        output[lane] = {
            "samples": int(stats.get("samples") or 0),
            "usable": int(stats.get("usable") or 0),
            "routed": int(stats.get("routed") or 0),
            "failed": int(stats.get("failed") or 0),
            "not_implemented": int(stats.get("not_implemented") or 0),
            "skipped_size": int(stats.get("skipped_size") or 0),
        }
    return output


def status_for_lane(
    lane: str,
    active_count: int,
    smoke: dict[str, int],
    tool_details: dict[str, Any] | None,
    large_count: int,
    deferred_media_count: int,
) -> str:
    samples = smoke["samples"]
    routed = smoke["routed"]
    usable = smoke["usable"]
    failed = smoke["failed"]
    not_implemented = smoke["not_implemented"]
    skipped_size = smoke["skipped_size"]
    tool_status = str((tool_details or {}).get("status") or "missing")

    if active_count == 0:
        return "no_active_files"
    if tool_status == "missing":
        return "missing_tool_inventory"
    if failed > 0:
        return "failed"
    if not_implemented > 0:
        return "not_implemented"
    if samples == 0:
        return "not_sampled"
    if routed < samples:
        return "unrouted_samples"
    if lane in MEDIA_LANES and (tool_status == "deferred" or deferred_media_count > 0):
        return "deferred_media"
    if tool_status == "tool_required":
        return "tool_required"
    if tool_status == "degraded" or lane in PROVIDER_OR_PREVIEW_LANES:
        return "degraded_provider_required"
    if large_count > 0 or skipped_size > 0:
        return "approval_required_large_file_runner"
    if samples > 0 and routed > 0 and usable == 0:
        return "sampled_no_usable_output"
    return "ready"


def requirements_for_lane(lane: str, route_status: str, tool_details: dict[str, Any] | None, large_count: int, skipped_size: int) -> list[str]:
    requirements: list[str] = []
    if route_status in {"failed", "not_implemented", "unrouted_samples"}:
        requirements.append("fix_extraction_route_or_smoke_failure")
    if route_status == "not_sampled":
        requirements.append("add_representative_sample_evidence")
    if route_status == "sampled_no_usable_output":
        requirements.append("fix_extraction_route_or_produce_usable_artifact")
    if route_status in {"tool_required", "missing_tool_inventory"}:
        requirements.append("install_or_configure_local_extraction_tool")
    if route_status == "deferred_media":
        requirements.append("run_final_media_transcription_keyframe_pass")
    if route_status == "degraded_provider_required":
        if lane == "needs_ocr_or_vision":
            requirements.append("approve_or_install_ocr_vision_lane")
        elif lane == "needs_design_raw_pipeline":
            requirements.append("approve_or_install_design_preview_vision_lane")
        else:
            requirements.append("resolve_degraded_provider_lane")
    if route_status == "approval_required_large_file_runner" or large_count > 0 or skipped_size > 0:
        requirements.append("approved_large_file_runner_canary")

    missing_blocks = (tool_details or {}).get("missing_blocks")
    if isinstance(missing_blocks, list) and missing_blocks:
        requirements.extend(f"missing_block:{str(block)}" for block in missing_blocks)

    seen: set[str] = set()
    unique: list[str] = []
    for item in requirements:
        if item not in seen:
            unique.append(item)
            seen.add(item)
    return unique


def build_gate(
    corpus_map: dict[str, Any],
    tool_inventory: dict[str, Any],
    smoke_summary: dict[str, Any],
    deferred_media_summary: dict[str, Any] | None,
    sources: list[dict[str, Any]],
    worker_tool_inventory: dict[str, Any] | None = None,
) -> dict[str, Any]:
    aggregate = corpus_map.get("aggregate") if isinstance(corpus_map.get("aggregate"), dict) else {}
    corpus_lanes = table_lookup(aggregate.get("by_lane"))
    corpus_readiness = nested_lane_readiness(aggregate.get("by_lane_readiness"))
    smoke_lanes = smoke_by_lane(smoke_summary)
    tool_lanes = tool_inventory.get("lanes") if isinstance(tool_inventory.get("lanes"), dict) else {}
    worker_tool_lanes = (
        worker_tool_inventory.get("lanes")
        if isinstance(worker_tool_inventory, dict) and isinstance(worker_tool_inventory.get("lanes"), dict)
        else {}
    )
    deferred_lanes = table_lookup((deferred_media_summary or {}).get("by_lane"))

    lanes: list[dict[str, Any]] = []
    for lane in EXPECTED_LANES:
        corpus_stats = corpus_lanes.get(lane, {"count": 0, "bytes": 0})
        active_count = corpus_stats["count"]
        active_bytes = corpus_stats["bytes"]
        smoke = smoke_lanes.get(lane, {
            "samples": 0,
            "usable": 0,
            "routed": 0,
            "failed": 0,
            "not_implemented": 0,
            "skipped_size": 0,
        })
        host_tool_details = tool_lanes.get(lane) if isinstance(tool_lanes.get(lane), dict) else None
        worker_tool_details = worker_tool_lanes.get(lane) if isinstance(worker_tool_lanes.get(lane), dict) else None
        tool_details, tool_source = select_effective_tool_details(host_tool_details, worker_tool_details)
        lane_readiness = corpus_readiness.get(lane, {})
        large_stats = lane_readiness.get("large_file_runner_required", {"count": 0, "bytes": 0})
        deferred_stats = deferred_lanes.get(lane, {"count": 0, "bytes": 0})
        route_status = status_for_lane(
            lane=lane,
            active_count=active_count,
            smoke=smoke,
            tool_details=tool_details,
            large_count=large_stats["count"],
            deferred_media_count=deferred_stats["count"],
        )
        requirements = requirements_for_lane(lane, route_status, tool_details, large_stats["count"], smoke["skipped_size"])
        lanes.append({
            "lane": lane,
            "route_status": route_status,
            "active_files": active_count,
            "active_bytes": active_bytes,
            "smoke": smoke,
            "tool_status": tool_status(tool_details),
            "tool_inventory_source": tool_source,
            "host_tool_status": tool_status(host_tool_details),
            "worker_tool_status": tool_status(worker_tool_details) if worker_tool_details else None,
            "host_missing_blocks": missing_blocks(host_tool_details),
            "worker_missing_blocks": missing_blocks(worker_tool_details) if worker_tool_details else [],
            "provider_required": bool((tool_details or {}).get("provider_required")),
            "large_file_runner_required_files": large_stats["count"],
            "large_file_runner_required_bytes": large_stats["bytes"],
            "deferred_media_files": deferred_stats["count"],
            "deferred_media_bytes": deferred_stats["bytes"],
            "requirements": requirements,
        })

    hard_blockers = [lane for lane in lanes if lane["route_status"] in HARD_BLOCKING_STATUSES]
    pending = [lane for lane in lanes if lane["route_status"] in PENDING_STATUSES]
    no_active = [lane for lane in lanes if lane["route_status"] == "no_active_files"]
    sampled_no_usable = [lane for lane in lanes if lane["route_status"] == "sampled_no_usable_output"]
    routed_lanes = [
        lane
        for lane in lanes
        if lane["route_status"] not in HARD_BLOCKING_STATUSES | {"no_active_files"}
    ]

    status_counts: dict[str, int] = {}
    for lane in lanes:
        status_counts[lane["route_status"]] = status_counts.get(lane["route_status"], 0) + 1

    status = "blocked" if hard_blockers else "pending_completion" if pending else "ready"
    gate = {
        "status": status,
        "all_expected_lanes_present": set(EXPECTED_LANES).issubset(set(tool_lanes.keys())),
        "all_active_lanes_explicitly_routed": not hard_blockers,
        "all_sampled_lanes_routed": all(lane["smoke"]["routed"] >= lane["smoke"]["samples"] for lane in lanes),
        "no_failed_smoke_samples": all(lane["smoke"]["failed"] == 0 for lane in lanes),
        "no_not_implemented_samples": all(lane["smoke"]["not_implemented"] == 0 for lane in lanes),
        "all_sampled_non_deferred_non_approval_lanes_have_usable_output": not sampled_no_usable,
        "full_extraction_complete": status == "ready" and not no_active,
        "requires_operator_approval_before_scale": any(
            lane["large_file_runner_required_files"] > 0 or lane["smoke"]["skipped_size"] > 0
            for lane in lanes
        ),
        "requires_provider_or_tool_work": any(
            lane["route_status"] in {"degraded_provider_required", "tool_required", "missing_tool_inventory"}
            for lane in lanes
        ),
        "final_media_pass_required": any(lane["route_status"] == "deferred_media" for lane in lanes),
        "cannot_hide_unknown_or_unimplemented_lanes": not any(
            lane["route_status"] in {"missing_tool_inventory", "not_implemented", "not_sampled", "unrouted_samples"}
            for lane in lanes
        ),
        "hard_blocker_lanes": [lane["lane"] for lane in hard_blockers],
        "sampled_no_usable_lanes": [lane["lane"] for lane in sampled_no_usable],
        "pending_lanes": [lane["lane"] for lane in pending],
    }

    totals = {
        "active_files": int((corpus_map.get("totals") or {}).get("active_files") or sum(lane["active_files"] for lane in lanes)),
        "active_bytes": int((corpus_map.get("totals") or {}).get("active_bytes") or sum(lane["active_bytes"] for lane in lanes)),
        "sampled_files": sum(lane["smoke"]["samples"] for lane in lanes),
        "sampled_routed_files": sum(lane["smoke"]["routed"] for lane in lanes),
        "sampled_usable_files": sum(lane["smoke"]["usable"] for lane in lanes),
        "sampled_failed_files": sum(lane["smoke"]["failed"] for lane in lanes),
        "sampled_not_implemented_files": sum(lane["smoke"]["not_implemented"] for lane in lanes),
        "large_file_runner_required_files": sum(lane["large_file_runner_required_files"] for lane in lanes),
        "deferred_media_files": sum(lane["deferred_media_files"] for lane in lanes),
        "routed_lanes": len(routed_lanes),
        "pending_lanes": len(pending),
        "hard_blocker_lanes": len(hard_blockers),
        "sampled_no_usable_lanes": len(sampled_no_usable),
        "no_active_lanes": len(no_active),
    }

    return {
        "kind": "open_files_extraction_lane_readiness_gate",
        "version": 1,
        "created_at": now_utc(),
        "status": status,
        "redaction": "aggregate-only; ignores private smoke results and emits no file IDs, filenames, object keys, source refs, extracted text, transcripts, ACL payloads, or row payloads",
        "source_artifacts": sources,
        "totals": totals,
        "status_counts": dict(sorted(status_counts.items())),
        "gate": gate,
        "lanes": lanes,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Build aggregate-only extraction lane readiness gate.")
    parser.add_argument("--corpus-map", required=True, help="Public corpus map JSON")
    parser.add_argument("--tool-inventory", required=True, help="Extraction tool inventory JSON")
    parser.add_argument("--worker-tool-inventory", help="Optional worker-produced extraction tool inventory JSON")
    parser.add_argument("--smoke-summary", required=True, help="Private extraction smoke summary JSON")
    parser.add_argument("--deferred-media-summary", help="Optional deferred media completion summary JSON")
    parser.add_argument("--output", default=".codewith/private-artifacts/extraction-lane-readiness-gate.json")
    args = parser.parse_args()

    corpus_path = Path(args.corpus_map).expanduser().resolve()
    tool_path = Path(args.tool_inventory).expanduser().resolve()
    worker_tool_path = Path(args.worker_tool_inventory).expanduser().resolve() if args.worker_tool_inventory else None
    smoke_path = Path(args.smoke_summary).expanduser().resolve()
    media_path = Path(args.deferred_media_summary).expanduser().resolve() if args.deferred_media_summary else None

    gate = build_gate(
        corpus_map=load_json(corpus_path),
        tool_inventory=load_json(tool_path),
        smoke_summary=load_json(smoke_path),
        deferred_media_summary=load_json(media_path) if media_path and media_path.exists() else None,
        sources=[
            source_entry("corpus_map", corpus_path),
            source_entry("tool_inventory", tool_path),
            source_entry("worker_tool_inventory", worker_tool_path),
            source_entry("smoke_summary", smoke_path),
            source_entry("deferred_media_summary", media_path),
        ],
        worker_tool_inventory=load_json(worker_tool_path) if worker_tool_path and worker_tool_path.exists() else None,
    )

    output = Path(args.output).expanduser().resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(gate, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps({key: gate[key] for key in ("kind", "status", "totals", "status_counts", "gate")}, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
