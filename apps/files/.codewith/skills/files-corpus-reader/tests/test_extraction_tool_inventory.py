#!/usr/bin/env python3
"""Offline tests for extraction tool inventory."""

from __future__ import annotations

import importlib.util
import sys
import unittest
from pathlib import Path


SCRIPT_DIR = Path(__file__).resolve().parents[1] / "scripts"
SCRIPT = SCRIPT_DIR / "extraction_tool_inventory.py"


def load_module():
    if str(SCRIPT_DIR) not in sys.path:
        sys.path.insert(0, str(SCRIPT_DIR))
    spec = importlib.util.spec_from_file_location("extraction_tool_inventory", SCRIPT)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"failed to load {SCRIPT}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class ExtractionToolInventoryTests(unittest.TestCase):
    def test_inventory_reports_ready_degraded_and_deferred_lanes(self) -> None:
        inventory_module = load_module()
        original_tool_present = inventory_module.tool_present
        original_module_present = inventory_module.module_present
        try:
            inventory_module.tool_present = lambda name: name in {"pdftotext", "libreoffice", "unzip", "file"}
            inventory_module.module_present = lambda name: name == "PIL"
            inventory = inventory_module.build_inventory(defer_media=True)
        finally:
            inventory_module.tool_present = original_tool_present
            inventory_module.module_present = original_module_present

        self.assertEqual(inventory["lanes"]["needs_pdf_extractor"]["status"], "ready")
        self.assertEqual(inventory["lanes"]["needs_office_extractor"]["status"], "ready")
        self.assertEqual(inventory["lanes"]["needs_archive_inventory"]["status"], "ready")
        self.assertIn("7z_inventory", inventory["lanes"]["needs_archive_inventory"]["missing_blocks"])
        self.assertIn("rar_inventory", inventory["lanes"]["needs_archive_inventory"]["missing_blocks"])
        self.assertEqual(inventory["lanes"]["metadata_only_or_unknown"]["status"], "ready")
        self.assertEqual(inventory["lanes"]["needs_ocr_or_vision"]["status"], "degraded")
        self.assertIn("ocr", inventory["lanes"]["needs_ocr_or_vision"]["missing_blocks"])
        self.assertIn("preview", inventory["lanes"]["needs_design_raw_pipeline"]["missing_blocks"])
        self.assertIn("exif_metadata", inventory["lanes"]["needs_design_raw_pipeline"]["missing_blocks"])
        self.assertEqual(inventory["lanes"]["needs_transcription"]["status"], "deferred")
        self.assertEqual(inventory["deferred_lanes"], ["needs_transcription", "needs_video_pipeline"])
        self.assertIn("redaction", inventory)
        self.assertNotIn("value", str(inventory["tools"]).lower())

    def test_include_media_marks_missing_media_tools_required(self) -> None:
        inventory_module = load_module()
        original_tool_present = inventory_module.tool_present
        original_module_present = inventory_module.module_present
        try:
            inventory_module.tool_present = lambda name: False
            inventory_module.module_present = lambda name: False
            inventory = inventory_module.build_inventory(defer_media=False)
        finally:
            inventory_module.tool_present = original_tool_present
            inventory_module.module_present = original_module_present

        self.assertEqual(inventory["lanes"]["needs_transcription"]["status"], "tool_required")
        self.assertEqual(inventory["lanes"]["needs_video_pipeline"]["status"], "tool_required")
        self.assertIn("needs_transcription", inventory["tool_required_lanes"])
        self.assertEqual(inventory["lanes"]["metadata_only_or_unknown"]["status"], "degraded")


if __name__ == "__main__":
    unittest.main()
