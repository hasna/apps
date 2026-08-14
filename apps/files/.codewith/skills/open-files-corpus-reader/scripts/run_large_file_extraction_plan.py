#!/usr/bin/env python3
"""Run or dry-run an approved large-file extraction plan.

The runner is dry-run by default. Execution requires both an approved plan and
an explicit --execute flag. Worker stdout/stderr are captured to private job
directories; this script prints aggregate-only status.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import subprocess
import sys
import time
from pathlib import Path
from typing import Any


SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))

from validate_large_file_extraction_plan import load_jsonl, resolve_path, validate_plan  # noqa: E402
from global_execution_preflight import build_global_execution_preflight, plan_approval_token, skipped_results  # noqa: E402


DEFAULT_EXTRACTOR = SCRIPT_DIR / "extract_artifact_for_file.py"


def load_json(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise SystemExit(f"invalid JSON object: {path}")
    return value


def hash_file_ids(rows: list[Any]) -> str:
    ids: list[str] = []
    for row in rows:
        if isinstance(row, str):
            ids.append(row)
        elif isinstance(row, dict) and isinstance(row.get("file_id"), str):
            ids.append(row["file_id"])
    digest = hashlib.sha256()
    for file_id in ids:
        digest.update(file_id.encode("utf-8"))
        digest.update(b"\n")
    return digest.hexdigest()


def directory_size(path: Path) -> int:
    if not path.exists():
        return 0
    total = 0
    for child in path.rglob("*"):
        if child.is_file():
            total += child.stat().st_size
    return total


def selected_rows(plan: dict[str, Any], plan_root: Path, max_shards: int | None, max_jobs: int | None) -> list[dict[str, Any]]:
    entries = [entry for entry in plan.get("shard_entries", []) if isinstance(entry, dict)]
    if max_shards is not None:
        entries = entries[: max(0, max_shards)]
    rows: list[dict[str, Any]] = []
    for entry in entries:
        shard = resolve_path(entry.get("manifest"), plan_root)
        if shard is None:
            continue
        rows.extend(load_jsonl(shard))
        if max_jobs is not None and len(rows) >= max_jobs:
            rows = rows[:max_jobs]
            break
    return rows


def aggregate_counts(rows: list[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    by_lane: dict[str, dict[str, int]] = {}
    by_strategy: dict[str, dict[str, int]] = {}
    by_size_bucket: dict[str, dict[str, int]] = {}
    for row in rows:
        size = int(row.get("size") or 0)
        for table, key in (
            (by_lane, str(row.get("lane") or "unknown")),
            (by_strategy, str(row.get("strategy") or "unknown")),
            (by_size_bucket, str(row.get("size_bucket") or "unknown")),
        ):
            entry = table.setdefault(key, {"count": 0, "bytes": 0})
            entry["count"] += 1
            entry["bytes"] += size

    def rows_out(table: dict[str, dict[str, int]]) -> list[dict[str, Any]]:
        values = [{"key": key, **value} for key, value in table.items()]
        values.sort(key=lambda item: (-item["count"], -item["bytes"], item["key"]))
        return values

    return {
        "by_lane": rows_out(by_lane),
        "by_strategy": rows_out(by_strategy),
        "by_size_bucket": rows_out(by_size_bucket),
    }


def safe_row_summary(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "lane": row.get("lane"),
        "strategy": row.get("strategy"),
        "size": row.get("size"),
        "size_bucket": row.get("size_bucket"),
        "owner": row.get("owner"),
    }


def parse_extractor_stdout(stdout_path: Path) -> dict[str, Any]:
    if not stdout_path.exists() or stdout_path.stat().st_size == 0:
        return {}
    try:
        value = json.loads(stdout_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {"status": "invalid_stdout_json"}
    if not isinstance(value, dict):
        return {"status": "invalid_stdout_json"}
    return value


def run_job(
    index: int,
    row: dict[str, Any],
    output_dir: Path,
    extractor_script: Path,
    db_path: Path | None,
    timeout_seconds: int,
    max_download_bytes: int,
    cleanup_downloads: bool,
) -> dict[str, Any]:
    started = time.monotonic()
    job_dir = output_dir / "jobs" / f"job-{index:06d}"
    job_dir.mkdir(parents=True, exist_ok=True)
    private_input = job_dir / "private-input.json"
    stdout_path = job_dir / "extractor.stdout.json"
    stderr_path = job_dir / "extractor.stderr.log"
    private_input.write_text(json.dumps(row, indent=2, sort_keys=True), encoding="utf-8")

    file_id = row.get("file_id")
    if not isinstance(file_id, str) or not file_id:
        return {**safe_row_summary(row), "status": "failed", "reason": "missing_file_id", "duration_seconds": 0.0}

    cmd = [
        "python3",
        str(extractor_script),
        file_id,
        "--artifact-dir",
        str(job_dir),
        "--max-download-bytes",
        str(max_download_bytes),
        "--timeout-seconds",
        str(timeout_seconds),
    ]
    if db_path is not None:
        cmd.extend(["--db", str(db_path)])

    try:
        with stdout_path.open("w", encoding="utf-8") as stdout_handle, stderr_path.open("w", encoding="utf-8") as stderr_handle:
            proc = subprocess.run(
                cmd,
                check=False,
                stdout=stdout_handle,
                stderr=stderr_handle,
                text=True,
                timeout=timeout_seconds + 30,
            )
        parsed = parse_extractor_stdout(stdout_path)
        status = parsed.get("status") if isinstance(parsed.get("status"), str) else ("completed" if proc.returncode == 0 else "failed")
        result = {
            "file_id": file_id,
            **safe_row_summary(row),
            "status": status,
            "returncode": proc.returncode,
            "artifact_ready": parsed.get("artifact_ready"),
            "content_ready": parsed.get("content_ready"),
            "usable": parsed.get("usable"),
            "extractor": parsed.get("extractor"),
            "route": parsed.get("route"),
            "review_artifact": parsed.get("review_artifact") if isinstance(parsed.get("review_artifact"), str) else None,
            "logs": {
                "stdout": str(stdout_path),
                "stderr": str(stderr_path),
            },
            "private_job_dir": str(job_dir),
            "duration_seconds": round(time.monotonic() - started, 3),
        }
    except subprocess.TimeoutExpired:
        result = {
            **safe_row_summary(row),
            "status": "failed",
            "returncode": None,
            "reason": "timeout",
            "logs": {"stdout": str(stdout_path), "stderr": str(stderr_path)},
            "private_job_dir": str(job_dir),
            "duration_seconds": round(time.monotonic() - started, 3),
        }

    if cleanup_downloads:
        downloads = job_dir / "downloads"
        if downloads.exists():
            shutil.rmtree(downloads)
            result["downloads_cleanup"] = "removed"
        else:
            result["downloads_cleanup"] = "none"
    else:
        result["downloads_cleanup"] = "kept"
    result["artifact_bytes"] = directory_size(job_dir)
    return result


def write_jsonl(path: Path, rows: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, sort_keys=True) + "\n")


def status_counts(results: list[dict[str, Any]]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for result in results:
        status = str(result.get("status") or "unknown")
        counts[status] = counts.get(status, 0) + 1
    return dict(sorted(counts.items()))


def main() -> int:
    parser = argparse.ArgumentParser(description="Run or dry-run a large-file extraction plan.")
    parser.add_argument("--plan", required=True, help="Path to large-file-extraction-plan.json")
    parser.add_argument("--output-dir", help="Private run output directory")
    parser.add_argument("--execute", action="store_true", help="Actually run approved extraction jobs")
    parser.add_argument("--max-shards", type=int, help="Maximum private shards to select")
    parser.add_argument("--max-jobs", type=int, help="Maximum jobs to select")
    parser.add_argument("--max-planned-bytes", type=int, default=100 * 1024 * 1024, help="Execution fails if selected source bytes exceed this cap")
    parser.add_argument("--execution-scope", choices=["canary", "scale"], default="canary", help="Execution scope used by the global readiness preflight")
    parser.add_argument("--max-canary-jobs", type=int, default=10, help="Maximum jobs allowed when --execution-scope=canary")
    parser.add_argument("--max-canary-bytes", type=int, default=100 * 1024 * 1024, help="Maximum source bytes allowed when --execution-scope=canary")
    parser.add_argument("--extraction-readiness-gate", help="Optional extraction-lane-readiness-gate.json path for global execution preflight")
    parser.add_argument("--max-download-bytes", type=int, default=100 * 1024 * 1024, help="Per-file download cap passed to extractor")
    parser.add_argument("--max-artifact-bytes", type=int, default=1024 * 1024 * 1024, help="Stop if private artifact directory exceeds this size")
    parser.add_argument("--timeout-seconds", type=int, default=300)
    parser.add_argument("--extractor-script", default=str(DEFAULT_EXTRACTOR), help="Extractor script path")
    parser.add_argument("--keep-downloads", action="store_true", help="Keep downloaded source files in private job dirs")
    parser.add_argument("--summary-output", help="Optional redacted run summary output")
    args = parser.parse_args()

    if args.max_shards is not None and args.max_shards < 0:
        raise SystemExit("--max-shards cannot be negative")
    if args.max_jobs is not None and args.max_jobs < 0:
        raise SystemExit("--max-jobs cannot be negative")
    if args.max_planned_bytes < 0 or args.max_download_bytes < 0 or args.max_artifact_bytes < 0:
        raise SystemExit("byte caps cannot be negative")
    if args.max_canary_jobs < 0 or args.max_canary_bytes < 0:
        raise SystemExit("canary caps cannot be negative")
    if args.timeout_seconds <= 0:
        raise SystemExit("--timeout-seconds must be positive")

    plan_path = Path(args.plan).expanduser().resolve()
    plan_root = plan_path.parent
    validation = validate_plan(plan_path)
    plan = load_json(plan_path)
    rows = selected_rows(plan, plan_root, args.max_shards, args.max_jobs)
    selected_bytes = sum(int(row.get("size") or 0) for row in rows)
    output_dir = Path(args.output_dir).expanduser().resolve() if args.output_dir else plan_root / "large-file-run"
    extractor_script = Path(args.extractor_script).expanduser().resolve()
    db_path = Path(plan["db"]).expanduser().resolve() if isinstance(plan.get("db"), str) else None
    approval_token = plan_approval_token(plan)

    summary: dict[str, Any] = {
        "status": "validation_failed" if validation["status"] != "ok" else "dry_run",
        "plan": str(plan_path),
        "approved": bool(plan.get("approved")),
        "execute_requested": bool(args.execute),
        "jobs_selected": len(rows),
        "bytes_selected": selected_bytes,
        "max_planned_bytes": args.max_planned_bytes,
        "max_download_bytes": args.max_download_bytes,
        "max_artifact_bytes": args.max_artifact_bytes,
        "aggregate": aggregate_counts(rows),
        "selected_private_ids_sha256": hash_file_ids(rows),
        "result_private_ids_sha256": None,
        "validation": {
            "status": validation["status"],
            "errors": validation["errors"],
            "warnings": validation["warnings"],
        },
        "results_status": {},
        "global_execution_preflight": build_global_execution_preflight(
            plan_root=plan_root,
            explicit_gate_path=args.extraction_readiness_gate,
            execute_requested=args.execute,
            execution_scope=args.execution_scope,
            selected_jobs=len(rows),
            selected_bytes=selected_bytes,
            max_canary_jobs=args.max_canary_jobs,
            max_canary_bytes=args.max_canary_bytes,
            **approval_token,
        ),
        "redaction": "summary omits file IDs, filenames, paths, object keys, source refs, OCR text, transcripts, row payloads, and extractor stdout/stderr",
    }

    if validation["status"] != "ok":
        output = json.dumps(summary, indent=2, sort_keys=True)
        print(output)
        return 1

    if not args.execute:
        summary["results_status"] = {"skipped": len(rows)}
        output = json.dumps(summary, indent=2, sort_keys=True)
        print(output)
        if args.summary_output:
            summary_path = Path(args.summary_output).expanduser().resolve()
            summary_path.parent.mkdir(parents=True, exist_ok=True)
            summary_path.write_text(output + "\n", encoding="utf-8")
        return 0

    if not plan.get("approved"):
        summary["status"] = "approval_required"
        summary["results_status"] = {"skipped": len(rows)}
        output = json.dumps(summary, indent=2, sort_keys=True)
        print(output)
        if args.summary_output:
            summary_path = Path(args.summary_output).expanduser().resolve()
            summary_path.parent.mkdir(parents=True, exist_ok=True)
            summary_path.write_text(output + "\n", encoding="utf-8")
        return 1

    if summary["global_execution_preflight"]["allowed"] is not True:
        summary["status"] = "global_execution_preflight_blocked"
        summary["results_status"] = skipped_results(len(rows))
        output = json.dumps(summary, indent=2, sort_keys=True)
        print(output)
        if args.summary_output:
            summary_path = Path(args.summary_output).expanduser().resolve()
            summary_path.parent.mkdir(parents=True, exist_ok=True)
            summary_path.write_text(output + "\n", encoding="utf-8")
        return 1

    if selected_bytes > args.max_planned_bytes:
        summary["status"] = "planned_bytes_cap_exceeded"
        summary["results_status"] = {"skipped": len(rows)}
        output = json.dumps(summary, indent=2, sort_keys=True)
        print(output)
        if args.summary_output:
            summary_path = Path(args.summary_output).expanduser().resolve()
            summary_path.parent.mkdir(parents=True, exist_ok=True)
            summary_path.write_text(output + "\n", encoding="utf-8")
        return 1

    output_dir.mkdir(parents=True, exist_ok=True)
    results: list[dict[str, Any]] = []
    stopped_reason: str | None = None
    for index, row in enumerate(rows, start=1):
        if directory_size(output_dir) > args.max_artifact_bytes:
            stopped_reason = "artifact_bytes_cap_exceeded"
            break
        result = run_job(
            index,
            row,
            output_dir,
            extractor_script,
            db_path,
            args.timeout_seconds,
            args.max_download_bytes,
            cleanup_downloads=not args.keep_downloads,
        )
        results.append(result)
        if directory_size(output_dir) > args.max_artifact_bytes:
            stopped_reason = "artifact_bytes_cap_exceeded"
            break

    results_path = output_dir / "large-file-run-results.jsonl"
    write_jsonl(results_path, results)
    summary["status"] = "stopped" if stopped_reason else "completed"
    summary["stop_reason"] = stopped_reason
    summary["jobs_completed"] = len(results)
    summary["artifact_bytes"] = directory_size(output_dir)
    summary["results_status"] = status_counts(results)
    summary["results"] = str(results_path)
    summary["result_private_ids_sha256"] = hash_file_ids(results)
    output = json.dumps(summary, indent=2, sort_keys=True)
    print(output)
    summary_path = Path(args.summary_output).expanduser().resolve() if args.summary_output else output_dir / "large-file-run-summary.json"
    summary_path.parent.mkdir(parents=True, exist_ok=True)
    summary_path.write_text(output + "\n", encoding="utf-8")
    return 0 if summary["status"] == "completed" else 1


if __name__ == "__main__":
    raise SystemExit(main())
