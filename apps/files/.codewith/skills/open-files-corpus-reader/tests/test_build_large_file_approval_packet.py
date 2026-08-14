#!/usr/bin/env python3
"""Offline tests for large-file approval packet generation."""

from __future__ import annotations

import json
import subprocess
import tempfile
import unittest
from pathlib import Path

from test_run_large_file_extraction_plan import plan


SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "build_large_file_approval_packet.py"


def run_packet(*args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["python3", str(SCRIPT), *args],
        check=False,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )


class LargeFileApprovalPacketTests(unittest.TestCase):
    def test_packet_is_redacted_and_contains_operator_commands(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            plan_path = plan(root, approved=False)
            output = root / "approval.json"
            proc = run_packet(
                "--plan",
                str(plan_path),
                "--canary-jobs",
                "3",
                "--canary-max-bytes",
                str(40 * 1024 * 1024),
                "--output",
                str(output),
            )
            self.assertEqual(proc.returncode, 0, proc.stderr)
            packet = json.loads(output.read_text(encoding="utf-8"))

        self.assertEqual(packet["kind"], "large_file_extraction_approval_packet")
        self.assertEqual(packet["plan_status"], "approval_required")
        self.assertFalse(packet["approved"])
        self.assertTrue(packet["approval_required"])
        self.assertEqual(packet["validation"]["status"], "ok")
        self.assertTrue(packet["redaction_check"]["passed"])
        self.assertEqual(packet["packet_errors"], [])
        self.assertTrue(packet["approval_packet_checks"]["validation_ok"])
        self.assertTrue(packet["approval_packet_checks"]["redaction_ok"])
        self.assertTrue(packet["approval_packet_checks"]["source_artifacts_present"])
        self.assertTrue(packet["approval_packet_checks"]["source_artifact_hashes_ok"])
        self.assertEqual(packet["source_artifacts"][0]["label"], "large_file_extraction_plan")
        self.assertEqual(packet["validation"]["duplicate_private_file_ids"], 0)
        self.assertIn("verify_large_file_extraction_run.py", packet["commands"]["verify_canary_after_execution"])
        self.assertIn("--check-review-artifacts", packet["commands"]["verify_canary_after_execution"])
        self.assertIn("collect_large_file_review_manifest.py", packet["commands"]["collect_review_manifest_after_verification"])
        self.assertIn("--approval-note-file", packet["commands"]["regenerate_approved_plan"])
        self.assertNotIn("--approval-note '<operator approval note>'", packet["commands"]["regenerate_approved_plan"])
        public_text = proc.stdout + json.dumps(packet)
        self.assertNotIn("f_private_", public_text)
        self.assertNotIn('"file_id"', public_text)
        self.assertNotIn("private-contract", public_text)

    def test_invalid_canary_values_are_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            plan_path = plan(root, approved=False)
            proc = run_packet("--plan", str(plan_path), "--canary-jobs", "0")

        self.assertNotEqual(proc.returncode, 0)
        self.assertIn("--canary-jobs must be positive", proc.stderr)


if __name__ == "__main__":
    unittest.main()
