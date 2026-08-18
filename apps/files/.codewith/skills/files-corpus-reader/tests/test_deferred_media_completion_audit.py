#!/usr/bin/env python3
"""Offline tests for deferred media completion bucket audits."""

from __future__ import annotations

import json
import sqlite3
import subprocess
import tempfile
import unittest
from pathlib import Path


SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "deferred_media_completion_audit.py"


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
          review_status TEXT
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
        ("f_audio_deferred", "private-audio.m4a", "audio/mp4", "m4a", 10_000, "active", "archive", "approved"),
        ("f_audio_queued", "private-queued.wav", "audio/wav", "wav", 20_000, "active", "people", "approved"),
        ("f_video_indexed", "private-video.mp4", "video/mp4", "mp4", 30_000, "active", "product", "approved"),
        ("f_video_failed", "private-failed.mov", "video/quicktime", "mov", 40_000, "active", "product", "approved"),
        ("f_audio_extracted", "private-extracted.mp3", "audio/mpeg", "mp3", 50_000, "active", "archive", "approved"),
        ("f_video_retried", "private-retried.mp4", "video/mp4", "mp4", 60_000, "active", "product", "approved"),
        ("f_audio_duplicate", "private-dupe.m4a", "audio/mp4", "m4a", 70_000, "active", "archive", "duplicate"),
        ("f_text", "private-note.txt", "text/plain", "txt", 80_000, "active", "workspace", "approved"),
    ]
    for row in rows:
        db.execute(
            "INSERT INTO files (id, name, mime, ext, size, status) VALUES (?, ?, ?, ?, ?, ?)",
            row[:6],
        )
        db.execute(
            "INSERT INTO file_organization_reviews (file_id, owner, review_status) VALUES (?, ?, ?)",
            (row[0], row[6], row[7]),
        )
    docs = [
        ("doc_video_ready", "f_video_indexed", "transcript", "ready"),
        ("doc_failed", "f_video_failed", "transcript", "error"),
        ("doc_extracted", "f_audio_extracted", "transcript", "stale"),
        ("doc_retried_error", "f_video_retried", "transcript", "error"),
        ("doc_retried_ready", "f_video_retried", "transcript", "ready"),
    ]
    for row in docs:
        db.execute("INSERT INTO file_search_documents (id, file_id, kind, status) VALUES (?, ?, ?, ?)", row)
    db.commit()
    db.close()


def run_script(*args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["python3", str(SCRIPT), *args],
        check=False,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )


class DeferredMediaCompletionAuditTests(unittest.TestCase):
    def test_media_completion_buckets_are_aggregate_and_redacted(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            db = root / "files.db"
            queued = root / "queued.jsonl"
            setup_db(db)
            queued.write_text('{"file_id":"f_audio_queued"}\n{"file_id":"f_video_retried"}\n', encoding="utf-8")
            proc = run_script("--db", str(db), "--queued-manifest", str(queued), "--include-duplicates")

        self.assertEqual(proc.returncode, 0, proc.stderr)
        summary = json.loads(proc.stdout)
        completion = {row["key"]: row["count"] for row in summary["completion_buckets"]}
        retry = {row["key"]: row["count"] for row in summary["retry_buckets"]}
        self.assertEqual(summary["status"], "deferred")
        self.assertEqual(summary["totals"]["active_media_files"], 7)
        self.assertEqual(completion["deferred"], 1)
        self.assertEqual(completion["queued"], 1)
        self.assertEqual(completion["indexed"], 2)
        self.assertEqual(completion["failed"], 1)
        self.assertEqual(completion["extracted"], 1)
        self.assertEqual(completion["duplicate_preserve"], 1)
        self.assertEqual(retry["retried"], 1)
        self.assertTrue(summary["completion_gate"]["final_media_pass_required"])
        self.assertTrue(summary["completion_gate"]["cannot_hide_behind_boolean_deferral"])
        self.assertRegex(summary["active_media_private_ids_sha256"], r"^[a-f0-9]{64}$")
        self.assertNotIn("f_audio", proc.stdout)
        self.assertNotIn("private-audio", proc.stdout)
        self.assertNotIn('"file_id"', proc.stdout)

    def test_without_search_document_table_all_media_is_deferred_or_queued(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            db = root / "files.db"
            setup_db(db)
            sqlite3.connect(db).execute("DROP TABLE file_search_documents").connection.commit()
            proc = run_script("--db", str(db))

        self.assertEqual(proc.returncode, 0, proc.stderr)
        summary = json.loads(proc.stdout)
        completion = {row["key"]: row["count"] for row in summary["completion_buckets"]}
        self.assertEqual(summary["totals"]["active_media_files"], 6)
        self.assertEqual(completion["deferred"], 6)
        self.assertEqual(completion["indexed"], 0)


if __name__ == "__main__":
    unittest.main()
