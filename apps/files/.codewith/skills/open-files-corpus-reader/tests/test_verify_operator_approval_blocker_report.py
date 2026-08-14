#!/usr/bin/env python3
"""Offline tests for operator approval blocker report verification."""

from __future__ import annotations

import importlib.util
import hashlib
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


SCRIPT_DIR = Path(__file__).resolve().parents[1] / "scripts"
SCRIPT = SCRIPT_DIR / "verify_operator_approval_blocker_report.py"


def load_module():
    if str(SCRIPT_DIR) not in sys.path:
        sys.path.insert(0, str(SCRIPT_DIR))
    spec = importlib.util.spec_from_file_location("verify_operator_approval_blocker_report", SCRIPT)
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


def source_artifacts() -> list[dict[str, object]]:
    labels = [
        "extraction_approval_dashboard",
        "adversarial_packet_verification",
        "approval_request_packet",
        "approval_request_packet_verification",
        "stage_dependency_verification",
        "replacement_readiness_verification",
        "extraction_readiness_verification",
        "ready_todos_fixture",
    ]
    return [
        {"label": label, "present": True, "bytes": 10, "sha256": "c" * 64}
        for label in labels
    ]


def write_file_sources(root: Path) -> dict[str, Path]:
    source_paths: dict[str, Path] = {}
    for label in (
        "extraction_approval_dashboard",
        "adversarial_packet_verification",
        "approval_request_packet",
        "approval_request_packet_verification",
        "stage_dependency_verification",
        "replacement_readiness_verification",
        "extraction_readiness_verification",
    ):
        path = root / f"{label}.json"
        path.write_text(json.dumps({"label": label, "aggregate": True}, sort_keys=True), encoding="utf-8")
        source_paths[label] = path
    return source_paths


def source_artifacts_from_paths(source_paths: dict[str, Path]) -> list[dict[str, object]]:
    artifacts: list[dict[str, object]] = []
    for label in (
        "extraction_approval_dashboard",
        "adversarial_packet_verification",
        "approval_request_packet",
        "approval_request_packet_verification",
        "stage_dependency_verification",
        "replacement_readiness_verification",
        "extraction_readiness_verification",
    ):
        path = source_paths[label]
        artifacts.append(
            {
                "label": label,
                "present": True,
                "bytes": path.stat().st_size,
                "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
            }
        )
    artifacts.append(
        {
            "label": "ready_todos_live_command",
            "present": True,
            "bytes": None,
            "sha256": None,
            "command": "todos ready --json",
        }
    )
    return artifacts


def ready_todos_fixture() -> list[dict[str, object]]:
    approval_tasks = [
        {
            "id": f"approval-{index}",
            "title": f"Approval task {index}",
            "requires_approval": True,
            "tags": ["approval"],
        }
        for index in range(5)
    ]
    approval_tasks.append(
        {
            "id": "drive-approval",
            "title": "Drive ACL approval task",
            "requires_approval": True,
            "tags": ["approval", "google-drive", "acl"],
        }
    )
    return [
        *approval_tasks,
        {
            "id": "media-final",
            "title": "Media final pass",
            "requires_approval": True,
            "tags": ["audio"],
        },
    ]


def verification_section(kind: str, gate_status_key: str) -> dict[str, object]:
    approved_key = "approved_to_scale" if gate_status_key == "stage_gate_status" else "approved_to_replace_google_drive"
    summary: dict[str, object]
    if gate_status_key == "stage_gate_status":
        summary = {
            "first_blocking_stage": "extraction_lane_readiness",
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
    else:
        summary = {"first_incomplete_requirement": "read_extraction_coverage"}
    return {
        "present": True,
        "kind": kind,
        "status": "ok",
        "ok": True,
        "gate_status": "blocked",
        approved_key: False,
        "summary": summary,
        "critical_gates": {
            "redaction_ok": True,
            "source_artifacts_present": True,
            "source_artifact_hashes_ok": True,
            "status_consistent": True,
            "approval_consistent": True,
        },
        "errors": [],
        "warnings": [],
    }


def approval_request_verification_section() -> dict[str, object]:
    return {
        "present": True,
        "kind": "open_files_operator_approval_request_packet_verification",
        "status": "ok",
        "ok": True,
        "packet_status": "templates_ready",
        "template_count": 5,
        "decision_count": 5,
        "source_status": {
            "dashboard_status": "ready_for_operator_review",
            "approval_notes_status": "missing_required",
            "approved_required_decision_count": 0,
            "remediation_status": "operator_remediation_required",
            "remediation_action_count": 6,
        },
        "critical_gates": {
            "kind_ok": True,
            "status_templates_ready": True,
            "redaction_ok": True,
            "non_mutation_attested": True,
            "source_status_ok": True,
            "source_artifacts_present": True,
            "source_artifact_hashes_ok": True,
            "source_artifact_current_hashes_ok": True,
            "required_decisions_present": True,
            "template_count_consistent": True,
            "template_hashes_valid": True,
            "template_files_present": True,
            "command_hashes_valid": True,
            "remediation_links_valid": True,
        },
        "errors": [],
        "warnings": [],
    }


def extraction_readiness_verification_section() -> dict[str, object]:
    return {
        "present": True,
        "kind": "open_files_extraction_lane_readiness_gate_verification",
        "status": "ok",
        "ok": True,
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
        "critical_checks": {
            "kind_ok": True,
            "status_valid": True,
            "expected_lanes_present": True,
            "status_counts_consistent": True,
            "totals_consistent": True,
            "gate_flags_consistent": True,
            "redaction_ok": True,
            "source_artifacts_present": True,
            "source_artifacts_current": True,
            "semantic_projection_current": True,
        },
        "source_artifacts": {
            "expected_sources": 5,
            "present_sources": 5,
            "current_checked": True,
            "current_checked_count": 5,
            "current_mismatched_count": 0,
            "current_missing_paths_count": 0,
        },
        "errors": [],
        "warnings": [],
    }


def report_fixture() -> dict[str, object]:
    decisions = [
        {
            "id": key,
            "ready_for_approval": True,
            "approval_note": {"approved": False},
            "matching_ready_todo": {"id": key[:8], "title": key, "requires_approval": True, "tags": ["approval"]},
        }
        for key in (
            "ocr_vision_canary",
            "large_file_canary",
            "archive_worker_image",
            "search_index_population",
            "llm_review_campaign",
        )
    ]
    return {
        "kind": "open_files_operator_approval_blocker_report",
        "version": 1,
        "status": "operator_approval_required",
        "non_mutation_attestation": {
            "corpus_bytes_mutated": False,
            "s3_objects_mutated": False,
            "metadata_rows_mutated": False,
            "report_is_read_only": True,
        },
        "source_artifacts": source_artifacts(),
        "dashboard": {
            "present": True,
            "status": "ready_for_operator_review",
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
        },
        "adversarial_packet_verification": {
            "present": True,
            "status": "ok",
            "gates_ok": True,
            "errors": [],
            "warnings": [],
        },
        "stage_dependency_verification": verification_section(
            "open_files_stage_dependency_gate_verification",
            "stage_gate_status",
        ),
        "replacement_readiness_verification": verification_section(
            "open_files_replacement_readiness_gate_verification",
            "replacement_gate_status",
        ),
        "extraction_readiness_verification": extraction_readiness_verification_section(),
        "approval_request_packet": {
            "present": True,
            "status": "templates_ready",
            "template_count": 5,
            "template_decisions": [
                "ocr_vision_canary",
                "large_file_canary",
                "archive_worker_image",
                "search_index_population",
                "llm_review_campaign",
            ],
            "redaction_check_passed": True,
            "non_mutation_attested": True,
        },
        "approval_request_verification": approval_request_verification_section(),
        "queue": {
            "ready_total": 7,
            "ready_approval_tasks": 6,
            "ready_media_tasks": 1,
            "ready_nonapproval_nonmedia_tasks": 0,
            "approval_tasks": [{"id": "a"} for _ in range(6)],
            "media_tasks": [{"id": "m"}],
            "nonapproval_nonmedia_tasks": [],
        },
        "operator_decision_groups": {
            "extraction_index_and_llm": decisions,
            "drive_acl_and_organization": [{"id": "drive"}],
            "media_final_pass": [{"id": "media"}],
        },
        "safe_next_step": {
            "type": "operator_approval",
            "final_gate_verifiers_ok": True,
            "extraction_readiness_verification_ok": True,
            "extraction_readiness_gate_status": "pending_completion",
            "extraction_readiness_source_current": True,
            "extraction_readiness_semantic_current": True,
            "stage_gate_status": "blocked",
            "stage_readiness": {
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
            "replacement_gate_status": "blocked",
            "ready_dashboard_decisions": 5,
            "approved_dashboard_decisions": 0,
            "approval_templates_ready": True,
            "approval_request_packet_status": "templates_ready",
            "approval_request_verification_ok": True,
            "ready_drive_approval_tasks": 1,
            "ready_nonapproval_nonmedia_tasks": 0,
            "media_deferred_until_final_pass": True,
        },
        "redaction_check": {"passed": True, "sensitive_marker_counts": {}},
        "redaction": "aggregate-only",
    }


class VerifyOperatorApprovalBlockerReportTests(unittest.TestCase):
    def test_valid_operator_approval_report_passes(self) -> None:
        verifier = load_module()
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "report.json"
            path.write_text(json.dumps(report_fixture()), encoding="utf-8")
            result = verifier.verify_report(
                path,
                ready_todos=ready_todos_fixture(),
                check_ready_todos=True,
            )

        self.assertEqual(result["status"], "ok")
        self.assertEqual(result["report_status"], "operator_approval_required")
        self.assertTrue(result["gates"]["final_gate_verifiers_ok"])
        self.assertTrue(result["gates"]["extraction_readiness_verification_ok"])
        self.assertTrue(result["gates"]["approval_request_verification_ok"])
        self.assertTrue(result["gates"]["ready_todos_current_counts_ok"])
        self.assertTrue(result["gates"]["safe_next_consistent"])
        self.assertEqual(result["summary"]["ready_dashboard_decisions"], 5)
        self.assertEqual(result["summary"]["extraction_readiness_gate_status"], "pending_completion")
        self.assertTrue(result["summary"]["extraction_readiness_source_current"])
        self.assertTrue(result["summary"]["extraction_readiness_semantic_current"])
        self.assertTrue(result["gates"]["stage_readiness_consistent"])
        self.assertEqual(result["summary"]["stage_readiness"]["search_index_search_probe_status"], "not_executed")
        self.assertEqual(result["summary"]["stage_readiness"]["llm_rename_gate_status"], "pending")
        self.assertFalse(result["summary"]["stage_readiness"]["metadata_apply_ready"])
        self.assertEqual(result["ready_todos_current"]["current_counts"]["ready_total"], 7)
        self.assertEqual(result["ready_todos_current"]["mismatched"], [])
        self.assertEqual(result["errors"], [])

    def test_stage_readiness_drift_fails(self) -> None:
        verifier = load_module()
        report = report_fixture()
        report["safe_next_step"]["stage_readiness"]["llm_rename_gate_status"] = "ok"
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "report.json"
            path.write_text(json.dumps(report), encoding="utf-8")
            result = verifier.verify_report(
                path,
                ready_todos=ready_todos_fixture(),
                check_ready_todos=True,
            )

        self.assertEqual(result["status"], "error")
        self.assertIn("safe_next_stage_readiness_inconsistent", result["errors"])

    def test_bad_final_gate_dependency_fails(self) -> None:
        verifier = load_module()
        report = report_fixture()
        report["stage_dependency_verification"]["ok"] = False
        report["stage_dependency_verification"]["status"] = "error"
        report["stage_dependency_verification"]["errors"] = ["stage_order_or_set_invalid"]
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "report.json"
            path.write_text(json.dumps(report), encoding="utf-8")
            result = verifier.verify_report(path)

        self.assertEqual(result["status"], "error")
        self.assertIn("safe_next_final_gate_verifiers_inconsistent", result["errors"])
        self.assertIn("stage_verification_not_ok", result["errors"])
        self.assertIn("report_status_inconsistent", result["errors"])

    def test_bad_approval_request_verification_fails(self) -> None:
        verifier = load_module()
        report = report_fixture()
        report["approval_request_verification"]["ok"] = False
        report["approval_request_verification"]["status"] = "error"
        report["approval_request_verification"]["errors"] = ["template_file_sha256_mismatch:large_file_canary"]
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "report.json"
            path.write_text(json.dumps(report), encoding="utf-8")
            result = verifier.verify_report(path)

        self.assertEqual(result["status"], "error")
        self.assertIn("safe_next_approval_request_verification_inconsistent", result["errors"])
        self.assertIn("approval_request_verification_not_ok", result["errors"])
        self.assertIn("report_status_inconsistent", result["errors"])

    def test_bad_extraction_readiness_verification_fails(self) -> None:
        verifier = load_module()
        report = report_fixture()
        report["extraction_readiness_verification"]["ok"] = False
        report["extraction_readiness_verification"]["status"] = "error"
        report["extraction_readiness_verification"]["errors"] = ["semantic_projection_mismatch"]
        report["extraction_readiness_verification"]["critical_checks"]["semantic_projection_current"] = False
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "report.json"
            path.write_text(json.dumps(report), encoding="utf-8")
            result = verifier.verify_report(path)

        self.assertEqual(result["status"], "error")
        self.assertFalse(result["gates"]["extraction_readiness_verification_ok"])
        self.assertIn("safe_next_final_gate_verifiers_inconsistent", result["errors"])
        self.assertIn("safe_next_extraction_readiness_verification_inconsistent", result["errors"])
        self.assertIn("safe_next_extraction_readiness_semantic_current_inconsistent", result["errors"])
        self.assertIn("extraction_readiness_verification_not_ok", result["errors"])
        self.assertIn("extraction_readiness_critical_check_not_true:semantic_projection_current", result["errors"])
        self.assertIn("report_status_inconsistent", result["errors"])

    def test_missing_source_artifact_fails(self) -> None:
        verifier = load_module()
        report = report_fixture()
        report["source_artifacts"] = [
            item for item in report["source_artifacts"] if item["label"] != "stage_dependency_verification"
        ]
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "report.json"
            path.write_text(json.dumps(report), encoding="utf-8")
            result = verifier.verify_report(path)

        self.assertEqual(result["status"], "error")
        self.assertIn("missing_source_artifact:stage_dependency_verification", result["errors"])

    def test_current_file_source_hashes_are_verified_when_paths_are_supplied(self) -> None:
        verifier = load_module()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source_paths = write_file_sources(root)
            report = report_fixture()
            report["source_artifacts"] = source_artifacts_from_paths(source_paths)
            path = root / "report.json"
            path.write_text(json.dumps(report), encoding="utf-8")
            result = verifier.verify_report(path, source_paths=source_paths)

        self.assertEqual(result["status"], "ok")
        self.assertTrue(result["gates"]["source_artifact_current_hashes_ok"])
        self.assertTrue(result["source_artifacts"]["current_checked"])
        self.assertEqual(result["source_artifacts"]["current_mismatched"], [])

    def test_stale_current_file_source_fails_hash_check(self) -> None:
        verifier = load_module()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source_paths = write_file_sources(root)
            report = report_fixture()
            report["source_artifacts"] = source_artifacts_from_paths(source_paths)
            source_paths["replacement_readiness_verification"].write_text(
                json.dumps({"label": "replacement_readiness_verification", "aggregate": True, "changed": True}),
                encoding="utf-8",
            )
            path = root / "report.json"
            path.write_text(json.dumps(report), encoding="utf-8")
            result = verifier.verify_report(path, source_paths=source_paths)

        self.assertEqual(result["status"], "error")
        self.assertFalse(result["gates"]["source_artifact_current_hashes_ok"])
        self.assertIn("source_artifact_current_sha256_mismatch:replacement_readiness_verification", result["errors"])
        self.assertIn("replacement_readiness_verification", result["source_artifacts"]["current_mismatched"])

    def test_missing_current_file_source_fails_hash_check(self) -> None:
        verifier = load_module()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source_paths = write_file_sources(root)
            report = report_fixture()
            report["source_artifacts"] = source_artifacts_from_paths(source_paths)
            source_paths["replacement_readiness_verification"].unlink()
            path = root / "report.json"
            path.write_text(json.dumps(report), encoding="utf-8")
            result = verifier.verify_report(path, source_paths=source_paths)

        self.assertEqual(result["status"], "error")
        self.assertFalse(result["gates"]["source_artifact_current_hashes_ok"])
        self.assertIn("source_artifact_current_path_missing:replacement_readiness_verification", result["errors"])
        self.assertIn("replacement_readiness_verification", result["source_artifacts"]["current_missing_paths"])

    def test_stale_current_ready_todo_counts_fail(self) -> None:
        verifier = load_module()
        stale_ready_todos = [
            *ready_todos_fixture(),
            {
                "id": "unexpected-work",
                "title": "Unexpected nonapproval work",
                "requires_approval": False,
                "tags": ["freshness"],
            },
        ]
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            report = report_fixture()
            path = root / "report.json"
            path.write_text(json.dumps(report), encoding="utf-8")
            result = verifier.verify_report(
                path,
                ready_todos=stale_ready_todos,
                check_ready_todos=True,
            )

        self.assertEqual(result["status"], "error")
        self.assertFalse(result["gates"]["ready_todos_current_counts_ok"])
        self.assertIn("ready_todos_current_count_mismatch:ready_total", result["errors"])
        self.assertIn("ready_todos_current_count_mismatch:ready_nonapproval_nonmedia_tasks", result["errors"])
        self.assertEqual(
            result["ready_todos_current"]["mismatched"],
            ["ready_nonapproval_nonmedia_tasks", "ready_total"],
        )

    def test_cli_fails_on_sensitive_marker_without_echoing_private_value(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            report = report_fixture()
            report["private_metadata"] = {"file_id": "f_privateSecret123"}
            report_path = root / "report.json"
            output = root / "verification.json"
            report_path.write_text(json.dumps(report), encoding="utf-8")

            proc = run_script(
                "--report",
                str(report_path),
                "--output",
                str(output),
                "--skip-current-source-check",
                "--skip-ready-todos-current-check",
            )
            result = json.loads(output.read_text(encoding="utf-8"))

        self.assertEqual(proc.returncode, 1)
        self.assertIn("sensitive_marker_hits", result["errors"])
        self.assertIn("json_file_id_key", result["sensitive_marker_counts"])
        self.assertNotIn("f_privateSecret123", proc.stdout)


if __name__ == "__main__":
    unittest.main()
