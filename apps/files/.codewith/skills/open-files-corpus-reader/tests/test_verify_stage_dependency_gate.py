#!/usr/bin/env python3
"""Offline tests for stage dependency gate verification."""

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
SCRIPT = SCRIPT_DIR / "verify_stage_dependency_gate.py"


def load_module():
    if str(SCRIPT_DIR) not in sys.path:
        sys.path.insert(0, str(SCRIPT_DIR))
    spec = importlib.util.spec_from_file_location("verify_stage_dependency_gate", SCRIPT)
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
    return [
        {"label": label, "present": True, "bytes": 10, "sha256": "b" * 64}
        for label in (
            "extraction_readiness_gate",
            "extraction_readiness_verification",
            "deferred_media_summary",
            "search_index_runtime_summary",
            "llm_provider_readiness",
            "llm_campaign_results_summary",
            "duplicate_preserve_attestation",
            "extraction_approval_dashboard",
            "drive_approval_notes_summary",
            "drive_approval_notes_verification",
        )
    ]


def write_source_files(root: Path) -> dict[str, Path]:
    source_paths: dict[str, Path] = {}
    for label in (
        "extraction_readiness_gate",
        "extraction_readiness_verification",
        "deferred_media_summary",
        "search_index_runtime_summary",
        "llm_provider_readiness",
        "llm_campaign_results_summary",
        "duplicate_preserve_attestation",
        "extraction_approval_dashboard",
        "drive_approval_notes_summary",
        "drive_approval_notes_verification",
    ):
        path = root / f"{label}.json"
        path.write_text(json.dumps({"label": label, "aggregate": True}, sort_keys=True), encoding="utf-8")
        source_paths[label] = path
    return source_paths


def source_artifacts_from_paths(source_paths: dict[str, Path]) -> list[dict[str, object]]:
    artifacts: list[dict[str, object]] = []
    for label in (
        "extraction_readiness_gate",
        "extraction_readiness_verification",
        "deferred_media_summary",
        "search_index_runtime_summary",
        "llm_provider_readiness",
        "llm_campaign_results_summary",
        "duplicate_preserve_attestation",
        "extraction_approval_dashboard",
        "drive_approval_notes_summary",
        "drive_approval_notes_verification",
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
    return artifacts


def stage(
    key: str,
    order: int,
    status: str,
    evidence: dict[str, object],
    blockers: list[str] | None = None,
    *,
    deferred: bool = False,
) -> dict[str, object]:
    return {
        "key": key,
        "order": order,
        "status": status,
        "complete": status == "complete",
        "required_for_scale": True,
        "deferred_until_final_pass": deferred,
        "blockers": [] if blockers is None else blockers,
        "evidence": evidence,
    }


def scale_rules() -> dict[str, bool]:
    return {
        "requires_duplicate_policy_attested": True,
        "requires_extraction_lanes_complete": True,
        "requires_final_media_pass_for_full_replacement": True,
        "requires_operator_approval_items_resolved": True,
        "requires_search_index_canary_and_full_population": True,
        "requires_llm_provider_readiness": True,
        "requires_llm_rename_canary_full_campaign_and_runtime_attestation": True,
        "requires_metadata_apply_after_review_only": True,
    }


def blocked_gate() -> dict[str, object]:
    stages = [
        stage("duplicate_preserve_policy", 10, "complete", {"policy_ok": True}),
        stage(
            "extraction_lane_readiness",
            20,
            "blocked",
            {
                "full_extraction_complete": False,
                "pending_lanes": 3,
                "hard_blocker_lanes": 0,
                "sampled_no_usable_lanes": 0,
                "requires_provider_or_tool_work": True,
                "final_media_pass_required": True,
                "verification_present": True,
                "verification_status": "ok",
                "verification_gate_status": "pending_completion",
                "verification_source_artifacts_present": True,
                "verification_source_artifacts_current": True,
                "verification_semantic_projection_current": True,
                "verification_redaction_ok": True,
                "verification_current_checked": True,
                "verification_current_mismatched": 0,
                "verification_current_missing_paths": 0,
                "verification_ok": True,
                "status": "pending_completion",
            },
            ["pending extraction lanes remain"],
        ),
        stage(
            "deferred_media_final_pass",
            30,
            "deferred",
            {
                "unresolved_media_files": 2,
                "completion_gate_complete": False,
                "final_media_pass_required": True,
            },
            ["final media transcription/keyframe pass required"],
            deferred=True,
        ),
        stage(
            "operator_approval_dashboard",
            40,
            "blocked",
            {
                "approval_notes_complete": False,
                "approved_approval_notes": 0,
                "approval_items": 5,
                "blocked_or_missing_prep_items": 0,
                "drive_approval_notes_status": "missing_required",
                "drive_approval_notes_verification_status": "ok",
                "drive_required_decision_count": 14,
                "drive_approved_required_decision_count": 0,
                "drive_missing_required_decisions": 14,
                "drive_invalid_required_decisions": 0,
            },
            ["operator approval items remain", "validated Drive approval notes are incomplete"],
        ),
        stage(
            "search_index_canary",
            50,
            "blocked",
            {
                "runtime_attestation_status": "not_executed",
                "canary_verified": False,
                "scale_readiness_status": "pending_canary",
                "search_probe_status": "not_executed",
                "search_probe_probes": 0,
                "search_probe_latency_budget_ms": None,
                "search_probe_max_latency_ms": None,
            },
            ["search-index canary is not verified", "search-index CLI search probe is not ok"],
        ),
        stage(
            "search_index_full_population",
            60,
            "blocked",
            {
                "full_run_verified": False,
                "remaining_jobs": 10,
                "scale_readiness_status": "pending_canary",
                "search_probe_status": "not_executed",
                "search_probe_probes": 0,
                "search_probe_latency_budget_ms": None,
                "search_probe_max_latency_ms": None,
            },
            ["search-index full run is not verified", "search-index CLI search probe is not ok"],
        ),
        stage(
            "llm_provider_readiness",
            70,
            "complete",
            {
                "status": "ok",
                "policy_status": "ok",
                "schedule_status": "ok",
                "invalid_account_count": 0,
                "provider_calls_made": False,
                "corpus_bytes_mutated": False,
                "s3_objects_mutated": False,
                "metadata_rows_mutated": False,
                "search_index_rows_mutated": False,
                "redaction_passed": True,
            },
        ),
        stage(
            "llm_rename_canary",
            80,
            "blocked",
            {
                "status": "not_started",
                "canary_verified": False,
                "scale_readiness_status": "pending_canary",
                "rename_gate_status": "pending",
                "runtime_attestation_gate_status": "pending",
            },
            ["LLM rename canary is not verified"],
        ),
        stage(
            "llm_rename_full_campaign",
            90,
            "blocked",
            {"full_run_verified": False, "remaining_jobs": 1},
            ["LLM rename full campaign is not verified"],
        ),
        stage(
            "metadata_apply_readiness",
            100,
            "blocked",
            {"metadata_apply_ready": False},
            ["metadata apply is not ready and still requires reviewed proposals"],
        ),
    ]
    return {
        "kind": "open_files_stage_dependency_gate",
        "version": 1,
        "status": "blocked",
        "approved_to_scale": False,
        "current_stage_order": 20,
        "first_blocking_stage": "extraction_lane_readiness",
        "blocking_stage_count": 8,
        "hard_blocking_stage_count": 7,
        "deferred_stage_count": 1,
        "scale_rules": scale_rules(),
        "source_artifacts": source_artifacts(),
        "stages": stages,
        "redaction": "aggregate-only",
    }


def ready_gate() -> dict[str, object]:
    gate = blocked_gate()
    gate["status"] = "ready_to_scale"
    gate["approved_to_scale"] = True
    gate["current_stage_order"] = None
    gate["first_blocking_stage"] = None
    gate["blocking_stage_count"] = 0
    gate["hard_blocking_stage_count"] = 0
    gate["deferred_stage_count"] = 0
    ready_stages = [
        stage("duplicate_preserve_policy", 10, "complete", {"policy_ok": True}),
        stage(
            "extraction_lane_readiness",
            20,
            "complete",
            {
                "full_extraction_complete": True,
                "pending_lanes": 0,
                "hard_blocker_lanes": 0,
                "sampled_no_usable_lanes": 0,
                "requires_provider_or_tool_work": False,
                "final_media_pass_required": False,
                "verification_present": True,
                "verification_status": "ok",
                "verification_gate_status": "ready",
                "verification_source_artifacts_present": True,
                "verification_source_artifacts_current": True,
                "verification_semantic_projection_current": True,
                "verification_redaction_ok": True,
                "verification_current_checked": True,
                "verification_current_mismatched": 0,
                "verification_current_missing_paths": 0,
                "verification_ok": True,
                "status": "ready",
            },
        ),
        stage(
            "deferred_media_final_pass",
            30,
            "complete",
            {"unresolved_media_files": 0, "completion_gate_complete": True},
        ),
        stage(
            "operator_approval_dashboard",
            40,
            "complete",
            {
                "approval_notes_complete": True,
                "approved_approval_notes": 5,
                "approval_items": 5,
                "blocked_or_missing_prep_items": 0,
                "drive_approval_notes_status": "approved",
                "drive_approval_notes_verification_status": "ok",
                "drive_required_decision_count": 14,
                "drive_approved_required_decision_count": 14,
                "drive_missing_required_decisions": 0,
                "drive_invalid_required_decisions": 0,
            },
        ),
        stage(
            "search_index_canary",
            50,
            "complete",
            {
                "runtime_attestation_status": "ok",
                "canary_verified": True,
                "scale_readiness_status": "canary_verified",
                "search_probe_status": "ok",
                "search_probe_probes": 5,
                "search_probe_latency_budget_ms": 1000,
                "search_probe_max_latency_ms": 120,
            },
        ),
        stage(
            "search_index_full_population",
            60,
            "complete",
            {
                "full_run_verified": True,
                "remaining_jobs": 0,
                "scale_readiness_status": "full_verified",
                "search_probe_status": "ok",
                "search_probe_probes": 5,
                "search_probe_latency_budget_ms": 1000,
                "search_probe_max_latency_ms": 120,
            },
        ),
        stage(
            "llm_provider_readiness",
            70,
            "complete",
            {
                "status": "ok",
                "policy_status": "ok",
                "schedule_status": "ok",
                "invalid_account_count": 0,
                "provider_calls_made": False,
                "corpus_bytes_mutated": False,
                "s3_objects_mutated": False,
                "metadata_rows_mutated": False,
                "search_index_rows_mutated": False,
                "redaction_passed": True,
            },
        ),
        stage(
            "llm_rename_canary",
            80,
            "complete",
            {
                "status": "complete",
                "canary_verified": True,
                "scale_readiness_status": "canary_verified",
                "rename_gate_status": "ok",
                "runtime_attestation_gate_status": "ok",
            },
        ),
        stage(
            "llm_rename_full_campaign",
            90,
            "complete",
            {"full_run_verified": True, "remaining_jobs": 0},
        ),
        stage("metadata_apply_readiness", 100, "complete", {"metadata_apply_ready": True}),
    ]
    gate["stages"] = ready_stages
    return gate


class VerifyStageDependencyGateTests(unittest.TestCase):
    def test_blocked_gate_can_be_valid_without_scale_approval(self) -> None:
        verifier = load_module()
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "stage.json"
            path.write_text(json.dumps(blocked_gate()), encoding="utf-8")
            result = verifier.verify_gate(path)

        self.assertEqual(result["status"], "ok")
        self.assertEqual(result["gate_status"], "blocked")
        self.assertFalse(result["approved_to_scale"])
        self.assertFalse(result["gates"]["scale_ready"])
        self.assertEqual(result["summary"]["first_blocking_stage"], "extraction_lane_readiness")
        self.assertEqual(result["summary"]["llm_rename_canary_stage_status"], "blocked")
        self.assertEqual(result["summary"]["llm_rename_campaign_status"], "not_started")
        self.assertEqual(result["summary"]["llm_rename_scale_readiness_status"], "pending_canary")
        self.assertEqual(result["summary"]["llm_rename_gate_status"], "pending")
        self.assertEqual(result["summary"]["llm_rename_runtime_attestation_gate_status"], "pending")
        self.assertFalse(result["summary"]["metadata_apply_ready"])
        self.assertEqual(result["errors"], [])

    def test_require_ready_fails_for_valid_blocked_gate(self) -> None:
        verifier = load_module()
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "stage.json"
            path.write_text(json.dumps(blocked_gate()), encoding="utf-8")
            result = verifier.verify_gate(path, require_ready=True)

        self.assertEqual(result["status"], "error")
        self.assertIn("require_ready_not_satisfied", result["errors"])

    def test_ready_gate_passes_require_ready(self) -> None:
        verifier = load_module()
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "stage.json"
            path.write_text(json.dumps(ready_gate()), encoding="utf-8")
            result = verifier.verify_gate(path, require_ready=True)

        self.assertEqual(result["status"], "ok")
        self.assertTrue(result["gates"]["scale_ready"])
        self.assertEqual(result["summary"]["blocking_stage_count"], 0)
        self.assertEqual(result["summary"]["search_index_search_probe_status"], "ok")
        self.assertEqual(result["summary"]["llm_rename_canary_stage_status"], "complete")
        self.assertEqual(result["summary"]["llm_rename_campaign_status"], "complete")
        self.assertEqual(result["summary"]["llm_rename_scale_readiness_status"], "canary_verified")
        self.assertEqual(result["summary"]["llm_rename_gate_status"], "ok")
        self.assertEqual(result["summary"]["llm_rename_runtime_attestation_gate_status"], "ok")
        self.assertTrue(result["summary"]["metadata_apply_ready"])

    def test_complete_search_index_without_probe_fails(self) -> None:
        verifier = load_module()
        gate = ready_gate()
        search_canary = next(item for item in gate["stages"] if item["key"] == "search_index_canary")
        search_canary["evidence"]["search_probe_status"] = "not_executed"
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "stage.json"
            path.write_text(json.dumps(gate), encoding="utf-8")
            result = verifier.verify_gate(path, require_ready=True)

        self.assertEqual(result["status"], "error")
        self.assertIn("search_canary_complete_without_search_probe_ok", result["errors"])

    def test_inconsistent_first_blocker_and_counts_fail(self) -> None:
        verifier = load_module()
        gate = blocked_gate()
        gate["first_blocking_stage"] = "search_index_canary"
        gate["blocking_stage_count"] = 1
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "stage.json"
            path.write_text(json.dumps(gate), encoding="utf-8")
            result = verifier.verify_gate(path)

        self.assertEqual(result["status"], "error")
        self.assertIn("first_blocking_stage_inconsistent", result["errors"])
        self.assertIn("blocking_stage_count_inconsistent", result["errors"])

    def test_current_source_artifact_hashes_are_verified_when_paths_are_supplied(self) -> None:
        verifier = load_module()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source_paths = write_source_files(root)
            gate = blocked_gate()
            gate["source_artifacts"] = source_artifacts_from_paths(source_paths)
            path = root / "stage.json"
            path.write_text(json.dumps(gate), encoding="utf-8")
            result = verifier.verify_gate(path, source_paths=source_paths)

        self.assertEqual(result["status"], "ok")
        self.assertTrue(result["gates"]["source_artifact_current_hashes_ok"])
        self.assertTrue(result["source_artifacts"]["current_checked"])
        self.assertEqual(result["source_artifacts"]["current_mismatched"], [])

    def test_stale_current_source_artifact_fails_hash_check(self) -> None:
        verifier = load_module()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source_paths = write_source_files(root)
            gate = blocked_gate()
            gate["source_artifacts"] = source_artifacts_from_paths(source_paths)
            source_paths["llm_campaign_results_summary"].write_text(
                json.dumps({"label": "llm_campaign_results_summary", "aggregate": True, "changed": True}),
                encoding="utf-8",
            )
            path = root / "stage.json"
            path.write_text(json.dumps(gate), encoding="utf-8")
            result = verifier.verify_gate(path, source_paths=source_paths)

        self.assertEqual(result["status"], "error")
        self.assertFalse(result["gates"]["source_artifact_current_hashes_ok"])
        self.assertIn("source_artifact_current_sha256_mismatch:llm_campaign_results_summary", result["errors"])
        self.assertIn("llm_campaign_results_summary", result["source_artifacts"]["current_mismatched"])

    def test_missing_current_source_artifact_path_fails_hash_check(self) -> None:
        verifier = load_module()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source_paths = write_source_files(root)
            gate = blocked_gate()
            gate["source_artifacts"] = source_artifacts_from_paths(source_paths)
            source_paths["llm_campaign_results_summary"].unlink()
            path = root / "stage.json"
            path.write_text(json.dumps(gate), encoding="utf-8")
            result = verifier.verify_gate(path, source_paths=source_paths)

        self.assertEqual(result["status"], "error")
        self.assertFalse(result["gates"]["source_artifact_current_hashes_ok"])
        self.assertIn("source_artifact_current_path_missing:llm_campaign_results_summary", result["errors"])
        self.assertIn("llm_campaign_results_summary", result["source_artifacts"]["current_missing_paths"])

    def test_complete_extraction_without_current_verification_fails(self) -> None:
        verifier = load_module()
        gate = ready_gate()
        extraction = next(item for item in gate["stages"] if item["key"] == "extraction_lane_readiness")
        extraction["evidence"]["verification_source_artifacts_current"] = False
        extraction["evidence"]["verification_ok"] = False
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "stage.json"
            path.write_text(json.dumps(gate), encoding="utf-8")
            result = verifier.verify_gate(path, require_ready=True)

        self.assertEqual(result["status"], "error")
        self.assertIn("extraction_complete_without_verification_gate_ok", result["errors"])
        self.assertIn("extraction_complete_without_current_verification_sources", result["errors"])

    def test_cli_fails_on_sensitive_marker_without_echoing_private_value(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            gate = blocked_gate()
            gate["private_metadata"] = {"file_id": "f_privateSecret123"}
            gate_path = root / "stage.json"
            output = root / "verification.json"
            gate_path.write_text(json.dumps(gate), encoding="utf-8")

            proc = run_script("--gate", str(gate_path), "--output", str(output))
            result = json.loads(output.read_text(encoding="utf-8"))

        self.assertEqual(proc.returncode, 1)
        self.assertIn("sensitive_marker_hits", result["errors"])
        self.assertIn("json_file_id_key", result["sensitive_marker_counts"])
        self.assertNotIn("f_privateSecret123", proc.stdout)


if __name__ == "__main__":
    unittest.main()
