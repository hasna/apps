#!/usr/bin/env python3
"""Offline tests for Drive approval queue verification."""

from __future__ import annotations

import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path


SCRIPT_DIR = Path(__file__).resolve().parents[1] / "scripts"
BUILDER_SCRIPT = SCRIPT_DIR / "build_drive_approval_queue.py"
VERIFIER_SCRIPT = SCRIPT_DIR / "verify_drive_approval_queue.py"


def load_module(name: str, path: Path):
    if str(SCRIPT_DIR) not in sys.path:
        sys.path.insert(0, str(SCRIPT_DIR))
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"failed to load {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def ready_todos_fixture() -> list[dict[str, object]]:
    return [
        {
            "id": "my-drive-people-approval",
            "title": "Collect My Drive People ACL approvals",
            "description": "Review 1,537 My Drive rows.",
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
    ]


def write_doc(root: Path, rel: str) -> None:
    path = root / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("# Aggregate prep\n\nCounts only.\n", encoding="utf-8")


def write_required_docs(root: Path) -> None:
    for rel in (
        "docs/open-files-acl-my-drive-people-review-prep-2026-06-09.md",
        "docs/open-files-acl-shared-drive-legal-review-prep-2026-06-09.md",
    ):
        write_doc(root, rel)


class DriveApprovalQueueVerifierTest(unittest.TestCase):
    def setUp(self) -> None:
        self.builder = load_module("build_drive_approval_queue", BUILDER_SCRIPT)
        self.verifier = load_module("verify_drive_approval_queue", VERIFIER_SCRIPT)

    def build_artifact(self, root: Path) -> tuple[Path, list[dict[str, object]]]:
        write_required_docs(root)
        ready_path = root / "ready-todos.json"
        ready_path.write_text(json.dumps(ready_todos_fixture()), encoding="utf-8")
        artifact = self.builder.build_queue(
            ready_todos=ready_todos_fixture(),
            source_artifacts=[self.builder.source_entry("ready_todos_fixture", ready_path)],
            source_docs=self.builder.discover_source_docs(root),
        )
        queue_path = root / "drive-approval-queue.json"
        queue_path.write_text(json.dumps(artifact, indent=2, sort_keys=True), encoding="utf-8")
        return queue_path, ready_todos_fixture()

    def test_verifies_current_docs_and_ready_todos(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            queue_path, ready_todos = self.build_artifact(root)
            result = self.verifier.verify_queue(
                queue_path,
                ready_todos=ready_todos,
                check_ready_todos=True,
                check_current_docs=True,
                doc_root=root,
            )

        self.assertEqual(result["status"], "ok")
        self.assertTrue(result["gates"]["source_doc_current_hashes_ok"])
        self.assertTrue(result["gates"]["ready_todos_current_semantics_ok"])
        self.assertEqual(result["summary"]["ready_drive_approval_tasks"], 2)

    def test_detects_stale_source_doc_hash(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            queue_path, ready_todos = self.build_artifact(root)
            changed = root / "docs/open-files-acl-my-drive-people-review-prep-2026-06-09.md"
            changed.write_text("# Changed\n", encoding="utf-8")
            result = self.verifier.verify_queue(
                queue_path,
                ready_todos=ready_todos,
                check_ready_todos=True,
                check_current_docs=True,
                doc_root=root,
            )

        self.assertEqual(result["status"], "error")
        self.assertIn(
            "source_doc_current_hash_mismatch:docs/open-files-acl-my-drive-people-review-prep-2026-06-09.md",
            result["errors"],
        )

    def test_detects_sensitive_marker_without_echoing_private_value(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            queue_path, ready_todos = self.build_artifact(root)
            artifact = json.loads(queue_path.read_text(encoding="utf-8"))
            artifact["source_ref"] = "open-files://hidden"
            queue_path.write_text(json.dumps(artifact, indent=2, sort_keys=True), encoding="utf-8")
            result = self.verifier.verify_queue(
                queue_path,
                ready_todos=ready_todos,
                check_ready_todos=False,
                check_current_docs=False,
                doc_root=root,
            )

        self.assertEqual(result["status"], "error")
        self.assertIn("sensitive_marker_hits", result["errors"])
        self.assertNotIn("hidden", json.dumps(result, sort_keys=True))


if __name__ == "__main__":
    unittest.main()
