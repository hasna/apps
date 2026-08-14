#!/usr/bin/env python3
"""Extract bounded OCR artifacts from local image files.

Stdout is status-only and never includes OCR text, filenames, object keys, or
image bytes. The output JSON artifact is private-local and may include a
redacted excerpt plus a private raw text artifact path.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import subprocess
from pathlib import Path
from typing import Any


EXTRACTOR = "image-ocr-vision-route-v2"


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def sanitize_text(value: str, max_chars: int = 1600) -> str:
    text = value.replace("\x00", " ")
    text = re.sub(r"https?://\S+", "[url]", text)
    text = re.sub(r"\b[\w.+-]+@[\w.-]+\.[a-zA-Z]{2,}\b", "[email]", text)
    text = re.sub(r"\b(?:\+?\d[\d\s().-]{7,}\d)\b", "[number]", text)
    text = re.sub(r"objects/sha256/[A-Za-z0-9/_\\.-]+", "[object-key]", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text[:max_chars]


def text_metrics(value: str) -> dict[str, int]:
    return {
        "chars": len(value),
        "lines": value.count("\n") + (1 if value and not value.endswith("\n") else 0),
        "words": len(re.findall(r"\S+", value)),
    }


def image_probe(path: Path) -> tuple[dict[str, Any], str | None]:
    try:
        from PIL import Image

        with Image.open(path) as image:
            exif = image.getexif() if hasattr(image, "getexif") else {}
            return {
                "pil_status": "ready",
                "format": image.format,
                "mode": image.mode,
                "width": image.width,
                "height": image.height,
                "frames": getattr(image, "n_frames", 1),
                "exif_tag_count": len(exif),
                "exif_orientation": exif.get(274) if exif else None,
            }, None
    except Exception as exc:
        return {"pil_status": "failed", "pil_error": type(exc).__name__}, type(exc).__name__


def routing_for(status: str, text: str, details: dict[str, Any]) -> dict[str, Any]:
    words = text_metrics(text)["words"] if text else 0
    if status == "ready":
        confidence = "medium" if words >= 8 else "low"
        return {
            "content_route": "ocr_text",
            "confidence": confidence,
            "human_review_required": confidence == "low",
            "next_action": "index_ocr_text_then_semantic_review",
        }
    if status == "empty":
        return {
            "content_route": "vision_fallback",
            "confidence": "low",
            "human_review_required": True,
            "next_action": "approved_vision_summary_or_human_review",
        }
    if status == "tool_required":
        return {
            "content_route": "vision_fallback",
            "confidence": "none",
            "human_review_required": True,
            "next_action": "install_tesseract_or_approved_vision_summary",
        }
    if status in {"too_large", "too_many_frames"}:
        return {
            "content_route": "large_image_runner",
            "confidence": "none",
            "human_review_required": True,
            "next_action": "large_file_image_runner",
        }
    if status == "unidentified_image":
        return {
            "content_route": "human_review",
            "confidence": "none",
            "human_review_required": True,
            "next_action": "file_magic_or_human_review",
        }
    return {
        "content_route": "failed",
        "confidence": "none",
        "human_review_required": True,
        "next_action": "retry_or_human_review",
    }


def vision_for(status: str, details: dict[str, Any], text: str) -> dict[str, Any]:
    del details
    if status == "ready" and text_metrics(text)["words"] >= 8:
        return {"status": "not_required", "provider_required": False, "reason": "ocr_text_available"}
    if status in {"ready", "empty", "tool_required"}:
        return {
            "status": "provider_required",
            "provider_required": True,
            "reason": "ocr_missing_empty_or_low_signal",
            "recommended_artifact_kind": "vision_summary",
        }
    if status in {"too_large", "too_many_frames"}:
        return {
            "status": "large_file_runner_required",
            "provider_required": False,
            "reason": status,
            "recommended_artifact_kind": "vision_summary",
        }
    return {
        "status": "human_review_required",
        "provider_required": False,
        "reason": status,
        "recommended_artifact_kind": "semantic_metadata",
    }


def status_payload(
    status: str,
    input_path: Path,
    details: dict[str, Any],
    text_path: Path | None = None,
    text: str = "",
    error: str | None = None,
) -> dict[str, Any]:
    text_ready = status in {"ready", "empty"}
    routing = routing_for(status, text, details)
    vision = vision_for(status, details, text)
    return {
        "status": status,
        "extractor": EXTRACTOR,
        "input": {
            "sha256": sha256_file(input_path),
            "bytes": input_path.stat().st_size,
        },
        "details": details,
        "routing": routing,
        "vision": vision,
        "ocr": {
            "status": status,
            "text_metrics": text_metrics(text) if text_ready else None,
            "redacted_excerpt": sanitize_text(text) if status == "ready" else "",
            "text_truncated": len(text) > 1600 if status == "ready" else False,
            "raw_text_artifact": str(text_path) if text_path and text_path.exists() else None,
        },
        "error": error,
        "redaction": "OCR text is stored only in private artifacts and is not printed to stdout",
    }


def vision_request_payload(payload: dict[str, Any], input_path: Path) -> dict[str, Any]:
    details = payload.get("details") if isinstance(payload.get("details"), dict) else {}
    return {
        "status": "approval_required",
        "extractor": EXTRACTOR,
        "input": payload.get("input"),
        "details": {
            key: details.get(key)
            for key in ("pil_status", "format", "mode", "width", "height", "frames", "exif_orientation")
            if key in details
        },
        "ocr_status": payload.get("status"),
        "vision": payload.get("vision"),
        "routing": payload.get("routing"),
        "image_sha256": sha256_file(input_path),
        "prompt": (
            "Summarize visible document/image content for file organization. "
            "Return document kind, visible date/entity cues, sensitivity hint, "
            "and short searchable summary. Do not quote long text."
        ),
        "redaction": "private vision request; contains no filenames, paths, object keys, image bytes, OCR text, or transcripts",
    }


def public_status(payload: dict[str, Any], output: Path) -> dict[str, Any]:
    ocr = payload.get("ocr") if isinstance(payload.get("ocr"), dict) else {}
    text_metrics_value = ocr.get("text_metrics") if isinstance(ocr, dict) else None
    return {
        "status": payload.get("status"),
        "extractor": payload.get("extractor"),
        "output": str(output),
        "artifact_ready": True,
        "content_ready": payload.get("status") == "ready",
        "text_metrics": text_metrics_value,
        "details": {
            key: payload.get("details", {}).get(key)
            for key in ("pil_status", "format", "mode", "width", "height", "frames", "exif_orientation")
            if isinstance(payload.get("details"), dict) and key in payload["details"]
        },
        "routing": payload.get("routing"),
        "vision": {
            key: payload.get("vision", {}).get(key)
            for key in ("status", "provider_required", "reason", "recommended_artifact_kind")
            if isinstance(payload.get("vision"), dict) and key in payload["vision"]
        },
        "vision_request": payload.get("vision_request_artifact"),
        "error": payload.get("error"),
        "redaction": "stdout omits OCR text, filenames, paths, object keys, and image bytes",
    }


def run_tesseract(tesseract: str, input_path: Path, text_output: Path, timeout: int, lang: str | None, psm: str | None) -> tuple[bool, str | None]:
    output_base = text_output.with_suffix("")
    cmd = [tesseract, str(input_path), str(output_base)]
    if lang:
        cmd.extend(["-l", lang])
    if psm:
        cmd.extend(["--psm", psm])
    cmd.append("txt")
    proc = subprocess.run(cmd, check=False, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=timeout)
    if proc.returncode == 0:
        return True, None
    return False, (proc.stderr or proc.stdout).strip()[:1000]


def extract(
    input_path: Path,
    output_path: Path,
    text_output: Path,
    timeout: int,
    max_pixels: int,
    max_frames: int,
    lang: str | None,
    psm: str | None,
) -> dict[str, Any]:
    details, probe_error = image_probe(input_path)
    if probe_error:
        return status_payload("unidentified_image", input_path, details, error=probe_error)

    width = int(details.get("width") or 0)
    height = int(details.get("height") or 0)
    frames = int(details.get("frames") or 1)
    if width * height > max_pixels:
        return status_payload("too_large", input_path, details, error="image exceeds max pixels")
    if frames > max_frames:
        return status_payload("too_many_frames", input_path, details, error="image exceeds max frames")

    tesseract = shutil.which("tesseract")
    if not tesseract:
        details["ocr_required_tool"] = "tesseract"
        return status_payload("tool_required", input_path, details, error="tesseract not found")

    text_output.parent.mkdir(parents=True, exist_ok=True)
    ok, error = run_tesseract(tesseract, input_path, text_output, timeout, lang, psm)
    if not ok:
        return status_payload("failed", input_path, details, text_output, error=error)
    text = text_output.read_text(encoding="utf-8", errors="replace") if text_output.exists() else ""
    status = "ready" if text.strip() else "empty"
    return status_payload(status, input_path, details, text_output, text=text)


def main() -> int:
    parser = argparse.ArgumentParser(description="Extract bounded OCR artifact from an image.")
    parser.add_argument("image", help="Local image path")
    parser.add_argument("--output", required=True, help="Private OCR JSON artifact output")
    parser.add_argument("--text-output", help="Private raw OCR text artifact output")
    parser.add_argument("--vision-request-output", help="Optional private JSON artifact describing an approval-gated vision fallback request")
    parser.add_argument("--timeout-seconds", type=int, default=60)
    parser.add_argument("--max-pixels", type=int, default=36_000_000)
    parser.add_argument("--max-frames", type=int, default=1)
    parser.add_argument("--lang", help="Optional tesseract language")
    parser.add_argument("--psm", default="6", help="Optional tesseract page segmentation mode")
    args = parser.parse_args()

    input_path = Path(args.image).expanduser()
    if not input_path.exists():
        raise SystemExit("image file not found")
    output_path = Path(args.output).expanduser().resolve()
    text_output = Path(args.text_output).expanduser().resolve() if args.text_output else output_path.with_suffix(".txt")
    output_path.parent.mkdir(parents=True, exist_ok=True)
    payload = extract(
        input_path,
        output_path,
        text_output,
        max(1, args.timeout_seconds),
        max(1, args.max_pixels),
        max(1, args.max_frames),
        args.lang,
        args.psm,
    )
    if args.vision_request_output and isinstance(payload.get("vision"), dict) and payload["vision"].get("provider_required"):
        vision_request_output = Path(args.vision_request_output).expanduser().resolve()
        vision_request_output.parent.mkdir(parents=True, exist_ok=True)
        vision_request_output.write_text(json.dumps(vision_request_payload(payload, input_path), indent=2, sort_keys=True), encoding="utf-8")
        payload["vision_request_artifact"] = str(vision_request_output)
    output_path.write_text(json.dumps(payload, indent=2, sort_keys=True), encoding="utf-8")
    print(json.dumps(public_status(payload, output_path), indent=2, sort_keys=True))
    return 0 if payload["status"] in {"ready", "empty", "tool_required", "too_large", "too_many_frames", "unidentified_image"} else 1


if __name__ == "__main__":
    raise SystemExit(main())
