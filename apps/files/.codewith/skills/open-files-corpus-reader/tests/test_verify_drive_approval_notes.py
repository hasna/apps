#!/usr/bin/env python3
"""Tests for Drive approval packet/summary verification."""

from __future__ import annotations

import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path


SCRIPT_DIR = Path(__file__).resolve().parents[1] / "scripts"
BUILDER = SCRIPT_DIR / "build_drive_approval_note_templates.py"
VALIDATOR = SCRIPT_DIR / "validate_drive_approval_notes.py"
VERIFIER = SCRIPT_DIR / "verify_drive_approval_notes.py"


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
        "summary": {"ready_drive_approval_tasks": 1, "expected_source_docs_missing": []},
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
            }
        ],
        "source_docs": [
            {
                "path": "docs/open-files-acl-my-drive-people-review-prep-2026-06-09.md",
                "present": True,
                "bytes": 10,
                "sha256": "1" * 64,
            }
        ],
    }


class VerifyDriveApprovalNotesTest(unittest.TestCase):
    def setUp(self) -> None:
        self.builder = load_module("build_drive_approval_note_templates", BUILDER)
        self.validator = load_module("validate_drive_approval_notes", VALIDATOR)
        self.verifier = load_module("verify_drive_approval_notes", VERIFIER)

    def build_artifacts(self, root: Path) -> tuple[Path, Path, Path, Path]:
        queue_path = root / "queue.json"
        queue_verification_path = root / "queue-verification.json"
        notes_summary_path = root / "notes-summary.json"
        packet_path = root / "request-packet.json"
        templates = root / "templates"
        write_json(queue_path, queue_fixture())
        write_json(queue_verification_path, {"kind": "open_files_drive_approval_queue_verification", "status": "ok", "queue_status": "operator_drive_approval_required"})
        initial_summary = {"kind": "open_files_drive_approval_notes_summary", "status": "missing_required", "approved_required_decision_count": 0}
        write_json(notes_summary_path, initial_summary)
        packet = self.builder.build_templates(
            queue=queue_fixture(),
            queue_verification=json.loads(queue_verification_path.read_text(encoding="utf-8")),
            notes_summary=initial_summary,
            output_dir=templates,
            expires_at=None,
            sources=[
                self.builder.source_entry("drive_approval_queue", queue_path),
                self.builder.source_entry("drive_approval_queue_verification", queue_verification_path),
                self.builder.source_entry("drive_approval_notes_summary", notes_summary_path),
            ],
        )
        write_json(packet_path, packet)
        summary = self.validator.build_summary(
            root / "notes",
            packet["required_decisions"],
            packet,
            source_artifacts=[self.validator.source_entry("drive_approval_request_packet", packet_path)],
        )
        write_json(notes_summary_path, summary)
        return packet_path, notes_summary_path, queue_path, queue_verification_path

    def test_verifies_missing_required_state(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            packet, summary, queue, queue_verification = self.build_artifacts(root)
            result = self.verifier.verify_artifacts(
                packet_path=packet,
                summary_path=summary,
                packet_source_paths={
                    "drive_approval_queue": queue,
                    "drive_approval_queue_verification": queue_verification,
                    "drive_approval_notes_summary": summary,
                },
                summary_source_paths={"drive_approval_request_packet": packet},
            )

        self.assertEqual(result["status"], "ok")
        self.assertEqual(result["notes_status"], "missing_required")
        self.assertEqual(result["template_count"], 1)

    def test_detects_stale_queue_source_hash(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            packet, summary, queue, queue_verification = self.build_artifacts(root)
            write_json(queue, {"kind": "changed"})
            result = self.verifier.verify_artifacts(
                packet_path=packet,
                summary_path=summary,
                packet_source_paths={
                    "drive_approval_queue": queue,
                    "drive_approval_queue_verification": queue_verification,
                    "drive_approval_notes_summary": summary,
                },
                summary_source_paths={"drive_approval_request_packet": packet},
            )

        self.assertEqual(result["status"], "error")
        self.assertIn("packet_source_artifact_current_hash_mismatch:drive_approval_queue", result["errors"])


if __name__ == "__main__":
    unittest.main()
