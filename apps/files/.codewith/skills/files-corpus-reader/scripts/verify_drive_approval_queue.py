#!/usr/bin/env python3
"""Verify the aggregate Drive/ACL approval queue artifact."""

from __future__ import annotations

import argparse
import importlib.util
import json
import re
import subprocess
import time
from pathlib import Path
from types import ModuleType
from typing import Any


DEFAULT_QUEUE = ".codewith/private-artifacts/drive-approval/drive-approval-queue.json"
DEFAULT_OUTPUT = ".codewith/private-artifacts/drive-approval/drive-approval-queue-verification.json"

SCRIPT_DIR = Path(__file__).resolve().parent
BUILDER_PATH = SCRIPT_DIR / "build_drive_approval_queue.py"

ALLOWED_STATUSES = {
    "operator_drive_approval_required",
    "needs_source_doc_prep",
    "no_ready_drive_approval_tasks",
    "error",
}

EXPECTED_NON_MUTATION = {
    "corpus_bytes_mutated": False,
    "s3_objects_mutated": False,
    "metadata_rows_mutated": False,
    "search_index_rows_mutated": False,
    "approvals_granted": False,
    "queue_is_read_only": True,
}


def now_utc() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def load_builder() -> ModuleType:
    spec = importlib.util.spec_from_file_location("drive_approval_queue_builder", BUILDER_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError("failed_to_load_builder")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def dict_value(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def list_value(value: Any) -> list[Any]:
    return value if isinstance(value, list) else []


def add_error(errors: list[str], code: str, detail: str | None = None) -> None:
    errors.append(f"{code}:{detail}" if detail else code)


def as_int(value: Any) -> int:
    try:
        return int(value or 0)
    except (TypeError, ValueError):
        return 0


def load_ready_todos(path: Path | None, project: str) -> list[dict[str, Any]]:
    if path:
        value = load_json(path)
        if not isinstance(value, list):
            raise SystemExit(f"expected ready todo JSON array: {path}")
        return [item for item in value if isinstance(item, dict)]

    try:
        proc = subprocess.run(
            ["todos", "--project", project, "ready", "--json"],
            check=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
    except (FileNotFoundError, subprocess.CalledProcessError) as exc:
        raise RuntimeError("todos_ready_command_failed") from exc

    value = json.loads(proc.stdout)
    if not isinstance(value, list):
        raise RuntimeError("todos_ready_command_not_array")
    return [item for item in value if isinstance(item, dict)]


def semantic_projection(queue: dict[str, Any]) -> dict[str, Any]:
    return {
        "status": queue.get("status"),
        "summary": queue.get("summary"),
        "queue_entries": queue.get("queue_entries"),
        "source_docs": queue.get("source_docs"),
        "non_mutation_attestation": queue.get("non_mutation_attestation"),
        "redaction_check": queue.get("redaction_check"),
    }


def source_artifacts_by_label(queue: dict[str, Any]) -> dict[str, dict[str, Any]]:
    output: dict[str, dict[str, Any]] = {}
    for item in list_value(queue.get("source_artifacts")):
        if isinstance(item, dict) and isinstance(item.get("label"), str):
            output[item["label"]] = item
    return output


def source_docs_by_path(queue: dict[str, Any]) -> dict[str, dict[str, Any]]:
    output: dict[str, dict[str, Any]] = {}
    for item in list_value(queue.get("source_docs")):
        if isinstance(item, dict) and isinstance(item.get("path"), str):
            output[item["path"]] = item
    return output


def verify_queue(
    queue_path: Path,
    *,
    ready_todos: list[dict[str, Any]] | None = None,
    check_ready_todos: bool = False,
    ready_todos_project: str | None = None,
    check_current_docs: bool = True,
    doc_root: Path | None = None,
) -> dict[str, Any]:
    builder = load_builder()
    errors: list[str] = []
    warnings: list[str] = []
    queue = load_json(queue_path)
    if not isinstance(queue, dict):
        raise SystemExit(f"expected JSON object: {queue_path}")

    if queue.get("kind") != "open_files_drive_approval_queue":
        add_error(errors, "invalid_kind")
    if queue.get("version") != 1:
        add_error(errors, "invalid_version")
    if queue.get("status") not in ALLOWED_STATUSES:
        add_error(errors, "invalid_status")

    marker_counts = builder.scan_text(json.dumps(queue, sort_keys=True))
    if marker_counts:
        add_error(errors, "sensitive_marker_hits")
    redaction_check = dict_value(queue.get("redaction_check"))
    if redaction_check.get("passed") is not True:
        add_error(errors, "redaction_check_not_passed")
    if redaction_check.get("sensitive_marker_counts"):
        add_error(errors, "redaction_check_counts_nonempty")

    non_mutation = dict_value(queue.get("non_mutation_attestation"))
    for key, expected in EXPECTED_NON_MUTATION.items():
        if non_mutation.get(key) is not expected:
            add_error(errors, "non_mutation_mismatch", key)

    entries = [item for item in list_value(queue.get("queue_entries")) if isinstance(item, dict)]
    summary = dict_value(queue.get("summary"))
    if as_int(summary.get("ready_drive_approval_tasks")) != len(entries):
        add_error(errors, "summary_ready_drive_count_inconsistent")
    if as_int(summary.get("tasks_requiring_approval")) != sum(1 for item in entries if item.get("requires_approval") is True):
        add_error(errors, "summary_requires_approval_count_inconsistent")
    if as_int(summary.get("tasks_with_row_hints")) != sum(1 for item in entries if item.get("primary_row_hint") is not None):
        add_error(errors, "summary_row_hint_task_count_inconsistent")

    for index, entry in enumerate(entries):
        label = f"queue_entries[{index}]"
        if entry.get("requires_approval") is not True:
            add_error(errors, "entry_not_approval_gated", label)
        if not isinstance(entry.get("task_id_short"), str) or not entry["task_id_short"]:
            add_error(errors, "entry_missing_task_id_short", label)
        for hash_key in ("task_id_sha256", "title_sha256"):
            if not isinstance(entry.get(hash_key), str) or not re.fullmatch(r"[0-9a-f]{64}", entry[hash_key]):
                add_error(errors, "entry_invalid_hash", f"{label}:{hash_key}")
        if not isinstance(entry.get("tags"), list) or not set(entry.get("tags") or []) & builder.DRIVE_APPROVAL_TAGS:
            add_error(errors, "entry_missing_drive_tags", label)
        for doc in list_value(entry.get("expected_source_docs")):
            if isinstance(doc, dict) and doc.get("present") is not True:
                add_error(errors, "entry_expected_source_doc_missing", str(doc.get("path")))

    source_artifacts = source_artifacts_by_label(queue)
    if not ({"ready_todos_fixture", "ready_todos_live_command"} & set(source_artifacts)):
        add_error(errors, "missing_ready_todos_source")
    for label, item in source_artifacts.items():
        if item.get("present") is not True:
            add_error(errors, "source_artifact_not_present", label)
        if label == "ready_todos_live_command":
            if item.get("command") != "todos ready --json":
                add_error(errors, "ready_todos_live_command_invalid")
        elif label == "ready_todos_fixture":
            if as_int(item.get("bytes")) <= 0:
                add_error(errors, "ready_todos_fixture_empty")
            if not isinstance(item.get("sha256"), str) or not re.fullmatch(r"[0-9a-f]{64}", item["sha256"]):
                add_error(errors, "ready_todos_fixture_sha256_invalid")
        else:
            warnings.append(f"unexpected_source_artifact:{label}")

    doc_root = (doc_root or Path.cwd()).expanduser().resolve()
    recorded_docs = source_docs_by_path(queue)
    current_doc_paths_checked: list[str] = []
    current_doc_mismatched: list[str] = []
    current_doc_missing: list[str] = []
    doc_inventory_mismatched = False
    current_docs: list[dict[str, Any]] = []
    if check_current_docs:
        current_docs = builder.discover_source_docs(doc_root)
        current_by_path = {str(item.get("path")): item for item in current_docs}
        recorded_paths = set(recorded_docs)
        current_paths = set(current_by_path)
        if recorded_paths != current_paths:
            doc_inventory_mismatched = True
            add_error(errors, "source_doc_inventory_mismatch")
        for path, item in sorted(recorded_docs.items()):
            current = current_by_path.get(path)
            if current is None:
                current_doc_missing.append(path)
                add_error(errors, "source_doc_current_missing", path)
                continue
            current_doc_paths_checked.append(path)
            if item.get("bytes") != current.get("bytes") or item.get("sha256") != current.get("sha256"):
                current_doc_mismatched.append(path)
                add_error(errors, "source_doc_current_hash_mismatch", path)
    else:
        current_docs = list(recorded_docs.values())

    ready_todos_current_checked = False
    ready_todos_current_source: str | None = None
    ready_todos_current_summary: dict[str, Any] = {}
    semantic_projection_matches: bool | None = None
    if check_ready_todos:
        ready_todos_current_checked = True
        if ready_todos is None:
            ready_todos_current_source = "live_command"
            try:
                ready_todos = load_ready_todos(None, ready_todos_project or str(Path.cwd()))
            except Exception as exc:  # pragma: no cover - defensive CLI boundary
                add_error(errors, "ready_todos_current_unavailable", f"{type(exc).__name__}:{exc}")
                ready_todos = []
        else:
            ready_todos_current_source = "supplied"
        expected = builder.build_queue(
            ready_todos=ready_todos,
            source_artifacts=[],
            source_docs=current_docs,
        )
        ready_todos_current_summary = dict_value(expected.get("summary"))
        semantic_projection_matches = semantic_projection(queue) == semantic_projection(expected)
        if not semantic_projection_matches:
            add_error(errors, "ready_todos_current_semantic_mismatch")

    status_expected = "operator_drive_approval_required" if entries and not summary.get("expected_source_docs_missing") else "needs_source_doc_prep" if entries else "no_ready_drive_approval_tasks"
    if queue.get("status") != "error" and queue.get("status") != status_expected:
        add_error(errors, "status_inconsistent")

    gates = {
        "kind_ok": queue.get("kind") == "open_files_drive_approval_queue",
        "redaction_ok": not marker_counts and redaction_check.get("passed") is True and not redaction_check.get("sensitive_marker_counts"),
        "non_mutation_attested": not any(error.startswith("non_mutation_mismatch") for error in errors),
        "summary_counts_consistent": not any(error.startswith("summary_") for error in errors),
        "expected_source_docs_present": not any(error.startswith("entry_expected_source_doc_missing") for error in errors),
        "source_doc_current_hashes_ok": (
            check_current_docs
            and not doc_inventory_mismatched
            and not current_doc_mismatched
            and not current_doc_missing
        ) if check_current_docs else None,
        "ready_todos_current_semantics_ok": semantic_projection_matches if check_ready_todos else None,
        "status_consistent": "status_inconsistent" not in errors,
    }

    return {
        "kind": "open_files_drive_approval_queue_verification",
        "version": 1,
        "created_at": now_utc(),
        "status": "ok" if not errors else "error",
        "queue_status": queue.get("status"),
        "expected_queue_status": status_expected,
        "gates": gates,
        "summary": {
            "ready_drive_approval_tasks": summary.get("ready_drive_approval_tasks"),
            "tasks_requiring_approval": summary.get("tasks_requiring_approval"),
            "row_hint_total": summary.get("row_hint_total"),
            "tasks_with_row_hints": summary.get("tasks_with_row_hints"),
            "by_root_type": summary.get("by_root_type"),
            "by_business_area": summary.get("by_business_area"),
            "by_approval_type": summary.get("by_approval_type"),
            "source_docs_total": summary.get("source_docs_total"),
            "expected_source_docs_missing": summary.get("expected_source_docs_missing"),
        },
        "source_docs_current": {
            "checked": check_current_docs,
            "checked_paths": current_doc_paths_checked,
            "mismatched": current_doc_mismatched,
            "missing": current_doc_missing,
            "inventory_mismatched": doc_inventory_mismatched,
        },
        "ready_todos_current": {
            "checked": ready_todos_current_checked,
            "source": ready_todos_current_source,
            "semantic_projection_matches": semantic_projection_matches,
            "current_summary": ready_todos_current_summary,
        },
        "sensitive_marker_counts": marker_counts,
        "errors": errors,
        "warnings": warnings,
        "redaction": "aggregate-only verification; no private filenames, file IDs, object keys, source refs, extracted text, transcripts, ACL payloads, row payloads, command logs, or secrets",
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Verify the aggregate Drive/ACL approval queue artifact.")
    parser.add_argument("--queue", default=DEFAULT_QUEUE)
    parser.add_argument("--output", default=DEFAULT_OUTPUT)
    parser.add_argument("--ready-todos", help="Optional todos ready --json fixture/input path for current-check comparison")
    parser.add_argument(
        "--project",
        default=str(Path.cwd()),
        help="Project path to pass to the live todos ready aggregate check.",
    )
    parser.add_argument(
        "--doc-root",
        default=str(Path.cwd()),
        help="Repository root used to rediscover aggregate approval-prep docs.",
    )
    parser.add_argument(
        "--skip-ready-todos-current-check",
        action="store_true",
        help="Skip recomputing the queue from current todos ready data.",
    )
    parser.add_argument(
        "--skip-current-doc-check",
        action="store_true",
        help="Skip rediscovering approval-prep docs and recomputing their hashes.",
    )
    args = parser.parse_args()

    ready_todos = None
    if args.ready_todos:
        ready_todos = load_ready_todos(Path(args.ready_todos).expanduser().resolve(), args.project)
    result = verify_queue(
        Path(args.queue).expanduser().resolve(),
        ready_todos=ready_todos,
        check_ready_todos=not args.skip_ready_todos_current_check,
        ready_todos_project=args.project,
        check_current_docs=not args.skip_current_doc_check,
        doc_root=Path(args.doc_root).expanduser().resolve(),
    )
    output = Path(args.output).expanduser().resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps({
        "kind": result["kind"],
        "status": result["status"],
        "queue_status": result["queue_status"],
        "expected_queue_status": result["expected_queue_status"],
        "summary": result["summary"],
        "errors": result["errors"],
        "warnings": result["warnings"],
    }, indent=2, sort_keys=True))
    return 0 if result["status"] == "ok" else 1


if __name__ == "__main__":
    raise SystemExit(main())
