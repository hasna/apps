#!/usr/bin/env python3
"""Prepare and optionally execute safe Codewith LLM review batches.

The runner never prints manifest rows or extracted content. It writes private
chunk manifests and worker prompts to an output directory, then either prints a
redacted command plan or runs Codewith exec with bounded settings.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import shlex
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any


DEFAULT_SPARK_MODEL = "gpt-5.3-codex-spark"
DEFAULT_MIMO_MODEL = "xiaomi/mimo-v2.5-pro"
DEFAULT_OPENROUTER_MODEL = "openai/gpt-5.1-codex-mini"
OPENROUTER_SECRET = "hasna/takumi/live/openrouter_api_key"
OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions"
DIRECT_ALLOWED_EGRESS_HOSTS = {"openrouter.ai"}
DIRECT_SENSITIVE_PAYLOAD_KEYS = {
    "acl",
    "canonical_name",
    "checksum",
    "drive_id",
    "extracted_text",
    "file_id",
    "file_name",
    "filename",
    "google_drive_id",
    "key",
    "labels",
    "name",
    "object_key",
    "original_filename",
    "original_name",
    "path",
    "permissions",
    "private_metadata",
    "revision_id",
    "s3_key",
    "sha256",
    "source_ref",
    "target_path",
    "transcript",
}
DIRECT_SENSITIVE_VALUE_MARKERS = (
    "s3://",
    "objects/sha256/",
    "drive.google.com/",
    "docs.google.com/",
)
PRIVATE_FILE_ID_PATTERN = re.compile(r"\bf_[A-Za-z0-9][A-Za-z0-9_-]{5,}\b")


def repo_root() -> Path:
    return Path(__file__).resolve().parents[4]


def load_jsonl(path: Path, limit: int | None) -> list[dict[str, Any]]:
    if limit == 0:
        return []
    rows: list[dict[str, Any]] = []
    with path.open("r", encoding="utf-8") as handle:
        for line_no, line in enumerate(handle, start=1):
            stripped = line.strip()
            if not stripped:
                continue
            try:
                value = json.loads(stripped)
            except json.JSONDecodeError as exc:
                raise SystemExit(f"invalid JSONL at line {line_no}: {exc}") from exc
            if not isinstance(value, dict):
                raise SystemExit(f"invalid JSONL at line {line_no}: row is not an object")
            rows.append(value)
            if limit is not None and len(rows) >= limit:
                break
    return rows


def chunks(rows: list[dict[str, Any]], size: int) -> list[list[dict[str, Any]]]:
    return [rows[index : index + size] for index in range(0, len(rows), size)]


def provider_defaults(provider: str) -> tuple[str, str | None]:
    if provider == "spark":
        return DEFAULT_SPARK_MODEL, "account001"
    if provider == "mimo":
        return DEFAULT_MIMO_MODEL, None
    if provider == "openrouter":
        return DEFAULT_OPENROUTER_MODEL, None
    raise SystemExit(f"unsupported provider: {provider}")


def write_jsonl(path: Path, rows: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, sort_keys=True) + "\n")


def text_sha256(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def json_sha256(value: Any) -> str:
    return text_sha256(json.dumps(value, sort_keys=True, separators=(",", ":")))


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


def write_prompt(path: Path, manifest: Path, proposals: Path, errors: Path, cwd: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        f"""You are an open-files semantic review worker.

Hard rules:
- Do not print private filenames, paths, object keys, source refs, extracted text, transcripts, ACL payloads, or row payloads.
- Do not mention Google Drive, URLs, source refs, object keys, or extracted text in proposal reasons.
- Treat the manifest and extracted artifacts as private local data.
- Preserve canonical S3 bytes; propose metadata only.
- Write proposal rows only to: {proposals}
- Write per-row errors only to: {errors}
- Your final response must match the provided JSON schema and contain aggregate counts only.

Inputs:
- Working directory: {cwd}
- Prepared manifest JSONL: {manifest}

For each job in the manifest:
1. Read the job object.
2. Read only the `review_artifact` JSON path already present in the job object.
3. Do not run extractors. Do not read raw extraction artifacts, downloads, provenance sidecars, source refs, filenames, paths, object keys, or ACL payloads.
4. Use only the bounded/redacted review artifact to classify the file. Do not quote extracted text in stdout or in the proposal reason.
5. Propose one JSON object per job with these fields:
   `file_id`, `canonical_name`, `target_path`, `document_kind`, `confidence`, `requires_review`, and `reason`.
6. Do not write any extra fields.
7. Use lowercase kebab-case filenames and owner-prefixed target paths. The target path basename must equal `canonical_name`.
8. Preserve the expected file extension from the manifest when one exists. This is mandatory. Before writing the proposal, read `job.expected_ext`; if it is not empty, `canonical_name` must end with `.` plus that exact lowercase extension. Example: `expected_ext: "txt"` requires `canonical_name: "some-name.txt"` and `target_path` ending in `/some-name.txt`.
9. Keep `reason` under 300 characters and describe only aggregate evidence such as artifact status, document kind, date signal, or route.
10. If the review artifact reports `content_ready: false`, make confidence `low` and set `requires_review` to true.
11. For this stage, set `requires_review` to true for every proposal.

If a job is missing a readable `review_artifact`, write an error row with `file_id`, `status`, and `reason` to the errors file, without leaking private content.
""",
        encoding="utf-8",
    )


def base_command(
    provider: str,
    model: str,
    auth_profile: str | None,
    reasoning_effort: str | None,
    sandbox: str,
    cwd: Path,
    prompt: Path,
    final_output: Path,
    schema: Path,
    allow_bypass_sandbox: bool,
) -> list[str]:
    cmd = [
        "codewith",
        "exec",
        "--ephemeral",
        "--disable",
        "image_generation",
        "-m",
        model,
        "-C",
        str(cwd),
        "-o",
        str(final_output),
        "--output-schema",
        str(schema),
    ]
    if reasoning_effort:
        cmd.extend(["-c", f'model_reasoning_effort="{reasoning_effort}"'])
    if provider == "spark":
        if auth_profile:
            cmd.extend(["--auth-profile", auth_profile])
    elif provider in {"openrouter", "mimo"}:
        cmd.extend(["--profile", "openrouter"])
    if allow_bypass_sandbox:
        cmd.append("--dangerously-bypass-approvals-and-sandbox")
    else:
        cmd.extend(["--sandbox", sandbox])
    cmd.extend(["-",])
    return cmd


def redacted_command(cmd: list[str]) -> str:
    return " ".join(shlex.quote(part) for part in cmd)


def openrouter_env(base_env: dict[str, str], secret_name: str) -> dict[str, str]:
    key = subprocess.run(
        ["secrets", "get", secret_name],
        check=False,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    if key.returncode != 0 or not key.stdout.strip():
        raise SystemExit("OpenRouter secret lookup failed")
    env = minimal_worker_env(base_env)
    token = key.stdout.strip()
    env["OPENROUTER_API_KEY"] = token
    env["OPENROUTER_AUTH_HEADER"] = f"Bearer {token}"
    return env


def minimal_worker_env(base_env: dict[str, str]) -> dict[str, str]:
    allowlist = {
        "CODEWITH_HOME",
        "HOME",
        "LANG",
        "LC_ALL",
        "LOGNAME",
        "PATH",
        "SHELL",
        "TERM",
        "TMPDIR",
        "USER",
        "XDG_CACHE_HOME",
        "XDG_CONFIG_HOME",
        "XDG_DATA_HOME",
    }
    return {key: value for key, value in base_env.items() if key in allowlist and value}


def line_count(path: Path) -> int:
    if not path.exists():
        return 0
    with path.open("r", encoding="utf-8") as handle:
        return sum(1 for line in handle if line.strip())


def load_output_rows(path: Path) -> tuple[list[dict[str, Any]], list[str]]:
    rows: list[dict[str, Any]] = []
    problems: list[str] = []
    if not path.exists():
        return rows, problems
    with path.open("r", encoding="utf-8") as handle:
        for line_no, line in enumerate(handle, start=1):
            stripped = line.strip()
            if not stripped:
                continue
            try:
                value = json.loads(stripped)
            except json.JSONDecodeError as exc:
                problems.append(f"{path.name}:{line_no}: invalid JSON: {exc}")
                continue
            if not isinstance(value, dict):
                problems.append(f"{path.name}:{line_no}: row is not an object")
                continue
            rows.append(value)
    return rows, problems


def validate_error_rows(error_rows: list[dict[str, Any]], expected_ids: set[str]) -> list[str]:
    problems: list[str] = []
    allowed = {"file_id", "status", "reason"}
    for row in error_rows:
        file_id = row.get("file_id")
        if not isinstance(file_id, str) or not file_id:
            problems.append("error row missing file_id")
        elif file_id not in expected_ids:
            problems.append(f"error row file_id not scheduled: {file_id}")
        unknown = sorted(set(row) - allowed)
        if unknown:
            problems.append(f"error row has unknown fields: {', '.join(unknown)}")
        if not isinstance(row.get("status"), str) or not row.get("status"):
            problems.append(f"error row missing status for {file_id}")
        reason = row.get("reason")
        if not isinstance(reason, str) or not reason:
            problems.append(f"error row missing reason for {file_id}")
        elif len(reason) > 300:
            problems.append(f"error reason too long for {file_id}")
    return problems


class DirectApiError(RuntimeError):
    def __init__(self, message: str, status: int | None = None) -> None:
        super().__init__(message)
        self.status = status


def direct_response_schema() -> dict[str, Any]:
    proposal_schema = {
        "type": "object",
        "additionalProperties": False,
        "required": [
            "job_ref",
            "canonical_name",
            "target_path",
            "document_kind",
            "confidence",
            "requires_review",
            "reason",
        ],
        "properties": {
            "job_ref": {"type": "string"},
            "canonical_name": {"type": "string"},
            "target_path": {"type": "string"},
            "document_kind": {"type": "string"},
            "confidence": {"type": "string", "enum": ["high", "medium", "low"]},
            "requires_review": {"type": "boolean"},
            "reason": {"type": "string", "maxLength": 300},
        },
    }
    error_schema = {
        "type": "object",
        "additionalProperties": False,
        "required": ["job_ref", "status", "reason"],
        "properties": {
            "job_ref": {"type": "string"},
            "status": {"type": "string"},
            "reason": {"type": "string", "maxLength": 300},
        },
    }
    return {
        "type": "object",
        "additionalProperties": False,
        "required": ["status", "jobs_seen", "proposals", "errors"],
        "properties": {
            "status": {"type": "string", "enum": ["done", "partial", "failed"]},
            "jobs_seen": {"type": "integer", "minimum": 0},
            "proposals": {"type": "array", "items": proposal_schema},
            "errors": {"type": "array", "items": error_schema},
        },
    }


def direct_sensitive_key_hits(value: Any) -> int:
    if isinstance(value, dict):
        total = 0
        for key, child in value.items():
            lowered = str(key).lower()
            if lowered in DIRECT_SENSITIVE_PAYLOAD_KEYS or lowered.startswith("private_"):
                total += 1
            total += direct_sensitive_key_hits(child)
        return total
    if isinstance(value, list):
        return sum(direct_sensitive_key_hits(child) for child in value)
    return 0


def direct_sensitive_value_marker_hits(value: Any) -> int:
    if isinstance(value, dict):
        return sum(direct_sensitive_value_marker_hits(child) for child in value.values())
    if isinstance(value, list):
        return sum(direct_sensitive_value_marker_hits(child) for child in value)
    if not isinstance(value, str):
        return 0
    marker_hits = sum(1 for marker in DIRECT_SENSITIVE_VALUE_MARKERS if marker in value)
    id_hits = len(PRIVATE_FILE_ID_PATTERN.findall(value))
    return marker_hits + id_hits


def sanitize_direct_review_value(value: Any) -> Any:
    if isinstance(value, dict):
        sanitized: dict[str, Any] = {}
        for key, child in value.items():
            lowered = str(key).lower()
            if lowered in DIRECT_SENSITIVE_PAYLOAD_KEYS or lowered.startswith("private_"):
                continue
            sanitized[key] = sanitize_direct_review_value(child)
        return sanitized
    if isinstance(value, list):
        return [sanitize_direct_review_value(child) for child in value]
    if isinstance(value, str):
        if any(marker in value for marker in DIRECT_SENSITIVE_VALUE_MARKERS):
            return "[redacted-source-reference]"
        return PRIVATE_FILE_ID_PATTERN.sub("[redacted-private-id]", value)
    return value


def safe_direct_jobs(rows: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    jobs: list[dict[str, Any]] = []
    errors: list[dict[str, Any]] = []
    allowed_manifest_keys = {
        "artifact_ready",
        "artifact_status",
        "content_ready",
        "content_strategy",
        "duplicate_group_id",
        "expected_ext",
        "ext",
        "extractor",
        "extractor_lane",
        "file_id",
        "mime",
        "modified_at",
        "owner",
        "review_status",
        "root_type",
        "route",
        "size",
        "storage_provider",
    }
    for index, row in enumerate(rows, start=1):
        file_id = row.get("file_id")
        if not isinstance(file_id, str) or not file_id:
            errors.append({"file_id": "", "status": "invalid_job", "reason": "job is missing file_id"})
            continue
        review_artifact = row.get("review_artifact")
        if not isinstance(review_artifact, str):
            errors.append({"file_id": file_id, "status": "missing_review_artifact", "reason": "review artifact path missing"})
            continue
        review_path = Path(review_artifact)
        if not review_path.exists():
            errors.append({"file_id": file_id, "status": "missing_review_artifact", "reason": "review artifact file missing"})
            continue
        try:
            review_payload = json.loads(review_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            errors.append({"file_id": file_id, "status": "invalid_review_artifact", "reason": "review artifact is not readable JSON"})
            continue
        sanitized_review_payload = sanitize_direct_review_value(review_payload)
        jobs.append({
            key: row.get(key)
            for key in sorted(allowed_manifest_keys)
            if key in row
        } | {"review_artifact": sanitized_review_payload})
    return jobs, errors


def direct_provider_payload_jobs(jobs: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], dict[str, str]]:
    payload_jobs: list[dict[str, Any]] = []
    ref_to_file_id: dict[str, str] = {}
    for index, job in enumerate(jobs, start=1):
        file_id = job.get("file_id")
        if not isinstance(file_id, str) or not file_id:
            raise DirectApiError("internal direct job missing file_id before provider payload projection")
        job_ref = f"job-{index:06d}"
        ref_to_file_id[job_ref] = file_id
        payload = {
            key: value
            for key, value in job.items()
            if key != "file_id"
        }
        payload["job_ref"] = job_ref
        payload_jobs.append(payload)
    return payload_jobs, ref_to_file_id


def map_direct_response_rows(
    rows: list[dict[str, Any]],
    ref_to_file_id: dict[str, str],
    row_kind: str,
) -> list[dict[str, Any]]:
    mapped: list[dict[str, Any]] = []
    for row in rows:
        job_ref = row.get("job_ref")
        if not isinstance(job_ref, str) or not job_ref:
            raise DirectApiError(f"direct {row_kind} row missing job_ref")
        file_id = ref_to_file_id.get(job_ref)
        if file_id is None:
            raise DirectApiError(f"direct {row_kind} row references unknown job_ref")
        output = {
            key: value
            for key, value in row.items()
            if key not in {"job_ref", "file_id"}
        }
        output["file_id"] = file_id
        mapped.append(output)
    return mapped


def direct_prompt(jobs: list[dict[str, Any]], schema: dict[str, Any]) -> str:
    return (
        "You are an open-files semantic review worker.\n\n"
        "Hard rules:\n"
        "- Do not print or quote private filenames, paths, object keys, source refs, URLs, extracted text, transcripts, ACL payloads, or row payloads.\n"
        "- Treat all input as private local data that was already redacted and bounded by the parent runner.\n"
        "- Preserve canonical S3 bytes; propose metadata only.\n"
        "- Return only JSON matching the response schema. No markdown, no prose.\n\n"
        "For each job:\n"
        "1. Use the owner, MIME, extension, dates, lane/status, and review_artifact to infer a logical canonical metadata name.\n"
        "2. Write exactly one proposal for every readable job, or one error row if the review_artifact cannot support a proposal.\n"
        "3. Proposal fields are exactly: job_ref, canonical_name, target_path, document_kind, confidence, requires_review, reason.\n"
        "4. Use lowercase kebab-case filenames and owner-prefixed target paths. The target path basename must equal canonical_name.\n"
        "5. Preserve expected_ext exactly when present: canonical_name must end with '.' plus expected_ext.\n"
        "6. If content_ready is false, use confidence low and requires_review true.\n"
        "7. For this stage, set requires_review true for every proposal.\n"
        "8. Keep reason under 300 characters and describe only aggregate evidence such as artifact status, document kind, date signal, route, or MIME.\n"
        "9. Do not mention Google Drive, object storage, URLs, source refs, object keys, or extracted text in reason.\n\n"
        "Use only the synthetic job_ref values supplied in Jobs JSON. Do not infer, invent, or return original file IDs.\n\n"
        "Response schema:\n"
        f"{json.dumps(schema, sort_keys=True)}\n\n"
        "Jobs JSON:\n"
        f"{json.dumps(jobs, sort_keys=True)}\n"
    )


def parse_json_object(value: str) -> dict[str, Any]:
    stripped = value.strip()
    if stripped.startswith("```"):
        stripped = re.sub(r"^```(?:json)?\s*", "", stripped, flags=re.IGNORECASE)
        stripped = re.sub(r"\s*```$", "", stripped)
    try:
        parsed = json.loads(stripped)
    except json.JSONDecodeError:
        start = stripped.find("{")
        end = stripped.rfind("}")
        if start == -1 or end == -1 or end <= start:
            raise
        parsed = json.loads(stripped[start : end + 1])
    if not isinstance(parsed, dict):
        raise ValueError("direct response is not a JSON object")
    return parsed


def openrouter_api_key(secret_name: str) -> str:
    key = subprocess.run(
        ["secrets", "get", secret_name],
        check=False,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    if key.returncode != 0 or not key.stdout.strip():
        raise DirectApiError("OpenRouter secret lookup failed")
    return key.stdout.strip()


def openrouter_chat_completion(
    api_key: str,
    model: str,
    prompt: str,
    schema: dict[str, Any],
    timeout: int,
    max_tokens: int,
    temperature: float,
    provider_sort: str | None,
    allow_data_collection: bool,
    strict_schema: bool,
) -> tuple[dict[str, Any], dict[str, Any]]:
    provider: dict[str, Any] = {}
    if provider_sort:
        provider["sort"] = provider_sort
    if not allow_data_collection:
        provider["data_collection"] = "deny"
    if strict_schema:
        provider["require_parameters"] = True

    response_format: dict[str, Any]
    if strict_schema:
        response_format = {
            "type": "json_schema",
            "json_schema": {
                "name": "open_files_semantic_review",
                "strict": True,
                "schema": schema,
            },
        }
    else:
        response_format = {"type": "json_object"}

    payload: dict[str, Any] = {
        "model": model,
        "messages": [
            {
                "role": "system",
                "content": "Return only valid JSON. Follow the requested schema exactly and never quote private source content.",
            },
            {"role": "user", "content": prompt},
        ],
        "temperature": temperature,
        "max_tokens": max_tokens,
        "response_format": response_format,
    }
    if provider:
        payload["provider"] = provider

    request = urllib.request.Request(
        OPENROUTER_API_URL,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "HTTP-Referer": "https://hasna.xyz",
            "X-OpenRouter-Title": "open-files semantic review",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            raw = response.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as exc:
        # Do not include the response body in stdout/errors; some gateways echo request details.
        raise DirectApiError(f"OpenRouter HTTP {exc.code}", status=exc.code) from exc
    except urllib.error.URLError as exc:
        raise DirectApiError(f"OpenRouter request failed: {type(exc.reason).__name__}") from exc

    try:
        envelope = json.loads(raw)
        content = envelope["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError, json.JSONDecodeError) as exc:
        raise DirectApiError("OpenRouter response envelope was not usable JSON") from exc
    if not isinstance(content, str):
        raise DirectApiError("OpenRouter response content was not text")
    try:
        parsed = parse_json_object(content)
    except (ValueError, json.JSONDecodeError) as exc:
        raise DirectApiError("OpenRouter response content was not valid JSON") from exc
    metadata = {
        "id": envelope.get("id"),
        "model": envelope.get("model"),
        "usage": envelope.get("usage") if isinstance(envelope.get("usage"), dict) else None,
    }
    return parsed, metadata


def transient_direct_error(exc: DirectApiError) -> bool:
    if exc.status is None:
        return True
    return exc.status in {408, 409, 425, 429, 500, 502, 503, 504}


def numeric_value(value: Any) -> float | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        try:
            return float(value)
        except ValueError:
            return None
    return None


def add_direct_usage_totals(totals: dict[str, float], audit_output: Path) -> dict[str, float]:
    if not audit_output.exists():
        return totals
    try:
        audit = json.loads(audit_output.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return totals
    usage = audit.get("usage")
    if not isinstance(usage, dict):
        return totals
    for key in ("prompt_tokens", "completion_tokens", "total_tokens", "cost"):
        value = numeric_value(usage.get(key))
        if value is not None:
            totals[key] = totals.get(key, 0.0) + value
    return totals


def empty_usage_totals() -> dict[str, float]:
    return {
        "prompt_tokens": 0.0,
        "completion_tokens": 0.0,
        "total_tokens": 0.0,
        "cost": 0.0,
    }


def now_utc() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def load_runner_state(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    try:
        state = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise SystemExit(f"invalid runner state file: {path}") from exc
    if not isinstance(state, dict):
        raise SystemExit(f"invalid runner state file: {path}")
    return state


def write_runner_state(path: Path, state: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    state["updated_at"] = now_utc()
    path.write_text(json.dumps(state, indent=2, sort_keys=True), encoding="utf-8")


def initial_runner_state(
    manifest_path: Path,
    output_dir: Path,
    provider: str,
    model: str,
    execution_mode: str,
    jobs_scheduled: int,
    chunks_total: int,
) -> dict[str, Any]:
    return {
        "version": 1,
        "status": "running",
        "created_at": now_utc(),
        "updated_at": now_utc(),
        "manifest": str(manifest_path),
        "output_dir": str(output_dir),
        "provider": provider,
        "model": model,
        "execution_mode": execution_mode,
        "jobs_scheduled": jobs_scheduled,
        "chunks_total": chunks_total,
        "completed_chunks": [],
        "chunks": {},
        "direct_usage_totals": empty_usage_totals(),
        "stop_reason": None,
        "redaction": "state omits manifest rows, review artifacts, file_ids, proposal rows, and secrets",
    }


def completed_chunk_indexes(state: dict[str, Any]) -> set[int]:
    completed = state.get("completed_chunks")
    if not isinstance(completed, list):
        return set()
    indexes: set[int] = set()
    for value in completed:
        if isinstance(value, int):
            indexes.add(value)
        elif isinstance(value, str) and value.isdigit():
            indexes.add(int(value))
    return indexes


def record_chunk_state(
    state: dict[str, Any],
    index: int,
    status: str,
    jobs: int,
    proposal_rows: int,
    error_rows: int,
    outputs: dict[str, str | None],
    reason: str | None = None,
) -> None:
    chunks_state = state.setdefault("chunks", {})
    if not isinstance(chunks_state, dict):
        chunks_state = {}
        state["chunks"] = chunks_state
    chunks_state[str(index)] = {
        "status": status,
        "jobs": jobs,
        "proposal_rows": proposal_rows,
        "error_rows": error_rows,
        "outputs": outputs,
        "reason": reason,
        "updated_at": now_utc(),
    }
    completed = completed_chunk_indexes(state)
    if status == "completed":
        completed.add(index)
    else:
        completed.discard(index)
    state["completed_chunks"] = sorted(completed)


def state_error_rows(state: dict[str, Any]) -> int:
    chunks_state = state.get("chunks")
    if not isinstance(chunks_state, dict):
        return 0
    total = 0
    for chunk in chunks_state.values():
        if isinstance(chunk, dict):
            value = chunk.get("error_rows")
            if isinstance(value, int):
                total += value
    return total


def openrouter_chat_with_retry(
    api_key: str,
    model: str,
    prompt: str,
    schema: dict[str, Any],
    timeout: int,
    max_tokens: int,
    temperature: float,
    provider_sort: str | None,
    allow_data_collection: bool,
    retries: int,
    retry_base_seconds: float,
) -> tuple[dict[str, Any], dict[str, Any]]:
    attempts: list[dict[str, Any]] = []
    max_attempts = max(1, retries + 1)
    last_error: DirectApiError | None = None
    started = time.monotonic()
    for attempt in range(1, max_attempts + 1):
        attempt_started = time.monotonic()
        try:
            try:
                response, metadata = openrouter_chat_completion(
                    api_key,
                    model,
                    prompt,
                    schema,
                    timeout,
                    max_tokens,
                    temperature,
                    provider_sort,
                    allow_data_collection,
                    strict_schema=True,
                )
                schema_mode = "json_schema"
            except DirectApiError as exc:
                if exc.status not in {400, 422}:
                    raise
                response, metadata = openrouter_chat_completion(
                    api_key,
                    model,
                    prompt,
                    schema,
                    timeout,
                    max_tokens,
                    temperature,
                    provider_sort,
                    allow_data_collection,
                    strict_schema=False,
                )
                schema_mode = "json_object"
            attempts.append({
                "attempt": attempt,
                "status": "ok",
                "schema_mode": schema_mode,
                "elapsed_seconds": round(time.monotonic() - attempt_started, 3),
            })
            metadata = {
                **metadata,
                "attempts": attempts,
                "elapsed_seconds": round(time.monotonic() - started, 3),
            }
            return response, metadata
        except DirectApiError as exc:
            last_error = exc
            attempts.append({
                "attempt": attempt,
                "status": "error",
                "error": str(exc),
                "http_status": exc.status,
                "elapsed_seconds": round(time.monotonic() - attempt_started, 3),
            })
            if attempt >= max_attempts or not transient_direct_error(exc):
                break
            time.sleep(max(0.0, retry_base_seconds) * attempt)
    if last_error is None:
        last_error = DirectApiError("OpenRouter direct API retry exhausted")
    last_error.args = (f"{last_error}; attempts={len(attempts)}",)
    raise last_error


def direct_egress_attestation(
    provider_sort: str | None,
    allow_data_collection: bool,
    timeout: int,
    retries: int,
    retry_base_seconds: float,
) -> dict[str, Any]:
    parsed = urllib.parse.urlparse(OPENROUTER_API_URL)
    host = parsed.hostname or ""
    path = parsed.path or ""
    status = "ok" if parsed.scheme == "https" and host in DIRECT_ALLOWED_EGRESS_HOSTS and not allow_data_collection else "requires_review"
    return {
        "status": status,
        "mode": "single-https-provider-gateway",
        "gateway": "openrouter-compatible",
        "allowed_hosts": sorted(DIRECT_ALLOWED_EGRESS_HOSTS),
        "endpoint_scheme": parsed.scheme,
        "endpoint_host": host,
        "endpoint_path": path,
        "endpoint_url_sha256": text_sha256(OPENROUTER_API_URL),
        "provider_sort": provider_sort or "default",
        "provider_data_collection": "allow" if allow_data_collection else "deny",
        "provider_data_collection_denied": not allow_data_collection,
        "timeout_seconds": timeout,
        "retries": retries,
        "retry_base_seconds": retry_base_seconds,
        "secret_values_included": False,
        "redaction": "egress attestation omits API keys, Authorization headers, prompt payloads, and response content",
    }


def direct_payload_attestation(
    payload_jobs: list[dict[str, Any]],
    schema: dict[str, Any],
    prompt: str,
    local_errors: list[dict[str, Any]],
) -> dict[str, Any]:
    key_hits = direct_sensitive_key_hits(payload_jobs)
    marker_hits = direct_sensitive_value_marker_hits(payload_jobs)
    payload_json = json.dumps(payload_jobs, sort_keys=True, separators=(",", ":"))
    schema_json = json.dumps(schema, sort_keys=True, separators=(",", ":"))
    return {
        "status": "ok" if key_hits == 0 and marker_hits == 0 else "requires_review",
        "payload_class": "sanitized-bounded-review-jobs",
        "job_identity_policy": "synthetic-job-ref",
        "real_file_ids_sent": False,
        "raw_file_bytes_sent": False,
        "raw_extracts_sent": False,
        "object_keys_sent": False,
        "source_refs_sent": False,
        "filenames_sent": False,
        "secret_values_sent": False,
        "jobs": len(payload_jobs),
        "local_error_rows": len(local_errors),
        "payload_bytes": len(payload_json.encode("utf-8")),
        "payload_sha256": text_sha256(payload_json),
        "prompt_bytes": len(prompt.encode("utf-8")),
        "prompt_sha256": text_sha256(prompt),
        "schema_sha256": text_sha256(schema_json),
        "payload_sensitive_key_hits": key_hits,
        "payload_sensitive_value_marker_hits": marker_hits,
        "review_artifact_policy": "bounded/redacted review artifact JSON only; raw files, raw extracts, source refs, object keys, filenames, ACLs, and private metadata are not provider payload fields",
        "redaction": "payload attestation contains counts and hashes only; no payload rows, file IDs, filenames, object keys, source refs, extracted text, proposal rows, or secrets",
    }


def provider_payload_policy_from_audit(execution_mode: str, direct_audit_path: Path | None) -> dict[str, Any]:
    if execution_mode != "direct-api":
        return {
            "status": "ok",
            "execution_mode": execution_mode,
            "proof_source": "runtime-sanitized-worker-manifest",
            "payload_class": "codewith-worker-prompt-plus-sanitized-manifest",
            "real_file_ids_sent": False,
            "raw_file_bytes_sent": False,
            "raw_extracts_sent": False,
            "object_keys_sent": False,
            "source_refs_sent": False,
            "filenames_sent": False,
            "secret_values_sent": False,
            "provider_data_collection_denied": True,
            "allowed_host_policy_matched": True,
            "redaction": "provider payload policy contains route class and booleans only; no prompts, payload rows, file IDs, object keys, source refs, filenames, extracted text, proposal rows, or secrets",
        }

    audit: dict[str, Any] = {}
    if direct_audit_path and direct_audit_path.exists():
        try:
            loaded = json.loads(direct_audit_path.read_text(encoding="utf-8"))
            audit = loaded if isinstance(loaded, dict) else {}
        except json.JSONDecodeError:
            audit = {}
    egress = audit.get("egress_attestation") if isinstance(audit.get("egress_attestation"), dict) else {}
    payload = audit.get("payload_attestation") if isinstance(audit.get("payload_attestation"), dict) else {}
    allowed_hosts = egress.get("allowed_hosts") if isinstance(egress.get("allowed_hosts"), list) else []
    endpoint_host = egress.get("endpoint_host")
    policy = {
        "status": "ok",
        "execution_mode": execution_mode,
        "proof_source": "direct-api-audit",
        "payload_class": payload.get("payload_class"),
        "payload_sha256": payload.get("payload_sha256"),
        "prompt_sha256": payload.get("prompt_sha256"),
        "schema_sha256": payload.get("schema_sha256"),
        "endpoint_host": endpoint_host,
        "allowed_host_count": len(allowed_hosts),
        "real_file_ids_sent": payload.get("real_file_ids_sent"),
        "raw_file_bytes_sent": payload.get("raw_file_bytes_sent"),
        "raw_extracts_sent": payload.get("raw_extracts_sent"),
        "object_keys_sent": payload.get("object_keys_sent"),
        "source_refs_sent": payload.get("source_refs_sent"),
        "filenames_sent": payload.get("filenames_sent"),
        "secret_values_sent": payload.get("secret_values_sent"),
        "provider_data_collection_denied": egress.get("provider_data_collection_denied"),
        "allowed_host_policy_matched": isinstance(endpoint_host, str) and endpoint_host in DIRECT_ALLOWED_EGRESS_HOSTS and sorted(allowed_hosts) == sorted(DIRECT_ALLOWED_EGRESS_HOSTS),
        "payload_sensitive_key_hits": payload.get("payload_sensitive_key_hits"),
        "payload_sensitive_value_marker_hits": payload.get("payload_sensitive_value_marker_hits"),
        "redaction": "provider payload policy contains hashes, host class, and booleans only; no prompts, payload rows, file IDs, object keys, source refs, filenames, extracted text, proposal rows, or secrets",
    }
    ok = (
        audit.get("status") == "ok"
        and egress.get("status") == "ok"
        and payload.get("status") == "ok"
        and policy["real_file_ids_sent"] is False
        and policy["raw_file_bytes_sent"] is False
        and policy["raw_extracts_sent"] is False
        and policy["object_keys_sent"] is False
        and policy["source_refs_sent"] is False
        and policy["filenames_sent"] is False
        and policy["secret_values_sent"] is False
        and policy["provider_data_collection_denied"] is True
        and policy["allowed_host_policy_matched"] is True
        and int(policy.get("payload_sensitive_key_hits") or 0) == 0
        and int(policy.get("payload_sensitive_value_marker_hits") or 0) == 0
    )
    policy["status"] = "ok" if ok else "requires_review"
    return policy


def direct_static_policy_attestation(
    provider: str,
    model: str,
    provider_sort: str | None,
    allow_data_collection: bool,
    timeout: int,
    retries: int,
    retry_base_seconds: float,
) -> dict[str, Any]:
    return {
        "status": "ok" if not allow_data_collection else "requires_review",
        "provider": provider,
        "model": model,
        "egress_attestation": direct_egress_attestation(
            provider_sort,
            allow_data_collection,
            timeout,
            retries,
            retry_base_seconds,
        ),
        "payload_policy": {
            "payload_class": "sanitized-bounded-review-jobs",
            "job_identity_policy": "synthetic-job-ref",
            "real_file_ids_sent": False,
            "review_artifacts_sanitized": True,
            "raw_file_bytes_sent": False,
            "raw_extracts_sent": False,
            "secret_values_sent": False,
        },
        "redaction": "static direct-provider policy omits payload rows, file IDs, filenames, object keys, source refs, extracted text, proposal rows, and secrets",
    }


def worker_row_runtime_safety_counts(row: dict[str, Any]) -> dict[str, int]:
    source_reference_fields = 0
    private_payload_fields = 0
    metadata_target_fields = 0
    sensitive_value_marker_hits = 0
    for key, value in row.items():
        lowered = str(key).lower()
        if lowered in {
            "acl",
            "checksum",
            "drive_id",
            "file_name",
            "filename",
            "google_drive_id",
            "key",
            "labels",
            "name",
            "object_key",
            "original_filename",
            "original_name",
            "path",
            "permissions",
            "private_metadata",
            "revision_id",
            "s3_key",
            "sha256",
            "source_ref",
        }:
            source_reference_fields += 1
        if lowered.startswith("private_") or lowered in {"private_metadata"}:
            private_payload_fields += 1
        if lowered in {"canonical_name", "target_path", "labels"}:
            metadata_target_fields += 1
        if lowered != "file_id":
            sensitive_value_marker_hits += direct_sensitive_value_marker_hits(value)
    return {
        "source_reference_fields": source_reference_fields,
        "private_payload_fields": private_payload_fields,
        "metadata_target_fields": metadata_target_fields,
        "sensitive_value_marker_hits": sensitive_value_marker_hits,
    }


def llm_artifact_hashes(paths: dict[str, Path | None]) -> list[dict[str, Any]]:
    entries: list[dict[str, Any]] = []
    for label, path in sorted(paths.items()):
        if path is None or not path.exists() or not path.is_file():
            continue
        entries.append({
            "label": label,
            "bytes": path.stat().st_size,
            "sha256": file_sha256(path),
        })
    return entries


def write_llm_chunk_runtime_attestations(
    chunk_index: int,
    prepared_rows: list[dict[str, Any]],
    output_path: Path,
    execution_mode: str,
    validation_ok: bool,
    artifact_paths: dict[str, Path | None],
) -> Path:
    rows: list[dict[str, Any]] = []
    shared_artifacts = llm_artifact_hashes(artifact_paths)
    provider_payload_policy = provider_payload_policy_from_audit(execution_mode, artifact_paths.get("direct_api_audit"))
    for job_index, row in enumerate(prepared_rows, start=1):
        safety_counts = worker_row_runtime_safety_counts(row)
        status = "ok" if (
            validation_ok
            and provider_payload_policy.get("status") == "ok"
            and safety_counts["source_reference_fields"] == 0
            and safety_counts["private_payload_fields"] == 0
            and safety_counts["metadata_target_fields"] == 0
            and safety_counts["sensitive_value_marker_hits"] == 0
        ) else "requires_review"
        rows.append({
            "kind": "open_files_llm_job_runtime_attestation",
            "version": 1,
            "chunk_ref": f"chunk-{chunk_index:04d}",
            "job_ref": f"job-{job_index:06d}",
            "status": status,
            "execution_mode": execution_mode,
            "source_identity_sha256": hash_file_ids([row]),
            "source_identity_disclosure": "hash-only",
            "source": {
                "owner": row.get("owner"),
                "extractor_lane": row.get("extractor_lane"),
                "mime": row.get("mime"),
                "expected_ext": row.get("expected_ext"),
                "size": row.get("size"),
                "route": row.get("route"),
                "artifact_ready": row.get("artifact_ready"),
                "content_ready": row.get("content_ready"),
            },
            "row_safety_counts": safety_counts,
            "provider_payload_policy": provider_payload_policy,
            "canonical_bytes_policy": {
                "canonical_s3_keys_immutable": True,
                "source_bytes_read_only": True,
                "s3_object_key_rename_allowed": False,
                "s3_put_copy_delete_allowed": False,
                "s3_mutation_attempted_by_runner": False,
            },
            "write_policy": {
                "metadata_only": True,
                "allowed_durable_write_surface": "proposal-jsonl-for-reviewed-metadata-only-apply",
                "proposal_write_attempted": True,
                "metadata_apply_attempted": False,
                "search_index_write_attempted": False,
                "source_byte_write_attempted": False,
                "private_artifact_write_scope": "run-output-dir-only",
            },
            "validation": {
                "worker_output_validation_ok": validation_ok,
                "requires_human_review_before_apply": True,
            },
            "artifact_hashes": shared_artifacts,
            "redaction": "per-job attestation contains hashes, counts, lane/status metadata, and policy booleans only; no file IDs, filenames, object keys, source refs, extracted text, transcripts, proposal rows, or secrets",
        })
    write_jsonl(output_path, rows)
    return output_path


def llm_runtime_attestation_summary(paths: list[Path]) -> dict[str, Any]:
    statuses: dict[str, int] = {}
    file_hashes: list[str] = []
    jobs = 0
    immutable_count = 0
    metadata_only_count = 0
    provider_payload_policy_count = 0
    provider_payload_policy_violations = 0
    metadata_apply_attempted = 0
    search_index_write_attempted = 0
    source_write_attempted = 0
    s3_mutation_attempted = 0
    missing = 0
    invalid = 0
    for path in paths:
        if not path.exists():
            missing += 1
            continue
        file_hashes.append(file_sha256(path))
        with path.open("r", encoding="utf-8") as handle:
            for line in handle:
                stripped = line.strip()
                if not stripped:
                    continue
                try:
                    attestation = json.loads(stripped)
                except json.JSONDecodeError:
                    invalid += 1
                    continue
                if not isinstance(attestation, dict):
                    invalid += 1
                    continue
                jobs += 1
                status = str(attestation.get("status") or "unknown")
                statuses[status] = statuses.get(status, 0) + 1
                provider_policy = attestation.get("provider_payload_policy") if isinstance(attestation.get("provider_payload_policy"), dict) else {}
                canonical_policy = attestation.get("canonical_bytes_policy") if isinstance(attestation.get("canonical_bytes_policy"), dict) else {}
                write_policy = attestation.get("write_policy") if isinstance(attestation.get("write_policy"), dict) else {}
                provider_policy_ok = (
                    provider_policy.get("status") == "ok"
                    and provider_policy.get("real_file_ids_sent") is False
                    and provider_policy.get("raw_file_bytes_sent") is False
                    and provider_policy.get("raw_extracts_sent") is False
                    and provider_policy.get("object_keys_sent") is False
                    and provider_policy.get("source_refs_sent") is False
                    and provider_policy.get("filenames_sent") is False
                    and provider_policy.get("secret_values_sent") is False
                    and provider_policy.get("provider_data_collection_denied") is True
                    and provider_policy.get("allowed_host_policy_matched") is True
                )
                if provider_policy_ok:
                    provider_payload_policy_count += 1
                else:
                    provider_payload_policy_violations += 1
                if canonical_policy.get("canonical_s3_keys_immutable") is True and canonical_policy.get("source_bytes_read_only") is True:
                    immutable_count += 1
                if write_policy.get("metadata_only") is True:
                    metadata_only_count += 1
                if write_policy.get("metadata_apply_attempted") is True:
                    metadata_apply_attempted += 1
                if write_policy.get("search_index_write_attempted") is True:
                    search_index_write_attempted += 1
                if write_policy.get("source_byte_write_attempted") is True:
                    source_write_attempted += 1
                if canonical_policy.get("s3_mutation_attempted_by_runner") is True:
                    s3_mutation_attempted += 1
    digest = hashlib.sha256()
    for value in sorted(file_hashes):
        digest.update(value.encode("utf-8"))
        digest.update(b"\n")
    ok = (
        jobs > 0
        and missing == 0
        and invalid == 0
        and statuses.get("requires_review", 0) == 0
        and statuses.get("ok", 0) == jobs
        and provider_payload_policy_count == jobs
        and provider_payload_policy_violations == 0
        and immutable_count == jobs
        and metadata_only_count == jobs
        and metadata_apply_attempted == 0
        and search_index_write_attempted == 0
        and source_write_attempted == 0
        and s3_mutation_attempted == 0
    )
    return {
        "status": "ok" if ok else "not_executed" if jobs == 0 and not paths else "requires_review",
        "jobs": jobs,
        "attestation_files": len(paths),
        "missing_attestation_files": missing,
        "invalid_attestation_rows": invalid,
        "statuses": dict(sorted(statuses.items())),
        "provider_payload_policy_attested_jobs": provider_payload_policy_count,
        "provider_payload_policy_violation_jobs": provider_payload_policy_violations,
        "immutable_bytes_attested_jobs": immutable_count,
        "metadata_only_attested_jobs": metadata_only_count,
        "metadata_apply_attempted_jobs": metadata_apply_attempted,
        "search_index_write_attempted_jobs": search_index_write_attempted,
        "source_byte_write_attempted_jobs": source_write_attempted,
        "s3_mutation_attempted_jobs": s3_mutation_attempted,
        "attestation_files_sha256": digest.hexdigest() if file_hashes else None,
        "redaction": "aggregate LLM runtime attestation contains counts and hashes only; no file IDs, filenames, object keys, source refs, extracted text, proposal rows, job paths, or secrets",
    }


def run_direct_api_review(
    rows: list[dict[str, Any]],
    proposals: Path,
    errors: Path,
    final_output: Path,
    audit_output: Path,
    model: str,
    secret_name: str,
    timeout: int,
    max_tokens: int,
    temperature: float,
    provider_sort: str | None,
    allow_data_collection: bool,
    retries: int,
    retry_base_seconds: float,
) -> None:
    schema = direct_response_schema()
    jobs, local_errors = safe_direct_jobs(rows)
    payload_jobs, ref_to_file_id = direct_provider_payload_jobs(jobs)
    if not jobs:
        write_jsonl(proposals, [])
        write_jsonl(errors, local_errors)
        prompt = ""
        audit_output.write_text(json.dumps({
            "status": "local_errors",
            "jobs": 0,
            "local_errors": len(local_errors),
            "egress_attestation": direct_egress_attestation(
                provider_sort,
                allow_data_collection,
                timeout,
                retries,
                retry_base_seconds,
            ),
            "payload_attestation": direct_payload_attestation(payload_jobs, schema, prompt, local_errors),
        }, indent=2, sort_keys=True), encoding="utf-8")
        final_output.write_text(json.dumps({
            "status": "failed",
            "jobs_seen": 0,
            "proposals_written": 0,
            "needs_review": 0,
            "errors": len(local_errors),
        }, indent=2, sort_keys=True), encoding="utf-8")
        return

    api_key = openrouter_api_key(secret_name)
    prompt = direct_prompt(payload_jobs, schema)
    payload_attestation = direct_payload_attestation(payload_jobs, schema, prompt, local_errors)
    if payload_attestation["status"] != "ok":
        raise DirectApiError("direct provider payload attestation failed")
    response, audit_metadata = openrouter_chat_with_retry(
        api_key,
        model,
        prompt,
        schema,
        timeout,
        max_tokens,
        temperature,
        provider_sort,
        allow_data_collection,
        retries,
        retry_base_seconds,
    )

    proposal_rows = response.get("proposals")
    error_rows = response.get("errors")
    if not isinstance(proposal_rows, list) or not all(isinstance(row, dict) for row in proposal_rows):
        raise DirectApiError("direct response missing proposal array")
    if not isinstance(error_rows, list) or not all(isinstance(row, dict) for row in error_rows):
        raise DirectApiError("direct response missing error array")
    proposal_rows = map_direct_response_rows(proposal_rows, ref_to_file_id, "proposal")
    error_rows = map_direct_response_rows(error_rows, ref_to_file_id, "error")
    if local_errors:
        error_rows = [*error_rows, *local_errors]

    write_jsonl(proposals, proposal_rows)
    write_jsonl(errors, error_rows)
    audit_output.write_text(json.dumps({
        "status": "ok",
        "jobs": len(jobs),
        "model": model,
        "provider_sort": provider_sort,
        "provider_data_collection": "allow" if allow_data_collection else "deny",
        "attempts": audit_metadata.get("attempts"),
        "elapsed_seconds": audit_metadata.get("elapsed_seconds"),
        "response_id": audit_metadata.get("id"),
        "response_model": audit_metadata.get("model"),
        "usage": audit_metadata.get("usage"),
        "egress_attestation": direct_egress_attestation(
            provider_sort,
            allow_data_collection,
            timeout,
            retries,
            retry_base_seconds,
        ),
        "payload_attestation": payload_attestation,
        "redaction": "audit omits manifest rows, review artifacts, file_ids, proposal rows, and secrets",
    }, indent=2, sort_keys=True), encoding="utf-8")
    final_output.write_text(json.dumps({
        "status": response.get("status") if response.get("status") in {"done", "partial", "failed"} else "partial",
        "jobs_seen": response.get("jobs_seen") if isinstance(response.get("jobs_seen"), int) else len(jobs),
        "proposals_written": len(proposal_rows),
        "needs_review": sum(1 for row in proposal_rows if row.get("requires_review") is True),
        "errors": len(error_rows),
    }, indent=2, sort_keys=True), encoding="utf-8")


def prepare_review_jobs(
    rows: list[dict[str, Any]],
    artifact_dir: Path,
    review_dir: Path,
    cwd: Path,
    timeout: int,
    max_download_bytes: int,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    script = cwd / ".codewith" / "skills" / "open-files-corpus-reader" / "scripts" / "extract_artifact_for_file.py"
    prepared: list[dict[str, Any]] = []
    errors: list[dict[str, Any]] = []
    artifact_dir.mkdir(parents=True, exist_ok=True)
    review_dir.mkdir(parents=True, exist_ok=True)

    for row in rows:
        file_id = row.get("file_id")
        if not isinstance(file_id, str) or not file_id:
            errors.append({"file_id": None, "status": "invalid_job", "reason": "missing file_id"})
            continue
        proc = subprocess.run(
            [
                "python3",
                str(script),
                file_id,
                "--artifact-dir",
                str(artifact_dir),
                "--timeout-seconds",
                str(timeout),
                "--max-download-bytes",
                str(max_download_bytes),
            ],
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            cwd=str(cwd),
            timeout=timeout + 30,
        )
        try:
            status = json.loads(proc.stdout)
        except json.JSONDecodeError:
            errors.append({"file_id": file_id, "status": "preextract_failed", "reason": "extractor did not return JSON"})
            continue
        review_artifact = status.get("review_artifact")
        if proc.returncode != 0 or not isinstance(review_artifact, str) or not Path(review_artifact).exists():
            errors.append({
                "file_id": file_id,
                "status": str(status.get("status") or "preextract_failed"),
                "reason": str(status.get("error") or "review artifact was not created")[:300],
            })
            continue
        worker_review_artifact = review_dir / f"job-{index:06d}.review.json"
        shutil.copyfile(review_artifact, worker_review_artifact)
        prepared.append({
            **row,
            "review_artifact": str(worker_review_artifact),
            "artifact_status": status.get("status"),
            "artifact_ready": bool(status.get("artifact_ready")),
            "content_ready": bool(status.get("content_ready")),
            "extractor": status.get("extractor"),
            "route": status.get("route"),
        })

    return prepared, errors


def validate_worker_outputs(final_output: Path, proposals: Path, errors: Path, manifest: Path, expected_ids: set[str]) -> list[str]:
    problems: list[str] = []
    if not final_output.exists():
        return ["missing final output"]
    try:
        final = json.loads(final_output.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        return [f"invalid final JSON: {exc}"]
    expected_jobs = len(expected_ids)
    if final.get("jobs_seen") != expected_jobs:
        problems.append(f"jobs_seen {final.get('jobs_seen')} != expected {expected_jobs}")

    proposal_lines = line_count(proposals)
    error_lines = line_count(errors)
    proposals_written = final.get("proposals_written")
    errors_written = final.get("errors")
    if proposals_written != proposal_lines:
        problems.append(f"proposals_written {proposals_written} != proposal lines {proposal_lines}")
    if errors_written != error_lines:
        problems.append(f"errors {errors_written} != error lines {error_lines}")
    if proposal_lines + error_lines < expected_jobs:
        problems.append(f"proposal/error rows {proposal_lines + error_lines} < expected jobs {expected_jobs}")
    if proposal_lines + error_lines > expected_jobs:
        problems.append(f"proposal/error rows {proposal_lines + error_lines} > expected jobs {expected_jobs}")

    proposal_rows, proposal_parse_errors = load_output_rows(proposals)
    error_rows, error_parse_errors = load_output_rows(errors)
    problems.extend(proposal_parse_errors)
    problems.extend(error_parse_errors)
    proposal_ids = [row.get("file_id") for row in proposal_rows if isinstance(row.get("file_id"), str)]
    error_ids = [row.get("file_id") for row in error_rows if isinstance(row.get("file_id"), str)]
    all_ids = proposal_ids + error_ids
    if set(all_ids) != expected_ids:
        missing = sorted(expected_ids - set(all_ids))
        extra = sorted(set(all_ids) - expected_ids)
        if missing:
            problems.append(f"missing output for scheduled file_ids: {', '.join(missing)}")
        if extra:
            problems.append(f"output contains unscheduled file_ids: {', '.join(extra)}")
    duplicates = sorted(file_id for file_id in set(all_ids) if all_ids.count(file_id) > 1)
    if duplicates:
        problems.append(f"duplicate output file_ids: {', '.join(duplicates)}")
    problems.extend(validate_error_rows(error_rows, expected_ids))

    if proposal_lines:
        validation_errors = proposals.with_suffix(".proposal-validation-errors.jsonl")
        validator = Path(__file__).resolve().parent / "validate_metadata_proposals.py"
        proc = subprocess.run(
            [
                "python3",
                str(validator),
                str(proposals),
                "--errors-output",
                str(validation_errors),
                "--manifest",
                str(manifest),
                "--require-review",
            ],
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        if proc.returncode != 0:
            problems.append("proposal validation failed")
    return problems


def main() -> int:
    parser = argparse.ArgumentParser(description="Prepare and optionally run Codewith LLM review batches.")
    parser.add_argument("--manifest", required=True, help="Input review manifest JSONL")
    parser.add_argument("--output-dir", default=None, help="Private run output directory")
    parser.add_argument("--provider", choices=["spark", "openrouter", "mimo"], default="spark")
    parser.add_argument("--execution-mode", choices=["codewith", "direct-api"], default="codewith", help="Run nested Codewith workers or call provider API directly from this runner")
    parser.add_argument("--model", help="Override model slug")
    parser.add_argument("--auth-profile", help="Codewith auth profile for Spark provider")
    parser.add_argument("--reasoning-effort", choices=["low", "medium", "high", "xhigh", "none"], default="high", help="Codewith model_reasoning_effort override for worker execution")
    parser.add_argument("--sandbox", choices=["read-only", "workspace-write", "danger-full-access"], default="workspace-write")
    parser.add_argument("--allow-bypass-sandbox", action="store_true", help="Use only for externally sandboxed pilot workers.")
    parser.add_argument("--limit", type=int, default=10, help="Maximum manifest rows to schedule")
    parser.add_argument("--chunk-size", type=int, default=5, help="Rows per worker chunk")
    parser.add_argument("--execute", action="store_true", help="Actually run Codewith exec workers. Default is dry-run.")
    parser.add_argument("--prepare-artifacts", action="store_true", help="Prepare redacted review artifacts during dry-runs too. Execute mode always prepares artifacts.")
    parser.add_argument("--max-download-bytes", type=int, default=100 * 1024 * 1024, help="Maximum object size to download during pre-extraction")
    parser.add_argument("--timeout-seconds", type=int, default=900, help="Per-worker timeout")
    parser.add_argument("--cwd", default=str(repo_root()), help="Working directory for workers")
    parser.add_argument("--openrouter-secret", default=OPENROUTER_SECRET, help="Secret name for OpenRouter-compatible providers")
    parser.add_argument("--provider-sort", choices=["price", "throughput", "latency"], help="OpenRouter provider sort for direct API mode; use throughput for Nitro/UltraSpeed-style routing")
    parser.add_argument("--allow-provider-data-collection", action="store_true", help="Allow OpenRouter providers that may store prompts. Default denies provider data collection.")
    parser.add_argument("--direct-max-tokens", type=int, default=4096, help="Max output tokens for direct API responses")
    parser.add_argument("--direct-temperature", type=float, default=0.0, help="Temperature for direct API responses")
    parser.add_argument("--direct-retries", type=int, default=2, help="Retry count for transient direct API failures")
    parser.add_argument("--direct-retry-base-seconds", type=float, default=2.0, help="Linear retry backoff base seconds for direct API mode")
    parser.add_argument("--direct-max-run-cost-usd", type=float, help="Stop after a direct API chunk if cumulative reported cost exceeds this amount")
    parser.add_argument("--direct-chunk-delay-seconds", type=float, default=0.0, help="Sleep between direct API chunks for simple rate limiting")
    parser.add_argument("--state-file", help="Runner checkpoint JSON path; defaults to <output-dir>/runner-state.json")
    parser.add_argument("--resume", action="store_true", help="Resume from state-file and skip chunks already marked completed")
    parser.add_argument("--max-chunks", type=int, help="Process at most this many new chunks in this invocation")
    parser.add_argument("--stop-after-seconds", type=float, help="Stop before starting another chunk once this elapsed time is reached")
    parser.add_argument("--max-error-rows", type=int, help="Stop after a validated chunk if cumulative error rows exceed this amount")
    args = parser.parse_args()

    if args.chunk_size <= 0:
        raise SystemExit("--chunk-size must be positive")
    if args.limit is not None and args.limit < 0:
        raise SystemExit("--limit cannot be negative")
    if args.direct_retries < 0:
        raise SystemExit("--direct-retries cannot be negative")
    if args.direct_retry_base_seconds < 0:
        raise SystemExit("--direct-retry-base-seconds cannot be negative")
    if args.direct_max_run_cost_usd is not None and args.direct_max_run_cost_usd < 0:
        raise SystemExit("--direct-max-run-cost-usd cannot be negative")
    if args.direct_chunk_delay_seconds < 0:
        raise SystemExit("--direct-chunk-delay-seconds cannot be negative")
    if args.max_chunks is not None and args.max_chunks < 0:
        raise SystemExit("--max-chunks cannot be negative")
    if args.stop_after_seconds is not None and args.stop_after_seconds < 0:
        raise SystemExit("--stop-after-seconds cannot be negative")
    if args.max_error_rows is not None and args.max_error_rows < 0:
        raise SystemExit("--max-error-rows cannot be negative")

    cwd = Path(args.cwd).expanduser().resolve()
    manifest_path = Path(args.manifest).expanduser().resolve()
    if not manifest_path.exists():
        raise SystemExit(f"manifest not found: {manifest_path}")

    default_model, default_auth = provider_defaults(args.provider)
    model = args.model or default_model
    auth_profile = args.auth_profile if args.auth_profile is not None else default_auth
    reasoning_effort = None if args.reasoning_effort == "none" else args.reasoning_effort
    provider_sort = args.provider_sort
    if provider_sort is None and args.provider == "mimo":
        provider_sort = "throughput"
    if args.execution_mode == "direct-api" and args.provider == "spark":
        raise SystemExit("direct-api execution requires provider openrouter or mimo; Spark is available through Codewith exec")

    run_id = time.strftime("%Y%m%dT%H%M%S")
    output_dir = Path(args.output_dir).expanduser().resolve() if args.output_dir else cwd / ".codewith" / "private-artifacts" / "llm-review-runs" / run_id
    output_dir.mkdir(parents=True, exist_ok=True)
    state_file = Path(args.state_file).expanduser().resolve() if args.state_file else output_dir / "runner-state.json"

    schema = Path(__file__).resolve().parents[1] / "schemas" / "worker-final.schema.json"
    rows = load_jsonl(manifest_path, args.limit)
    row_chunks = chunks(rows, args.chunk_size)
    commands: list[dict[str, Any]] = []
    if args.resume:
        state = load_runner_state(state_file)
        if not state:
            state = initial_runner_state(manifest_path, output_dir, args.provider, model, args.execution_mode, len(rows), len(row_chunks))
    else:
        state = initial_runner_state(manifest_path, output_dir, args.provider, model, args.execution_mode, len(rows), len(row_chunks))
    state["status"] = "running"
    state["provider"] = args.provider
    state["model"] = model
    state["execution_mode"] = args.execution_mode
    state["jobs_scheduled"] = len(rows)
    state["chunks_total"] = len(row_chunks)
    state["manifest"] = str(manifest_path)
    state["output_dir"] = str(output_dir)
    state["stop_reason"] = None
    direct_usage_totals = empty_usage_totals()
    existing_usage = state.get("direct_usage_totals")
    if args.resume and isinstance(existing_usage, dict):
        for key in direct_usage_totals:
            value = numeric_value(existing_usage.get(key))
            if value is not None:
                direct_usage_totals[key] = value
    state["direct_usage_totals"] = direct_usage_totals
    write_runner_state(state_file, state)
    skipped_chunks: list[int] = []
    processed_chunks = 0
    stop_reason: str | None = None
    runtime_attestation_paths: list[Path] = []
    started_monotonic = time.monotonic()

    for index, row_chunk in enumerate(row_chunks, start=1):
        if args.resume and index in completed_chunk_indexes(state):
            skipped_chunks.append(index)
            continue
        if args.max_chunks is not None and processed_chunks >= args.max_chunks:
            stop_reason = "max_chunks"
            break
        if args.stop_after_seconds is not None and time.monotonic() - started_monotonic >= args.stop_after_seconds:
            stop_reason = "stop_after_seconds"
            break
        if args.max_error_rows is not None and state_error_rows(state) > args.max_error_rows:
            stop_reason = "max_error_rows"
            break
        prefix = f"chunk-{index:04d}"
        chunk_manifest = output_dir / f"{prefix}.manifest.jsonl"
        prompt = output_dir / f"{prefix}.prompt.md"
        proposals = output_dir / f"{prefix}.proposals.jsonl"
        errors = output_dir / f"{prefix}.errors.jsonl"
        final_output = output_dir / f"{prefix}.final.json"
        direct_audit = output_dir / f"{prefix}.direct-api-audit.json"
        runtime_attestations = output_dir / f"{prefix}.runtime-attestations.jsonl"
        artifact_dir = output_dir / f"{prefix}.artifacts"
        review_dir = output_dir / f"{prefix}.review-artifacts"
        preextract_errors: list[dict[str, Any]] = []
        prepared_rows = row_chunk
        if args.execute or args.prepare_artifacts:
            prepared_rows, preextract_errors = prepare_review_jobs(
                row_chunk,
                artifact_dir,
                review_dir,
                cwd,
                min(args.timeout_seconds, 300),
                args.max_download_bytes,
            )
            if preextract_errors:
                preextract_error_path = output_dir / f"{prefix}.preextract-errors.jsonl"
                write_jsonl(preextract_error_path, preextract_errors)
                state["status"] = "failed"
                state["stop_reason"] = "preextract_errors"
                record_chunk_state(
                    state,
                    index,
                    "failed",
                    len(row_chunk),
                    0,
                    len(preextract_errors),
                    {
                        "manifest": str(chunk_manifest),
                        "preextract_errors": str(preextract_error_path),
                    },
                    "preextract_errors",
                )
                write_runner_state(state_file, state)
                print(json.dumps({
                    "status": "failed",
                    "provider": args.provider,
                    "model": model,
                    "output_dir": str(output_dir),
                    "failed_chunk": index,
                    "jobs_scheduled": len(rows),
                    "preextract_errors": str(preextract_error_path),
                }, indent=2, sort_keys=True))
                return 1
        write_jsonl(chunk_manifest, prepared_rows)
        write_prompt(prompt, chunk_manifest, proposals, errors, cwd)
        cmd: list[str] | None = None
        command_label: str
        if args.execution_mode == "codewith":
            cmd = base_command(args.provider, model, auth_profile, reasoning_effort, args.sandbox, cwd, prompt, final_output, schema, args.allow_bypass_sandbox)
            command_label = redacted_command(cmd)
        else:
            command_label = f"direct-api openrouter chat.completions model={model} provider_sort={provider_sort or 'default'}"
        commands.append({
            "chunk": index,
            "jobs": len(prepared_rows),
            "manifest": str(chunk_manifest),
            "prompt": str(prompt),
            "proposals": str(proposals),
            "errors": str(errors),
            "final_output": str(final_output),
            "direct_api_audit": str(direct_audit) if args.execution_mode == "direct-api" else None,
            "runtime_attestations": str(runtime_attestations) if args.execute else None,
            "artifact_dir": str(artifact_dir) if args.execute or args.prepare_artifacts else None,
            "review_dir": str(review_dir) if args.execute or args.prepare_artifacts else None,
            "command": command_label,
        })

        if args.execute:
            if args.execution_mode == "direct-api":
                try:
                    run_direct_api_review(
                        prepared_rows,
                        proposals,
                        errors,
                        final_output,
                        direct_audit,
                        model,
                        args.openrouter_secret,
                        args.timeout_seconds,
                        args.direct_max_tokens,
                        args.direct_temperature,
                        provider_sort,
                        args.allow_provider_data_collection,
                        args.direct_retries,
                        args.direct_retry_base_seconds,
                    )
                except DirectApiError as exc:
                    (output_dir / f"{prefix}.exec-error.txt").write_text(str(exc), encoding="utf-8")
                    state["status"] = "failed"
                    state["stop_reason"] = "direct_api_error"
                    record_chunk_state(
                        state,
                        index,
                        "failed",
                        len(prepared_rows),
                        line_count(proposals),
                        line_count(errors),
                        {
                            "manifest": str(chunk_manifest),
                            "proposals": str(proposals),
                            "errors": str(errors),
                            "final_output": str(final_output),
                            "direct_api_audit": str(direct_audit),
                            "exec_error": str(output_dir / f"{prefix}.exec-error.txt"),
                        },
                        "direct_api_error",
                    )
                    write_runner_state(state_file, state)
                    print(json.dumps({
                        "status": "failed",
                        "provider": args.provider,
                        "model": model,
                        "execution_mode": args.execution_mode,
                        "output_dir": str(output_dir),
                        "failed_chunk": index,
                        "jobs_scheduled": len(rows),
                    }, indent=2, sort_keys=True))
                    return 1
            else:
                if cmd is None:
                    raise SystemExit("internal error: missing Codewith command")
                env = minimal_worker_env(os.environ)
                if args.provider in {"openrouter", "mimo"}:
                    env = openrouter_env(os.environ, args.openrouter_secret)
                with prompt.open("r", encoding="utf-8") as stdin:
                    proc = subprocess.run(cmd, check=False, stdin=stdin, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=args.timeout_seconds, env=env)
                if proc.returncode != 0:
                    (output_dir / f"{prefix}.exec-error.txt").write_text((proc.stderr or proc.stdout)[-4000:], encoding="utf-8")
                    state["status"] = "failed"
                    state["stop_reason"] = "codewith_exec_error"
                    record_chunk_state(
                        state,
                        index,
                        "failed",
                        len(prepared_rows),
                        line_count(proposals),
                        line_count(errors),
                        {
                            "manifest": str(chunk_manifest),
                            "proposals": str(proposals),
                            "errors": str(errors),
                            "final_output": str(final_output),
                            "exec_error": str(output_dir / f"{prefix}.exec-error.txt"),
                        },
                        "codewith_exec_error",
                    )
                    write_runner_state(state_file, state)
                    print(json.dumps({
                        "status": "failed",
                        "provider": args.provider,
                        "model": model,
                        "execution_mode": args.execution_mode,
                        "output_dir": str(output_dir),
                        "failed_chunk": index,
                        "jobs_scheduled": len(rows),
                    }, indent=2, sort_keys=True))
                    return proc.returncode
            expected_ids = {str(row["file_id"]) for row in prepared_rows if row.get("file_id")}
            validation_errors = validate_worker_outputs(final_output, proposals, errors, chunk_manifest, expected_ids)
            if validation_errors:
                validation_path = output_dir / f"{prefix}.runner-validation-error.json"
                validation_path.write_text(json.dumps({
                    "chunk": index,
                    "expected_jobs": len(row_chunk),
                    "errors": validation_errors,
                }, indent=2, sort_keys=True), encoding="utf-8")
                state["status"] = "failed"
                state["stop_reason"] = "runner_validation"
                record_chunk_state(
                    state,
                    index,
                    "failed",
                    len(prepared_rows),
                    line_count(proposals),
                    line_count(errors),
                    {
                        "manifest": str(chunk_manifest),
                        "proposals": str(proposals),
                        "errors": str(errors),
                        "final_output": str(final_output),
                        "runner_validation": str(validation_path),
                    },
                    "runner_validation",
                )
                write_runner_state(state_file, state)
                print(json.dumps({
                    "status": "failed",
                    "provider": args.provider,
                    "model": model,
                    "execution_mode": args.execution_mode,
                    "output_dir": str(output_dir),
                    "failed_chunk": index,
                    "jobs_scheduled": len(rows),
                    "runner_validation": str(validation_path),
                }, indent=2, sort_keys=True))
                return 1
            write_llm_chunk_runtime_attestations(
                index,
                prepared_rows,
                runtime_attestations,
                args.execution_mode,
                validation_ok=True,
                artifact_paths={
                    "manifest": chunk_manifest,
                    "proposals": proposals,
                    "errors": errors,
                    "final_output": final_output,
                    "direct_api_audit": direct_audit if args.execution_mode == "direct-api" else None,
                },
            )
            runtime_attestation_paths.append(runtime_attestations)
            if args.execution_mode == "direct-api":
                direct_usage_totals = add_direct_usage_totals(direct_usage_totals, direct_audit)
                max_cost = args.direct_max_run_cost_usd
                if max_cost is not None and direct_usage_totals.get("cost", 0.0) > max_cost:
                    cost_guard_path = output_dir / f"{prefix}.direct-api-cost-guard.json"
                    cost_guard_path.write_text(json.dumps({
                        "chunk": index,
                        "status": "stopped",
                        "reported_cost_usd": direct_usage_totals.get("cost", 0.0),
                        "max_run_cost_usd": max_cost,
                        "redaction": "cost guard omits manifest rows, review artifacts, file_ids, proposal rows, and secrets",
                    }, indent=2, sort_keys=True), encoding="utf-8")
                    state["status"] = "stopped"
                    state["stop_reason"] = "direct_max_run_cost_usd"
                    state["direct_usage_totals"] = direct_usage_totals
                    record_chunk_state(
                        state,
                        index,
                        "completed",
                        len(prepared_rows),
                        line_count(proposals),
                        line_count(errors),
                        {
                            "manifest": str(chunk_manifest),
                            "proposals": str(proposals),
                            "errors": str(errors),
                            "final_output": str(final_output),
                            "direct_api_audit": str(direct_audit),
                            "runtime_attestations": str(runtime_attestations),
                            "cost_guard": str(cost_guard_path),
                        },
                        None,
                    )
                    write_runner_state(state_file, state)
                    print(json.dumps({
                        "status": "failed",
                        "provider": args.provider,
                        "model": model,
                        "execution_mode": args.execution_mode,
                        "output_dir": str(output_dir),
                        "failed_chunk": index,
                        "jobs_scheduled": len(rows),
                        "cost_guard": str(cost_guard_path),
                    }, indent=2, sort_keys=True))
                    return 1
            outputs: dict[str, str | None] = {
                "manifest": str(chunk_manifest),
                "proposals": str(proposals),
                "errors": str(errors),
                "final_output": str(final_output),
                "direct_api_audit": str(direct_audit) if args.execution_mode == "direct-api" else None,
                "runtime_attestations": str(runtime_attestations),
            }
            state["direct_usage_totals"] = direct_usage_totals
            record_chunk_state(
                state,
                index,
                "completed",
                len(prepared_rows),
                line_count(proposals),
                line_count(errors),
                outputs,
                None,
            )
            write_runner_state(state_file, state)
            processed_chunks += 1
            if args.max_error_rows is not None and state_error_rows(state) > args.max_error_rows:
                stop_reason = "max_error_rows"
                break
            if args.execution_mode == "direct-api" and index < len(row_chunks) and args.direct_chunk_delay_seconds > 0:
                time.sleep(args.direct_chunk_delay_seconds)
        else:
            processed_chunks += 1

    if stop_reason:
        state["status"] = "stopped"
        state["stop_reason"] = stop_reason
    elif args.execute:
        state["status"] = "completed" if len(completed_chunk_indexes(state)) >= len(row_chunks) else "partial"
        state["stop_reason"] = None if state["status"] == "completed" else "incomplete"
    else:
        state["status"] = "dry_run"
        state["stop_reason"] = None
    state["direct_usage_totals"] = direct_usage_totals
    write_runner_state(state_file, state)

    summary = {
        "status": "partial" if stop_reason else ("executed" if args.execute else "dry_run"),
        "provider": args.provider,
        "model": model,
        "execution_mode": args.execution_mode,
        "auth_profile": auth_profile if args.provider == "spark" else None,
        "reasoning_effort": reasoning_effort if args.execution_mode == "codewith" else None,
        "provider_sort": provider_sort if args.execution_mode == "direct-api" else None,
        "provider_data_collection": "allow" if args.allow_provider_data_collection else "deny",
        "direct_provider_policy": direct_static_policy_attestation(
            args.provider,
            model,
            provider_sort,
            args.allow_provider_data_collection,
            args.timeout_seconds,
            args.direct_retries,
            args.direct_retry_base_seconds,
        ) if args.execution_mode == "direct-api" else None,
        "direct_usage_totals": direct_usage_totals if args.execution_mode == "direct-api" and args.execute else None,
        "runtime_attestation": llm_runtime_attestation_summary(runtime_attestation_paths) if args.execute else {
            "status": "not_executed",
            "jobs": 0,
            "redaction": "runtime attestation is populated only after approved chunk execution",
        },
        "direct_max_run_cost_usd": args.direct_max_run_cost_usd if args.execution_mode == "direct-api" else None,
        "direct_chunk_delay_seconds": args.direct_chunk_delay_seconds if args.execution_mode == "direct-api" else None,
        "sandbox": "bypass" if args.allow_bypass_sandbox else args.sandbox,
        "output_dir": str(output_dir),
        "state_file": str(state_file),
        "jobs_scheduled": len(rows),
        "chunks": len(row_chunks),
        "processed_chunks": processed_chunks,
        "skipped_chunks": skipped_chunks,
        "stop_reason": stop_reason,
        "commands": commands,
        "redaction": "commands do not contain manifest rows, file contents, object keys, or secrets",
    }
    print(json.dumps(summary, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
