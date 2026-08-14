#!/usr/bin/env python3
"""Tests for post-approval canary command run summary verification."""

from __future__ import annotations

import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path


SCRIPT_DIR = Path(__file__).resolve().parents[1] / "scripts"
SCRIPT = SCRIPT_DIR / "verify_post_approval_canary_command_run.py"
RUNNER_SCRIPT = SCRIPT_DIR / "run_post_approval_canary_command_plan.py"


def load_module(name: str, path: Path):
    if str(SCRIPT_DIR) not in sys.path:
        sys.path.insert(0, str(SCRIPT_DIR))
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"failed to load {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def dashboard(command: str = "python3 -c 'print(1)'") -> dict[str, object]:
    return {
        "kind": "open_files_extraction_approval_dashboard",
        "version": 1,
        "sections": {
            "large_file_canary": {
                "commands": {
                    "execute_canary_after_approval": command,
                }
            }
        },
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
            "ready_nonapproval_nonmedia_tasks": 0,
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


def plan(
    command: str = "python3 -c 'print(1)'",
    *,
    status: str = "blocked_no_unlocked_decisions",
    blocker_source: dict[str, object] | None = None,
) -> dict[str, object]:
    runner = load_module("run_post_approval_canary_command_plan_for_fixtures", RUNNER_SCRIPT)
    entry = {
        "decision_id": "large_file_canary",
        "section": "large_file_canary",
        "name": "execute_canary_after_approval",
        "order": 30,
        "command_ref": "dashboard.sections.large_file_canary.commands.execute_canary_after_approval",
        "command_sha256": runner.text_sha256(command),
        "command_bytes": len(command.encode("utf-8")),
        "mutation_class": "canary_private_artifact_execution",
        "requires_valid_approval_note": True,
        "requires_valid_drive_approval_notes": True,
        "raw_command_omitted": True,
    }
    return {
        "kind": "open_files_post_approval_canary_command_plan",
        "version": 1,
        "status": status,
        "source_artifacts": [blocker_source] if blocker_source else [],
        "operator_approval_blocker_snapshot": {
            "status": "operator_approval_required",
            "safe_next_step_type": "operator_approval",
            "ready": True,
            "stage_readiness": stage_readiness(),
        },
        "command_queue": [] if status == "blocked_no_unlocked_decisions" else [entry],
    }


def verification(status: str = "blocked_no_unlocked_decisions") -> dict[str, object]:
    return {
        "kind": "open_files_post_approval_canary_command_plan_verification",
        "version": 1,
        "status": "ok",
        "plan_status": status,
    }


class PostApprovalCanaryCommandRunVerifierTest(unittest.TestCase):
    def setUp(self) -> None:
        self.verifier = load_module("verify_post_approval_canary_command_run", SCRIPT)
        self.runner = load_module("run_post_approval_canary_command_plan", RUNNER_SCRIPT)

    def write_sources(
        self,
        root: Path,
        *,
        status: str = "blocked_no_unlocked_decisions",
        command: str = "python3 -c 'print(1)'",
        drive_ready: bool = True,
    ) -> tuple[Path, Path, Path, Path, Path, Path]:
        plan_path = root / "plan.json"
        verification_path = root / "plan-verification.json"
        dashboard_path = root / "dashboard.json"
        drive_notes_path = root / "drive-approval-notes-summary.json"
        drive_verification_path = root / "drive-approval-notes-verification.json"
        blocker_report_path = root / "operator-approval-blocker-report.json"
        dashboard_path.write_text(json.dumps(dashboard(command), sort_keys=True), encoding="utf-8")
        drive_notes_path.write_text(json.dumps(drive_approval_notes_summary(ready=drive_ready), sort_keys=True), encoding="utf-8")
        drive_verification_path.write_text(json.dumps(drive_approval_notes_verification(ready=drive_ready), sort_keys=True), encoding="utf-8")
        blocker_report_path.write_text(json.dumps(operator_approval_blocker_report(), sort_keys=True), encoding="utf-8")
        blocker_source = self.runner.source_entry("operator_approval_blocker_report", blocker_report_path)
        plan_path.write_text(json.dumps(plan(command, status=status, blocker_source=blocker_source), sort_keys=True), encoding="utf-8")
        verification_path.write_text(json.dumps(verification(status), sort_keys=True), encoding="utf-8")
        return plan_path, verification_path, dashboard_path, drive_notes_path, drive_verification_path, blocker_report_path

    def build_summary_file(
        self,
        root: Path,
        plan_path: Path,
        verification_path: Path,
        dashboard_path: Path,
        drive_notes_path: Path,
        drive_verification_path: Path,
        blocker_report_path: Path,
        *,
        execute: bool = False,
    ) -> Path:
        summary = self.runner.build_run_summary(
            plan=json.loads(plan_path.read_text()),
            verification=json.loads(verification_path.read_text()),
            dashboard=json.loads(dashboard_path.read_text()),
            drive_approval_notes_summary=json.loads(drive_notes_path.read_text()),
            drive_approval_notes_verification=json.loads(drive_verification_path.read_text()),
            operator_approval_blocker_report=json.loads(blocker_report_path.read_text()),
            source_artifacts=[
                self.runner.source_entry("post_approval_canary_command_plan", plan_path),
                self.runner.source_entry("post_approval_canary_command_plan_verification", verification_path),
                self.runner.source_entry("extraction_approval_dashboard", dashboard_path),
                self.runner.source_entry("drive_approval_notes_summary", drive_notes_path),
                self.runner.source_entry("drive_approval_notes_verification", drive_verification_path),
                self.runner.source_entry("operator_approval_blocker_report", blocker_report_path),
            ],
            execute=execute,
            cwd=root,
            log_dir=root / "logs",
            timeout_seconds=5,
        )
        summary_path = root / "run-summary.json"
        summary_path.write_text(json.dumps(summary, indent=2, sort_keys=True), encoding="utf-8")
        return summary_path

    def verify(
        self,
        summary_path: Path,
        plan_path: Path,
        verification_path: Path,
        dashboard_path: Path,
        drive_notes_path: Path,
        drive_verification_path: Path,
        blocker_report_path: Path,
    ):
        return self.verifier.verify_run_summary(
            summary_path,
            source_paths={
                "post_approval_canary_command_plan": plan_path,
                "post_approval_canary_command_plan_verification": verification_path,
                "extraction_approval_dashboard": dashboard_path,
                "drive_approval_notes_summary": drive_notes_path,
                "drive_approval_notes_verification": drive_verification_path,
                "operator_approval_blocker_report": blocker_report_path,
            },
        )

    def test_valid_blocked_dry_run_verifies(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            plan_path, verification_path, dashboard_path, drive_notes_path, drive_verification_path, blocker_report_path = self.write_sources(root)
            summary_path = self.build_summary_file(root, plan_path, verification_path, dashboard_path, drive_notes_path, drive_verification_path, blocker_report_path)

            result = self.verify(summary_path, plan_path, verification_path, dashboard_path, drive_notes_path, drive_verification_path, blocker_report_path)

        self.assertEqual(result["status"], "ok")
        self.assertEqual(result["run_status"], "dry_run_blocked")
        self.assertTrue(result["gates"]["dry_run_semantic_current"])
        self.assertTrue(result["gates"]["operator_approval_blocker_stage_readiness_present"])
        self.assertEqual(
            result["summary"]["operator_approval_blocker_stage_readiness"]["llm_rename_gate_status"],
            "pending",
        )
        self.assertEqual(result["errors"], [])

    def test_current_source_mismatch_fails(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            plan_path, verification_path, dashboard_path, drive_notes_path, drive_verification_path, blocker_report_path = self.write_sources(root)
            summary_path = self.build_summary_file(root, plan_path, verification_path, dashboard_path, drive_notes_path, drive_verification_path, blocker_report_path)
            plan_path.write_text(json.dumps(plan(status="ready_for_operator_execution"), sort_keys=True), encoding="utf-8")

            result = self.verify(summary_path, plan_path, verification_path, dashboard_path, drive_notes_path, drive_verification_path, blocker_report_path)

        self.assertEqual(result["status"], "error")
        self.assertIn("source_artifact_current_sha256_mismatch:post_approval_canary_command_plan", result["errors"])

    def test_summary_count_mismatch_fails(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            plan_path, verification_path, dashboard_path, drive_notes_path, drive_verification_path, blocker_report_path = self.write_sources(root, status="ready_for_operator_execution")
            summary_path = self.build_summary_file(root, plan_path, verification_path, dashboard_path, drive_notes_path, drive_verification_path, blocker_report_path)
            data = json.loads(summary_path.read_text())
            data["summary"]["resolved_commands"] = 99
            summary_path.write_text(json.dumps(data, indent=2, sort_keys=True), encoding="utf-8")

            result = self.verify(summary_path, plan_path, verification_path, dashboard_path, drive_notes_path, drive_verification_path, blocker_report_path)

        self.assertEqual(result["status"], "error")
        self.assertIn("summary_count_mismatch:resolved_commands", result["errors"])
        self.assertIn("dry_run_semantic_projection_mismatch", result["errors"])

    def test_ready_plan_dry_run_blocks_when_drive_approvals_missing(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            plan_path, verification_path, dashboard_path, drive_notes_path, drive_verification_path, blocker_report_path = self.write_sources(
                root,
                status="ready_for_operator_execution",
                drive_ready=False,
            )
            summary_path = self.build_summary_file(root, plan_path, verification_path, dashboard_path, drive_notes_path, drive_verification_path, blocker_report_path)

            result = self.verify(summary_path, plan_path, verification_path, dashboard_path, drive_notes_path, drive_verification_path, blocker_report_path)
            data = json.loads(summary_path.read_text())

        self.assertEqual(result["status"], "ok")
        self.assertEqual(result["run_status"], "dry_run_blocked")
        self.assertFalse(data["summary"]["drive_approval_ready"])
        self.assertIn("drive_approval_notes_not_ready:missing_required", data["summary"]["blocked_reasons"])

    def test_raw_command_field_fails(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            plan_path, verification_path, dashboard_path, drive_notes_path, drive_verification_path, blocker_report_path = self.write_sources(root, status="ready_for_operator_execution")
            summary_path = self.build_summary_file(root, plan_path, verification_path, dashboard_path, drive_notes_path, drive_verification_path, blocker_report_path)
            data = json.loads(summary_path.read_text())
            data["commands"][0]["command"] = "python3 private.py"
            summary_path.write_text(json.dumps(data, indent=2, sort_keys=True), encoding="utf-8")

            result = self.verify(summary_path, plan_path, verification_path, dashboard_path, drive_notes_path, drive_verification_path, blocker_report_path)

        self.assertEqual(result["status"], "error")
        self.assertIn("raw_command_field_present:commands[0]", result["errors"])

    def test_executed_log_hash_mismatch_fails(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            plan_path, verification_path, dashboard_path, drive_notes_path, drive_verification_path, blocker_report_path = self.write_sources(root, status="ready_for_operator_execution", command="python3 -c 'print(123)'")
            summary_path = self.build_summary_file(root, plan_path, verification_path, dashboard_path, drive_notes_path, drive_verification_path, blocker_report_path, execute=True)
            data = json.loads(summary_path.read_text())
            log_path = Path(data["commands"][0]["result"]["log_file"])
            log_path.write_text("tampered", encoding="utf-8")

            result = self.verify(summary_path, plan_path, verification_path, dashboard_path, drive_notes_path, drive_verification_path, blocker_report_path)

        self.assertEqual(result["status"], "error")
        self.assertIn("executed_command_log_bytes_mismatch:commands[0]", result["errors"])
        self.assertIn("executed_command_log_sha256_mismatch:commands[0]", result["errors"])

    def test_sensitive_marker_fails_without_echoing_value(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            plan_path, verification_path, dashboard_path, drive_notes_path, drive_verification_path, blocker_report_path = self.write_sources(root)
            summary_path = self.build_summary_file(root, plan_path, verification_path, dashboard_path, drive_notes_path, drive_verification_path, blocker_report_path)
            data = json.loads(summary_path.read_text())
            data["source_ref"] = "open-files://private-value"
            summary_path.write_text(json.dumps(data, indent=2, sort_keys=True), encoding="utf-8")

            result = self.verify(summary_path, plan_path, verification_path, dashboard_path, drive_notes_path, drive_verification_path, blocker_report_path)

        self.assertEqual(result["status"], "error")
        self.assertIn("sensitive_marker_hits", result["errors"])
        self.assertNotIn("private-value", str(result))


if __name__ == "__main__":
    unittest.main()
