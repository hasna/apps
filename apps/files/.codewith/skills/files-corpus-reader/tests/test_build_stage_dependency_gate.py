#!/usr/bin/env python3
"""Offline tests for aggregate stage dependency gate."""

from __future__ import annotations

import json
import subprocess
import tempfile
import unittest
from pathlib import Path


SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "build_stage_dependency_gate.py"


def run_script(*args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["python3", str(SCRIPT), *args],
        check=False,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )


def write_json(path: Path, value: dict) -> None:
    path.write_text(json.dumps(value, indent=2, sort_keys=True), encoding="utf-8")


def write_inputs(root: Path, *, ready: bool = False) -> dict[str, Path]:
    paths = {
        "extraction": root / "extraction.json",
        "extraction_verification": root / "extraction-verification.json",
        "media": root / "media.json",
        "search": root / "search.json",
        "provider": root / "provider.json",
        "llm": root / "llm.json",
        "duplicate": root / "duplicate.json",
        "dashboard": root / "dashboard.json",
        "drive_notes": root / "drive-notes.json",
        "drive_notes_verification": root / "drive-notes-verification.json",
        "output": root / "stage-gate.json",
    }
    write_json(paths["duplicate"], {
        "status": "attested" if ready else "attested_with_pending_index",
        "policy_ok": True,
        "search_index_ready": ready,
        "blockers": [] if ready else ["search index population still pending for planned survivor rows"],
        "organization_duplicates": {
            "active_duplicate_groups": 2,
            "duplicate_non_survivor_rows": 2,
            "groups_without_planned_or_indexed_survivor": 0,
            "duplicate_non_survivor_rows_accidentally_planned": 0,
        },
        "scale_readiness": {"duplicate_policy_attested": True, "approved_to_scale": ready},
    })
    write_json(paths["extraction"], {
        "status": "complete" if ready else "pending_completion",
        "gate": {
            "all_active_lanes_explicitly_routed": True,
            "all_sampled_non_deferred_non_approval_lanes_have_usable_output": True,
            "full_extraction_complete": ready,
            "requires_operator_approval_before_scale": not ready,
            "requires_provider_or_tool_work": not ready,
            "final_media_pass_required": not ready,
        },
        "totals": {"pending_lanes": 0 if ready else 3, "hard_blocker_lanes": 0, "sampled_no_usable_lanes": 0},
        "status_counts": {"ready": 9} if ready else {"ready": 1, "deferred_media": 2, "degraded_provider_required": 1},
    })
    write_json(paths["extraction_verification"], {
        "kind": "open_files_extraction_lane_readiness_gate_verification",
        "status": "ok",
        "gate_status": "complete" if ready else "pending_completion",
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
    })
    write_json(paths["media"], {
        "status": "complete" if ready else "deferred",
        "totals": {"active_media_files": 3, "indexed_media_files": 3 if ready else 0, "unresolved_media_files": 0 if ready else 3},
        "completion_gate": {"complete": ready, "final_media_pass_required": not ready},
    })
    write_json(paths["dashboard"], {
        "status": "ready_for_operator_review",
        "overall": {
            "ready_for_operator_review": True,
            "ready_approval_items": 0 if ready else 5,
            "approval_items": 0 if ready else 5,
            "approved_approval_notes": 0 if ready else 0,
            "approval_notes_complete": ready,
            "pending_approval_note_items": [] if ready else [
                "ocr_vision_canary",
                "large_file_canary",
                "archive_worker_image",
                "search_index_population",
                "llm_review_campaign",
            ],
            "blocked_or_missing_prep_items": [],
            "final_media_pass_deferred": not ready,
        },
    })
    write_json(paths["drive_notes"], {
        "kind": "open_files_drive_approval_notes_summary",
        "status": "approved" if ready else "missing_required",
        "required_decision_count": 14,
        "approved_required_decision_count": 14 if ready else 0,
        "missing_required_decisions": [] if ready else ["drive_missing"],
        "invalid_required_decisions": [],
    })
    write_json(paths["drive_notes_verification"], {
        "kind": "open_files_drive_approval_notes_verification",
        "status": "ok",
        "notes_status": "approved" if ready else "missing_required",
        "template_count": 14,
        "errors": [],
    })
    write_json(paths["search"], {
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
            "search_probe_status": "ok" if ready else "not_executed",
            "canary": {"verified": ready},
            "full_run": {"verified": ready, "remaining_jobs": 0 if ready else 10},
        },
    })
    write_json(paths["provider"], {
        "status": "ok" if ready else "blocked_provider_route",
        "direct_provider_policy_gate": {
            "status": "ok",
            "checks": {
                "status_ok": True,
                "real_file_ids_not_sent": True,
                "raw_file_bytes_not_sent": True,
                "raw_extracts_not_sent": True,
                "secret_values_not_sent": True,
                "provider_data_collection_denied": True,
                "provider_data_collection_allowed_count_zero": True,
                "allowed_hosts_safe": True,
            },
        },
        "schedule_gate": {
            "status": "ok",
            "invalid_account_count": 0,
            "max_campaign_parallel": 1,
        },
        "non_mutation_attestation": {
            "provider_calls_made": False,
            "corpus_bytes_mutated": False,
            "s3_objects_mutated": False,
            "metadata_rows_mutated": False,
            "search_index_rows_mutated": False,
        },
        "redaction_check": {"passed": True, "sensitive_marker_counts": {}},
    })
    write_json(paths["llm"], {
        "status": "complete" if ready else "not_started",
        "rename_correctness_gate": {"status": "ok" if ready else "pending", "metadata_apply_ready": ready},
        "runtime_attestation_gate": {"status": "ok" if ready else "pending"},
        "scale_readiness_attestation": {
            "status": "full_run_verified" if ready else "pending_canary",
            "canary": {"verified": ready},
            "full_run": {"verified": ready, "remaining_jobs": 0 if ready else 1},
        },
    })
    return paths


class StageDependencyGateTests(unittest.TestCase):
    def test_blocked_gate_is_aggregate_only_and_ordered(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            paths = write_inputs(Path(tmp), ready=False)
            proc = run_script(
                "--extraction-readiness-gate", str(paths["extraction"]),
                "--extraction-readiness-verification", str(paths["extraction_verification"]),
                "--deferred-media-summary", str(paths["media"]),
                "--search-index-runtime-summary", str(paths["search"]),
                "--llm-provider-readiness", str(paths["provider"]),
                "--llm-campaign-results-summary", str(paths["llm"]),
                "--duplicate-preserve-attestation", str(paths["duplicate"]),
                "--extraction-approval-dashboard", str(paths["dashboard"]),
                "--drive-approval-notes-summary", str(paths["drive_notes"]),
                "--drive-approval-notes-verification", str(paths["drive_notes_verification"]),
                "--output", str(paths["output"]),
            )

        self.assertEqual(proc.returncode, 0, proc.stderr)
        gate = json.loads(proc.stdout)
        self.assertEqual(gate["status"], "blocked")
        self.assertFalse(gate["approved_to_scale"])
        self.assertEqual(gate["stages"][0]["key"], "duplicate_preserve_policy")
        self.assertEqual(gate["stages"][0]["status"], "complete")
        self.assertEqual(gate["first_blocking_stage"], "extraction_lane_readiness")
        self.assertIn("pending extraction lanes remain", gate["stages"][1]["blockers"])
        self.assertEqual(gate["stages"][6]["key"], "llm_provider_readiness")
        self.assertEqual(gate["stages"][6]["status"], "blocked")
        self.assertIn("LLM provider readiness status is not ok", gate["stages"][6]["blockers"])
        self.assertEqual(len(gate["source_artifacts"]), 10)
        self.assertTrue(all(item["present"] for item in gate["source_artifacts"]))
        self.assertTrue(all(len(item["sha256"]) == 64 for item in gate["source_artifacts"]))
        self.assertNotIn('"file_id"', proc.stdout)
        self.assertNotIn("s3://", proc.stdout)

    def test_ready_gate_approves_scale_when_all_stages_complete(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            paths = write_inputs(Path(tmp), ready=True)
            proc = run_script(
                "--extraction-readiness-gate", str(paths["extraction"]),
                "--extraction-readiness-verification", str(paths["extraction_verification"]),
                "--deferred-media-summary", str(paths["media"]),
                "--search-index-runtime-summary", str(paths["search"]),
                "--llm-provider-readiness", str(paths["provider"]),
                "--llm-campaign-results-summary", str(paths["llm"]),
                "--duplicate-preserve-attestation", str(paths["duplicate"]),
                "--extraction-approval-dashboard", str(paths["dashboard"]),
                "--drive-approval-notes-summary", str(paths["drive_notes"]),
                "--drive-approval-notes-verification", str(paths["drive_notes_verification"]),
                "--output", str(paths["output"]),
            )

        self.assertEqual(proc.returncode, 0, proc.stderr)
        gate = json.loads(proc.stdout)
        self.assertEqual(gate["status"], "ready_to_scale")
        self.assertTrue(gate["approved_to_scale"])
        self.assertIsNone(gate["first_blocking_stage"])
        self.assertTrue(all(item["complete"] for item in gate["stages"]))

    def test_provider_privacy_failure_blocks_scale(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            paths = write_inputs(Path(tmp), ready=True)
            provider = json.loads(paths["provider"].read_text(encoding="utf-8"))
            provider["direct_provider_policy_gate"]["checks"]["raw_extracts_not_sent"] = False
            write_json(paths["provider"], provider)
            proc = run_script(
                "--extraction-readiness-gate", str(paths["extraction"]),
                "--extraction-readiness-verification", str(paths["extraction_verification"]),
                "--deferred-media-summary", str(paths["media"]),
                "--search-index-runtime-summary", str(paths["search"]),
                "--llm-provider-readiness", str(paths["provider"]),
                "--llm-campaign-results-summary", str(paths["llm"]),
                "--duplicate-preserve-attestation", str(paths["duplicate"]),
                "--extraction-approval-dashboard", str(paths["dashboard"]),
                "--drive-approval-notes-summary", str(paths["drive_notes"]),
                "--drive-approval-notes-verification", str(paths["drive_notes_verification"]),
                "--output", str(paths["output"]),
            )

        self.assertEqual(proc.returncode, 0, proc.stderr)
        gate = json.loads(proc.stdout)
        provider_stage = next(item for item in gate["stages"] if item["key"] == "llm_provider_readiness")
        self.assertEqual(gate["status"], "blocked")
        self.assertFalse(gate["approved_to_scale"])
        self.assertEqual(provider_stage["status"], "blocked")
        self.assertIn("LLM provider privacy policy gate is not ok", provider_stage["blockers"])

    def test_zero_usable_smoke_blocks_extraction_stage(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            paths = write_inputs(Path(tmp), ready=True)
            extraction = json.loads(paths["extraction"].read_text(encoding="utf-8"))
            extraction["status"] = "blocked"
            extraction["gate"]["full_extraction_complete"] = False
            extraction["gate"]["all_sampled_non_deferred_non_approval_lanes_have_usable_output"] = False
            extraction["gate"]["sampled_no_usable_lanes"] = ["metadata_only_or_unknown"]
            extraction["totals"]["hard_blocker_lanes"] = 1
            extraction["totals"]["sampled_no_usable_lanes"] = 1
            extraction["status_counts"] = {"ready": 8, "sampled_no_usable_output": 1}
            write_json(paths["extraction"], extraction)
            proc = run_script(
                "--extraction-readiness-gate", str(paths["extraction"]),
                "--extraction-readiness-verification", str(paths["extraction_verification"]),
                "--deferred-media-summary", str(paths["media"]),
                "--search-index-runtime-summary", str(paths["search"]),
                "--llm-provider-readiness", str(paths["provider"]),
                "--llm-campaign-results-summary", str(paths["llm"]),
                "--duplicate-preserve-attestation", str(paths["duplicate"]),
                "--extraction-approval-dashboard", str(paths["dashboard"]),
                "--drive-approval-notes-summary", str(paths["drive_notes"]),
                "--drive-approval-notes-verification", str(paths["drive_notes_verification"]),
                "--output", str(paths["output"]),
            )

        self.assertEqual(proc.returncode, 0, proc.stderr)
        gate = json.loads(proc.stdout)
        extraction_stage = next(item for item in gate["stages"] if item["key"] == "extraction_lane_readiness")
        self.assertEqual(gate["first_blocking_stage"], "extraction_lane_readiness")
        self.assertEqual(extraction_stage["status"], "blocked")
        self.assertIn("sampled lanes produced no usable extraction output", extraction_stage["blockers"])
        self.assertEqual(extraction_stage["evidence"]["sampled_no_usable_lanes"], 1)
        self.assertFalse(extraction_stage["evidence"]["all_sampled_non_deferred_non_approval_lanes_have_usable_output"])

    def test_stale_extraction_verification_blocks_ready_scale(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            paths = write_inputs(Path(tmp), ready=True)
            verification = json.loads(paths["extraction_verification"].read_text(encoding="utf-8"))
            verification["checks"]["semantic_projection_current"] = False
            write_json(paths["extraction_verification"], verification)
            proc = run_script(
                "--extraction-readiness-gate", str(paths["extraction"]),
                "--extraction-readiness-verification", str(paths["extraction_verification"]),
                "--deferred-media-summary", str(paths["media"]),
                "--search-index-runtime-summary", str(paths["search"]),
                "--llm-provider-readiness", str(paths["provider"]),
                "--llm-campaign-results-summary", str(paths["llm"]),
                "--duplicate-preserve-attestation", str(paths["duplicate"]),
                "--extraction-approval-dashboard", str(paths["dashboard"]),
                "--drive-approval-notes-summary", str(paths["drive_notes"]),
                "--drive-approval-notes-verification", str(paths["drive_notes_verification"]),
                "--output", str(paths["output"]),
            )

        self.assertEqual(proc.returncode, 0, proc.stderr)
        gate = json.loads(proc.stdout)
        extraction_stage = next(item for item in gate["stages"] if item["key"] == "extraction_lane_readiness")
        self.assertEqual(gate["status"], "blocked")
        self.assertFalse(gate["approved_to_scale"])
        self.assertEqual(extraction_stage["status"], "blocked")
        self.assertIn("extraction lane readiness semantic projection is not current", extraction_stage["blockers"])


if __name__ == "__main__":
    unittest.main()
