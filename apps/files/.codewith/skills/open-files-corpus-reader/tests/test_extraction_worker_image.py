#!/usr/bin/env python3
"""Static checks for the open-files extraction worker image context."""

from __future__ import annotations

import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DOCKERFILE = ROOT / "worker-image" / "Dockerfile"
SMOKE = ROOT / "worker-image" / "smoke-archive-tools.sh"
README = ROOT / "worker-image" / "README.md"


class ExtractionWorkerImageTests(unittest.TestCase):
    def test_dockerfile_bakes_archive_listing_tools(self) -> None:
        text = DOCKERFILE.read_text(encoding="utf-8")

        for package in [
            "file",
            "libarchive-tools",
            "p7zip-full",
            "python3",
            "unzip",
        ]:
            self.assertIn(package, text)

        self.assertIn("scripts/archive_inventory.py", text)
        self.assertIn("scripts/extraction_tool_inventory.py", text)
        self.assertIn("open-files-archive-tools-smoke", text)
        self.assertIn("USER extractor", text)

    def test_smoke_checks_7z_and_rar_readiness_without_private_names(self) -> None:
        text = SMOKE.read_text(encoding="utf-8")

        self.assertIn("7z a -bd -y", text)
        self.assertIn("archive lane is not ready", text)
        self.assertIn('"7z_inventory"', text)
        self.assertIn('"rar_inventory"', text)
        self.assertIn("sha256_redacted", text)
        self.assertIn("leaked a member name", text)
        self.assertNotIn("--include-names", text)

    def test_readme_documents_build_from_skill_root(self) -> None:
        text = README.read_text(encoding="utf-8")

        self.assertIn(".codewith/skills/open-files-corpus-reader", text)
        self.assertIn("open-files-extraction-worker:archive-tools", text)
        self.assertIn("--network none", text)
        self.assertIn("--read-only", text)
        self.assertIn("does not read corpus files", text)


if __name__ == "__main__":
    unittest.main()
