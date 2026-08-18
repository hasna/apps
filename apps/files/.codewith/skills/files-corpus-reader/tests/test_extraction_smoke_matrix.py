#!/usr/bin/env python3
"""Offline tests for extraction smoke matrix lane selection."""

from __future__ import annotations

import importlib.util
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path


SCRIPT_DIR = Path(__file__).resolve().parents[1] / "scripts"
SCRIPT = SCRIPT_DIR / "extraction_smoke_matrix.py"


def load_module():
    if str(SCRIPT_DIR) not in sys.path:
        sys.path.insert(0, str(SCRIPT_DIR))
    spec = importlib.util.spec_from_file_location("extraction_smoke_matrix", SCRIPT)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"failed to load {SCRIPT}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class ExtractionSmokeMatrixTests(unittest.TestCase):
    def test_parse_files_command_splits_repo_local_cli_command(self) -> None:
        smoke = load_module()

        command = smoke.parse_files_command("bun run src/cli/index.tsx")

        self.assertEqual(command, ["bun", "run", "src/cli/index.tsx"])

    def test_smoke_text_uses_custom_files_command(self) -> None:
        smoke = load_module()
        with tempfile.TemporaryDirectory() as tmp:
            calls: list[list[str]] = []

            def fake_run_json(cmd: list[str], timeout: int):
                calls.append(cmd)
                return {"status": "ready", "bytes_read": 12}, None

            original_run_json = smoke.run_json
            smoke.run_json = fake_run_json
            try:
                result = smoke.smoke_text(
                    "f_private_markdown",
                    Path(tmp),
                    5,
                    ["bun", "run", "src/cli/index.tsx"],
                )
            finally:
                smoke.run_json = original_run_json

        self.assertEqual(result["status"], "ready")
        self.assertEqual(calls[0][:5], ["bun", "run", "src/cli/index.tsx", "extract-snapshot", "f_private_markdown"])

    def test_design_raw_smoke_requests_preview_and_vision_artifacts(self) -> None:
        smoke = load_module()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            local = root / "private-design.psd"
            local.write_bytes(b"private bytes")
            calls: list[list[str]] = []

            def fake_download(file_id: str, artifact_dir: Path, timeout: int, files_command: list[str], suffix: str = ""):
                return local, None

            def fake_run_json(cmd: list[str], timeout: int):
                calls.append(cmd)
                return {
                    "status": "metadata_ready",
                    "kind": "design_raw",
                    "details": {"preview_status": "tool_required"},
                    "preview": {"status": "tool_required"},
                    "magic": {},
                }, None

            original_download = smoke.download_for_smoke
            original_run_json = smoke.run_json
            smoke.download_for_smoke = fake_download
            smoke.run_json = fake_run_json
            try:
                result = smoke.smoke_metadata_lane(
                    "f_private_design",
                    "needs_design_raw_pipeline",
                    100,
                    root,
                    5,
                    1024,
                    ["bun", "run", "src/cli/index.tsx"],
                )
            finally:
                smoke.download_for_smoke = original_download
                smoke.run_json = original_run_json

        self.assertEqual(result["status"], "metadata_ready")
        self.assertIn("--preview-output", calls[0])
        self.assertIn("--vision-request-output", calls[0])

    def test_sample_rows_routes_by_extension_not_only_mime(self) -> None:
        smoke = load_module()
        with tempfile.TemporaryDirectory() as tmp:
            db_path = Path(tmp) / "files.db"
            db = sqlite3.connect(db_path)
            db.executescript(
                """
                CREATE TABLE files (
                  id TEXT PRIMARY KEY,
                  name TEXT,
                  ext TEXT,
                  mime TEXT,
                  size INTEGER,
                  status TEXT
                );
                CREATE TABLE file_organization_reviews (
                  file_id TEXT PRIMARY KEY,
                  owner TEXT,
                  review_status TEXT
                );
                """
            )
            rows = [
                ("f_private_unknown", "unknown.bin", "bin", "application/octet-stream", 10, "active"),
                ("f_private_markdown", "notes.md", "md", "application/octet-stream", 20, "active"),
            ]
            for row in rows:
                db.execute(
                    "INSERT INTO files (id, name, ext, mime, size, status) VALUES (?, ?, ?, ?, ?, ?)",
                    row,
                )
                db.execute(
                    "INSERT INTO file_organization_reviews (file_id, owner, review_status) VALUES (?, ?, ?)",
                    (row[0], "archive", "approved"),
                )
            db.commit()

            selected = smoke.sample_rows(db, limit_per_lane=1)
            lanes = {
                row["file_id"]: smoke.corpus_lane_for(row["mime"], row["file_name"], row["ext"])
                for row in selected
            }

        self.assertEqual(lanes["f_private_unknown"], "metadata_only_or_unknown")
        self.assertEqual(lanes["f_private_markdown"], "readable_now_text")


if __name__ == "__main__":
    unittest.main()
