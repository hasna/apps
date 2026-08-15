#!/usr/bin/env python3
"""Offline tests for the redacted operator approval blocker report."""

from __future__ import annotations

import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


SCRIPT_DIR = Path(__file__).resolve().parents[1] / "scripts"
SCRIPT = SCRIPT_DIR / "build_operator_approval_blocker_report.py"


def load_module():
    if str(SCRIPT_DIR) not in sys.path:
        sys.path.insert(0, str(SCRIPT_DIR))
    spec = importlib.util.spec_from_file_location("build_operator_approval_blocker_report", SCRIPT)
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


def write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, sort_keys=True), encoding="utf-8")


def dashboard_fixture() -> dict:
    def missing_note(decision_id: str) -> dict:
        return {
            "summary_present": True,
            "present": False,
            "valid": False,
            "approved": False,
            "status": None,
            "errors": ["missing_approval_note_artifact"],
        }

    return {
        "kind": "open_files_extraction_approval_dashboard",
        "status": "ready_for_operator_review",
        "overall": {
            "ready_for_operator_review": True,
            "ready_approval_items": 5,
            "approval_items": 5,
            "approved_approval_notes": 0,
            "approval_notes_complete": False,
            "pending_approval_note_items": [
                "ocr_vision_canary",
                "large_file_canary",
                "archive_worker_image",
                "search_index_population",
                "llm_review_campaign",
            ],
            "blocked_or_missing_prep_items": [],
            "final_media_pass_deferred": True,
            "corpus_bytes_mutated": False,
            "s3_objects_mutated": False,
            "metadata_rows_mutated": False,
        },
        "approval_items": [
            {
                "id": "ocr_vision_canary",
                "priority": "critical",
                "status": "degraded_provider_required",
                "reason": "vision/OCR lane requires provider approval",
                "ready_for_approval": True,
                "approval_note": missing_note("ocr_vision_canary"),
            },
            {
                "id": "large_file_canary",
                "priority": "critical",
                "status": "approval_required",
                "reason": "large files require approved bounded extraction canary",
                "ready_for_approval": True,
                "approval_note": missing_note("large_file_canary"),
            },
            {
                "id": "archive_worker_image",
                "priority": "high",
                "status": "ready_for_operator_approval",
                "reason": "archive worker build requires Docker/CI access",
                "ready_for_approval": True,
                "approval_note": missing_note("archive_worker_image"),
            },
            {
                "id": "search_index_population",
                "priority": "high",
                "status": "approval_required",
                "reason": "fast search requires approved extraction/index canaries",
                "ready_for_approval": True,
                "approval_note": missing_note("search_index_population"),
            },
            {
                "id": "llm_review_campaign",
                "priority": "high",
                "status": "approval_required",
                "reason": "semantic rename proposals require approved LLM execution",
                "ready_for_approval": True,
                "approval_note": missing_note("llm_review_campaign"),
            },
            {
                "id": "deferred_media_final_pass",
                "priority": "deferred",
                "status": "deferred",
                "reason": "media waits until final pass",
                "ready_for_approval": False,
                "approval_note": missing_note("deferred_media_final_pass"),
            },
        ],
    }


def adversarial_fixture() -> dict:
    return {
        "kind": "open_files_adversarial_review_packet_verification",
        "status": "ok",
        "gates": {
            "required_artifacts_present": True,
            "generated_review_files_redacted": True,
            "dashboard_ready_for_operator_review": True,
        },
        "errors": [],
        "warnings": [],
    }


def stage_verification_fixture(*, ok: bool = True) -> dict:
    return {
        "kind": "open_files_stage_dependency_gate_verification",
        "status": "ok" if ok else "error",
        "gate_status": "blocked",
        "approved_to_scale": False,
        "summary": {
            "stages": 10,
            "blocking_stage_count": 8,
            "hard_blocking_stage_count": 7,
            "deferred_stage_count": 1,
            "first_blocking_stage": "extraction_lane_readiness",
            "current_stage_order": 20,
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
        },
        "gates": {
            "redaction_ok": ok,
            "source_artifacts_present": ok,
            "source_artifact_hashes_ok": ok,
            "stage_order_complete_set": ok,
            "scale_rules_ok": ok,
            "status_consistent": ok,
            "approval_consistent": ok,
        },
        "errors": [] if ok else ["stage_order_or_set_invalid"],
        "warnings": [],
    }


def replacement_verification_fixture(*, ok: bool = True) -> dict:
    return {
        "kind": "open_files_replacement_readiness_gate_verification",
        "status": "ok" if ok else "error",
        "gate_status": "blocked",
        "approved_to_replace_google_drive": False,
        "summary": {
            "requirements": 9,
            "complete": 2,
            "blocked": 6,
            "deferred": 1,
            "missing": 0,
            "first_incomplete_requirement": "read_extraction_coverage",
        },
        "gates": {
            "redaction_ok": ok,
            "source_artifacts_present": ok,
            "source_artifact_hashes_ok": ok,
            "requirements_complete_set": ok,
            "summary_consistent": ok,
            "status_consistent": ok,
            "approval_consistent": ok,
        },
        "errors": [] if ok else ["summary_status_count_mismatch:blocked"],
        "warnings": [],
    }


def extraction_readiness_verification_fixture(*, ok: bool = True) -> dict:
    return {
        "kind": "open_files_extraction_lane_readiness_gate_verification",
        "version": 1,
        "status": "ok" if ok else "error",
        "gate_status": "pending_completion",
        "summary": {
            "active_files": 18212,
            "active_bytes": 132917143313,
            "sampled_files": 48,
            "sampled_usable_files": 11,
            "large_file_runner_required_files": 867,
            "deferred_media_files": 1010,
            "pending_lanes": 8,
            "hard_blocker_lanes": 0,
            "status_counts": {
                "approval_required_large_file_runner": 4,
                "deferred_media": 2,
                "degraded_provider_required": 2,
                "ready": 1,
            },
        },
        "checks": {
            "kind_ok": ok,
            "status_valid": ok,
            "expected_lanes_present": ok,
            "status_counts_consistent": ok,
            "totals_consistent": ok,
            "gate_flags_consistent": ok,
            "redaction_ok": ok,
            "source_artifacts_present": ok,
            "source_artifacts_current": ok,
            "semantic_projection_current": ok,
        },
        "source_artifacts": {
            "expected_sources": 5,
            "present_sources": 5,
            "current_checked": True,
            "current_checked_labels": [
                "corpus_map",
                "deferred_media_summary",
                "smoke_summary",
                "tool_inventory",
                "worker_tool_inventory",
            ],
            "current_mismatched": [],
            "current_missing_paths": [],
        },
        "sensitive_marker_counts": {},
        "errors": [] if ok else ["semantic_projection_mismatch"],
        "warnings": [],
    }


def ready_todos_fixture() -> list[dict]:
    return [
        {
            "id": "512c1fcb-aaaa",
            "priority": "critical",
            "title": "Run approved OCR/vision lane canary and collect review jobs",
            "requires_approval": True,
            "tags": ["approval", "ocr", "open-files", "vision"],
        },
        {
            "id": "64e4472c-bbbb",
            "priority": "critical",
            "title": "Run approved balanced non-audio large-file canary and collect review jobs",
            "requires_approval": True,
            "tags": ["approval", "execution", "large-files", "open-files"],
        },
        {
            "id": "1cfd3624-cccc",
            "priority": "high",
            "title": "Build and smoke archive extraction worker image with Docker access",
            "requires_approval": True,
            "tags": ["archives", "docker", "extraction", "open-files", "worker-image"],
        },
        {
            "id": "7af26157-dddd",
            "priority": "high",
            "title": "Run approved search-index population canary and verify CLI search coverage",
            "requires_approval": True,
            "tags": ["approval", "canary", "open-files", "search-index"],
        },
        {
            "id": "d26d4f64-eeee",
            "priority": "high",
            "title": "Run approved sanitized LLM review canary and collect rename proposals",
            "requires_approval": True,
            "tags": ["approval", "canary", "llm-review", "open-files"],
        },
        {
            "id": "b054dcf6-ffff",
            "priority": "critical",
            "title": "Collect My Drive People ACL approvals",
            "requires_approval": True,
            "tags": ["acl", "google-drive", "owners", "people"],
        },
        {
            "id": "a5587fc2-gggg",
            "priority": "critical",
            "title": "Implement audio/video transcription and keyframe lane",
            "requires_approval": False,
            "tags": ["audio", "video", "transcription"],
        },
    ]


def approval_request_fixture() -> dict:
    return {
        "kind": "open_files_operator_approval_note_template_packet",
        "status": "templates_ready",
        "template_count": 5,
        "templates": [
            {"decision_id": "ocr_vision_canary"},
            {"decision_id": "large_file_canary"},
            {"decision_id": "archive_worker_image"},
            {"decision_id": "search_index_population"},
            {"decision_id": "llm_review_campaign"},
        ],
        "redaction_check": {"passed": True, "sensitive_marker_counts": {}},
        "non_mutation_attestation": {
            "templates_only": True,
            "approvals_granted": False,
            "execution_launched": False,
            "corpus_bytes_mutated": False,
            "s3_objects_mutated": False,
            "metadata_rows_mutated": False,
        },
    }


def approval_request_verification_fixture(*, ok: bool = True) -> dict:
    return {
        "kind": "open_files_operator_approval_request_packet_verification",
        "status": "ok" if ok else "error",
        "packet_status": "templates_ready",
        "template_count": 5,
        "decision_ids": [
            "ocr_vision_canary",
            "large_file_canary",
            "archive_worker_image",
            "search_index_population",
            "llm_review_campaign",
        ],
        "source_status": {
            "dashboard_status": "ready_for_operator_review",
            "approval_notes_status": "missing_required",
            "approved_required_decision_count": 0,
            "remediation_status": "operator_remediation_required",
            "remediation_action_count": 6,
        },
        "gates": {
            "kind_ok": ok,
            "status_templates_ready": ok,
            "redaction_ok": ok,
            "non_mutation_attested": ok,
            "source_status_ok": ok,
            "source_artifacts_present": ok,
            "source_artifact_hashes_ok": ok,
            "source_artifact_current_hashes_ok": ok,
            "required_decisions_present": ok,
            "template_count_consistent": ok,
            "template_hashes_valid": ok,
            "template_files_present": ok,
            "command_hashes_valid": ok,
            "remediation_links_valid": ok,
        },
        "errors": [] if ok else ["template_file_sha256_mismatch:large_file_canary"],
        "warnings": [],
    }


class BuildOperatorApprovalBlockerReportTests(unittest.TestCase):
    def test_report_identifies_operator_approval_required_without_private_values(self) -> None:
        builder = load_module()

        report = builder.build_report(
            dashboard_fixture(),
            adversarial_fixture(),
            approval_request_fixture(),
            approval_request_verification_fixture(),
            stage_verification_fixture(),
            replacement_verification_fixture(),
            ready_todos_fixture(),
            extraction_readiness_verification=extraction_readiness_verification_fixture(),
        )

        self.assertEqual(report["status"], "operator_approval_required")
        self.assertEqual(report["source_artifacts"], [])
        self.assertTrue(report["safe_next_step"]["final_gate_verifiers_ok"])
        self.assertTrue(report["safe_next_step"]["extraction_readiness_verification_ok"])
        self.assertEqual(report["safe_next_step"]["extraction_readiness_gate_status"], "pending_completion")
        self.assertTrue(report["safe_next_step"]["extraction_readiness_source_current"])
        self.assertTrue(report["safe_next_step"]["extraction_readiness_semantic_current"])
        self.assertEqual(report["safe_next_step"]["stage_readiness"]["search_index_search_probe_status"], "not_executed")
        self.assertEqual(report["safe_next_step"]["stage_readiness"]["llm_rename_gate_status"], "pending")
        self.assertFalse(report["safe_next_step"]["stage_readiness"]["metadata_apply_ready"])
        self.assertTrue(report["safe_next_step"]["approval_request_verification_ok"])
        self.assertEqual(report["extraction_readiness_verification"]["status"], "ok")
        self.assertTrue(report["extraction_readiness_verification"]["critical_checks"]["source_artifacts_current"])
        self.assertTrue(report["extraction_readiness_verification"]["critical_checks"]["semantic_projection_current"])
        self.assertEqual(report["stage_dependency_verification"]["gate_status"], "blocked")
        self.assertEqual(report["replacement_readiness_verification"]["gate_status"], "blocked")
        self.assertEqual(report["approval_request_verification"]["status"], "ok")
        self.assertEqual(report["approval_request_verification"]["packet_status"], "templates_ready")
        self.assertTrue(report["approval_request_verification"]["critical_gates"]["source_artifact_current_hashes_ok"])
        self.assertFalse(report["stage_dependency_verification"]["approved_to_scale"])
        self.assertFalse(report["replacement_readiness_verification"]["approved_to_replace_google_drive"])
        self.assertEqual(report["queue"]["ready_approval_tasks"], 6)
        self.assertEqual(report["queue"]["ready_media_tasks"], 1)
        self.assertEqual(report["queue"]["ready_nonapproval_nonmedia_tasks"], 0)
        self.assertEqual(report["safe_next_step"]["ready_dashboard_decisions"], 5)
        self.assertEqual(report["safe_next_step"]["approved_dashboard_decisions"], 0)
        self.assertTrue(report["safe_next_step"]["approval_templates_ready"])
        self.assertEqual(report["approval_request_packet"]["template_count"], 5)
        self.assertTrue(report["approval_request_packet"]["non_mutation_attested"])
        self.assertFalse(report["dashboard"]["approval_notes_complete"])
        self.assertEqual(len(report["dashboard"]["pending_approval_note_items"]), 5)
        self.assertFalse(report["operator_decision_groups"]["extraction_index_and_llm"][0]["approval_note"]["present"])
        self.assertTrue(all(item["matching_ready_todo"] for item in report["operator_decision_groups"]["extraction_index_and_llm"]))
        self.assertEqual(report["safe_next_step"]["ready_drive_approval_tasks"], 1)
        self.assertTrue(report["redaction_check"]["passed"])
        encoded = json.dumps(report)
        self.assertNotIn('"file_id"', encoded)
        self.assertNotIn("open-files://", encoded)
        self.assertNotIn("objects/sha256/", encoded)

    def test_report_requires_final_gate_verifiers_to_be_ok(self) -> None:
        builder = load_module()

        report = builder.build_report(
            dashboard_fixture(),
            adversarial_fixture(),
            approval_request_fixture(),
            approval_request_verification_fixture(),
            stage_verification_fixture(ok=False),
            replacement_verification_fixture(),
            ready_todos_fixture(),
            extraction_readiness_verification=extraction_readiness_verification_fixture(),
        )

        self.assertEqual(report["status"], "needs_prep")
        self.assertFalse(report["safe_next_step"]["final_gate_verifiers_ok"])
        self.assertEqual(report["stage_dependency_verification"]["errors"], ["stage_order_or_set_invalid"])

    def test_report_requires_approval_request_verification_to_be_ok(self) -> None:
        builder = load_module()

        report = builder.build_report(
            dashboard_fixture(),
            adversarial_fixture(),
            approval_request_fixture(),
            approval_request_verification_fixture(ok=False),
            stage_verification_fixture(),
            replacement_verification_fixture(),
            ready_todos_fixture(),
            extraction_readiness_verification=extraction_readiness_verification_fixture(),
        )

        self.assertEqual(report["status"], "needs_prep")
        self.assertFalse(report["safe_next_step"]["approval_request_verification_ok"])
        self.assertEqual(report["approval_request_verification"]["errors"], ["template_file_sha256_mismatch:large_file_canary"])

    def test_report_requires_extraction_readiness_verification_to_be_ok(self) -> None:
        builder = load_module()

        report = builder.build_report(
            dashboard_fixture(),
            adversarial_fixture(),
            approval_request_fixture(),
            approval_request_verification_fixture(),
            stage_verification_fixture(),
            replacement_verification_fixture(),
            ready_todos_fixture(),
            extraction_readiness_verification=extraction_readiness_verification_fixture(ok=False),
        )

        self.assertEqual(report["status"], "needs_prep")
        self.assertFalse(report["safe_next_step"]["final_gate_verifiers_ok"])
        self.assertFalse(report["safe_next_step"]["extraction_readiness_verification_ok"])
        self.assertEqual(report["extraction_readiness_verification"]["errors"], ["semantic_projection_mismatch"])

    def test_sanitizes_sensitive_todo_values_before_output(self) -> None:
        builder = load_module()
        todos = ready_todos_fixture()
        todos.append({
            "id": "unsafe-dddd",
            "priority": "high",
            "title": "Bad open-files://f_secret123 and s3://bucket/objects/sha256/abc",
            "requires_approval": True,
            "tags": ["source_ref", "objects/sha256/private"],
        })

        report = builder.build_report(
            dashboard_fixture(),
            adversarial_fixture(),
            approval_request_fixture(),
            approval_request_verification_fixture(),
            stage_verification_fixture(),
            replacement_verification_fixture(),
            todos,
            extraction_readiness_verification=extraction_readiness_verification_fixture(),
        )

        encoded = json.dumps(report)
        self.assertTrue(report["redaction_check"]["passed"])
        self.assertNotIn("open-files://", encoded)
        self.assertNotIn("s3://", encoded)
        self.assertNotIn("objects/sha256/", encoded)
        self.assertNotIn("f_secret123", encoded)

    def test_cli_writes_report_from_files(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            dashboard = root / "dashboard.json"
            adversarial = root / "verification.json"
            todos = root / "ready-todos.json"
            output = root / "report.json"
            write_json(dashboard, dashboard_fixture())
            write_json(adversarial, adversarial_fixture())
            approval_request = root / "approval-request-packet.json"
            approval_request_verification = root / "approval-request-packet-verification.json"
            stage_verification = root / "stage-verification.json"
            replacement_verification = root / "replacement-verification.json"
            extraction_readiness_verification = root / "extraction-readiness-verification.json"
            write_json(approval_request, approval_request_fixture())
            write_json(approval_request_verification, approval_request_verification_fixture())
            write_json(stage_verification, stage_verification_fixture())
            write_json(replacement_verification, replacement_verification_fixture())
            write_json(extraction_readiness_verification, extraction_readiness_verification_fixture())
            write_json(todos, ready_todos_fixture())

            proc = run_script(
                "--dashboard", str(dashboard),
                "--adversarial-verification", str(adversarial),
                "--approval-request-packet", str(approval_request),
                "--approval-request-verification", str(approval_request_verification),
                "--stage-verification", str(stage_verification),
                "--replacement-verification", str(replacement_verification),
                "--extraction-readiness-verification", str(extraction_readiness_verification),
                "--ready-todos", str(todos),
                "--output", str(output),
            )

            self.assertEqual(proc.returncode, 0, proc.stderr)
            generated = proc.stdout + output.read_text(encoding="utf-8")
            self.assertIn("operator_approval_required", generated)
            report = json.loads(output.read_text(encoding="utf-8"))
            self.assertEqual(len(report["source_artifacts"]), 8)
            self.assertTrue(all(item["present"] for item in report["source_artifacts"]))
            hashed = [item for item in report["source_artifacts"] if item["label"] != "ready_todos_live_command"]
            self.assertTrue(all(len(item["sha256"]) == 64 for item in hashed))
            self.assertTrue(report["safe_next_step"]["extraction_readiness_verification_ok"])
            self.assertTrue(report["safe_next_step"]["approval_request_verification_ok"])
            self.assertNotIn('"file_id"', generated)
            self.assertNotIn("open-files://", generated)


if __name__ == "__main__":
    unittest.main()
