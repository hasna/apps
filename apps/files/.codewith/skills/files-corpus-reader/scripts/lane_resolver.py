"""Shared file-lane resolution for open-files corpus tooling."""

from __future__ import annotations

from pathlib import Path


TEXT_MIMES = {
    "application/json",
    "application/ld+json",
    "application/xml",
    "application/xhtml+xml",
    "application/yaml",
    "application/x-yaml",
    "application/toml",
    "application/javascript",
    "application/typescript",
    "application/sql",
    "image/svg+xml",
}

TEXT_EXTENSIONS = {
    ".css",
    ".csv",
    ".htm",
    ".html",
    ".js",
    ".json",
    ".jsonl",
    ".jsx",
    ".md",
    ".markdown",
    ".sql",
    ".svg",
    ".toml",
    ".ts",
    ".tsx",
    ".tsv",
    ".txt",
    ".xml",
    ".yaml",
    ".yml",
}

OFFICE_MIMES = {
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "application/msword",
    "application/vnd.ms-excel",
    "application/vnd.ms-powerpoint",
    "application/vnd.oasis.opendocument.text",
    "application/vnd.oasis.opendocument.spreadsheet",
    "application/vnd.oasis.opendocument.presentation",
}

ARCHIVE_MIMES = {
    "application/zip",
    "application/x-zip-compressed",
    "application/x-tar",
    "application/gzip",
    "application/x-gzip",
    "application/x-7z-compressed",
    "application/x-rar-compressed",
}

DESIGN_RAW_MIMES = {
    "image/x-photoshop",
    "image/vnd.adobe.photoshop",
    "image/x-sony-arw",
    "application/postscript",
    "application/illustrator",
}


def normalize_mime(mime: str | None) -> str:
    return (mime or "application/octet-stream").split(";")[0].lower()


def normalize_extension(name: str | None = None, ext: str | None = None) -> str:
    if ext:
        return f".{ext.lower().lstrip('.')}"
    return Path(name or "").suffix.lower()


def corpus_lane_for(mime: str | None, name: str | None = None, ext: str | None = None) -> str:
    normalized = normalize_mime(mime)
    suffix = normalize_extension(name, ext)
    if normalized.startswith("text/") or normalized in TEXT_MIMES or suffix in TEXT_EXTENSIONS:
        return "readable_now_text"
    if normalized == "application/pdf":
        return "needs_pdf_extractor"
    if normalized in OFFICE_MIMES:
        return "needs_office_extractor"
    if normalized.startswith("image/") and normalized not in DESIGN_RAW_MIMES:
        return "needs_ocr_or_vision"
    if normalized.startswith("audio/"):
        return "needs_transcription"
    if normalized.startswith("video/"):
        return "needs_video_pipeline"
    if normalized in ARCHIVE_MIMES:
        return "needs_archive_inventory"
    if normalized in DESIGN_RAW_MIMES:
        return "needs_design_raw_pipeline"
    return "metadata_only_or_unknown"


def semantic_lane_for(mime: str | None, name: str | None = None, ext: str | None = None) -> str:
    return {
        "readable_now_text": "text",
        "needs_pdf_extractor": "pdf",
        "needs_office_extractor": "office",
        "needs_ocr_or_vision": "image_ocr_or_vision",
        "needs_transcription": "audio_transcription",
        "needs_video_pipeline": "video_transcription_keyframes",
        "needs_archive_inventory": "archive_inventory",
        "needs_design_raw_pipeline": "design_raw_metadata_preview",
        "metadata_only_or_unknown": "metadata_only_or_unknown",
    }[corpus_lane_for(mime, name, ext)]


def expected_extension_for(mime: str | None, ext: str | None = None) -> str | None:
    if ext:
        normalized_ext = ext.lower().lstrip(".")
        return normalized_ext or None
    return {
        "application/json": "json",
        "application/pdf": "pdf",
        "application/zip": "zip",
        "image/gif": "gif",
        "image/jpeg": "jpg",
        "image/png": "png",
        "text/csv": "csv",
        "text/plain": "txt",
    }.get(normalize_mime(mime))
