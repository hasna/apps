#!/usr/bin/env python3
"""Report local extraction tool readiness by corpus lane.

Stdout is aggregate-only and contains no corpus filenames, object keys, file
IDs, extracted text, credentials, or provider secrets.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import shutil
from typing import Any


TOOLS = [
    "pdftotext",
    "libreoffice",
    "soffice",
    "tesseract",
    "ffmpeg",
    "ffprobe",
    "exiftool",
    "pandoc",
    "unzip",
    "7z",
    "7zz",
    "7za",
    "unrar",
    "bsdtar",
    "unar",
    "file",
    "magick",
    "convert",
]

MODULES = ["PIL", "magic"]


def tool_present(name: str) -> bool:
    return shutil.which(name) is not None


def module_present(name: str) -> bool:
    return importlib.util.find_spec(name) is not None


def status_for(required: list[str], alternatives: list[list[str]] | None = None) -> str:
    if all(tool_present(tool) for tool in required):
        return "ready"
    for group in alternatives or []:
        if any(tool_present(tool) for tool in group):
            return "ready"
    return "tool_required"


def build_inventory(defer_media: bool) -> dict[str, Any]:
    tools = {tool: {"present": tool_present(tool)} for tool in TOOLS}
    modules = {module: {"present": module_present(module)} for module in MODULES}

    office_ready = any(tool_present(tool) for tool in ("libreoffice", "soffice"))
    zip_tar_ready = any(tool_present(tool) for tool in ("unzip", "7z", "7zz", "7za", "bsdtar"))
    seven_zip_ready = any(tool_present(tool) for tool in ("7z", "7zz", "7za"))
    rar_ready = any(tool_present(tool) for tool in ("unrar", "7z", "7zz", "7za", "bsdtar"))
    image_metadata_ready = modules["PIL"]["present"]
    media_ready = tool_present("ffmpeg") and tool_present("ffprobe")
    design_preview_ready = any(tool_present(tool) for tool in ("magick", "convert"))

    lanes: dict[str, dict[str, Any]] = {
        "readable_now_text": {
            "status": "ready",
            "local_tools": ["files extract-snapshot"],
            "provider_required": False,
        },
        "needs_pdf_extractor": {
            "status": status_for(["pdftotext"]),
            "local_tools": ["pdftotext"],
            "provider_required": False,
        },
        "needs_office_extractor": {
            "status": "ready" if office_ready else "tool_required",
            "local_tools": ["libreoffice|soffice"],
            "provider_required": False,
        },
        "needs_archive_inventory": {
            "status": "ready" if zip_tar_ready else "tool_required",
            "local_tools": ["unzip|bsdtar", "7zz|7z|7za", "unrar|bsdtar"],
            "provider_required": False,
            "missing_blocks": [
                block
                for block, ready in [
                    ("7z_inventory", seven_zip_ready),
                    ("rar_inventory", rar_ready),
                ]
                if not ready
            ],
        },
        "needs_ocr_or_vision": {
            "status": "degraded" if image_metadata_ready else "tool_required",
            "local_tools": ["PIL", "tesseract"],
            "provider_required": True,
            "missing_blocks": [
                block
                for block, ready in [
                    ("ocr", tool_present("tesseract")),
                    ("vision_provider_approval", False),
                ]
                if not ready
            ],
        },
        "needs_transcription": {
            "status": "deferred" if defer_media else "ready" if media_ready else "tool_required",
            "local_tools": ["ffmpeg", "ffprobe"],
            "provider_required": True,
            "deferred": defer_media,
        },
        "needs_video_pipeline": {
            "status": "deferred" if defer_media else "ready" if media_ready else "tool_required",
            "local_tools": ["ffmpeg", "ffprobe"],
            "provider_required": True,
            "deferred": defer_media,
        },
        "needs_design_raw_pipeline": {
            "status": "degraded",
            "local_tools": ["file", "exiftool", "PIL-preview|magick|convert"],
            "provider_required": True,
            "missing_blocks": [
                block
                for block, ready in [
                    ("magic_metadata", tool_present("file")),
                    ("exif_metadata", tool_present("exiftool")),
                    ("preview", design_preview_ready),
                    ("vision_provider_approval", False),
                ]
                if not ready
            ],
        },
        "metadata_only_or_unknown": {
            "status": "ready" if tool_present("file") else "degraded",
            "local_tools": ["file"],
            "provider_required": False,
        },
    }

    return {
        "status": "ready_with_degraded_lanes",
        "redaction": "aggregate-only; no corpus filenames, IDs, object keys, extracted text, credentials, or provider secrets",
        "tools": tools,
        "python_modules": modules,
        "lanes": lanes,
        "deferred_lanes": [
            lane
            for lane, details in lanes.items()
            if details.get("status") == "deferred"
        ],
        "tool_required_lanes": [
            lane
            for lane, details in lanes.items()
            if details.get("status") == "tool_required"
        ],
        "degraded_lanes": [
            lane
            for lane, details in lanes.items()
            if details.get("status") == "degraded"
        ],
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Report extraction tool readiness by lane.")
    parser.add_argument("--include-media", action="store_true", help="Do not mark audio/video lanes deferred.")
    args = parser.parse_args()
    print(json.dumps(build_inventory(defer_media=not args.include_media), indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
