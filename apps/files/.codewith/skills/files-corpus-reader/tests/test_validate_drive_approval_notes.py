#!/usr/bin/env python3
"""Tests for private Drive approval-note validation."""

from __future__ import annotations

import hashlib
import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path


SCRIPT_DIR = Path(__file__).resolve().parents[1] / "scripts"
SCRIPT = SCRIPT_DIR / "validate_drive_approval_notes.py"


def load_module():
    if str(SCRIPT_DIR) not in sys.path:
        sys.path.insert(0, str(SCRIPT_DIR))
    spec = importlib.util.spec_from_file_location("validate_drive_approval_notes", SCRIPT)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"failed to load {SCRIPT}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def write_json(path: Path, value: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def packet_fixture() -> dict:
    return {
        "kind": "open_files_drive_approval_note_template_packet",
        "status": "templates_ready",
        "template_count": 1,
        "required_decisions": ["drive_abc12345"],
        "templates": [
            {
                "decision_id": "drive_abc12345",
                "scope": "acl-owner-approval",
                "task_id_sha256": "a" * 64,
                "title_sha256": "b" * 64,
                "root_type": "my_drive",
                "business_area": "people",
                "approval_type": "acl_owner_approval",
                "primary_row_hint": 1537,
                "source_doc_hashes": [
                    {"path": "docs/open-files-acl-my-drive-people-review-prep-2026-06-09.md", "present": True, "bytes": 10, "sha256": "1" * 64}
                ],
            }
        ],
    }


def valid_note(text: str) -> dict:
    return {
        "kind": "open_files_drive_approval_note",
        "version": 1,
        "decision_id": "drive_abc12345",
        "status": "approved",
        "scope": "acl-owner-approval",
        "approved_by": "operator",
        "approved_at": "2026-06-17T13:00:00Z",
        "approval_note": text,
        "queue_entry_context": {
            "task_id_sha256": "a" * 64,
            "title_sha256": "b" * 64,
            "root_type": "my_drive",
            "business_area": "people",
            "approval_type": "acl_owner_approval",
            "primary_row_hint": 1537,
            "source_doc_hashes": [
                {"path": "docs/open-files-acl-my-drive-people-review-prep-2026-06-09.md", "present": True, "bytes": 10, "sha256": "1" * 64}
            ],
        },
    }


class ValidateDriveApprovalNotesTest(unittest.TestCase):
    def setUp(self) -> None:
        self.module = load_module()

    def test_missing_notes_are_reported_without_failure(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            summary = self.module.build_summary(
                root / "missing",
                ["drive_abc12345"],
                packet_fixture(),
                source_artifacts=[],
            )

        self.assertEqual(summary["status"], "missing_required")
        self.assertEqual(summary["artifact_count"], 0)
        self.assertEqual(summary["missing_required_decisions"], ["drive_abc12345"])
        self.assertTrue(summary["redaction_check"]["passed"])

    def test_private_note_text_is_hashed_not_echoed(self) -> None:
        private_text = "private Drive approval context"
        expected_hash = hashlib.sha256(private_text.encode("utf-8")).hexdigest()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            notes = root / "notes"
            write_json(notes / "drive_abc12345.json", valid_note(private_text))
            summary = self.module.build_summary(
                notes,
                ["drive_abc12345"],
                packet_fixture(),
                source_artifacts=[],
            )

        serialized = json.dumps(summary, sort_keys=True)
        self.assertEqual(summary["status"], "approved")
        self.assertIn(expected_hash, serialized)
        self.assertNotIn(private_text, serialized)
        self.assertTrue(summary["required_decisions"][0]["context_matches"])

    def test_request_context_mismatch_is_invalid(self) -> None:
        note = valid_note("approve people ACL slice")
        note["queue_entry_context"]["business_area"] = "finance"
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            notes = root / "notes"
            write_json(notes / "drive_abc12345.json", note)
            summary = self.module.build_summary(
                notes,
                ["drive_abc12345"],
                packet_fixture(),
                source_artifacts=[],
            )

        self.assertEqual(summary["status"], "invalid")
        self.assertEqual(summary["invalid_required_decisions"], ["drive_abc12345"])
        self.assertIn("context_business_area_mismatch", summary["required_decisions"][0]["errors"])

    def test_approval_like_json_requires_note_kind_and_version(self) -> None:
        note = valid_note("approve people ACL slice")
        note["kind"] = "open_files_drive_approval_note_template_packet"
        note.pop("version")
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            notes = root / "notes"
            write_json(notes / "drive_abc12345.json", note)
            summary = self.module.build_summary(
                notes,
                ["drive_abc12345"],
                packet_fixture(),
                source_artifacts=[],
            )

        self.assertEqual(summary["status"], "invalid")
        self.assertEqual(summary["invalid_required_decisions"], ["drive_abc12345"])
        item = summary["required_decisions"][0]
        self.assertFalse(item["valid"])
        self.assertIn("invalid_kind", item["errors"])
        self.assertIn("invalid_version", item["errors"])


if __name__ == "__main__":
    unittest.main()
