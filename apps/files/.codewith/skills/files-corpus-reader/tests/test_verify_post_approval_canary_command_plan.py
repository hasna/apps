#!/usr/bin/env python3
"""Tests for post-approval canary command plan verification."""

from __future__ import annotations

import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path


SCRIPT_DIR = Path(__file__).resolve().parents[1] / "scripts"
SCRIPT = SCRIPT_DIR / "verify_post_approval_canary_command_plan.py"
BUILDER_SCRIPT = SCRIPT_DIR / "build_post_approval_canary_command_plan.py"


def load_module(name: str, path: Path):
    if str(SCRIPT_DIR) not in sys.path:
        sys.path.insert(0, str(SCRIPT_DIR))
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"failed to load {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def intake(*, unlocked: list[str] | None = None) -> dict[str, object]:
    unlocked = unlocked or []
    return {
        "kind": "open_files_operator_approval_intake_readiness",
        "version": 1,
        "status": "canary_tasks_unlocked" if unlocked else "missing_required",
        "unlocked_decisions": unlocked,
        "decisions": [
            {
                "decision_id": decision_id,
                "unlock_state": "approval_note_ready_for_canary_task" if decision_id in unlocked else "blocked_missing_approval_note",
            }
            for decision_id in (
                "ocr_vision_canary",
                "large_file_canary",
                "archive_worker_image",
                "search_index_population",
                "llm_review_campaign",
            )
        ],
    }


def drive_approval_notes_summary(*, ready: bool = True) -> dict[str, object]:
    return {
        "kind": "open_files_drive_approval_notes_summary",
        "version": 1,
        "status": "approved" if ready else "missing_required",
        "required_decision_count": 14,
        "approved_required_decision_count": 14 if ready else 0,
        "missing_required_decisions": [] if ready else ["drive_decision"],
        "invalid_required_decisions": [],
        "redaction_check": {"passed": True, "sensitive_marker_counts": {}},
    }


def drive_approval_notes_verification(*, ready: bool = True) -> dict[str, object]:
    return {
        "kind": "open_files_drive_approval_notes_verification",
        "version": 1,
        "status": "ok",
        "notes_status": "approved" if ready else "missing_required",
        "sensitive_marker_counts": {"packet": {}, "summary": {}},
    }


def stage_readiness() -> dict[str, object]:
    return {
        "search_index_canary_stage_status": "blocked",
        "search_index_full_stage_status": "blocked",
        "search_index_runtime_attestation_status": "not_executed",
        "search_index_scale_readiness_status": "pending_canary",
        "search_index_search_probe_status": "not_executed",
        "search_index_remaining_jobs": 14651,
        "llm_rename_canary_stage_status": "blocked",
        "llm_rename_full_stage_status": "blocked",
        "llm_rename_campaign_status": "not_started",
        "llm_rename_canary_verified": False,
        "llm_rename_full_run_verified": False,
        "llm_rename_scale_readiness_status": "pending_canary",
        "llm_rename_gate_status": "pending",
        "llm_rename_runtime_attestation_gate_status": "pending",
        "llm_rename_remaining_jobs": 1,
        "metadata_apply_stage_status": "blocked",
        "metadata_apply_ready": False,
    }


def operator_approval_blocker_report(*, ready: bool = True) -> dict[str, object]:
    return {
        "kind": "open_files_operator_approval_blocker_report",
        "version": 1,
        "status": "operator_approval_required" if ready else "needs_prep",
        "safe_next_step": {
            "type": "operator_approval" if ready else "needs_prep",
            "final_gate_verifiers_ok": ready,
            "approval_request_verification_ok": ready,
            "ready_dashboard_decisions": 5,
            "approved_dashboard_decisions": 0,
            "ready_drive_approval_tasks": 14,
            "ready_nonapproval_nonmedia_tasks": 0,
            "media_deferred_until_final_pass": True,
            "stage_readiness": stage_readiness(),
        },
        "non_mutation_attestation": {
            "corpus_bytes_mutated": False,
            "s3_objects_mutated": False,
            "metadata_rows_mutated": False,
            "report_is_read_only": True,
        },
        "redaction_check": {"passed": True, "sensitive_marker_counts": {}},
    }


def dashboard(command: str = "python3 run_large_file_extraction_plan.py --execute") -> dict[str, object]:
    return {
        "kind": "open_files_extraction_approval_dashboard",
        "version": 1,
        "status": "ready_for_operator_review",
        "sections": {
            "large_file_canary": {
                "commands": {
                    "regenerate_approved_plan": "python3 plan_large_file_extraction.py --approved --approval-note-file note.json",
                    "execute_canary_after_approval": command,
                    "verify_canary_after_execution": "python3 verify_large_file_extraction_run.py --require-complete",
                }
            },
            "archive_worker_image": {"commands": {"refresh_static_verification": "python3 verify_extraction_worker_image.py"}},
            "search_index_population": {"commands": {"pre_stats": "bun run src/cli/index.tsx search-index stats --json"}},
            "ocr_vision_canary": {},
            "llm_review_campaign": {},
        },
    }


class PostApprovalCanaryCommandPlanVerifierTest(unittest.TestCase):
    def setUp(self) -> None:
        self.verifier = load_module("verify_post_approval_canary_command_plan", SCRIPT)
        self.builder = load_module("build_post_approval_canary_command_plan", BUILDER_SCRIPT)

    def write_inputs(
        self,
        root: Path,
        *,
        unlocked: list[str] | None = None,
        drive_ready: bool = True,
        blocker_ready: bool = True,
    ) -> tuple[Path, Path, Path, Path, Path]:
        intake_path = root / "approval-intake-readiness.json"
        dashboard_path = root / "extraction-approval-dashboard.json"
        drive_notes_path = root / "drive-approval-notes-summary.json"
        drive_verification_path = root / "drive-approval-notes-verification.json"
        blocker_report_path = root / "operator-approval-blocker-report.json"
        intake_path.write_text(json.dumps(intake(unlocked=unlocked), sort_keys=True), encoding="utf-8")
        dashboard_path.write_text(json.dumps(dashboard(), sort_keys=True), encoding="utf-8")
        drive_notes_path.write_text(json.dumps(drive_approval_notes_summary(ready=drive_ready), sort_keys=True), encoding="utf-8")
        drive_verification_path.write_text(json.dumps(drive_approval_notes_verification(ready=drive_ready), sort_keys=True), encoding="utf-8")
        blocker_report_path.write_text(json.dumps(operator_approval_blocker_report(ready=blocker_ready), sort_keys=True), encoding="utf-8")
        return intake_path, dashboard_path, drive_notes_path, drive_verification_path, blocker_report_path

    def build_plan_file(
        self,
        root: Path,
        intake_path: Path,
        dashboard_path: Path,
        drive_notes_path: Path,
        drive_verification_path: Path,
        blocker_report_path: Path,
    ) -> Path:
        plan = self.builder.build_plan(
            intake=json.loads(intake_path.read_text()),
            dashboard=json.loads(dashboard_path.read_text()),
            drive_approval_notes_summary=json.loads(drive_notes_path.read_text()),
            drive_approval_notes_verification=json.loads(drive_verification_path.read_text()),
            operator_approval_blocker_report=json.loads(blocker_report_path.read_text()),
            source_artifacts=[
                self.builder.source_entry("operator_approval_intake", intake_path),
                self.builder.source_entry("extraction_approval_dashboard", dashboard_path),
                self.builder.source_entry("drive_approval_notes_summary", drive_notes_path),
                self.builder.source_entry("drive_approval_notes_verification", drive_verification_path),
                self.builder.source_entry("operator_approval_blocker_report", blocker_report_path),
            ],
        )
        plan_path = root / "post-approval-canary-command-plan.json"
        plan_path.write_text(json.dumps(plan, indent=2, sort_keys=True), encoding="utf-8")
        return plan_path

    def test_valid_blocked_plan_verifies(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            intake_path, dashboard_path, drive_notes_path, drive_verification_path, blocker_report_path = self.write_inputs(root)
            plan_path = self.build_plan_file(root, intake_path, dashboard_path, drive_notes_path, drive_verification_path, blocker_report_path)

            result = self.verifier.verify_plan(
                plan_path,
                source_paths={
                    "operator_approval_intake": intake_path,
                    "extraction_approval_dashboard": dashboard_path,
                    "drive_approval_notes_summary": drive_notes_path,
                    "drive_approval_notes_verification": drive_verification_path,
                    "operator_approval_blocker_report": blocker_report_path,
                },
            )

        self.assertEqual(result["status"], "ok")
        self.assertEqual(result["plan_status"], "blocked_no_unlocked_decisions")
        self.assertTrue(result["gates"]["semantic_projection_current"])
        self.assertTrue(result["gates"]["operator_approval_blocker_stage_readiness_present"])
        self.assertEqual(
            result["summary"]["operator_approval_blocker_stage_readiness"]["search_index_search_probe_status"],
            "not_executed",
        )
        self.assertEqual(result["errors"], [])

    def test_stage_readiness_snapshot_drift_fails(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            intake_path, dashboard_path, drive_notes_path, drive_verification_path, blocker_report_path = self.write_inputs(root)
            plan_path = self.build_plan_file(root, intake_path, dashboard_path, drive_notes_path, drive_verification_path, blocker_report_path)
            plan = json.loads(plan_path.read_text())
            plan["operator_approval_blocker_snapshot"]["stage_readiness"]["metadata_apply_ready"] = True
            plan_path.write_text(json.dumps(plan, indent=2, sort_keys=True), encoding="utf-8")

            result = self.verifier.verify_plan(
                plan_path,
                source_paths=None,
            )

        self.assertEqual(result["status"], "error")
        self.assertIn("operator_approval_blocker_stage_readiness_summary_mismatch", result["errors"])

    def test_unlocked_intake_is_blocked_when_drive_approvals_missing(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            intake_path, dashboard_path, drive_notes_path, drive_verification_path, blocker_report_path = self.write_inputs(
                root,
                unlocked=["large_file_canary"],
                drive_ready=False,
            )
            plan_path = self.build_plan_file(root, intake_path, dashboard_path, drive_notes_path, drive_verification_path, blocker_report_path)

            result = self.verifier.verify_plan(
                plan_path,
                source_paths={
                    "operator_approval_intake": intake_path,
                    "extraction_approval_dashboard": dashboard_path,
                    "drive_approval_notes_summary": drive_notes_path,
                    "drive_approval_notes_verification": drive_verification_path,
                    "operator_approval_blocker_report": blocker_report_path,
                },
            )
            plan = json.loads(plan_path.read_text())

        self.assertEqual(result["status"], "ok")
        self.assertEqual(result["plan_status"], "blocked_drive_approval_notes")
        self.assertEqual(plan["command_queue"], [])
        self.assertEqual(plan["drive_blocked_decisions"], ["large_file_canary"])
        self.assertFalse(plan["summary"]["drive_approval_ready"])

    def test_current_source_hash_mismatch_fails(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            intake_path, dashboard_path, drive_notes_path, drive_verification_path, blocker_report_path = self.write_inputs(root)
            plan_path = self.build_plan_file(root, intake_path, dashboard_path, drive_notes_path, drive_verification_path, blocker_report_path)
            intake_path.write_text(json.dumps(intake(unlocked=["large_file_canary"]), sort_keys=True), encoding="utf-8")

            result = self.verifier.verify_plan(
                plan_path,
                source_paths={
                    "operator_approval_intake": intake_path,
                    "extraction_approval_dashboard": dashboard_path,
                    "drive_approval_notes_summary": drive_notes_path,
                    "drive_approval_notes_verification": drive_verification_path,
                    "operator_approval_blocker_report": blocker_report_path,
                },
            )

        self.assertEqual(result["status"], "error")
        self.assertIn("source_artifact_current_sha256_mismatch:operator_approval_intake", result["errors"])

    def test_summary_mismatch_fails(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            intake_path, dashboard_path, drive_notes_path, drive_verification_path, blocker_report_path = self.write_inputs(root, unlocked=["large_file_canary"])
            plan_path = self.build_plan_file(root, intake_path, dashboard_path, drive_notes_path, drive_verification_path, blocker_report_path)
            plan = json.loads(plan_path.read_text())
            plan["summary"]["planned_commands"] = 999
            plan_path.write_text(json.dumps(plan, indent=2, sort_keys=True), encoding="utf-8")

            result = self.verifier.verify_plan(
                plan_path,
                source_paths={
                    "operator_approval_intake": intake_path,
                    "extraction_approval_dashboard": dashboard_path,
                    "drive_approval_notes_summary": drive_notes_path,
                    "drive_approval_notes_verification": drive_verification_path,
                    "operator_approval_blocker_report": blocker_report_path,
                },
            )

        self.assertEqual(result["status"], "error")
        self.assertIn("summary_count_mismatch:planned_commands", result["errors"])
        self.assertIn("semantic_projection_mismatch", result["errors"])

    def test_raw_command_field_fails(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            intake_path, dashboard_path, drive_notes_path, drive_verification_path, blocker_report_path = self.write_inputs(root, unlocked=["large_file_canary"])
            plan_path = self.build_plan_file(root, intake_path, dashboard_path, drive_notes_path, drive_verification_path, blocker_report_path)
            plan = json.loads(plan_path.read_text())
            plan["command_queue"][0]["command"] = "python3 private.py --execute"
            plan_path.write_text(json.dumps(plan, indent=2, sort_keys=True), encoding="utf-8")

            result = self.verifier.verify_plan(
                plan_path,
                source_paths={
                    "operator_approval_intake": intake_path,
                    "extraction_approval_dashboard": dashboard_path,
                    "drive_approval_notes_summary": drive_notes_path,
                    "drive_approval_notes_verification": drive_verification_path,
                    "operator_approval_blocker_report": blocker_report_path,
                },
            )

        self.assertEqual(result["status"], "error")
        self.assertIn("raw_command_field_present:command_queue[0]", result["errors"])

    def test_sensitive_marker_fails_without_echoing_private_value(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            intake_path, dashboard_path, drive_notes_path, drive_verification_path, blocker_report_path = self.write_inputs(root)
            plan_path = self.build_plan_file(root, intake_path, dashboard_path, drive_notes_path, drive_verification_path, blocker_report_path)
            plan = json.loads(plan_path.read_text())
            plan["source_ref"] = "open-files://private-value"
            plan_path.write_text(json.dumps(plan, indent=2, sort_keys=True), encoding="utf-8")

            result = self.verifier.verify_plan(
                plan_path,
                source_paths={
                    "operator_approval_intake": intake_path,
                    "extraction_approval_dashboard": dashboard_path,
                    "drive_approval_notes_summary": drive_notes_path,
                    "drive_approval_notes_verification": drive_verification_path,
                    "operator_approval_blocker_report": blocker_report_path,
                },
            )

        self.assertEqual(result["status"], "error")
        self.assertIn("sensitive_marker_hits", result["errors"])
        self.assertNotIn("private-value", str(result))


if __name__ == "__main__":
    unittest.main()
