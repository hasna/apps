#!/usr/bin/env python3
"""Tests for post-approval canary command planning."""

from __future__ import annotations

import importlib.util
import sys
import unittest
from pathlib import Path


SCRIPT_DIR = Path(__file__).resolve().parents[1] / "scripts"
SCRIPT = SCRIPT_DIR / "build_post_approval_canary_command_plan.py"


def load_module():
    if str(SCRIPT_DIR) not in sys.path:
        sys.path.insert(0, str(SCRIPT_DIR))
    spec = importlib.util.spec_from_file_location("build_post_approval_canary_command_plan", SCRIPT)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"failed to load {SCRIPT}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def source_artifacts() -> list[dict[str, object]]:
    return [
        {"label": "operator_approval_intake", "present": True, "bytes": 10, "sha256": "a" * 64},
        {"label": "extraction_approval_dashboard", "present": True, "bytes": 10, "sha256": "b" * 64},
        {"label": "drive_approval_notes_summary", "present": True, "bytes": 10, "sha256": "c" * 64},
        {"label": "drive_approval_notes_verification", "present": True, "bytes": 10, "sha256": "d" * 64},
        {"label": "operator_approval_blocker_report", "present": True, "bytes": 10, "sha256": "e" * 64},
    ]


def decision(decision_id: str, unlock_state: str) -> dict[str, object]:
    return {"decision_id": decision_id, "unlock_state": unlock_state}


def intake(*, unlocked: list[str] | None = None) -> dict[str, object]:
    unlocked = unlocked or []
    return {
        "kind": "open_files_operator_approval_intake_readiness",
        "version": 1,
        "status": "canary_tasks_unlocked" if unlocked else "missing_required",
        "unlocked_decisions": unlocked,
        "decisions": [
            decision("ocr_vision_canary", "approval_note_ready_for_canary_task" if "ocr_vision_canary" in unlocked else "blocked_missing_approval_note"),
            decision("large_file_canary", "approval_note_ready_for_canary_task" if "large_file_canary" in unlocked else "blocked_missing_approval_note"),
            decision("archive_worker_image", "approval_note_ready_for_canary_task" if "archive_worker_image" in unlocked else "blocked_missing_approval_note"),
            decision("search_index_population", "approval_note_ready_for_canary_task" if "search_index_population" in unlocked else "blocked_missing_approval_note"),
            decision("llm_review_campaign", "approval_note_ready_for_canary_task" if "llm_review_campaign" in unlocked else "blocked_missing_approval_note"),
        ],
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
                    "collect_review_manifest_after_verification": "python3 collect_large_file_review_manifest.py --output jobs.jsonl",
                }
            },
            "archive_worker_image": {"commands": {"refresh_static_verification": "python3 verify_extraction_worker_image.py"}},
            "search_index_population": {"commands": {"pre_stats": "bun run src/cli/index.tsx search-index stats --json"}},
            "ocr_vision_canary": {},
            "llm_review_campaign": {},
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


def operator_approval_blocker_report(*, ready: bool = True, include_stage_readiness: bool = True) -> dict[str, object]:
    safe_next_step = {
        "type": "operator_approval" if ready else "needs_prep",
        "final_gate_verifiers_ok": ready,
        "approval_request_verification_ok": ready,
        "ready_dashboard_decisions": 5,
        "approved_dashboard_decisions": 0,
        "ready_drive_approval_tasks": 14,
        "ready_nonapproval_nonmedia_tasks": 0,
        "media_deferred_until_final_pass": True,
    }
    if include_stage_readiness:
        safe_next_step["stage_readiness"] = stage_readiness()
    return {
        "kind": "open_files_operator_approval_blocker_report",
        "version": 1,
        "status": "operator_approval_required" if ready else "needs_prep",
        "safe_next_step": safe_next_step,
        "non_mutation_attestation": {
            "corpus_bytes_mutated": False,
            "s3_objects_mutated": False,
            "metadata_rows_mutated": False,
            "report_is_read_only": True,
        },
        "redaction_check": {"passed": True, "sensitive_marker_counts": {}},
    }


class PostApprovalCanaryCommandPlanTest(unittest.TestCase):
    def setUp(self) -> None:
        self.module = load_module()

    def test_no_unlocked_decisions_blocks_without_error(self) -> None:
        result = self.module.build_plan(
            intake=intake(),
            dashboard=dashboard(),
            drive_approval_notes_summary=drive_approval_notes_summary(),
            drive_approval_notes_verification=drive_approval_notes_verification(),
            operator_approval_blocker_report=operator_approval_blocker_report(),
            source_artifacts=source_artifacts(),
        )

        self.assertEqual(result["status"], "blocked_no_unlocked_decisions")
        self.assertEqual(result["summary"]["planned_commands"], 0)
        self.assertTrue(result["summary"]["operator_approval_blocker_ready"])
        self.assertEqual(result["summary"]["operator_approval_blocker_stage_readiness"]["llm_rename_gate_status"], "pending")
        self.assertEqual(result["operator_approval_blocker_snapshot"]["safe_next_step_type"], "operator_approval")
        self.assertEqual(result["operator_approval_blocker_snapshot"]["stage_readiness"]["metadata_apply_ready"], False)
        self.assertEqual(result["errors"], [])
        self.assertTrue(result["redaction_check"]["passed"])

    def test_missing_stage_readiness_fails_closed(self) -> None:
        result = self.module.build_plan(
            intake=intake(),
            dashboard=dashboard(),
            drive_approval_notes_summary=drive_approval_notes_summary(),
            drive_approval_notes_verification=drive_approval_notes_verification(),
            operator_approval_blocker_report=operator_approval_blocker_report(include_stage_readiness=False),
            source_artifacts=source_artifacts(),
        )

        self.assertEqual(result["status"], "error")
        self.assertIn(
            "operator_approval_blocker_stage_readiness_missing:search_index_search_probe_status",
            result["errors"],
        )

    def test_input_artifact_versions_are_required(self) -> None:
        intake_artifact = intake()
        approval_dashboard = dashboard()
        drive_summary = drive_approval_notes_summary()
        drive_verification = drive_approval_notes_verification()
        blocker = operator_approval_blocker_report()
        intake_artifact.pop("version")
        approval_dashboard["version"] = 2
        drive_summary.pop("version")
        drive_verification["version"] = 2
        blocker.pop("version")

        result = self.module.build_plan(
            intake=intake_artifact,
            dashboard=approval_dashboard,
            drive_approval_notes_summary=drive_summary,
            drive_approval_notes_verification=drive_verification,
            operator_approval_blocker_report=blocker,
            source_artifacts=source_artifacts(),
        )

        self.assertEqual(result["status"], "error")
        self.assertIn("invalid_intake_version", result["errors"])
        self.assertIn("invalid_dashboard_version", result["errors"])
        self.assertIn("invalid_drive_approval_notes_summary_version", result["errors"])
        self.assertIn("invalid_drive_approval_notes_verification_version", result["errors"])
        self.assertIn("invalid_operator_approval_blocker_report_version", result["errors"])

    def test_unlocked_large_file_decision_gets_hashed_command_queue(self) -> None:
        result = self.module.build_plan(
            intake=intake(unlocked=["large_file_canary"]),
            dashboard=dashboard(),
            drive_approval_notes_summary=drive_approval_notes_summary(),
            drive_approval_notes_verification=drive_approval_notes_verification(),
            operator_approval_blocker_report=operator_approval_blocker_report(),
            source_artifacts=source_artifacts(),
        )

        self.assertEqual(result["status"], "ready_for_operator_execution")
        self.assertEqual(result["summary"]["planned_commands"], 4)
        self.assertTrue(all(item["raw_command_omitted"] for item in result["command_queue"]))
        self.assertTrue(all(len(item["command_sha256"]) == 64 for item in result["command_queue"]))
        self.assertTrue(all(item["operator_approval_blocker_gate_ready"] for item in result["decisions"]))
        self.assertNotIn("--execute", str(result))

    def test_unlocked_decision_blocks_when_operator_blocker_report_is_not_ready(self) -> None:
        result = self.module.build_plan(
            intake=intake(unlocked=["large_file_canary"]),
            dashboard=dashboard(),
            drive_approval_notes_summary=drive_approval_notes_summary(),
            drive_approval_notes_verification=drive_approval_notes_verification(),
            operator_approval_blocker_report=operator_approval_blocker_report(ready=False),
            source_artifacts=source_artifacts(),
        )

        self.assertEqual(result["status"], "blocked_operator_approval_blocker_report")
        self.assertEqual(result["summary"]["planned_commands"], 0)
        self.assertEqual(result["blocker_blocked_decisions"], ["large_file_canary"])
        self.assertFalse(result["summary"]["operator_approval_blocker_ready"])

    def test_unlocked_decision_without_command_map_is_marked(self) -> None:
        result = self.module.build_plan(
            intake=intake(unlocked=["ocr_vision_canary"]),
            dashboard=dashboard(),
            drive_approval_notes_summary=drive_approval_notes_summary(),
            drive_approval_notes_verification=drive_approval_notes_verification(),
            operator_approval_blocker_report=operator_approval_blocker_report(),
            source_artifacts=source_artifacts(),
        )

        self.assertEqual(result["status"], "needs_command_mapping")
        self.assertEqual(result["missing_command_map_decisions"], ["ocr_vision_canary"])
        self.assertEqual(result["summary"]["planned_commands"], 0)

    def test_private_like_raw_command_text_is_not_emitted(self) -> None:
        result = self.module.build_plan(
            intake=intake(unlocked=["large_file_canary"]),
            dashboard=dashboard(command="python3 tool.py --execute s3://private-bucket/objects/sha256/abc"),
            drive_approval_notes_summary=drive_approval_notes_summary(),
            drive_approval_notes_verification=drive_approval_notes_verification(),
            operator_approval_blocker_report=operator_approval_blocker_report(),
            source_artifacts=source_artifacts(),
        )

        self.assertNotIn("private-bucket", str(result))
        self.assertNotIn("objects/sha256", str(result))
        self.assertTrue(result["redaction_check"]["passed"])


if __name__ == "__main__":
    unittest.main()
