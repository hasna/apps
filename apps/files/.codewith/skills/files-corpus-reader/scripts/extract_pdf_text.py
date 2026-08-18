#!/usr/bin/env python3
"""Bounded PDF text extraction via pdftotext.

Stdout is JSON status only. Extracted text is written only when --output is
provided.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Any


EXTRACTOR = "open-files-pdftotext-v1"


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def summarize_text(path: Path) -> dict[str, int]:
    text = path.read_text(encoding="utf-8", errors="replace") if path.exists() else ""
    return {
        "chars": len(text),
        "lines": text.count("\n") + (1 if text and not text.endswith("\n") else 0),
        "bytes": path.stat().st_size if path.exists() else 0,
    }


def run_pdftotext(input_path: Path, output_path: Path, max_pages: int) -> subprocess.CompletedProcess[str]:
    cmd = ["pdftotext", "-enc", "UTF-8", "-nopgbrk"]
    if max_pages > 0:
        cmd.extend(["-f", "1", "-l", str(max_pages)])
    cmd.extend([str(input_path), str(output_path)])
    return subprocess.run(cmd, check=False, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)


def classify_pdf_failure(stderr: str) -> str:
    lowered = stderr.lower()
    if "incorrect password" in lowered or ("password" in lowered and "error" in lowered):
        return "password_protected"
    if "may not be a pdf" in lowered or "syntax error" in lowered:
        return "malformed_pdf"
    return "failed"


def main() -> int:
    parser = argparse.ArgumentParser(description="Extract bounded text from a PDF without printing the text.")
    parser.add_argument("file", help="Local PDF path")
    parser.add_argument("--output", help="Where extracted UTF-8 text should be written")
    parser.add_argument("--max-pages", type=int, default=20, help="Maximum pages to extract; 0 means all pages")
    args = parser.parse_args()

    input_path = Path(args.file).expanduser()
    if not input_path.exists():
        raise SystemExit(f"file not found: {input_path}")
    if shutil.which("pdftotext") is None:
        raise SystemExit("pdftotext is not available")

    with tempfile.TemporaryDirectory(prefix="open-files-pdf-") as tmp:
        temp_output = Path(tmp) / "extracted.txt"
        proc = run_pdftotext(input_path, temp_output, args.max_pages)
        error_text = proc.stderr.strip()
        status = "ready" if proc.returncode == 0 else classify_pdf_failure(error_text)
        if args.output and proc.returncode == 0:
            output_path = Path(args.output).expanduser().resolve()
            output_path.parent.mkdir(parents=True, exist_ok=True)
            output_path.write_text(temp_output.read_text(encoding="utf-8", errors="replace"), encoding="utf-8")
        else:
            output_path = None

        summary: dict[str, Any] = {
            "status": status,
            "extractor": EXTRACTOR,
            "input": {
                "sha256": sha256_file(input_path),
                "bytes": input_path.stat().st_size,
            },
            "max_pages": args.max_pages,
            "output": str(output_path) if output_path else None,
            "text": summarize_text(temp_output) if proc.returncode == 0 else {"chars": 0, "lines": 0, "bytes": 0},
        }
        if proc.returncode != 0:
            summary["error"] = error_text[:2000]
        print(json.dumps(summary, indent=2, sort_keys=True))
        return 0 if proc.returncode == 0 else proc.returncode


if __name__ == "__main__":
    raise SystemExit(main())
