#!/usr/bin/env python3
"""Inventory archive contents without extracting member bytes.

Stdout is aggregate JSON. Full inventory is written to --output when provided.
Entry names are hashed by default; pass --include-names only for private local
artifacts that agents are allowed to inspect.
"""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import shutil
import subprocess
import tarfile
import zipfile
from pathlib import Path
from typing import Any


EXTRACTOR = "open-files-archive-inventory-v1"
SEVEN_ZIP_TOOLS = ("7zz", "7z", "7za")
RAR_TOOLS = ("unrar", "7zz", "7z", "7za", "bsdtar")


def sha256_text(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8", errors="replace")).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def redact_name(name: str) -> dict[str, str]:
    suffix = Path(name).suffix.lower()
    return {"name_sha256": sha256_text(name), "suffix": suffix}


def entry_record(name: str, size: int, is_dir: bool, include_names: bool) -> dict[str, Any]:
    record: dict[str, Any] = {
        "size": size,
        "is_dir": is_dir,
    }
    if include_names:
        record["name"] = name
    else:
        record.update(redact_name(name))
    return record


def first_available(candidates: tuple[str, ...]) -> str | None:
    for candidate in candidates:
        binary = shutil.which(candidate)
        if binary:
            return binary
    return None


def inventory_zip(path: Path, include_names: bool, max_entries: int) -> list[dict[str, Any]]:
    entries: list[dict[str, Any]] = []
    with zipfile.ZipFile(path) as archive:
        for info in archive.infolist()[:max_entries]:
            entries.append(entry_record(info.filename, info.file_size, info.is_dir(), include_names))
    return entries


def inventory_tar(path: Path, include_names: bool, max_entries: int) -> list[dict[str, Any]]:
    entries: list[dict[str, Any]] = []
    with tarfile.open(path) as archive:
        for index, member in enumerate(archive):
            if index >= max_entries:
                break
            entries.append(entry_record(member.name, int(member.size), member.isdir(), include_names))
    return entries


def inventory_gzip(path: Path, include_names: bool) -> list[dict[str, Any]]:
    with gzip.open(path, "rb") as handle:
        sample = handle.read(1024)
    name = path.with_suffix("").name or path.name
    return [{
        **entry_record(name, 0, False, include_names),
        "sample_bytes": len(sample),
        "note": "gzip stream inventory only; member size is not trusted without decompression",
    }]


def inventory_with_7z(path: Path, include_names: bool, max_entries: int, candidates: tuple[str, ...] = SEVEN_ZIP_TOOLS) -> tuple[list[dict[str, Any]], str]:
    binary = first_available(candidates)
    if binary is None:
        raise RuntimeError(f"missing required archive tool; candidates: {', '.join(candidates)}")
    proc = subprocess.run(
        [binary, "l", "-slt", str(path)],
        check=False,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    if proc.returncode != 0:
        raise RuntimeError((proc.stderr or proc.stdout).strip()[:1000])

    entries: list[dict[str, Any]] = []
    current: dict[str, str] = {}

    def flush() -> None:
        if "Path" not in current or current["Path"] in {str(path), path.name}:
            return
        attributes = current.get("Attributes", "")
        is_dir = "D" in attributes
        try:
            size = int(current.get("Size", "0") or 0)
        except ValueError:
            size = 0
        entries.append(entry_record(current["Path"], size, is_dir, include_names))

    for line in proc.stdout.splitlines():
        if not line.strip():
            flush()
            current = {}
            if len(entries) >= max_entries:
                break
            continue
        if " = " not in line:
            continue
        key, value = line.split(" = ", 1)
        current[key] = value
    if len(entries) < max_entries:
        flush()
    return entries[:max_entries], Path(binary).name


def inventory_7z(path: Path, include_names: bool, max_entries: int) -> tuple[list[dict[str, Any]], str]:
    return inventory_with_7z(path, include_names, max_entries, SEVEN_ZIP_TOOLS)


def inventory_with_bsdtar(path: Path, include_names: bool, max_entries: int) -> tuple[list[dict[str, Any]], str]:
    binary = shutil.which("bsdtar")
    if binary is None:
        raise RuntimeError("missing required archive tool; candidates: bsdtar")
    proc = subprocess.run(
        [binary, "-tf", str(path)],
        check=False,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    if proc.returncode != 0:
        raise RuntimeError((proc.stderr or proc.stdout).strip()[:1000])
    entries = [
        entry_record(name.strip(), 0, name.strip().endswith("/"), include_names)
        for name in proc.stdout.splitlines()[:max_entries]
        if name.strip()
    ]
    return entries, Path(binary).name


def inventory_rar(path: Path, include_names: bool, max_entries: int) -> tuple[list[dict[str, Any]], str]:
    binary = shutil.which("unrar")
    if binary is not None:
        proc = subprocess.run(
            [binary, "lb", str(path)],
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        if proc.returncode != 0:
            raise RuntimeError((proc.stderr or proc.stdout).strip()[:1000])
        entries = [
            entry_record(name.strip(), 0, False, include_names)
            for name in proc.stdout.splitlines()[:max_entries]
            if name.strip()
        ]
        return entries, Path(binary).name

    if first_available(SEVEN_ZIP_TOOLS):
        return inventory_with_7z(path, include_names, max_entries, SEVEN_ZIP_TOOLS)
    if shutil.which("bsdtar"):
        return inventory_with_bsdtar(path, include_names, max_entries)
    raise RuntimeError(f"missing required archive tool; candidates: {', '.join(RAR_TOOLS)}")


def archive_kind(path: Path) -> str:
    lower = path.name.lower()
    if lower.endswith((".zip", ".x-zip-compressed")):
        return "zip"
    if lower.endswith((".tar", ".tar.gz", ".tgz", ".tar.bz2", ".tbz2", ".tar.xz", ".txz")):
        return "tar"
    if lower.endswith(".gz"):
        return "gzip"
    if lower.endswith(".7z"):
        return "7z"
    if lower.endswith(".rar"):
        return "rar"
    return "unsupported"


def main() -> int:
    parser = argparse.ArgumentParser(description="Inventory archive contents without extracting files.")
    parser.add_argument("file", help="Local archive path")
    parser.add_argument("--output", help="Optional path for full inventory JSON")
    parser.add_argument("--include-names", action="store_true", help="Include private archive member names in the output artifact.")
    parser.add_argument("--max-entries", type=int, default=5000, help="Maximum archive entries to inspect.")
    args = parser.parse_args()

    input_path = Path(args.file).expanduser()
    if not input_path.exists():
        raise SystemExit(f"file not found: {input_path}")

    kind = archive_kind(input_path)
    required_tool = None
    required_tool_candidates: list[str] = []
    selected_tool = None
    error = None
    try:
        if kind == "zip":
            entries = inventory_zip(input_path, args.include_names, args.max_entries)
        elif kind == "tar":
            entries = inventory_tar(input_path, args.include_names, args.max_entries)
        elif kind == "gzip":
            entries = inventory_gzip(input_path, args.include_names)
        elif kind == "7z":
            required_tool = "7z-compatible-list-tool"
            required_tool_candidates = list(SEVEN_ZIP_TOOLS)
            entries, selected_tool = inventory_7z(input_path, args.include_names, args.max_entries)
        elif kind == "rar":
            required_tool = "rar-list-tool"
            required_tool_candidates = list(RAR_TOOLS)
            entries, selected_tool = inventory_rar(input_path, args.include_names, args.max_entries)
        else:
            entries = []
    except RuntimeError as exc:
        entries = []
        error = str(exc)

    total_size = sum(int(entry.get("size", 0)) for entry in entries)
    if kind == "unsupported":
        status = "unsupported"
    elif error and error.startswith("missing required archive tool"):
        status = "tool_required"
    elif error:
        status = "failed"
    else:
        status = "ready"
    full = {
        "status": status,
        "extractor": EXTRACTOR,
        "archive_kind": kind,
        "required_tool": required_tool if kind in {"7z", "rar"} else None,
        "required_tool_candidates": required_tool_candidates,
        "selected_tool": selected_tool,
        "input": {
            "sha256": sha256_file(input_path),
            "bytes": input_path.stat().st_size,
        },
        "entry_count": len(entries),
        "entries_truncated": len(entries) >= args.max_entries,
        "uncompressed_bytes_reported": total_size,
        "entry_names": "included" if args.include_names else "sha256_redacted",
        "entries": entries,
    }
    if error:
        full["error"] = error

    if args.output:
        output_path = Path(args.output).expanduser().resolve()
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(json.dumps(full, indent=2, sort_keys=True), encoding="utf-8")

    summary = {key: value for key, value in full.items() if key != "entries"}
    summary["output"] = str(Path(args.output).expanduser().resolve()) if args.output else None
    print(json.dumps(summary, indent=2, sort_keys=True))
    return 0 if full["status"] == "ready" else 1


if __name__ == "__main__":
    raise SystemExit(main())
