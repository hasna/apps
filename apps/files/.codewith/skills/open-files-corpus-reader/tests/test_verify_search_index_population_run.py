#!/usr/bin/env python3
"""Offline tests for redacted search-index run verification."""

from __future__ import annotations

import json
import sqlite3
import subprocess
import tempfile
import unittest
from pathlib import Path

from test_run_search_index_population_plan import RUNNER, plan, write_fake_extractor, write_fake_files, write_global_gate


VERIFIER = Path(__file__).resolve().parents[1] / "scripts" / "verify_search_index_population_run.py"


def run_script(script: Path, *args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["python3", str(script), *args],
        check=False,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )


def run_fake_approved_index(root: Path) -> tuple[Path, Path, Path]:
    plan_path = plan(root, approved=True)
    gate = root / "extraction-lane-readiness-gate.json"
    fake_extractor = root / "fake_extractor.py"
    fake_files = root / "fake_files.py"
    run_dir = root / "run"
    write_global_gate(gate)
    write_fake_extractor(fake_extractor)
    write_fake_files(fake_files)
    proc = run_script(
        RUNNER,
        "--plan",
        str(plan_path),
        "--execute",
        "--max-jobs",
        "1",
        "--max-planned-bytes",
        str(10 * 1024 * 1024),
        "--extractor-script",
        str(fake_extractor),
        "--files-command",
        f"python3 {fake_files}",
        "--output-dir",
        str(run_dir),
        "--extraction-readiness-gate",
        str(gate),
    )
    if proc.returncode != 0:
        raise AssertionError(proc.stderr or proc.stdout)
    return plan_path, run_dir, root / "files.db"


class SearchIndexPopulationVerifierTests(unittest.TestCase):
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
        self.assertNotIn("f_missing_text", proc.stdout)

    def test_verifier_accepts_completed_private_results_without_public_leaks(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            plan_path, run_dir, _db = run_fake_approved_index(root)
            proc = run_script(
                VERIFIER,
                "--plan",
                str(plan_path),
                "--run-dir",
                str(run_dir),
                "--require-complete",
                "--require-search-probe",
            )

        self.assertEqual(proc.returncode, 0, proc.stderr)
        report = json.loads(proc.stdout)
        self.assertEqual(report["status"], "ok")
        self.assertEqual(report["run_status"], "completed")
        self.assertEqual(report["jobs_completed"], 1)
        self.assertEqual(report["indexed_results"], 1)
        self.assertEqual(report["search_probe"]["status"], "ok")
        self.assertEqual(report["search_probe"]["probes"], 1)
        self.assertEqual(report["search_probe"]["matched_expected_file_probes"], 1)
        self.assertEqual(report["duplicate_result_file_ids"], 0)
        self.assertEqual(report["summary_sensitive_marker_hits"], 0)
        self.assertEqual(report["selected_private_ids_sha256"], report["result_private_ids_sha256"])
        self.assertNotIn("f_missing_text", proc.stdout)
        self.assertNotIn('"file_id"', proc.stdout)
        self.assertNotIn("warehouse renewal", proc.stdout)

    def test_verifier_can_check_db_index_coverage(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            plan_path, run_dir, db_path = run_fake_approved_index(root)
            results = [
                json.loads(line)
                for line in (run_dir / "search-index-run-results.jsonl").read_text(encoding="utf-8").splitlines()
                if line.strip()
            ]
            db = sqlite3.connect(db_path)
            db.execute(
                "INSERT INTO file_search_documents (id, file_id, kind, status) VALUES (?, ?, ?, ?)",
                ("doc_verified", results[0]["file_id"], "semantic_metadata", "ready"),
            )
            db.commit()
            db.close()
            proc = run_script(
                VERIFIER,
                "--plan",
                str(plan_path),
                "--run-dir",
                str(run_dir),
                "--require-complete",
                "--check-db",
                "--require-search-probe",
            )

        self.assertEqual(proc.returncode, 0, proc.stderr)
        report = json.loads(proc.stdout)
        self.assertEqual(report["status"], "ok")
        self.assertEqual(report["db_check"]["ready_or_partial"], 1)
        self.assertGreaterEqual(report["db_check"]["total"], 1)

    def test_verifier_fails_db_check_when_index_document_missing(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            plan_path, run_dir, _db_path = run_fake_approved_index(root)
            proc = run_script(
                VERIFIER,
                "--plan",
                str(plan_path),
                "--run-dir",
                str(run_dir),
                "--require-complete",
                "--check-db",
                "--require-search-probe",
            )

        self.assertNotEqual(proc.returncode, 0)
        report = json.loads(proc.stdout)
        self.assertEqual(report["status"], "error")
        self.assertEqual(report["errors"][0]["code"], "db_index_coverage_mismatch")
        self.assertNotIn("f_missing_text", proc.stdout)

    def test_verifier_fails_when_required_search_probe_is_missing(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            plan_path, run_dir, _db_path = run_fake_approved_index(root)
            summary_path = run_dir / "search-index-run-summary.json"
            summary = json.loads(summary_path.read_text(encoding="utf-8"))
            summary["search_probe_attestation"] = {"status": "not_executed", "probes": 0}
            summary["scale_readiness_attestation"]["search_probe_status"] = "not_executed"
            summary["scale_readiness_attestation"]["status"] = "pending_canary"
            summary_path.write_text(json.dumps(summary, indent=2, sort_keys=True), encoding="utf-8")
            proc = run_script(
                VERIFIER,
                "--plan",
                str(plan_path),
                "--run-dir",
                str(run_dir),
                "--require-complete",
                "--require-search-probe",
            )

        self.assertNotEqual(proc.returncode, 0)
        report = json.loads(proc.stdout)
        self.assertEqual(report["status"], "error")
        self.assertIn("search_probe_required", {error["code"] for error in report["errors"]})
        self.assertNotIn("warehouse renewal", proc.stdout)


if __name__ == "__main__":
    unittest.main()
