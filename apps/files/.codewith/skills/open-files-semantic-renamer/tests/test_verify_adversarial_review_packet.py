#!/usr/bin/env python3
"""Offline tests for adversarial review packet verification."""

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
SCRIPT = SCRIPT_DIR / "verify_adversarial_review_packet.py"


def load_module():
    if str(SCRIPT_DIR) not in sys.path:
        sys.path.insert(0, str(SCRIPT_DIR))
    spec = importlib.util.spec_from_file_location("verify_adversarial_review_packet", SCRIPT)
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


def write_review_files(root: Path, packet: dict) -> Path:
    packet_path = root / "adversarial-review-packet.json"
    packet_path.write_text(json.dumps(packet, indent=2, sort_keys=True), encoding="utf-8")
    for name in [
        "reviewer-final.schema.json",
        "reviewer-a-prompt.md",
        "reviewer-b-prompt.md",
        "reviewer-a-input-attestation.json",
        "reviewer-b-input-attestation.json",
        "reviewer-a-direct-prompt.md",
        "reviewer-b-direct-prompt.md",
    ]:
        (root / name).write_text("aggregate reviewer artifact\n", encoding="utf-8")
    return packet_path


def write_source_files(root: Path) -> dict[str, Path]:
    source_paths: dict[str, Path] = {}
    for label in ("approval_request_packet", "approval_request_packet_verification"):
        path = root / f"{label}.json"
        path.write_text(json.dumps({"label": label, "aggregate": True}, sort_keys=True), encoding="utf-8")
        source_paths[label] = path
    return source_paths


def update_source_artifacts_from_paths(packet: dict, source_paths: dict[str, Path]) -> None:
    for entry in packet["source_artifact_checks"]:
        label = entry["label"]
        path = source_paths.get(label)
        if path is None:
            continue
        entry["bytes"] = path.stat().st_size
        entry["sha256"] = hashlib.sha256(path.read_bytes()).hexdigest()


def egress_policy() -> dict:
    return {
        "mode": "provider-egress-allowlist",
        "deny_by_default": True,
        "provider": "spark",
        "provider_endpoint_hosts": ["api.openai.com"],
        "allowed_purposes": ["model_inference_only"],
        "arbitrary_url_fetch_allowed": False,
        "google_drive_access_allowed": False,
        "raw_file_bytes_allowed": False,
        "s3_object_access_allowed": False,
        "secret_values_in_payload_allowed": False,
        "provider_data_collection": "deny",
    }


def worker_runtime_policy() -> dict:
    return {
        "present": True,
        "status": "ok",
        "network_mode": "none",
        "network_disabled": True,
        "provider_egress_allowed": False,
        "arbitrary_url_fetch_allowed": False,
        "google_drive_access_allowed": False,
        "s3_object_access_allowed": False,
        "db_access_allowed": False,
        "corpus_mounts_allowed": False,
        "secret_env_allowed": False,
        "read_only_rootfs": True,
        "cap_drop_all": True,
        "no_new_privileges": True,
        "command_logs_hashed_only": True,
        "private_values_in_command": False,
    }


def valid_packet() -> dict:
    labels = [
        "search_index_approval_packet",
        "search_index_validation",
        "search_index_runtime_summary",
        "duplicate_preserve_attestation",
        "stage_dependency_gate",
        "stage_dependency_verification",
        "llm_campaign_plan",
        "llm_campaign_runtime_summary",
        "llm_provider_readiness",
        "llm_campaign_results_summary",
        "deferred_media_summary",
        "extraction_readiness_gate",
        "extraction_readiness_verification",
        "extraction_worker_image_verification",
        "extraction_approval_dashboard",
        "approval_request_packet",
        "approval_request_packet_verification",
        "replacement_readiness_gate",
        "locked_worker_bundle/bundle-summary.json",
        "locked_worker_bundle/command.json",
        "locked_worker_bundle/environment-policy.json",
        "locked_worker_bundle/bundle-integrity.json",
        "locked_worker_bundle/locked-worker-bundle-verification.json",
        "locked_worker_bundle/prompt.md",
        "locked_worker_bundle/run-worker.sh",
    ]
    return {
        "kind": "open_files_adversarial_review_packet",
        "current_state": {
            "canonical_s3_keys_immutable": True,
            "metadata_only_organization": True,
            "legacy_sources_preserved_until_final_audit": True,
            "audio_video_deferred_until_end": True,
            "scaled_agent_execution_requires_approval": True,
        },
        "artifacts": {
            "stage_dependency_gate": {
                "present": True,
                "status": "blocked",
                "approved_to_scale": False,
                "first_blocking_stage": "extraction_lane_readiness",
                "blocking_stage_count": 8,
                "hard_blocking_stage_count": 7,
                "deferred_stage_count": 1,
                "scale_rules": {
                    "requires_duplicate_policy_attested": True,
                    "requires_extraction_lanes_complete": True,
                    "requires_final_media_pass_for_full_replacement": True,
                    "requires_operator_approval_items_resolved": True,
                    "requires_search_index_canary_and_full_population": True,
                    "requires_llm_provider_readiness": True,
                    "requires_llm_rename_canary_full_campaign_and_runtime_attestation": True,
                    "requires_metadata_apply_after_review_only": True,
                },
                "stages": [
                    {
                        "key": "duplicate_preserve_policy",
                        "order": 10,
                        "status": "complete",
                        "complete": True,
                        "required_for_scale": True,
                        "deferred_until_final_pass": False,
                        "blockers": [],
                    },
                    {
                        "key": "extraction_lane_readiness",
                        "order": 20,
                        "status": "blocked",
                        "complete": False,
                        "required_for_scale": True,
                        "deferred_until_final_pass": False,
                        "blockers": ["pending extraction lanes remain"],
                    },
                    {
                        "key": "deferred_media_final_pass",
                        "order": 30,
                        "status": "deferred",
                        "complete": False,
                        "required_for_scale": True,
                        "deferred_until_final_pass": True,
                        "blockers": ["final media transcription/keyframe pass required"],
                    },
                    {
                        "key": "operator_approval_dashboard",
                        "order": 40,
                        "status": "blocked",
                        "complete": False,
                        "required_for_scale": True,
                        "deferred_until_final_pass": False,
                        "blockers": ["operator approval items remain"],
                    },
                    {
                        "key": "search_index_canary",
                        "order": 50,
                        "status": "blocked",
                        "complete": False,
                        "required_for_scale": True,
                        "deferred_until_final_pass": False,
                        "blockers": ["search-index canary is not verified"],
                    },
                    {
                        "key": "search_index_full_population",
                        "order": 60,
                        "status": "blocked",
                        "complete": False,
                        "required_for_scale": True,
                        "deferred_until_final_pass": False,
                        "blockers": ["search-index full run is not verified"],
                    },
                    {
                        "key": "llm_provider_readiness",
                        "order": 70,
                        "status": "complete",
                        "complete": True,
                        "required_for_scale": True,
                        "deferred_until_final_pass": False,
                        "blockers": [],
                    },
                    {
                        "key": "llm_rename_canary",
                        "order": 80,
                        "status": "blocked",
                        "complete": False,
                        "required_for_scale": True,
                        "deferred_until_final_pass": False,
                        "blockers": ["LLM rename canary is not verified"],
                    },
                    {
                        "key": "llm_rename_full_campaign",
                        "order": 90,
                        "status": "blocked",
                        "complete": False,
                        "required_for_scale": True,
                        "deferred_until_final_pass": False,
                        "blockers": ["LLM rename full campaign is not verified"],
                    },
                    {
                        "key": "metadata_apply_readiness",
                        "order": 100,
                        "status": "blocked",
                        "complete": False,
                        "required_for_scale": True,
                        "deferred_until_final_pass": False,
                        "blockers": ["metadata apply is not ready and still requires reviewed proposals"],
                    },
                ],
            },
            "stage_dependency_verification": {
                "present": True,
                "kind": "open_files_stage_dependency_gate_verification",
                "version": 1,
                "status": "ok",
                "gate_status": "blocked",
                "approved_to_scale": False,
                "summary": {
                    "stages": 10,
                    "blocking_stage_count": 8,
                    "hard_blocking_stage_count": 7,
                    "deferred_stage_count": 1,
                    "first_blocking_stage": "extraction_lane_readiness",
                    "current_stage_order": 20,
                },
                "gates": {
                    "stage_order_complete_set": True,
                    "stage_order_numbers_ok": True,
                    "scale_rules_ok": True,
                    "counts_consistent": True,
                    "first_blocker_consistent": True,
                    "status_consistent": True,
                    "approval_consistent": True,
                    "source_artifact_current_hashes_ok": True,
                },
                "source_artifacts": {"expected": 7, "present": 7, "missing": []},
                "errors_count": 0,
                "warnings_count": 0,
            },
            "search_index": {"present": True},
            "llm_campaign": {
                "present": True,
                "direct_provider_policy_attestation": {
                    "allowed_hosts": ["api.openai.com"],
                    "status": "ok",
                },
            },
            "llm_provider_readiness": {
                "present": True,
                "status": "ok",
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
            },
            "llm_campaign_results": {"present": True},
            "deferred_media_completion": {"present": True},
            "extraction_readiness": {
                "present": True,
                "status": "pending_completion",
                "gate": {
                    "all_active_lanes_explicitly_routed": True,
                    "no_failed_smoke_samples": True,
                    "no_not_implemented_samples": True,
                    "full_extraction_complete": False,
                },
            },
            "extraction_readiness_verification": {
                "present": True,
                "kind": "open_files_extraction_lane_readiness_gate_verification",
                "version": 1,
                "status": "ok",
                "gate_status": "pending_completion",
                "summary": {"pending_lanes": 3, "hard_blocker_lanes": 0},
                "checks": {
                    "source_artifacts_present": True,
                    "source_artifacts_current": True,
                    "semantic_projection_current": True,
                    "redaction_ok": True,
                    "expected_lanes_present": True,
                    "totals_consistent": True,
                    "gate_flags_consistent": True,
                },
                "source_artifacts": {
                    "expected_sources": 5,
                    "present_sources": 5,
                    "current_checked": True,
                    "current_mismatched": [],
                    "current_missing_paths": [],
                },
                "errors_count": 0,
                "warnings_count": 0,
            },
            "extraction_worker_image": {
                "present": True,
                "static_status": "ok",
                "docker_status": "permission_denied",
                "worker_runtime_policy": worker_runtime_policy(),
            },
            "extraction_approval_dashboard": {
                "present": True,
                "status": "ready_for_operator_review",
                "overall": {
                    "ready_for_operator_review": True,
                    "ready_approval_items": 5,
                    "approval_items": 5,
                    "blocked_or_missing_prep_items": [],
                    "final_media_pass_deferred": True,
                    "corpus_bytes_mutated": False,
                    "s3_objects_mutated": False,
                    "metadata_rows_mutated": False,
                },
            },
            "approval_request_packet": {
                "present": True,
                "status": "templates_ready",
                "template_count": 5,
                "redaction_check": {"passed": True, "sensitive_marker_counts": {}},
                "non_mutation_attestation": {
                    "templates_only": True,
                    "approvals_granted": False,
                    "execution_launched": False,
                    "corpus_bytes_mutated": False,
                    "s3_objects_mutated": False,
                    "metadata_rows_mutated": False,
                },
                "templates": [
                    {"decision_id": "ocr_vision_canary"},
                    {"decision_id": "large_file_canary"},
                    {"decision_id": "archive_worker_image"},
                    {"decision_id": "search_index_population"},
                    {"decision_id": "llm_review_campaign"},
                ],
            },
            "approval_request_verification": {
                "present": True,
                "kind": "open_files_operator_approval_request_packet_verification",
                "status": "ok",
                "packet_status": "templates_ready",
                "template_count": 5,
                "decision_count": 5,
                "gates": {
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
                "source_status": {
                    "dashboard_status": "ready_for_operator_review",
                    "approval_notes_status": "missing_required",
                    "approved_required_decision_count": 0,
                    "remediation_status": "operator_remediation_required",
                    "remediation_action_count": 6,
                },
                "errors_count": 0,
                "warnings_count": 0,
            },
            "replacement_readiness_gate": {
                "present": True,
                "kind": "open_files_google_drive_replacement_readiness_gate",
                "status": "blocked",
                "approved_to_replace_google_drive": False,
                "summary": {
                    "requirements": 9,
                    "complete": 2,
                    "blocked": 6,
                    "deferred": 1,
                    "missing": 0,
                    "first_incomplete_requirement": "read_extraction_coverage",
                },
                "requirements": [
                    {"key": "active_file_mapping", "status": "complete", "complete": True, "blockers": [], "evidence": {}},
                    {"key": "immutable_bytes_duplicate_preserve", "status": "complete", "complete": True, "blockers": [], "evidence": {}},
                    {"key": "read_extraction_coverage", "status": "blocked", "complete": False, "blockers": ["pending extraction lanes remain"], "evidence": {}},
                    {"key": "deferred_media_completion", "status": "deferred", "complete": False, "blockers": ["final media pass required"], "evidence": {}},
                    {"key": "operator_approval_gates", "status": "blocked", "complete": False, "blockers": ["operator approvals incomplete"], "evidence": {}},
                    {"key": "files_cli_search_index", "status": "blocked", "complete": False, "blockers": ["search index incomplete"], "evidence": {}},
                    {"key": "semantic_rename_readiness", "status": "blocked", "complete": False, "blockers": ["rename proposals incomplete"], "evidence": {}},
                    {"key": "metadata_apply_readiness", "status": "blocked", "complete": False, "blockers": ["metadata apply not ready"], "evidence": {}},
                    {"key": "adversarial_validation", "status": "blocked", "complete": False, "blockers": ["reviewers have blockers"], "evidence": {}},
                ],
            },
            "locked_worker_bundle": {
                "present": True,
                "command_policy": {
                    "dangerous_bypass": False,
                    "skip_git_repo_check": False,
                    "skip_git_repo_check_attested": False,
                    "skip_git_repo_check_justification": "normal repository check remains enabled",
                    "network_egress_policy": egress_policy(),
                },
                "integrity": {
                    "skip_git_repo_check": False,
                    "network_egress_policy": egress_policy(),
                },
                "verification": {
                    "status": "ok",
                    "network_egress_policy": egress_policy(),
                    "gates": {
                        "bundle_validation_ok": True,
                        "no_sandbox_bypass": True,
                        "skip_git_repo_check_policy_valid": True,
                        "cwd_confined_to_bundle": True,
                        "output_confined_to_output_dir": True,
                        "schema_confined_to_input_dir": True,
                        "sandbox_mode_limited": True,
                        "minimal_env_allowlist": True,
                        "no_secret_env_allowed": True,
                        "controlled_home_tmp": True,
                        "runner_uses_env_i": True,
                        "execution_surface_attested": True,
                        "network_egress_policy_attested": True,
                        "only_declared_writable_runtime_dirs": True,
                    },
                },
            },
        },
        "source_artifact_checks": [
            {"label": label, "present": True, "bytes": 1, "sha256": "0" * 64, "sensitive_marker_counts": {}}
            for label in labels
        ],
        "redaction_contract": {"output_sensitive_marker_counts": {}},
    }


class VerifyAdversarialReviewPacketTests(unittest.TestCase):
    def test_valid_packet_passes_all_core_gates(self) -> None:
        verifier = load_module()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            packet_path = write_review_files(root, valid_packet())

            result = verifier.verify_packet(packet_path, min_source_artifacts=20, min_ready_approval_items=5)

        self.assertEqual(result["status"], "ok")
        self.assertTrue(result["gates"]["stage_dependency_ordered"])
        self.assertTrue(result["gates"]["stage_dependency_verification_ok"])
        self.assertTrue(result["gates"]["approval_request_packet_ready"])
        self.assertTrue(result["gates"]["approval_request_verification_ok"])
        self.assertTrue(result["gates"]["dashboard_ready_for_operator_review"])
        self.assertTrue(result["gates"]["llm_provider_readiness_ok"])
        self.assertTrue(result["gates"]["llm_provider_policy_ok"])
        self.assertTrue(result["gates"]["llm_provider_schedule_ok"])
        self.assertTrue(result["gates"]["llm_provider_non_mutation_attested"])
        self.assertTrue(result["gates"]["llm_provider_redacted"])
        self.assertTrue(result["gates"]["replacement_readiness_gate_present"])
        self.assertTrue(result["gates"]["replacement_readiness_requirements_complete_set"])
        self.assertTrue(result["gates"]["replacement_readiness_status_consistent"])
        self.assertTrue(result["gates"]["replacement_readiness_approval_consistent"])
        self.assertTrue(result["gates"]["extraction_readiness_verification_ok"])
        self.assertTrue(result["gates"]["locked_worker_bundle_policy_ok"])
        self.assertTrue(result["gates"]["generated_review_files_redacted"])
        self.assertEqual(result["dashboard"]["ready_approval_items"], 5)

    def test_locked_worker_policy_failure_fails_packet(self) -> None:
        verifier = load_module()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            packet = valid_packet()
            packet["artifacts"]["locked_worker_bundle"]["verification"]["gates"]["execution_surface_attested"] = False
            packet_path = write_review_files(root, packet)

            result = verifier.verify_packet(packet_path, min_source_artifacts=20, min_ready_approval_items=5)

        self.assertEqual(result["status"], "failed")
        self.assertFalse(result["gates"]["locked_worker_bundle_policy_ok"])
        self.assertIn("locked_worker_bundle_gate_not_true:execution_surface_attested", result["errors"])

    def test_worker_image_runtime_policy_missing_fails_packet(self) -> None:
        verifier = load_module()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            packet = valid_packet()
            packet["artifacts"]["extraction_worker_image"].pop("worker_runtime_policy")
            packet_path = write_review_files(root, packet)

            result = verifier.verify_packet(packet_path, min_source_artifacts=20, min_ready_approval_items=5)

        self.assertEqual(result["status"], "failed")
        self.assertIn("worker_image_runtime_policy_missing", result["errors"])
        self.assertIn("worker_image_runtime_network_not_disabled", result["errors"])

    def test_locked_worker_egress_gate_failure_fails_packet(self) -> None:
        verifier = load_module()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            packet = valid_packet()
            packet["artifacts"]["locked_worker_bundle"]["verification"]["gates"]["network_egress_policy_attested"] = False
            packet_path = write_review_files(root, packet)

            result = verifier.verify_packet(packet_path, min_source_artifacts=20, min_ready_approval_items=5)

        self.assertEqual(result["status"], "failed")
        self.assertFalse(result["gates"]["locked_worker_bundle_policy_ok"])
        self.assertIn("locked_worker_bundle_gate_not_true:network_egress_policy_attested", result["errors"])

    def test_locked_worker_egress_s3_access_fails_packet(self) -> None:
        verifier = load_module()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            packet = valid_packet()
            packet["artifacts"]["locked_worker_bundle"]["command_policy"]["network_egress_policy"]["s3_object_access_allowed"] = True
            packet_path = write_review_files(root, packet)

            result = verifier.verify_packet(packet_path, min_source_artifacts=20, min_ready_approval_items=5)

        self.assertEqual(result["status"], "failed")
        self.assertFalse(result["gates"]["locked_worker_bundle_policy_ok"])
        self.assertIn("locked_worker_bundle_egress_policy_invalid:command:s3_object_access_allowed", result["errors"])

    def test_locked_worker_egress_wildcard_host_fails_packet(self) -> None:
        verifier = load_module()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            packet = valid_packet()
            packet["artifacts"]["locked_worker_bundle"]["verification"]["network_egress_policy"]["provider_endpoint_hosts"] = ["*"]
            packet_path = write_review_files(root, packet)

            result = verifier.verify_packet(packet_path, min_source_artifacts=20, min_ready_approval_items=5)

        self.assertEqual(result["status"], "failed")
        self.assertFalse(result["gates"]["locked_worker_bundle_policy_ok"])
        self.assertIn("locked_worker_bundle_egress_policy_invalid:verification:provider_endpoint_hosts", result["errors"])

    def test_locked_worker_egress_campaign_host_mismatch_fails_packet(self) -> None:
        verifier = load_module()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            packet = valid_packet()
            packet["artifacts"]["llm_campaign"]["direct_provider_policy_attestation"]["allowed_hosts"] = ["openrouter.ai"]
            packet_path = write_review_files(root, packet)

            result = verifier.verify_packet(packet_path, min_source_artifacts=20, min_ready_approval_items=5)

        self.assertEqual(result["status"], "failed")
        self.assertFalse(result["gates"]["locked_worker_bundle_policy_ok"])
        self.assertIn("locked_worker_bundle_egress_policy_campaign_host_mismatch", result["errors"])

    def test_current_source_artifact_hashes_are_verified_when_paths_are_supplied(self) -> None:
        verifier = load_module()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source_paths = write_source_files(root)
            packet = valid_packet()
            update_source_artifacts_from_paths(packet, source_paths)
            packet_path = write_review_files(root, packet)

            result = verifier.verify_packet(
                packet_path,
                min_source_artifacts=20,
                min_ready_approval_items=5,
                source_paths=source_paths,
            )

        self.assertEqual(result["status"], "ok")
        self.assertTrue(result["gates"]["source_artifact_current_hashes_ok"])
        self.assertEqual(result["source_artifacts"]["current_mismatched"], [])
        self.assertEqual(result["source_artifacts"]["current_missing_paths"], [])

    def test_stale_current_source_artifact_fails_hash_check(self) -> None:
        verifier = load_module()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source_paths = write_source_files(root)
            packet = valid_packet()
            update_source_artifacts_from_paths(packet, source_paths)
            source_paths["approval_request_packet"].write_text(
                json.dumps({"label": "approval_request_packet", "aggregate": True, "changed": True}),
                encoding="utf-8",
            )
            packet_path = write_review_files(root, packet)

            result = verifier.verify_packet(
                packet_path,
                min_source_artifacts=20,
                min_ready_approval_items=5,
                source_paths=source_paths,
            )

        self.assertEqual(result["status"], "failed")
        self.assertFalse(result["gates"]["source_artifact_current_hashes_ok"])
        self.assertIn("source_artifact_current_sha256_mismatch:approval_request_packet", result["errors"])
        self.assertIn("approval_request_packet", result["source_artifacts"]["current_mismatched"])

    def test_missing_current_source_artifact_path_fails_hash_check(self) -> None:
        verifier = load_module()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source_paths = write_source_files(root)
            packet = valid_packet()
            update_source_artifacts_from_paths(packet, source_paths)
            source_paths["approval_request_packet"].unlink()
            packet_path = write_review_files(root, packet)

            result = verifier.verify_packet(
                packet_path,
                min_source_artifacts=20,
                min_ready_approval_items=5,
                source_paths=source_paths,
            )

        self.assertEqual(result["status"], "failed")
        self.assertFalse(result["gates"]["source_artifact_current_hashes_ok"])
        self.assertIn("source_artifact_current_path_missing:approval_request_packet", result["errors"])
        self.assertIn("approval_request_packet", result["source_artifacts"]["current_missing_paths"])

    def test_missing_dashboard_fails(self) -> None:
        verifier = load_module()
        packet = valid_packet()
        packet["artifacts"].pop("extraction_approval_dashboard")
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            packet_path = write_review_files(root, packet)

            result = verifier.verify_packet(packet_path, min_source_artifacts=20, min_ready_approval_items=5)

        self.assertEqual(result["status"], "failed")
        self.assertIn("missing_artifact:extraction_approval_dashboard", result["errors"])
        self.assertIn("dashboard_not_ready_for_operator_review", result["errors"])

    def test_generated_sensitive_marker_fails_without_echoing_value(self) -> None:
        verifier = load_module()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            packet_path = write_review_files(root, valid_packet())
            (root / "reviewer-a-prompt.md").write_text('"file_id": "secret-token-123"', encoding="utf-8")

            result = verifier.verify_packet(packet_path, min_source_artifacts=20, min_ready_approval_items=5)

        self.assertEqual(result["status"], "failed")
        self.assertIn("generated_review_files_sensitive_marker_hits", result["errors"])
        self.assertNotIn("secret-token-123", json.dumps(result))

    def test_cli_writes_verification_artifact(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            packet_path = write_review_files(root, valid_packet())
            output = root / "verification.json"

            proc = run_script("--packet", str(packet_path), "--output", str(output), "--skip-current-source-check")

            self.assertEqual(proc.returncode, 0, proc.stderr)
            generated = proc.stdout + output.read_text(encoding="utf-8")
            self.assertIn("open_files_adversarial_review_packet_verification", generated)
            self.assertNotIn('"file_id"', generated)
            self.assertNotIn("open-files://", generated)

    def test_missing_stage_dependency_gate_fails(self) -> None:
        verifier = load_module()
        packet = valid_packet()
        packet["artifacts"].pop("stage_dependency_gate")
        packet["source_artifact_checks"] = [
            entry
            for entry in packet["source_artifact_checks"]
            if entry["label"] != "stage_dependency_gate"
        ]
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            packet_path = write_review_files(root, packet)

            result = verifier.verify_packet(packet_path, min_source_artifacts=20, min_ready_approval_items=5)

        self.assertEqual(result["status"], "failed")
        self.assertIn("missing_artifact:stage_dependency_gate", result["errors"])
        self.assertIn("missing_source_label:stage_dependency_gate", result["errors"])
        self.assertIn("stage_dependency_gate_not_present", result["errors"])

    def test_missing_stage_dependency_verification_fails(self) -> None:
        verifier = load_module()
        packet = valid_packet()
        packet["artifacts"].pop("stage_dependency_verification")
        packet["source_artifact_checks"] = [
            entry
            for entry in packet["source_artifact_checks"]
            if entry["label"] != "stage_dependency_verification"
        ]
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            packet_path = write_review_files(root, packet)

            result = verifier.verify_packet(packet_path, min_source_artifacts=20, min_ready_approval_items=5)

        self.assertEqual(result["status"], "failed")
        self.assertIn("missing_artifact:stage_dependency_verification", result["errors"])
        self.assertIn("missing_source_label:stage_dependency_verification", result["errors"])
        self.assertIn("stage_dependency_verification_not_present", result["errors"])

    def test_missing_approval_request_packet_fails(self) -> None:
        verifier = load_module()
        packet = valid_packet()
        packet["artifacts"].pop("approval_request_packet")
        packet["source_artifact_checks"] = [
            entry
            for entry in packet["source_artifact_checks"]
            if entry["label"] != "approval_request_packet"
        ]
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            packet_path = write_review_files(root, packet)

            result = verifier.verify_packet(packet_path, min_source_artifacts=20, min_ready_approval_items=5)

        self.assertEqual(result["status"], "failed")
        self.assertIn("missing_artifact:approval_request_packet", result["errors"])
        self.assertIn("missing_source_label:approval_request_packet", result["errors"])
        self.assertIn("approval_request_packet_not_present", result["errors"])

    def test_missing_approval_request_verification_fails(self) -> None:
        verifier = load_module()
        packet = valid_packet()
        packet["artifacts"].pop("approval_request_verification")
        packet["source_artifact_checks"] = [
            entry
            for entry in packet["source_artifact_checks"]
            if entry["label"] != "approval_request_packet_verification"
        ]
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            packet_path = write_review_files(root, packet)

            result = verifier.verify_packet(packet_path, min_source_artifacts=20, min_ready_approval_items=5)

        self.assertEqual(result["status"], "failed")
        self.assertIn("missing_artifact:approval_request_verification", result["errors"])
        self.assertIn("missing_source_label:approval_request_packet_verification", result["errors"])
        self.assertIn("approval_request_verification_not_present", result["errors"])

    def test_missing_provider_readiness_fails(self) -> None:
        verifier = load_module()
        packet = valid_packet()
        packet["artifacts"].pop("llm_provider_readiness")
        packet["source_artifact_checks"] = [
            entry
            for entry in packet["source_artifact_checks"]
            if entry["label"] != "llm_provider_readiness"
        ]
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            packet_path = write_review_files(root, packet)

            result = verifier.verify_packet(packet_path, min_source_artifacts=20, min_ready_approval_items=5)

        self.assertEqual(result["status"], "failed")
        self.assertIn("missing_artifact:llm_provider_readiness", result["errors"])
        self.assertIn("missing_source_label:llm_provider_readiness", result["errors"])
        self.assertIn("llm_provider_readiness_not_present", result["errors"])

    def test_missing_replacement_readiness_gate_fails(self) -> None:
        verifier = load_module()
        packet = valid_packet()
        packet["artifacts"].pop("replacement_readiness_gate")
        packet["source_artifact_checks"] = [
            entry
            for entry in packet["source_artifact_checks"]
            if entry["label"] != "replacement_readiness_gate"
        ]
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            packet_path = write_review_files(root, packet)

            result = verifier.verify_packet(packet_path, min_source_artifacts=20, min_ready_approval_items=5)

        self.assertEqual(result["status"], "failed")
        self.assertIn("missing_artifact:replacement_readiness_gate", result["errors"])
        self.assertIn("missing_source_label:replacement_readiness_gate", result["errors"])
        self.assertIn("replacement_readiness_gate_not_present", result["errors"])

    def test_missing_extraction_readiness_verification_fails(self) -> None:
        verifier = load_module()
        packet = valid_packet()
        packet["artifacts"].pop("extraction_readiness_verification")
        packet["source_artifact_checks"] = [
            entry
            for entry in packet["source_artifact_checks"]
            if entry["label"] != "extraction_readiness_verification"
        ]
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            packet_path = write_review_files(root, packet)

            result = verifier.verify_packet(packet_path, min_source_artifacts=20, min_ready_approval_items=5)

        self.assertEqual(result["status"], "failed")
        self.assertIn("missing_artifact:extraction_readiness_verification", result["errors"])
        self.assertIn("missing_source_label:extraction_readiness_verification", result["errors"])
        self.assertIn("extraction_readiness_verification_not_present", result["errors"])

    def test_stale_extraction_readiness_verification_fails(self) -> None:
        verifier = load_module()
        packet = valid_packet()
        packet["artifacts"]["extraction_readiness_verification"]["checks"]["semantic_projection_current"] = False
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            packet_path = write_review_files(root, packet)

            result = verifier.verify_packet(packet_path, min_source_artifacts=20, min_ready_approval_items=5)

        self.assertEqual(result["status"], "failed")
        self.assertIn("extraction_readiness_verification_check_not_true:semantic_projection_current", result["errors"])

    def test_provider_policy_failure_blocks_packet(self) -> None:
        verifier = load_module()
        packet = valid_packet()
        packet["artifacts"]["llm_provider_readiness"]["direct_provider_policy_gate"]["checks"]["raw_extracts_not_sent"] = False
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            packet_path = write_review_files(root, packet)

            result = verifier.verify_packet(packet_path, min_source_artifacts=20, min_ready_approval_items=5)

        self.assertEqual(result["status"], "failed")
        self.assertIn("llm_provider_policy_check_not_true:raw_extracts_not_sent", result["errors"])


if __name__ == "__main__":
    unittest.main()
