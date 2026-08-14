#!/usr/bin/env python3
"""Build a redacted approval packet for large-file extraction execution."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import shlex
import sys
import time
from pathlib import Path
from typing import Any


SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))

from validate_large_file_extraction_plan import validate_plan  # noqa: E402

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


def finalize_packet(packet: dict[str, Any]) -> dict[str, Any]:
    marker_counts = scan_text(json.dumps(packet, sort_keys=True))
    source_artifacts = packet.get("source_artifacts") if isinstance(packet.get("source_artifacts"), list) else []
    validation = packet.get("validation") if isinstance(packet.get("validation"), dict) else {}
    packet["redaction_check"] = {
        "passed": not marker_counts,
        "sensitive_marker_counts": marker_counts,
    }
    packet["packet_errors"] = ["sensitive_marker_hits"] if marker_counts else []
    packet["approval_packet_checks"] = {
        "validation_ok": validation.get("status") == "ok",
        "redaction_ok": not marker_counts,
        "source_artifacts_present": bool(source_artifacts) and all(item.get("present") is True for item in source_artifacts if isinstance(item, dict)),
        "source_artifact_hashes_ok": bool(source_artifacts) and all(isinstance(item.get("sha256"), str) and re.fullmatch(r"[0-9a-f]{64}", item["sha256"]) for item in source_artifacts if isinstance(item, dict)),
    }
    return packet


def load_json(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise SystemExit(f"invalid JSON object: {path}")
    return value


def quote_cmd(parts: list[str]) -> str:
    return " ".join(shlex.quote(part) for part in parts)


def script_path(name: str) -> str:
    return str(SCRIPT_DIR / name)


def build_packet(
    plan_path: Path,
    canary_jobs: int,
    canary_max_bytes: int,
    max_download_bytes: int,
    max_artifact_bytes: int,
    run_output_dir: str | None,
    review_output: str | None,
) -> dict[str, Any]:
    plan_path = plan_path.expanduser().resolve()
    plan = load_json(plan_path)
    validation = validate_plan(plan_path)
    plan_dir = str(plan_path.parent)
    run_dir = run_output_dir or str(plan_path.parent / "large-file-run")
    dry_run_summary = str(plan_path.parent / "large-file-run-dry-run-summary.json")
    review_manifest = review_output or str(plan_path.parent / "large-file-review-jobs.jsonl")

    packet = {
        "generated_at": now_utc(),
        "kind": "large_file_extraction_approval_packet",
        "plan": str(plan_path),
        "source_artifacts": [
            source_artifact("large_file_extraction_plan", plan_path),
        ],
        "plan_status": plan.get("status"),
        "approved": bool(plan.get("approved")),
        "validation": {
            "status": validation["status"],
            "jobs_from_shards": validation["jobs_from_shards"],
            "bytes_from_shards": validation["bytes_from_shards"],
            "duplicate_private_file_ids": validation["duplicate_private_file_ids"],
            "plan_sensitive_marker_hits": validation["plan_sensitive_marker_hits"],
            "plan_private_id_leaks": validation["plan_private_id_leaks"],
            "errors": validation["errors"],
            "warnings": validation["warnings"],
        },
        "planned": {
            "jobs": plan.get("jobs_planned"),
            "bytes": plan.get("bytes_planned"),
            "shards": plan.get("shards"),
            "lanes": plan.get("lanes"),
            "min_size_bytes": plan.get("min_size_bytes"),
            "max_size_bytes": plan.get("max_size_bytes"),
            "aggregate": plan.get("aggregate", {}),
        },
        "approval_required": not bool(plan.get("approved")),
        "operator_decision": {
            "approve_only_after_review": True,
            "recommended_first_execution": "small balanced canary with tight source/download/artifact caps and no kept downloads",
            "do_not_execute_if": [
                "validation.status is not ok",
                "plan_private_id_leaks or sensitive marker hits are nonzero",
                "approval note is missing",
                "selected source bytes exceed the operator-approved canary cap",
                "review artifact verification is not enabled after execution",
            ],
        },
        "commands": {
            "validate": quote_cmd([
                "python3",
                script_path("validate_large_file_extraction_plan.py"),
                "--plan",
                str(plan_path),
            ]),
            "dry_run_canary": quote_cmd([
                "python3",
                script_path("run_large_file_extraction_plan.py"),
                "--plan",
                str(plan_path),
                "--max-jobs",
                str(canary_jobs),
                "--summary-output",
                dry_run_summary,
            ]),
            "verify_dry_run": quote_cmd([
                "python3",
                script_path("verify_large_file_extraction_run.py"),
                "--plan",
                str(plan_path),
                "--summary",
                dry_run_summary,
            ]),
            "regenerate_approved_plan": quote_cmd([
                "python3",
                script_path("plan_large_file_extraction.py"),
                "--output-dir",
                plan_dir,
                "--min-size-bytes",
                str(plan.get("min_size_bytes") or 1024 * 1024),
                "--jobs-per-shard",
                str(plan.get("jobs_per_shard") or 100),
                "--order",
                str(plan.get("order") or "size-desc"),
                "--approved",
                "--approval-note-file",
                ".codewith/private-artifacts/operator-approvals/large_file_canary.json",
            ]),
            "execute_canary_after_approval": quote_cmd([
                "python3",
                script_path("run_large_file_extraction_plan.py"),
                "--plan",
                str(plan_path),
                "--execute",
                "--max-jobs",
                str(canary_jobs),
                "--max-planned-bytes",
                str(canary_max_bytes),
                "--max-download-bytes",
                str(max_download_bytes),
                "--max-artifact-bytes",
                str(max_artifact_bytes),
                "--output-dir",
                run_dir,
            ]),
            "verify_canary_after_execution": quote_cmd([
                "python3",
                script_path("verify_large_file_extraction_run.py"),
                "--plan",
                str(plan_path),
                "--run-dir",
                run_dir,
                "--require-complete",
                "--check-review-artifacts",
            ]),
            "collect_review_manifest_after_verification": quote_cmd([
                "python3",
                script_path("collect_large_file_review_manifest.py"),
                "--run-dir",
                run_dir,
                "--output",
                review_manifest,
            ]),
        },
        "redaction": "packet omits file IDs, filenames, paths, object keys, source refs, OCR text, transcripts, and row payloads",
    }
    return finalize_packet(packet)


def main() -> int:
    parser = argparse.ArgumentParser(description="Build a redacted large-file extraction approval packet.")
    parser.add_argument("--plan", required=True, help="Path to large-file-extraction-plan.json")
    parser.add_argument("--canary-jobs", type=int, default=9)
    parser.add_argument("--canary-max-bytes", type=int, default=40 * 1024 * 1024)
    parser.add_argument("--max-download-bytes", type=int, default=25 * 1024 * 1024)
    parser.add_argument("--max-artifact-bytes", type=int, default=256 * 1024 * 1024)
    parser.add_argument("--run-output-dir", help="Private output directory for approved canary command")
    parser.add_argument("--review-output", help="Private review manifest output path for collect command")
    parser.add_argument("--output", help="Optional JSON output path")
    args = parser.parse_args()

    if args.canary_jobs <= 0:
        raise SystemExit("--canary-jobs must be positive")
    if args.canary_max_bytes <= 0 or args.max_download_bytes <= 0 or args.max_artifact_bytes <= 0:
        raise SystemExit("byte caps must be positive")

    packet = build_packet(
        Path(args.plan),
        args.canary_jobs,
        args.canary_max_bytes,
        args.max_download_bytes,
        args.max_artifact_bytes,
        args.run_output_dir,
        args.review_output,
    )
    output = json.dumps(packet, indent=2, sort_keys=True)
    print(output)
    if args.output:
        output_path = Path(args.output).expanduser().resolve()
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(output + "\n", encoding="utf-8")
    checks = packet.get("approval_packet_checks") if isinstance(packet.get("approval_packet_checks"), dict) else {}
    return 0 if checks.get("validation_ok") is True and checks.get("redaction_ok") is True else 1


if __name__ == "__main__":
    raise SystemExit(main())
