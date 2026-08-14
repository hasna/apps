#!/usr/bin/env python3
"""Offline tests for approval-gated large-file extraction runs."""

from __future__ import annotations

import json
import subprocess
import tempfile
import unittest
from pathlib import Path

from test_plan_large_file_extraction import SCRIPT as PLANNER
from test_plan_large_file_extraction import setup_db


RUNNER = Path(__file__).resolve().parents[1] / "scripts" / "run_large_file_extraction_plan.py"


def run_script(script: Path, *args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["python3", str(script), *args],
        check=False,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )


def plan(root: Path, approved: bool) -> Path:
    db = root / "files.db"
    output = root / "plan"
    setup_db(db)
    args = [
        "--db",
        str(db),
        "--output-dir",
        str(output),
        "--min-size-bytes",
        str(1024 * 1024),
        "--jobs-per-shard",
        "3",
    ]
    if approved:
        args.extend(["--approved", "--approval-note", "approved-offline-test"])
    proc = run_script(PLANNER, *args)
    if proc.returncode != 0:
        raise AssertionError(proc.stderr)
    return output / "large-file-extraction-plan.json"


def write_fake_extractor(path: Path) -> None:
    path.write_text(
        """#!/usr/bin/env python3
import json
import pathlib
import sys
file_id = sys.argv[1]
artifact_dir = pathlib.Path(sys.argv[sys.argv.index("--artifact-dir") + 1])
review = artifact_dir / "private-review.json"
review.write_text(json.dumps({"redaction": "bounded", "review": {"status": "ready"}}), encoding="utf-8")
(artifact_dir / "downloads").mkdir(parents=True, exist_ok=True)
(artifact_dir / "downloads" / "private-download.bin").write_bytes(b"private")
print(json.dumps({
    "status": "ready",
    "file_id": file_id,
    "artifact_ready": True,
    "content_ready": True,
    "usable": True,
    "extractor": "fake-large-file-extractor",
    "review_artifact": str(review)
}))
""",
        encoding="utf-8",
    )
    path.chmod(0o755)


def write_global_gate(path: Path) -> None:
    path.write_text(json.dumps({
        "kind": "open_files_extraction_lane_readiness_gate",
        "status": "pending_completion",
        "gate": {
            "status": "pending_completion",
            "requires_operator_approval_before_scale": True,
            "full_extraction_complete": False,
        },
        "totals": {
            "hard_blocker_lanes": 0,
            "pending_lanes": 8,
        },
    }), encoding="utf-8")


class LargeFileRunnerTests(unittest.TestCase):
    def test_unapproved_plan_dry_run_is_aggregate_only(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            plan_path = plan(root, approved=False)
            proc = run_script(RUNNER, "--plan", str(plan_path), "--max-jobs", "2")

        self.assertEqual(proc.returncode, 0, proc.stderr)
        summary = json.loads(proc.stdout)
        self.assertEqual(summary["status"], "dry_run")
        self.assertEqual(summary["jobs_selected"], 2)
        self.assertEqual(summary["results_status"], {"skipped": 2})
        self.assertNotIn("f_private_", proc.stdout)
        self.assertNotIn("private-contract", proc.stdout)

    def test_unapproved_execute_is_refused(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            plan_path = plan(root, approved=False)
            gate = root / "extraction-lane-readiness-gate.json"
            write_global_gate(gate)
            proc = run_script(
                RUNNER,
                "--plan",
                str(plan_path),
                "--execute",
                "--max-jobs",
                "1",
                "--extraction-readiness-gate",
                str(gate),
            )

        self.assertNotEqual(proc.returncode, 0)
        summary = json.loads(proc.stdout)
        self.assertEqual(summary["status"], "approval_required")
        self.assertEqual(summary["results_status"], {"skipped": 1})
        self.assertFalse(summary["global_execution_preflight"]["allowed"])
        self.assertEqual(summary["global_execution_preflight"]["status"], "canary_approval_token_required")
        self.assertFalse(summary["global_execution_preflight"]["approval_token_valid"])

    def test_approved_execute_captures_private_extractor_output_and_cleans_downloads(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            plan_path = plan(root, approved=True)
            gate = root / "extraction-lane-readiness-gate.json"
            fake = root / "fake_extractor.py"
            run_dir = root / "run"
            write_global_gate(gate)
            write_fake_extractor(fake)
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
                str(fake),
                "--output-dir",
                str(run_dir),
                "--extraction-readiness-gate",
                str(gate),
            )
            self.assertEqual(proc.returncode, 0, proc.stderr)
            summary = json.loads(proc.stdout)
            results = [json.loads(line) for line in (run_dir / "large-file-run-results.jsonl").read_text(encoding="utf-8").splitlines() if line.strip()]
            stdout_log = Path(results[0]["logs"]["stdout"])
            stdout_text = stdout_log.read_text(encoding="utf-8")
            review_exists = Path(results[0]["review_artifact"]).exists()

        self.assertEqual(summary["status"], "completed")
        self.assertTrue(summary["global_execution_preflight"]["allowed"])
        self.assertEqual(summary["global_execution_preflight"]["status"], "canary_allowed_pending_global_completion")
        self.assertTrue(summary["global_execution_preflight"]["approval_token_valid"])
        self.assertEqual(summary["jobs_completed"], 1)
        self.assertEqual(summary["results_status"], {"ready": 1})
        self.assertRegex(summary["selected_private_ids_sha256"], r"^[a-f0-9]{64}$")
        self.assertEqual(summary["selected_private_ids_sha256"], summary["result_private_ids_sha256"])
        self.assertIn("file_id", results[0])
        self.assertTrue(review_exists)
        self.assertIn("f_private_", stdout_text)
        self.assertFalse((Path(results[0]["private_job_dir"]) / "downloads").exists())
        self.assertNotIn("f_private_", proc.stdout)
        self.assertNotIn('"file_id"', proc.stdout)
        self.assertNotIn("private-review", proc.stdout)

    def test_execute_respects_planned_bytes_cap_before_running_extractor(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            plan_path = plan(root, approved=True)
            gate = root / "extraction-lane-readiness-gate.json"
            fake = root / "fake_extractor.py"
            write_global_gate(gate)
            write_fake_extractor(fake)
            proc = run_script(
                RUNNER,
                "--plan",
                str(plan_path),
                "--execute",
                "--max-jobs",
                "1",
                "--max-planned-bytes",
                "1",
                "--extractor-script",
                str(fake),
                "--extraction-readiness-gate",
                str(gate),
            )

        self.assertNotEqual(proc.returncode, 0)
        summary = json.loads(proc.stdout)
        self.assertEqual(summary["status"], "planned_bytes_cap_exceeded")
        self.assertEqual(summary["results_status"], {"skipped": 1})
        self.assertNotIn("f_private_", proc.stdout)

    def test_approved_scale_execute_is_blocked_by_global_gate(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            plan_path = plan(root, approved=True)
            gate = root / "extraction-lane-readiness-gate.json"
            write_global_gate(gate)
            fake = root / "fake_extractor.py"
            write_fake_extractor(fake)
            proc = run_script(
                RUNNER,
                "--plan",
                str(plan_path),
                "--execute",
                "--execution-scope",
                "scale",
                "--max-jobs",
                "1",
                "--max-planned-bytes",
                str(100 * 1024 * 1024),
                "--extractor-script",
                str(fake),
                "--extraction-readiness-gate",
                str(gate),
            )

        self.assertNotEqual(proc.returncode, 0)
        summary = json.loads(proc.stdout)
        self.assertEqual(summary["status"], "global_execution_preflight_blocked")
        self.assertEqual(summary["global_execution_preflight"]["status"], "scale_blocked_by_global_gate")
        self.assertEqual(summary["results_status"], {"skipped": 1})
        self.assertNotIn("f_private_", proc.stdout)


if __name__ == "__main__":
    unittest.main()
