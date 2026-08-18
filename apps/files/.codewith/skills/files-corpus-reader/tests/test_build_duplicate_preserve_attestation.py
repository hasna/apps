#!/usr/bin/env python3
"""Offline tests for duplicate-preserve aggregate attestation."""

from __future__ import annotations

import json
import sqlite3
import subprocess
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "build_duplicate_preserve_attestation.py"


def run_script(*args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["python3", str(SCRIPT), *args],
        check=False,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )


def setup_db(path: Path, missing_survivor: bool = False) -> None:
    db = sqlite3.connect(path)
    db.executescript(
        """
        CREATE TABLE files (
          id TEXT PRIMARY KEY,
          name TEXT,
          mime TEXT,
          ext TEXT,
          size INTEGER,
          status TEXT
        );
        CREATE TABLE file_organization_reviews (
          file_id TEXT PRIMARY KEY,
          owner TEXT,
          review_status TEXT,
          duplicate_group_id TEXT,
          acl_review_status TEXT
        );
        CREATE TABLE file_search_documents (
          id TEXT PRIMARY KEY,
          file_id TEXT,
          kind TEXT,
          status TEXT
        );
        """
    )
    rows = [
        ("f_survivor_private", "private-survivor.pdf", "application/pdf", "pdf", 100, "active", "legal", "approved", "dup_a"),
        ("f_duplicate_private", "private-duplicate.pdf", "application/pdf", "pdf", 100, "active", "legal", "duplicate", "dup_a"),
    ]
    if missing_survivor:
        rows[0] = ("f_survivor_private", "private-survivor.pdf", "application/pdf", "pdf", 100, "active", "legal", "duplicate", "dup_a")
    for row in rows:
        db.execute(
            "INSERT INTO files (id, name, mime, ext, size, status) VALUES (?, ?, ?, ?, ?, ?)",
            row[:6],
        )
        db.execute(
            "INSERT INTO file_organization_reviews (file_id, owner, review_status, duplicate_group_id, acl_review_status) VALUES (?, ?, ?, ?, 'ok')",
            (row[0], row[6], row[7], row[8]),
        )
    db.commit()
    db.close()


def write_plan(root: Path, include_survivor: bool = True) -> Path:
    shard = root / "shards" / "shard-0001.jsonl"
    shard.parent.mkdir(parents=True, exist_ok=True)
    shard_rows = []
    if include_survivor:
        shard_rows.append({"file_id": "f_survivor_private", "size": 100, "lane": "needs_pdf_extractor"})
    shard.write_text("".join(json.dumps(row, sort_keys=True) + "\n" for row in shard_rows), encoding="utf-8")
    plan = {
        "status": "approval_required",
        "approved": False,
        "include_duplicates": False,
        "jobs_planned": len(shard_rows),
        "coverage": {"indexed_files": 0, "missing_files": len(shard_rows), "stale_only_files": 0},
        "declared_totals": {
            "active_files": 2,
            "active_bytes": 200,
            "planned_jobs": len(shard_rows),
            "planned_bytes": 100 if include_survivor else 0,
            "already_indexed_files": 0,
            "already_indexed_bytes": 0,
            "exempt_files": 1,
            "exempt_bytes": 100,
            "unplanned_in_scope_files": 0,
            "unplanned_in_scope_bytes": 0,
            "reconciled_files": 2 if include_survivor else 1,
            "reconciled": include_survivor,
        },
        "completeness": {
            "aggregate": {
                "by_outcome": [
                    {"key": "planned", "count": len(shard_rows), "bytes": 100 if include_survivor else 0},
                    {"key": "exempt_duplicate", "count": 1, "bytes": 100},
                ],
                "by_outcome_coverage": [
                    {"key": "planned|missing", "count": len(shard_rows), "bytes": 100 if include_survivor else 0},
                    {"key": "exempt_duplicate|missing", "count": 1, "bytes": 100},
                ],
            }
        },
        "shard_entries": [{"shard": "shard-0001", "jobs": len(shard_rows), "manifest": str(shard)}],
    }
    path = root / "search-index-population-plan.json"
    path.write_text(json.dumps(plan, indent=2, sort_keys=True), encoding="utf-8")
    return path


class DuplicatePreserveAttestationTests(unittest.TestCase):
    def test_attestation_is_aggregate_only_and_accepts_planned_survivor(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            db = root / "files.db"
            setup_db(db)
            plan = write_plan(root)
            proc = run_script("--db", str(db), "--plan", str(plan), "--output", str(root / "attestation.json"))

        self.assertEqual(proc.returncode, 0, proc.stderr)
        attestation = json.loads(proc.stdout)
        self.assertEqual(attestation["status"], "attested_with_pending_index")
        self.assertTrue(attestation["policy_ok"])
        self.assertFalse(attestation["search_index_ready"])
        self.assertEqual(attestation["planner_reconciliation"]["exempt_duplicate_rows"], 1)
        self.assertEqual(attestation["organization_duplicates"]["active_duplicate_groups"], 1)
        self.assertEqual(attestation["organization_duplicates"]["groups_without_planned_or_indexed_survivor"], 0)
        self.assertFalse(attestation["scale_readiness"]["approved_to_scale"])
        self.assertNotIn("f_survivor_private", proc.stdout)
        self.assertNotIn("private-survivor", proc.stdout)
        self.assertNotIn('"file_id"', proc.stdout)

    def test_attestation_blocks_duplicate_group_without_survivor(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            db = root / "files.db"
            setup_db(db, missing_survivor=True)
            plan = write_plan(root, include_survivor=False)
            proc = run_script("--db", str(db), "--plan", str(plan), "--output", str(root / "attestation.json"))

        self.assertNotEqual(proc.returncode, 0)
        attestation = json.loads(proc.stdout)
        self.assertEqual(attestation["status"], "blocked")
        self.assertEqual(attestation["organization_duplicates"]["groups_without_active_survivor"], 1)
        self.assertIn("active duplicate groups without an active survivor", attestation["blockers"])
        self.assertNotIn("f_duplicate_private", proc.stdout)


if __name__ == "__main__":
    unittest.main()
