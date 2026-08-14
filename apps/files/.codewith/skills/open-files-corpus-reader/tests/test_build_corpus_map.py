#!/usr/bin/env python3
"""Offline tests for redacted full-corpus mapping."""

from __future__ import annotations

import json
import sqlite3
import subprocess
import tempfile
import unittest
from pathlib import Path


SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "build_corpus_map.py"


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
        ("f_text_private", "private-notes.md", "text/markdown", "md", 10_000, "active", "workspace", "approved", "ok"),
        ("f_pdf_private", "private-contract.pdf", "application/pdf", "pdf", 2_000_000, "active", "legal", "approved", "ok"),
        ("f_image_private", "private-scan.png", "image/png", "png", 300_000, "active", "finance", "approved", "ok"),
        ("f_video_private", "private-recording.mp4", "video/mp4", "mp4", 150_000_000, "active", "product", "approved", "ok"),
        ("f_unknown_private", "private-binary.bin", "application/octet-stream", "bin", 8_000, "active", "intake", "needs_review", "needs_review"),
        ("f_duplicate_private", "private-dupe.pdf", "application/pdf", "pdf", 3_000_000, "active", "legal", "duplicate", "ok"),
        ("f_inactive_private", "private-old.pdf", "application/pdf", "pdf", 3_000_000, "deleted", "legal", "approved", "ok"),
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
            ("doc_ready", "f_pdf_private", "extraction_summary", "ready"),
        )
        db.execute(
            "INSERT INTO file_search_documents (id, file_id, kind, status) VALUES (?, ?, ?, ?)",
            ("doc_stale", "f_image_private", "ocr_text", "stale"),
        )
    db.commit()
    db.close()


def run_mapper(*args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["python3", str(SCRIPT), *args],
        check=False,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )


class CorpusMapTests(unittest.TestCase):
    def test_public_map_is_redacted_and_private_map_has_worker_fields(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            db = root / "files.db"
            output = root / "map"
            setup_db(db)
            proc = run_mapper("--db", str(db), "--output-dir", str(output), "--top", "10")
            self.assertEqual(proc.returncode, 0, proc.stderr)
            public_map = json.loads((output / "corpus-map-public.json").read_text(encoding="utf-8"))
            private_rows = [
                json.loads(line)
                for line in (output / "corpus-private-map.jsonl").read_text(encoding="utf-8").splitlines()
                if line.strip()
            ]

        self.assertEqual(public_map["totals"]["active_files"], 6)
        self.assertEqual(public_map["totals"]["duplicate_review_rows"], 1)
        self.assertEqual(public_map["totals"]["indexed_files"], 1)
        self.assertEqual(public_map["totals"]["stale_only_files"], 1)
        self.assertEqual(public_map["private_map"]["rows"], 6)
        self.assertRegex(public_map["private_map"]["sha256"], r"^[a-f0-9]{64}$")
        self.assertIn("by_readiness", public_map["aggregate"])
        self.assertIn("by_provider_requirement", public_map["aggregate"])
        self.assertIn("by_next_action", public_map["aggregate"])
        self.assertIn("by_risk_tier", public_map["aggregate"])

        public_text = proc.stdout + json.dumps(public_map)
        self.assertNotIn("f_text_private", public_text)
        self.assertNotIn("private-notes", public_text)
        self.assertNotIn("private-contract", public_text)
        self.assertNotIn('"file_id"', public_text)

        by_id = {row["file_id"]: row for row in private_rows}
        self.assertEqual(by_id["f_pdf_private"]["index_coverage"], "indexed")
        self.assertEqual(by_id["f_pdf_private"]["next_action"], "search_ready_keep_current_index")
        self.assertEqual(by_id["f_image_private"]["readiness"], "stale_refresh_required")
        self.assertEqual(by_id["f_video_private"]["readiness"], "large_file_runner_required")
        self.assertEqual(by_id["f_unknown_private"]["provider_requirement"], "agent_or_human_metadata_review")
        self.assertEqual(by_id["f_duplicate_private"]["next_action"], "preserve_duplicate_skip_until_survivor_review")

    def test_exclude_duplicates_and_lane_filter_limit_map(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            db = root / "files.db"
            output = root / "map"
            setup_db(db)
            proc = run_mapper(
                "--db",
                str(db),
                "--output-dir",
                str(output),
                "--exclude-duplicates",
                "--lanes",
                "needs_pdf_extractor,needs_ocr_or_vision",
            )
            self.assertEqual(proc.returncode, 0, proc.stderr)
            public_map = json.loads(proc.stdout)
            private_rows = [
                json.loads(line)
                for line in (output / "corpus-private-map.jsonl").read_text(encoding="utf-8").splitlines()
                if line.strip()
            ]

        self.assertEqual(public_map["totals"]["active_files"], 2)
        self.assertEqual(public_map["totals"]["duplicate_review_rows"], 0)
        self.assertEqual({row["lane"] for row in private_rows}, {"needs_pdf_extractor", "needs_ocr_or_vision"})
        self.assertNotIn("f_duplicate_private", {row["file_id"] for row in private_rows})

    def test_missing_search_document_table_marks_all_rows_missing(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            db = root / "files.db"
            setup_db(db, with_search_documents=False)
            proc = run_mapper("--db", str(db))
            self.assertEqual(proc.returncode, 0, proc.stderr)
            public_map = json.loads(proc.stdout)

        self.assertEqual(public_map["totals"]["active_files"], 6)
        self.assertEqual(public_map["totals"]["indexed_files"], 0)
        self.assertEqual(public_map["totals"]["stale_only_files"], 0)
        self.assertEqual(public_map["totals"]["missing_index_files"], 6)


if __name__ == "__main__":
    unittest.main()
