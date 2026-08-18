#!/usr/bin/env python3
"""Tests for operator approval intake readiness verification."""

from __future__ import annotations

import importlib.util
import hashlib
import sys
import unittest
from pathlib import Path


SCRIPT_DIR = Path(__file__).resolve().parents[1] / "scripts"
SCRIPT = SCRIPT_DIR / "verify_operator_approval_intake.py"


def load_module():
    if str(SCRIPT_DIR) not in sys.path:
        sys.path.insert(0, str(SCRIPT_DIR))
    spec = importlib.util.spec_from_file_location("verify_operator_approval_intake", SCRIPT)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"failed to load {SCRIPT}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def source_artifacts() -> list[dict[str, object]]:
    return [
        {"label": "approval_notes_summary", "present": True, "bytes": 10, "sha256": "a" * 64},
        {"label": "approval_request_packet", "present": True, "bytes": 10, "sha256": "b" * 64},
        {"label": "approval_request_verification", "present": True, "bytes": 10, "sha256": "c" * 64},
        {"label": "drive_approval_notes_summary", "present": True, "bytes": 10, "sha256": "c" * 64},
        {"label": "drive_approval_notes_verification", "present": True, "bytes": 10, "sha256": "d" * 64},
        {"label": "extraction_approval_dashboard", "present": True, "bytes": 10, "sha256": "e" * 64},
        {"label": "operator_approval_blocker_report", "present": True, "bytes": 10, "sha256": "f" * 64},
    ]


def required_item(decision_id: str, **overrides: object) -> dict[str, object]:
    item: dict[str, object] = {
        "decision_id": decision_id,
        "present": False,
        "valid": False,
        "status": None,
        "scope": None,
        "approval_request_checked": True,
        "command_hashes_match": None,
        "artifact_sha256": None,
        "errors": ["missing_approval_note_artifact"],
    }
    item.update(overrides)
    return item


def notes_summary(**overrides: object) -> dict[str, object]:
    required = [required_item(decision_id) for decision_id in (
        "ocr_vision_canary",
        "large_file_canary",
        "archive_worker_image",
        "search_index_population",
        "llm_review_campaign",
    )]
    summary: dict[str, object] = {
        "kind": "open_files_operator_approval_notes_summary",
        "version": 1,
        "status": "missing_required",
        "required_decisions": required,
        "redaction_check": {"passed": True, "sensitive_marker_counts": {}},
    }
    summary.update(overrides)
    return summary


def approval_request_packet() -> dict[str, object]:
    decision_ids = [
        "ocr_vision_canary",
        "large_file_canary",
        "archive_worker_image",
        "search_index_population",
        "llm_review_campaign",
    ]
    templates = []
    for decision_id, scope, tags in (
        ("ocr_vision_canary", "provider-use", ["enable_ocr_or_vision_lane"]),
        ("large_file_canary", "canary", ["approve_large_file_runner_canary"]),
        ("archive_worker_image", "worker-build", ["enable_archive_inventory_tools"]),
        ("search_index_population", "canary", []),
        ("llm_review_campaign", "canary", []),
    ):
        templates.append({
            "decision_id": decision_id,
            "scope": scope,
            "remediation_action_ids": tags,
            "remediation_status": "operator_remediation_required",
            "command_hashes": [{"name": "cmd", "sha256": hashlib.sha256(decision_id.encode()).hexdigest()}],
        })
    return {
        "kind": "open_files_operator_approval_note_template_packet",
        "version": 1,
        "status": "templates_ready",
        "template_count": len(decision_ids),
        "templates": templates,
        "source_status": {
            "dashboard_status": "ready_for_operator_review",
            "approval_notes_status": "missing_required",
            "approved_required_decision_count": 0,
            "stage_verification_status": "ok",
            "stage_gate_status": "blocked",
            "remediation_status": "operator_remediation_required",
            "remediation_action_count": 6,
        },
        "stage_readiness": stage_readiness(),
        "redaction_check": {"passed": True, "sensitive_marker_counts": {}},
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


def approval_request_verification(**overrides: object) -> dict[str, object]:
    decision_ids = [
        "ocr_vision_canary",
        "large_file_canary",
        "archive_worker_image",
        "search_index_population",
        "llm_review_campaign",
    ]
    verification: dict[str, object] = {
        "kind": "open_files_operator_approval_request_packet_verification",
        "version": 1,
        "status": "ok",
        "packet_status": "templates_ready",
        "template_count": len(decision_ids),
        "decision_ids": decision_ids,
        "gates": {
            "redaction_ok": True,
            "source_artifact_current_hashes_ok": True,
            "stage_readiness_present": True,
            "template_stage_readiness_valid": True,
        },
        "source_artifacts": {
            "current_checked": True,
            "current_mismatched": [],
        },
        "source_status": {
            "dashboard_status": "ready_for_operator_review",
            "approval_notes_status": "missing_required",
            "approved_required_decision_count": 0,
            "stage_verification_status": "ok",
            "stage_gate_status": "blocked",
            "remediation_status": "operator_remediation_required",
            "remediation_action_count": 6,
        },
        "stage_readiness": stage_readiness(),
        "sensitive_marker_counts": {},
        "errors": [],
    }
    verification.update(overrides)
    return verification


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


def dashboard() -> dict[str, object]:
    return {
        "kind": "open_files_extraction_approval_dashboard",
        "version": 1,
        "status": "ready_for_operator_review",
        "approval_items": [
            {"id": decision_id, "ready_for_approval": True, "status": "ready_for_operator_review", "priority": "critical"}
            for decision_id in (
                "ocr_vision_canary",
                "large_file_canary",
                "archive_worker_image",
                "search_index_population",
                "llm_review_campaign",
            )
        ],
        "redaction_check": {"passed": True, "sensitive_marker_counts": {}},
    }


def blocker_report() -> dict[str, object]:
    return {
        "kind": "open_files_operator_approval_blocker_report",
        "version": 1,
        "status": "operator_approval_required",
        "queue": {
            "approval_tasks": [
                {"id": "ocr12345", "title": "Run OCR canary", "priority": "critical", "requires_approval": True, "tags": ["ocr", "vision"]},
                {"id": "large123", "title": "Run large-file canary", "priority": "critical", "requires_approval": True, "tags": ["large-files"]},
                {"id": "arch1234", "title": "Build archive worker", "priority": "high", "requires_approval": True, "tags": ["archives", "worker-image"]},
                {"id": "search12", "title": "Run search canary", "priority": "high", "requires_approval": True, "tags": ["search-index"]},
                {"id": "llm12345", "title": "Run LLM canary", "priority": "high", "requires_approval": True, "tags": ["llm-review", "semantic-rename"]},
            ]
        },
        "redaction_check": {"passed": True, "sensitive_marker_counts": {}},
    }


class OperatorApprovalIntakeTest(unittest.TestCase):
    def setUp(self) -> None:
        self.module = load_module()

    def build(
        self,
        notes: dict[str, object],
        *,
        drive_ready: bool = True,
        request_verification: dict[str, object] | None = None,
    ) -> dict[str, object]:
        return self.module.build_intake(
            approval_notes_summary=notes,
            approval_request_packet=approval_request_packet(),
            approval_request_verification=request_verification or approval_request_verification(),
            drive_approval_notes_summary=drive_approval_notes_summary(ready=drive_ready),
            drive_approval_notes_verification=drive_approval_notes_verification(ready=drive_ready),
            dashboard=dashboard(),
            blocker_report=blocker_report(),
            source_artifacts=source_artifacts(),
        )

    def test_missing_approval_notes_are_non_error_blockers(self) -> None:
        result = self.build(notes_summary())

        self.assertEqual(result["status"], "missing_required")
        self.assertEqual(result["summary"]["missing_required_decisions"], 5)
        self.assertEqual(result["unlocked_decisions"], [])
        self.assertEqual(result["errors"], [])
        self.assertTrue(result["redaction_check"]["passed"])

    def test_approved_note_unlocks_matching_canary_task(self) -> None:
        required = notes_summary()["required_decisions"]
        required[0] = required_item(
            "ocr_vision_canary",
            present=True,
            valid=True,
            status="approved",
            scope="provider-use",
            command_hashes_match=True,
            artifact_sha256="e" * 64,
            errors=[],
        )
        result = self.build(notes_summary(required_decisions=required))

        self.assertEqual(result["status"], "canary_tasks_unlocked")
        self.assertEqual(result["unlocked_decisions"], ["ocr_vision_canary"])
        self.assertTrue(result["summary"]["drive_approval_ready"])
        decision = result["decisions"][0]
        self.assertEqual(decision["ready_task"]["matched_count"], 1)
        self.assertNotIn("Run OCR canary", str(decision))
        self.assertIn("title_sha256", decision["ready_task"]["first"])

    def test_approved_operator_notes_still_block_without_drive_approvals(self) -> None:
        required = [
            required_item(
                decision_id,
                present=True,
                valid=True,
                status="approved",
                scope="canary",
                command_hashes_match=True,
                artifact_sha256="e" * 64,
                errors=[],
            )
            for decision_id in (
                "ocr_vision_canary",
                "large_file_canary",
                "archive_worker_image",
                "search_index_population",
                "llm_review_campaign",
            )
        ]
        result = self.build(notes_summary(status="approved", required_decisions=required), drive_ready=False)

        self.assertEqual(result["status"], "drive_approval_required")
        self.assertEqual(result["unlocked_decisions"], [])
        self.assertEqual(result["summary"]["drive_blocked_decisions"], 5)
        self.assertFalse(result["summary"]["drive_approval_ready"])
        self.assertEqual(result["blocked_decisions"]["drive_approval_notes"], [
            "ocr_vision_canary",
            "large_file_canary",
            "archive_worker_image",
            "search_index_population",
            "llm_review_campaign",
        ])

    def test_invalid_approval_note_fails_closed(self) -> None:
        required = notes_summary()["required_decisions"]
        required[0] = required_item(
            "ocr_vision_canary",
            present=True,
            valid=False,
            status="approved",
            scope="provider-use",
            errors=["command_hashes_mismatch"],
        )
        result = self.build(notes_summary(status="invalid", required_decisions=required))

        self.assertEqual(result["status"], "error")
        self.assertIn("invalid_required_approval_note:ocr_vision_canary", result["errors"])

    def test_private_like_task_title_is_hashed_not_echoed(self) -> None:
        report = blocker_report()
        report["queue"]["approval_tasks"][0]["title"] = "open-files://private-value"
        result = self.module.build_intake(
            approval_notes_summary=notes_summary(),
            approval_request_packet=approval_request_packet(),
            approval_request_verification=approval_request_verification(),
            drive_approval_notes_summary=drive_approval_notes_summary(),
            drive_approval_notes_verification=drive_approval_notes_verification(),
            dashboard=dashboard(),
            blocker_report=report,
            source_artifacts=source_artifacts(),
        )

        self.assertNotIn("private-value", str(result))
        self.assertTrue(result["redaction_check"]["passed"])

    def test_approval_request_verification_failure_fails_closed(self) -> None:
        result = self.build(
            notes_summary(),
            request_verification=approval_request_verification(
                status="error",
                gates={
                    "redaction_ok": True,
                    "source_artifact_current_hashes_ok": False,
                    "stage_readiness_present": False,
                    "template_stage_readiness_valid": True,
                },
            ),
        )

        self.assertEqual(result["status"], "error")
        self.assertIn("approval_request_verification_not_ok", result["errors"])
        self.assertIn("approval_request_verification_stage_readiness_missing", result["errors"])
        self.assertIn("approval_request_verification_current_sources_not_ok", result["errors"])

    def test_input_artifact_versions_are_required(self) -> None:
        notes = notes_summary()
        request_packet = approval_request_packet()
        request_verification = approval_request_verification()
        drive_summary = drive_approval_notes_summary()
        drive_verification = drive_approval_notes_verification()
        intake_dashboard = dashboard()
        blocker = blocker_report()
        notes.pop("version")
        request_packet["version"] = 2
        request_verification.pop("version")
        drive_summary["version"] = 2
        drive_verification.pop("version")
        intake_dashboard["version"] = 2
        blocker.pop("version")

        result = self.module.build_intake(
            approval_notes_summary=notes,
            approval_request_packet=request_packet,
            approval_request_verification=request_verification,
            drive_approval_notes_summary=drive_summary,
            drive_approval_notes_verification=drive_verification,
            dashboard=intake_dashboard,
            blocker_report=blocker,
            source_artifacts=source_artifacts(),
        )

        self.assertEqual(result["status"], "error")
        self.assertIn("invalid_notes_summary_version", result["errors"])
        self.assertIn("invalid_approval_request_packet_version", result["errors"])
        self.assertIn("invalid_approval_request_verification_version", result["errors"])
        self.assertIn("invalid_drive_approval_notes_summary_version", result["errors"])
        self.assertIn("invalid_drive_approval_notes_verification_version", result["errors"])
        self.assertIn("invalid_dashboard_version", result["errors"])
        self.assertIn("invalid_blocker_report_version", result["errors"])


if __name__ == "__main__":
    unittest.main()
