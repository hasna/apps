#!/usr/bin/env python3
"""Offline tests for search-index/readiness reconciliation."""

from __future__ import annotations

import importlib.util
import hashlib
import json
import re
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


SCRIPT_DIR = Path(__file__).resolve().parents[1] / "scripts"
SCRIPT = SCRIPT_DIR / "verify_search_index_readiness_reconciliation.py"


def load_module():
    if str(SCRIPT_DIR) not in sys.path:
        sys.path.insert(0, str(SCRIPT_DIR))
    spec = importlib.util.spec_from_file_location("verify_search_index_readiness_reconciliation", SCRIPT)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"failed to load {SCRIPT}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def run_script(*args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["python3", str(SCRIPT), *args],
        check=False,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )


def write_json(path: Path, value: dict) -> None:
    path.write_text(json.dumps(value, indent=2, sort_keys=True), encoding="utf-8")


def plan_fixture() -> dict:
    return {
        "declared_totals": {"active_files": 3, "active_bytes": 600},
        "completeness": {
            "aggregate": {
                "by_outcome_lane": [
                    {"key": "planned|text", "count": 1, "bytes": 100},
                    {"key": "already_indexed|pdf", "count": 1, "bytes": 200},
                    {"key": "exempt_duplicate|pdf", "count": 1, "bytes": 300},
                ]
            }
        },
    }


def readiness_fixture(pdf_count: int = 2) -> dict:
    return {
        "totals": {"active_files": 3, "active_bytes": 600},
        "lanes": [
            {"lane": "text", "active_files": 1, "active_bytes": 100},
            {"lane": "pdf", "active_files": pdf_count, "active_bytes": 500},
        ],
    }


class VerifySearchIndexReadinessReconciliationTests(unittest.TestCase):
    def test_matching_lanes_pass(self) -> None:
        verifier = load_module()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            plan = root / "plan.json"
            readiness = root / "readiness.json"
            write_json(plan, plan_fixture())
            write_json(readiness, readiness_fixture())

            result = verifier.build_reconciliation(plan, readiness)
            plan_sha256 = hashlib.sha256(plan.read_bytes()).hexdigest()
            readiness_sha256 = hashlib.sha256(readiness.read_bytes()).hexdigest()

        self.assertEqual(result["status"], "ok")
        self.assertEqual(result["totals"]["mismatched_lanes"], 0)
        self.assertTrue(result["redaction_check"]["passed"])
        self.assertEqual(result["redaction_check"]["sensitive_marker_counts"], {})
        self.assertEqual(
            [item["label"] for item in result["source_artifacts"]],
            ["search_index_plan", "extraction_readiness_gate"],
        )
        self.assertEqual(result["source_artifacts"][0]["sha256"], plan_sha256)
        self.assertEqual(result["source_artifacts"][1]["sha256"], readiness_sha256)
        self.assertRegex(result["source_artifacts"][1]["sha256"], re.compile(r"^[0-9a-f]{64}$"))
        self.assertEqual(result["errors"], [])
        self.assertNotIn("file_id", json.dumps(result))

    def test_lane_mismatch_fails(self) -> None:
        verifier = load_module()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            plan = root / "plan.json"
            readiness = root / "readiness.json"
            write_json(plan, plan_fixture())
            write_json(readiness, readiness_fixture(pdf_count=3))

            result = verifier.build_reconciliation(plan, readiness)

        self.assertEqual(result["status"], "error")
        self.assertIn("lane_mismatch:pdf", result["errors"])

    def test_sensitive_marker_in_aggregate_output_fails(self) -> None:
        verifier = load_module()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            plan_value = plan_fixture()
            plan_value["completeness"]["aggregate"]["by_outcome_lane"][0]["key"] = "open-files://private|text"
            plan = root / "plan.json"
            readiness = root / "readiness.json"
            write_json(plan, plan_value)
            write_json(readiness, readiness_fixture())

            result = verifier.build_reconciliation(plan, readiness)

        self.assertEqual(result["status"], "error")
        self.assertFalse(result["redaction_check"]["passed"])
        self.assertIn("sensitive_marker_hits", result["errors"])
        self.assertEqual(result["redaction_check"]["sensitive_marker_counts"]["open_files_ref"], 1)

    def test_cli_writes_summary(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            plan = root / "plan.json"
            readiness = root / "readiness.json"
            output = root / "summary.json"
            write_json(plan, plan_fixture())
            write_json(readiness, readiness_fixture())

            proc = run_script("--plan", str(plan), "--readiness-gate", str(readiness), "--output", str(output))

            self.assertEqual(proc.returncode, 0, proc.stderr)
            generated = proc.stdout + output.read_text(encoding="utf-8")
            self.assertIn("open_files_search_index_readiness_reconciliation", generated)
            self.assertNotIn("file_id", generated)


if __name__ == "__main__":
    unittest.main()
