#!/usr/bin/env python3
"""Offline tests for operator approval request packet verification."""

from __future__ import annotations

import hashlib
import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


SCRIPT_DIR = Path(__file__).resolve().parents[1] / "scripts"
SCRIPT = SCRIPT_DIR / "verify_operator_approval_request_packet.py"


def load_module():
    if str(SCRIPT_DIR) not in sys.path:
        sys.path.insert(0, str(SCRIPT_DIR))
    spec = importlib.util.spec_from_file_location("verify_operator_approval_request_packet", SCRIPT)
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


def sha256_text(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


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


def write_template(template_dir: Path, decision_id: str) -> dict[str, object]:
    filename = f"{decision_id}.template.json"
    text = json.dumps(
        {
            "decision_id": decision_id,
            "kind": "open_files_operator_approval_note",
            "redaction": "aggregate template fixture",
            "stage_readiness_context": stage_readiness(),
        },
        sort_keys=True,
    ) + "\n"
    (template_dir / filename).write_text(text, encoding="utf-8")
    return {"template_file": filename, "template_sha256": sha256_text(text)}


def command_hash() -> dict[str, object]:
    return {"name": "execute_canary_after_approval", "sha256": "a" * 64, "bytes": 42}


def source_artifacts() -> list[dict[str, object]]:
    return [
        {"label": "extraction_approval_dashboard", "present": True, "bytes": 10, "sha256": "b" * 64},
        {"label": "approval_notes_summary", "present": True, "bytes": 10, "sha256": "c" * 64},
        {"label": "stage_dependency_verification", "present": True, "bytes": 10, "sha256": "d" * 64},
    ]


def write_source_files(root: Path) -> dict[str, Path]:
    source_paths: dict[str, Path] = {}
    for label in ("extraction_approval_dashboard", "approval_notes_summary", "stage_dependency_verification"):
        path = root / f"{label}.json"
        path.write_text(json.dumps({"label": label, "aggregate": True}, sort_keys=True), encoding="utf-8")
        source_paths[label] = path
    return source_paths


def source_artifacts_from_paths(source_paths: dict[str, Path]) -> list[dict[str, object]]:
    artifacts: list[dict[str, object]] = []
    for label in ("extraction_approval_dashboard", "approval_notes_summary", "stage_dependency_verification"):
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


def packet_fixture(template_dir: Path) -> dict[str, object]:
    template_dir.mkdir(parents=True, exist_ok=True)

    def item(
        decision_id: str,
        scope: str,
        remediation_action_ids: list[str],
        command_hashes: list[dict[str, object]] | None = None,
    ) -> dict[str, object]:
        file_info = write_template(template_dir, decision_id)
        return {
            "decision_id": decision_id,
            "priority": "high",
            "ready_for_approval": True,
            "status": "approval_required",
            "scope": scope,
            "remediation_action_ids": remediation_action_ids,
            "remediation_status": "operator_remediation_required",
            "command_hashes": [] if command_hashes is None else command_hashes,
            "stage_readiness_sha256": sha256_text(json.dumps(stage_readiness(), sort_keys=True)),
            "sensitive_marker_counts": {},
            **file_info,
        }

    return {
        "kind": "open_files_operator_approval_note_template_packet",
        "version": 1,
        "status": "templates_ready",
        "template_dir": str(template_dir),
        "template_count": 5,
        "source_status": {
            "dashboard_status": "ready_for_operator_review",
            "ready_for_operator_review": True,
            "approval_notes_status": "missing_required",
            "approved_required_decision_count": 0,
            "stage_verification_status": "ok",
            "stage_gate_status": "blocked",
            "remediation_status": "operator_remediation_required",
            "remediation_action_count": 6,
        },
        "stage_readiness": stage_readiness(),
        "stage_readiness_sha256": sha256_text(json.dumps(stage_readiness(), sort_keys=True)),
        "non_mutation_attestation": {
            "templates_only": True,
            "approvals_granted": False,
            "execution_launched": False,
            "corpus_bytes_mutated": False,
            "s3_objects_mutated": False,
            "metadata_rows_mutated": False,
        },
        "source_artifacts": source_artifacts(),
        "templates": [
            item("ocr_vision_canary", "provider-use", ["enable_ocr_or_vision_lane"]),
            item("large_file_canary", "canary", ["approve_large_file_runner_canary"], [command_hash()]),
            item(
                "archive_worker_image",
                "worker-build",
                ["enable_archive_inventory_tools", "grant_worker_docker_access_or_ci"],
                [command_hash()],
            ),
            item("search_index_population", "canary", [], [command_hash()]),
            item("llm_review_campaign", "canary", []),
        ],
        "redaction_check": {"passed": True, "sensitive_marker_counts": {}},
        "redaction": "aggregate-only",
    }


class VerifyOperatorApprovalRequestPacketTests(unittest.TestCase):
    def test_valid_packet_passes_with_template_hash_checks(self) -> None:
        verifier = load_module()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            packet = packet_fixture(root / "templates")
            packet_path = root / "approval-request-packet.json"
            packet_path.write_text(json.dumps(packet), encoding="utf-8")
            result = verifier.verify_packet(packet_path)

        self.assertEqual(result["status"], "ok")
        self.assertEqual(result["template_count"], 5)
        self.assertTrue(result["gates"]["required_decisions_present"])
        self.assertTrue(result["gates"]["template_hashes_valid"])
        self.assertTrue(result["gates"]["template_files_present"])
        self.assertTrue(result["gates"]["source_artifacts_present"])
        self.assertTrue(result["gates"]["source_artifact_hashes_ok"])
        self.assertTrue(result["gates"]["stage_readiness_present"])
        self.assertTrue(result["gates"]["template_stage_readiness_valid"])
        self.assertEqual(result["stage_readiness"]["metadata_apply_ready"], False)
        self.assertEqual(result["errors"], [])

    def test_missing_required_decision_fails(self) -> None:
        verifier = load_module()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            packet = packet_fixture(root / "templates")
            packet["templates"] = packet["templates"][:-1]
            packet["template_count"] = 4
            packet_path = root / "approval-request-packet.json"
            packet_path.write_text(json.dumps(packet), encoding="utf-8")
            result = verifier.verify_packet(packet_path)

        self.assertEqual(result["status"], "error")
        self.assertIn("decision_order_or_set_invalid", result["errors"])

    def test_template_file_hash_mismatch_fails(self) -> None:
        verifier = load_module()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            packet = packet_fixture(root / "templates")
            (root / "templates" / "large_file_canary.template.json").write_text('{"changed":true}\n', encoding="utf-8")
            packet_path = root / "approval-request-packet.json"
            packet_path.write_text(json.dumps(packet), encoding="utf-8")
            result = verifier.verify_packet(packet_path)

        self.assertEqual(result["status"], "error")
        self.assertIn("template_file_sha256_mismatch:large_file_canary", result["errors"])

    def test_current_source_artifact_hashes_are_verified_when_paths_are_supplied(self) -> None:
        verifier = load_module()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source_paths = write_source_files(root)
            packet = packet_fixture(root / "templates")
            packet["source_artifacts"] = source_artifacts_from_paths(source_paths)
            packet_path = root / "approval-request-packet.json"
            packet_path.write_text(json.dumps(packet), encoding="utf-8")
            result = verifier.verify_packet(packet_path, source_paths=source_paths)

        self.assertEqual(result["status"], "ok")
        self.assertTrue(result["gates"]["source_artifact_current_hashes_ok"])
        self.assertEqual(result["source_artifacts"]["current_mismatched"], [])
        self.assertEqual(result["source_artifacts"]["current_missing_paths"], [])

    def test_stale_current_source_artifact_fails_hash_check(self) -> None:
        verifier = load_module()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source_paths = write_source_files(root)
            packet = packet_fixture(root / "templates")
            packet["source_artifacts"] = source_artifacts_from_paths(source_paths)
            source_paths["approval_notes_summary"].write_text(
                json.dumps({"label": "approval_notes_summary", "aggregate": True, "changed": True}),
                encoding="utf-8",
            )
            packet_path = root / "approval-request-packet.json"
            packet_path.write_text(json.dumps(packet), encoding="utf-8")
            result = verifier.verify_packet(packet_path, source_paths=source_paths)

        self.assertEqual(result["status"], "error")
        self.assertFalse(result["gates"]["source_artifact_current_hashes_ok"])
        self.assertIn("source_artifact_current_sha256_mismatch:approval_notes_summary", result["errors"])
        self.assertIn("approval_notes_summary", result["source_artifacts"]["current_mismatched"])

    def test_stage_readiness_mismatch_fails(self) -> None:
        verifier = load_module()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            packet = packet_fixture(root / "templates")
            packet["stage_readiness"]["metadata_apply_ready"] = True
            packet_path = root / "approval-request-packet.json"
            packet_path.write_text(json.dumps(packet), encoding="utf-8")
            result = verifier.verify_packet(packet_path)

        self.assertEqual(result["status"], "error")
        self.assertIn("stage_readiness_sha256_mismatch", result["errors"])
        self.assertIn("template_file_stage_readiness_mismatch:ocr_vision_canary", result["errors"])

    def test_missing_current_source_artifact_path_fails_hash_check(self) -> None:
        verifier = load_module()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source_paths = write_source_files(root)
            packet = packet_fixture(root / "templates")
            packet["source_artifacts"] = source_artifacts_from_paths(source_paths)
            source_paths["approval_notes_summary"].unlink()
            packet_path = root / "approval-request-packet.json"
            packet_path.write_text(json.dumps(packet), encoding="utf-8")
            result = verifier.verify_packet(packet_path, source_paths=source_paths)

        self.assertEqual(result["status"], "error")
        self.assertFalse(result["gates"]["source_artifact_current_hashes_ok"])
        self.assertIn("source_artifact_current_path_missing:approval_notes_summary", result["errors"])
        self.assertIn("approval_notes_summary", result["source_artifacts"]["current_missing_paths"])

    def test_cli_fails_on_sensitive_marker_without_echoing_private_value(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            packet = packet_fixture(root / "templates")
            packet["private_metadata"] = {"file_id": "f_privateSecret123"}
            packet_path = root / "approval-request-packet.json"
            output = root / "verification.json"
            packet_path.write_text(json.dumps(packet), encoding="utf-8")

            proc = run_script("--packet", str(packet_path), "--output", str(output))
            result = json.loads(output.read_text(encoding="utf-8"))

        self.assertEqual(proc.returncode, 1)
        self.assertIn("sensitive_marker_hits", result["errors"])
        self.assertIn("json_file_id_key", result["sensitive_marker_counts"])
        self.assertNotIn("f_privateSecret123", proc.stdout)


if __name__ == "__main__":
    unittest.main()
