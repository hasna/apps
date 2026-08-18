#!/usr/bin/env python3
"""Offline tests for redacted derived search-index population planning."""

from __future__ import annotations

import json
import sqlite3
import subprocess
import tempfile
import unittest
from pathlib import Path


SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "plan_search_index_population.py"


def setup_db(path: Path, with_search_documents: bool = True) -> None:
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
          acl_review_status TEXT
        );
        """
    )
    if with_search_documents:
        db.executescript(
            """
            CREATE TABLE file_search_documents (
              id TEXT PRIMARY KEY,
              file_id TEXT,
              kind TEXT,
              status TEXT
            );
            """
        )
    rows = [
        ("f_missing_text", "private-notes.md", "text/markdown", "md", 10_000, "active", "workspace", "approved", "ok"),
        ("f_indexed_pdf", "private-contract.pdf", "application/pdf", "pdf", 2_000_000, "active", "legal", "approved", "ok"),
        ("f_stale_image", "private-scan.png", "image/png", "png", 300_000, "active", "finance", "approved", "ok"),
        ("f_duplicate_pdf", "private-dupe.pdf", "application/pdf", "pdf", 3_000_000, "active", "legal", "duplicate", "ok"),
    ]
    for row in rows:
        db.execute(
            "INSERT INTO files (id, name, mime, ext, size, status) VALUES (?, ?, ?, ?, ?, ?)",
            row[:6],
        )
        db.execute(
            "INSERT INTO file_organization_reviews (file_id, owner, review_status, acl_review_status) VALUES (?, ?, ?, ?)",
            (row[0], row[6], row[7], row[8]),
        )
    if with_search_documents:
        db.execute(
            "INSERT INTO file_search_documents (id, file_id, kind, status) VALUES (?, ?, ?, ?)",
            ("doc_ready", "f_indexed_pdf", "extraction_summary", "ready"),
        )
        db.execute(
            "INSERT INTO file_search_documents (id, file_id, kind, status) VALUES (?, ?, ?, ?)",
            ("doc_stale", "f_stale_image", "ocr_text", "stale"),
        )
    db.commit()
    db.close()


def run_planner(*args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["python3", str(SCRIPT), *args],
        check=False,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )


def write_approval_note(path: Path, decision_id: str = "search_index_population", note: str = "approved from private file") -> None:
    path.write_text(
        json.dumps(
            {
                "kind": "open_files_operator_approval_note",
                "version": 1,
                "decision_id": decision_id,
                "status": "approved",
                "scope": "canary",
                "approved_by": "operator",
                "approved_at": "2026-06-16T15:00:00Z",
                "approval_note": note,
            },
            sort_keys=True,
        ),
        encoding="utf-8",
    )


class SearchIndexPopulationPlannerTests(unittest.TestCase):
    def test_plan_is_redacted_and_writes_private_shards_for_missing_or_stale_rows(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            db = root / "files.db"
            output = root / "plan"
            setup_db(db)
            proc = run_planner(
                "--db",
                str(db),
                "--output-dir",
                str(output),
                "--jobs-per-shard",
                "1",
                "--campaign-id",
                "search-index-test",
            )
            self.assertEqual(proc.returncode, 0, proc.stderr)
            summary = json.loads(proc.stdout)
            plan = json.loads((output / "search-index-population-plan.json").read_text(encoding="utf-8"))
            shard_text = "\n".join(
                path.read_text(encoding="utf-8")
                for path in sorted((output / "shards").glob("*.jsonl"))
            )

        self.assertEqual(summary["status"], "approval_required")
        self.assertFalse(summary["approved"])
        self.assertEqual(summary["declared_active_files"], 4)
        self.assertEqual(summary["declared_exempt_files"], 1)
        self.assertTrue(summary["declared_reconciled"])
        self.assertEqual(summary["active_files"], 3)
        self.assertEqual(summary["indexed_files"], 1)
        self.assertEqual(summary["missing_files"], 1)
        self.assertEqual(summary["stale_only_files"], 1)
        self.assertEqual(summary["jobs_planned"], 2)
        self.assertEqual(summary["shards"], 2)
        self.assertEqual(plan["approval_attestation"]["status"], "approval_required")
        self.assertFalse(plan["approval_attestation"]["approval_note_present"])
        self.assertEqual(plan["declared_totals"]["active_files"], 4)
        self.assertEqual(plan["declared_totals"]["planned_jobs"], 2)
        self.assertEqual(plan["declared_totals"]["already_indexed_files"], 1)
        self.assertEqual(plan["declared_totals"]["exempt_files"], 1)
        self.assertEqual(plan["declared_totals"]["unplanned_in_scope_files"], 0)
        self.assertTrue(plan["declared_totals"]["reconciled"])
        outcome_counts = {row["key"]: row["count"] for row in plan["completeness"]["aggregate"]["by_outcome"]}
        self.assertEqual(outcome_counts, {"already_indexed": 1, "exempt_duplicate": 1, "planned": 2})
        self.assertEqual(plan["planned"]["aggregate"]["totals"]["rows"], 2)
        self.assertEqual(plan["planned"]["aggregate"]["totals"]["dimensions"]["by_lane"]["count"], 2)
        self.assertEqual(plan["coverage"]["aggregate"]["totals"]["rows"], 3)
        public_text = proc.stdout + json.dumps(plan)
        self.assertNotIn("f_missing_text", public_text)
        self.assertNotIn("private-notes", public_text)
        self.assertNotIn("private-contract", public_text)
        self.assertNotIn("private-scan", public_text)
        self.assertIn("f_missing_text", shard_text)
        self.assertIn("text-snapshot-to-search-index", shard_text)

    def test_include_indexed_adds_ready_rows_to_private_work(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            db = root / "files.db"
            output = root / "plan"
            setup_db(db)
            proc = run_planner("--db", str(db), "--output-dir", str(output), "--include-indexed")
            self.assertEqual(proc.returncode, 0, proc.stderr)
            summary = json.loads(proc.stdout)
            shard_rows = [
                json.loads(line)
                for line in (output / "shards" / "shard-0001.jsonl").read_text(encoding="utf-8").splitlines()
                if line.strip()
            ]

        self.assertEqual(summary["jobs_planned"], 3)
        self.assertIn("f_indexed_pdf", {row["file_id"] for row in shard_rows})

    def test_lane_filter_and_per_lane_cap_balance_private_work(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            db = root / "files.db"
            output = root / "plan"
            setup_db(db)
            proc = run_planner(
                "--db",
                str(db),
                "--output-dir",
                str(output),
                "--lanes",
                "readable_now_text,needs_ocr_or_vision",
                "--max-jobs-per-lane",
                "1",
            )
            self.assertEqual(proc.returncode, 0, proc.stderr)
            plan = json.loads((output / "search-index-population-plan.json").read_text(encoding="utf-8"))

        self.assertEqual(plan["jobs_planned"], 2)
        lane_counts = {row["key"]: row["count"] for row in plan["planned"]["aggregate"]["by_lane"]}
        self.assertEqual(lane_counts, {"needs_ocr_or_vision": 1, "readable_now_text": 1})
        outcome_counts = {row["key"]: row["count"] for row in plan["completeness"]["aggregate"]["by_outcome"]}
        self.assertEqual(outcome_counts["exempt_lane_not_selected"], 1)
        self.assertEqual(outcome_counts["exempt_duplicate"], 1)

    def test_exclude_lanes_omits_deferred_media_work(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            db_path = root / "files.db"
            output = root / "plan"
            setup_db(db_path)
            db = sqlite3.connect(db_path)
            for row in [
                ("f_private_audio", "private-audio.m4a", "audio/mp4", "m4a", 4_000_000, "active", "archive", "approved", "ok"),
                ("f_private_video", "private-video.mp4", "video/mp4", "mp4", 5_000_000, "active", "product", "approved", "ok"),
            ]:
                db.execute(
                    "INSERT INTO files (id, name, mime, ext, size, status) VALUES (?, ?, ?, ?, ?, ?)",
                    row[:6],
                )
                db.execute(
                    "INSERT INTO file_organization_reviews (file_id, owner, review_status, acl_review_status) VALUES (?, ?, ?, ?)",
                    (row[0], row[6], row[7], row[8]),
                )
            db.commit()
            db.close()
            proc = run_planner(
                "--db",
                str(db_path),
                "--output-dir",
                str(output),
                "--exclude-lanes",
                "needs_transcription,needs_video_pipeline",
            )
            self.assertEqual(proc.returncode, 0, proc.stderr)
            plan = json.loads((output / "search-index-population-plan.json").read_text(encoding="utf-8"))

        self.assertEqual(plan["exclude_lanes"], ["needs_transcription", "needs_video_pipeline"])
        self.assertEqual(plan["declared_totals"]["active_files"], 6)
        outcome_counts = {row["key"]: row["count"] for row in plan["completeness"]["aggregate"]["by_outcome"]}
        self.assertEqual(outcome_counts["exempt_excluded_lane"], 2)
        lane_counts = {row["key"]: row["count"] for row in plan["planned"]["aggregate"]["by_lane"]}
        self.assertNotIn("needs_transcription", lane_counts)
        self.assertNotIn("needs_video_pipeline", lane_counts)

    def test_missing_search_document_table_treats_active_non_duplicates_as_missing(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            db = root / "files.db"
            output = root / "plan"
            setup_db(db, with_search_documents=False)
            proc = run_planner("--db", str(db), "--output-dir", str(output))
            self.assertEqual(proc.returncode, 0, proc.stderr)
            summary = json.loads(proc.stdout)

        self.assertEqual(summary["active_files"], 3)
        self.assertEqual(summary["declared_active_files"], 4)
        self.assertEqual(summary["declared_exempt_files"], 1)
        self.assertEqual(summary["indexed_files"], 0)
        self.assertEqual(summary["missing_files"], 3)
        self.assertEqual(summary["jobs_planned"], 3)

    def test_invalid_jobs_per_shard_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            db = root / "files.db"
            setup_db(db)
            proc = run_planner("--db", str(db), "--output-dir", str(root / "plan"), "--jobs-per-shard", "0")

        self.assertNotEqual(proc.returncode, 0)
        self.assertIn("--jobs-per-shard must be positive", proc.stderr)

    def test_approved_plan_requires_note(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            db = root / "files.db"
            setup_db(db)
            proc = run_planner("--db", str(db), "--output-dir", str(root / "plan"), "--approved")

        self.assertNotEqual(proc.returncode, 0)
        self.assertIn("--approval-note or --approval-note-file is required", proc.stderr)

    def test_approved_plan_records_approval_gate_without_public_private_ids(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            db = root / "files.db"
            output = root / "plan"
            setup_db(db)
            proc = run_planner(
                "--db",
                str(db),
                "--output-dir",
                str(output),
                "--approved",
                "--approval-note",
                "approved-test",
            )
            self.assertEqual(proc.returncode, 0, proc.stderr)
            summary = json.loads(proc.stdout)
            plan = json.loads((output / "search-index-population-plan.json").read_text(encoding="utf-8"))

        self.assertEqual(summary["status"], "approved")
        self.assertTrue(summary["approved"])
        self.assertTrue(plan["approval_gate"]["approved"])
        self.assertEqual(plan["approval_attestation"]["status"], "approved")
        self.assertTrue(plan["approval_attestation"]["approval_note_present"])
        self.assertRegex(plan["approval_attestation"]["approval_note_sha256"], r"^[a-f0-9]{64}$")
        self.assertNotIn("f_missing_text", proc.stdout + json.dumps(plan))

    def test_approved_plan_accepts_private_approval_note_file_without_storing_note_text(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            db = root / "files.db"
            output = root / "plan"
            note_path = root / "approval-note.json"
            setup_db(db)
            write_approval_note(note_path, note="private approval text")
            proc = run_planner(
                "--db",
                str(db),
                "--output-dir",
                str(output),
                "--approved",
                "--approval-note-file",
                str(note_path),
            )
            self.assertEqual(proc.returncode, 0, proc.stderr)
            plan = json.loads((output / "search-index-population-plan.json").read_text(encoding="utf-8"))

        self.assertTrue(plan["approved"])
        self.assertIsNone(plan["approval_note"])
        self.assertEqual(plan["approval_attestation"]["approval_note_source"], "file_json")
        self.assertEqual(plan["approval_attestation"]["approval_note_decision_id"], "search_index_population")
        self.assertTrue(plan["approval_attestation"]["approval_note_present"])
        self.assertRegex(plan["approval_attestation"]["approval_note_sha256"], r"^[a-f0-9]{64}$")
        self.assertNotIn("private approval text", json.dumps(plan))


if __name__ == "__main__":
    unittest.main()
