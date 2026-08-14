#!/usr/bin/env python3
"""Offline tests for extraction worker image approval packets."""

from __future__ import annotations

import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


SCRIPT_DIR = Path(__file__).resolve().parents[1] / "scripts"
SCRIPT = SCRIPT_DIR / "build_extraction_worker_image_approval_packet.py"


def load_module():
    if str(SCRIPT_DIR) not in sys.path:
        sys.path.insert(0, str(SCRIPT_DIR))
    spec = importlib.util.spec_from_file_location("build_extraction_worker_image_approval_packet", SCRIPT)
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


def runtime_policy() -> dict:
    return {
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
        "tmpfs_paths": ["/tmp"],
        "cap_drop_all": True,
        "no_new_privileges": True,
        "command_logs_hashed_only": True,
        "private_values_in_command": False,
    }


def verification(static_status: str = "ok", docker_status: str = "permission_denied", runtime_status: str | None = None) -> dict:
    value = {
        "kind": "open_files_extraction_worker_image_verification",
        "status": "ok",
        "static": {"status": static_status, "errors": [], "warnings": []},
        "docker": {"status": docker_status, "path": "/usr/bin/docker"},
        "runtime": None,
        "worker_runtime_policy": runtime_policy(),
        "gates": {
            "worker_runtime_network_disabled": True,
            "worker_runtime_provider_egress_disabled": True,
            "worker_runtime_s3_access_disabled": True,
            "worker_runtime_db_access_disabled": True,
            "worker_runtime_corpus_mounts_disabled": True,
            "worker_runtime_logs_hashed_only": True,
            "worker_runtime_policy_attested": True,
        },
        "next_actions": ["grant_docker_socket_or_ci_runner_access"],
    }
    if static_status != "ok":
        value["static"]["errors"] = ["missing_package:p7zip-full"]
    if runtime_status is not None:
        value["runtime"] = {"status": runtime_status}
    return value


class BuildExtractionWorkerImageApprovalPacketTests(unittest.TestCase):
    def test_packet_is_ready_for_operator_approval_after_static_verification(self) -> None:
        builder = load_module()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "verification.json"
            source.write_text(json.dumps(verification()), encoding="utf-8")

            packet = builder.build_packet(
                verification_path=source,
                worker_inventory_path=Path(".codewith/private-artifacts/extraction-worker-tool-inventory.json"),
                gate_output_path=Path(".codewith/private-artifacts/extraction-lane-readiness-gate.json"),
            )

        self.assertEqual(packet["status"], "ready_for_operator_approval")
        self.assertTrue(packet["approval_required"])
        self.assertTrue(packet["redaction_check"]["passed"])
        self.assertEqual(packet["packet_errors"], [])
        self.assertTrue(packet["approval_packet_checks"]["redaction_ok"])
        self.assertTrue(packet["approval_packet_checks"]["source_artifacts_present"])
        self.assertTrue(packet["approval_packet_checks"]["source_artifact_hashes_ok"])
        self.assertEqual(packet["source_artifacts"]["verification"]["label"], "extraction_worker_image_verification")
        self.assertTrue(packet["gates"]["static_verification_ok"])
        self.assertTrue(packet["gates"]["worker_runtime_policy_ok"])
        self.assertTrue(packet["gates"]["worker_runtime_network_disabled"])
        self.assertTrue(packet["gates"]["worker_runtime_provider_egress_disabled"])
        self.assertTrue(packet["gates"]["worker_runtime_s3_access_disabled"])
        self.assertTrue(packet["gates"]["worker_runtime_db_access_disabled"])
        self.assertTrue(packet["gates"]["worker_runtime_corpus_mounts_disabled"])
        self.assertTrue(packet["gates"]["worker_runtime_logs_hashed_only"])
        self.assertEqual(packet["worker_runtime_policy"]["network_mode"], "none")
        self.assertFalse(packet["worker_runtime_policy"]["provider_egress_allowed"])
        self.assertFalse(packet["worker_runtime_policy"]["s3_object_access_allowed"])
        self.assertFalse(packet["gates"]["docker_access_available"])
        self.assertFalse(packet["gates"]["corpus_access_required"])
        self.assertFalse(packet["gates"]["s3_or_db_mutation_required"])
        self.assertTrue(packet["docker_access_remediation"]["required"])
        self.assertEqual(packet["docker_access_remediation"]["blocker"], "docker_socket_permission_denied")
        self.assertFalse(packet["docker_access_remediation"]["requires_corpus_access"])
        self.assertFalse(packet["docker_access_remediation"]["requires_s3_or_db_mutation"])
        self.assertIn("--build", packet["commands"]["approved_build_smoke_and_inventory"])
        self.assertIn("--worker-tool-inventory", packet["commands"]["rerun_readiness_gate_with_worker_inventory"])

    def test_packet_blocks_when_static_verification_fails(self) -> None:
        builder = load_module()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "verification.json"
            source.write_text(json.dumps(verification(static_status="failed")), encoding="utf-8")

            packet = builder.build_packet(
                verification_path=source,
                worker_inventory_path=Path(".codewith/private-artifacts/extraction-worker-tool-inventory.json"),
                gate_output_path=Path(".codewith/private-artifacts/extraction-lane-readiness-gate.json"),
            )

        self.assertEqual(packet["status"], "blocked_static_verification")
        self.assertFalse(packet["gates"]["static_verification_ok"])
        self.assertFalse(packet["gates"]["safe_to_request_operator_approval"])

    def test_packet_blocks_when_worker_runtime_policy_is_missing(self) -> None:
        builder = load_module()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "verification.json"
            stale = verification()
            stale.pop("worker_runtime_policy")
            stale.pop("gates")
            source.write_text(json.dumps(stale), encoding="utf-8")

            packet = builder.build_packet(
                verification_path=source,
                worker_inventory_path=Path(".codewith/private-artifacts/extraction-worker-tool-inventory.json"),
                gate_output_path=Path(".codewith/private-artifacts/extraction-lane-readiness-gate.json"),
            )

        self.assertEqual(packet["status"], "blocked_runtime_policy_verification")
        self.assertFalse(packet["gates"]["worker_runtime_policy_ok"])
        self.assertFalse(packet["gates"]["safe_to_request_operator_approval"])

    def test_cli_writes_redacted_packet_without_private_markers(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "verification.json"
            output = root / "approval.json"
            source.write_text(json.dumps(verification()), encoding="utf-8")

            proc = run_script("--verification", str(source), "--output", str(output))

            self.assertEqual(proc.returncode, 0, proc.stderr)
            generated = proc.stdout + output.read_text(encoding="utf-8")
            self.assertNotIn('"file_id"', generated)
            self.assertNotIn("open-files://", generated)
            self.assertNotIn("objects/sha256/", generated)
            self.assertNotIn("s3://", generated)
            self.assertIn("ready_for_operator_approval", generated)


if __name__ == "__main__":
    unittest.main()
