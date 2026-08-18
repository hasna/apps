#!/usr/bin/env python3
"""Offline tests for bounded image OCR extraction."""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from PIL import Image


SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "extract_image_ocr.py"


def write_image(path: Path) -> None:
    image = Image.new("RGB", (120, 40), color="white")
    image.save(path)


def run_script(*args: str, env: dict[str, str] | None = None) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, str(SCRIPT), *args],
        check=False,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        env=env,
    )


class ImageOcrTests(unittest.TestCase):
    def test_missing_tesseract_writes_tool_required_artifact_without_text_stdout(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            image = root / "image.png"
            output = root / "ocr.json"
            vision_request = root / "vision-request.json"
            write_image(image)
            env = {**os.environ, "PATH": "/nonexistent"}
            proc = run_script(str(image), "--output", str(output), "--vision-request-output", str(vision_request), env=env)
            self.assertEqual(proc.returncode, 0, proc.stderr)
            public = json.loads(proc.stdout)
            artifact = json.loads(output.read_text(encoding="utf-8"))
            request = json.loads(vision_request.read_text(encoding="utf-8"))
            self.assertEqual(public["status"], "tool_required")
            self.assertEqual(artifact["status"], "tool_required")
            self.assertEqual(public["routing"]["content_route"], "vision_fallback")
            self.assertEqual(public["vision"]["status"], "provider_required")
            self.assertEqual(request["status"], "approval_required")
            self.assertIn("width", public["details"])
            self.assertNotIn("redacted_excerpt", proc.stdout)
            self.assertNotIn("raw_text_artifact", proc.stdout)

    def test_fake_tesseract_writes_private_text_and_omits_content_from_stdout(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            image = root / "image.png"
            output = root / "ocr.json"
            text_output = root / "ocr.txt"
            fake_bin = root / "bin"
            fake_bin.mkdir()
            fake_tesseract = fake_bin / "tesseract"
            fake_tesseract.write_text(
                f"""#!{sys.executable}
import pathlib
import sys
output_base = pathlib.Path(sys.argv[2])
output_base.with_suffix(".txt").write_text("Private OCR text private@example.com\\n", encoding="utf-8")
""",
                encoding="utf-8",
            )
            fake_tesseract.chmod(0o755)
            write_image(image)
            env = {**os.environ, "PATH": str(fake_bin)}
            proc = run_script(str(image), "--output", str(output), "--text-output", str(text_output), env=env)
            self.assertEqual(proc.returncode, 0, proc.stderr)
            public = json.loads(proc.stdout)
            artifact = json.loads(output.read_text(encoding="utf-8"))
            self.assertEqual(public["status"], "ready")
            self.assertEqual(public["text_metrics"]["words"], 4)
            self.assertEqual(public["routing"]["confidence"], "low")
            self.assertTrue(public["routing"]["human_review_required"])
            self.assertEqual(public["vision"]["status"], "provider_required")
            self.assertEqual(artifact["ocr"]["redacted_excerpt"], "Private OCR text [email]")
            self.assertEqual(text_output.read_text(encoding="utf-8"), "Private OCR text private@example.com\n")
            self.assertNotIn("Private OCR text", proc.stdout)
            self.assertNotIn("private@example.com", proc.stdout)
            self.assertNotIn(str(text_output), proc.stdout)

    def test_unidentified_image_is_routed_without_filename_stdout(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            image = root / "private-name.png"
            output = root / "ocr.json"
            image.write_text("not actually an image", encoding="utf-8")
            proc = run_script(str(image), "--output", str(output))
            self.assertEqual(proc.returncode, 0, proc.stderr)
            public = json.loads(proc.stdout)
            artifact = json.loads(output.read_text(encoding="utf-8"))
            self.assertEqual(public["status"], "unidentified_image")
            self.assertEqual(artifact["status"], "unidentified_image")
            self.assertNotIn("private-name", proc.stdout)


if __name__ == "__main__":
    unittest.main()
