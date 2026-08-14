#!/usr/bin/env python3
"""Verify a large-file extraction run without leaking private row data."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any


SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))

from validate_large_file_extraction_plan import load_jsonl, resolve_path, validate_plan  # noqa: E402


SENSITIVE_PATTERNS = (
    re.compile(r'"file_id"\s*:'),
    re.compile(r'"f_[A-Za-z0-9_:-]+"'),
    re.compile(r"open-files://"),
    re.compile(r"objects/sha256/"),
    re.compile(r'"source_ref"\s*:'),
    re.compile(r'"object_key"\s*:'),
    re.compile(r'"transcript"\s*:'),
    re.compile(r'"extracted_text"\s*:'),
)


@dataclass(frozen=True)
class Issue:
    code: str
    location: str
    message: str

    def to_json(self) -> dict[str, str]:
        return {"code": self.code, "location": self.location, "message": self.message}


def load_json(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise SystemExit(f"invalid JSON object: {path}")
    return value


def load_results(path: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    with path.open("r", encoding="utf-8") as handle:
        for line_no, line in enumerate(handle, start=1):
            stripped = line.strip()
            if not stripped:
                continue
            value = json.loads(stripped)
            if not isinstance(value, dict):
                raise SystemExit(f"invalid result JSONL at line {line_no}: row is not an object")
            rows.append(value)
    return rows


def hash_file_ids(rows_or_ids: list[Any]) -> str:
    ids: list[str] = []
    for item in rows_or_ids:
        if isinstance(item, str):
            ids.append(item)
        elif isinstance(item, dict) and isinstance(item.get("file_id"), str):
            ids.append(item["file_id"])
    digest = hashlib.sha256()
    for file_id in ids:
        digest.update(file_id.encode("utf-8"))
        digest.update(b"\n")
    return digest.hexdigest()


def status_counts(rows: list[dict[str, Any]]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for row in rows:
        status = str(row.get("status") or "unknown")
        counts[status] = counts.get(status, 0) + 1
    return dict(sorted(counts.items()))


def selected_rows_from_plan(plan: dict[str, Any], plan_root: Path, jobs_selected: int) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    entries = [entry for entry in plan.get("shard_entries", []) if isinstance(entry, dict)]
    for entry in entries:
        shard = resolve_path(entry.get("manifest"), plan_root)
        if shard is None or not shard.exists():
            continue
        rows.extend(load_jsonl(shard))
        if len(rows) >= jobs_selected:
            return rows[:jobs_selected]
    return rows


def public_summary_leak_count(summary_path: Path) -> int:
    text = summary_path.read_text(encoding="utf-8")
    return sum(1 for pattern in SENSITIVE_PATTERNS if pattern.search(text))


def resolve_summary(args: argparse.Namespace) -> Path:
    if args.summary:
        return Path(args.summary).expanduser().resolve()
    if args.run_dir:
        return Path(args.run_dir).expanduser().resolve() / "large-file-run-summary.json"
    raise SystemExit("pass --summary or --run-dir")


def resolve_results(summary: dict[str, Any], summary_path: Path, args: argparse.Namespace) -> Path | None:
    if args.results:
        return Path(args.results).expanduser().resolve()
    raw = summary.get("results")
    if isinstance(raw, str) and raw:
        path = Path(raw).expanduser()
        return path.resolve() if path.is_absolute() else (summary_path.parent / path).resolve()
    if args.run_dir:
        return Path(args.run_dir).expanduser().resolve() / "large-file-run-results.jsonl"
    return None


def artifact_exists(value: Any) -> bool:
    return isinstance(value, str) and bool(value) and Path(value).expanduser().exists()


def verify(
    plan_path: Path,
    summary_path: Path,
    results_path: Path | None,
    require_complete: bool,
    check_review_artifacts: bool,
) -> dict[str, Any]:
    errors: list[Issue] = []
    warnings: list[Issue] = []
    plan_validation = validate_plan(plan_path)
    if plan_validation["status"] != "ok":
        errors.append(Issue("plan_validation_failed", "plan", "plan validation did not pass"))

    plan = load_json(plan_path)
    summary = load_json(summary_path)
    leak_count = public_summary_leak_count(summary_path)
    if leak_count:
        errors.append(Issue("summary_redaction_failure", "summary", "public run summary contains sensitive markers"))

    jobs_selected = int(summary.get("jobs_selected") or 0)
    selected_rows = selected_rows_from_plan(plan, plan_path.parent, jobs_selected)
    selected_hash = hash_file_ids(selected_rows)
    if jobs_selected != len(selected_rows):
        errors.append(Issue("selected_count_mismatch", "plan", "summary selected count exceeds plan shard rows"))
    if summary.get("selected_private_ids_sha256") != selected_hash:
        errors.append(Issue("selected_hash_mismatch", "summary", "selected private ID hash does not match plan selection"))

    results: list[dict[str, Any]] = []
    execute_requested = bool(summary.get("execute_requested"))
    if results_path and results_path.exists():
        results = load_results(results_path)
    elif execute_requested:
        errors.append(Issue("missing_results", "results", "executed run summary has no results file"))

    result_ids = [row["file_id"] for row in results if isinstance(row.get("file_id"), str)]
    duplicate_result_ids = len(result_ids) - len(set(result_ids))
    if duplicate_result_ids:
        errors.append(Issue("duplicate_result_file_ids", "results", "private result rows contain duplicate file IDs"))
    if results and len(result_ids) != len(results):
        errors.append(Issue("result_missing_file_id", "results", "one or more private result rows are missing file IDs"))

    result_hash = hash_file_ids(results)
    if results and summary.get("result_private_ids_sha256") != result_hash:
        errors.append(Issue("result_hash_mismatch", "results", "result private ID hash does not match summary"))
    if summary.get("status") == "completed" and summary.get("jobs_completed") == summary.get("jobs_selected"):
        if selected_hash != result_hash:
            errors.append(Issue("selected_result_hash_mismatch", "summary", "completed run did not process exactly the selected private rows"))

    if summary.get("jobs_completed") is not None and int(summary.get("jobs_completed") or 0) != len(results):
        errors.append(Issue("jobs_completed_mismatch", "summary", "jobs_completed does not match private results count"))
    if results and summary.get("results_status") and summary.get("results_status") != status_counts(results):
        errors.append(Issue("results_status_mismatch", "summary", "summary result counts do not match private results"))
    if not execute_requested and not results:
        expected_skipped = int(summary.get("jobs_selected") or 0)
        if summary.get("results_status") != {"skipped": expected_skipped}:
            errors.append(Issue("dry_run_status_mismatch", "summary", "dry-run summary does not report all selected jobs as skipped"))

    if require_complete and summary.get("status") != "completed":
        errors.append(Issue("run_not_complete", "summary", "run summary is not completed"))
    if require_complete and summary.get("jobs_completed") != summary.get("jobs_selected"):
        errors.append(Issue("run_not_full_coverage", "summary", "completed run did not cover all selected jobs"))

    missing_review_artifacts = 0
    if check_review_artifacts:
        for row in results:
            if row.get("artifact_ready") and not artifact_exists(row.get("review_artifact")):
                missing_review_artifacts += 1
        if missing_review_artifacts:
            errors.append(Issue("review_artifact_missing", "results", "one or more artifact-ready results lack an existing review artifact"))

    return {
        "status": "ok" if not errors else "error",
        "plan": str(plan_path),
        "summary": str(summary_path),
        "results": str(results_path) if results_path else None,
        "run_status": summary.get("status"),
        "execute_requested": execute_requested,
        "jobs_selected": summary.get("jobs_selected"),
        "jobs_completed": summary.get("jobs_completed"),
        "results_seen": len(results),
        "result_status": status_counts(results),
        "selected_private_ids_sha256": summary.get("selected_private_ids_sha256"),
        "result_private_ids_sha256": result_hash if results else summary.get("result_private_ids_sha256"),
        "duplicate_result_file_ids": duplicate_result_ids,
        "summary_sensitive_marker_hits": leak_count,
        "missing_review_artifacts": missing_review_artifacts if check_review_artifacts else None,
        "errors": [issue.to_json() for issue in errors],
        "warnings": [issue.to_json() for issue in warnings],
        "redaction": "summary omits file IDs, filenames, paths, object keys, source refs, OCR text, transcripts, and row payloads",
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Verify a large-file extraction run.")
    parser.add_argument("--plan", required=True, help="Path to large-file-extraction-plan.json")
    parser.add_argument("--summary", help="Path to large-file-run-summary.json")
    parser.add_argument("--run-dir", help="Private run directory containing large-file-run-summary.json")
    parser.add_argument("--results", help="Path to private large-file-run-results.jsonl")
    parser.add_argument("--require-complete", action="store_true", help="Fail unless the run completed all selected jobs")
    parser.add_argument("--check-review-artifacts", action="store_true", help="Verify artifact-ready private results have existing review artifacts")
    parser.add_argument("--output", help="Optional redacted verification summary path")
    args = parser.parse_args()

    plan_path = Path(args.plan).expanduser().resolve()
    summary_path = resolve_summary(args)
    results_path = resolve_results(load_json(summary_path), summary_path, args)
    report = verify(plan_path, summary_path, results_path, args.require_complete, args.check_review_artifacts)
    output = json.dumps(report, indent=2, sort_keys=True)
    print(output)
    if args.output:
        output_path = Path(args.output).expanduser().resolve()
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(output + "\n", encoding="utf-8")
    return 0 if report["status"] == "ok" else 1


if __name__ == "__main__":
    raise SystemExit(main())
