#!/usr/bin/env python3
"""Offline tests for replacement readiness gate verification."""

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
SCRIPT = SCRIPT_DIR / "verify_replacement_readiness_gate.py"


def load_module():
    if str(SCRIPT_DIR) not in sys.path:
        sys.path.insert(0, str(SCRIPT_DIR))
    spec = importlib.util.spec_from_file_location("verify_replacement_readiness_gate", SCRIPT)
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
        {"label": label, "present": True, "bytes": 10, "sha256": "a" * 64}
        for label in (
            "stage_dependency_gate",
            "extraction_readiness_gate",
            "extraction_readiness_verification",
            "deferred_media_summary",
            "extraction_approval_dashboard",
            "approval_notes_summary",
            "drive_approval_notes_summary",
            "drive_approval_notes_verification",
            "operator_approval_blocker_report",
            "search_index_runtime_summary",
            "llm_campaign_results_summary",
            "adversarial_review_results",
        )
    ]


def source_artifacts_from_paths(source_paths: dict[str, Path]) -> list[dict[str, object]]:
    artifacts: list[dict[str, object]] = []
    for label in (
        "stage_dependency_gate",
        "extraction_readiness_gate",
        "extraction_readiness_verification",
        "deferred_media_summary",
        "extraction_approval_dashboard",
        "approval_notes_summary",
        "drive_approval_notes_summary",
        "drive_approval_notes_verification",
        "operator_approval_blocker_report",
        "search_index_runtime_summary",
        "llm_campaign_results_summary",
        "adversarial_review_results",
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


def write_source_files(root: Path) -> dict[str, Path]:
    source_paths: dict[str, Path] = {}
    for label in (
        "stage_dependency_gate",
        "extraction_readiness_gate",
        "extraction_readiness_verification",
        "deferred_media_summary",
        "extraction_approval_dashboard",
        "approval_notes_summary",
        "drive_approval_notes_summary",
        "drive_approval_notes_verification",
        "operator_approval_blocker_report",
        "search_index_runtime_summary",
        "llm_campaign_results_summary",
        "adversarial_review_results",
    ):
        path = root / f"{label}.json"
        path.write_text(json.dumps({"label": label, "aggregate": True}, sort_keys=True), encoding="utf-8")
        source_paths[label] = path
    return source_paths


def req(key: str, status: str, evidence: dict[str, object], blockers: list[str] | None = None) -> dict[str, object]:
    return {
        "key": key,
        "title": key.replace("_", " "),
        "status": status,
        "complete": status == "complete",
        "blockers": [] if blockers is None else blockers,
        "evidence": evidence,
    }


def extraction_verification_evidence(status: str) -> dict[str, object]:
    return {
        "status": status,
        "verification_present": True,
        "verification_status": "ok",
        "verification_gate_status": status,
        "verification_source_artifacts_present": True,
        "verification_source_artifacts_current": True,
        "verification_semantic_projection_current": True,
        "verification_redaction_ok": True,
        "verification_current_checked": True,
        "verification_current_mismatched": 0,
        "verification_current_missing_paths": 0,
        "verification_ok": True,
    }


def blocked_gate() -> dict[str, object]:
    requirements = [
        req(
            "active_file_mapping",
            "complete",
            {
                "active_files": 10,
                "all_active_lanes_explicitly_routed": True,
                "all_expected_lanes_present": True,
                **extraction_verification_evidence("pending_completion"),
            },
        ),
        req("immutable_bytes_duplicate_preserve", "complete", {"policy_ok": True}),
        req(
            "read_extraction_coverage",
            "blocked",
            {
                "pending_lanes": 3,
                "hard_blocker_lanes": 0,
                **extraction_verification_evidence("pending_completion"),
            },
            ["pending extraction lanes remain"],
        ),
        req(
            "deferred_media_completion",
            "deferred",
            {"unresolved_media_files": 2, "final_media_pass_required": True},
            ["final media transcription/keyframe pass remains unresolved"],
        ),
        req(
            "operator_approval_gates",
            "blocked",
            {
                "approval_items": 5,
                "approved_approval_notes": 0,
                "approval_notes_status": "missing_required",
                "drive_approval_notes_status": "missing_required",
                "drive_approval_notes_verification_status": "ok",
                "drive_required_decision_count": 14,
                "drive_approved_required_decision_count": 0,
                "drive_missing_required_decisions": 14,
                "drive_invalid_required_decisions": 0,
            },
            ["validated operator approval notes are incomplete", "validated Drive approval notes are incomplete"],
        ),
        req(
            "files_cli_search_index",
            "blocked",
            {"scale_readiness_status": "pending_canary", "remaining_jobs": 10, "full_run_verified": False},
            ["search-index canary/full population and runtime attestation are incomplete"],
        ),
        req(
            "semantic_rename_readiness",
            "blocked",
            {
                "rename_gate_status": "pending",
                "metadata_apply_ready": False,
                "runtime_attestation_gate_status": "pending",
            },
            ["semantic rename proposals, correctness gate, or runtime attestation are incomplete"],
        ),
        req(
            "metadata_apply_readiness",
            "blocked",
            {"metadata_apply_ready": False},
            ["metadata apply is not ready and still requires reviewed proposals"],
        ),
        req(
            "adversarial_validation",
            "blocked",
            {
                "approved_to_scale": False,
                "reviewers_present": 2,
                "blockers": 3,
                "present": True,
                "freshness_all_input_attestations_match": True,
            },
            ["two adversarial reviewers have not approved scale-up without blockers"],
        ),
    ]
    return {
        "kind": "open_files_google_drive_replacement_readiness_gate",
        "version": 1,
        "status": "blocked",
        "approved_to_replace_google_drive": False,
        "source_artifacts": source_artifacts(),
        "summary": {
            "requirements": 9,
            "complete": 2,
            "blocked": 6,
            "deferred": 1,
            "missing": 0,
            "first_incomplete_requirement": "read_extraction_coverage",
        },
        "requirements": requirements,
        "redaction": "aggregate-only",
    }


def ready_gate() -> dict[str, object]:
    gate = blocked_gate()
    ready_requirements = [
        req(
            "active_file_mapping",
            "complete",
            {
                "active_files": 10,
                "all_active_lanes_explicitly_routed": True,
                **extraction_verification_evidence("ready"),
            },
        ),
        req("immutable_bytes_duplicate_preserve", "complete", {"policy_ok": True}),
        req(
            "read_extraction_coverage",
            "complete",
            {
                "pending_lanes": 0,
                "hard_blocker_lanes": 0,
                **extraction_verification_evidence("ready"),
            },
        ),
        req("deferred_media_completion", "complete", {"unresolved_media_files": 0}),
        req(
            "operator_approval_gates",
            "complete",
            {
                "approval_items": 5,
                "approved_approval_notes": 5,
                "approval_notes_status": "complete",
                "drive_approval_notes_status": "approved",
                "drive_approval_notes_verification_status": "ok",
                "drive_required_decision_count": 14,
                "drive_approved_required_decision_count": 14,
                "drive_missing_required_decisions": 0,
                "drive_invalid_required_decisions": 0,
            },
        ),
        req(
            "files_cli_search_index",
            "complete",
            {"scale_readiness_status": "full_run_verified", "remaining_jobs": 0, "full_run_verified": True},
        ),
        req(
            "semantic_rename_readiness",
            "complete",
            {
                "rename_gate_status": "ok",
                "metadata_apply_ready": True,
                "runtime_attestation_gate_status": "ok",
            },
        ),
        req("metadata_apply_readiness", "complete", {"metadata_apply_ready": True}),
        req(
            "adversarial_validation",
            "complete",
            {
                "approved_to_scale": True,
                "reviewers_present": 2,
                "blockers": 0,
                "present": True,
                "freshness_all_input_attestations_match": True,
            },
        ),
    ]
    gate.update(
        {
            "status": "ready",
            "approved_to_replace_google_drive": True,
            "summary": {
                "requirements": 9,
                "complete": 9,
                "blocked": 0,
                "deferred": 0,
                "missing": 0,
                "first_incomplete_requirement": None,
            },
            "requirements": ready_requirements,
        }
    )
    return gate


class VerifyReplacementReadinessGateTests(unittest.TestCase):
    def test_blocked_gate_can_be_valid_without_being_ready(self) -> None:
        verifier = load_module()
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "gate.json"
            path.write_text(json.dumps(blocked_gate()), encoding="utf-8")
            result = verifier.verify_gate(path)

        self.assertEqual(result["status"], "ok")
        self.assertEqual(result["gate_status"], "blocked")
        self.assertFalse(result["approved_to_replace_google_drive"])
        self.assertFalse(result["gates"]["replacement_ready"])
        self.assertEqual(result["summary"]["first_incomplete_requirement"], "read_extraction_coverage")
        self.assertEqual(result["errors"], [])

    def test_require_ready_fails_for_valid_blocked_gate(self) -> None:
        verifier = load_module()
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "gate.json"
            path.write_text(json.dumps(blocked_gate()), encoding="utf-8")
            result = verifier.verify_gate(path, require_ready=True)

        self.assertEqual(result["status"], "error")
        self.assertIn("require_ready_not_satisfied", result["errors"])

    def test_ready_gate_passes_require_ready(self) -> None:
        verifier = load_module()
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "gate.json"
            path.write_text(json.dumps(ready_gate()), encoding="utf-8")
            result = verifier.verify_gate(path, require_ready=True)

        self.assertEqual(result["status"], "ok")
        self.assertTrue(result["gates"]["replacement_ready"])
        self.assertEqual(result["summary"]["complete"], 9)

    def test_stale_adversarial_freshness_fails(self) -> None:
        verifier = load_module()
        gate = blocked_gate()
        adversarial = next(item for item in gate["requirements"] if item["key"] == "adversarial_validation")
        adversarial["evidence"]["freshness_all_input_attestations_match"] = False
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "gate.json"
            path.write_text(json.dumps(gate), encoding="utf-8")
            result = verifier.verify_gate(path)

        self.assertEqual(result["status"], "error")
        self.assertIn("adversarial_present_without_fresh_input_attestations", result["errors"])

    def test_current_source_artifact_hashes_are_verified_when_paths_are_supplied(self) -> None:
        verifier = load_module()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source_paths = write_source_files(root)
            gate = blocked_gate()
            gate["source_artifacts"] = source_artifacts_from_paths(source_paths)
            path = root / "gate.json"
            path.write_text(json.dumps(gate), encoding="utf-8")
            result = verifier.verify_gate(
                path,
                source_paths=source_paths,
                allow_cyclic_source_labels={"operator_approval_blocker_report"},
            )

        self.assertEqual(result["status"], "ok")
        self.assertTrue(result["gates"]["source_artifact_current_hashes_ok"])
        self.assertTrue(result["source_artifacts"]["current_checked"])
        self.assertEqual(result["source_artifacts"]["current_mismatched"], [])

    def test_stale_non_cyclic_source_artifact_fails_current_hash_check(self) -> None:
        verifier = load_module()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source_paths = write_source_files(root)
            gate = blocked_gate()
            gate["source_artifacts"] = source_artifacts_from_paths(source_paths)
            source_paths["stage_dependency_gate"].write_text(
                json.dumps({"label": "stage_dependency_gate", "aggregate": True, "changed": True}),
                encoding="utf-8",
            )
            path = root / "gate.json"
            path.write_text(json.dumps(gate), encoding="utf-8")
            result = verifier.verify_gate(
                path,
                source_paths=source_paths,
                allow_cyclic_source_labels={"operator_approval_blocker_report"},
            )

        self.assertEqual(result["status"], "error")
        self.assertFalse(result["gates"]["source_artifact_current_hashes_ok"])
        self.assertIn("source_artifact_current_sha256_mismatch:stage_dependency_gate", result["errors"])
        self.assertIn("stage_dependency_gate", result["source_artifacts"]["current_mismatched"])

    def test_missing_non_cyclic_source_artifact_path_fails_current_hash_check(self) -> None:
        verifier = load_module()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source_paths = write_source_files(root)
            gate = blocked_gate()
            gate["source_artifacts"] = source_artifacts_from_paths(source_paths)
            source_paths["stage_dependency_gate"].unlink()
            path = root / "gate.json"
            path.write_text(json.dumps(gate), encoding="utf-8")
            result = verifier.verify_gate(
                path,
                source_paths=source_paths,
                allow_cyclic_source_labels={"operator_approval_blocker_report"},
            )

        self.assertEqual(result["status"], "error")
        self.assertFalse(result["gates"]["source_artifact_current_hashes_ok"])
        self.assertIn("source_artifact_current_path_missing:stage_dependency_gate", result["errors"])
        self.assertIn("stage_dependency_gate", result["source_artifacts"]["current_missing_paths"])

    def test_stale_cyclic_source_artifact_warns_without_failing_current_hash_check(self) -> None:
        verifier = load_module()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source_paths = write_source_files(root)
            gate = blocked_gate()
            gate["source_artifacts"] = source_artifacts_from_paths(source_paths)
            source_paths["operator_approval_blocker_report"].write_text(
                json.dumps({"label": "operator_approval_blocker_report", "aggregate": True, "changed": True}),
                encoding="utf-8",
            )
            path = root / "gate.json"
            path.write_text(json.dumps(gate), encoding="utf-8")
            result = verifier.verify_gate(
                path,
                source_paths=source_paths,
                allow_cyclic_source_labels={"operator_approval_blocker_report"},
            )

        self.assertEqual(result["status"], "ok")
        self.assertTrue(result["gates"]["source_artifact_current_hashes_ok"])
        self.assertIn("cyclic_source_artifact_stale:operator_approval_blocker_report", result["warnings"])
        self.assertEqual(result["source_artifacts"]["cyclic_allowed_stale"], ["operator_approval_blocker_report"])

    def test_stale_adversarial_review_results_warns_as_cyclic_source(self) -> None:
        verifier = load_module()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source_paths = write_source_files(root)
            gate = blocked_gate()
            gate["source_artifacts"] = source_artifacts_from_paths(source_paths)
            source_paths["adversarial_review_results"].write_text(
                json.dumps({"label": "adversarial_review_results", "aggregate": True, "changed": True}),
                encoding="utf-8",
            )
            path = root / "gate.json"
            path.write_text(json.dumps(gate), encoding="utf-8")
            result = verifier.verify_gate(
                path,
                source_paths=source_paths,
                allow_cyclic_source_labels={"adversarial_review_results"},
            )

        self.assertEqual(result["status"], "ok")
        self.assertTrue(result["gates"]["source_artifact_current_hashes_ok"])
        self.assertIn("cyclic_source_artifact_stale:adversarial_review_results", result["warnings"])
        self.assertEqual(result["source_artifacts"]["cyclic_allowed_stale"], ["adversarial_review_results"])

    def test_cli_fails_on_sensitive_marker_without_echoing_private_value(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            gate = blocked_gate()
            gate["private_metadata"] = {"file_id": "f_privateSecret123"}
            gate_path = root / "gate.json"
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
