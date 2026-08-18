#!/usr/bin/env python3
"""Offline tests for redacted search-index approval packets."""

from __future__ import annotations

import json
import subprocess
import tempfile
import unittest
from pathlib import Path

from test_plan_search_index_population import SCRIPT as PLANNER
from test_plan_search_index_population import setup_db


PACKET = Path(__file__).resolve().parents[1] / "scripts" / "build_search_index_approval_packet.py"


def run_script(script: Path, *args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["python3", str(script), *args],
        check=False,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )


class SearchIndexApprovalPacketTests(unittest.TestCase):
    def test_packet_is_redacted_and_contains_canary_commands(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            db = root / "files.db"
            output = root / "plan"
            setup_db(db)
            plan_proc = run_script(PLANNER, "--db", str(db), "--output-dir", str(output))
            self.assertEqual(plan_proc.returncode, 0, plan_proc.stderr)
            plan_path = output / "search-index-population-plan.json"
            proc = run_script(
                PACKET,
                "--plan",
                str(plan_path),
                "--files-command",
                "bun run src/cli/index.tsx",
                "--canary-jobs",
                "2",
                "--canary-max-bytes",
                "12345",
            )

        self.assertEqual(proc.returncode, 0, proc.stderr)
        packet = json.loads(proc.stdout)
        self.assertEqual(packet["kind"], "search_index_population_approval_packet")
        self.assertEqual(packet["validation"]["status"], "ok")
        self.assertTrue(packet["redaction_check"]["passed"])
        self.assertEqual(packet["packet_errors"], [])
        self.assertTrue(packet["approval_packet_checks"]["validation_ok"])
        self.assertTrue(packet["approval_packet_checks"]["redaction_ok"])
        self.assertTrue(packet["approval_packet_checks"]["source_artifacts_present"])
        self.assertTrue(packet["approval_packet_checks"]["source_artifact_hashes_ok"])
        self.assertEqual(packet["source_artifacts"][0]["label"], "search_index_population_plan")
        self.assertTrue(packet["approval_required"])
        self.assertEqual(packet["declared_totals"]["active_files"], 4)
        self.assertTrue(packet["declared_totals"]["reconciled"])
        outcome_counts = {row["key"]: row["count"] for row in packet["completeness"]["aggregate"]["by_outcome"]}
        self.assertEqual(outcome_counts, {"already_indexed": 1, "exempt_duplicate": 1, "planned": 2})
        self.assertIn("--max-jobs 2", packet["commands"]["execute_canary_after_approval"])
        self.assertIn("--max-canary-jobs 2", packet["commands"]["execute_canary_after_approval"])
        self.assertIn("--max-planned-bytes 12345", packet["commands"]["execute_canary_after_approval"])
        self.assertIn("--max-canary-bytes 12345", packet["commands"]["execute_canary_after_approval"])
        self.assertIn("verify_search_index_population_run.py", packet["commands"]["verify_canary_after_execution"])
        self.assertIn("--check-db", packet["commands"]["verify_canary_after_execution"])
        self.assertIn("--require-search-probe", packet["commands"]["verify_canary_after_execution"])
        self.assertIn("bun run src/cli/index.tsx", packet["commands"]["pre_stats"])
        self.assertNotIn("f_missing_text", proc.stdout)
        self.assertNotIn("private-notes", proc.stdout)
        self.assertNotIn('"file_id"', proc.stdout)

    def test_invalid_canary_values_are_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            db = root / "files.db"
            output = root / "plan"
            setup_db(db)
            plan_proc = run_script(PLANNER, "--db", str(db), "--output-dir", str(output))
            self.assertEqual(plan_proc.returncode, 0, plan_proc.stderr)
            proc = run_script(PACKET, "--plan", str(output / "search-index-population-plan.json"), "--canary-jobs", "0")

        self.assertNotEqual(proc.returncode, 0)
        self.assertIn("--canary-jobs must be positive", proc.stderr)

    def test_regenerate_command_preserves_planner_filters(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            db = root / "files.db"
            output = root / "plan"
            setup_db(db)
            plan_proc = run_script(
                PLANNER,
                "--db",
                str(db),
                "--output-dir",
                str(output),
                "--exclude-lanes",
                "needs_transcription,needs_video_pipeline",
                "--max-jobs",
                "2",
                "--max-jobs-per-lane",
                "1",
                "--order",
                "size-desc",
            )
            self.assertEqual(plan_proc.returncode, 0, plan_proc.stderr)
            proc = run_script(PACKET, "--plan", str(output / "search-index-population-plan.json"))

        self.assertEqual(proc.returncode, 0, proc.stderr)
        packet = json.loads(proc.stdout)
        command = packet["commands"]["regenerate_approved_plan"]
        self.assertIn("--db", command)
        self.assertIn("--exclude-lanes needs_transcription,needs_video_pipeline", command)
        self.assertIn("--max-jobs 2", command)
        self.assertIn("--max-jobs-per-lane 1", command)
        self.assertIn("--order size-desc", command)
        self.assertIn("--approval-note-file", command)
        self.assertNotIn("--approval-note '<operator approval note>'", command)

    def test_packet_generation_fails_on_sensitive_marker(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            db = root / "files.db"
            output = root / "plan"
            setup_db(db)
            plan_proc = run_script(PLANNER, "--db", str(db), "--output-dir", str(output))
            self.assertEqual(plan_proc.returncode, 0, plan_proc.stderr)
            plan_path = output / "search-index-population-plan.json"
            plan = json.loads(plan_path.read_text(encoding="utf-8"))
            plan["lanes"] = ["open-files://private"]
            plan_path.write_text(json.dumps(plan), encoding="utf-8")

            proc = run_script(PACKET, "--plan", str(plan_path))

        self.assertEqual(proc.returncode, 1)
        packet = json.loads(proc.stdout)
        self.assertFalse(packet["redaction_check"]["passed"])
        self.assertFalse(packet["approval_packet_checks"]["redaction_ok"])
        self.assertIn("sensitive_marker_hits", packet["packet_errors"])
        self.assertEqual(packet["redaction_check"]["sensitive_marker_counts"]["open_files_ref"], 1)


if __name__ == "__main__":
    unittest.main()
