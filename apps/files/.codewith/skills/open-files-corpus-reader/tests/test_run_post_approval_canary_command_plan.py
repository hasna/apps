#!/usr/bin/env python3
"""Tests for post-approval canary command plan runner."""

from __future__ import annotations

import importlib.util
import hashlib
import sys
import tempfile
import unittest
from pathlib import Path


SCRIPT_DIR = Path(__file__).resolve().parents[1] / "scripts"
SCRIPT = SCRIPT_DIR / "run_post_approval_canary_command_plan.py"


def load_module():
    if str(SCRIPT_DIR) not in sys.path:
        sys.path.insert(0, str(SCRIPT_DIR))
    spec = importlib.util.spec_from_file_location("run_post_approval_canary_command_plan", SCRIPT)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"failed to load {SCRIPT}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def sha(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def dashboard(command: str) -> dict[str, object]:
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


def plan(command: str, *, status: str = "ready_for_operator_execution") -> dict[str, object]:
    return {
        "kind": "open_files_post_approval_canary_command_plan",
        "version": 1,
        "status": status,
        "source_artifacts": [
            {"label": "operator_approval_blocker_report", "present": True, "bytes": 1, "sha256": "f" * 64},
        ],
        "operator_approval_blocker_snapshot": {
            "status": "operator_approval_required",
            "safe_next_step_type": "operator_approval",
            "ready": True,
            "stage_readiness": stage_readiness(),
        },
        "command_queue": [] if status == "blocked_no_unlocked_decisions" else [
            {
                "decision_id": "large_file_canary",
                "section": "large_file_canary",
                "name": "execute_canary_after_approval",
                "order": 30,
                "command_ref": "dashboard.sections.large_file_canary.commands.execute_canary_after_approval",
                "command_sha256": sha(command),
                "command_bytes": len(command.encode("utf-8")),
                "mutation_class": "canary_private_artifact_execution",
                "requires_valid_approval_note": True,
                "requires_valid_drive_approval_notes": True,
                "raw_command_omitted": True,
            }
        ],
    }


def verification(status: str = "ready_for_operator_execution") -> dict[str, object]:
    return {
        "kind": "open_files_post_approval_canary_command_plan_verification",
        "version": 1,
        "status": "ok",
        "plan_status": status,
    }


def sources() -> list[dict[str, object]]:
    return [
        {"label": "post_approval_canary_command_plan", "present": True, "bytes": 1, "sha256": "a" * 64},
        {"label": "post_approval_canary_command_plan_verification", "present": True, "bytes": 1, "sha256": "b" * 64},
        {"label": "extraction_approval_dashboard", "present": True, "bytes": 1, "sha256": "c" * 64},
        {"label": "drive_approval_notes_summary", "present": True, "bytes": 1, "sha256": "d" * 64},
        {"label": "drive_approval_notes_verification", "present": True, "bytes": 1, "sha256": "e" * 64},
        {"label": "operator_approval_blocker_report", "present": True, "bytes": 1, "sha256": "f" * 64},
    ]


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


class PostApprovalCanaryCommandRunnerTest(unittest.TestCase):
    def setUp(self) -> None:
        self.module = load_module()

    def test_blocked_dry_run_refuses_without_error(self) -> None:
        command = "python3 -c 'print(1)'"
        result = self.module.build_run_summary(
            plan=plan(command, status="blocked_no_unlocked_decisions"),
            verification=verification(status="blocked_no_unlocked_decisions"),
            dashboard=dashboard(command),
            drive_approval_notes_summary=drive_approval_notes_summary(),
            drive_approval_notes_verification=drive_approval_notes_verification(),
            operator_approval_blocker_report=operator_approval_blocker_report(),
            source_artifacts=sources(),
            execute=False,
            cwd=Path.cwd(),
            log_dir=Path.cwd(),
            timeout_seconds=5,
        )

        self.assertEqual(result["status"], "dry_run_blocked")
        self.assertFalse(result["summary"]["execution_allowed"])
        self.assertIn("plan_not_ready:blocked_no_unlocked_decisions", result["summary"]["blocked_reasons"])
        self.assertTrue(result["summary"]["operator_approval_blocker_ready"])
        self.assertEqual(result["summary"]["operator_approval_blocker_stage_readiness"]["llm_rename_gate_status"], "pending")
        self.assertEqual(result["summary"]["commands_executed"], 0)

    def test_ready_dry_run_resolves_command_without_execution(self) -> None:
        command = "python3 -c 'print(1)'"
        result = self.module.build_run_summary(
            plan=plan(command),
            verification=verification(),
            dashboard=dashboard(command),
            drive_approval_notes_summary=drive_approval_notes_summary(),
            drive_approval_notes_verification=drive_approval_notes_verification(),
            operator_approval_blocker_report=operator_approval_blocker_report(),
            source_artifacts=sources(),
            execute=False,
            cwd=Path.cwd(),
            log_dir=Path.cwd(),
            timeout_seconds=5,
        )

        self.assertEqual(result["status"], "dry_run_ready")
        self.assertTrue(result["summary"]["execution_allowed"])
        self.assertFalse(result["summary"]["operator_approval_blocker_stage_readiness"]["metadata_apply_ready"])
        self.assertEqual(result["summary"]["resolved_commands"], 1)
        self.assertEqual(result["summary"]["commands_executed"], 0)
        self.assertNotIn("print(1)", str(result))

    def test_input_artifact_versions_are_required(self) -> None:
        command = "python3 -c 'print(1)'"
        command_plan = plan(command)
        command_plan_verification = verification()
        approval_dashboard = dashboard(command)
        drive_summary = drive_approval_notes_summary()
        drive_verification = drive_approval_notes_verification()
        blocker = operator_approval_blocker_report()
        command_plan.pop("version")
        command_plan_verification["version"] = 2
        approval_dashboard.pop("version")
        drive_summary["version"] = 2
        drive_verification.pop("version")
        blocker["version"] = 2

        result = self.module.build_run_summary(
            plan=command_plan,
            verification=command_plan_verification,
            dashboard=approval_dashboard,
            drive_approval_notes_summary=drive_summary,
            drive_approval_notes_verification=drive_verification,
            operator_approval_blocker_report=blocker,
            source_artifacts=sources(),
            execute=True,
            cwd=Path.cwd(),
            log_dir=Path.cwd(),
            timeout_seconds=5,
        )

        self.assertEqual(result["status"], "dry_run_blocked")
        self.assertFalse(result["summary"]["execution_allowed"])
        self.assertIn("invalid_plan_version", result["summary"]["blocked_reasons"])
        self.assertIn("invalid_plan_verification_version", result["summary"]["blocked_reasons"])
        self.assertIn("invalid_dashboard_version", result["summary"]["blocked_reasons"])
        self.assertIn("invalid_drive_approval_notes_summary_version", result["summary"]["blocked_reasons"])
        self.assertIn("invalid_drive_approval_notes_verification_version", result["summary"]["blocked_reasons"])
        self.assertIn("invalid_operator_approval_blocker_report_version", result["summary"]["blocked_reasons"])
        self.assertEqual(result["summary"]["commands_executed"], 0)

    def test_ready_plan_refuses_when_blocker_report_is_not_current_for_plan(self) -> None:
        command = "python3 -c 'print(1)'"
        stale_sources = sources()
        stale_sources[-1] = {"label": "operator_approval_blocker_report", "present": True, "bytes": 2, "sha256": "0" * 64}
        result = self.module.build_run_summary(
            plan=plan(command),
            verification=verification(),
            dashboard=dashboard(command),
            drive_approval_notes_summary=drive_approval_notes_summary(),
            drive_approval_notes_verification=drive_approval_notes_verification(),
            operator_approval_blocker_report=operator_approval_blocker_report(),
            source_artifacts=stale_sources,
            execute=True,
            cwd=Path.cwd(),
            log_dir=Path.cwd(),
            timeout_seconds=5,
        )

        self.assertEqual(result["status"], "dry_run_blocked")
        self.assertFalse(result["summary"]["execution_allowed"])
        self.assertIn("operator_approval_blocker_report_not_current_for_plan", result["summary"]["blocked_reasons"])
        self.assertEqual(result["summary"]["commands_executed"], 0)

    def test_execute_runs_harmless_command_to_private_log(self) -> None:
        command = "python3 -c 'print(123)'"
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            result = self.module.build_run_summary(
                plan=plan(command),
                verification=verification(),
                dashboard=dashboard(command),
                drive_approval_notes_summary=drive_approval_notes_summary(),
                drive_approval_notes_verification=drive_approval_notes_verification(),
                operator_approval_blocker_report=operator_approval_blocker_report(),
                source_artifacts=sources(),
                execute=True,
                cwd=root,
                log_dir=root / "logs",
                timeout_seconds=5,
            )

        self.assertEqual(result["status"], "executed")
        self.assertEqual(result["summary"]["commands_executed"], 1)
        self.assertEqual(result["commands"][0]["result"]["exit_code"], 0)
        self.assertNotIn("123", str(result))

    def test_hash_mismatch_blocks_execution(self) -> None:
        planned = "python3 -c 'print(1)'"
        actual = "python3 -c 'print(2)'"
        result = self.module.build_run_summary(
            plan=plan(planned),
            verification=verification(),
            dashboard=dashboard(actual),
            drive_approval_notes_summary=drive_approval_notes_summary(),
            drive_approval_notes_verification=drive_approval_notes_verification(),
            operator_approval_blocker_report=operator_approval_blocker_report(),
            source_artifacts=sources(),
            execute=True,
            cwd=Path.cwd(),
            log_dir=Path.cwd(),
            timeout_seconds=5,
        )

        self.assertEqual(result["status"], "error")
        self.assertIn("command_sha256_mismatch:0", result["errors"])
        self.assertEqual(result["summary"]["commands_executed"], 0)

    def test_private_raw_command_is_not_emitted(self) -> None:
        command = "python3 tool.py --execute s3://private-bucket/objects/sha256/abc"
        result = self.module.build_run_summary(
            plan=plan(command),
            verification=verification(),
            dashboard=dashboard(command),
            drive_approval_notes_summary=drive_approval_notes_summary(),
            drive_approval_notes_verification=drive_approval_notes_verification(),
            operator_approval_blocker_report=operator_approval_blocker_report(),
            source_artifacts=sources(),
            execute=False,
            cwd=Path.cwd(),
            log_dir=Path.cwd(),
            timeout_seconds=5,
        )

        self.assertNotIn("private-bucket", str(result))
        self.assertNotIn("objects/sha256", str(result))
        self.assertTrue(result["redaction_check"]["passed"])


if __name__ == "__main__":
    unittest.main()
