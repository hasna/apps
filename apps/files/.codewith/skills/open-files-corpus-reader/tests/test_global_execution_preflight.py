#!/usr/bin/env python3
"""Offline tests for aggregate-only global execution preflight."""

from __future__ import annotations

import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path


SCRIPT_DIR = Path(__file__).resolve().parents[1] / "scripts"
SCRIPT = SCRIPT_DIR / "global_execution_preflight.py"


def load_module():
    if str(SCRIPT_DIR) not in sys.path:
        sys.path.insert(0, str(SCRIPT_DIR))
    spec = importlib.util.spec_from_file_location("global_execution_preflight", SCRIPT)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"failed to load {SCRIPT}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def write_gate(path: Path, requires_operator: bool = True, hard_blockers: int = 0, pending_lanes: int = 8, full_complete: bool = False) -> None:
    path.write_text(json.dumps({
        "kind": "open_files_extraction_lane_readiness_gate",
        "status": "ready" if full_complete else "pending_completion",
        "gate": {
            "status": "ready" if full_complete else "pending_completion",
            "requires_operator_approval_before_scale": requires_operator,
            "full_extraction_complete": full_complete,
        },
        "totals": {
            "hard_blocker_lanes": hard_blockers,
            "pending_lanes": pending_lanes,
        },
    }), encoding="utf-8")


VALID_TOKEN = {
    "approval_token_present": True,
    "approval_token_valid": True,
    "approval_token_sha256": "a" * 64,
    "approval_token_source": "test_plan_approval_attestation",
}


class GlobalExecutionPreflightTests(unittest.TestCase):
    def test_canary_is_allowed_when_global_gate_requires_scale_approval_and_token_is_valid(self) -> None:
        preflight = load_module()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            gate = root / "extraction-lane-readiness-gate.json"
            write_gate(gate)

            result = preflight.build_global_execution_preflight(
                plan_root=root / "plan",
                explicit_gate_path=str(gate),
                execute_requested=True,
                execution_scope="canary",
                selected_jobs=1,
                selected_bytes=100,
                max_canary_jobs=10,
                max_canary_bytes=1000,
                **VALID_TOKEN,
            )

        self.assertTrue(result["allowed"])
        self.assertEqual(result["status"], "canary_allowed_pending_global_completion")
        self.assertTrue(result["approval_token_valid"])
        self.assertTrue(result["requires_operator_approval_before_scale"])
        self.assertNotIn("file_id", json.dumps(result))

    def test_canary_is_blocked_without_valid_approval_token(self) -> None:
        preflight = load_module()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            gate = root / "extraction-lane-readiness-gate.json"
            write_gate(gate)

            result = preflight.build_global_execution_preflight(
                plan_root=root / "plan",
                explicit_gate_path=str(gate),
                execute_requested=True,
                execution_scope="canary",
                selected_jobs=1,
                selected_bytes=100,
                max_canary_jobs=10,
                max_canary_bytes=1000,
                approval_token_present=False,
                approval_token_valid=False,
            )

        self.assertFalse(result["allowed"])
        self.assertEqual(result["status"], "canary_approval_token_required")
        self.assertFalse(result["approval_token_valid"])

    def test_scale_is_blocked_when_global_gate_requires_operator_approval(self) -> None:
        preflight = load_module()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            gate = root / "extraction-lane-readiness-gate.json"
            write_gate(gate)

            result = preflight.build_global_execution_preflight(
                plan_root=root / "plan",
                explicit_gate_path=str(gate),
                execute_requested=True,
                execution_scope="scale",
                selected_jobs=1,
                selected_bytes=100,
                max_canary_jobs=10,
                max_canary_bytes=1000,
                **VALID_TOKEN,
            )

        self.assertFalse(result["allowed"])
        self.assertEqual(result["status"], "scale_blocked_by_global_gate")

    def test_canary_limits_are_enforced(self) -> None:
        preflight = load_module()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            gate = root / "extraction-lane-readiness-gate.json"
            write_gate(gate)

            result = preflight.build_global_execution_preflight(
                plan_root=root / "plan",
                explicit_gate_path=str(gate),
                execute_requested=True,
                execution_scope="canary",
                selected_jobs=11,
                selected_bytes=100,
                max_canary_jobs=10,
                max_canary_bytes=1000,
                **VALID_TOKEN,
            )

        self.assertFalse(result["allowed"])
        self.assertEqual(result["status"], "canary_limits_exceeded")

    def test_execute_is_blocked_when_readiness_gate_is_missing(self) -> None:
        preflight = load_module()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            result = preflight.build_global_execution_preflight(
                plan_root=root / "plan",
                explicit_gate_path=None,
                execute_requested=True,
                execution_scope="canary",
                selected_jobs=1,
                selected_bytes=100,
                max_canary_jobs=10,
                max_canary_bytes=1000,
                **VALID_TOKEN,
            )

        self.assertFalse(result["allowed"])
        self.assertEqual(result["status"], "missing_readiness_gate")
        self.assertFalse(result["gate_present"])

    def test_canary_is_blocked_when_hard_blocker_lanes_remain(self) -> None:
        preflight = load_module()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            gate = root / "extraction-lane-readiness-gate.json"
            write_gate(gate, hard_blockers=1)

            result = preflight.build_global_execution_preflight(
                plan_root=root / "plan",
                explicit_gate_path=str(gate),
                execute_requested=True,
                execution_scope="canary",
                selected_jobs=1,
                selected_bytes=100,
                max_canary_jobs=10,
                max_canary_bytes=1000,
                **VALID_TOKEN,
            )

        self.assertFalse(result["allowed"])
        self.assertEqual(result["status"], "canary_blocked_by_global_hard_blockers")
        self.assertEqual(result["hard_blocker_lanes"], 1)

    def test_scale_is_allowed_only_when_readiness_is_complete(self) -> None:
        preflight = load_module()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            gate = root / "extraction-lane-readiness-gate.json"
            write_gate(gate, requires_operator=False, pending_lanes=0, full_complete=True)

            result = preflight.build_global_execution_preflight(
                plan_root=root / "plan",
                explicit_gate_path=str(gate),
                execute_requested=True,
                execution_scope="scale",
                selected_jobs=20,
                selected_bytes=100,
                max_canary_jobs=10,
                max_canary_bytes=1000,
                **VALID_TOKEN,
            )

        self.assertTrue(result["allowed"])
        self.assertEqual(result["status"], "ok")

    def test_plan_approval_token_requires_approved_plan_note_and_valid_hash(self) -> None:
        preflight = load_module()
        valid = preflight.plan_approval_token({
            "approved": True,
            "approval_attestation": {
                "approval_note_present": True,
                "approval_note_sha256": "b" * 64,
            },
        })
        missing_hash = preflight.plan_approval_token({
            "approved": True,
            "approval_attestation": {"approval_note_present": True},
        })
        unapproved = preflight.plan_approval_token({
            "approved": False,
            "approval_attestation": {
                "approval_note_present": True,
                "approval_note_sha256": "c" * 64,
            },
        })

        self.assertTrue(valid["approval_token_valid"])
        self.assertFalse(missing_hash["approval_token_valid"])
        self.assertFalse(unapproved["approval_token_valid"])


if __name__ == "__main__":
    unittest.main()
