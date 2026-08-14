#!/usr/bin/env python3
"""Offline tests for structured Office artifact helpers."""

from __future__ import annotations

import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path


SCRIPT_DIR = Path(__file__).resolve().parents[1] / "scripts"
OFFICE_SCRIPT = SCRIPT_DIR / "extract_office_text.py"
ARTIFACT_SCRIPT = SCRIPT_DIR / "extract_artifact_for_file.py"


def load_module(name: str, path: Path):
    if str(SCRIPT_DIR) not in sys.path:
        sys.path.insert(0, str(SCRIPT_DIR))
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"failed to load {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class StructuredOfficeArtifactTests(unittest.TestCase):
    def test_structure_from_html_extracts_blocks_and_table_shape(self) -> None:
        office = load_module("extract_office_text", OFFICE_SCRIPT)
        with tempfile.TemporaryDirectory() as tmp:
            html_path = Path(tmp) / "converted.html"
            html_path.write_text(
                """
                <html><body>
                  <h1>Quarterly Finance Review</h1>
                  <p>Revenue plan and renewal notes.</p>
                  <ul><li>Follow up with vendor.</li></ul>
                  <table>
                    <tr><th>Month</th><th>Total</th></tr>
                    <tr><td>January</td><td>100</td></tr>
                  </table>
                </body></html>
                """,
                encoding="utf-8",
            )
            structure = office.structure_from_html(html_path)
            summary = office.summarize_structure(structure)

        self.assertEqual(summary["blocks"], 3)
        self.assertEqual(summary["block_types"], {"heading": 1, "list_item": 1, "paragraph": 1})
        self.assertEqual(summary["tables"], 1)
        self.assertEqual(structure["tables"][0]["rows"], 2)
        self.assertEqual(structure["tables"][0]["columns"], 2)

    def test_office_review_uses_structured_sidecar_and_redacts_excerpt(self) -> None:
        artifact = load_module("extract_artifact_for_file", ARTIFACT_SCRIPT)
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            text_path = root / "office.txt"
            text_path.write_text(
                "Finance renewal for sam@example.com phone +1 555 123 9999",
                encoding="utf-8",
            )
            structured_path = root / "office.structured.json"
            structured_path.write_text(
                json.dumps({
                    "text": {"chars": 58, "lines": 1, "bytes": 58},
                    "structure": {
                        "blocks": [
                            {"type": "heading", "level": 1, "text": "Finance Renewal"},
                            {"type": "paragraph", "text": "Private paragraph"},
                        ],
                        "blocks_truncated": False,
                        "tables": [
                            {"rows": 4, "columns": 3, "sample_rows": [["a", "b", "c"]], "sample_truncated": False}
                        ],
                        "tables_truncated": False,
                    },
                    "structure_summary": {
                        "blocks": 2,
                        "block_types": {"heading": 1, "paragraph": 1},
                        "blocks_truncated": False,
                        "tables": 1,
                        "tables_truncated": False,
                    },
                }),
                encoding="utf-8",
            )
            review = artifact.review_from_office_structured(structured_path, text_path)

        self.assertEqual(review["text_metrics"]["chars"], 58)
        self.assertIn("Finance Renewal", review["structure"]["headings"])
        self.assertEqual(review["structure"]["table_summaries"], [{"rows": 4, "columns": 3, "sample_truncated": False}])
        self.assertIn("[email]", review["redacted_excerpt"])
        self.assertIn("[number]", review["redacted_excerpt"])
        self.assertNotIn("sam@example.com", review["redacted_excerpt"])


if __name__ == "__main__":
    unittest.main()
