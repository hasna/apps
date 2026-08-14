#!/usr/bin/env python3
"""Offline tests for metadata and design/raw preview routing."""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "inspect_file_metadata.py"


def run_script(*args: str, env: dict[str, str] | None = None) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, str(SCRIPT), *args],
        check=False,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        env=env,
    )


class InspectFileMetadataTests(unittest.TestCase):
    def test_design_raw_missing_preview_tool_writes_vision_request_without_name_stdout(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "private-design.psd"
            source.write_bytes(b"not a real psd")
            output = root / "metadata.json"
            request = root / "vision-request.json"
            env = {**os.environ, "PATH": "/nonexistent"}

            proc = run_script(
                str(source),
                "--kind",
                "design_raw",
                "--output",
                str(output),
                "--preview-output",
                str(root / "preview.png"),
                "--vision-request-output",
                str(request),
                env=env,
            )
            self.assertEqual(proc.returncode, 0, proc.stderr)
            public = json.loads(proc.stdout)
            artifact = json.loads(output.read_text(encoding="utf-8"))
            vision_request = json.loads(request.read_text(encoding="utf-8"))

        self.assertEqual(public["status"], "metadata_ready")
        self.assertEqual(artifact["preview"]["status"], "tool_required")
        self.assertEqual(vision_request["status"], "approval_required")
        self.assertEqual(vision_request["routing"]["recommended_artifact_kind"], "vision_summary")
        self.assertNotIn("private-design", proc.stdout)
        self.assertNotIn("not a real psd", proc.stdout)

    def test_design_raw_pil_preview_fallback_writes_private_preview(self) -> None:
        try:
            from PIL import Image
        except Exception as exc:
            self.skipTest(f"PIL unavailable: {exc}")

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "private-design.psd"
            Image.new("RGB", (8, 8), (20, 40, 60)).save(source, format="PNG")
            output = root / "metadata.json"
            preview = root / "preview.png"
            request = root / "vision-request.json"
            env = {**os.environ, "PATH": "/nonexistent"}

            proc = run_script(
                str(source),
                "--kind",
                "design_raw",
                "--output",
                str(output),
                "--preview-output",
                str(preview),
                "--vision-request-output",
                str(request),
                env=env,
            )
            self.assertEqual(proc.returncode, 0, proc.stderr)
            artifact = json.loads(output.read_text(encoding="utf-8"))
            vision_request = json.loads(request.read_text(encoding="utf-8"))
            preview_exists = preview.exists()

        self.assertEqual(artifact["preview"]["status"], "ready")
        self.assertEqual(artifact["preview"]["tool"], "PIL")
        self.assertEqual(artifact["details"]["preview_status"], "ready")
        self.assertEqual(vision_request["preview"]["status"], "ready")
        self.assertTrue(preview_exists)
        self.assertNotIn("private-design", proc.stdout)

    def test_design_raw_fake_preview_tool_writes_private_preview_and_redacted_request(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            bin_dir = root / "bin"
            bin_dir.mkdir()
            fake_magick = bin_dir / "magick"
            fake_magick.write_text(
                f"""#!{sys.executable}
from pathlib import Path
out = [arg for arg in __import__('sys').argv if arg.startswith('png:')][0][4:]
Path(out).write_bytes(b'private preview bytes')
""",
                encoding="utf-8",
            )
            fake_magick.chmod(0o755)
            source = root / "private-design.psd"
            source.write_bytes(b"private source bytes")
            output = root / "metadata.json"
            preview = root / "preview.png"
            request = root / "vision-request.json"
            env = {**os.environ, "PATH": f"{bin_dir}:{os.environ.get('PATH', '')}"}

            proc = run_script(
                str(source),
                "--kind",
                "design_raw",
                "--output",
                str(output),
                "--preview-output",
                str(preview),
                "--vision-request-output",
                str(request),
                env=env,
            )
            self.assertEqual(proc.returncode, 0, proc.stderr)
            artifact = json.loads(output.read_text(encoding="utf-8"))
            vision_request = json.loads(request.read_text(encoding="utf-8"))
            preview_exists = preview.exists()

        self.assertEqual(artifact["preview"]["status"], "ready")
        self.assertEqual(artifact["preview"]["bytes"], len(b"private preview bytes"))
        self.assertEqual(artifact["details"]["preview_status"], "ready")
        self.assertEqual(vision_request["preview"]["status"], "ready")
        self.assertTrue(preview_exists)
        self.assertNotIn("private preview bytes", proc.stdout)
        self.assertNotIn("private source bytes", proc.stdout)


if __name__ == "__main__":
    unittest.main()
