#!/usr/bin/env python3
"""Offline tests for final Google Drive replacement readiness gate."""

from __future__ import annotations

import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


SCRIPT_DIR = Path(__file__).resolve().parents[1] / "scripts"
SCRIPT = SCRIPT_DIR / "build_replacement_readiness_gate.py"


def load_module():
    if str(SCRIPT_DIR) not in sys.path:
        sys.path.insert(0, str(SCRIPT_DIR))
    spec = importlib.util.spec_from_file_location("build_replacement_readiness_gate", SCRIPT)
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


def stage_gate(ready: bool) -> dict:
    return {
        "status": "ready_to_scale" if ready else "blocked",
        "approved_to_scale": ready,
        "first_blocking_stage": None if ready else "extraction_lane_readiness",
        "stages": [
            {
                "key": "duplicate_preserve_policy",
                "status": "complete",
                "complete": True,
                "blockers": [],
                "evidence": {
                    "policy_ok": True,
                    "scale_duplicate_policy_attested": True,
                    "duplicate_non_survivor_rows": 2,
                },
            },
            {
                "key": "metadata_apply_readiness",
                "status": "complete" if ready else "blocked",
                "complete": ready,
                "blockers": [] if ready else ["metadata apply is not ready"],
                "evidence": {"metadata_apply_ready": ready},
            },
        ],
    }


def extraction_gate(ready: bool) -> dict:
    return {
        "status": "ready" if ready else "pending_completion",
        "totals": {
            "active_files": 10,
            "active_bytes": 1000,
            "routed_lanes": 9,
            "pending_lanes": 0 if ready else 3,
            "hard_blocker_lanes": 0,
            "sampled_files": 9,
            "sampled_usable_files": 9 if ready else 4,
            "sampled_no_usable_lanes": 0,
        },
        "status_counts": {"ready": 9} if ready else {"ready": 6, "deferred_media": 1, "degraded_provider_required": 2},
        "gate": {
            "all_expected_lanes_present": True,
            "all_active_lanes_explicitly_routed": True,
            "all_sampled_non_deferred_non_approval_lanes_have_usable_output": True,
            "full_extraction_complete": ready,
        },
    }


def extraction_verification(ready: bool) -> dict:
    return {
        "kind": "open_files_extraction_lane_readiness_gate_verification",
        "status": "ok",
        "gate_status": "ready" if ready else "pending_completion",
        "checks": {
            "source_artifacts_present": True,
            "source_artifacts_current": True,
            "semantic_projection_current": True,
            "redaction_ok": True,
        },
        "source_artifacts": {
            "current_checked": True,
            "current_mismatched": [],
            "current_missing_paths": [],
        },
        "errors": [],
    }


def media_summary(ready: bool) -> dict:
    return {
        "status": "complete" if ready else "deferred",
        "totals": {
            "active_media_files": 2,
            "indexed_media_files": 2 if ready else 0,
            "unresolved_media_files": 0 if ready else 2,
        },
        "completion_gate": {
            "complete": ready,
            "final_media_pass_required": not ready,
        },
    }


def approval_dashboard(ready: bool) -> dict:
    return {
        "status": "ready_to_execute" if ready else "ready_for_operator_review",
        "overall": {
            "approval_items": 5,
            "approved_approval_notes": 5 if ready else 0,
            "approval_notes_complete": ready,
        },
    }


def approval_notes(ready: bool) -> dict:
    return {
        "status": "complete" if ready else "missing_required",
        "approval_request_packet_present": True,
        "approval_request_packet_status": "templates_ready",
    }


def drive_approval_notes(ready: bool) -> dict:
    return {
        "status": "approved" if ready else "missing_required",
        "required_decision_count": 14,
        "approved_required_decision_count": 14 if ready else 0,
        "missing_required_decisions": [] if ready else ["drive_missing"],
        "invalid_required_decisions": [],
    }


def drive_approval_notes_verification(ready: bool) -> dict:
    return {
        "status": "ok",
        "notes_status": "approved" if ready else "missing_required",
        "template_count": 14,
        "errors": [],
    }


def blocker_report(ready: bool) -> dict:
    return {
        "status": "ready" if ready else "operator_approval_required",
        "safe_next_step": {
            "ready_dashboard_decisions": 0 if ready else 5,
        },
    }


def search_runtime(ready: bool) -> dict:
    return {
        "status": "completed" if ready else "approval_required",
        "runtime_attestation": {"status": "ok" if ready else "not_executed"},
        "search_probe_attestation": {
            "status": "ok" if ready else "not_executed",
            "probes": 3 if ready else 0,
            "matched_expected_file_probes": 3 if ready else 0,
            "failed_probes": 0,
            "skipped_probes": 0,
            "max_latency_ms": 25 if ready else None,
            "latency_budget_ms": 1000,
        },
        "scale_readiness_attestation": {
            "status": "full_run_verified" if ready else "pending_canary",
            "planned_jobs": 10,
            "search_probe_status": "ok" if ready else "not_executed",
            "canary": {"verified": ready},
            "full_run": {"verified": ready, "remaining_jobs": 0 if ready else 10},
        },
    }


def llm_results(ready: bool) -> dict:
    return {
        "status": "complete" if ready else "not_started",
        "rename_correctness_gate": {
            "status": "ok" if ready else "pending",
            "metadata_apply_ready": ready,
            "proposal_rows": 10 if ready else 0,
            "target_path_rows": 10 if ready else 0,
            "canonical_name_rows": 10 if ready else 0,
        },
        "runtime_attestation_gate": {"status": "ok" if ready else "pending"},
        "scale_readiness_attestation": {
            "status": "full_run_verified" if ready else "pending_canary",
            "full_run": {"verified": ready, "remaining_jobs": 0 if ready else 1},
        },
    }


def adversarial_results(ready: bool) -> dict:
    return {
        "status": "approved_to_scale" if ready else "reviewed_with_blockers",
        "approved_to_scale": ready,
        "freshness": {
            "all_input_attestations_match": True,
            "packet_present": True,
            "schema_present": True,
            "reviewer_a_prompt_present": True,
            "reviewer_b_prompt_present": True,
        },
        "totals": {
            "reviewers_present": 2,
            "blockers": 0 if ready else 3,
            "risks": 0 if ready else 4,
        },
        "errors": [],
        "warnings": [],
    }


class ReplacementReadinessGateTests(unittest.TestCase):
    def test_gate_reports_blocked_requirements_without_private_values(self) -> None:
        gate_module = load_module()
        gate = gate_module.build_gate(
            stage_gate=stage_gate(False),
            extraction_gate=extraction_gate(False),
            extraction_verification=extraction_verification(False),
            media_summary=media_summary(False),
            approval_dashboard=approval_dashboard(False),
            approval_notes=approval_notes(False),
            drive_approval_notes=drive_approval_notes(False),
            drive_approval_notes_verification=drive_approval_notes_verification(False),
            operator_blocker_report=blocker_report(False),
            search_runtime=search_runtime(False),
            llm_results=llm_results(False),
            adversarial_results=adversarial_results(False),
            sources=[],
        )

        self.assertEqual(gate["status"], "blocked")
        self.assertFalse(gate["approved_to_replace_google_drive"])
        self.assertEqual(gate["summary"]["requirements"], 9)
        self.assertGreater(gate["summary"]["blocked"], 0)
        self.assertEqual(gate["summary"]["first_incomplete_requirement"], "read_extraction_coverage")
        by_key = {item["key"]: item for item in gate["requirements"]}
        self.assertEqual(by_key["active_file_mapping"]["status"], "complete")
        self.assertEqual(by_key["deferred_media_completion"]["status"], "deferred")
        self.assertEqual(by_key["files_cli_search_index"]["status"], "blocked")
        self.assertTrue(by_key["adversarial_validation"]["evidence"]["freshness_all_input_attestations_match"])
        self.assertNotIn("file_id", json.dumps(gate))
        self.assertNotIn("s3://", json.dumps(gate))

    def test_gate_reports_ready_only_when_every_requirement_is_complete(self) -> None:
        gate_module = load_module()
        gate = gate_module.build_gate(
            stage_gate=stage_gate(True),
            extraction_gate=extraction_gate(True),
            extraction_verification=extraction_verification(True),
            media_summary=media_summary(True),
            approval_dashboard=approval_dashboard(True),
            approval_notes=approval_notes(True),
            drive_approval_notes=drive_approval_notes(True),
            drive_approval_notes_verification=drive_approval_notes_verification(True),
            operator_blocker_report=blocker_report(True),
            search_runtime=search_runtime(True),
            llm_results=llm_results(True),
            adversarial_results=adversarial_results(True),
            sources=[],
        )

        self.assertEqual(gate["status"], "ready")
        self.assertTrue(gate["approved_to_replace_google_drive"])
        self.assertEqual(gate["summary"]["complete"], gate["summary"]["requirements"])
        self.assertIsNone(gate["summary"]["first_incomplete_requirement"])
        self.assertTrue(all(item["complete"] for item in gate["requirements"]))

    def test_adversarial_stale_freshness_blocks_ready_gate(self) -> None:
        gate_module = load_module()
        stale_adversarial = adversarial_results(True)
        stale_adversarial["freshness"]["all_input_attestations_match"] = False
        gate = gate_module.build_gate(
            stage_gate=stage_gate(True),
            extraction_gate=extraction_gate(True),
            extraction_verification=extraction_verification(True),
            media_summary=media_summary(True),
            approval_dashboard=approval_dashboard(True),
            approval_notes=approval_notes(True),
            drive_approval_notes=drive_approval_notes(True),
            drive_approval_notes_verification=drive_approval_notes_verification(True),
            operator_blocker_report=blocker_report(True),
            search_runtime=search_runtime(True),
            llm_results=llm_results(True),
            adversarial_results=stale_adversarial,
            sources=[],
        )

        self.assertEqual(gate["status"], "blocked")
        self.assertFalse(gate["approved_to_replace_google_drive"])
        by_key = {item["key"]: item for item in gate["requirements"]}
        self.assertEqual(by_key["adversarial_validation"]["status"], "blocked")
        self.assertFalse(by_key["adversarial_validation"]["evidence"]["freshness_all_input_attestations_match"])

    def test_stale_extraction_verification_blocks_ready_gate(self) -> None:
        gate_module = load_module()
        stale_verification = extraction_verification(True)
        stale_verification["checks"]["semantic_projection_current"] = False
        gate = gate_module.build_gate(
            stage_gate=stage_gate(True),
            extraction_gate=extraction_gate(True),
            extraction_verification=stale_verification,
            media_summary=media_summary(True),
            approval_dashboard=approval_dashboard(True),
            approval_notes=approval_notes(True),
            drive_approval_notes=drive_approval_notes(True),
            drive_approval_notes_verification=drive_approval_notes_verification(True),
            operator_blocker_report=blocker_report(True),
            search_runtime=search_runtime(True),
            llm_results=llm_results(True),
            adversarial_results=adversarial_results(True),
            sources=[],
        )

        self.assertEqual(gate["status"], "blocked")
        self.assertFalse(gate["approved_to_replace_google_drive"])
        by_key = {item["key"]: item for item in gate["requirements"]}
        self.assertEqual(by_key["read_extraction_coverage"]["status"], "blocked")
        self.assertIn(
            "extraction lane readiness semantic projection is not current",
            by_key["read_extraction_coverage"]["blockers"],
        )

    def test_cli_writes_aggregate_output(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            paths = {
                "stage": root / "stage.json",
                "extraction": root / "extraction.json",
                "extraction_verification": root / "extraction-verification.json",
                "media": root / "media.json",
                "dashboard": root / "dashboard.json",
                "notes": root / "notes.json",
                "drive_notes": root / "drive-notes.json",
                "drive_notes_verification": root / "drive-notes-verification.json",
                "blocker": root / "blocker.json",
                "search": root / "search.json",
                "llm": root / "llm.json",
                "adversarial": root / "adversarial.json",
                "output": root / "replacement.json",
            }
            fixtures = {
                "stage": stage_gate(False),
                "extraction": extraction_gate(False),
                "extraction_verification": extraction_verification(False),
                "media": media_summary(False),
                "dashboard": approval_dashboard(False),
                "notes": approval_notes(False),
                "drive_notes": drive_approval_notes(False),
                "drive_notes_verification": drive_approval_notes_verification(False),
                "blocker": blocker_report(False),
                "search": search_runtime(False),
                "llm": llm_results(False),
                "adversarial": adversarial_results(False),
            }
            for key, value in fixtures.items():
                paths[key].write_text(json.dumps(value), encoding="utf-8")
            proc = run_script(
                "--stage-dependency-gate", str(paths["stage"]),
                "--extraction-readiness-gate", str(paths["extraction"]),
                "--extraction-readiness-verification", str(paths["extraction_verification"]),
                "--deferred-media-summary", str(paths["media"]),
                "--extraction-approval-dashboard", str(paths["dashboard"]),
                "--approval-notes-summary", str(paths["notes"]),
                "--drive-approval-notes-summary", str(paths["drive_notes"]),
                "--drive-approval-notes-verification", str(paths["drive_notes_verification"]),
                "--operator-approval-blocker-report", str(paths["blocker"]),
                "--search-index-runtime-summary", str(paths["search"]),
                "--llm-campaign-results-summary", str(paths["llm"]),
                "--adversarial-review-results", str(paths["adversarial"]),
                "--output", str(paths["output"]),
            )
            generated = proc.stdout + paths["output"].read_text(encoding="utf-8")

        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertIn("open_files_google_drive_replacement_readiness_gate", generated)
        self.assertNotIn("file_id", generated)
        self.assertNotIn("s3://", generated)


if __name__ == "__main__":
    unittest.main()
