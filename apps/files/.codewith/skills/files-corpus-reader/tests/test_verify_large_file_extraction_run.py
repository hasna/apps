#!/usr/bin/env python3
"""Offline tests for redacted large-file run verification."""

from __future__ import annotations

import json
import subprocess
import tempfile
import unittest
from pathlib import Path

from test_run_large_file_extraction_plan import RUNNER, plan, write_fake_extractor, write_global_gate


VERIFIER = Path(__file__).resolve().parents[1] / "scripts" / "verify_large_file_extraction_run.py"


def run_script(script: Path, *args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["python3", str(script), *args],
        check=False,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )


def run_fake_approved_large_file(root: Path) -> tuple[Path, Path]:
    plan_path = plan(root, approved=True)
    gate = root / "extraction-lane-readiness-gate.json"
    fake_extractor = root / "fake_extractor.py"
    run_dir = root / "run"
    write_global_gate(gate)
    write_fake_extractor(fake_extractor)
    proc = run_script(
        RUNNER,
        "--plan",
        str(plan_path),
        "--execute",
        "--max-jobs",
        "1",
        "--max-planned-bytes",
        str(100 * 1024 * 1024),
        "--extractor-script",
        str(fake_extractor),
        "--output-dir",
        str(run_dir),
        "--extraction-readiness-gate",
        str(gate),
    )
    if proc.returncode != 0:
        raise AssertionError(proc.stderr or proc.stdout)
    return plan_path, run_dir


class LargeFileRunVerifierTests(unittest.TestCase):
    def test_verifier_accepts_redacted_dry_run_summary(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            plan_path = plan(root, approved=False)
            summary_path = root / "dry-run-summary.json"
            dry = run_script(
                RUNNER,
                "--plan",
                str(plan_path),
                "--max-jobs",
                "2",
                "--summary-output",
                str(summary_path),
            )
            self.assertEqual(dry.returncode, 0, dry.stderr)
            proc = run_script(VERIFIER, "--plan", str(plan_path), "--summary", str(summary_path))

        self.assertEqual(proc.returncode, 0, proc.stderr)
        report = json.loads(proc.stdout)
        self.assertEqual(report["status"], "ok")
        self.assertEqual(report["run_status"], "dry_run")
        self.assertEqual(report["results_seen"], 0)
        self.assertEqual(report["summary_sensitive_marker_hits"], 0)
        self.assertNotIn("f_private_", proc.stdout)

    def test_verifier_accepts_completed_private_results_and_review_artifacts(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            plan_path, run_dir = run_fake_approved_large_file(root)
            proc = run_script(
                VERIFIER,
                "--plan",
                str(plan_path),
                "--run-dir",
                str(run_dir),
                "--require-complete",
                "--check-review-artifacts",
            )

        self.assertEqual(proc.returncode, 0, proc.stderr)
        report = json.loads(proc.stdout)
        self.assertEqual(report["status"], "ok")
        self.assertEqual(report["run_status"], "completed")
        self.assertEqual(report["jobs_completed"], 1)
        self.assertEqual(report["result_status"], {"ready": 1})
        self.assertEqual(report["duplicate_result_file_ids"], 0)
        self.assertEqual(report["summary_sensitive_marker_hits"], 0)
        self.assertEqual(report["selected_private_ids_sha256"], report["result_private_ids_sha256"])
        self.assertEqual(report["missing_review_artifacts"], 0)
        self.assertNotIn("f_private_", proc.stdout)
        self.assertNotIn('"file_id"', proc.stdout)
        self.assertNotIn("private-review", proc.stdout)

    def test_verifier_fails_when_review_artifact_is_missing(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            plan_path, run_dir = run_fake_approved_large_file(root)
            results_path = run_dir / "large-file-run-results.jsonl"
            rows = [
                json.loads(line)
                for line in results_path.read_text(encoding="utf-8").splitlines()
                if line.strip()
            ]
            Path(rows[0]["review_artifact"]).unlink()
            proc = run_script(
                VERIFIER,
                "--plan",
                str(plan_path),
                "--run-dir",
                str(run_dir),
                "--require-complete",
                "--check-review-artifacts",
            )

        self.assertNotEqual(proc.returncode, 0)
        report = json.loads(proc.stdout)
        self.assertEqual(report["status"], "error")
        self.assertEqual(report["errors"][0]["code"], "review_artifact_missing")
        self.assertNotIn("f_private_", proc.stdout)


if __name__ == "__main__":
    unittest.main()
