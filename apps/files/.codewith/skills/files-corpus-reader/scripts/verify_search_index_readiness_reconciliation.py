#!/usr/bin/env python3
"""Verify search-index plan completeness against extraction readiness lanes."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import time
from pathlib import Path
from typing import Any


DEFAULT_PLAN = ".codewith/private-artifacts/search-index-current-plan/search-index-population-plan.json"
DEFAULT_READINESS = ".codewith/private-artifacts/extraction-lane-readiness-gate.json"
DEFAULT_OUTPUT = ".codewith/private-artifacts/search-index-current-plan/search-index-readiness-reconciliation.json"

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


def source_artifact(label: str, path: Path) -> dict[str, Any]:
    return {
        "label": label,
        "present": path.exists(),
        "bytes": path.stat().st_size if path.exists() else 0,
        "sha256": file_sha256(path) if path.exists() else None,
    }


def scan_text(text: str) -> dict[str, int]:
    counts: dict[str, int] = {}
    for code, pattern in SENSITIVE_PATTERNS:
        count = len(pattern.findall(text))
        if count:
            counts[code] = count
    return counts


def load_json(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise SystemExit(f"expected JSON object: {path}")
    return value


def outcome_lane_totals(plan: dict[str, Any]) -> dict[str, dict[str, Any]]:
    aggregate = (((plan.get("completeness") or {}).get("aggregate") or {}) if isinstance(plan.get("completeness"), dict) else {})
    rows = aggregate.get("by_outcome_lane") if isinstance(aggregate, dict) else None
    totals: dict[str, dict[str, Any]] = {}
    if not isinstance(rows, list):
        return totals
    for row in rows:
        if not isinstance(row, dict):
            continue
        key = str(row.get("key") or "")
        if "|" not in key:
            continue
        outcome, lane = key.split("|", 1)
        entry = totals.setdefault(lane, {"count": 0, "bytes": 0, "outcomes": {}})
        count = int(row.get("count") or 0)
        bytes_ = int(row.get("bytes") or 0)
        entry["count"] += count
        entry["bytes"] += bytes_
        entry["outcomes"][outcome] = {"count": count, "bytes": bytes_}
    return totals


def readiness_lane_totals(readiness: dict[str, Any]) -> dict[str, dict[str, int]]:
    lanes = readiness.get("lanes")
    if not isinstance(lanes, list):
        return {}
    output: dict[str, dict[str, int]] = {}
    for lane in lanes:
        if not isinstance(lane, dict):
            continue
        name = str(lane.get("lane") or "")
        if not name:
            continue
        output[name] = {
            "count": int(lane.get("active_files") or 0),
            "bytes": int(lane.get("active_bytes") or 0),
        }
    return output


def build_reconciliation(plan_path: Path, readiness_path: Path) -> dict[str, Any]:
    plan_path = plan_path.expanduser().resolve()
    readiness_path = readiness_path.expanduser().resolve()
    plan = load_json(plan_path)
    readiness = load_json(readiness_path)
    plan_lanes = outcome_lane_totals(plan)
    readiness_lanes = readiness_lane_totals(readiness)
    errors: list[str] = []
    lanes: list[dict[str, Any]] = []
    for lane in sorted(set(plan_lanes) | set(readiness_lanes)):
        planned = plan_lanes.get(lane, {"count": 0, "bytes": 0, "outcomes": {}})
        ready = readiness_lanes.get(lane, {"count": 0, "bytes": 0})
        count_delta = int(ready["count"]) - int(planned["count"])
        byte_delta = int(ready["bytes"]) - int(planned["bytes"])
        if count_delta or byte_delta:
            errors.append(f"lane_mismatch:{lane}")
        lanes.append({
            "lane": lane,
            "readiness": ready,
            "search_index_completeness": {
                "count": planned["count"],
                "bytes": planned["bytes"],
                "outcomes": planned.get("outcomes", {}),
            },
            "delta": {
                "count": count_delta,
                "bytes": byte_delta,
            },
        })

    declared = plan.get("declared_totals") if isinstance(plan.get("declared_totals"), dict) else {}
    readiness_totals = readiness.get("totals") if isinstance(readiness.get("totals"), dict) else {}
    declared_active = int(declared.get("active_files") or 0)
    readiness_active = int(readiness_totals.get("active_files") or 0)
    declared_bytes = int(declared.get("active_bytes") or 0)
    readiness_bytes = int(readiness_totals.get("active_bytes") or 0)
    if declared_active != readiness_active:
        errors.append("declared_active_files_mismatch")
    if declared_bytes != readiness_bytes:
        errors.append("declared_active_bytes_mismatch")

    result = {
        "kind": "open_files_search_index_readiness_reconciliation",
        "version": 1,
        "created_at": now_utc(),
        "status": "ok" if not errors else "error",
        "plan": str(plan_path),
        "readiness_gate": str(readiness_path),
        "source_artifacts": [
            source_artifact("search_index_plan", plan_path),
            source_artifact("extraction_readiness_gate", readiness_path),
        ],
        "totals": {
            "declared_active_files": declared_active,
            "readiness_active_files": readiness_active,
            "declared_active_bytes": declared_bytes,
            "readiness_active_bytes": readiness_bytes,
            "lanes": len(lanes),
            "mismatched_lanes": len([lane for lane in lanes if lane["delta"]["count"] or lane["delta"]["bytes"]]),
        },
        "lanes": lanes,
        "errors": errors,
        "redaction": "aggregate-only; no file IDs, filenames, object keys, source refs, extracted text, transcripts, row payloads, or secrets",
    }
    marker_counts = scan_text(json.dumps(result, sort_keys=True))
    if marker_counts:
        errors.append("sensitive_marker_hits")
    result["status"] = "ok" if not errors else "error"
    result["redaction_check"] = {
        "passed": not marker_counts,
        "sensitive_marker_counts": marker_counts,
    }
    result["errors"] = errors
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description="Verify search-index completeness against extraction readiness lanes.")
    parser.add_argument("--plan", default=DEFAULT_PLAN)
    parser.add_argument("--readiness-gate", default=DEFAULT_READINESS)
    parser.add_argument("--output", default=DEFAULT_OUTPUT)
    args = parser.parse_args()

    result = build_reconciliation(
        Path(args.plan).expanduser().resolve(),
        Path(args.readiness_gate).expanduser().resolve(),
    )
    output = Path(args.output).expanduser().resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps({
        "kind": result["kind"],
        "status": result["status"],
        "totals": result["totals"],
        "errors": result["errors"],
    }, indent=2, sort_keys=True))
    return 0 if result["status"] == "ok" else 1


if __name__ == "__main__":
    raise SystemExit(main())
