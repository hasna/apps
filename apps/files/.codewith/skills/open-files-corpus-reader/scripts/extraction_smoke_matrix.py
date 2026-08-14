#!/usr/bin/env python3
"""Run artifact-based extraction smoke tests across lanes.

This script samples file IDs by lane and size bucket, runs only bounded
extractors, and writes private artifacts under --artifact-dir. Stdout is
aggregate JSON only.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shlex
import sqlite3
import subprocess
from pathlib import Path
from typing import Any

from lane_resolver import corpus_lane_for


def default_db_path() -> Path:
    if os.environ.get("HASNA_FILES_DB_PATH"):
        return Path(os.environ["HASNA_FILES_DB_PATH"]).expanduser()
    if os.environ.get("FILES_DB_PATH"):
        return Path(os.environ["FILES_DB_PATH"]).expanduser()
    data_dir = Path(os.environ.get("HASNA_FILES_DATA_DIR", "~/.hasna/files")).expanduser()
    return data_dir / "files.db"


def size_bucket(size: int) -> str:
    if size < 16 * 1024:
        return "small-lt16k"
    if size < 256 * 1024:
        return "small-16k-256k"
    if size < 1024 * 1024:
        return "medium-256k-1m"
    if size < 10 * 1024 * 1024:
        return "large-1m-10m"
    if size < 100 * 1024 * 1024:
        return "huge-10m-100m"
    return "massive-gte100m"


def sha256_text(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def parse_files_command(command: str) -> list[str]:
    parts = shlex.split(command)
    if not parts:
        raise SystemExit("--files-command must not be empty")
    return parts


def run_json(cmd: list[str], timeout: int) -> tuple[dict[str, Any] | None, str | None]:
    proc = subprocess.run(cmd, check=False, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=timeout)
    try:
        parsed = json.loads(proc.stdout)
        if proc.returncode == 0:
            return parsed, None
        return parsed, str(proc.stderr or parsed.get("error") or proc.stdout).strip()[:1000]
    except json.JSONDecodeError as exc:
        if proc.returncode != 0:
            return None, (proc.stderr or proc.stdout).strip()[:1000]
        return None, f"json_parse_failed: {exc}"


def run_command(cmd: list[str], timeout: int) -> tuple[bool, str | None]:
    proc = subprocess.run(cmd, check=False, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=timeout)
    if proc.returncode == 0:
        return True, None
    return False, (proc.stderr or proc.stdout).strip()[:1000]


def sample_rows(db: sqlite3.Connection, limit_per_lane: int) -> list[sqlite3.Row]:
    db.row_factory = sqlite3.Row
    rows = db.execute(
        """
        SELECT
          f.id AS file_id,
          f.name AS file_name,
          f.ext AS ext,
          f.mime AS mime,
          f.size AS size,
          COALESCE(NULLIF(r.owner, ''), '_unassigned') AS owner,
          COALESCE(r.review_status, '_none') AS review_status
        FROM files f
        LEFT JOIN file_organization_reviews r ON r.file_id = f.id
        WHERE f.status = 'active'
          AND COALESCE(r.review_status, '') != 'duplicate'
        ORDER BY f.mime, f.size ASC, f.id
        """
    ).fetchall()

    selected: list[sqlite3.Row] = []
    seen: dict[tuple[str, str], int] = {}
    for row in rows:
        lane = corpus_lane_for(row["mime"], row["file_name"], row["ext"])
        bucket = size_bucket(int(row["size"] or 0))
        key = (lane, bucket)
        if seen.get(key, 0) >= limit_per_lane:
            continue
        selected.append(row)
        seen[key] = seen.get(key, 0) + 1
    return selected


def smoke_text(file_id: str, artifact_dir: Path, timeout: int, files_command: list[str]) -> dict[str, Any]:
    output = artifact_dir / f"{file_id}.snapshot.json"
    for max_bytes in (16384, 8192, 4096):
        result, error = run_json([
            *files_command, "extract-snapshot", file_id, "--json",
            "--max-bytes", str(max_bytes), "--segment-chars", "3000",
        ], timeout)
        if result:
            output.write_text(json.dumps(result, indent=2, sort_keys=True), encoding="utf-8")
            status = result.get("status", "unknown")
            return {
                "status": status,
                "usable": status in {"ready", "too_large", "empty"},
                "extractor": "files-extract-snapshot",
                "max_bytes": max_bytes,
                "artifact": str(output),
                "bytes_read": result.get("bytes_read"),
                "error": None,
            }
        last_error = error
    return {"status": "failed", "usable": False, "extractor": "files-extract-snapshot", "artifact": None, "error": last_error}


def download_for_smoke(
    file_id: str,
    artifact_dir: Path,
    timeout: int,
    files_command: list[str],
    suffix: str = "",
) -> tuple[Path | None, str | None]:
    dest = artifact_dir / "downloads" / f"{file_id}{suffix}"
    dest.parent.mkdir(parents=True, exist_ok=True)
    ok, error = run_command([*files_command, "download", file_id, str(dest)], timeout)
    return (dest, None) if ok else (None, error)


def smoke_pdf(file_id: str, size: int, artifact_dir: Path, timeout: int, max_download_bytes: int, files_command: list[str]) -> dict[str, Any]:
    if size > max_download_bytes:
        return {
            "status": "skipped_size",
            "usable": False,
            "routed": True,
            "route": "large-file-pdf-runner",
            "extractor": "pdftotext",
            "artifact": None,
            "error": f"sample exceeds max download bytes: {size} > {max_download_bytes}",
        }
    local_path, error = download_for_smoke(file_id, artifact_dir, timeout, files_command, ".pdf")
    if not local_path:
        return {"status": "download_failed", "usable": False, "extractor": "pdftotext", "artifact": None, "error": error}
    text_path = artifact_dir / f"{file_id}.pdf.txt"
    script = Path(__file__).resolve().parent / "extract_pdf_text.py"
    result, extract_error = run_json([
        "python3", str(script), str(local_path), "--output", str(text_path), "--max-pages", "10",
    ], timeout)
    if not result:
        return {"status": "failed", "usable": False, "extractor": "pdftotext", "artifact": None, "error": extract_error}
    status = result.get("status", "unknown")
    return {
        "status": status,
        "usable": status == "ready",
        "routed": status in {"ready", "password_protected", "malformed_pdf"},
        "extractor": "pdftotext",
        "artifact": str(text_path) if text_path.exists() else None,
        "summary": result.get("text"),
        "error": result.get("error"),
    }


def smoke_office(file_id: str, size: int, artifact_dir: Path, timeout: int, max_download_bytes: int, files_command: list[str]) -> dict[str, Any]:
    if size > max_download_bytes:
        return {
            "status": "skipped_size",
            "usable": False,
            "routed": True,
            "route": "large-file-office-runner",
            "extractor": "libreoffice",
            "artifact": None,
            "error": f"sample exceeds max download bytes: {size} > {max_download_bytes}",
        }
    local_path, error = download_for_smoke(file_id, artifact_dir, timeout, files_command)
    if not local_path:
        return {"status": "download_failed", "usable": False, "extractor": "libreoffice", "artifact": None, "error": error}
    text_path = artifact_dir / f"{file_id}.office.txt"
    structured_path = artifact_dir / f"{file_id}.office.structured.json"
    script = Path(__file__).resolve().parent / "extract_office_text.py"
    result, extract_error = run_json([
        "python3",
        str(script),
        str(local_path),
        "--output",
        str(text_path),
        "--structured-output",
        str(structured_path),
    ], timeout)
    if not result:
        return {"status": "failed", "usable": False, "extractor": "libreoffice", "artifact": None, "error": extract_error}
    status = result.get("status", "unknown")
    return {
        "status": status,
        "usable": status == "ready",
        "extractor": "libreoffice",
        "artifact": str(text_path) if text_path.exists() else None,
        "structured_artifact": str(structured_path) if structured_path.exists() else None,
        "summary": result.get("text"),
        "structure": result.get("structure"),
        "error": result.get("error"),
    }


def smoke_archive(file_id: str, mime: str, size: int, artifact_dir: Path, timeout: int, max_download_bytes: int, files_command: list[str]) -> dict[str, Any]:
    if size > max_download_bytes:
        return {
            "status": "skipped_size",
            "usable": False,
            "routed": True,
            "route": "large-file-archive-runner",
            "extractor": "archive-inventory",
            "artifact": None,
            "error": f"sample exceeds max download bytes: {size} > {max_download_bytes}",
        }
    suffix = {
        "application/zip": ".zip",
        "application/x-zip-compressed": ".zip",
        "application/x-tar": ".tar",
        "application/gzip": ".gz",
        "application/x-gzip": ".gz",
        "application/x-7z-compressed": ".7z",
        "application/x-rar-compressed": ".rar",
    }.get(mime, "")
    local_path, error = download_for_smoke(file_id, artifact_dir, timeout, files_command, suffix)
    if not local_path:
        return {"status": "download_failed", "usable": False, "extractor": "archive-inventory", "artifact": None, "error": error}
    inventory_path = artifact_dir / f"{file_id}.archive.json"
    script = Path(__file__).resolve().parent / "archive_inventory.py"
    result, extract_error = run_json([
        "python3", str(script), str(local_path), "--output", str(inventory_path), "--max-entries", "200",
    ], timeout)
    if not result:
        return {"status": "failed", "usable": False, "extractor": "archive-inventory", "artifact": None, "error": extract_error}
    status = result.get("status", "unknown")
    return {
        "status": status,
        "usable": status == "ready",
        "routed": status in {"ready", "unsupported", "tool_required"},
        "extractor": "archive-inventory",
        "artifact": str(inventory_path) if inventory_path.exists() else None,
        "summary": {
            "entry_count": result.get("entry_count"),
            "entries_truncated": result.get("entries_truncated"),
            "archive_kind": result.get("archive_kind"),
            "required_tool": result.get("required_tool"),
        },
        "error": result.get("error"),
    }


def smoke_metadata_lane(file_id: str, lane: str, size: int, artifact_dir: Path, timeout: int, max_download_bytes: int, files_command: list[str]) -> dict[str, Any]:
    if size > max_download_bytes:
        return {
            "status": "skipped_size",
            "usable": False,
            "routed": True,
            "route": f"large-file-{lane}-runner",
            "extractor": "file-metadata",
            "artifact": None,
            "error": f"sample exceeds max download bytes: {size} > {max_download_bytes}",
        }
    kind = {
        "needs_ocr_or_vision": "image",
        "needs_transcription": "media",
        "needs_video_pipeline": "media",
        "needs_design_raw_pipeline": "design_raw",
        "metadata_only_or_unknown": "unknown",
    }.get(lane, "unknown")
    local_path, error = download_for_smoke(file_id, artifact_dir, timeout, files_command)
    if not local_path:
        return {"status": "download_failed", "usable": False, "extractor": "file-metadata", "artifact": None, "error": error}
    metadata_path = artifact_dir / f"{file_id}.{kind}.metadata.json"
    script = Path(__file__).resolve().parent / "inspect_file_metadata.py"
    command = [
        "python3", str(script), str(local_path), "--kind", kind, "--output", str(metadata_path),
    ]
    preview_path = artifact_dir / f"{file_id}.design.preview.png"
    vision_request_path = artifact_dir / f"{file_id}.design.vision-request.json"
    if kind == "design_raw":
        command.extend([
            "--preview-output",
            str(preview_path),
            "--vision-request-output",
            str(vision_request_path),
        ])
    result, extract_error = run_json(command, timeout)
    if not result:
        return {"status": "failed", "usable": False, "extractor": "file-metadata", "artifact": None, "error": extract_error}
    status = result.get("status", "unknown")
    details = result.get("details") if isinstance(result.get("details"), dict) else {}
    preview = result.get("preview") if isinstance(result.get("preview"), dict) else {}
    return {
        "status": status,
        "usable": False,
        "routed": status in {"metadata_ready", "tool_required"},
        "extractor": "file-metadata",
        "artifact": str(metadata_path) if metadata_path.exists() else None,
        "preview_artifact": str(preview_path) if kind == "design_raw" and preview_path.exists() else None,
        "vision_request_artifact": str(vision_request_path) if kind == "design_raw" and vision_request_path.exists() else None,
        "summary": {
            "kind": result.get("kind"),
            "detected_mime": (result.get("magic") or {}).get("mime") if isinstance(result.get("magic"), dict) else None,
            "width": details.get("width"),
            "height": details.get("height"),
            "duration": details.get("duration"),
            "ocr_status": details.get("ocr_status"),
            "media_status": details.get("media_status"),
            "preview_status": details.get("preview_status"),
            "preview_tool": details.get("preview_tool") or preview.get("tool"),
            "preview_bytes": preview.get("bytes"),
            "required_tool": details.get("required_tool") or details.get("ocr_required_tool") or details.get("preview_required_tool"),
        },
        "error": result.get("error") or extract_error,
    }


def smoke_image_ocr(file_id: str, size: int, artifact_dir: Path, timeout: int, max_download_bytes: int, files_command: list[str]) -> dict[str, Any]:
    if size > max_download_bytes:
        return {
            "status": "skipped_size",
            "usable": False,
            "routed": True,
            "route": "large-file-image-ocr-runner",
            "extractor": "tesseract-ocr",
            "artifact": None,
            "error": f"sample exceeds max download bytes: {size} > {max_download_bytes}",
        }
    local_path, error = download_for_smoke(file_id, artifact_dir, timeout, files_command)
    if not local_path:
        return {"status": "download_failed", "usable": False, "extractor": "tesseract-ocr", "artifact": None, "error": error}
    ocr_path = artifact_dir / f"{file_id}.image.ocr.json"
    text_path = artifact_dir / f"{file_id}.image.ocr.txt"
    vision_request_path = artifact_dir / f"{file_id}.image.vision-request.json"
    script = Path(__file__).resolve().parent / "extract_image_ocr.py"
    result, extract_error = run_json([
        "python3",
        str(script),
        str(local_path),
        "--output",
        str(ocr_path),
        "--text-output",
        str(text_path),
        "--vision-request-output",
        str(vision_request_path),
        "--timeout-seconds",
        str(timeout),
    ], timeout)
    if not result:
        return {"status": "failed", "usable": False, "extractor": "tesseract-ocr", "artifact": None, "error": extract_error}
    status = result.get("status", "unknown")
    details = result.get("details") if isinstance(result.get("details"), dict) else {}
    metrics = result.get("text_metrics") if isinstance(result.get("text_metrics"), dict) else {}
    return {
        "status": status,
        "usable": status == "ready",
        "routed": status in {"ready", "empty", "tool_required", "too_large", "too_many_frames", "unidentified_image"},
        "extractor": "tesseract-ocr",
        "artifact": str(ocr_path) if ocr_path.exists() else None,
        "vision_request_artifact": str(vision_request_path) if vision_request_path.exists() else None,
        "summary": {
            "width": details.get("width"),
            "height": details.get("height"),
            "frames": details.get("frames"),
            "words": metrics.get("words"),
            "required_tool": "tesseract" if status == "tool_required" else None,
            "content_route": result.get("routing", {}).get("content_route") if isinstance(result.get("routing"), dict) else None,
            "confidence": result.get("routing", {}).get("confidence") if isinstance(result.get("routing"), dict) else None,
            "vision_status": result.get("vision", {}).get("status") if isinstance(result.get("vision"), dict) else None,
        },
        "error": result.get("error") or extract_error,
    }


def smoke_unsupported(lane: str) -> dict[str, Any]:
    return {
        "status": "not_implemented",
        "usable": False,
        "routed": True,
        "route": f"{lane}-runner",
        "extractor": lane,
        "artifact": None,
        "error": "lane requires download/render/transcription/OCR runner before content extraction smoke",
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Run bounded extraction smoke matrix.")
    parser.add_argument("--db", default=str(default_db_path()), help="SQLite DB path")
    parser.add_argument("--artifact-dir", default=".codewith/private-artifacts/extraction-smoke", help="Private artifact directory")
    parser.add_argument("--output", default=".codewith/private-artifacts/extraction-smoke-summary.json", help="Aggregate summary JSON path")
    parser.add_argument("--limit-per-lane-bucket", type=int, default=1, help="Samples per lane/size bucket")
    parser.add_argument("--max-download-bytes", type=int, default=10 * 1024 * 1024, help="Maximum file size to download for extractor smoke")
    parser.add_argument("--timeout-seconds", type=int, default=30, help="Extractor timeout")
    parser.add_argument("--files-command", default="files", help="Command used to run the files CLI, for example 'bun run src/cli/index.tsx'")
    args = parser.parse_args()

    db_path = Path(args.db).expanduser()
    if not db_path.exists():
        raise SystemExit(f"database not found: {db_path}")
    artifact_dir = Path(args.artifact_dir).expanduser().resolve()
    artifact_dir.mkdir(parents=True, exist_ok=True)
    files_command = parse_files_command(args.files_command)

    db = sqlite3.connect(db_path)
    rows = sample_rows(db, args.limit_per_lane_bucket)
    results: list[dict[str, Any]] = []
    for row in rows:
        file_id = row["file_id"]
        lane = corpus_lane_for(row["mime"], row["file_name"], row["ext"])
        size = int(row["size"] or 0)
        if lane == "readable_now_text":
            extraction = smoke_text(file_id, artifact_dir, args.timeout_seconds, files_command)
        elif lane == "needs_pdf_extractor":
            extraction = smoke_pdf(file_id, size, artifact_dir, args.timeout_seconds, args.max_download_bytes, files_command)
        elif lane == "needs_office_extractor":
            extraction = smoke_office(file_id, size, artifact_dir, args.timeout_seconds, args.max_download_bytes, files_command)
        elif lane == "needs_archive_inventory":
            extraction = smoke_archive(file_id, row["mime"], size, artifact_dir, args.timeout_seconds, args.max_download_bytes, files_command)
        elif lane == "needs_ocr_or_vision":
            extraction = smoke_image_ocr(file_id, size, artifact_dir, args.timeout_seconds, args.max_download_bytes, files_command)
        elif lane in {"needs_transcription", "needs_video_pipeline", "needs_design_raw_pipeline", "metadata_only_or_unknown"}:
            extraction = smoke_metadata_lane(file_id, lane, size, artifact_dir, args.timeout_seconds, args.max_download_bytes, files_command)
        else:
            extraction = smoke_unsupported(lane)
        results.append({
            "file_id": file_id,
            "lane": lane,
            "mime": row["mime"],
            "size_bucket": size_bucket(int(row["size"] or 0)),
            "size": int(row["size"] or 0),
            "owner": row["owner"],
            "review_status": row["review_status"],
            "extraction": extraction,
        })

    by_lane: dict[str, dict[str, int]] = {}
    for result in results:
        lane = result["lane"]
        entry = by_lane.setdefault(lane, {
            "samples": 0,
            "usable": 0,
            "routed": 0,
            "failed": 0,
            "not_implemented": 0,
            "skipped_size": 0,
        })
        entry["samples"] += 1
        status = result["extraction"]["status"]
        if result["extraction"].get("usable"):
            entry["usable"] += 1
        if result["extraction"].get("routed") or result["extraction"].get("usable"):
            entry["routed"] += 1
        if status == "not_implemented":
            entry["not_implemented"] += 1
        elif status == "skipped_size":
            entry["skipped_size"] += 1
        elif not result["extraction"].get("routed") and not result["extraction"].get("usable"):
            entry["failed"] += 1

    output = {
        "db": str(db_path),
        "artifact_dir": str(artifact_dir),
        "files_command": {
            "argc": len(files_command),
            "argv0": Path(files_command[0]).name,
            "sha256": sha256_text("\0".join(files_command)),
        },
        "redaction": "stdout aggregate-only; artifacts are private-local and may contain extracted text",
        "samples": len(results),
        "by_lane": by_lane,
        "results": results,
    }
    output_path = Path(args.output).expanduser().resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(output, indent=2, sort_keys=True), encoding="utf-8")

    public = {key: value for key, value in output.items() if key != "results"}
    print(json.dumps(public, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
