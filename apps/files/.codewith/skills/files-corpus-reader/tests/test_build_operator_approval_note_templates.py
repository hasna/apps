#!/usr/bin/env python3
"""Offline tests for operator approval-note template generation."""

from __future__ import annotations

import json
import subprocess
import tempfile
import unittest
from pathlib import Path


SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "build_operator_approval_note_templates.py"
VALIDATOR = Path(__file__).resolve().parents[1] / "scripts" / "validate_operator_approval_notes.py"


def run_script(*args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["python3", str(SCRIPT), *args],
        check=False,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )


def run_validator(*args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["python3", str(VALIDATOR), *args],
        check=False,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )


def write_json(path: Path, value: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, sort_keys=True), encoding="utf-8")


def missing_note() -> dict:
    return {
        "summary_present": True,
        "present": False,
        "valid": False,
        "approved": False,
        "status": None,
        "errors": ["missing_approval_note_artifact"],
    }


def dashboard() -> dict:
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
        },
        "approval_items": [
            {"id": "ocr_vision_canary", "priority": "critical", "status": "degraded_provider_required", "ready_for_approval": True, "approval_note": missing_note()},
            {"id": "large_file_canary", "priority": "critical", "status": "approval_required", "ready_for_approval": True, "approval_note": missing_note()},
            {"id": "archive_worker_image", "priority": "high", "status": "ready_for_operator_approval", "ready_for_approval": True, "approval_note": missing_note()},
            {"id": "search_index_population", "priority": "high", "status": "approval_required", "ready_for_approval": True, "approval_note": missing_note()},
            {"id": "llm_review_campaign", "priority": "high", "status": "approval_required", "ready_for_approval": True, "approval_note": missing_note()},
            {"id": "deferred_media_final_pass", "priority": "deferred", "status": "deferred", "ready_for_approval": False, "approval_note": missing_note()},
        ],
        "sections": {
            "ocr_vision_canary": {
                "readiness_lane": {
                    "active_files": 5,
                    "active_bytes": 100,
                    "route_status": "degraded_provider_required",
                    "provider_required": True,
                },
                "smoke_lane": {"samples": 2, "usable": 0},
            },
            "large_file_canary": {
                "approval": {"status": "approval_required", "approval_required": True, "approved": False, "planned_jobs": 9, "planned_bytes": 900},
                "validation": {"status": "ok"},
                "commands": {"execute_canary_after_approval": "python3 run-large.py --execute"},
            },
            "archive_worker_image": {
                "approval": {"status": "ready_for_operator_approval", "approval_required": True, "approved": False},
                "commands": {"approved_build_smoke_and_inventory": "python3 verify-image.py --build"},
            },
            "search_index_population": {
                "approval": {"status": "approval_required", "approval_required": True, "approved": False, "planned_jobs": 25, "planned_bytes": 1000},
                "validation": {"status": "ok"},
                "runtime": {"status": "approval_required"},
                "commands": {"execute_canary_after_approval": "python3 run-search.py --execute"},
            },
            "llm_review_campaign": {
                "approval": {"approval_status": "approval_required", "approved": False, "jobs_planned": 1},
                "validation": {"status": "ok"},
                "runtime": {"status": "approval_required"},
            },
            "tool_remediation": {
                "present": True,
                "status": "operator_remediation_required",
                "summary": {
                    "action_count": 6,
                    "non_deferred_action_count": 5,
                    "approval_required_action_count": 5,
                    "deferred_action_count": 1,
                    "requires_operator_approval_before_scale": True,
                    "requires_provider_or_tool_work": True,
                    "final_media_pass_required": True,
                },
                "actions": [
                    {
                        "id": "enable_ocr_or_vision_lane",
                        "priority": "critical",
                        "category": "tool_or_provider",
                        "lanes": ["needs_ocr_or_vision"],
                        "active_files": 5,
                        "approval_required": True,
                        "deferred_until_final_pass": False,
                        "worker_image_can_help": False,
                        "package_candidates": ["tesseract-ocr"],
                        "safe_next_action": "approve sanitized vision requests or install local OCR",
                    },
                    {
                        "id": "approve_large_file_runner_canary",
                        "priority": "critical",
                        "category": "operator_approval",
                        "lanes": ["needs_pdf_extractor"],
                        "active_files": 9,
                        "approval_required": True,
                        "deferred_until_final_pass": False,
                        "worker_image_can_help": False,
                        "package_candidates": [],
                        "safe_next_action": "validate approval note then run bounded canary",
                    },
                    {
                        "id": "enable_archive_inventory_tools",
                        "priority": "high",
                        "category": "tooling",
                        "lanes": ["needs_archive_inventory"],
                        "active_files": 2,
                        "approval_required": False,
                        "deferred_until_final_pass": False,
                        "worker_image_can_help": True,
                        "package_candidates": ["p7zip-full"],
                        "safe_next_action": "verify archive smoke hashes",
                    },
                    {
                        "id": "grant_worker_docker_access_or_ci",
                        "priority": "high",
                        "category": "worker_environment",
                        "lanes": ["needs_archive_inventory"],
                        "active_files": 0,
                        "approval_required": True,
                        "deferred_until_final_pass": False,
                        "worker_image_can_help": False,
                        "package_candidates": [],
                        "safe_next_action": "grant Docker socket access or run CI smoke",
                    },
                ],
                "redaction_check": {"passed": True, "sensitive_marker_counts": {}},
            },
        },
    }


def approval_notes_summary() -> dict:
    return {
        "kind": "open_files_operator_approval_notes_summary",
        "status": "missing_required",
        "artifact_count": 0,
        "valid_artifact_count": 0,
        "required_decision_count": 5,
        "approved_required_decision_count": 0,
        "missing_required_decisions": [
            "ocr_vision_canary",
            "large_file_canary",
            "archive_worker_image",
            "search_index_population",
            "llm_review_campaign",
        ],
        "invalid_required_decisions": [],
    }


def stage_verification() -> dict:
    return {
        "kind": "open_files_stage_dependency_gate_verification",
        "status": "ok",
        "gate_status": "blocked",
        "summary": {
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
    }


class BuildOperatorApprovalNoteTemplatesTests(unittest.TestCase):
    def test_builds_five_private_templates_and_redacted_packet(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            dashboard_path = root / "dashboard.json"
            notes_path = root / "approval-notes-summary.json"
            stage_path = root / "stage-dependency-verification.json"
            templates = root / "templates"
            packet = root / "approval-request-packet.json"
            write_json(dashboard_path, dashboard())
            write_json(notes_path, approval_notes_summary())
            write_json(stage_path, stage_verification())

            proc = run_script(
                "--dashboard",
                str(dashboard_path),
                "--approval-notes-summary",
                str(notes_path),
                "--stage-verification",
                str(stage_path),
                "--output-dir",
                str(templates),
                "--packet-output",
                str(packet),
            )

            self.assertEqual(proc.returncode, 0, proc.stderr)
            packet_json = json.loads(packet.read_text(encoding="utf-8"))
            self.assertEqual(packet_json["status"], "templates_ready")
            self.assertEqual(packet_json["template_count"], 5)
            self.assertTrue(packet_json["redaction_check"]["passed"])
            self.assertEqual(packet_json["source_status"]["remediation_status"], "operator_remediation_required")
            self.assertEqual(packet_json["source_status"]["remediation_action_count"], 6)
            source_artifacts = {item["label"]: item for item in packet_json["source_artifacts"]}
            self.assertEqual(set(source_artifacts), {"extraction_approval_dashboard", "approval_notes_summary", "stage_dependency_verification"})
            self.assertTrue(source_artifacts["extraction_approval_dashboard"]["present"])
            self.assertGreater(source_artifacts["extraction_approval_dashboard"]["bytes"], 0)
            self.assertRegex(source_artifacts["extraction_approval_dashboard"]["sha256"], r"^[a-f0-9]{64}$")
            self.assertTrue(source_artifacts["approval_notes_summary"]["present"])
            self.assertGreater(source_artifacts["approval_notes_summary"]["bytes"], 0)
            self.assertRegex(source_artifacts["approval_notes_summary"]["sha256"], r"^[a-f0-9]{64}$")
            self.assertTrue(source_artifacts["stage_dependency_verification"]["present"])
            self.assertGreater(source_artifacts["stage_dependency_verification"]["bytes"], 0)
            self.assertRegex(source_artifacts["stage_dependency_verification"]["sha256"], r"^[a-f0-9]{64}$")
            self.assertEqual(packet_json["source_status"]["stage_verification_status"], "ok")
            self.assertEqual(packet_json["source_status"]["stage_gate_status"], "blocked")
            self.assertEqual(packet_json["stage_readiness"]["llm_rename_gate_status"], "pending")
            by_decision = {item["decision_id"]: item for item in packet_json["templates"]}
            self.assertEqual(by_decision["ocr_vision_canary"]["remediation_action_ids"], ["enable_ocr_or_vision_lane"])
            self.assertEqual(by_decision["large_file_canary"]["remediation_action_ids"], ["approve_large_file_runner_canary"])
            self.assertEqual(
                by_decision["archive_worker_image"]["remediation_action_ids"],
                ["enable_archive_inventory_tools", "grant_worker_docker_access_or_ci"],
            )
            self.assertTrue((templates / "large_file_canary.template.json").exists())
            template_json = json.loads((templates / "ocr_vision_canary.template.json").read_text(encoding="utf-8"))
            self.assertEqual(template_json["remediation_context"]["linked_action_ids"], ["enable_ocr_or_vision_lane"])
            self.assertEqual(template_json["remediation_context"]["linked_actions"][0]["active_files"], 5)
            self.assertEqual(template_json["stage_readiness_context"]["search_index_search_probe_status"], "not_executed")
            self.assertEqual(by_decision["ocr_vision_canary"]["stage_readiness_sha256"], packet_json["stage_readiness_sha256"])
            generated = proc.stdout + packet.read_text(encoding="utf-8")
            self.assertNotIn('"file_id"', generated)
            self.assertNotIn("open-files://", generated)
            self.assertNotIn("objects/sha256/", generated)

    def test_templates_are_ignored_as_approval_notes(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            dashboard_path = root / "dashboard.json"
            notes_path = root / "approval-notes-summary.json"
            stage_path = root / "stage-dependency-verification.json"
            templates = root / "notes-root"
            packet = root / "approval-request-packet.json"
            output = root / "validated-summary.json"
            write_json(dashboard_path, dashboard())
            write_json(notes_path, approval_notes_summary())
            write_json(stage_path, stage_verification())

            proc = run_script(
                "--dashboard",
                str(dashboard_path),
                "--approval-notes-summary",
                str(notes_path),
                "--stage-verification",
                str(stage_path),
                "--output-dir",
                str(templates),
                "--packet-output",
                str(packet),
            )
            self.assertEqual(proc.returncode, 0, proc.stderr)

            validator = run_validator("--notes-dir", str(templates), "--output", str(output))

            self.assertEqual(validator.returncode, 0, validator.stderr)
            summary = json.loads(output.read_text(encoding="utf-8"))
            self.assertEqual(summary["status"], "missing_required")
            self.assertEqual(summary["artifact_count"], 0)
            self.assertEqual(len(summary["missing_required_decisions"]), 5)


if __name__ == "__main__":
    unittest.main()
