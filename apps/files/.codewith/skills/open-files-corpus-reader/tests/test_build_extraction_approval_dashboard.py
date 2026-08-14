#!/usr/bin/env python3
"""Offline tests for consolidated extraction approval dashboard."""

from __future__ import annotations

import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace


SCRIPT_DIR = Path(__file__).resolve().parents[1] / "scripts"
SCRIPT = SCRIPT_DIR / "build_extraction_approval_dashboard.py"


def load_module():
    if str(SCRIPT_DIR) not in sys.path:
        sys.path.insert(0, str(SCRIPT_DIR))
    spec = importlib.util.spec_from_file_location("build_extraction_approval_dashboard", SCRIPT)
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


def write_json(path: Path, value: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, sort_keys=True), encoding="utf-8")


def fixture_files(root: Path) -> dict[str, Path]:
    paths = {
        "extraction_readiness": root / "readiness.json",
        "tool_remediation": root / "tool-remediation.json",
        "ocr_smoke": root / "ocr-smoke.json",
        "worker_image_verification": root / "worker-verification.json",
        "worker_image_approval": root / "worker-approval.json",
        "search_index_approval": root / "search-approval.json",
        "search_index_validation": root / "search-validation.json",
        "search_index_runtime": root / "search-runtime.json",
        "large_file_approval": root / "large-approval.json",
        "large_file_validation": root / "large-validation.json",
        "large_file_dry_run_verification": root / "large-dry-verify.json",
        "llm_campaign_plan": root / "campaign-plan.json",
        "llm_campaign_validation": root / "campaign-validation.json",
        "llm_campaign_runtime": root / "campaign-runtime.json",
        "llm_campaign_results": root / "campaign-results.json",
        "deferred_media": root / "media.json",
        "approval_notes_summary": root / "approval-notes-summary.json",
    }
    write_json(paths["extraction_readiness"], {
        "status": "pending_completion",
        "totals": {"active_files": 10, "sampled_files": 9, "sampled_routed_files": 9, "large_file_runner_required_files": 2, "deferred_media_files": 1},
        "gate": {
            "all_active_lanes_explicitly_routed": True,
            "no_failed_smoke_samples": True,
            "no_not_implemented_samples": True,
            "requires_operator_approval_before_scale": True,
            "requires_provider_or_tool_work": True,
            "final_media_pass_required": True,
            "full_extraction_complete": False,
            "pending_lanes": ["needs_ocr_or_vision"],
        },
        "lanes": [
            {"lane": "needs_ocr_or_vision", "route_status": "degraded_provider_required", "active_files": 5, "requirements": ["approve_or_install_ocr_vision_lane"]},
            {"lane": "needs_archive_inventory", "route_status": "approval_required_large_file_runner", "active_files": 2, "requirements": ["approved_large_file_runner_canary"]},
        ],
    })
    write_json(paths["tool_remediation"], {
        "kind": "open_files_extraction_tool_remediation_packet",
        "status": "operator_remediation_required",
        "summary": {
            "action_count": 2,
            "non_deferred_action_count": 1,
            "approval_required_action_count": 1,
            "deferred_action_count": 1,
            "python_pil_available": True,
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
                "id": "run_final_media_transcription_keyframe_pass",
                "priority": "deferred",
                "category": "deferred_media",
                "lanes": ["needs_transcription", "needs_video_pipeline"],
                "active_files": 1,
                "approval_required": True,
                "deferred_until_final_pass": True,
                "worker_image_can_help": False,
                "package_candidates": ["ffmpeg"],
                "safe_next_action": "defer until final media phase",
            },
        ],
        "redaction_check": {"passed": True, "sensitive_marker_counts": {}},
    })
    write_json(paths["ocr_smoke"], {"by_lane": {"needs_ocr_or_vision": {"samples": 2, "routed": 2, "usable": 0, "failed": 0, "not_implemented": 0, "skipped_size": 1}}})
    runtime_policy = {
        "present": True,
        "status": "ok",
        "network_mode": "none",
        "network_disabled": True,
        "provider_egress_allowed": False,
        "s3_object_access_allowed": False,
        "db_access_allowed": False,
        "corpus_mounts_allowed": False,
        "command_logs_hashed_only": True,
    }
    write_json(paths["worker_image_verification"], {"status": "ok", "docker": {"status": "permission_denied", "path": "/usr/bin/docker"}, "worker_runtime_policy": runtime_policy})
    write_json(paths["worker_image_approval"], {
        "kind": "open_files_extraction_worker_image_approval_packet",
        "status": "ready_for_operator_approval",
        "approval_required": True,
        "gates": {
            "static_verification_ok": True,
            "worker_runtime_policy_ok": True,
            "worker_runtime_network_disabled": True,
            "worker_runtime_provider_egress_disabled": True,
            "worker_runtime_s3_access_disabled": True,
            "worker_runtime_db_access_disabled": True,
            "worker_runtime_corpus_mounts_disabled": True,
            "worker_runtime_logs_hashed_only": True,
            "docker_access_available": False,
            "runtime_build_smoke_complete": False,
            "safe_to_request_operator_approval": True,
        },
        "worker_runtime_policy": runtime_policy,
        "current_verification": {"docker_status": "permission_denied", "next_actions": ["grant_docker_socket_or_ci_runner_access"]},
        "commands": {"approved_build_smoke_and_inventory": "python3 verify.py --build", "rerun_readiness_gate_with_worker_inventory": "python3 gate.py --worker-tool-inventory inventory.json"},
    })
    write_json(paths["search_index_approval"], {
        "kind": "search_index_population_approval_packet",
        "plan_status": "approval_required",
        "approval_required": True,
        "approved": False,
        "coverage": {"active_files": 10, "indexed_files": 0, "missing_files": 10},
        "planned": {"jobs": 10, "bytes": 1000},
        "commands": {"execute_canary_after_approval": "python3 run.py --execute", "verify_canary_after_execution": "python3 verify.py"},
    })
    write_json(paths["search_index_validation"], {"status": "ok", "approved": False, "errors": [], "warnings": [], "jobs_planned": 10, "bytes_planned": 1000})
    write_json(paths["search_index_runtime"], {"status": "approval_required", "approval_attestation": {"status": "blocked", "decision": "approval_required", "runtime_enforced": True, "execute_requested": True, "plan_approved": False, "validation_status": "ok", "jobs_selected": 1}, "scale_readiness_attestation": {"status": "pending_canary"}})
    write_json(paths["large_file_approval"], {"kind": "large_file_extraction_approval_packet", "approval_required": True, "approved": False, "commands": {"execute_canary_after_approval": "python3 large.py --execute"}})
    write_json(paths["large_file_validation"], {"status": "ok", "approved": False, "errors": [], "jobs_planned": 9, "bytes_planned": 9000, "plan_private_id_leaks": 0, "plan_sensitive_marker_hits": 0})
    write_json(paths["large_file_dry_run_verification"], {"status": "ok", "errors": []})
    write_json(paths["llm_campaign_plan"], {"approved": False, "approval_attestation": {"status": "approval_required"}, "jobs_planned": 1, "shards": 1, "worker_manifest_sanitized": True})
    write_json(paths["llm_campaign_validation"], {"status": "ok", "approved": False, "errors": [], "jobs_planned": 1})
    write_json(paths["llm_campaign_runtime"], {"status": "approval_required", "approval_attestation": {"status": "blocked", "decision": "approval_required", "runtime_enforced": True, "execute_requested": True, "plan_approved": False, "validation_status": "ok", "jobs_selected": 1, "shards_selected": 1}})
    write_json(paths["llm_campaign_results"], {"coverage": {"scheduled": 1, "observed": 0, "missing": 1}, "rename_correctness_gate": {"status": "pending"}, "runtime_attestation_gate": {"status": "pending"}, "scale_readiness_attestation": {"status": "pending_canary"}})
    write_json(paths["deferred_media"], {"status": "deferred", "active_media_files": 1, "active_media_bytes": 100, "completion_gate": {"complete": False, "final_media_pass_required": True, "cannot_hide_behind_boolean_deferral": True}})
    write_json(paths["approval_notes_summary"], {
        "kind": "open_files_operator_approval_notes_summary",
        "status": "missing_required",
        "artifact_count": 0,
        "valid_artifact_count": 0,
        "required_decision_count": 5,
        "approved_required_decision_count": 0,
        "approval_request_packet_present": True,
        "approval_request_packet_status": "templates_ready",
        "approval_request_template_count": 5,
        "missing_required_decisions": [
            "ocr_vision_canary",
            "large_file_canary",
            "archive_worker_image",
            "search_index_population",
            "llm_review_campaign",
        ],
        "invalid_required_decisions": [],
        "duplicate_decisions": [],
        "required_decisions": [
            {
                "decision_id": decision_id,
                "present": False,
                "valid": False,
                "status": None,
                "approval_request_checked": True,
                "remediation_action_ids": [],
                "remediation_status": None,
                "command_hashes_match": None,
                "errors": ["missing_approval_note_artifact"],
            }
            for decision_id in (
                "ocr_vision_canary",
                "large_file_canary",
                "archive_worker_image",
                "search_index_population",
                "llm_review_campaign",
            )
        ],
        "redaction_check": {"passed": True, "sensitive_marker_counts": {}},
    })
    return paths


class BuildExtractionApprovalDashboardTests(unittest.TestCase):
    def test_dashboard_consolidates_ready_approval_items_without_private_values(self) -> None:
        builder = load_module()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            paths = fixture_files(root)
            args = SimpleNamespace(**{key: str(value) for key, value in paths.items()})
            dashboard = builder.build_dashboard(args)

        self.assertEqual(dashboard["status"], "ready_for_operator_review")
        self.assertTrue(dashboard["redaction_check"]["passed"])
        self.assertEqual(dashboard["redaction_check"]["sensitive_marker_counts"], {})
        self.assertEqual(dashboard["dashboard_errors"], [])
        self.assertTrue(dashboard["dashboard_checks"]["redaction_ok"])
        self.assertTrue(dashboard["dashboard_checks"]["source_artifacts_present"])
        self.assertTrue(dashboard["dashboard_checks"]["source_artifact_hashes_ok"])
        self.assertTrue(dashboard["dashboard_checks"]["non_mutation_attested"])
        self.assertEqual(dashboard["overall"]["ready_approval_items"], 5)
        self.assertEqual(dashboard["overall"]["approved_approval_notes"], 0)
        self.assertFalse(dashboard["overall"]["approval_notes_complete"])
        self.assertEqual(len(dashboard["overall"]["pending_approval_note_items"]), 5)
        self.assertEqual(dashboard["overall"]["blocked_or_missing_prep_items"], [])
        self.assertTrue(dashboard["sections"]["archive_worker_image"]["safe_to_request_operator_approval"])
        self.assertTrue(dashboard["sections"]["archive_worker_image"]["worker_runtime_policy_ok"])
        self.assertTrue(dashboard["sections"]["archive_worker_image"]["worker_runtime_network_disabled"])
        self.assertTrue(dashboard["sections"]["archive_worker_image"]["worker_runtime_s3_access_disabled"])
        self.assertEqual(dashboard["sections"]["archive_worker_image"]["worker_runtime_policy"]["network_mode"], "none")
        self.assertEqual(dashboard["sections"]["tool_remediation"]["status"], "operator_remediation_required")
        self.assertEqual(dashboard["sections"]["tool_remediation"]["summary"]["action_count"], 2)
        self.assertEqual(dashboard["sections"]["tool_remediation"]["actions"][0]["id"], "enable_ocr_or_vision_lane")
        self.assertEqual(dashboard["sections"]["operator_approval_notes"]["status"], "missing_required")
        self.assertTrue(dashboard["sections"]["operator_approval_notes"]["approval_request_packet_present"])
        self.assertEqual(dashboard["sections"]["operator_approval_notes"]["approval_request_packet_status"], "templates_ready")
        self.assertFalse(dashboard["approval_items"][0]["approval_note"]["present"])
        self.assertTrue(dashboard["approval_items"][0]["approval_note"]["approval_request_checked"])
        self.assertEqual(dashboard["sections"]["search_index_population"]["validation"]["status"], "ok")
        self.assertEqual(dashboard["sections"]["llm_review_campaign"]["results"]["rename_gate_status"], "pending")
        self.assertNotIn('"file_id"', json.dumps(dashboard))
        self.assertNotIn("open-files://", json.dumps(dashboard))

    def test_cli_writes_dashboard_and_omits_private_smoke_results(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            paths = fixture_files(root)
            output = root / "dashboard.json"
            args = []
            for key, path in paths.items():
                cli_key = "--" + key.replace("_", "-")
                args.extend([cli_key, str(path)])
            args.extend(["--output", str(output)])

            proc = run_script(*args)

            self.assertEqual(proc.returncode, 0, proc.stderr)
            generated = proc.stdout + output.read_text(encoding="utf-8")
            self.assertIn("ready_for_operator_review", generated)
            self.assertIn("dashboard_checks", generated)
            self.assertIn("redaction_check", generated)
            self.assertNotIn('"file_id"', generated)
            self.assertNotIn("objects/sha256/", generated)
            self.assertNotIn("s3://", generated)


if __name__ == "__main__":
    unittest.main()
