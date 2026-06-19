#!/usr/bin/env python3
"""Offline tests for collecting large-file extraction outputs into review jobs."""

from __future__ import annotations

import json
import subprocess
import tempfile
import unittest
from pathlib import Path


SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "collect_large_file_review_manifest.py"


def run_collector(*args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["python3", str(SCRIPT), *args],
        check=False,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )


def write_job(run_dir: Path, review_exists: bool = True) -> Path:
    job = run_dir / "jobs" / "job-000001"
    job.mkdir(parents=True, exist_ok=True)
    review = job / "private-review.json"
    if review_exists:
        review.write_text(json.dumps({"redaction": "bounded", "review": {"status": "ready"}}), encoding="utf-8")
    (job / "private-input.json").write_text(json.dumps({
        "file_id": "f_private_large",
        "lane": "needs_pdf_extractor",
        "strategy": "large-pdf-windowed-text",
        "mime": "application/pdf",
        "expected_ext": "pdf",
        "size": 20_000_000,
        "owner": "legal",
        "review_status": "approved",
    }, sort_keys=True), encoding="utf-8")
    (job / "extractor.stdout.json").write_text(json.dumps({
        "status": "ready",
        "file_id": "f_private_large",
        "review_artifact": str(review),
        "artifact_ready": True,
        "content_ready": True,
        "usable": True,
    }, sort_keys=True), encoding="utf-8")
    return review


class LargeFileReviewCollectorTests(unittest.TestCase):
    def test_empty_run_writes_empty_manifest(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            output = root / "review.jsonl"
            proc = run_collector("--run-dir", str(root / "run"), "--output", str(output))
            self.assertEqual(proc.returncode, 0, proc.stderr)
            summary = json.loads(proc.stdout)
            self.assertEqual(summary["status"], "empty")
            self.assertEqual(summary["jobs_written"], 0)
            self.assertEqual(output.read_text(encoding="utf-8"), "")

    def test_ready_job_copies_review_artifact_and_redacts_stdout(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            run_dir = root / "run"
            output = root / "review" / "jobs.jsonl"
            write_job(run_dir)
            proc = run_collector("--run-dir", str(run_dir), "--output", str(output))
            self.assertEqual(proc.returncode, 0, proc.stderr)
            summary = json.loads(proc.stdout)
            rows = [json.loads(line) for line in output.read_text(encoding="utf-8").splitlines() if line.strip()]
            copied = Path(rows[0]["review_artifact"])
            copied_exists = copied.exists()

        self.assertEqual(summary["status"], "ready")
        self.assertEqual(summary["job_dirs_seen"], 1)
        self.assertEqual(summary["jobs_written"], 1)
        self.assertEqual(rows[0]["file_id"], "f_private_large")
        self.assertEqual(rows[0]["extractor_lane"], "pdf")
        self.assertTrue(copied_exists)
        self.assertNotIn("f_private_large", proc.stdout)
        self.assertNotIn("private-review", proc.stdout)

    def test_missing_review_artifact_is_counted_not_written(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            run_dir = root / "run"
            output = root / "review" / "jobs.jsonl"
            write_job(run_dir, review_exists=False)
            proc = run_collector("--run-dir", str(run_dir), "--output", str(output))

        self.assertEqual(proc.returncode, 0, proc.stderr)
        summary = json.loads(proc.stdout)
        self.assertEqual(summary["status"], "empty")
        self.assertEqual(summary["jobs_written"], 0)
        self.assertEqual(summary["by_collector_status"], {"review_artifact_not_found": 1})
        self.assertNotIn("f_private_large", proc.stdout)


if __name__ == "__main__":
    unittest.main()
