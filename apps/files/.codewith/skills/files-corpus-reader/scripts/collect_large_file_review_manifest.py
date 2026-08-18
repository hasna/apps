#!/usr/bin/env python3
"""Collect large-file extraction run outputs into semantic review jobs.

This reads private job directories created by run_large_file_extraction_plan.py
and writes a private JSONL manifest for run_llm_review_batch.py. Stdout is
aggregate-only and omits file IDs, filenames, paths, object keys, source refs,
OCR text, transcripts, and row payloads.
"""

from __future__ import annotations

import argparse
import json
import shutil
from pathlib import Path
from typing import Any


SEMANTIC_LANE = {
    "needs_pdf_extractor": "pdf",
    "needs_office_extractor": "office",
    "needs_archive_inventory": "archive_inventory",
    "needs_ocr_or_vision": "image_ocr_or_vision",
    "needs_design_raw_pipeline": "design_raw_metadata_preview",
    "metadata_only_or_unknown": "metadata_only_or_unknown",
}


def load_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}
    return value if isinstance(value, dict) else {}


def job_dirs(run_dir: Path) -> list[Path]:
    jobs_root = run_dir / "jobs"
    if not jobs_root.exists():
        return []
    return sorted(path for path in jobs_root.iterdir() if path.is_dir() and path.name.startswith("job-"))


def safe_status(stdout: dict[str, Any]) -> str:
    status = stdout.get("status")
    return status if isinstance(status, str) and status else "unknown"


def collect_job(index: int, job_dir: Path, review_dir: Path) -> tuple[dict[str, Any] | None, dict[str, Any]]:
    private_input = load_json(job_dir / "private-input.json")
    stdout = load_json(job_dir / "extractor.stdout.json")
    lane = str(private_input.get("lane") or "metadata_only_or_unknown")
    status = safe_status(stdout)
    result_summary = {
        "lane": lane,
        "semantic_lane": SEMANTIC_LANE.get(lane, "metadata_only_or_unknown"),
        "strategy": private_input.get("strategy"),
        "status": status,
        "artifact_ready": bool(stdout.get("artifact_ready")),
        "content_ready": bool(stdout.get("content_ready")),
        "usable": bool(stdout.get("usable")),
    }
    review_artifact = stdout.get("review_artifact")
    file_id = private_input.get("file_id")
    if not isinstance(file_id, str) or not file_id:
        result_summary["collector_status"] = "missing_file_id"
        return None, result_summary
    if not isinstance(review_artifact, str) or not review_artifact:
        result_summary["collector_status"] = "missing_review_artifact"
        return None, result_summary
    source = Path(review_artifact).expanduser()
    if not source.exists():
        result_summary["collector_status"] = "review_artifact_not_found"
        return None, result_summary
    review_dir.mkdir(parents=True, exist_ok=True)
    copied_review = review_dir / f"job-{index:06d}.review.json"
    shutil.copyfile(source, copied_review)
    job = {
        "job_id": f"large-file-job-{index:06d}",
        "file_id": file_id,
        "mime": private_input.get("mime"),
        "ext": private_input.get("expected_ext"),
        "expected_ext": private_input.get("expected_ext"),
        "size": private_input.get("size"),
        "owner": private_input.get("owner") or "intake",
        "review_status": private_input.get("review_status") or "unreviewed",
        "extractor_lane": result_summary["semantic_lane"],
        "content_strategy": private_input.get("strategy"),
        "review_artifact": str(copied_review),
        "artifact_ready": bool(stdout.get("artifact_ready")),
        "content_ready": bool(stdout.get("content_ready")),
        "large_file_strategy": private_input.get("strategy"),
        "proposal_contract": {
            "canonical_name": "lowercase kebab-case filename with extension",
            "target_path": "owner/domain-or-project/file-name.ext",
            "confidence": "high|medium|low",
            "requires_review": True,
        },
    }
    result_summary["collector_status"] = "ready"
    return job, result_summary


def write_jsonl(path: Path, rows: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, sort_keys=True) + "\n")


def count_by(rows: list[dict[str, Any]], field: str) -> dict[str, int]:
    counts: dict[str, int] = {}
    for row in rows:
        key = str(row.get(field) or "unknown")
        counts[key] = counts.get(key, 0) + 1
    return dict(sorted(counts.items()))


def main() -> int:
    parser = argparse.ArgumentParser(description="Collect large-file run outputs into semantic review manifest.")
    parser.add_argument("--run-dir", required=True, help="Private large-file run output directory")
    parser.add_argument("--output", required=True, help="Private semantic review manifest JSONL output")
    parser.add_argument("--summary-output", help="Optional redacted summary JSON output")
    args = parser.parse_args()

    run_dir = Path(args.run_dir).expanduser().resolve()
    output = Path(args.output).expanduser().resolve()
    review_dir = output.parent / "review-artifacts"
    jobs: list[dict[str, Any]] = []
    summaries: list[dict[str, Any]] = []
    for index, job_dir in enumerate(job_dirs(run_dir), start=1):
        job, summary = collect_job(index, job_dir, review_dir)
        summaries.append(summary)
        if job is not None:
            jobs.append(job)
    write_jsonl(output, jobs)
    summary_payload = {
        "status": "ready" if jobs else "empty",
        "run_dir": str(run_dir),
        "output": str(output),
        "job_dirs_seen": len(summaries),
        "jobs_written": len(jobs),
        "by_collector_status": count_by(summaries, "collector_status"),
        "by_lane": count_by(summaries, "lane"),
        "by_semantic_lane": count_by(summaries, "semantic_lane"),
        "by_content_ready": count_by([{"content_ready": str(row.get("content_ready"))} for row in summaries], "content_ready"),
        "redaction": "summary omits file IDs, filenames, paths, object keys, source refs, OCR text, transcripts, row payloads, and review artifact contents",
    }
    output_text = json.dumps(summary_payload, indent=2, sort_keys=True)
    print(output_text)
    if args.summary_output:
        summary_path = Path(args.summary_output).expanduser().resolve()
        summary_path.parent.mkdir(parents=True, exist_ok=True)
        summary_path.write_text(output_text + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
