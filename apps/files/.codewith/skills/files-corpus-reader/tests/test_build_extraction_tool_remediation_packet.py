#!/usr/bin/env python3
"""Offline tests for extraction tool remediation packets."""

from __future__ import annotations

import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


SCRIPT_DIR = Path(__file__).resolve().parents[1] / "scripts"
SCRIPT = SCRIPT_DIR / "build_extraction_tool_remediation_packet.py"


def load_module():
    if str(SCRIPT_DIR) not in sys.path:
        sys.path.insert(0, str(SCRIPT_DIR))
    spec = importlib.util.spec_from_file_location("build_extraction_tool_remediation_packet", SCRIPT)
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
    path.write_text(json.dumps(value, indent=2, sort_keys=True), encoding="utf-8")


def fixtures(root: Path) -> dict[str, Path]:
    paths = {
        "tools": root / "tools.json",
        "lanes": root / "lanes.json",
        "worker": root / "worker.json",
        "output": root / "remediation.json",
    }
    write_json(paths["tools"], {
        "status": "ready_with_degraded_lanes",
        "python_modules": {"PIL": {"present": True}},
        "lanes": {
            "needs_ocr_or_vision": {"status": "degraded"},
            "needs_archive_inventory": {"status": "ready"},
            "needs_design_raw_pipeline": {"status": "degraded"},
        },
    })
    write_json(paths["lanes"], {
        "status": "pending_completion",
        "gate": {
            "pending_lanes": [
                "needs_ocr_or_vision",
                "needs_archive_inventory",
                "needs_design_raw_pipeline",
                "needs_transcription",
            ],
            "requires_operator_approval_before_scale": True,
            "requires_provider_or_tool_work": True,
            "final_media_pass_required": True,
        },
        "lanes": [
            {
                "lane": "needs_ocr_or_vision",
                "active_files": 10,
                "requirements": [
                    "approved_large_file_runner_canary",
                    "missing_block:ocr",
                    "missing_block:vision_provider_approval",
                ],
                "host_missing_blocks": ["ocr", "vision_provider_approval"],
            },
            {
                "lane": "needs_archive_inventory",
                "active_files": 3,
                "requirements": [
                    "approved_large_file_runner_canary",
                    "missing_block:7z_inventory",
                    "missing_block:rar_inventory",
                ],
                "host_missing_blocks": ["7z_inventory", "rar_inventory"],
            },
            {
                "lane": "needs_design_raw_pipeline",
                "active_files": 7,
                "requirements": [
                    "approved_large_file_runner_canary",
                    "missing_block:exif_metadata",
                    "missing_block:preview",
                    "missing_block:vision_provider_approval",
                ],
                "host_missing_blocks": ["exif_metadata", "preview", "vision_provider_approval"],
            },
            {
                "lane": "needs_transcription",
                "active_files": 2,
                "requirements": [
                    "run_final_media_transcription_keyframe_pass",
                    "approved_large_file_runner_canary",
                ],
                "host_missing_blocks": [],
            },
        ],
    })
    write_json(paths["worker"], {
        "status": "ready_for_operator_approval",
        "docker_access_remediation": {
            "required": True,
            "blocker": "docker_socket_permission_denied",
            "safe_next_action": "grant Docker socket access or run CI smoke",
        },
    })
    return paths


class BuildExtractionToolRemediationPacketTests(unittest.TestCase):
    def test_maps_lane_blockers_to_aggregate_actions(self) -> None:
        builder = load_module()
        with tempfile.TemporaryDirectory() as tmp:
            paths = fixtures(Path(tmp))

            packet = builder.build_packet(paths["tools"], paths["lanes"], paths["worker"])

        action_ids = {item["id"] for item in packet["actions"]}
        self.assertEqual(packet["status"], "operator_remediation_required")
        self.assertIn("approve_large_file_runner_canary", action_ids)
        self.assertIn("enable_ocr_or_vision_lane", action_ids)
        self.assertIn("enable_archive_inventory_tools", action_ids)
        self.assertIn("enable_design_raw_preview_metadata", action_ids)
        self.assertIn("run_final_media_transcription_keyframe_pass", action_ids)
        self.assertIn("grant_worker_docker_access_or_ci", action_ids)
        self.assertTrue(packet["summary"]["python_pil_available"])
        self.assertEqual(packet["summary"]["deferred_action_count"], 1)
        by_id = {item["id"]: item for item in packet["actions"]}
        self.assertEqual(by_id["enable_ocr_or_vision_lane"]["lanes"], ["needs_ocr_or_vision"])
        self.assertEqual(by_id["enable_design_raw_preview_metadata"]["lanes"], ["needs_design_raw_pipeline"])
        self.assertNotIn("needs_transcription", by_id["approve_large_file_runner_canary"]["lanes"])
        self.assertTrue(packet["redaction_check"]["passed"])
        self.assertEqual(packet["packet_errors"], [])
        self.assertTrue(packet["packet_checks"]["redaction_ok"])
        self.assertTrue(packet["packet_checks"]["required_source_artifacts_present"])
        self.assertTrue(packet["packet_checks"]["source_artifact_hashes_ok"])
        self.assertTrue(packet["packet_checks"]["non_mutation_attested"])
        self.assertFalse(packet["non_mutation_attestation"]["provider_calls_made"])

    def test_ready_when_no_non_deferred_actions(self) -> None:
        builder = load_module()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            tools = root / "tools.json"
            lanes = root / "lanes.json"
            write_json(tools, {"status": "ready", "python_modules": {}, "lanes": {}})
            write_json(lanes, {"status": "ready", "gate": {}, "lanes": []})

            packet = builder.build_packet(tools, lanes, None)

        self.assertEqual(packet["status"], "ready")
        self.assertEqual(packet["actions"], [])
        self.assertEqual(packet["packet_errors"], [])
        self.assertTrue(packet["packet_checks"]["required_source_artifacts_present"])

    def test_cli_writes_packet_without_private_markers(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            paths = fixtures(Path(tmp))

            proc = run_script(
                "--tool-inventory", str(paths["tools"]),
                "--lane-readiness-gate", str(paths["lanes"]),
                "--worker-approval-packet", str(paths["worker"]),
                "--output", str(paths["output"]),
            )

            self.assertEqual(proc.returncode, 0, proc.stderr)
            generated = proc.stdout + paths["output"].read_text(encoding="utf-8")
            self.assertIn("operator_remediation_required", generated)
            self.assertNotIn('"file_id"', generated)
            self.assertNotIn("open-files://", generated)
            self.assertNotIn("objects/sha256/", generated)
            self.assertNotIn("s3://", generated)

    def test_cli_fails_when_required_source_is_missing(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            paths = fixtures(Path(tmp))
            paths["tools"].unlink()

            proc = run_script(
                "--tool-inventory", str(paths["tools"]),
                "--lane-readiness-gate", str(paths["lanes"]),
                "--worker-approval-packet", str(paths["worker"]),
                "--output", str(paths["output"]),
            )
            packet = json.loads(paths["output"].read_text(encoding="utf-8"))

        self.assertEqual(proc.returncode, 1)
        self.assertFalse(packet["packet_checks"]["required_source_artifacts_present"])
        self.assertIn("source_artifact_missing:tool_inventory", packet["packet_errors"])

    def test_cli_fails_on_sensitive_marker_without_echoing_private_value(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            paths = fixtures(Path(tmp))
            lanes = json.loads(paths["lanes"].read_text(encoding="utf-8"))
            lanes["gate"]["pending_lanes"].append("open-files://private")
            paths["lanes"].write_text(json.dumps(lanes), encoding="utf-8")

            proc = run_script(
                "--tool-inventory", str(paths["tools"]),
                "--lane-readiness-gate", str(paths["lanes"]),
                "--worker-approval-packet", str(paths["worker"]),
                "--output", str(paths["output"]),
            )
            packet = json.loads(paths["output"].read_text(encoding="utf-8"))

        self.assertEqual(proc.returncode, 1)
        self.assertFalse(packet["redaction_check"]["passed"])
        self.assertIn("sensitive_marker_hits", packet["packet_errors"])
        self.assertIn("open_files_ref", packet["redaction_check"]["sensitive_marker_counts"])
        self.assertNotIn("open-files://private", proc.stdout)


if __name__ == "__main__":
    unittest.main()
