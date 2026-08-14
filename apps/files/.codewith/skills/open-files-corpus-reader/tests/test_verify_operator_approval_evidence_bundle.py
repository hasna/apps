#!/usr/bin/env python3
"""Tests for operator approval evidence bundle verification."""

from __future__ import annotations

import importlib.util
import re
import sys
import tempfile
import unittest
from pathlib import Path


SCRIPT_DIR = Path(__file__).resolve().parents[1] / "scripts"
SCRIPT = SCRIPT_DIR / "verify_operator_approval_evidence_bundle.py"


def load_module():
    if str(SCRIPT_DIR) not in sys.path:
        sys.path.insert(0, str(SCRIPT_DIR))
    spec = importlib.util.spec_from_file_location("verify_operator_approval_evidence_bundle", SCRIPT)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"failed to load {SCRIPT}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


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


def base_results() -> dict[str, dict[str, object]]:
    return {
        "dashboard": {
            "status": "ok",
            "dashboard_status": "ready_for_operator_review",
            "errors": [],
            "warnings": [],
        },
        "approval_request": {
            "status": "ok",
            "packet_status": "templates_ready",
            "errors": [],
            "warnings": [],
        },
        "approval_intake": {
            "status": "ok",
            "intake_status": "missing_required",
            "summary": {
                "unlocked_canary_tasks": 0,
                "approval_request_verification_status": "ok",
                "approval_request_stage_readiness_present": True,
                "approval_request_template_stage_readiness_valid": True,
                "approval_request_current_sources_ok": True,
                "drive_approval_notes_status": "missing_required",
                "drive_approval_ready": False,
            },
            "errors": [],
            "warnings": [],
        },
        "post_approval_plan": {
            "status": "ok",
            "plan_status": "blocked_no_unlocked_decisions",
            "summary": {
                "planned_commands": 0,
                "drive_approval_ready": False,
                "operator_approval_blocker_ready": True,
                "operator_approval_blocker_status": "operator_approval_required",
                "operator_approval_blocker_stage_readiness": stage_readiness(),
            },
            "errors": [],
            "warnings": [],
        },
        "post_approval_run": {
            "status": "ok",
            "run_status": "dry_run_blocked",
            "summary": {
                "execution_allowed": False,
                "commands_executed": 0,
                "drive_approval_ready": False,
                "operator_approval_blocker_ready": True,
                "operator_approval_blocker_status": "operator_approval_required",
                "operator_approval_blocker_stage_readiness": stage_readiness(),
            },
            "errors": [],
            "warnings": [],
        },
        "extraction_readiness": {
            "status": "ok",
            "gate_status": "pending_completion",
            "summary": {
                "hard_blocker_lanes": 0,
                "pending_lanes": 8,
                "large_file_runner_required_files": 867,
                "deferred_media_files": 1010,
            },
            "errors": [],
            "warnings": [],
        },
        "drive_queue": {
            "status": "ok",
            "queue_status": "operator_drive_approval_required",
            "summary": {
                "ready_drive_approval_tasks": 14,
                "tasks_requiring_approval": 14,
            },
            "errors": [],
            "warnings": [],
        },
        "drive_approval_notes": {
            "status": "ok",
            "packet_status": "templates_ready",
            "notes_status": "missing_required",
            "template_count": 14,
            "errors": [],
            "warnings": [],
        },
        "stage": {
            "status": "ok",
            "gate_status": "blocked",
            "summary": {
                "search_index_canary_stage_status": "blocked",
                "search_index_full_stage_status": "blocked",
                "search_index_runtime_attestation_status": "not_executed",
                "search_index_scale_readiness_status": "pending_canary",
                "search_index_search_probe_status": "not_executed",
                "search_index_search_probe_probes": 0,
                "search_index_search_probe_latency_budget_ms": None,
                "search_index_search_probe_max_latency_ms": None,
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
            },
            "errors": [],
            "warnings": [],
        },
        "adversarial_packet": {
            "status": "ok",
            "errors": [],
            "warnings": [],
        },
        "adversarial_results": {
            "status": "reviewed_with_blockers",
            "totals": {"reviewers_present": 2, "blockers": 10},
            "errors": [],
            "warnings": [],
        },
        "replacement": {
            "status": "ok",
            "gate_status": "blocked",
            "approved_to_replace_google_drive": False,
            "errors": [],
            "warnings": [
                "cyclic_source_artifact_stale:adversarial_review_results",
                "cyclic_source_artifact_stale:operator_approval_blocker_report",
            ],
        },
        "blocker": {
            "status": "ok",
            "report_status": "operator_approval_required",
            "summary": {
                "ready_total": 20,
                "ready_approval_tasks": 19,
                "ready_drive_approval_tasks": 14,
                "ready_media_tasks": 1,
                "ready_nonapproval_nonmedia_tasks": 0,
                "ready_dashboard_decisions": 5,
            },
            "errors": [],
            "warnings": [],
        },
    }


def clean_redaction() -> dict[str, object]:
    return {
        "passed": True,
        "sensitive_marker_counts": {},
        "scanned_files": 19,
        "missing_files": [],
        "files_with_hits": [],
        "pattern_count": 12,
    }


class OperatorApprovalEvidenceBundleTest(unittest.TestCase):
    def setUp(self) -> None:
        self.module = load_module()

    def test_operator_approval_bundle_passes_with_allowed_cyclic_warnings(self) -> None:
        result = self.module.summarize_results(
            base_results(),
            redaction_check=clean_redaction(),
            artifacts=[],
            require_operator_approval_required=True,
        )

        self.assertEqual(result["status"], "ok")
        self.assertEqual(result["bundle_status"], "operator_approval_required")
        self.assertTrue(result["checks"]["approval_intake_verifier_ok"])
        self.assertTrue(result["checks"]["approval_intake_request_verification_ok"])
        self.assertTrue(result["checks"]["approval_intake_request_stage_readiness_present"])
        self.assertTrue(result["checks"]["approval_intake_request_template_stage_readiness_valid"])
        self.assertTrue(result["checks"]["approval_intake_request_current_sources_ok"])
        self.assertTrue(result["checks"]["post_approval_plan_verifier_ok"])
        self.assertTrue(result["checks"]["post_approval_run_verifier_ok"])
        self.assertTrue(result["checks"]["post_approval_plan_blocker_ready"])
        self.assertTrue(result["checks"]["post_approval_run_blocker_ready"])
        self.assertTrue(result["checks"]["search_index_search_probe_status_reported"])
        self.assertTrue(result["checks"]["search_index_runtime_attestation_status_reported"])
        self.assertTrue(result["checks"]["semantic_rename_gate_status_reported"])
        self.assertTrue(result["checks"]["semantic_rename_runtime_attestation_status_reported"])
        self.assertTrue(result["checks"]["semantic_rename_scale_readiness_status_reported"])
        self.assertTrue(result["checks"]["metadata_apply_ready_reported"])
        self.assertTrue(result["checks"]["post_approval_plan_stage_readiness_reported"])
        self.assertTrue(result["checks"]["post_approval_run_stage_readiness_reported"])
        self.assertTrue(result["checks"]["extraction_readiness_verifier_ok"])
        self.assertTrue(result["checks"]["replacement_warnings_allowed"])
        self.assertEqual(result["summary"]["post_approval_run_status"], "dry_run_blocked")
        self.assertEqual(result["summary"]["approval_intake_request_verification_status"], "ok")
        self.assertTrue(result["summary"]["approval_intake_request_stage_readiness_present"])
        self.assertTrue(result["summary"]["approval_intake_request_template_stage_readiness_valid"])
        self.assertTrue(result["summary"]["approval_intake_request_current_sources_ok"])
        self.assertTrue(result["summary"]["post_approval_plan_blocker_ready"])
        self.assertTrue(result["summary"]["post_approval_run_blocker_ready"])
        self.assertEqual(result["summary"]["search_index_search_probe_status"], "not_executed")
        self.assertEqual(result["summary"]["search_index_runtime_attestation_status"], "not_executed")
        self.assertEqual(result["summary"]["llm_rename_gate_status"], "pending")
        self.assertEqual(result["summary"]["llm_rename_runtime_attestation_gate_status"], "pending")
        self.assertEqual(result["summary"]["llm_rename_scale_readiness_status"], "pending_canary")
        self.assertFalse(result["summary"]["metadata_apply_ready"])
        self.assertEqual(result["summary"]["post_approval_plan_stage_readiness"]["llm_rename_gate_status"], "pending")
        self.assertEqual(result["summary"]["post_approval_run_stage_readiness"]["search_index_search_probe_status"], "not_executed")
        self.assertEqual(result["summary"]["extraction_readiness_status"], "pending_completion")
        self.assertEqual(result["summary"]["ready_nonapproval_nonmedia_tasks"], 0)

    def test_operator_approval_requirement_catches_post_approval_blocker_not_ready(self) -> None:
        results = base_results()
        results["post_approval_plan"]["summary"]["operator_approval_blocker_ready"] = False
        results["post_approval_plan"]["summary"]["operator_approval_blocker_status"] = "needs_prep"

        result = self.module.summarize_results(
            results,
            redaction_check=clean_redaction(),
            artifacts=[],
            require_operator_approval_required=True,
        )

        self.assertEqual(result["status"], "error")
        self.assertIn("post_approval_plan_blocker_not_ready:needs_prep", result["errors"])

    def test_operator_approval_requirement_requires_search_probe_status_evidence(self) -> None:
        results = base_results()
        del results["stage"]["summary"]["search_index_search_probe_status"]

        result = self.module.summarize_results(
            results,
            redaction_check=clean_redaction(),
            artifacts=[],
            require_operator_approval_required=True,
        )

        self.assertEqual(result["status"], "error")
        self.assertIn("search_index_search_probe_status_missing", result["errors"])

    def test_operator_approval_requirement_requires_semantic_rename_status_evidence(self) -> None:
        results = base_results()
        del results["stage"]["summary"]["llm_rename_gate_status"]

        result = self.module.summarize_results(
            results,
            redaction_check=clean_redaction(),
            artifacts=[],
            require_operator_approval_required=True,
        )

        self.assertEqual(result["status"], "error")
        self.assertIn("semantic_rename_gate_status_missing", result["errors"])

    def test_operator_approval_requirement_requires_post_approval_stage_readiness_match(self) -> None:
        results = base_results()
        results["post_approval_run"]["summary"]["operator_approval_blocker_stage_readiness"]["metadata_apply_ready"] = True

        result = self.module.summarize_results(
            results,
            redaction_check=clean_redaction(),
            artifacts=[],
            require_operator_approval_required=True,
        )

        self.assertEqual(result["status"], "error")
        self.assertIn("post_approval_run_stage_readiness_mismatch", result["errors"])

    def test_unexpected_replacement_warning_fails_closed(self) -> None:
        results = base_results()
        results["replacement"]["warnings"] = ["source_artifact_current_sha256_mismatch:stage_dependency_gate"]

        result = self.module.summarize_results(
            results,
            redaction_check=clean_redaction(),
            artifacts=[],
        )

        self.assertEqual(result["status"], "error")
        self.assertIn(
            "unexpected_replacement_warning:source_artifact_current_sha256_mismatch:stage_dependency_gate",
            result["errors"],
        )

    def test_operator_approval_requirement_catches_nonapproval_work(self) -> None:
        results = base_results()
        results["blocker"]["summary"]["ready_nonapproval_nonmedia_tasks"] = 1

        result = self.module.summarize_results(
            results,
            redaction_check=clean_redaction(),
            artifacts=[],
            require_operator_approval_required=True,
        )

        self.assertEqual(result["status"], "error")
        self.assertIn("nonapproval_nonmedia_ready_tasks_present:1", result["errors"])

    def test_redaction_scan_reports_hits_without_echoing_private_value(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            artifact = Path(tmp) / "artifact.json"
            artifact.write_text('{"source_ref":"open-files://hidden"}', encoding="utf-8")
            result = self.module.scan_artifacts(
                {"artifact": artifact},
                [("json_source_ref", re.compile(r'"source_ref"\s*:'))],
            )

        self.assertFalse(result["passed"])
        self.assertEqual(result["files_with_hits"], ["artifact"])
        self.assertEqual(result["sensitive_marker_counts"], {"json_source_ref": 1})
        self.assertNotIn("hidden", str(result))


if __name__ == "__main__":
    unittest.main()
