#!/usr/bin/env python3
"""Offline tests for redacted large-file extraction planning."""

from __future__ import annotations

import json
import sqlite3
import subprocess
import tempfile
import unittest
from pathlib import Path


SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "plan_large_file_extraction.py"
VALIDATOR = Path(__file__).resolve().parents[1] / "scripts" / "validate_large_file_extraction_plan.py"


def setup_db(path: Path) -> None:
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
    rows = [
        ("f_private_pdf", "private-contract.pdf", "application/pdf", "pdf", 20_000_000, "active", "legal", "approved", "ok"),
        ("f_private_docx", "private-doc.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "docx", 12_000_000, "active", "workspace", "approved", "ok"),
        ("f_private_zip", "private-archive.zip", "application/zip", "zip", 9_000_000, "active", "archive", "approved", "ok"),
        ("f_small_pdf", "small.pdf", "application/pdf", "pdf", 100_000, "active", "legal", "approved", "ok"),
        ("f_duplicate_pdf", "duplicate.pdf", "application/pdf", "pdf", 30_000_000, "active", "legal", "duplicate", "ok"),
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


def run_validator(*args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["python3", str(VALIDATOR), *args],
        check=False,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )


def write_approval_note(path: Path, decision_id: str = "large_file_canary", note: str = "approved from private file") -> None:
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


class LargeFilePlannerTests(unittest.TestCase):
    def test_plan_is_redacted_and_writes_private_shards(self) -> None:
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
                "--min-size-bytes",
                str(1024 * 1024),
                "--jobs-per-shard",
                "2",
                "--campaign-id",
                "large-test",
            )
            self.assertEqual(proc.returncode, 0, proc.stderr)
            summary = json.loads(proc.stdout)
            plan = json.loads((output / "large-file-extraction-plan.json").read_text(encoding="utf-8"))
            shard_text = (output / "shards" / "shard-0001.jsonl").read_text(encoding="utf-8")

        self.assertEqual(summary["status"], "approval_required")
        self.assertEqual(summary["jobs_planned"], 3)
        self.assertEqual(summary["shards"], 2)
        self.assertFalse(summary["approved"])
        self.assertEqual(plan["jobs_planned"], 3)
        self.assertEqual(plan["shard_entries"][0]["jobs"], 2)
        plan_text = json.dumps(plan)
        public_text = proc.stdout + plan_text
        self.assertNotIn("f_private_", public_text)
        self.assertNotIn("private-contract", public_text)
        self.assertNotIn("duplicate.pdf", public_text)
        self.assertIn("f_private_", shard_text)
        self.assertIn("large-pdf-windowed-text", shard_text)
        self.assertIn("large-office-private-conversion", shard_text)

    def test_lanes_filter_limits_planned_rows(self) -> None:
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
                "--min-size-bytes",
                str(1024 * 1024),
                "--lanes",
                "needs_archive_inventory",
            )
            self.assertEqual(proc.returncode, 0, proc.stderr)
            plan = json.loads((output / "large-file-extraction-plan.json").read_text(encoding="utf-8"))

        self.assertEqual(plan["jobs_planned"], 1)
        self.assertEqual(plan["aggregate"]["by_strategy"][0]["key"], "large-archive-inventory-only")

    def test_canary_size_bounds_and_order_select_smallest_eligible_rows(self) -> None:
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
                "--min-size-bytes",
                str(1024 * 1024),
                "--max-size-bytes",
                str(15 * 1024 * 1024),
                "--order",
                "size-asc",
                "--max-jobs",
                "1",
            )
            self.assertEqual(proc.returncode, 0, proc.stderr)
            plan = json.loads((output / "large-file-extraction-plan.json").read_text(encoding="utf-8"))
            shard_rows = [
                json.loads(line)
                for line in (output / "shards" / "shard-0001.jsonl").read_text(encoding="utf-8").splitlines()
                if line.strip()
            ]

        self.assertEqual(plan["jobs_planned"], 1)
        self.assertEqual(plan["max_size_bytes"], 15 * 1024 * 1024)
        self.assertEqual(plan["order"], "size-asc")
        self.assertEqual(shard_rows[0]["strategy"], "large-archive-inventory-only")
        self.assertLessEqual(shard_rows[0]["size"], 15 * 1024 * 1024)

    def test_canary_max_jobs_per_lane_balances_selection(self) -> None:
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
                "--min-size-bytes",
                str(1024 * 1024),
                "--max-jobs",
                "10",
                "--max-jobs-per-lane",
                "1",
                "--order",
                "size-desc",
            )
            self.assertEqual(proc.returncode, 0, proc.stderr)
            plan = json.loads((output / "large-file-extraction-plan.json").read_text(encoding="utf-8"))

        self.assertEqual(plan["jobs_planned"], 3)
        self.assertEqual(plan["max_jobs_per_lane"], 1)
        lane_counts = {row["key"]: row["count"] for row in plan["aggregate"]["by_lane"]}
        self.assertEqual(lane_counts, {
            "needs_archive_inventory": 1,
            "needs_office_extractor": 1,
            "needs_pdf_extractor": 1,
        })

    def test_max_size_must_be_greater_than_min_size(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            db = root / "files.db"
            setup_db(db)
            proc = run_planner(
                "--db",
                str(db),
                "--output-dir",
                str(root / "plan"),
                "--min-size-bytes",
                "100",
                "--max-size-bytes",
                "100",
            )

        self.assertNotEqual(proc.returncode, 0)
        self.assertIn("--max-size-bytes must be greater", proc.stderr)

    def test_approved_plan_requires_note(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            db = root / "files.db"
            setup_db(db)
            proc = run_planner("--db", str(db), "--output-dir", str(root / "plan"), "--approved")

        self.assertNotEqual(proc.returncode, 0)
        self.assertIn("--approval-note or --approval-note-file is required", proc.stderr)

    def test_approved_plan_accepts_private_approval_note_file_without_storing_note_text(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            db = root / "files.db"
            output = root / "plan"
            note_path = root / "approval-note.json"
            setup_db(db)
            write_approval_note(note_path, note="private large file approval")
            proc = run_planner(
                "--db",
                str(db),
                "--output-dir",
                str(output),
                "--min-size-bytes",
                str(1024 * 1024),
                "--approved",
                "--approval-note-file",
                str(note_path),
            )
            self.assertEqual(proc.returncode, 0, proc.stderr)
            plan = json.loads((output / "large-file-extraction-plan.json").read_text(encoding="utf-8"))
            validation = run_validator("--plan", str(output / "large-file-extraction-plan.json"))

        self.assertEqual(validation.returncode, 0, validation.stderr)
        self.assertTrue(plan["approved"])
        self.assertIsNone(plan["approval_note"])
        self.assertEqual(plan["approval_attestation"]["approval_note_source"], "file_json")
        self.assertEqual(plan["approval_attestation"]["approval_note_decision_id"], "large_file_canary")
        self.assertRegex(plan["approval_attestation"]["approval_note_sha256"], r"^[a-f0-9]{64}$")
        self.assertNotIn("private large file approval", json.dumps(plan))

    def test_validator_accepts_clean_plan_and_redacts_summary(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            db = root / "files.db"
            output = root / "plan"
            setup_db(db)
            plan_proc = run_planner("--db", str(db), "--output-dir", str(output), "--min-size-bytes", str(1024 * 1024))
            self.assertEqual(plan_proc.returncode, 0, plan_proc.stderr)
            proc = run_validator("--plan", str(output / "large-file-extraction-plan.json"))

        self.assertEqual(proc.returncode, 0, proc.stderr)
        summary = json.loads(proc.stdout)
        self.assertEqual(summary["status"], "ok")
        self.assertEqual(summary["jobs_from_shards"], 3)
        self.assertEqual(summary["duplicate_private_file_ids"], 0)
        self.assertNotIn("f_private_", proc.stdout)
        self.assertNotIn("private-contract", proc.stdout)

    def test_validator_rejects_duplicate_private_ids_without_printing_them(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            db = root / "files.db"
            output = root / "plan"
            setup_db(db)
            plan_proc = run_planner("--db", str(db), "--output-dir", str(output), "--jobs-per-shard", "3")
            self.assertEqual(plan_proc.returncode, 0, plan_proc.stderr)
            shard = output / "shards" / "shard-0001.jsonl"
            rows = [json.loads(line) for line in shard.read_text(encoding="utf-8").splitlines() if line.strip()]
            rows[1]["file_id"] = rows[0]["file_id"]
            with shard.open("w", encoding="utf-8") as handle:
                for row in rows:
                    handle.write(json.dumps(row, sort_keys=True) + "\n")
            proc = run_validator("--plan", str(output / "large-file-extraction-plan.json"))

        self.assertNotEqual(proc.returncode, 0)
        summary = json.loads(proc.stdout)
        codes = {error["code"] for error in summary["errors"]}
        self.assertIn("duplicate_private_file_ids", codes)
        self.assertIn("shard_manifest_sha_mismatch", codes)
        self.assertNotIn("f_private_", proc.stdout)

    def test_validator_rejects_public_plan_id_leak(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            db = root / "files.db"
            output = root / "plan"
            setup_db(db)
            plan_proc = run_planner("--db", str(db), "--output-dir", str(output), "--jobs-per-shard", "3")
            self.assertEqual(plan_proc.returncode, 0, plan_proc.stderr)
            plan_path = output / "large-file-extraction-plan.json"
            plan = json.loads(plan_path.read_text(encoding="utf-8"))
            plan["unsafe_debug"] = "f_private_pdf"
            plan_path.write_text(json.dumps(plan, indent=2, sort_keys=True), encoding="utf-8")
            proc = run_validator("--plan", str(plan_path))

        self.assertNotEqual(proc.returncode, 0)
        summary = json.loads(proc.stdout)
        codes = {error["code"] for error in summary["errors"]}
        self.assertIn("plan_redaction_failure", codes)
        self.assertNotIn("f_private_pdf", proc.stdout)


if __name__ == "__main__":
    unittest.main()
