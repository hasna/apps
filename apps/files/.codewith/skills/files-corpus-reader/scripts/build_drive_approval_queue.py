#!/usr/bin/env python3
"""Build an aggregate Drive/ACL approval queue artifact.

The artifact is intentionally read-only and redacted. It records only ready
todo metadata, aggregate row-count hints from task descriptions, and approval
prep document hashes so operators can coordinate Drive cleanup without exposing
private file names, object keys, ACL payloads, or row contents.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
import time
from collections import Counter
from pathlib import Path
from typing import Any


DEFAULT_OUTPUT = ".codewith/private-artifacts/drive-approval/drive-approval-queue.json"
DEFAULT_APPROVAL_DOC_DATE = "2026-06-09"

DRIVE_APPROVAL_TAGS = {
    "acl",
    "apply",
    "audit",
    "duplicates",
    "google-drive",
    "metadata",
    "owners",
    "rollback",
    "s3",
    "unassigned",
}

AREA_TAGS = {
    "finance",
    "legal",
    "marketing-sales",
    "people",
    "product",
    "workspace",
}

MEDIA_TAGS = {"audio", "video", "transcription"}

DOC_PATTERNS = (
    "docs/open-files-acl-*-review-prep-*.md",
    "docs/open-files-duplicate-*-review-prep-*.md",
    "docs/open-files-my-drive-*-review-prep-*.md",
    "docs/open-files-drive-approval-gate-checklist-*.md",
    "docs/open-files-drive-ready-approval-packet-*.md",
    "docs/open-files-drive-organization-workflow.md",
    "docs/open-files-legacy-rollback-policy.md",
    "docs/hasna-files-prod-legacy-resolution.md",
)

ROW_HINT_PATTERNS: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("my_drive_rows", re.compile(r"(\d[\d,]*)\s+My Drive rows", re.IGNORECASE)),
    ("shared_drive_rows", re.compile(r"(\d[\d,]*)\s+shared_drive rows", re.IGNORECASE)),
    ("groups", re.compile(r"(\d[\d,]*)\s+groups?", re.IGNORECASE)),
    ("rows", re.compile(r"(\d[\d,]*)\s+rows?", re.IGNORECASE)),
)

SENSITIVE_PATTERNS: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("json_file_id_key", re.compile(r'"file_id"\s*:')),
    ("private_file_id_value", re.compile(r"\bf_[A-Za-z0-9][A-Za-z0-9_-]{5,}\b")),
    ("open_files_ref", re.compile(r"open-files://")),
    ("s3_uri", re.compile(r"s3://")),
    ("object_sha_key", re.compile(r"objects/sha256/")),
    ("json_object_key", re.compile(r'"object_key"\s*:')),
    ("json_s3_key", re.compile(r'"s3_key"\s*:')),
    ("json_source_ref", re.compile(r'"source_ref"\s*:')),
    ("json_extracted_text", re.compile(r'"extracted_text"\s*:')),
    ("json_transcript", re.compile(r'"transcript"\s*:')),
    ("json_private_metadata", re.compile(r'"private_metadata"\s*:')),
    ("google_drive_url", re.compile(r"(drive|docs)\.google\.com/")),
)


def now_utc() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def text_sha256(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def scan_text(text: str) -> dict[str, int]:
    counts: dict[str, int] = {}
    for code, pattern in SENSITIVE_PATTERNS:
        count = len(pattern.findall(text))
        if count:
            counts[code] = count
    return counts


def sanitize_text(value: Any, max_len: int = 220) -> str:
    text = str(value or "")
    for _code, pattern in SENSITIVE_PATTERNS:
        text = pattern.sub("[redacted]", text)
    text = " ".join(text.split())
    return text[:max_len]


def safe_tags(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    tags: list[str] = []
    for item in value:
        tag = sanitize_text(item, max_len=64)
        if tag:
            tags.append(tag)
    return sorted(set(tags))


def load_json(path: Path | None) -> Any:
    if path is None or not path.exists():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def load_ready_todos(path: Path | None, project: str) -> list[dict[str, Any]]:
    if path:
        value = load_json(path)
        if not isinstance(value, list):
            raise SystemExit(f"expected ready todo JSON array: {path}")
        return [item for item in value if isinstance(item, dict)]

    proc = subprocess.run(
        ["todos", "--project", project, "ready", "--json"],
        check=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    value = json.loads(proc.stdout)
    if not isinstance(value, list):
        raise SystemExit("todos ready --json did not return a JSON array")
    return [item for item in value if isinstance(item, dict)]


def source_entry(label: str, path: Path | None) -> dict[str, Any]:
    return {
        "label": label,
        "present": bool(path and path.exists()),
        "bytes": path.stat().st_size if path and path.exists() else 0,
        "sha256": file_sha256(path) if path and path.exists() else None,
    }


def parse_int(value: str) -> int:
    return int(value.replace(",", ""))


def count_hints(description: str) -> list[dict[str, int | str]]:
    hints: list[dict[str, int | str]] = []
    seen: set[tuple[str, int]] = set()
    for kind, pattern in ROW_HINT_PATTERNS:
        for match in pattern.findall(description or ""):
            value = parse_int(match)
            key = (kind, value)
            if key in seen:
                continue
            seen.add(key)
            hints.append({"kind": kind, "value": value})
    return hints


def primary_row_hint(hints: list[dict[str, int | str]]) -> int | None:
    values = [
        int(item["value"])
        for item in hints
        if str(item.get("kind")).endswith("rows") or item.get("kind") == "rows"
    ]
    return max(values) if values else None


def business_area(tags: set[str]) -> str:
    areas = sorted(tags & AREA_TAGS)
    if areas:
        return areas[0]
    if "unassigned" in tags:
        return "unassigned"
    return "cross_area"


def root_type(tags: set[str]) -> str:
    if "my-drive" in tags:
        return "my_drive"
    if "shared-drive" in tags:
        return "shared_drive"
    if "duplicates" in tags:
        return "duplicate_groups"
    if {"apply", "metadata", "rollback", "audit", "s3"} & tags:
        return "migration_control"
    if "google-drive" in tags:
        return "google_drive"
    return "unknown"


def approval_type(tags: set[str]) -> str:
    if "duplicates" in tags:
        return "duplicate_owner_assignment"
    if "acl" in tags or "owners" in tags:
        return "acl_owner_approval"
    if {"apply", "metadata", "audit"} & tags:
        return "metadata_apply_and_audit"
    if {"rollback", "s3"} & tags:
        return "backup_rollback_evidence"
    if "unassigned" in tags:
        return "unassigned_folder_review"
    return "drive_approval"


def doc_kind(path: str) -> str:
    name = Path(path).name
    if name.startswith("open-files-acl-"):
        return "acl_review_prep"
    if name.startswith("open-files-duplicate-"):
        return "duplicate_review_prep"
    if name.startswith("open-files-my-drive-"):
        return "my_drive_review_prep"
    if name.startswith("open-files-drive-"):
        return "drive_control"
    if "rollback" in name or "legacy" in name:
        return "legacy_rollback"
    return "supporting_doc"


def doc_area(path: str) -> str:
    name = Path(path).name
    for area in sorted(AREA_TAGS | {"unassigned"}):
        if f"-{area}-" in name:
            return area
    return "cross_area"


def doc_root_type(path: str) -> str:
    name = Path(path).name
    if "my-drive" in name:
        return "my_drive"
    if "shared-drive" in name:
        return "shared_drive"
    if "duplicate" in name:
        return "duplicate_groups"
    if "drive-" in name or "legacy" in name:
        return "migration_control"
    return "unknown"


def source_doc_entry(root: Path, path: Path) -> dict[str, Any]:
    rel = path.relative_to(root).as_posix()
    return {
        "path": rel,
        "present": path.exists(),
        "bytes": path.stat().st_size if path.exists() else 0,
        "sha256": file_sha256(path) if path.exists() else None,
        "doc_kind": doc_kind(rel),
        "root_type": doc_root_type(rel),
        "business_area": doc_area(rel),
    }


def discover_source_docs(root: Path) -> list[dict[str, Any]]:
    docs: dict[str, dict[str, Any]] = {}
    for pattern in DOC_PATTERNS:
        for path in sorted(root.glob(pattern)):
            if path.is_file():
                entry = source_doc_entry(root, path)
                docs[entry["path"]] = entry
    return [docs[key] for key in sorted(docs)]


def expected_source_doc_paths(entry: dict[str, Any]) -> list[str]:
    root = entry["root_type"]
    area = entry["business_area"]
    kind = entry["approval_type"]
    tags = set(entry.get("tags") or [])
    title = str(entry.get("title") or "").lower()
    date = DEFAULT_APPROVAL_DOC_DATE

    if kind == "acl_owner_approval" and root in {"my_drive", "shared_drive"} and area != "cross_area":
        root_slug = root.replace("_", "-")
        return [f"docs/open-files-acl-{root_slug}-{area}-review-prep-{date}.md"]
    if kind == "duplicate_owner_assignment":
        duplicate_area = area if area != "cross_area" else "unassigned"
        return [f"docs/open-files-duplicate-{duplicate_area}-review-prep-{date}.md"]
    if kind == "metadata_apply_and_audit":
        return [
            f"docs/open-files-drive-approval-gate-checklist-{date}.md",
            f"docs/open-files-drive-ready-approval-packet-{date}.md",
            "docs/open-files-drive-organization-workflow.md",
        ]
    if kind == "backup_rollback_evidence":
        return [
            "docs/open-files-legacy-rollback-policy.md",
            "docs/hasna-files-prod-legacy-resolution.md",
        ]
    if kind == "unassigned_folder_review" and root == "my_drive":
        if "external-devices" in tags or "usb" in title:
            return [f"docs/open-files-my-drive-usb-external-devices-review-prep-{date}.md"]
        return [f"docs/open-files-my-drive-small-loose-review-prep-{date}.md"]
    return []


def drive_task(todo: dict[str, Any]) -> bool:
    tags = set(safe_tags(todo.get("tags")))
    if tags & MEDIA_TAGS:
        return False
    return todo.get("requires_approval") is True and bool(tags & DRIVE_APPROVAL_TAGS)


def queue_entry(todo: dict[str, Any], available_docs: set[str]) -> dict[str, Any]:
    tags = set(safe_tags(todo.get("tags")))
    title = sanitize_text(todo.get("title"))
    hints = count_hints(str(todo.get("description") or ""))
    entry: dict[str, Any] = {
        "task_id_short": sanitize_text(str(todo.get("id") or "")[:8], max_len=16),
        "task_id_sha256": text_sha256(str(todo.get("id") or "")),
        "title": title,
        "title_sha256": text_sha256(title),
        "priority": sanitize_text(todo.get("priority"), max_len=32),
        "requires_approval": todo.get("requires_approval") is True,
        "tags": sorted(tags),
        "root_type": root_type(tags),
        "business_area": business_area(tags),
        "approval_type": approval_type(tags),
        "count_hints": hints,
        "primary_row_hint": primary_row_hint(hints),
    }
    expected_docs = expected_source_doc_paths(entry)
    entry["expected_source_docs"] = [
        {"path": path, "present": path in available_docs}
        for path in expected_docs
    ]
    return entry


def counter_dict(values: list[str]) -> dict[str, int]:
    return dict(sorted(Counter(values).items()))


def aggregate_summary(entries: list[dict[str, Any]], docs: list[dict[str, Any]]) -> dict[str, Any]:
    row_hint_total = sum(int(entry.get("primary_row_hint") or 0) for entry in entries)
    missing_expected = sorted({
        str(doc["path"])
        for entry in entries
        for doc in entry.get("expected_source_docs", [])
        if isinstance(doc, dict) and doc.get("present") is not True
    })
    return {
        "ready_drive_approval_tasks": len(entries),
        "tasks_requiring_approval": sum(1 for entry in entries if entry.get("requires_approval") is True),
        "row_hint_total": row_hint_total,
        "tasks_with_row_hints": sum(1 for entry in entries if entry.get("primary_row_hint") is not None),
        "by_root_type": counter_dict([str(entry.get("root_type")) for entry in entries]),
        "by_business_area": counter_dict([str(entry.get("business_area")) for entry in entries]),
        "by_approval_type": counter_dict([str(entry.get("approval_type")) for entry in entries]),
        "by_priority": counter_dict([str(entry.get("priority")) for entry in entries]),
        "source_docs_total": len(docs),
        "source_docs_missing": sum(1 for doc in docs if doc.get("present") is not True),
        "expected_source_docs_missing": missing_expected,
    }


def build_queue(
    *,
    ready_todos: list[dict[str, Any]],
    source_artifacts: list[dict[str, Any]],
    source_docs: list[dict[str, Any]],
) -> dict[str, Any]:
    available_docs = {str(doc.get("path")) for doc in source_docs if doc.get("present") is True}
    entries = [
        queue_entry(todo, available_docs)
        for todo in ready_todos
        if drive_task(todo)
    ]
    entries = sorted(entries, key=lambda item: (str(item["priority"]), str(item["approval_type"]), str(item["root_type"]), str(item["business_area"]), str(item["task_id_short"])))
    summary = aggregate_summary(entries, source_docs)

    artifact: dict[str, Any] = {
        "kind": "open_files_drive_approval_queue",
        "version": 1,
        "created_at": now_utc(),
        "status": "operator_drive_approval_required" if entries and not summary["expected_source_docs_missing"] else "needs_source_doc_prep" if entries else "no_ready_drive_approval_tasks",
        "summary": summary,
        "queue_entries": entries,
        "source_docs": source_docs,
        "source_artifacts": source_artifacts,
        "non_mutation_attestation": {
            "corpus_bytes_mutated": False,
            "s3_objects_mutated": False,
            "metadata_rows_mutated": False,
            "search_index_rows_mutated": False,
            "approvals_granted": False,
            "queue_is_read_only": True,
        },
        "redaction": "aggregate-only Drive approval queue; no private filenames, file IDs, object keys, source refs, extracted text, transcripts, ACL payloads, row payloads, command logs, or secrets",
    }
    marker_counts = scan_text(json.dumps(artifact, sort_keys=True))
    artifact["redaction_check"] = {
        "passed": not marker_counts,
        "sensitive_marker_counts": marker_counts,
        "pattern_count": len(SENSITIVE_PATTERNS),
    }
    if marker_counts:
        artifact["status"] = "error"
    return artifact


def main() -> int:
    parser = argparse.ArgumentParser(description="Build an aggregate Drive/ACL approval queue artifact.")
    parser.add_argument("--ready-todos", help="Optional todos ready --json fixture/input path")
    parser.add_argument("--output", default=DEFAULT_OUTPUT)
    parser.add_argument(
        "--project",
        default=str(Path.cwd()),
        help="Project path to pass to the live todos ready aggregate check.",
    )
    parser.add_argument(
        "--doc-root",
        default=str(Path.cwd()),
        help="Repository root used to discover aggregate approval-prep docs.",
    )
    args = parser.parse_args()

    ready_path = Path(args.ready_todos).expanduser().resolve() if args.ready_todos else None
    doc_root = Path(args.doc_root).expanduser().resolve()
    ready_todos = load_ready_todos(ready_path, args.project)
    source_artifacts = (
        [source_entry("ready_todos_fixture", ready_path)]
        if ready_path is not None
        else [{
            "label": "ready_todos_live_command",
            "present": True,
            "bytes": 0,
            "sha256": None,
            "command": "todos ready --json",
        }]
    )
    source_docs = discover_source_docs(doc_root)
    artifact = build_queue(
        ready_todos=ready_todos,
        source_artifacts=source_artifacts,
        source_docs=source_docs,
    )
    output = Path(args.output).expanduser().resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(artifact, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps({
        "kind": artifact["kind"],
        "status": artifact["status"],
        "summary": artifact["summary"],
        "redaction_check": artifact["redaction_check"],
    }, indent=2, sort_keys=True))
    return 0 if artifact["status"] != "error" else 1


if __name__ == "__main__":
    raise SystemExit(main())
