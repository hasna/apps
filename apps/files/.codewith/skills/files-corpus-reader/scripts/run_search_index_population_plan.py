#!/usr/bin/env python3
"""Run or dry-run an approved search-index population plan.

The runner is dry-run by default. Execution requires both an approved plan and
an explicit --execute flag. Extractor and indexer stdout/stderr are captured to
private job directories; this script prints aggregate-only status.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shlex
import shutil
import subprocess
import sys
import time
from pathlib import Path
from typing import Any


SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))

from validate_search_index_population_plan import load_jsonl, resolve_path, validate_plan  # noqa: E402
from global_execution_preflight import build_global_execution_preflight, plan_approval_token, skipped_results  # noqa: E402


DEFAULT_EXTRACTOR = SCRIPT_DIR / "extract_artifact_for_file.py"
SOURCE_MUTATION_KEYS = {
    "canonical_key",
    "file_name",
    "filename",
    "key",
    "name",
    "object_key",
    "path",
    "private_metadata",
    "raw_key",
    "s3_key",
    "source_ref",
    "target_path",
}


def load_json(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise SystemExit(f"invalid JSON object: {path}")
    return value


def directory_size(path: Path) -> int:
    if not path.exists():
        return 0
    total = 0
    for child in path.rglob("*"):
        if child.is_file():
            total += child.stat().st_size
    return total


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def hash_file_ids(rows_or_ids: list[Any]) -> str:
    ids: list[str] = []
    for item in rows_or_ids:
        if isinstance(item, str):
            ids.append(item)
        elif isinstance(item, dict) and isinstance(item.get("file_id"), str):
            ids.append(item["file_id"])
    digest = hashlib.sha256()
    for file_id in ids:
        digest.update(file_id.encode("utf-8"))
        digest.update(b"\n")
    return digest.hexdigest()


def text_sha256(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def json_sha256(value: Any) -> str:
    return text_sha256(json.dumps(value, sort_keys=True, separators=(",", ":")))


def percentile(values: list[int], pct: float) -> int | None:
    if not values:
        return None
    ordered = sorted(values)
    index = min(len(ordered) - 1, max(0, int(round((pct / 100.0) * (len(ordered) - 1)))))
    return ordered[index]


def command_prefix(value: str) -> list[str]:
    parts = shlex.split(value)
    if not parts:
        raise SystemExit("--files-command produced no command")
    return parts


def child_env(db_path: Path | None) -> dict[str, str]:
    env = os.environ.copy()
    if db_path is not None:
        env["HASNA_FILES_DB_PATH"] = str(db_path)
    return env


def selected_rows(plan: dict[str, Any], plan_root: Path, max_shards: int | None, max_jobs: int | None) -> list[dict[str, Any]]:
    entries = [entry for entry in plan.get("shard_entries", []) if isinstance(entry, dict)]
    if max_shards is not None:
        entries = entries[: max(0, max_shards)]
    rows: list[dict[str, Any]] = []
    for entry in entries:
        shard = resolve_path(entry.get("manifest"), plan_root)
        if shard is None:
            continue
        rows.extend(load_jsonl(shard))
        if max_jobs is not None and len(rows) >= max_jobs:
            rows = rows[:max_jobs]
            break
    return rows


def aggregate_counts(rows: list[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    by_lane: dict[str, dict[str, int]] = {}
    by_strategy: dict[str, dict[str, int]] = {}
    by_kind: dict[str, dict[str, int]] = {}
    by_size_bucket: dict[str, dict[str, int]] = {}
    for row in rows:
        size = int(row.get("size") or 0)
        for table, key in (
            (by_lane, str(row.get("lane") or "unknown")),
            (by_strategy, str(row.get("strategy") or "unknown")),
            (by_kind, str(row.get("recommended_kind") or "unknown")),
            (by_size_bucket, str(row.get("size_bucket") or "unknown")),
        ):
            entry = table.setdefault(key, {"count": 0, "bytes": 0})
            entry["count"] += 1
            entry["bytes"] += size

    def rows_out(table: dict[str, dict[str, int]]) -> list[dict[str, Any]]:
        values = [{"key": key, **value} for key, value in table.items()]
        values.sort(key=lambda item: (-item["count"], -item["bytes"], item["key"]))
        return values

    return {
        "by_lane": rows_out(by_lane),
        "by_strategy": rows_out(by_strategy),
        "by_recommended_kind": rows_out(by_kind),
        "by_size_bucket": rows_out(by_size_bucket),
    }


def safe_row_summary(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "lane": row.get("lane"),
        "strategy": row.get("strategy"),
        "recommended_kind": row.get("recommended_kind"),
        "size": row.get("size"),
        "size_bucket": row.get("size_bucket"),
        "owner": row.get("owner"),
    }


def row_mutation_key_counts(row: dict[str, Any]) -> dict[str, int]:
    source_reference_fields = 0
    private_payload_fields = 0
    metadata_target_fields = 0
    for key in row:
        lowered = str(key).lower()
        if lowered in SOURCE_MUTATION_KEYS:
            source_reference_fields += 1
        if lowered.startswith("private_") or lowered in {"private_metadata"}:
            private_payload_fields += 1
        if lowered in {"canonical_name", "target_path", "labels"}:
            metadata_target_fields += 1
    return {
        "source_reference_fields": source_reference_fields,
        "private_payload_fields": private_payload_fields,
        "metadata_target_fields": metadata_target_fields,
    }


def parse_json_file(path: Path) -> dict[str, Any]:
    if not path.exists() or path.stat().st_size == 0:
        return {}
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {"status": "invalid_stdout_json"}
    return value if isinstance(value, dict) else {"status": "invalid_stdout_json"}


def parse_json_array_file(path: Path) -> list[Any]:
    if not path.exists() or path.stat().st_size == 0:
        return []
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return []
    return value if isinstance(value, list) else []


def scrub_private_keys(value: Any) -> Any:
    if isinstance(value, dict):
        scrubbed: dict[str, Any] = {}
        for key, child in value.items():
            if key in {"file_id", "source_ref", "path", "object_key", "s3_key", "raw_key", "canonical_key"}:
                continue
            scrubbed[key] = scrub_private_keys(child)
        return scrubbed
    if isinstance(value, list):
        return [scrub_private_keys(item) for item in value]
    return value


def flatten_search_text(value: Any, prefix: str = "") -> list[str]:
    lines: list[str] = []
    if isinstance(value, dict):
        for key, child in sorted(value.items()):
            child_prefix = f"{prefix}.{key}" if prefix else key
            lines.extend(flatten_search_text(child, child_prefix))
    elif isinstance(value, list):
        for index, child in enumerate(value[:100]):
            lines.extend(flatten_search_text(child, f"{prefix}.{index}" if prefix else str(index)))
    elif value is not None:
        text = str(value).strip()
        if text:
            lines.append(f"{prefix}: {text}" if prefix else text)
    return lines


def build_search_artifacts(
    row: dict[str, Any],
    extractor_result: dict[str, Any],
    job_dir: Path,
    max_index_chars: int,
) -> tuple[Path | None, Path | None, str | None]:
    review_path_raw = extractor_result.get("review_artifact")
    if not isinstance(review_path_raw, str) or not review_path_raw:
        return None, None, "missing_review_artifact"
    review_path = Path(review_path_raw)
    if not review_path.exists():
        return None, None, "review_artifact_not_found"
    review_json = parse_json_file(review_path)
    safe_review = scrub_private_keys(review_json)
    searchable_payload = {
        "lane": row.get("lane"),
        "semantic_lane": row.get("semantic_lane"),
        "mime": row.get("mime"),
        "owner": row.get("owner"),
        "strategy": row.get("strategy"),
        "recommended_kind": row.get("recommended_kind"),
        "extractor": extractor_result.get("extractor"),
        "extractor_status": extractor_result.get("status"),
        "artifact_ready": extractor_result.get("artifact_ready"),
        "content_ready": extractor_result.get("content_ready"),
        "review": safe_review.get("review") if isinstance(safe_review, dict) else safe_review,
    }
    text = "\n".join(flatten_search_text(searchable_payload))
    if not text.strip():
        return None, None, "empty_search_text"
    truncated = len(text) > max_index_chars
    text_path = job_dir / "search-index-text.txt"
    text_path.write_text(text[:max_index_chars], encoding="utf-8")
    metadata = {
        "lane": row.get("lane"),
        "semantic_lane": row.get("semantic_lane"),
        "strategy": row.get("strategy"),
        "coverage_status": row.get("coverage_status"),
        "recommended_kind": row.get("recommended_kind"),
        "extractor": extractor_result.get("extractor"),
        "extractor_status": extractor_result.get("status"),
        "artifact_ready": bool(extractor_result.get("artifact_ready")),
        "content_ready": bool(extractor_result.get("content_ready")),
        "review_artifact_sha256": file_sha256(review_path),
        "index_text_sha256": file_sha256(text_path),
        "index_text_truncated": truncated,
        "redaction": "metadata omits filenames, paths, object keys, source refs, file IDs, and raw extracted text",
    }
    metadata_path = job_dir / "search-index-metadata.json"
    metadata_path.write_text(json.dumps(metadata, indent=2, sort_keys=True), encoding="utf-8")
    return text_path, metadata_path, None


def artifact_hashes(paths: dict[str, Path | None], job_dir: Path) -> list[dict[str, Any]]:
    entries: list[dict[str, Any]] = []
    for label, path in sorted(paths.items()):
        if path is None or not path.exists() or not path.is_file():
            continue
        try:
            relative = str(path.relative_to(job_dir))
        except ValueError:
            relative = path.name
        entries.append({
            "label": label,
            "relative_path": relative,
            "bytes": path.stat().st_size,
            "sha256": file_sha256(path),
        })
    return entries


def write_job_runtime_attestation(
    index: int,
    row: dict[str, Any],
    result: dict[str, Any],
    job_dir: Path,
    extractor_cmd: list[str] | None,
    indexer_cmd: list[str] | None,
    artifact_paths: dict[str, Path | None],
) -> Path:
    mutation_key_counts = row_mutation_key_counts(row)
    indexed = result.get("status") == "indexed"
    policy_status = "ok" if (
        mutation_key_counts["source_reference_fields"] == 0
        and mutation_key_counts["private_payload_fields"] == 0
        and mutation_key_counts["metadata_target_fields"] == 0
        and result.get("downloads_cleanup") == "removed"
    ) else "requires_review"
    attestation = {
        "kind": "open_files_job_runtime_attestation",
        "version": 1,
        "job_ref": f"job-{index:06d}",
        "status": policy_status,
        "source_identity_sha256": hash_file_ids([row]),
        "source_identity_disclosure": "hash-only",
        "source": {
            "lane": row.get("lane"),
            "semantic_lane": row.get("semantic_lane"),
            "strategy": row.get("strategy"),
            "recommended_kind": row.get("recommended_kind"),
            "size": row.get("size"),
            "size_bucket": row.get("size_bucket"),
            "mime": row.get("mime"),
        },
        "row_safety_counts": mutation_key_counts,
        "canonical_bytes_policy": {
            "canonical_s3_keys_immutable": True,
            "source_bytes_read_only": True,
            "s3_object_key_rename_allowed": False,
            "s3_put_copy_delete_allowed": False,
            "s3_mutation_attempted_by_runner": False,
            "raw_download_cleanup": result.get("downloads_cleanup"),
        },
        "write_policy": {
            "metadata_only": True,
            "allowed_durable_write_surface": "files search-index add",
            "search_index_write_attempted": bool(indexer_cmd),
            "search_index_write_succeeded": indexed,
            "organization_metadata_write_attempted": False,
            "source_byte_write_attempted": False,
            "private_artifact_write_scope": "job-dir-only",
        },
        "command_hashes": {
            "extractor_command_sha256": json_sha256(extractor_cmd) if extractor_cmd else None,
            "indexer_command_sha256": json_sha256(indexer_cmd) if indexer_cmd else None,
        },
        "artifact_hashes": artifact_hashes(artifact_paths, job_dir),
        "result": {
            "status": result.get("status"),
            "extractor_status": result.get("extractor_status"),
            "artifact_ready": result.get("artifact_ready"),
            "content_ready": result.get("content_ready"),
            "search_document_status": result.get("search_document_status"),
            "searchable_chars": result.get("searchable_chars"),
        },
        "redaction": "per-job attestation contains hashes, counts, lane/status metadata, and policy booleans only; no file IDs, filenames, object keys, source refs, extracted text, transcripts, row payloads, or secrets",
    }
    path = job_dir / "runtime-attestation.json"
    path.write_text(json.dumps(attestation, indent=2, sort_keys=True), encoding="utf-8")
    return path


def query_from_search_text(path: Path, max_terms: int = 3) -> str | None:
    if not path.exists():
        return None
    text = path.read_text(encoding="utf-8", errors="replace")
    tokens = [
        token.lower()
        for token in re.findall(r"[A-Za-z0-9][A-Za-z0-9_-]{2,}", text)
        if token.lower() not in {
            "lane",
            "mime",
            "owner",
            "review",
            "status",
            "strategy",
            "extractor",
            "artifact",
            "content",
            "ready",
            "true",
            "false",
        }
    ]
    unique: list[str] = []
    for token in tokens:
        if token not in unique:
            unique.append(token)
        if len(unique) >= max_terms:
            break
    if not unique:
        return None
    return " ".join(unique)


def search_probe_attestation(
    results: list[dict[str, Any]],
    output_dir: Path,
    files_command: list[str],
    db_path: Path | None,
    timeout_seconds: int,
    max_probes: int,
    latency_budget_ms: int,
) -> dict[str, Any]:
    indexed_results = [result for result in results if result.get("status") == "indexed"]
    if not indexed_results:
        return {
            "status": "not_applicable",
            "reason": "no_indexed_results",
            "probes": 0,
            "redaction": "search probe has no private query evidence because no indexed results were produced",
        }

    probe_dir = output_dir / "search-probes"
    probe_dir.mkdir(parents=True, exist_ok=True)
    probe_rows: list[dict[str, Any]] = []
    for index, result in enumerate(indexed_results[:max_probes], start=1):
        file_id = result.get("file_id")
        job_dir_raw = result.get("private_job_dir")
        job_dir = Path(job_dir_raw) if isinstance(job_dir_raw, str) else None
        text_path = job_dir / "search-index-text.txt" if job_dir else None
        query = query_from_search_text(text_path) if text_path else None
        stdout_path = probe_dir / f"probe-{index:06d}.stdout.json"
        stderr_path = probe_dir / f"probe-{index:06d}.stderr.log"
        row: dict[str, Any] = {
            "probe_ref": f"probe-{index:06d}",
            "expected_file_id": file_id,
            "query": query,
            "query_sha256": text_sha256(query or ""),
            "stdout": str(stdout_path),
            "stderr": str(stderr_path),
        }
        if not isinstance(file_id, str) or not file_id or not query:
            row.update({"status": "skipped", "reason": "missing_file_id_or_query", "duration_ms": 0})
            probe_rows.append(row)
            continue

        cmd = [
            *files_command,
            "search",
            query,
            "--scope",
            "content",
            "--limit",
            "20",
            "--json",
        ]
        started = time.monotonic()
        try:
            with stdout_path.open("w", encoding="utf-8") as stdout_handle, stderr_path.open("w", encoding="utf-8") as stderr_handle:
                proc = subprocess.run(
                    cmd,
                    check=False,
                    stdout=stdout_handle,
                    stderr=stderr_handle,
                    text=True,
                    env=child_env(db_path),
                    timeout=timeout_seconds,
                )
            duration_ms = int((time.monotonic() - started) * 1000)
            search_results = parse_json_array_file(stdout_path)
            matched_expected = any(isinstance(item, dict) and item.get("id") == file_id for item in search_results)
            row.update({
                "status": "ok" if proc.returncode == 0 and matched_expected and duration_ms <= latency_budget_ms else "failed",
                "returncode": proc.returncode,
                "duration_ms": duration_ms,
                "latency_budget_ms": latency_budget_ms,
                "matched_expected_file": matched_expected,
                "result_count": len(search_results),
                "command_sha256": json_sha256(cmd),
                "stdout_sha256": file_sha256(stdout_path),
                "stderr_sha256": file_sha256(stderr_path),
                "stdout_bytes": stdout_path.stat().st_size if stdout_path.exists() else 0,
                "stderr_bytes": stderr_path.stat().st_size if stderr_path.exists() else 0,
            })
        except subprocess.TimeoutExpired:
            duration_ms = int((time.monotonic() - started) * 1000)
            row.update({
                "status": "failed",
                "reason": "search_timeout",
                "returncode": None,
                "duration_ms": duration_ms,
                "latency_budget_ms": latency_budget_ms,
                "matched_expected_file": False,
                "result_count": 0,
                "command_sha256": json_sha256(cmd),
            })
        probe_rows.append(row)

    private_results = probe_dir / "search-probe-results.json"
    private_results.write_text(json.dumps(probe_rows, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    durations = [int(row.get("duration_ms") or 0) for row in probe_rows if row.get("status") != "skipped"]
    matched = sum(1 for row in probe_rows if row.get("matched_expected_file") is True)
    failed = sum(1 for row in probe_rows if row.get("status") == "failed")
    skipped = sum(1 for row in probe_rows if row.get("status") == "skipped")
    ok = bool(probe_rows) and failed == 0 and skipped == 0 and matched == len(probe_rows)
    return {
        "status": "ok" if ok else "requires_review",
        "probes": len(probe_rows),
        "matched_expected_file_probes": matched,
        "failed_probes": failed,
        "skipped_probes": skipped,
        "latency_budget_ms": latency_budget_ms,
        "max_latency_ms": max(durations) if durations else None,
        "p95_latency_ms": percentile(durations, 95),
        "private_probe_results_sha256": file_sha256(private_results),
        "private_probe_results": str(private_results),
        "query_disclosure": "sha256-only in public summary; private query strings stay in private probe artifact",
        "redaction": "aggregate search probe summary contains counts, hashes, and latency stats only; no file IDs, queries, filenames, object keys, source refs, extracted text, transcripts, row payloads, or secrets",
    }


def initial_search_probe_attestation() -> dict[str, Any]:
    return {
        "status": "not_executed",
        "probes": 0,
        "redaction": "search probe is populated only after approved search-index execution",
    }


def run_job(
    index: int,
    row: dict[str, Any],
    output_dir: Path,
    extractor_script: Path,
    files_command: list[str],
    db_path: Path | None,
    timeout_seconds: int,
    max_download_bytes: int,
    max_index_chars: int,
    cleanup_downloads: bool,
) -> dict[str, Any]:
    started = time.monotonic()
    job_dir = output_dir / "jobs" / f"job-{index:06d}"
    job_dir.mkdir(parents=True, exist_ok=True)
    private_input = job_dir / "private-input.json"
    extractor_stdout = job_dir / "extractor.stdout.json"
    extractor_stderr = job_dir / "extractor.stderr.log"
    indexer_stdout = job_dir / "indexer.stdout.json"
    indexer_stderr = job_dir / "indexer.stderr.log"
    private_input.write_text(json.dumps(row, indent=2, sort_keys=True), encoding="utf-8")

    file_id = row.get("file_id")
    if not isinstance(file_id, str) or not file_id:
        return {**safe_row_summary(row), "status": "failed", "reason": "missing_file_id", "duration_seconds": 0.0}

    indexer_cmd: list[str] | None = None
    text_path: Path | None = None
    metadata_path: Path | None = None
    extractor_timed_out = False
    extractor_cmd = [
        "python3",
        str(extractor_script),
        file_id,
        "--artifact-dir",
        str(job_dir),
        "--max-download-bytes",
        str(max_download_bytes),
        "--timeout-seconds",
        str(timeout_seconds),
        "--files-command",
        " ".join(shlex.quote(part) for part in files_command),
    ]
    if db_path is not None:
        extractor_cmd.extend(["--db", str(db_path)])

    try:
        with extractor_stdout.open("w", encoding="utf-8") as stdout_handle, extractor_stderr.open("w", encoding="utf-8") as stderr_handle:
            extractor_proc = subprocess.run(
                extractor_cmd,
                check=False,
                stdout=stdout_handle,
                stderr=stderr_handle,
                text=True,
                env=child_env(db_path),
                timeout=timeout_seconds + 30,
            )
    except subprocess.TimeoutExpired:
        extractor_timed_out = True
        result = {
            **safe_row_summary(row),
            "file_id": file_id,
            "status": "failed",
            "returncode": None,
            "reason": "extractor_timeout",
            "logs": {"extractor_stdout": str(extractor_stdout), "extractor_stderr": str(extractor_stderr)},
            "private_job_dir": str(job_dir),
            "duration_seconds": round(time.monotonic() - started, 3),
        }

    if not extractor_timed_out:
        extractor_result = parse_json_file(extractor_stdout)
        extractor_status = extractor_result.get("status") if isinstance(extractor_result.get("status"), str) else "unknown"
        if extractor_proc.returncode != 0:
            result = {
                **safe_row_summary(row),
                "file_id": file_id,
                "status": "extract_failed",
                "extractor_status": extractor_status,
                "returncode": extractor_proc.returncode,
                "logs": {"extractor_stdout": str(extractor_stdout), "extractor_stderr": str(extractor_stderr)},
                "private_job_dir": str(job_dir),
                "duration_seconds": round(time.monotonic() - started, 3),
            }
        else:
            text_path, metadata_path, build_error = build_search_artifacts(row, extractor_result, job_dir, max_index_chars)
            if build_error or text_path is None or metadata_path is None:
                result = {
                    **safe_row_summary(row),
                    "file_id": file_id,
                    "status": "not_indexed",
                    "reason": build_error,
                    "extractor_status": extractor_status,
                    "artifact_ready": extractor_result.get("artifact_ready"),
                    "content_ready": extractor_result.get("content_ready"),
                    "logs": {"extractor_stdout": str(extractor_stdout), "extractor_stderr": str(extractor_stderr)},
                    "private_job_dir": str(job_dir),
                    "duration_seconds": round(time.monotonic() - started, 3),
                }
            else:
                indexer_cmd = [
                    *files_command,
                    "search-index",
                    "add",
                    file_id,
                    "--kind",
                    str(row.get("recommended_kind") or "semantic_metadata"),
                    "--extractor",
                    str(extractor_result.get("extractor") or "search-index-population-runner"),
                    "--text-file",
                    str(text_path),
                    "--metadata-file",
                    str(metadata_path),
                    "--max-chars",
                    str(max_index_chars),
                    "--json",
                ]
                try:
                    with indexer_stdout.open("w", encoding="utf-8") as stdout_handle, indexer_stderr.open("w", encoding="utf-8") as stderr_handle:
                        indexer_proc = subprocess.run(
                            indexer_cmd,
                            check=False,
                            stdout=stdout_handle,
                            stderr=stderr_handle,
                            text=True,
                            env=child_env(db_path),
                            timeout=timeout_seconds + 30,
                        )
                    indexer_result = parse_json_file(indexer_stdout)
                    result = {
                        **safe_row_summary(row),
                        "file_id": file_id,
                        "status": "indexed" if indexer_proc.returncode == 0 else "index_failed",
                        "extractor_status": extractor_status,
                        "artifact_ready": extractor_result.get("artifact_ready"),
                        "content_ready": extractor_result.get("content_ready"),
                        "indexer_returncode": indexer_proc.returncode,
                        "search_document_status": indexer_result.get("status"),
                        "searchable_chars": indexer_result.get("searchable_chars"),
                        "logs": {
                            "extractor_stdout": str(extractor_stdout),
                            "extractor_stderr": str(extractor_stderr),
                            "indexer_stdout": str(indexer_stdout),
                            "indexer_stderr": str(indexer_stderr),
                        },
                        "private_job_dir": str(job_dir),
                        "duration_seconds": round(time.monotonic() - started, 3),
                    }
                except subprocess.TimeoutExpired:
                    result = {
                        **safe_row_summary(row),
                        "file_id": file_id,
                        "status": "index_failed",
                        "reason": "indexer_timeout",
                        "extractor_status": extractor_status,
                        "logs": {
                            "extractor_stdout": str(extractor_stdout),
                            "extractor_stderr": str(extractor_stderr),
                            "indexer_stdout": str(indexer_stdout),
                            "indexer_stderr": str(indexer_stderr),
                        },
                        "private_job_dir": str(job_dir),
                        "duration_seconds": round(time.monotonic() - started, 3),
                    }

    if cleanup_downloads:
        downloads = job_dir / "downloads"
        if downloads.exists():
            shutil.rmtree(downloads)
            result["downloads_cleanup"] = "removed"
        else:
            result["downloads_cleanup"] = "none"
    else:
        result["downloads_cleanup"] = "kept"
    result["artifact_bytes"] = directory_size(job_dir)
    attestation_path = write_job_runtime_attestation(
        index,
        row,
        result,
        job_dir,
        extractor_cmd,
        indexer_cmd,
        {
            "private_input": private_input,
            "extractor_stdout": extractor_stdout,
            "extractor_stderr": extractor_stderr,
            "indexer_stdout": indexer_stdout,
            "indexer_stderr": indexer_stderr,
            "search_index_text": text_path,
            "search_index_metadata": metadata_path,
        },
    )
    result["runtime_attestation"] = str(attestation_path)
    try:
        attestation = load_json(attestation_path)
        result["runtime_attestation_status"] = attestation.get("status")
        result["immutable_bytes_attested"] = (attestation.get("canonical_bytes_policy") or {}).get("canonical_s3_keys_immutable") is True
        result["metadata_only_attested"] = (attestation.get("write_policy") or {}).get("metadata_only") is True
    except (OSError, json.JSONDecodeError):
        result["runtime_attestation_status"] = "invalid"
        result["immutable_bytes_attested"] = False
        result["metadata_only_attested"] = False
    return result


def write_jsonl(path: Path, rows: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, sort_keys=True) + "\n")


def status_counts(results: list[dict[str, Any]]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for result in results:
        status = str(result.get("status") or "unknown")
        counts[status] = counts.get(status, 0) + 1
    return dict(sorted(counts.items()))


def runtime_attestation_summary(results: list[dict[str, Any]]) -> dict[str, Any]:
    statuses: dict[str, int] = {}
    attestation_file_hashes: list[str] = []
    immutable_count = 0
    metadata_only_count = 0
    search_write_attempted = 0
    search_write_succeeded = 0
    source_write_attempted = 0
    s3_mutation_attempted = 0
    missing = 0
    invalid = 0
    for result in results:
        path_value = result.get("runtime_attestation")
        if not isinstance(path_value, str) or not path_value:
            missing += 1
            continue
        path = Path(path_value)
        if not path.exists():
            missing += 1
            continue
        try:
            attestation = load_json(path)
        except (OSError, json.JSONDecodeError, SystemExit):
            invalid += 1
            continue
        status = str(attestation.get("status") or "unknown")
        statuses[status] = statuses.get(status, 0) + 1
        attestation_file_hashes.append(file_sha256(path))
        canonical_policy = attestation.get("canonical_bytes_policy") if isinstance(attestation.get("canonical_bytes_policy"), dict) else {}
        write_policy = attestation.get("write_policy") if isinstance(attestation.get("write_policy"), dict) else {}
        if canonical_policy.get("canonical_s3_keys_immutable") is True and canonical_policy.get("source_bytes_read_only") is True:
            immutable_count += 1
        if write_policy.get("metadata_only") is True:
            metadata_only_count += 1
        if write_policy.get("search_index_write_attempted") is True:
            search_write_attempted += 1
        if write_policy.get("search_index_write_succeeded") is True:
            search_write_succeeded += 1
        if write_policy.get("source_byte_write_attempted") is True:
            source_write_attempted += 1
        if canonical_policy.get("s3_mutation_attempted_by_runner") is True:
            s3_mutation_attempted += 1
    digest = hashlib.sha256()
    for value in sorted(attestation_file_hashes):
        digest.update(value.encode("utf-8"))
        digest.update(b"\n")
    ok = (
        results
        and missing == 0
        and invalid == 0
        and statuses.get("requires_review", 0) == 0
        and statuses.get("ok", 0) == len(results)
        and immutable_count == len(results)
        and metadata_only_count == len(results)
        and source_write_attempted == 0
        and s3_mutation_attempted == 0
    )
    return {
        "status": "ok" if ok else "not_applicable" if not results else "requires_review",
        "jobs": len(results),
        "attested_jobs": sum(statuses.values()),
        "missing_attestations": missing,
        "invalid_attestations": invalid,
        "statuses": dict(sorted(statuses.items())),
        "immutable_bytes_attested_jobs": immutable_count,
        "metadata_only_attested_jobs": metadata_only_count,
        "search_index_write_attempted_jobs": search_write_attempted,
        "search_index_write_succeeded_jobs": search_write_succeeded,
        "source_byte_write_attempted_jobs": source_write_attempted,
        "s3_mutation_attempted_jobs": s3_mutation_attempted,
        "attestation_files_sha256": digest.hexdigest() if attestation_file_hashes else None,
        "redaction": "aggregate attestation contains counts and hashes only; no file IDs, filenames, object keys, source refs, extracted text, transcripts, row payloads, job paths, or secrets",
    }


def scale_readiness_attestation(
    plan: dict[str, Any],
    selected_jobs: int,
    completed_jobs: int,
    summary_status: str,
    runtime_attestation: dict[str, Any],
    search_probe: dict[str, Any] | None = None,
) -> dict[str, Any]:
    planned_jobs = int(plan.get("jobs_planned") or 0)
    canary_scope = selected_jobs > 0 and (planned_jobs == 0 or selected_jobs < planned_jobs)
    full_scope = planned_jobs > 0 and selected_jobs >= planned_jobs
    runtime_ok = runtime_attestation.get("status") == "ok"
    search_probe_ok = isinstance(search_probe, dict) and search_probe.get("status") == "ok"
    canary_verified = summary_status == "completed" and completed_jobs > 0 and runtime_ok and search_probe_ok
    full_verified = summary_status == "completed" and planned_jobs > 0 and completed_jobs >= planned_jobs and runtime_ok and search_probe_ok
    return {
        "status": "full_run_verified" if full_verified else "canary_verified" if canary_verified else "pending_canary" if canary_scope else "blocked",
        "selected_jobs": selected_jobs,
        "completed_jobs": completed_jobs,
        "planned_jobs": planned_jobs,
        "search_probe_status": search_probe.get("status") if isinstance(search_probe, dict) else None,
        "canary": {
            "scope": "canary" if canary_scope else "full-run-candidate" if full_scope else "none",
            "verified": canary_verified,
            "requires_operator_approval": True,
            "runtime_attestation_status": runtime_attestation.get("status"),
            "requires_search_probe_ok": True,
        },
        "full_run": {
            "verified": full_verified,
            "requires_canary_verified_first": True,
            "requires_all_planned_jobs_completed": True,
            "requires_runtime_attestation_ok": True,
            "requires_search_probe_ok": True,
            "remaining_jobs": max(0, planned_jobs - completed_jobs),
        },
        "redaction": "scale readiness attestation contains counts and booleans only; no file IDs, filenames, object keys, source refs, extracted text, transcripts, row payloads, or secrets",
    }


def approval_attestation(
    plan_path: Path,
    plan: dict[str, Any],
    validation: dict[str, Any],
    execute_requested: bool,
    rows: list[dict[str, Any]],
    selected_bytes: int,
    decision: str,
) -> dict[str, Any]:
    approved = bool(plan.get("approved"))
    validation_ok = validation.get("status") == "ok"
    if not execute_requested:
        status = "not_requested"
    elif not validation_ok:
        status = "validation_failed"
    elif not approved:
        status = "blocked"
    else:
        status = "verified"
    plan_approval = plan.get("approval_attestation") if isinstance(plan.get("approval_attestation"), dict) else {}
    return {
        "status": status,
        "decision": decision,
        "runtime_enforced": bool(execute_requested),
        "execute_requested": bool(execute_requested),
        "plan_approved": approved,
        "approval_note_present": bool(plan.get("approval_note")) or plan_approval.get("approval_note_present") is True,
        "approval_note_sha256": plan_approval.get("approval_note_sha256"),
        "validation_status": validation.get("status"),
        "plan_sha256": file_sha256(plan_path),
        "jobs_selected": len(rows),
        "selected_private_ids_sha256": hash_file_ids(rows),
        "bytes_selected": selected_bytes,
        "rule": "Runner refuses execution unless validation is ok, plan.approved is true, and --execute was explicitly requested.",
        "redaction": "attestation omits file IDs, filenames, paths, object keys, source refs, extracted text, transcripts, row payloads, and logs",
    }


def write_summary(summary: dict[str, Any], summary_output: str | None, default_path: Path | None = None) -> None:
    if not summary_output and default_path is None:
        return
    path = Path(summary_output).expanduser().resolve() if summary_output else default_path
    assert path is not None
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(summary, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description="Run or dry-run a search-index population plan.")
    parser.add_argument("--plan", required=True, help="Path to search-index-population-plan.json")
    parser.add_argument("--output-dir", help="Private run output directory")
    parser.add_argument("--execute", action="store_true", help="Actually run approved extraction/index jobs")
    parser.add_argument("--max-shards", type=int, help="Maximum private shards to select")
    parser.add_argument("--max-jobs", type=int, help="Maximum jobs to select")
    parser.add_argument("--max-planned-bytes", type=int, default=100 * 1024 * 1024, help="Execution fails if selected source bytes exceed this cap")
    parser.add_argument("--execution-scope", choices=["canary", "scale"], default="canary", help="Execution scope used by the global readiness preflight")
    parser.add_argument("--max-canary-jobs", type=int, default=10, help="Maximum jobs allowed when --execution-scope=canary")
    parser.add_argument("--max-canary-bytes", type=int, default=100 * 1024 * 1024, help="Maximum source bytes allowed when --execution-scope=canary")
    parser.add_argument("--extraction-readiness-gate", help="Optional extraction-lane-readiness-gate.json path for global execution preflight")
    parser.add_argument("--max-download-bytes", type=int, default=100 * 1024 * 1024, help="Per-file download cap passed to extractor")
    parser.add_argument("--max-artifact-bytes", type=int, default=1024 * 1024 * 1024, help="Stop if private artifact directory exceeds this size")
    parser.add_argument("--max-index-chars", type=int, default=200_000, help="Maximum characters written to each derived search document")
    parser.add_argument("--search-probe-limit", type=int, default=5, help="Maximum indexed results to probe through files search after execution")
    parser.add_argument("--search-probe-latency-budget-ms", type=int, default=1000, help="Maximum allowed latency per files search probe")
    parser.add_argument("--timeout-seconds", type=int, default=300)
    parser.add_argument("--extractor-script", default=str(DEFAULT_EXTRACTOR), help="Extractor script path")
    parser.add_argument("--files-command", default="files", help="files CLI command/path; supports quoted multi-argument commands such as 'bun run src/cli/index.tsx'")
    parser.add_argument("--keep-downloads", action="store_true", help="Keep downloaded source files in private job dirs")
    parser.add_argument("--summary-output", help="Optional redacted run summary output")
    args = parser.parse_args()

    if args.max_shards is not None and args.max_shards < 0:
        raise SystemExit("--max-shards cannot be negative")
    if args.max_jobs is not None and args.max_jobs < 0:
        raise SystemExit("--max-jobs cannot be negative")
    if args.max_planned_bytes < 0 or args.max_download_bytes < 0 or args.max_artifact_bytes < 0:
        raise SystemExit("byte caps cannot be negative")
    if args.max_canary_jobs < 0 or args.max_canary_bytes < 0:
        raise SystemExit("canary caps cannot be negative")
    if args.max_index_chars <= 0:
        raise SystemExit("--max-index-chars must be positive")
    if args.search_probe_limit <= 0:
        raise SystemExit("--search-probe-limit must be positive")
    if args.search_probe_latency_budget_ms <= 0:
        raise SystemExit("--search-probe-latency-budget-ms must be positive")
    if args.timeout_seconds <= 0:
        raise SystemExit("--timeout-seconds must be positive")

    plan_path = Path(args.plan).expanduser().resolve()
    plan_root = plan_path.parent
    validation = validate_plan(plan_path)
    plan = load_json(plan_path)
    rows = selected_rows(plan, plan_root, args.max_shards, args.max_jobs)
    selected_bytes = sum(int(row.get("size") or 0) for row in rows)
    output_dir = Path(args.output_dir).expanduser().resolve() if args.output_dir else plan_root / "search-index-run"
    extractor_script = Path(args.extractor_script).expanduser().resolve()
    db_path = Path(plan["db"]).expanduser().resolve() if isinstance(plan.get("db"), str) else None
    files_command = command_prefix(args.files_command)
    approval_token = plan_approval_token(plan)

    summary: dict[str, Any] = {
        "status": "validation_failed" if validation["status"] != "ok" else "dry_run",
        "plan": str(plan_path),
        "approved": bool(plan.get("approved")),
        "execute_requested": bool(args.execute),
        "jobs_selected": len(rows),
        "selected_private_ids_sha256": hash_file_ids(rows),
        "bytes_selected": selected_bytes,
        "max_planned_bytes": args.max_planned_bytes,
        "max_download_bytes": args.max_download_bytes,
        "max_artifact_bytes": args.max_artifact_bytes,
        "max_index_chars": args.max_index_chars,
        "aggregate": aggregate_counts(rows),
        "validation": {
            "status": validation["status"],
            "errors": validation["errors"],
            "warnings": validation["warnings"],
        },
        "results_status": {},
        "runtime_attestation": {
            "status": "not_executed",
            "jobs": 0,
            "redaction": "runtime attestation is populated only after approved job execution",
        },
        "search_probe_attestation": initial_search_probe_attestation(),
        "global_execution_preflight": build_global_execution_preflight(
            plan_root=plan_root,
            explicit_gate_path=args.extraction_readiness_gate,
            execute_requested=args.execute,
            execution_scope=args.execution_scope,
            selected_jobs=len(rows),
            selected_bytes=selected_bytes,
            max_canary_jobs=args.max_canary_jobs,
            max_canary_bytes=args.max_canary_bytes,
            **approval_token,
        ),
        "redaction": "summary omits file IDs, filenames, paths, object keys, source refs, extracted text, transcripts, row payloads, and extractor/indexer stdout/stderr",
    }
    summary["scale_readiness_attestation"] = scale_readiness_attestation(
        plan,
        len(rows),
        0,
        str(summary["status"]),
        summary["runtime_attestation"],
        summary["search_probe_attestation"],
    )
    summary["approval_attestation"] = approval_attestation(
        plan_path,
        plan,
        validation,
        args.execute,
        rows,
        selected_bytes,
        str(summary["status"]),
    )

    if validation["status"] != "ok":
        summary["approval_attestation"] = approval_attestation(plan_path, plan, validation, args.execute, rows, selected_bytes, "validation_failed")
        print(json.dumps(summary, indent=2, sort_keys=True))
        write_summary(summary, args.summary_output)
        return 1

    if not args.execute:
        summary["results_status"] = {"skipped": len(rows)}
        summary["approval_attestation"] = approval_attestation(plan_path, plan, validation, False, rows, selected_bytes, "dry_run")
        print(json.dumps(summary, indent=2, sort_keys=True))
        write_summary(summary, args.summary_output)
        return 0

    if not plan.get("approved"):
        summary["status"] = "approval_required"
        summary["results_status"] = {"skipped": len(rows)}
        summary["approval_attestation"] = approval_attestation(plan_path, plan, validation, True, rows, selected_bytes, "approval_required")
        print(json.dumps(summary, indent=2, sort_keys=True))
        write_summary(summary, args.summary_output)
        return 1

    if summary["global_execution_preflight"]["allowed"] is not True:
        summary["status"] = "global_execution_preflight_blocked"
        summary["results_status"] = skipped_results(len(rows))
        summary["approval_attestation"] = approval_attestation(plan_path, plan, validation, True, rows, selected_bytes, "global_execution_preflight_blocked")
        print(json.dumps(summary, indent=2, sort_keys=True))
        write_summary(summary, args.summary_output)
        return 1

    if selected_bytes > args.max_planned_bytes:
        summary["status"] = "planned_bytes_cap_exceeded"
        summary["results_status"] = {"skipped": len(rows)}
        summary["approval_attestation"] = approval_attestation(plan_path, plan, validation, True, rows, selected_bytes, "planned_bytes_cap_exceeded")
        print(json.dumps(summary, indent=2, sort_keys=True))
        write_summary(summary, args.summary_output)
        return 1

    output_dir.mkdir(parents=True, exist_ok=True)
    results: list[dict[str, Any]] = []
    stopped_reason: str | None = None
    for index, row in enumerate(rows, start=1):
        if directory_size(output_dir) > args.max_artifact_bytes:
            stopped_reason = "artifact_bytes_cap_exceeded"
            break
        result = run_job(
            index,
            row,
            output_dir,
            extractor_script,
            files_command,
            db_path,
            args.timeout_seconds,
            args.max_download_bytes,
            args.max_index_chars,
            cleanup_downloads=not args.keep_downloads,
        )
        results.append(result)
        if directory_size(output_dir) > args.max_artifact_bytes:
            stopped_reason = "artifact_bytes_cap_exceeded"
            break

    results_path = output_dir / "search-index-run-results.jsonl"
    write_jsonl(results_path, results)
    summary["status"] = "stopped" if stopped_reason else "completed"
    summary["stop_reason"] = stopped_reason
    summary["jobs_completed"] = len(results)
    summary["result_private_ids_sha256"] = hash_file_ids(results)
    summary["artifact_bytes"] = directory_size(output_dir)
    summary["results_status"] = status_counts(results)
    summary["results"] = str(results_path)
    summary["runtime_attestation"] = runtime_attestation_summary(results)
    summary["search_probe_attestation"] = search_probe_attestation(
        results,
        output_dir,
        files_command,
        db_path,
        args.timeout_seconds + 30,
        args.search_probe_limit,
        args.search_probe_latency_budget_ms,
    )
    summary["scale_readiness_attestation"] = scale_readiness_attestation(
        plan,
        len(rows),
        len(results),
        str(summary["status"]),
        summary["runtime_attestation"],
        summary["search_probe_attestation"],
    )
    summary["approval_attestation"] = approval_attestation(plan_path, plan, validation, True, rows, selected_bytes, str(summary["status"]))
    print(json.dumps(summary, indent=2, sort_keys=True))
    write_summary(summary, args.summary_output, output_dir / "search-index-run-summary.json")
    return 0 if summary["status"] == "completed" else 1


if __name__ == "__main__":
    raise SystemExit(main())
