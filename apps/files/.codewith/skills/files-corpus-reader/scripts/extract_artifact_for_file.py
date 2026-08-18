#!/usr/bin/env python3
"""Create a bounded private extraction artifact for one open-files file ID.

This is the per-file runner entrypoint for LLM workers. It writes extracted
text/metadata only to artifact files and prints status JSON.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shlex
import sqlite3
import subprocess
from datetime import datetime, timezone
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


def sha256_text(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8", errors="replace")).hexdigest()


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


def child_env(db_path: Path | None = None) -> dict[str, str]:
    env = os.environ.copy()
    if db_path is not None:
        env["HASNA_FILES_DB_PATH"] = str(db_path)
    return env


def run_json(cmd: list[str], timeout: int, db_path: Path | None = None) -> tuple[dict[str, Any] | None, str | None]:
    proc = subprocess.run(cmd, check=False, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=timeout, env=child_env(db_path))
    try:
        parsed = json.loads(proc.stdout)
        if proc.returncode == 0:
            return parsed, None
        return parsed, str(proc.stderr or parsed.get("error") or proc.stdout).strip()[:1000]
    except json.JSONDecodeError as exc:
        if proc.returncode != 0:
            return None, (proc.stderr or proc.stdout).strip()[:1000]
        return None, f"json_parse_failed: {exc}"


def run_command(cmd: list[str], timeout: int, db_path: Path | None = None) -> tuple[bool, str | None]:
    proc = subprocess.run(cmd, check=False, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=timeout, env=child_env(db_path))
    if proc.returncode == 0:
        return True, None
    return False, (proc.stderr or proc.stdout).strip()[:1000]


def command_prefix(value: str) -> list[str]:
    parts = shlex.split(value)
    if not parts:
        raise SystemExit("--files-command produced no command")
    return parts


def fetch_file(db_path: Path, file_id: str) -> sqlite3.Row:
    db = sqlite3.connect(db_path)
    db.row_factory = sqlite3.Row
    row = db.execute(
        """
        SELECT
          f.id AS file_id,
          f.name AS file_name,
          f.ext AS ext,
          f.mime AS mime,
          f.size AS size,
          v.id AS revision_id,
          v.source_ref AS source_ref
        FROM files f
        LEFT JOIN file_versions v
          ON v.id = (
            SELECT id FROM file_versions latest
            WHERE latest.file_id = f.id
            ORDER BY latest.created_at DESC, latest.id DESC
            LIMIT 1
          )
        WHERE f.id = ? AND f.status = 'active'
        LIMIT 1
        """,
        (file_id,),
    ).fetchone()
    if row is None:
        raise SystemExit("active file not found")
    return row


def suffix_for_mime(mime: str) -> str:
    return {
        "application/pdf": ".pdf",
        "application/zip": ".zip",
        "application/x-zip-compressed": ".zip",
        "application/x-tar": ".tar",
        "application/gzip": ".gz",
        "application/x-gzip": ".gz",
        "application/x-7z-compressed": ".7z",
        "application/x-rar-compressed": ".rar",
    }.get((mime or "").split(";")[0].lower(), "")


def download_file(file_id: str, mime: str, artifact_dir: Path, timeout: int, files_command: list[str], db_path: Path) -> tuple[Path | None, str | None]:
    downloads = artifact_dir / "downloads"
    downloads.mkdir(parents=True, exist_ok=True)
    dest = downloads / f"{file_id}{suffix_for_mime(mime)}"
    ok, error = run_command([*files_command, "download", file_id, str(dest)], timeout, db_path)
    return (dest, None) if ok else (None, error)


def extract_text(file_id: str, artifact_dir: Path, timeout: int, files_command: list[str], db_path: Path) -> dict[str, Any]:
    artifact = artifact_dir / f"{file_id}.snapshot.json"
    result, error = run_json([
        *files_command,
        "extract-snapshot",
        file_id,
        "--json",
        "--max-bytes",
        "16384",
        "--segment-chars",
        "3000",
    ], timeout, db_path)
    if result:
        artifact.write_text(json.dumps(result, indent=2, sort_keys=True), encoding="utf-8")
        return {
            "status": result.get("status", "unknown"),
            "extractor": "files-extract-snapshot",
            "artifact": str(artifact),
            "artifact_ready": True,
            "content_ready": result.get("status") in {"ready", "too_large"},
            "usable": result.get("status") in {"ready", "too_large"},
            "error": None,
        }
    return {"status": "failed", "extractor": "files-extract-snapshot", "artifact": None, "artifact_ready": False, "content_ready": False, "usable": False, "error": error}


def extract_downloaded(file_id: str, lane: str, mime: str, local_path: Path, artifact_dir: Path, timeout: int) -> dict[str, Any]:
    script_dir = Path(__file__).resolve().parent
    if lane == "needs_pdf_extractor":
        artifact = artifact_dir / f"{file_id}.pdf.txt"
        result, error = run_json(["python3", str(script_dir / "extract_pdf_text.py"), str(local_path), "--output", str(artifact), "--max-pages", "20"], timeout)
        extractor = "pdftotext"
    elif lane == "needs_office_extractor":
        artifact = artifact_dir / f"{file_id}.office.txt"
        structured_artifact = artifact_dir / f"{file_id}.office.structured.json"
        result, error = run_json([
            "python3",
            str(script_dir / "extract_office_text.py"),
            str(local_path),
            "--output",
            str(artifact),
            "--structured-output",
            str(structured_artifact),
        ], timeout)
        extractor = "libreoffice"
    elif lane == "needs_archive_inventory":
        artifact = artifact_dir / f"{file_id}.archive.json"
        result, error = run_json(["python3", str(script_dir / "archive_inventory.py"), str(local_path), "--output", str(artifact), "--max-entries", "5000"], timeout)
        extractor = "archive-inventory"
    elif lane == "needs_ocr_or_vision":
        artifact = artifact_dir / f"{file_id}.image.ocr.json"
        text_artifact = artifact_dir / f"{file_id}.image.ocr.txt"
        vision_request_artifact = artifact_dir / f"{file_id}.image.vision-request.json"
        result, error = run_json([
            "python3",
            str(script_dir / "extract_image_ocr.py"),
            str(local_path),
            "--output",
            str(artifact),
            "--text-output",
            str(text_artifact),
            "--vision-request-output",
            str(vision_request_artifact),
            "--timeout-seconds",
            str(timeout),
        ], timeout)
        extractor = "tesseract-ocr"
    else:
        kind = {
            "needs_transcription": "media",
            "needs_video_pipeline": "media",
            "needs_design_raw_pipeline": "design_raw",
            "metadata_only_or_unknown": "unknown",
        }.get(lane, "unknown")
        artifact = artifact_dir / f"{file_id}.{kind}.metadata.json"
        command = ["python3", str(script_dir / "inspect_file_metadata.py"), str(local_path), "--kind", kind, "--output", str(artifact)]
        if lane == "needs_design_raw_pipeline":
            preview_artifact = artifact_dir / f"{file_id}.design.preview.png"
            vision_request_artifact = artifact_dir / f"{file_id}.design.vision-request.json"
            command.extend([
                "--preview-output",
                str(preview_artifact),
                "--vision-request-output",
                str(vision_request_artifact),
                "--timeout-seconds",
                str(timeout),
            ])
        result, error = run_json(command, timeout)
        extractor = "file-metadata"

    if not result:
        return {"status": "failed", "extractor": extractor, "artifact": None, "artifact_ready": False, "content_ready": False, "usable": False, "error": error}
    status = result.get("status", "unknown")
    content_ready = status == "ready" and lane in {"needs_pdf_extractor", "needs_office_extractor", "needs_ocr_or_vision"}
    artifact_ready = status in {"ready", "metadata_ready", "too_large", "too_many_frames", "empty", "tool_required", "unsupported", "unidentified_image"}
    return {
        "status": status,
        "extractor": extractor,
        "artifact": str(artifact) if artifact.exists() else None,
        "structured_artifact": str(structured_artifact) if lane == "needs_office_extractor" and "structured_artifact" in locals() and structured_artifact.exists() else None,
        "preview_artifact": str(preview_artifact) if lane == "needs_design_raw_pipeline" and "preview_artifact" in locals() and preview_artifact.exists() else None,
        "vision_request_artifact": str(vision_request_artifact) if lane in {"needs_ocr_or_vision", "needs_design_raw_pipeline"} and "vision_request_artifact" in locals() and vision_request_artifact.exists() else None,
        "artifact_ready": artifact_ready,
        "content_ready": content_ready,
        "usable": content_ready,
        "error": result.get("error") or error,
    }


def write_provenance(row: sqlite3.Row, lane: str, extraction: dict[str, Any], artifact_dir: Path) -> Path:
    source_ref = row["source_ref"]
    sidecar = artifact_dir / f"{row['file_id']}.artifact-provenance.json"
    payload = {
        "created_at": datetime.now(timezone.utc).isoformat(),
        "extractor": extraction.get("extractor"),
        "status": extraction.get("status"),
        "file_id": row["file_id"],
        "revision_id": row["revision_id"],
        "source_ref_sha256": sha256_text(source_ref) if isinstance(source_ref, str) and source_ref else None,
        "lane": lane,
        "mime": row["mime"],
        "size": int(row["size"] or 0),
        "artifact": extraction.get("artifact"),
        "structured_artifact": extraction.get("structured_artifact"),
        "vision_request_artifact": extraction.get("vision_request_artifact"),
        "artifact_ready": extraction.get("artifact_ready"),
        "content_ready": extraction.get("content_ready"),
        "route": extraction.get("route"),
        "redaction": "source_ref is hashed; filenames, paths, object keys, and extracted content are not stored in this sidecar",
    }
    sidecar.write_text(json.dumps(payload, indent=2, sort_keys=True), encoding="utf-8")
    return sidecar


def review_from_snapshot(path: Path) -> dict[str, Any]:
    data = json.loads(path.read_text(encoding="utf-8", errors="replace"))
    texts: list[str] = []
    for key in ("sections", "pages"):
        value = data.get(key)
        if isinstance(value, list):
            for item in value:
                if isinstance(item, dict) and isinstance(item.get("text"), str):
                    texts.append(item["text"])
                if len(" ".join(texts)) > 2400:
                    break
        if texts:
            break
    combined = "\n".join(texts)
    return {
        "text_metrics": text_metrics(combined),
        "redacted_excerpt": sanitize_text(combined),
        "truncated": bool(data.get("truncated")),
        "language_hints": data.get("language_hints") if isinstance(data.get("language_hints"), list) else [],
        "content_hints": data.get("content_hints") if isinstance(data.get("content_hints"), list) else [],
    }


def review_from_text(path: Path) -> dict[str, Any]:
    text = path.read_text(encoding="utf-8", errors="replace")
    return {
        "text_metrics": text_metrics(text),
        "redacted_excerpt": sanitize_text(text),
    }


def review_from_office_structured(structured_path: Path, text_path: Path | None = None) -> dict[str, Any]:
    data = json.loads(structured_path.read_text(encoding="utf-8", errors="replace"))
    structure = data.get("structure") if isinstance(data.get("structure"), dict) else {}
    summary = data.get("structure_summary") if isinstance(data.get("structure_summary"), dict) else {}
    text_metrics = data.get("text") if isinstance(data.get("text"), dict) else {}
    headings: list[str] = []
    for block in structure.get("blocks", []):
        if not isinstance(block, dict) or block.get("type") != "heading":
            continue
        text = block.get("text")
        if isinstance(text, str) and text.strip():
            headings.append(sanitize_text(text, 180))
        if len(headings) >= 10:
            break
    table_summaries: list[dict[str, Any]] = []
    for table in structure.get("tables", []):
        if not isinstance(table, dict):
            continue
        table_summaries.append({
            "rows": table.get("rows"),
            "columns": table.get("columns"),
            "sample_truncated": bool(table.get("sample_truncated")),
        })
        if len(table_summaries) >= 10:
            break
    excerpt = ""
    if text_path and text_path.exists():
        excerpt = sanitize_text(text_path.read_text(encoding="utf-8", errors="replace"))
    return {
        "text_metrics": text_metrics,
        "redacted_excerpt": excerpt,
        "structure": {
            "blocks": summary.get("blocks"),
            "block_types": summary.get("block_types"),
            "blocks_truncated": bool(summary.get("blocks_truncated")),
            "tables": summary.get("tables"),
            "tables_truncated": bool(summary.get("tables_truncated")),
            "headings": headings,
            "table_summaries": table_summaries,
        },
    }


def review_from_archive(path: Path) -> dict[str, Any]:
    data = json.loads(path.read_text(encoding="utf-8", errors="replace"))
    suffix_counts: dict[str, int] = {}
    entries = data.get("entries")
    if isinstance(entries, list):
        for entry in entries:
            if isinstance(entry, dict):
                suffix = str(entry.get("suffix") or "_none")
                suffix_counts[suffix] = suffix_counts.get(suffix, 0) + 1
    return {
        "archive_kind": data.get("archive_kind"),
        "entry_count": data.get("entry_count"),
        "entries_truncated": data.get("entries_truncated"),
        "uncompressed_bytes_reported": data.get("uncompressed_bytes_reported"),
        "entry_suffix_counts": dict(sorted(suffix_counts.items())),
    }


def review_from_metadata(path: Path) -> dict[str, Any]:
    data = json.loads(path.read_text(encoding="utf-8", errors="replace"))
    details = data.get("details") if isinstance(data.get("details"), dict) else {}
    magic = data.get("magic") if isinstance(data.get("magic"), dict) else {}
    safe_magic: dict[str, Any] = {
        "mime": magic.get("mime") or magic.get("file_mime"),
    }
    description = magic.get("description") or magic.get("file_description")
    if isinstance(description, str):
        safe_magic["description"] = sanitize_text(description, 300)
    return {
        "kind": data.get("kind"),
        "magic": safe_magic,
        "details": {
            key: details.get(key)
            for key in [
                "pil_status",
                "format",
                "mode",
                "width",
                "height",
                "frames",
                "ocr_status",
                "vision_status",
                "media_status",
                "duration",
                "stream_count",
                "preview_status",
                "exif_status",
                "required_tool",
                "ocr_required_tool",
                "preview_required_tool",
            ]
            if key in details
        },
    }


def review_from_image_ocr(path: Path) -> dict[str, Any]:
    data = json.loads(path.read_text(encoding="utf-8", errors="replace"))
    details = data.get("details") if isinstance(data.get("details"), dict) else {}
    ocr = data.get("ocr") if isinstance(data.get("ocr"), dict) else {}
    return {
        "kind": "image",
        "details": {
            key: details.get(key)
            for key in [
                "pil_status",
                "format",
                "mode",
                "width",
                "height",
                "frames",
                "ocr_required_tool",
            ]
            if key in details
        },
        "ocr": {
            "status": ocr.get("status") or data.get("status"),
            "text_metrics": ocr.get("text_metrics") if isinstance(ocr.get("text_metrics"), dict) else None,
            "redacted_excerpt": ocr.get("redacted_excerpt") if isinstance(ocr.get("redacted_excerpt"), str) else "",
            "text_truncated": bool(ocr.get("text_truncated")),
        },
        "routing": data.get("routing") if isinstance(data.get("routing"), dict) else {},
        "vision": data.get("vision") if isinstance(data.get("vision"), dict) else {},
    }


def build_review_payload(row: sqlite3.Row, lane: str, extraction: dict[str, Any]) -> dict[str, Any]:
    artifact = Path(str(extraction.get("artifact"))) if extraction.get("artifact") else None
    review: dict[str, Any] = {}
    if artifact and artifact.exists():
        try:
            if artifact.name.endswith(".snapshot.json"):
                review = review_from_snapshot(artifact)
            elif artifact.name.endswith(".archive.json"):
                review = review_from_archive(artifact)
            elif artifact.name.endswith(".image.ocr.json"):
                review = review_from_image_ocr(artifact)
            elif artifact.name.endswith(".metadata.json"):
                review = review_from_metadata(artifact)
            elif artifact.name.endswith(".office.txt") and extraction.get("structured_artifact"):
                structured_path = Path(str(extraction.get("structured_artifact")))
                if structured_path.exists():
                    review = review_from_office_structured(structured_path, artifact)
                else:
                    review = review_from_text(artifact)
            else:
                review = review_from_text(artifact)
        except Exception as exc:
            review = {"review_error": type(exc).__name__}
    return {
        "file_id": row["file_id"],
        "lane": lane,
        "mime": row["mime"],
        "ext": row["ext"],
        "size": int(row["size"] or 0),
        "status": extraction.get("status"),
        "extractor": extraction.get("extractor"),
        "artifact_ready": extraction.get("artifact_ready"),
        "content_ready": extraction.get("content_ready"),
        "route": extraction.get("route"),
        "review": review,
        "redaction": "bounded review artifact; no filenames, paths, object keys, source refs, ACL payloads, transcripts, or raw full text",
    }


def write_review_artifact(row: sqlite3.Row, lane: str, extraction: dict[str, Any], artifact_dir: Path) -> Path:
    review_path = artifact_dir / f"{row['file_id']}.review.json"
    review_path.write_text(json.dumps(build_review_payload(row, lane, extraction), indent=2, sort_keys=True), encoding="utf-8")
    return review_path


def main() -> int:
    parser = argparse.ArgumentParser(description="Create a bounded private extraction artifact for one file ID.")
    parser.add_argument("file_id", help="open-files file ID")
    parser.add_argument("--db", default=str(default_db_path()), help="SQLite DB path")
    parser.add_argument("--artifact-dir", default=".codewith/private-artifacts/per-file-artifacts", help="Private artifact directory")
    parser.add_argument("--max-download-bytes", type=int, default=100 * 1024 * 1024, help="Maximum object size to download")
    parser.add_argument("--timeout-seconds", type=int, default=120, help="Extractor timeout")
    parser.add_argument("--files-command", default="files", help="files CLI command/path; supports quoted multi-argument commands")
    parser.add_argument("--include-raw-artifact-path", action="store_true", help="Include raw extraction artifact path in stdout status JSON")
    args = parser.parse_args()

    db_path = Path(args.db).expanduser()
    row = fetch_file(db_path, args.file_id)
    mime = row["mime"]
    size = int(row["size"] or 0)
    lane = corpus_lane_for(mime, row["file_name"], row["ext"])
    artifact_dir = Path(args.artifact_dir).expanduser().resolve()
    artifact_dir.mkdir(parents=True, exist_ok=True)
    files_command = command_prefix(args.files_command)

    if lane == "readable_now_text":
        extraction = extract_text(args.file_id, artifact_dir, args.timeout_seconds, files_command, db_path)
    elif size > args.max_download_bytes:
        extraction = {
            "status": "skipped_size",
            "extractor": "large-file-router",
            "artifact": None,
            "artifact_ready": False,
            "content_ready": False,
            "usable": False,
            "route": f"large-file-{lane}-runner",
            "error": f"file exceeds max download bytes: {size} > {args.max_download_bytes}",
        }
    else:
        local_path, error = download_file(args.file_id, mime, artifact_dir, args.timeout_seconds, files_command, db_path)
        if not local_path:
            extraction = {"status": "download_failed", "extractor": "files-download", "artifact": None, "artifact_ready": False, "content_ready": False, "usable": False, "error": error}
        else:
            extraction = extract_downloaded(args.file_id, lane, mime, local_path, artifact_dir, args.timeout_seconds)
    review_artifact = write_review_artifact(row, lane, extraction, artifact_dir)
    provenance = write_provenance(row, lane, extraction, artifact_dir)

    output = {
        "status": extraction["status"],
        "file_id": args.file_id,
        "lane": lane,
        "mime": mime,
        "size": size,
        "artifact": extraction.get("artifact") if args.include_raw_artifact_path else None,
        "artifact_ready": extraction.get("artifact_ready"),
        "content_ready": extraction.get("content_ready"),
        "extractor": extraction.get("extractor"),
        "provenance": str(provenance),
        "raw_artifact_available": bool(extraction.get("artifact")),
        "review_artifact": str(review_artifact),
        "usable": extraction.get("usable"),
        "route": extraction.get("route"),
        "error": extraction.get("error"),
        "redaction": "extracted content, filenames, paths, and object keys are not printed",
    }
    print(json.dumps(output, indent=2, sort_keys=True))
    return 0 if output["status"] not in {"failed", "download_failed"} else 1


if __name__ == "__main__":
    raise SystemExit(main())
