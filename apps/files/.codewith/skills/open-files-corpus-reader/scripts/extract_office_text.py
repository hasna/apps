#!/usr/bin/env python3
"""Bounded Office/OpenDocument text extraction via LibreOffice.

Stdout is JSON status only. Extracted text is written only when --output is
provided.
"""

from __future__ import annotations

import argparse
import hashlib
import html.parser
import json
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Any


EXTRACTOR = "open-files-libreoffice-text-v2"


class TextHTMLParser(html.parser.HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.parts: list[str] = []

    def handle_data(self, data: str) -> None:
        if data.strip():
            self.parts.append(data.strip())

    def text(self) -> str:
        return "\n".join(self.parts)


class StructuredHTMLParser(html.parser.HTMLParser):
    block_tags = {"h1", "h2", "h3", "h4", "h5", "h6", "p", "li"}

    def __init__(self, max_blocks: int = 300, max_tables: int = 50, max_cell_chars: int = 400) -> None:
        super().__init__()
        self.max_blocks = max_blocks
        self.max_tables = max_tables
        self.max_cell_chars = max_cell_chars
        self.blocks: list[dict[str, Any]] = []
        self.tables: list[dict[str, Any]] = []
        self._block_stack: list[dict[str, Any]] = []
        self._table_rows: list[list[str]] | None = None
        self._row: list[str] | None = None
        self._cell_parts: list[str] | None = None
        self.blocks_truncated = False
        self.tables_truncated = False

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        del attrs
        tag = tag.lower()
        if tag in self.block_tags:
            self._block_stack.append({"tag": tag, "parts": []})
        elif tag == "table":
            self._table_rows = []
        elif tag == "tr" and self._table_rows is not None:
            self._row = []
        elif tag in {"td", "th"} and self._row is not None:
            self._cell_parts = []

    def handle_data(self, data: str) -> None:
        text = " ".join(data.split())
        if not text:
            return
        if self._block_stack:
            self._block_stack[-1]["parts"].append(text)
        if self._cell_parts is not None:
            self._cell_parts.append(text)

    def handle_endtag(self, tag: str) -> None:
        tag = tag.lower()
        if tag in self.block_tags and self._block_stack:
            block = self._block_stack.pop()
            if block["tag"] != tag:
                return
            text = " ".join(block["parts"]).strip()
            if not text:
                return
            if len(self.blocks) >= self.max_blocks:
                self.blocks_truncated = True
                return
            block_type = "heading" if tag.startswith("h") and len(tag) == 2 else "list_item" if tag == "li" else "paragraph"
            output: dict[str, Any] = {"type": block_type, "text": text}
            if block_type == "heading":
                output["level"] = int(tag[1])
            self.blocks.append(output)
        elif tag in {"td", "th"} and self._row is not None and self._cell_parts is not None:
            cell = " ".join(self._cell_parts).strip()
            self._row.append(cell[: self.max_cell_chars])
            self._cell_parts = None
        elif tag == "tr" and self._table_rows is not None and self._row is not None:
            if any(cell for cell in self._row):
                self._table_rows.append(self._row)
            self._row = None
        elif tag == "table" and self._table_rows is not None:
            if len(self.tables) >= self.max_tables:
                self.tables_truncated = True
            else:
                max_columns = max((len(row) for row in self._table_rows), default=0)
                self.tables.append({
                    "rows": len(self._table_rows),
                    "columns": max_columns,
                    "sample_rows": self._table_rows[:5],
                    "sample_truncated": len(self._table_rows) > 5,
                })
            self._table_rows = None


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def summarize_text(text: str) -> dict[str, int]:
    return {
        "chars": len(text),
        "lines": text.count("\n") + (1 if text and not text.endswith("\n") else 0),
        "bytes": len(text.encode("utf-8")),
    }


def summarize_structure(structure: dict[str, Any]) -> dict[str, Any]:
    block_types: dict[str, int] = {}
    for block in structure.get("blocks", []):
        block_type = str(block.get("type") or "unknown")
        block_types[block_type] = block_types.get(block_type, 0) + 1
    return {
        "blocks": len(structure.get("blocks", [])),
        "block_types": dict(sorted(block_types.items())),
        "blocks_truncated": bool(structure.get("blocks_truncated")),
        "tables": len(structure.get("tables", [])),
        "tables_truncated": bool(structure.get("tables_truncated")),
    }


def libreoffice_binary() -> str | None:
    return shutil.which("libreoffice") or shutil.which("soffice")


def convert(input_path: Path, outdir: Path, convert_to: str) -> subprocess.CompletedProcess[str]:
    binary = libreoffice_binary()
    if not binary:
        raise RuntimeError("LibreOffice/soffice is not available")
    profile = outdir / "lo-profile"
    profile.mkdir(parents=True, exist_ok=True)
    cmd = [
        binary,
        f"-env:UserInstallation=file://{profile}",
        "--headless",
        "--nologo",
        "--nofirststartwizard",
        "--convert-to",
        convert_to,
        "--outdir",
        str(outdir),
        str(input_path),
    ]
    return subprocess.run(cmd, check=False, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=120)


def newest_converted_file(outdir: Path, suffixes: set[str]) -> Path | None:
    candidates = [path for path in outdir.iterdir() if path.is_file() and path.suffix.lower() in suffixes]
    if not candidates:
        return None
    return max(candidates, key=lambda path: path.stat().st_mtime_ns)


def strip_html(path: Path) -> str:
    parser = TextHTMLParser()
    parser.feed(path.read_text(encoding="utf-8", errors="replace"))
    return parser.text()


def structure_from_html(path: Path) -> dict[str, Any]:
    parser = StructuredHTMLParser()
    parser.feed(path.read_text(encoding="utf-8", errors="replace"))
    return {
        "source": "libreoffice-html",
        "blocks": parser.blocks,
        "blocks_truncated": parser.blocks_truncated,
        "tables": parser.tables,
        "tables_truncated": parser.tables_truncated,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Extract text from Office/OpenDocument files without printing the text.")
    parser.add_argument("file", help="Local Office/OpenDocument file path")
    parser.add_argument("--output", required=True, help="Where extracted UTF-8 text should be written")
    parser.add_argument("--structured-output", help="Optional private JSON sidecar with bounded block/table structure")
    args = parser.parse_args()

    input_path = Path(args.file).expanduser()
    if not input_path.exists():
        raise SystemExit(f"file not found: {input_path}")
    if not libreoffice_binary():
        raise SystemExit("LibreOffice/soffice is not available")

    output_path = Path(args.output).expanduser().resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)

    with tempfile.TemporaryDirectory(prefix="open-files-office-") as tmp:
        outdir = Path(tmp)
        proc = convert(input_path, outdir, "txt:Text")
        text_file = newest_converted_file(outdir, {".txt"})
        extraction_mode = "txt"
        text = ""
        structure: dict[str, Any] = {"source": None, "blocks": [], "blocks_truncated": False, "tables": [], "tables_truncated": False}

        if proc.returncode == 0 and text_file:
            text = text_file.read_text(encoding="utf-8", errors="replace")
        else:
            html_proc = convert(input_path, outdir, "html")
            html_file = newest_converted_file(outdir, {".html", ".htm"})
            extraction_mode = "html"
            proc = html_proc
            if html_proc.returncode == 0 and html_file:
                text = strip_html(html_file)
                structure = structure_from_html(html_file)

        if args.structured_output and text:
            html_proc = convert(input_path, outdir, "html")
            html_file = newest_converted_file(outdir, {".html", ".htm"})
            if html_proc.returncode == 0 and html_file:
                structure = structure_from_html(html_file)

        status = "ready" if text else "failed"
        if text:
            output_path.write_text(text, encoding="utf-8")
        structured_output_path = Path(args.structured_output).expanduser().resolve() if args.structured_output and text else None
        if structured_output_path:
            structured_output_path.parent.mkdir(parents=True, exist_ok=True)
            structured_output_path.write_text(json.dumps({
                "status": status,
                "extractor": EXTRACTOR,
                "mode": extraction_mode,
                "input": {
                    "sha256": sha256_file(input_path),
                    "bytes": input_path.stat().st_size,
                },
                "output_text": str(output_path),
                "text": summarize_text(text),
                "structure": structure,
                "structure_summary": summarize_structure(structure),
                "redaction": "private structured artifact; stdout contains counts only",
            }, indent=2, sort_keys=True), encoding="utf-8")

        summary: dict[str, Any] = {
            "status": status,
            "extractor": EXTRACTOR,
            "mode": extraction_mode,
            "input": {
                "sha256": sha256_file(input_path),
                "bytes": input_path.stat().st_size,
            },
            "output": str(output_path) if text else None,
            "structured_output": str(structured_output_path) if structured_output_path else None,
            "text": summarize_text(text),
            "structure": summarize_structure(structure) if structured_output_path else None,
        }
        if not text:
            summary["error"] = (proc.stderr or proc.stdout).strip()[:2000]
        print(json.dumps(summary, indent=2, sort_keys=True))
        return 0 if text else 1


if __name__ == "__main__":
    raise SystemExit(main())
