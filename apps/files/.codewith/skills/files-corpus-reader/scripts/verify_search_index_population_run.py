#!/usr/bin/env python3
"""Verify a search-index population run without leaking private row data."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sqlite3
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any


SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))

from validate_search_index_population_plan import validate_plan  # noqa: E402


SENSITIVE_PATTERNS = (
    re.compile(r'"file_id"\s*:'),
    re.compile(r'"f_[A-Za-z0-9_:-]+"'),
    re.compile(r"open-files://"),
    re.compile(r"objects/sha256/"),
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


def load_jsonl(path: Path) -> list[dict[str, Any]]:
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


def resolve_summary(args: argparse.Namespace) -> Path:
    if args.summary:
        return Path(args.summary).expanduser().resolve()
    if args.run_dir:
        return Path(args.run_dir).expanduser().resolve() / "search-index-run-summary.json"
    raise SystemExit("pass --summary or --run-dir")


def resolve_results(summary: dict[str, Any], summary_path: Path, args: argparse.Namespace) -> Path | None:
    if args.results:
        return Path(args.results).expanduser().resolve()
    raw = summary.get("results")
    if isinstance(raw, str) and raw:
        path = Path(raw).expanduser()
        return path.resolve() if path.is_absolute() else (summary_path.parent / path).resolve()
    if args.run_dir:
        return Path(args.run_dir).expanduser().resolve() / "search-index-run-results.jsonl"
    return None


def public_summary_leak_count(summary_path: Path) -> int:
    text = summary_path.read_text(encoding="utf-8")
    return sum(1 for pattern in SENSITIVE_PATTERNS if pattern.search(text))


def db_index_counts(db_path: Path, file_ids: list[str]) -> dict[str, int]:
    if not file_ids:
        return {"ready_or_partial": 0, "total": 0}
    db = sqlite3.connect(db_path)
    placeholders = ",".join("?" for _ in file_ids)
    total = db.execute(
        f"SELECT COUNT(*) FROM file_search_documents WHERE file_id IN ({placeholders})",
        file_ids,
    ).fetchone()[0]
    ready = db.execute(
        f"SELECT COUNT(DISTINCT file_id) FROM file_search_documents WHERE status IN ('ready', 'partial') AND file_id IN ({placeholders})",
        file_ids,
    ).fetchone()[0]
    db.close()
    return {"ready_or_partial": int(ready), "total": int(total)}


def valid_sha256(value: Any) -> bool:
    return isinstance(value, str) and bool(re.fullmatch(r"[0-9a-f]{64}", value))


def search_probe_summary(value: dict[str, Any]) -> dict[str, Any]:
    probe = value.get("search_probe_attestation") if isinstance(value.get("search_probe_attestation"), dict) else {}
    return {
        "status": probe.get("status"),
        "probes": probe.get("probes"),
        "matched_expected_file_probes": probe.get("matched_expected_file_probes"),
        "failed_probes": probe.get("failed_probes"),
        "skipped_probes": probe.get("skipped_probes"),
        "latency_budget_ms": probe.get("latency_budget_ms"),
        "max_latency_ms": probe.get("max_latency_ms"),
        "p95_latency_ms": probe.get("p95_latency_ms"),
        "private_probe_results_sha256": probe.get("private_probe_results_sha256"),
    }


def search_probe_ok(summary: dict[str, Any]) -> bool:
    probe = summary.get("search_probe_attestation") if isinstance(summary.get("search_probe_attestation"), dict) else {}
    return (
        probe.get("status") == "ok"
        and isinstance(probe.get("probes"), int)
        and int(probe.get("probes") or 0) > 0
        and probe.get("matched_expected_file_probes") == probe.get("probes")
        and int(probe.get("failed_probes") or 0) == 0
        and int(probe.get("skipped_probes") or 0) == 0
        and isinstance(probe.get("max_latency_ms"), int)
        and isinstance(probe.get("latency_budget_ms"), int)
        and int(probe.get("max_latency_ms") or 0) <= int(probe.get("latency_budget_ms") or 0)
        and valid_sha256(probe.get("private_probe_results_sha256"))
    )


def verify(
    plan_path: Path,
    summary_path: Path,
    results_path: Path | None,
    require_complete: bool,
    check_db: bool,
    require_search_probe: bool,
) -> dict[str, Any]:
    errors: list[Issue] = []
    warnings: list[Issue] = []
    plan_validation = validate_plan(plan_path)
    if plan_validation["status"] != "ok":
        errors.append(Issue("plan_validation_failed", "plan", "plan validation did not pass"))

    summary = load_json(summary_path)
    leak_count = public_summary_leak_count(summary_path)
    if leak_count:
        errors.append(Issue("summary_redaction_failure", "summary", "public run summary contains sensitive markers"))

    results: list[dict[str, Any]] = []
    if results_path and results_path.exists():
        results = load_jsonl(results_path)
    elif summary.get("execute_requested"):
        errors.append(Issue("missing_results", "results", "executed run summary has no results file"))

    result_ids = [row["file_id"] for row in results if isinstance(row.get("file_id"), str)]
    duplicate_result_ids = len(result_ids) - len(set(result_ids))
    if duplicate_result_ids:
        errors.append(Issue("duplicate_result_file_ids", "results", "private result rows contain duplicate file IDs"))
    if results and len(result_ids) != len(results):
        errors.append(Issue("result_missing_file_id", "results", "one or more private result rows are missing file IDs"))

    selected_hash = summary.get("selected_private_ids_sha256")
    result_hash = hash_file_ids(results)
    expected_result_hash = summary.get("result_private_ids_sha256")
    if results and expected_result_hash != result_hash:
        errors.append(Issue("result_hash_mismatch", "results", "result private ID hash does not match summary"))
    if summary.get("status") == "completed" and summary.get("jobs_completed") == summary.get("jobs_selected"):
        if selected_hash != result_hash:
            errors.append(Issue("selected_result_hash_mismatch", "summary", "completed run did not process exactly the selected private rows"))

    execute_requested = bool(summary.get("execute_requested"))
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

    probe_ok = search_probe_ok(summary)
    if require_search_probe and not probe_ok:
        errors.append(Issue("search_probe_required", "summary", "search probe attestation is missing, slow, unmatched, or invalid"))
    scale = summary.get("scale_readiness_attestation") if isinstance(summary.get("scale_readiness_attestation"), dict) else {}
    if scale.get("status") in {"canary_verified", "full_run_verified"} and not probe_ok:
        errors.append(Issue("scale_ready_without_search_probe", "summary", "scale readiness requires ok search probe attestation"))
    if isinstance(scale, dict) and scale.get("search_probe_status") and scale.get("search_probe_status") != (summary.get("search_probe_attestation") or {}).get("status"):
        errors.append(Issue("search_probe_status_mismatch", "summary", "scale readiness search probe status does not match search probe attestation"))

    indexed_count = status_counts(results).get("indexed", 0)
    db_counts: dict[str, int] | None = None
    if check_db:
        plan = load_json(plan_path)
        db_path = Path(str(plan.get("db") or "")).expanduser()
        if not db_path.exists():
            errors.append(Issue("db_not_found", "db", "plan DB path does not exist"))
        else:
            indexed_ids = [row["file_id"] for row in results if row.get("status") == "indexed" and isinstance(row.get("file_id"), str)]
            db_counts = db_index_counts(db_path, indexed_ids)
            if db_counts["ready_or_partial"] < len(set(indexed_ids)):
                errors.append(Issue("db_index_coverage_mismatch", "db", "not every indexed result has a ready/partial search document"))

    return {
        "status": "ok" if not errors else "error",
        "plan": str(plan_path),
        "summary": str(summary_path),
        "results": str(results_path) if results_path else None,
        "run_status": summary.get("status"),
        "execute_requested": bool(summary.get("execute_requested")),
        "jobs_selected": summary.get("jobs_selected"),
        "jobs_completed": summary.get("jobs_completed"),
        "results_seen": len(results),
        "indexed_results": indexed_count,
        "result_status": status_counts(results),
        "search_probe": search_probe_summary(summary),
        "selected_private_ids_sha256": selected_hash,
        "result_private_ids_sha256": result_hash if results else summary.get("result_private_ids_sha256"),
        "duplicate_result_file_ids": duplicate_result_ids,
        "summary_sensitive_marker_hits": leak_count,
        "db_check": db_counts,
        "errors": [issue.to_json() for issue in errors],
        "warnings": [issue.to_json() for issue in warnings],
        "redaction": "summary omits file IDs, filenames, paths, object keys, source refs, extracted text, transcripts, and row payloads",
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Verify a search-index population run.")
    parser.add_argument("--plan", required=True, help="Path to search-index-population-plan.json")
    parser.add_argument("--summary", help="Path to search-index-run-summary.json")
    parser.add_argument("--run-dir", help="Private run directory containing search-index-run-summary.json")
    parser.add_argument("--results", help="Path to private search-index-run-results.jsonl")
    parser.add_argument("--require-complete", action="store_true", help="Fail unless the run completed all selected jobs")
    parser.add_argument("--check-db", action="store_true", help="Verify indexed result file IDs have ready/partial DB search documents")
    parser.add_argument("--require-search-probe", action="store_true", help="Fail unless completed runs include ok files search probe evidence")
    parser.add_argument("--output", help="Optional redacted verification summary path")
    args = parser.parse_args()

    plan_path = Path(args.plan).expanduser().resolve()
    summary_path = resolve_summary(args)
    results_path = resolve_results(load_json(summary_path), summary_path, args)
    report = verify(plan_path, summary_path, results_path, args.require_complete, args.check_db, args.require_search_probe)
    output = json.dumps(report, indent=2, sort_keys=True)
    print(output)
    if args.output:
        output_path = Path(args.output).expanduser().resolve()
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(output + "\n", encoding="utf-8")
    return 0 if report["status"] == "ok" else 1


if __name__ == "__main__":
    raise SystemExit(main())
