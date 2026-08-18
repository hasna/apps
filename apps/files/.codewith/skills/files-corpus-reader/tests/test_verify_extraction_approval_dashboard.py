#!/usr/bin/env python3
"""Offline tests for extraction approval dashboard verification."""

from __future__ import annotations

import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

from test_build_extraction_approval_dashboard import fixture_files


SCRIPT_DIR = Path(__file__).resolve().parents[1] / "scripts"
SCRIPT = SCRIPT_DIR / "verify_extraction_approval_dashboard.py"
BUILDER = SCRIPT_DIR / "build_extraction_approval_dashboard.py"


def load_module(script: Path, name: str):
    if str(SCRIPT_DIR) not in sys.path:
        sys.path.insert(0, str(SCRIPT_DIR))
    spec = importlib.util.spec_from_file_location(name, script)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"failed to load {script}")
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


def build_dashboard(root: Path) -> tuple[dict, dict[str, Path]]:
    builder = load_module(BUILDER, "build_extraction_approval_dashboard")
    paths = fixture_files(root)
    args = SimpleNamespace(**{key: str(value) for key, value in paths.items()})
    dashboard = builder.build_dashboard(args)
    return dashboard, paths


class VerifyExtractionApprovalDashboardTests(unittest.TestCase):
    def test_valid_dashboard_passes_with_current_source_hashes(self) -> None:
        verifier = load_module(SCRIPT, "verify_extraction_approval_dashboard")
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            dashboard, source_paths = build_dashboard(root)
            dashboard_path = root / "dashboard.json"
            dashboard_path.write_text(json.dumps(dashboard), encoding="utf-8")

            result = verifier.verify_dashboard(dashboard_path, source_paths=source_paths)

        self.assertEqual(result["status"], "ok")
        self.assertTrue(result["gates"]["redaction_ok"])
        self.assertTrue(result["gates"]["source_artifact_current_hashes_ok"])
        self.assertTrue(result["gates"]["overall_counts_consistent"])
        self.assertEqual(result["summary"]["ready_approval_items"], 5)
        self.assertEqual(result["errors"], [])

    def test_stale_current_source_hash_fails(self) -> None:
        verifier = load_module(SCRIPT, "verify_extraction_approval_dashboard")
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            dashboard, source_paths = build_dashboard(root)
            source_paths["tool_remediation"].write_text(
                json.dumps({"changed": True}),
                encoding="utf-8",
            )
            dashboard_path = root / "dashboard.json"
            dashboard_path.write_text(json.dumps(dashboard), encoding="utf-8")

            result = verifier.verify_dashboard(dashboard_path, source_paths=source_paths)

        self.assertEqual(result["status"], "error")
        self.assertFalse(result["gates"]["source_artifact_current_hashes_ok"])
        self.assertIn("source_artifact_current_sha256_mismatch:tool_remediation", result["errors"])
        self.assertIn("tool_remediation", result["source_artifacts"]["current_mismatched"])

    def test_overall_count_mismatch_fails(self) -> None:
        verifier = load_module(SCRIPT, "verify_extraction_approval_dashboard")
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            dashboard, _source_paths = build_dashboard(root)
            dashboard["overall"]["ready_approval_items"] = 999
            dashboard_path = root / "dashboard.json"
            dashboard_path.write_text(json.dumps(dashboard), encoding="utf-8")

            result = verifier.verify_dashboard(dashboard_path)

        self.assertEqual(result["status"], "error")
        self.assertFalse(result["gates"]["overall_counts_consistent"])
        self.assertIn("overall_ready_approval_items_inconsistent", result["errors"])

    def test_cli_fails_on_sensitive_marker_without_echoing_private_value(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            dashboard, _source_paths = build_dashboard(root)
            dashboard["private_metadata"] = {"file_id": "f_privateSecret123"}
            dashboard_path = root / "dashboard.json"
            output = root / "verification.json"
            dashboard_path.write_text(json.dumps(dashboard), encoding="utf-8")

            proc = run_script(
                "--dashboard",
                str(dashboard_path),
                "--output",
                str(output),
                "--skip-current-source-check",
            )
            result = json.loads(output.read_text(encoding="utf-8"))

        self.assertEqual(proc.returncode, 1)
        self.assertIn("sensitive_marker_hits", result["errors"])
        self.assertIn("json_file_id_key", result["sensitive_marker_counts"])
        self.assertNotIn("f_privateSecret123", proc.stdout)


if __name__ == "__main__":
    unittest.main()
