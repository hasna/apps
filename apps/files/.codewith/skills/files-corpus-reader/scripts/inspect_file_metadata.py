#!/usr/bin/env python3
"""Inspect binary file metadata without extracting private content.

Stdout is status JSON. The script avoids filenames, object keys, tag values,
text content, OCR output, transcripts, and preview bytes.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import subprocess
from pathlib import Path
from typing import Any


EXTRACTOR = "open-files-file-metadata-v1"
DESIGN_PREVIEW_TOOLS = ("magick", "convert")


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def magic_metadata(path: Path) -> dict[str, Any]:
    metadata: dict[str, Any] = {}
    try:
        import magic  # type: ignore

        metadata["mime"] = magic.from_file(str(path), mime=True)
        metadata["description"] = magic.from_file(str(path), mime=False)
    except Exception as exc:
        metadata["python_magic_error"] = type(exc).__name__

    file_binary = shutil.which("file")
    if file_binary:
        proc = subprocess.run(
            [file_binary, "--brief", "--mime-type", str(path)],
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        if proc.returncode == 0:
            metadata["file_mime"] = proc.stdout.strip()
        proc = subprocess.run(
            [file_binary, "--brief", str(path)],
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        if proc.returncode == 0:
            metadata["file_description"] = proc.stdout.strip()[:1000]
    return metadata


def image_metadata(path: Path) -> dict[str, Any]:
    result: dict[str, Any] = {
        "ocr_status": "available" if shutil.which("tesseract") else "tool_required",
        "ocr_required_tool": None if shutil.which("tesseract") else "tesseract",
        "vision_status": "provider_required",
    }
    try:
        from PIL import Image

        with Image.open(path) as image:
            result.update({
                "pil_status": "ready",
                "format": image.format,
                "mode": image.mode,
                "width": image.width,
                "height": image.height,
                "frames": getattr(image, "n_frames", 1),
                "exif_tag_count": len(image.getexif()) if hasattr(image, "getexif") else 0,
            })
    except Exception as exc:
        result.update({
            "pil_status": "failed",
            "pil_error": type(exc).__name__,
        })
    return result


def ffprobe_metadata(path: Path) -> dict[str, Any]:
    binary = shutil.which("ffprobe")
    if binary is None:
        return {
            "media_status": "tool_required",
            "required_tool": "ffprobe",
            "transcription_status": "provider_required",
        }
    proc = subprocess.run(
        [
            binary,
            "-v",
            "error",
            "-show_format",
            "-show_streams",
            "-of",
            "json",
            str(path),
        ],
        check=False,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    if proc.returncode != 0:
        return {
            "media_status": "failed",
            "error": (proc.stderr or proc.stdout).strip()[:1000],
            "transcription_status": "provider_required",
        }
    try:
        raw = json.loads(proc.stdout)
    except json.JSONDecodeError as exc:
        return {
            "media_status": "failed",
            "error": f"ffprobe JSON parse failed: {exc}",
            "transcription_status": "provider_required",
        }
    streams = raw.get("streams") if isinstance(raw, dict) else []
    stream_summaries: list[dict[str, Any]] = []
    for stream in (streams if isinstance(streams, list) else []):
        if not isinstance(stream, dict):
            continue
        stream_summaries.append({
            "codec_type": stream.get("codec_type"),
            "codec_name": stream.get("codec_name"),
            "width": stream.get("width"),
            "height": stream.get("height"),
            "duration": stream.get("duration"),
        })
    fmt = raw.get("format", {}) if isinstance(raw, dict) else {}
    return {
        "media_status": "ready",
        "duration": fmt.get("duration") if isinstance(fmt, dict) else None,
        "bit_rate": fmt.get("bit_rate") if isinstance(fmt, dict) else None,
        "stream_count": len(stream_summaries),
        "streams": stream_summaries,
        "transcription_status": "provider_required",
    }


def design_raw_metadata(path: Path) -> dict[str, Any]:
    preview_tool = next((tool for tool in DESIGN_PREVIEW_TOOLS if shutil.which(tool)), None)
    pil_preview_available = False
    if preview_tool is None:
        try:
            from PIL import Image  # noqa: F401

            pil_preview_available = True
        except Exception:
            pil_preview_available = False
    if preview_tool:
        preview_status = "tool_available"
        preview_required_tool = None
        preview_tool_label = preview_tool
    elif pil_preview_available:
        preview_status = "pil_available"
        preview_required_tool = None
        preview_tool_label = "PIL"
    else:
        preview_status = "tool_required"
        preview_required_tool = "imagemagick_or_pillow"
        preview_tool_label = None
    return {
        "preview_status": preview_status,
        "preview_tool": preview_tool_label,
        "preview_required_tool": preview_required_tool,
        "exif_status": "tool_available" if shutil.which("exiftool") else "tool_required",
        "exif_required_tool": None if shutil.which("exiftool") else "exiftool",
        "vision_status": "provider_required",
        "vision_next_action": "approved_vision_summary_or_human_review",
    }


def status_for(kind: str, details: dict[str, Any]) -> str:
    if kind == "media":
        return "metadata_ready" if details.get("media_status") == "ready" else "tool_required"
    if kind == "image":
        return "metadata_ready" if details.get("pil_status") == "ready" else "tool_required"
    return "metadata_ready"


def inspect(path: Path, kind: str) -> dict[str, Any]:
    details: dict[str, Any] = {}
    if kind == "image":
        details.update(image_metadata(path))
    elif kind == "media":
        details.update(ffprobe_metadata(path))
    elif kind == "design_raw":
        details.update(design_raw_metadata(path))

    output = {
        "status": status_for(kind, details),
        "extractor": EXTRACTOR,
        "kind": kind,
        "input": {
            "sha256": sha256_file(path),
            "bytes": path.stat().st_size,
        },
        "magic": magic_metadata(path),
        "details": details,
    }
    return output


def write_design_preview(input_path: Path, output_path: Path, max_pixels: int, timeout_seconds: int) -> dict[str, Any]:
    tool = next((candidate for candidate in DESIGN_PREVIEW_TOOLS if shutil.which(candidate)), None)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    if tool is not None:
        size_arg = f"{max_pixels}x{max_pixels}>"
        command = [tool, str(input_path) + "[0]", "-auto-orient", "-thumbnail", size_arg, "-strip", "png:" + str(output_path)]
        proc = subprocess.run(
            command,
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            timeout=timeout_seconds,
        )
        if proc.returncode != 0 or not output_path.exists():
            return {
                "status": "failed",
                "tool": tool,
                "error": (proc.stderr or proc.stdout).strip()[:1000],
                "redaction": "preview command output is truncated and preview bytes are private-local only",
            }
        return {
            "status": "ready",
            "tool": tool,
            "bytes": output_path.stat().st_size,
            "sha256": sha256_file(output_path),
            "max_dimension": max_pixels,
            "redaction": "preview bytes are stored only in the private preview artifact",
        }

    try:
        from PIL import Image, ImageOps

        with Image.open(input_path) as image:
            image = ImageOps.exif_transpose(image)
            image.thumbnail((max_pixels, max_pixels))
            if image.mode not in {"RGB", "RGBA"}:
                image = image.convert("RGBA")
            image.save(output_path, format="PNG")
    except Exception as exc:
        return {
            "status": "tool_required",
            "required_tool": "imagemagick_or_pillow_supported_format",
            "pil_error": type(exc).__name__,
            "redaction": "preview artifact was not generated; no preview bytes or source filename printed",
        }
    return {
        "status": "ready",
        "tool": "PIL",
        "bytes": output_path.stat().st_size,
        "sha256": sha256_file(output_path),
        "max_dimension": max_pixels,
        "redaction": "preview bytes are stored only in the private preview artifact",
    }


def design_vision_request_payload(payload: dict[str, Any]) -> dict[str, Any]:
    details = payload.get("details") if isinstance(payload.get("details"), dict) else {}
    magic = payload.get("magic") if isinstance(payload.get("magic"), dict) else {}
    preview = payload.get("preview") if isinstance(payload.get("preview"), dict) else {}
    return {
        "kind": "design_raw_vision_request",
        "status": "approval_required",
        "extractor": payload.get("extractor"),
        "source": {
            "sha256": payload.get("input", {}).get("sha256") if isinstance(payload.get("input"), dict) else None,
            "bytes": payload.get("input", {}).get("bytes") if isinstance(payload.get("input"), dict) else None,
        },
        "magic": {
            "mime": magic.get("mime") or magic.get("file_mime"),
            "description_present": bool(magic.get("description") or magic.get("file_description")),
        },
        "details": {
            "preview_status": details.get("preview_status"),
            "preview_tool": details.get("preview_tool"),
            "preview_required_tool": details.get("preview_required_tool"),
            "exif_status": details.get("exif_status"),
            "exif_required_tool": details.get("exif_required_tool"),
            "vision_status": details.get("vision_status"),
            "vision_next_action": details.get("vision_next_action"),
        },
        "preview": {
            "status": preview.get("status"),
            "bytes": preview.get("bytes"),
            "sha256": preview.get("sha256"),
            "max_dimension": preview.get("max_dimension"),
        },
        "routing": {
            "content_route": "approved_vision_summary_or_human_review",
            "recommended_artifact_kind": "vision_summary",
            "requires_approval": True,
            "human_review_required": True,
        },
        "redaction": "private vision request; contains no filenames, paths, object keys, source refs, preview bytes, extracted text, OCR text, transcripts, or ACL payloads",
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Inspect file metadata without extracting private content.")
    parser.add_argument("file", help="Local file path")
    parser.add_argument("--kind", choices=["image", "media", "design_raw", "unknown"], required=True)
    parser.add_argument("--output", help="Optional path for full metadata JSON artifact")
    parser.add_argument("--preview-output", help="Optional private PNG preview artifact for design/raw files")
    parser.add_argument("--vision-request-output", help="Optional private JSON artifact describing an approval-gated design/raw vision fallback request")
    parser.add_argument("--preview-max-pixels", type=int, default=1024, help="Maximum preview thumbnail dimension for design/raw files")
    parser.add_argument("--timeout-seconds", type=int, default=30, help="Preview tool timeout")
    args = parser.parse_args()

    input_path = Path(args.file).expanduser()
    if not input_path.exists():
        raise SystemExit(f"file not found: {input_path}")

    result = inspect(input_path, args.kind)
    if args.kind == "design_raw" and args.preview_output:
        preview_output = Path(args.preview_output).expanduser().resolve()
        preview = write_design_preview(input_path, preview_output, args.preview_max_pixels, args.timeout_seconds)
        result["preview"] = preview
        if preview.get("status") == "ready":
            result["preview_artifact"] = str(preview_output)
            result["details"]["preview_status"] = "ready"
        elif preview.get("status") == "tool_required":
            result["details"]["preview_status"] = "tool_required"
            result["details"]["preview_required_tool"] = preview.get("required_tool")
        elif result["details"].get("preview_status") in {"tool_available", "pil_available"}:
            result["details"]["preview_status"] = "failed"
    if args.kind == "design_raw" and args.vision_request_output:
        request_output = Path(args.vision_request_output).expanduser().resolve()
        request_output.parent.mkdir(parents=True, exist_ok=True)
        request_output.write_text(json.dumps(design_vision_request_payload(result), indent=2, sort_keys=True), encoding="utf-8")
        result["vision_request_artifact"] = str(request_output)
    if args.output:
        output_path = Path(args.output).expanduser().resolve()
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(json.dumps(result, indent=2, sort_keys=True), encoding="utf-8")
        result["output"] = str(output_path)
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0 if result["status"] == "metadata_ready" else 1


if __name__ == "__main__":
    raise SystemExit(main())
