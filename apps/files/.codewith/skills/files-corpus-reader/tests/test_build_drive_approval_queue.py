#!/usr/bin/env python3
"""Offline tests for the aggregate Drive approval queue builder."""

from __future__ import annotations

import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path


SCRIPT_DIR = Path(__file__).resolve().parents[1] / "scripts"
SCRIPT = SCRIPT_DIR / "build_drive_approval_queue.py"


def load_module():
    if str(SCRIPT_DIR) not in sys.path:
        sys.path.insert(0, str(SCRIPT_DIR))
    spec = importlib.util.spec_from_file_location("build_drive_approval_queue", SCRIPT)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"failed to load {SCRIPT}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def ready_todos_fixture() -> list[dict[str, object]]:
    return [
        {
            "id": "my-drive-people-approval",
            "title": "Collect My Drive People ACL approvals",
            "description": "Review aggregate prep doc for 1,537 My Drive rows. Private source open-files://hidden is intentionally not copied.",
            "requires_approval": True,
            "priority": "critical",
            "tags": ["acl", "google-drive", "my-drive", "open-files", "owners", "people"],
        },
        {
            "id": "shared-drive-legal-approval",
            "title": "Collect shared-drive Legal ACL approvals",
            "description": "Review 729 shared_drive rows.",
            "requires_approval": True,
            "priority": "critical",
            "tags": ["acl", "google-drive", "legal", "open-files", "owners", "shared-drive"],
        },
        {
            "id": "duplicate-unassigned-approval",
            "title": "Review unassigned duplicate groups and assign owners",
            "description": "Resolve 180 groups / 404 rows.",
            "requires_approval": True,
            "priority": "critical",
            "tags": ["duplicates", "google-drive", "open-files", "owners", "unassigned"],
        },
        {
            "id": "metadata-apply-approval",
            "title": "Apply approved metadata-only Drive policy and export audit",
            "description": "Apply only after approval.",
            "requires_approval": True,
            "priority": "high",
            "tags": ["apply", "audit", "google-drive", "metadata", "open-files"],
        },
        {
            "id": "media-final-pass",
            "title": "Defer media final pass",
            "description": "Audio/video work is deferred.",
            "requires_approval": True,
            "priority": "low",
            "tags": ["audio", "google-drive", "open-files"],
        },
        {
            "id": "unrelated-approval",
            "title": "Unrelated approval",
            "description": "Not part of Drive approvals.",
            "requires_approval": True,
            "priority": "low",
            "tags": ["open-files", "approval"],
        },
    ]


def write_doc(root: Path, rel: str) -> None:
    path = root / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("# Aggregate prep\n\nCounts only.\n", encoding="utf-8")


def write_required_docs(root: Path) -> None:
    for rel in (
        "docs/open-files-acl-my-drive-people-review-prep-2026-06-09.md",
        "docs/open-files-acl-shared-drive-legal-review-prep-2026-06-09.md",
        "docs/open-files-duplicate-unassigned-review-prep-2026-06-09.md",
        "docs/open-files-drive-approval-gate-checklist-2026-06-09.md",
        "docs/open-files-drive-ready-approval-packet-2026-06-09.md",
        "docs/open-files-drive-organization-workflow.md",
    ):
        write_doc(root, rel)


class DriveApprovalQueueBuilderTest(unittest.TestCase):
    def setUp(self) -> None:
        self.module = load_module()

    def test_builds_redacted_aggregate_queue(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            write_required_docs(root)
            docs = self.module.discover_source_docs(root)
            artifact = self.module.build_queue(
                ready_todos=ready_todos_fixture(),
                source_artifacts=[{"label": "ready_todos_fixture", "present": True, "bytes": 100, "sha256": "a" * 64}],
                source_docs=docs,
            )

        self.assertEqual(artifact["status"], "operator_drive_approval_required")
        self.assertTrue(artifact["redaction_check"]["passed"])
        self.assertEqual(artifact["summary"]["ready_drive_approval_tasks"], 4)
        self.assertEqual(artifact["summary"]["tasks_requiring_approval"], 4)
        self.assertEqual(artifact["summary"]["row_hint_total"], 2670)
        self.assertEqual(artifact["summary"]["by_approval_type"]["acl_owner_approval"], 2)
        self.assertEqual(artifact["summary"]["by_approval_type"]["duplicate_owner_assignment"], 1)
        self.assertEqual(artifact["summary"]["by_approval_type"]["metadata_apply_and_audit"], 1)
        self.assertEqual(artifact["summary"]["expected_source_docs_missing"], [])
        serialized = json.dumps(artifact, sort_keys=True)
        self.assertNotIn("open-files://hidden", serialized)
        self.assertNotIn("description", serialized)

    def test_missing_expected_doc_requires_source_doc_prep(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            write_doc(root, "docs/open-files-acl-my-drive-people-review-prep-2026-06-09.md")
            docs = self.module.discover_source_docs(root)
            artifact = self.module.build_queue(
                ready_todos=ready_todos_fixture()[:2],
                source_artifacts=[{"label": "ready_todos_fixture", "present": True, "bytes": 100, "sha256": "a" * 64}],
                source_docs=docs,
            )

        self.assertEqual(artifact["status"], "needs_source_doc_prep")
        self.assertEqual(
            artifact["summary"]["expected_source_docs_missing"],
            ["docs/open-files-acl-shared-drive-legal-review-prep-2026-06-09.md"],
        )


if __name__ == "__main__":
    unittest.main()
