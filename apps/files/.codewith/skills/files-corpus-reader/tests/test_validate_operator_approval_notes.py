#!/usr/bin/env python3
"""Offline tests for operator approval-note validation."""

from __future__ import annotations

import hashlib
import json
import subprocess
import tempfile
import unittest
from pathlib import Path


SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "validate_operator_approval_notes.py"


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


def note(decision_id: str, text: str) -> dict:
    return {
        "kind": "open_files_operator_approval_note",
        "version": 1,
        "decision_id": decision_id,
        "status": "approved",
        "scope": "canary",
        "approved_by": "operator",
        "approved_at": "2026-06-16T15:00:00Z",
        "approval_note": text,
    }


def request_packet() -> dict:
    return {
        "kind": "open_files_operator_approval_note_template_packet",
        "status": "templates_ready",
        "template_count": 1,
        "templates": [
            {
                "decision_id": "ocr_vision_canary",
                "scope": "provider-use",
                "remediation_action_ids": ["enable_ocr_or_vision_lane"],
                "remediation_status": "operator_remediation_required",
                "command_hashes": [
                    {"name": "execute_canary_after_approval", "sha256": "a" * 64, "bytes": 12}
                ],
            }
        ],
    }


def approval_note_with_request_context(text: str) -> dict:
    value = note("ocr_vision_canary", text)
    value["scope"] = "provider-use"
    value["remediation_context"] = {
        "status": "operator_remediation_required",
        "linked_action_ids": ["enable_ocr_or_vision_lane"],
        "linked_actions": [
            {
                "id": "enable_ocr_or_vision_lane",
                "active_files": 5,
                "approval_required": True,
            }
        ],
        "redaction_check": {"passed": True, "sensitive_marker_counts": {}},
    }
    value["command_hashes"] = [
        {"name": "execute_canary_after_approval", "sha256": "a" * 64, "bytes": 12}
    ]
    return value


class ValidateOperatorApprovalNotesTests(unittest.TestCase):
    def test_missing_notes_are_reported_without_failure(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            output = root / "summary.json"

            proc = run_script("--notes-dir", str(root / "missing"), "--output", str(output))
            self.assertEqual(proc.returncode, 0, proc.stderr)
            summary = json.loads(output.read_text(encoding="utf-8"))

        self.assertEqual(summary["status"], "missing_required")
        self.assertEqual(summary["artifact_count"], 0)
        self.assertEqual(len(summary["missing_required_decisions"]), 5)
        self.assertTrue(summary["redaction_check"]["passed"])

    def test_valid_approved_notes_satisfy_required_decisions(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            notes = root / "notes"
            output = root / "summary.json"
            for decision_id in (
                "ocr_vision_canary",
                "large_file_canary",
                "archive_worker_image",
                "search_index_population",
                "llm_review_campaign",
            ):
                write_json(notes / f"{decision_id}.json", note(decision_id, f"approve {decision_id} canary"))

            proc = run_script("--notes-dir", str(notes), "--output", str(output))
            self.assertEqual(proc.returncode, 0, proc.stderr)
            summary = json.loads(output.read_text(encoding="utf-8"))

        self.assertEqual(summary["status"], "approved")
        self.assertEqual(summary["approved_required_decision_count"], 5)
        self.assertEqual(summary["missing_required_decisions"], [])
        self.assertTrue(all(item["valid"] for item in summary["required_decisions"]))

    def test_private_note_text_is_hashed_not_echoed(self) -> None:
        private_text = "operator approval with private business context"
        expected_hash = hashlib.sha256(private_text.encode("utf-8")).hexdigest()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            notes = root / "notes"
            output = root / "summary.json"
            write_json(notes / "ocr.json", note("ocr_vision_canary", private_text))

            proc = run_script(
                "--notes-dir",
                str(notes),
                "--required-decisions",
                "ocr_vision_canary",
                "--output",
                str(output),
            )
            self.assertEqual(proc.returncode, 0, proc.stderr)
            generated = proc.stdout + output.read_text(encoding="utf-8")

        self.assertIn(expected_hash, generated)
        self.assertNotIn(private_text, generated)
        self.assertNotIn('"file_id"', generated)
        self.assertNotIn("open-files://", generated)

    def test_generated_support_artifacts_are_not_counted_as_notes(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            notes = root / "notes"
            output = root / "summary.json"
            write_json(notes / "approval-intake-readiness.json", {"kind": "intake", "status": "missing_required"})
            write_json(notes / "approval-request-packet.json", {"kind": "packet", "status": "templates_ready"})
            write_json(notes / "approval-request-packet-verification.json", {"kind": "packet-verification", "status": "ok"})
            write_json(notes / "approval-notes-summary.json", {"kind": "summary", "status": "old"})
            write_json(notes / "large_file_canary.template.json", note("large_file_canary", "template placeholder"))
            write_json(notes / "post-approval-canary-command-plan.json", {"kind": "plan", "status": "blocked_no_unlocked_decisions"})
            write_json(notes / "post-approval-canary-command-plan-verification.json", {"kind": "plan-verification", "status": "ok"})
            write_json(notes / "post-approval-canary-command-run-summary.json", {"kind": "run", "status": "dry_run_blocked"})
            write_json(notes / "post-approval-canary-command-run-verification.json", {"kind": "run-verification", "status": "ok"})

            proc = run_script("--notes-dir", str(notes), "--output", str(output))
            self.assertEqual(proc.returncode, 0, proc.stderr)
            summary = json.loads(output.read_text(encoding="utf-8"))

        self.assertEqual(summary["artifact_count"], 0)
        self.assertEqual(summary["status"], "missing_required")

    def test_approval_like_json_requires_note_kind_and_version(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            notes = root / "notes"
            output = root / "summary.json"
            value = note("ocr_vision_canary", "approve ocr canary")
            value["kind"] = "open_files_operator_approval_note_template_packet"
            value.pop("version")
            write_json(notes / "ocr.json", value)

            proc = run_script(
                "--notes-dir",
                str(notes),
                "--required-decisions",
                "ocr_vision_canary",
                "--output",
                str(output),
            )
            self.assertEqual(proc.returncode, 0, proc.stderr)
            summary = json.loads(output.read_text(encoding="utf-8"))

        self.assertEqual(summary["status"], "invalid")
        self.assertEqual(summary["invalid_required_decisions"], ["ocr_vision_canary"])
        item = summary["required_decisions"][0]
        self.assertFalse(item["valid"])
        self.assertIn("invalid_kind", item["errors"])
        self.assertIn("invalid_version", item["errors"])

    def test_approval_request_packet_context_is_required_when_supplied(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            notes = root / "notes"
            output = root / "summary.json"
            packet = root / "approval-request-packet.json"
            write_json(packet, request_packet())
            write_json(notes / "ocr.json", note("ocr_vision_canary", "approve ocr canary"))

            proc = run_script(
                "--notes-dir",
                str(notes),
                "--required-decisions",
                "ocr_vision_canary",
                "--approval-request-packet",
                str(packet),
                "--output",
                str(output),
            )

            self.assertEqual(proc.returncode, 0, proc.stderr)
            summary = json.loads(output.read_text(encoding="utf-8"))

        self.assertEqual(summary["status"], "invalid")
        self.assertEqual(summary["invalid_required_decisions"], ["ocr_vision_canary"])
        item = summary["required_decisions"][0]
        self.assertTrue(item["approval_request_checked"])
        self.assertIn("missing_remediation_context", item["errors"])
        self.assertIn("approval_request_scope_mismatch", item["errors"])
        self.assertIn("command_hashes_mismatch", item["errors"])

    def test_approval_request_packet_context_can_validate_note(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            notes = root / "notes"
            output = root / "summary.json"
            packet = root / "approval-request-packet.json"
            write_json(packet, request_packet())
            write_json(notes / "ocr.json", approval_note_with_request_context("approve bounded ocr canary"))

            proc = run_script(
                "--notes-dir",
                str(notes),
                "--required-decisions",
                "ocr_vision_canary",
                "--approval-request-packet",
                str(packet),
                "--output",
                str(output),
            )

            self.assertEqual(proc.returncode, 0, proc.stderr)
            summary = json.loads(output.read_text(encoding="utf-8"))

        self.assertEqual(summary["status"], "approved")
        item = summary["required_decisions"][0]
        self.assertTrue(item["approval_request_checked"])
        self.assertEqual(item["remediation_action_ids"], ["enable_ocr_or_vision_lane"])
        self.assertEqual(item["remediation_status"], "operator_remediation_required")
        self.assertTrue(item["command_hashes_match"])


if __name__ == "__main__":
    unittest.main()
