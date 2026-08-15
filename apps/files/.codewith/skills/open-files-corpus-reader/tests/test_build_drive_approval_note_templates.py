#!/usr/bin/env python3
"""Tests for Drive approval-note template generation."""

from __future__ import annotations

import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path


SCRIPT_DIR = Path(__file__).resolve().parents[1] / "scripts"
SCRIPT = SCRIPT_DIR / "build_drive_approval_note_templates.py"
VALIDATOR = SCRIPT_DIR / "validate_drive_approval_notes.py"


def load_module(name: str, path: Path):
    if str(SCRIPT_DIR) not in sys.path:
        sys.path.insert(0, str(SCRIPT_DIR))
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"failed to load {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def write_json(path: Path, value: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def queue_fixture() -> dict:
    return {
        "kind": "open_files_drive_approval_queue",
        "version": 1,
        "status": "operator_drive_approval_required",
        "summary": {
            "ready_drive_approval_tasks": 2,
            "expected_source_docs_missing": [],
        },
        "queue_entries": [
            {
                "task_id_short": "abc12345",
                "task_id_sha256": "a" * 64,
                "title": "Collect My Drive People ACL approvals",
                "title_sha256": "b" * 64,
                "priority": "critical",
                "requires_approval": True,
                "root_type": "my_drive",
                "business_area": "people",
                "approval_type": "acl_owner_approval",
                "primary_row_hint": 1537,
                "count_hints": [{"kind": "my_drive_rows", "value": 1537}],
                "expected_source_docs": [{"path": "docs/open-files-acl-my-drive-people-review-prep-2026-06-09.md", "present": True}],
            },
            {
                "task_id_short": "def67890",
                "task_id_sha256": "c" * 64,
                "title": "Review unassigned duplicate groups and assign owners",
                "title_sha256": "d" * 64,
                "priority": "critical",
                "requires_approval": True,
                "root_type": "duplicate_groups",
                "business_area": "unassigned",
                "approval_type": "duplicate_owner_assignment",
                "primary_row_hint": 404,
                "count_hints": [{"kind": "groups", "value": 180}, {"kind": "rows", "value": 404}],
                "expected_source_docs": [{"path": "docs/open-files-duplicate-unassigned-review-prep-2026-06-09.md", "present": True}],
            },
        ],
        "source_docs": [
            {
                "path": "docs/open-files-acl-my-drive-people-review-prep-2026-06-09.md",
                "present": True,
                "bytes": 10,
                "sha256": "1" * 64,
            },
            {
                "path": "docs/open-files-duplicate-unassigned-review-prep-2026-06-09.md",
                "present": True,
                "bytes": 11,
                "sha256": "2" * 64,
            },
        ],
    }


class BuildDriveApprovalNoteTemplatesTest(unittest.TestCase):
    def setUp(self) -> None:
        self.builder = load_module("build_drive_approval_note_templates", SCRIPT)
        self.validator = load_module("validate_drive_approval_notes", VALIDATOR)

    def test_builds_private_templates_and_redacted_packet(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            queue = root / "queue.json"
            queue_verification = root / "queue-verification.json"
            notes_summary = root / "notes-summary.json"
            templates = root / "templates"
            write_json(queue, queue_fixture())
            write_json(queue_verification, {"kind": "open_files_drive_approval_queue_verification", "status": "ok", "queue_status": "operator_drive_approval_required"})
            write_json(notes_summary, {"kind": "open_files_drive_approval_notes_summary", "status": "missing_required", "approved_required_decision_count": 0})

            packet = self.builder.build_templates(
                queue=queue_fixture(),
                queue_verification=json.loads(queue_verification.read_text(encoding="utf-8")),
                notes_summary=json.loads(notes_summary.read_text(encoding="utf-8")),
                output_dir=templates,
                expires_at=None,
                sources=[
                    self.builder.source_entry("drive_approval_queue", queue),
                    self.builder.source_entry("drive_approval_queue_verification", queue_verification),
                    self.builder.source_entry("drive_approval_notes_summary", notes_summary),
                ],
            )
            template_exists = (templates / "drive_abc12345.template.json").exists()

        self.assertEqual(packet["status"], "templates_ready")
        self.assertEqual(packet["template_count"], 2)
        self.assertTrue(packet["redaction_check"]["passed"])
        self.assertEqual(packet["required_decisions"], ["drive_abc12345", "drive_def67890"])
        by_decision = {item["decision_id"]: item for item in packet["templates"]}
        self.assertEqual(by_decision["drive_abc12345"]["scope"], "acl-owner-approval")
        self.assertEqual(by_decision["drive_def67890"]["scope"], "duplicate-owner-assignment")
        self.assertTrue(template_exists)
        serialized = json.dumps(packet, sort_keys=True)
        self.assertNotIn("open-files://", serialized)
        self.assertNotIn('"file_id"', serialized)

    def test_templates_are_ignored_as_approval_notes(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            templates = root / "templates"
            packet = self.builder.build_templates(
                queue=queue_fixture(),
                queue_verification={"status": "ok", "queue_status": "operator_drive_approval_required"},
                notes_summary=None,
                output_dir=templates,
                expires_at=None,
                sources=[],
            )
            summary = self.validator.build_summary(
                templates,
                packet["required_decisions"],
                packet,
                source_artifacts=[],
            )

        self.assertEqual(summary["status"], "missing_required")
        self.assertEqual(summary["artifact_count"], 0)
        self.assertEqual(len(summary["missing_required_decisions"]), 2)


if __name__ == "__main__":
    unittest.main()
