#!/usr/bin/env python3
"""Plan safe multi-provider open-files semantic review campaigns.

This script does not call providers and does not execute workers. It splits a
private review manifest into private shard manifests, assigns shards to an
approved provider pool, and writes redacted runner commands with state files,
cost/rate limits, and explicit approval status.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import shlex
import time
from pathlib import Path
from typing import Any


RUNNER = ".codewith/skills/files-semantic-renamer/scripts/run_llm_review_batch.py"
DEFAULT_MIMO_MODEL = "xiaomi/mimo-v2.5-pro"
DEFAULT_SPARK_MODEL = "gpt-5.3-codex-spark"
OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions"
DIRECT_ALLOWED_EGRESS_HOSTS = ("openrouter.ai",)

WORKER_ALLOWED_ROW_KEYS = {
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
    "review_artifact",
    "review_status",
    "root_type",
    "route",
    "size",
    "storage_provider",
}
WORKER_DISALLOWED_ROW_KEYS = {
    "acl",
    "canonical_name",
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
    "target_path",
}
SENSITIVE_VALUE_MARKERS = (
    "s3://",
    "objects/sha256/",
    "drive.google.com/",
    "docs.google.com/",
)


def now_utc() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def load_jsonl(path: Path, limit: int | None = None) -> list[dict[str, Any]]:
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


def write_jsonl(path: Path, rows: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, sort_keys=True) + "\n")


def sanitize_worker_row(row: dict[str, Any]) -> dict[str, Any]:
    file_id = row.get("file_id")
    if not isinstance(file_id, str) or not file_id:
        raise SystemExit("manifest row missing file_id")
    return {
        key: row.get(key)
        for key in sorted(WORKER_ALLOWED_ROW_KEYS)
        if key in row
    }


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def text_sha256(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def approval_note_info(inline_note: str | None, note_file: str | None) -> dict[str, Any] | None:
    if inline_note and note_file:
        raise SystemExit("--approval-note and --approval-note-file are mutually exclusive")
    if inline_note:
        return {
            "source": "inline",
            "text": inline_note,
            "sha256": text_sha256(inline_note),
            "file": None,
            "file_sha256": None,
            "decision_id": None,
        }
    if not note_file:
        return None
    path = Path(note_file).expanduser().resolve()
    if not path.exists():
        raise SystemExit(f"approval note file not found: {path}")
    text = path.read_text(encoding="utf-8")
    try:
        value = json.loads(text)
    except json.JSONDecodeError:
        return {
            "source": "file_text",
            "text": None,
            "sha256": text_sha256(text),
            "file": str(path),
            "file_sha256": file_sha256(path),
            "decision_id": None,
        }
    if not isinstance(value, dict):
        raise SystemExit("--approval-note-file JSON must be an object")
    if value.get("status") != "approved":
        raise SystemExit("--approval-note-file JSON must have status approved")
    note_text = value.get("approval_note")
    note_hash = value.get("approval_note_sha256")
    if isinstance(note_text, str) and note_text:
        computed_hash = text_sha256(note_text)
        if isinstance(note_hash, str) and note_hash and note_hash != computed_hash:
            raise SystemExit("--approval-note-file approval_note_sha256 does not match approval_note")
        note_hash = computed_hash
    if not isinstance(note_hash, str) or not re.fullmatch(r"[a-f0-9]{64}", note_hash):
        raise SystemExit("--approval-note-file JSON must include approval_note_sha256 or approval_note")
    return {
        "source": "file_json",
        "text": None,
        "sha256": note_hash,
        "file": str(path),
        "file_sha256": file_sha256(path),
        "decision_id": value.get("decision_id") if isinstance(value.get("decision_id"), str) else None,
    }


def row_key_digest(rows: list[dict[str, Any]]) -> str:
    keys = sorted({str(key) for row in rows for key in row.keys()})
    return text_sha256("\n".join(keys))


def count_sensitive_value_markers(value: Any) -> int:
    if isinstance(value, dict):
        return sum(count_sensitive_value_markers(child) for child in value.values())
    if isinstance(value, list):
        return sum(count_sensitive_value_markers(child) for child in value)
    if not isinstance(value, str):
        return 0
    return sum(1 for marker in SENSITIVE_VALUE_MARKERS if marker in value)


def redaction_attestation(rows: list[dict[str, Any]], manifest_sha256: str, sanitized: bool) -> dict[str, Any]:
    disallowed_key_hits = 0
    private_prefixed_key_hits = 0
    for row in rows:
        for key in row.keys():
            lowered = str(key).lower()
            if lowered in WORKER_DISALLOWED_ROW_KEYS:
                disallowed_key_hits += 1
            if lowered.startswith("private_"):
                private_prefixed_key_hits += 1
    sensitive_marker_hits = sum(count_sensitive_value_markers(row) for row in rows)
    return {
        "worker_manifest_sanitized": sanitized,
        "rows": len(rows),
        "manifest_sha256": manifest_sha256,
        "row_keys_sha256": row_key_digest(rows),
        "allowed_row_keys_sha256": row_key_digest([{key: None for key in WORKER_ALLOWED_ROW_KEYS}]) if sanitized else None,
        "disallowed_key_hits": disallowed_key_hits,
        "private_prefixed_key_hits": private_prefixed_key_hits,
        "sensitive_value_marker_hits": sensitive_marker_hits,
        "status": "ok" if sanitized and disallowed_key_hits == 0 and private_prefixed_key_hits == 0 and sensitive_marker_hits == 0 else "requires_review",
        "redaction": "attestation contains counts and hashes only; no row values, filenames, object keys, source refs, or file IDs",
    }


def aggregate_redaction_attestations(attestations: list[dict[str, Any]]) -> dict[str, Any]:
    public_projection = [
        {
            "manifest_sha256": attestation.get("manifest_sha256"),
            "rows": attestation.get("rows"),
            "row_keys_sha256": attestation.get("row_keys_sha256"),
            "status": attestation.get("status"),
        }
        for attestation in attestations
    ]
    return {
        "status": "ok" if all(attestation.get("status") == "ok" for attestation in attestations) else "requires_review",
        "shards": len(attestations),
        "rows": sum(int(attestation.get("rows") or 0) for attestation in attestations),
        "disallowed_key_hits": sum(int(attestation.get("disallowed_key_hits") or 0) for attestation in attestations),
        "private_prefixed_key_hits": sum(int(attestation.get("private_prefixed_key_hits") or 0) for attestation in attestations),
        "sensitive_value_marker_hits": sum(int(attestation.get("sensitive_value_marker_hits") or 0) for attestation in attestations),
        "attestation_sha256": text_sha256(json.dumps(public_projection, sort_keys=True)),
        "redaction": "aggregate attestation contains counts and hashes only; shard manifests remain private",
    }


def chunks(rows: list[dict[str, Any]], size: int) -> list[list[dict[str, Any]]]:
    return [rows[index : index + size] for index in range(0, len(rows), size)]


def default_provider_pool() -> list[dict[str, Any]]:
    return [
        {
            "name": "mimo-direct",
            "provider": "mimo",
            "execution_mode": "direct-api",
            "model": DEFAULT_MIMO_MODEL,
            "enabled": True,
            "weight": 1,
            "chunk_size": 3,
            "max_chunks_per_invocation": 1,
            "direct_max_tokens": 4096,
            "direct_retries": 2,
            "direct_retry_base_seconds": 2.0,
            "direct_max_run_cost_usd": 1.0,
            "direct_chunk_delay_seconds": 0.0,
            "max_error_rows": 0,
            "timeout_seconds": 900,
            "max_download_bytes": 100 * 1024 * 1024,
        }
    ]


def load_provider_pool(path: Path | None) -> list[dict[str, Any]]:
    if path is None:
        return default_provider_pool()
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise SystemExit(f"invalid provider pool JSON: {exc}") from exc
    providers = value.get("providers") if isinstance(value, dict) else value
    if not isinstance(providers, list):
        raise SystemExit("provider pool must be a list or an object with providers")
    return providers


def enabled_provider_ring(providers: list[dict[str, Any]]) -> list[dict[str, Any]]:
    ring: list[dict[str, Any]] = []
    for index, provider in enumerate(providers, start=1):
        if not isinstance(provider, dict):
            raise SystemExit(f"provider entry {index} is not an object")
        if provider.get("enabled", True) is False:
            continue
        name = provider.get("name")
        provider_name = provider.get("provider")
        execution_mode = provider.get("execution_mode", "direct-api")
        if not isinstance(name, str) or not name:
            raise SystemExit(f"provider entry {index} missing name")
        if provider_name not in {"spark", "openrouter", "mimo"}:
            raise SystemExit(f"provider {name} has unsupported provider {provider_name!r}")
        if execution_mode not in {"codewith", "direct-api"}:
            raise SystemExit(f"provider {name} has unsupported execution_mode {execution_mode!r}")
        if execution_mode == "direct-api" and provider_name == "spark":
            raise SystemExit(f"provider {name} cannot use direct-api with Spark")
        weight = provider.get("weight", 1)
        if not isinstance(weight, int) or weight <= 0:
            raise SystemExit(f"provider {name} weight must be a positive integer")
        for _ in range(weight):
            ring.append(provider)
    if not ring:
        raise SystemExit("provider pool has no enabled providers")
    return ring


def provider_model(provider: dict[str, Any]) -> str | None:
    model = provider.get("model")
    if isinstance(model, str) and model:
        return model
    if provider.get("provider") == "spark":
        return DEFAULT_SPARK_MODEL
    if provider.get("provider") == "mimo":
        return DEFAULT_MIMO_MODEL
    return None


def positive_int(value: Any, default: int, field: str, provider_name: str | None = None) -> int:
    candidate = default if value is None else value
    if not isinstance(candidate, int) or candidate <= 0:
        location = f"provider {provider_name}" if provider_name else "campaign"
        raise SystemExit(f"{location} {field} must be a positive integer")
    return candidate


def nonnegative_float(value: Any, default: float, field: str, provider_name: str | None = None) -> float:
    candidate = default if value is None else value
    if not isinstance(candidate, (int, float)) or float(candidate) < 0:
        location = f"provider {provider_name}" if provider_name else "campaign"
        raise SystemExit(f"{location} {field} must be a non-negative number")
    return float(candidate)


def account_ref_for(provider: dict[str, Any]) -> str:
    explicit = provider.get("account_ref") or provider.get("account")
    if isinstance(explicit, str) and explicit:
        return explicit
    execution_mode = provider.get("execution_mode", "direct-api")
    provider_type = provider.get("provider")
    if execution_mode == "codewith":
        auth_profile = provider.get("auth_profile")
        return f"codewith:{auth_profile}" if isinstance(auth_profile, str) and auth_profile else "codewith:default"
    if execution_mode == "direct-api":
        gateway = provider.get("api_gateway", "openrouter")
        key_ref = provider.get("api_key_ref", "default")
        return f"direct-api:{gateway}:{key_ref}"
    return f"{execution_mode}:{provider_type}:default"


def schedule_settings_for(
    provider: dict[str, Any],
    default_account_max_parallel: int,
    default_rate_limit_per_minute: int,
) -> dict[str, Any]:
    name = str(provider.get("name") or "provider")
    return {
        "account_ref": account_ref_for(provider),
        "account_max_parallel": positive_int(provider.get("max_parallel"), default_account_max_parallel, "max_parallel", name),
        "rate_limit_per_minute": positive_int(provider.get("rate_limit_per_minute"), default_rate_limit_per_minute, "rate_limit_per_minute", name),
        "cooldown_seconds": nonnegative_float(provider.get("cooldown_seconds"), float(provider.get("direct_chunk_delay_seconds") or 0.0), "cooldown_seconds", name),
    }


def direct_provider_policy(provider: dict[str, Any]) -> dict[str, Any] | None:
    if provider.get("execution_mode", "direct-api") != "direct-api":
        return None
    allow_data_collection = provider.get("allow_provider_data_collection") is True
    return {
        "status": "ok" if not allow_data_collection else "requires_review",
        "provider": provider.get("name"),
        "provider_type": provider.get("provider"),
        "model": provider_model(provider),
        "egress": {
            "mode": "single-https-provider-gateway",
            "gateway": "openrouter-compatible",
            "allowed_hosts": list(DIRECT_ALLOWED_EGRESS_HOSTS),
            "endpoint_host": "openrouter.ai",
            "endpoint_path": "/api/v1/chat/completions",
            "endpoint_url_sha256": text_sha256(OPENROUTER_API_URL),
            "provider_sort": provider.get("provider_sort", "throughput" if provider.get("provider") == "mimo" else "default"),
        },
        "provider_data_collection": "allow" if allow_data_collection else "deny",
        "provider_data_collection_denied": not allow_data_collection,
        "payload_policy": {
            "payload_class": "sanitized-bounded-review-jobs",
            "job_identity_policy": "synthetic-job-ref",
            "real_file_ids_sent": False,
            "review_artifacts_sanitized": True,
            "raw_file_bytes_sent": False,
            "raw_extracts_sent": False,
            "secret_values_sent": False,
        },
        "redaction": "direct-provider policy contains endpoint class, counts, and booleans only; no payload rows, file IDs, filenames, object keys, source refs, extracted text, proposal rows, or secrets",
    }


def aggregate_direct_provider_policy(providers: list[dict[str, Any]]) -> dict[str, Any]:
    direct_policies = [
        policy
        for provider in providers
        if isinstance(provider, dict) and provider.get("enabled", True) is not False
        for policy in [direct_provider_policy(provider)]
        if policy is not None
    ]
    allowed_count = sum(1 for policy in direct_policies if policy.get("provider_data_collection") == "allow")
    if not direct_policies:
        status = "not_applicable"
    elif allowed_count:
        status = "requires_review"
    else:
        status = "ok"
    return {
        "status": status,
        "direct_provider_count": len(direct_policies),
        "providers": [
            {
                "provider": policy.get("provider"),
                "provider_type": policy.get("provider_type"),
                "model": policy.get("model"),
                "status": policy.get("status"),
                "provider_data_collection": policy.get("provider_data_collection"),
            }
            for policy in direct_policies
        ],
        "allowed_hosts": sorted({
            host
            for policy in direct_policies
            for host in ((policy.get("egress") or {}).get("allowed_hosts") or [])
        }),
        "payload_class": "sanitized-bounded-review-jobs" if direct_policies else None,
        "job_identity_policy": "synthetic-job-ref" if direct_policies else None,
        "real_file_ids_sent": False if direct_policies else None,
        "provider_data_collection_denied_by_default": allowed_count == 0,
        "provider_data_collection_allowed_count": allowed_count,
        "raw_file_bytes_sent": False if direct_policies else None,
        "raw_extracts_sent": False if direct_policies else None,
        "secret_values_sent": False if direct_policies else None,
        "redaction": "aggregate direct-provider policy omits payload rows, file IDs, filenames, object keys, source refs, extracted text, proposal rows, and secrets",
    }


def add_option(cmd: list[str], flag: str, value: Any) -> None:
    if value is not None:
        cmd.extend([flag, str(value)])


def runner_command(
    shard_manifest: Path,
    shard_output: Path,
    state_file: Path,
    provider: dict[str, Any],
    approved: bool,
    cwd: Path,
) -> list[str]:
    provider_name = str(provider["provider"])
    execution_mode = str(provider.get("execution_mode", "direct-api"))
    cmd = [
        "python3",
        RUNNER,
        "--manifest",
        str(shard_manifest),
        "--provider",
        provider_name,
        "--execution-mode",
        execution_mode,
        "--output-dir",
        str(shard_output),
        "--state-file",
        str(state_file),
        "--cwd",
        str(cwd),
        "--limit",
        str(provider.get("limit", 10_000_000)),
        "--chunk-size",
        str(provider.get("chunk_size", 5)),
        "--max-chunks",
        str(provider.get("max_chunks_per_invocation", 1)),
        "--max-download-bytes",
        str(provider.get("max_download_bytes", 100 * 1024 * 1024)),
        "--timeout-seconds",
        str(provider.get("timeout_seconds", 900)),
    ]
    model = provider_model(provider)
    if model:
        cmd.extend(["--model", model])
    if provider.get("resume", True):
        cmd.append("--resume")
    add_option(cmd, "--max-error-rows", provider.get("max_error_rows"))
    if execution_mode == "codewith":
        add_option(cmd, "--auth-profile", provider.get("auth_profile"))
        add_option(cmd, "--reasoning-effort", provider.get("reasoning_effort", "high"))
        add_option(cmd, "--sandbox", provider.get("sandbox", "workspace-write"))
        if provider.get("allow_bypass_sandbox") is True:
            cmd.append("--allow-bypass-sandbox")
    else:
        add_option(cmd, "--provider-sort", provider.get("provider_sort", "throughput" if provider_name == "mimo" else None))
        add_option(cmd, "--direct-max-tokens", provider.get("direct_max_tokens"))
        add_option(cmd, "--direct-temperature", provider.get("direct_temperature"))
        add_option(cmd, "--direct-retries", provider.get("direct_retries"))
        add_option(cmd, "--direct-retry-base-seconds", provider.get("direct_retry_base_seconds"))
        add_option(cmd, "--direct-max-run-cost-usd", provider.get("direct_max_run_cost_usd"))
        add_option(cmd, "--direct-chunk-delay-seconds", provider.get("direct_chunk_delay_seconds"))
        if provider.get("allow_provider_data_collection") is True:
            cmd.append("--allow-provider-data-collection")
    if approved:
        cmd.append("--execute")
    return cmd


def shell_join(cmd: list[str]) -> str:
    return " ".join(shlex.quote(part) for part in cmd)


def summarize_rows(rows: list[dict[str, Any]]) -> dict[str, dict[str, int]]:
    by_lane: dict[str, int] = {}
    by_owner: dict[str, int] = {}
    for row in rows:
        lane = str(row.get("extractor_lane") or "unknown")
        owner = str(row.get("owner") or "unknown")
        by_lane[lane] = by_lane.get(lane, 0) + 1
        by_owner[owner] = by_owner.get(owner, 0) + 1
    return {"by_lane": dict(sorted(by_lane.items())), "by_owner": dict(sorted(by_owner.items()))}


def build_schedule_policy(
    shard_entries: list[dict[str, Any]],
    max_campaign_parallel: int,
    default_account_max_parallel: int,
    default_rate_limit_per_minute: int,
) -> dict[str, Any]:
    accounts: dict[str, dict[str, Any]] = {}
    providers: dict[str, dict[str, Any]] = {}
    for entry in shard_entries:
        account_ref = str(entry.get("account_ref") or "unknown")
        provider = str(entry.get("provider") or "unknown")
        jobs = int(entry.get("jobs") or 0)
        account = accounts.setdefault(account_ref, {
            "account_ref": account_ref,
            "shards": 0,
            "jobs": 0,
            "max_parallel": int(entry.get("account_max_parallel") or default_account_max_parallel),
            "rate_limit_per_minute": int(entry.get("rate_limit_per_minute") or default_rate_limit_per_minute),
        })
        account["shards"] += 1
        account["jobs"] += jobs
        account["max_parallel"] = min(account["max_parallel"], int(entry.get("account_max_parallel") or default_account_max_parallel))
        account["rate_limit_per_minute"] = min(account["rate_limit_per_minute"], int(entry.get("rate_limit_per_minute") or default_rate_limit_per_minute))

        provider_entry = providers.setdefault(provider, {"provider": provider, "shards": 0, "jobs": 0})
        provider_entry["shards"] += 1
        provider_entry["jobs"] += jobs

    return {
        "status": "ok",
        "max_campaign_parallel": max_campaign_parallel,
        "default_account_max_parallel": default_account_max_parallel,
        "default_rate_limit_per_minute": default_rate_limit_per_minute,
        "accounts": sorted(accounts.values(), key=lambda item: item["account_ref"]),
        "providers": sorted(providers.values(), key=lambda item: item["provider"]),
        "rule": "Launcher parallelism must not exceed max_campaign_parallel; account refs default to shared direct-api gateway or Codewith auth profile.",
        "redaction": "schedule policy contains provider/account labels and counts only; no file IDs, filenames, object keys, source refs, proposal rows, or secrets",
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Plan a safe multi-provider LLM review campaign without executing it.")
    parser.add_argument("--manifest", required=True, help="Input review manifest JSONL")
    parser.add_argument("--output-dir", required=True, help="Private campaign planning output directory")
    parser.add_argument("--provider-pool", help="Provider pool JSON file")
    parser.add_argument("--campaign-id", default=time.strftime("campaign-%Y%m%dT%H%M%S"), help="Campaign identifier")
    parser.add_argument("--max-jobs", type=int, help="Maximum manifest jobs to plan")
    parser.add_argument("--jobs-per-shard", type=int, default=10, help="Rows per private shard manifest")
    parser.add_argument("--max-campaign-parallel", type=int, default=1, help="Maximum launcher --parallel allowed for this campaign")
    parser.add_argument("--default-account-max-parallel", type=int, default=1, help="Default max concurrent shards per account_ref")
    parser.add_argument("--default-rate-limit-per-minute", type=int, default=30, help="Default per-account/provider request rate planning cap")
    parser.add_argument("--cwd", default=str(Path.cwd()), help="Repo working directory for runner commands")
    parser.add_argument("--approved", action="store_true", help="Mark commands executable by adding --execute")
    parser.add_argument("--approval-note", help="Required note when --approved is set")
    parser.add_argument("--approval-note-file", help="Private approval note file or JSON artifact used instead of --approval-note")
    parser.add_argument(
        "--include-private-worker-fields",
        action="store_true",
        help="Legacy/debug mode: copy input manifest rows to worker shards without removing private fields. Default writes sanitized worker rows.",
    )
    args = parser.parse_args()

    if args.jobs_per_shard <= 0:
        raise SystemExit("--jobs-per-shard must be positive")
    if args.max_campaign_parallel <= 0:
        raise SystemExit("--max-campaign-parallel must be positive")
    if args.default_account_max_parallel <= 0:
        raise SystemExit("--default-account-max-parallel must be positive")
    if args.default_rate_limit_per_minute <= 0:
        raise SystemExit("--default-rate-limit-per-minute must be positive")
    if args.max_jobs is not None and args.max_jobs < 0:
        raise SystemExit("--max-jobs cannot be negative")
    note_info = approval_note_info(args.approval_note, args.approval_note_file)
    if args.approved and note_info is None:
        raise SystemExit("--approval-note or --approval-note-file is required with --approved")

    manifest = Path(args.manifest).expanduser().resolve()
    output_dir = Path(args.output_dir).expanduser().resolve()
    cwd = Path(args.cwd).expanduser().resolve()
    provider_pool_path = Path(args.provider_pool).expanduser().resolve() if args.provider_pool else None
    source_rows = load_jsonl(manifest, args.max_jobs)
    rows = source_rows if args.include_private_worker_fields else [sanitize_worker_row(row) for row in source_rows]
    provider_pool = load_provider_pool(provider_pool_path)
    ring = enabled_provider_ring(provider_pool)

    shard_dir = output_dir / "shards"
    run_dir = output_dir / "runs"
    shard_rows = chunks(rows, args.jobs_per_shard)
    shard_entries: list[dict[str, Any]] = []
    shard_redaction_attestations: list[dict[str, Any]] = []
    for index, row_chunk in enumerate(shard_rows, start=1):
        provider = ring[(index - 1) % len(ring)]
        provider_label = str(provider["name"])
        shard_id = f"shard-{index:04d}"
        shard_manifest = shard_dir / f"{shard_id}.jsonl"
        write_jsonl(shard_manifest, row_chunk)
        shard_manifest_sha256 = file_sha256(shard_manifest)
        shard_redaction = redaction_attestation(row_chunk, shard_manifest_sha256, not args.include_private_worker_fields)
        shard_redaction_attestations.append(shard_redaction)
        shard_output = run_dir / f"{shard_id}-{provider_label}"
        state_file = shard_output / "runner-state.json"
        schedule_settings = schedule_settings_for(provider, args.default_account_max_parallel, args.default_rate_limit_per_minute)
        cmd = runner_command(shard_manifest, shard_output, state_file, provider, args.approved, cwd)
        row_summary = summarize_rows(row_chunk)
        shard_entries.append({
            "shard": shard_id,
            "jobs": len(row_chunk),
            "provider": provider_label,
            "provider_type": provider.get("provider"),
            "execution_mode": provider.get("execution_mode", "direct-api"),
            "model": provider_model(provider),
            "account_ref": schedule_settings["account_ref"],
            "account_max_parallel": schedule_settings["account_max_parallel"],
            "rate_limit_per_minute": schedule_settings["rate_limit_per_minute"],
            "cooldown_seconds": schedule_settings["cooldown_seconds"],
            "schedule_sequence": index,
            "direct_provider_policy": direct_provider_policy(provider),
            "manifest": str(shard_manifest),
            "manifest_sha256": shard_manifest_sha256,
            "output_dir": str(shard_output),
            "state_file": str(state_file),
            "command": cmd,
            "shell": shell_join(cmd),
            "by_lane": row_summary["by_lane"],
            "by_owner": row_summary["by_owner"],
            "redaction_attestation": shard_redaction,
        })

    campaign = {
        "version": 1,
        "campaign_id": args.campaign_id,
        "created_at": now_utc(),
        "status": "approved" if args.approved else "approval_required",
        "approved": bool(args.approved),
        "approval_note": note_info.get("text") if args.approved and note_info else None,
        "manifest": str(manifest),
        "manifest_sha256": file_sha256(manifest),
        "worker_manifest_sanitized": not args.include_private_worker_fields,
        "worker_allowed_row_keys": sorted(WORKER_ALLOWED_ROW_KEYS) if not args.include_private_worker_fields else None,
        "jobs_planned": len(rows),
        "shards": len(shard_entries),
        "jobs_per_shard": args.jobs_per_shard,
        "provider_pool": [
            {
                "name": provider.get("name"),
                "provider": provider.get("provider"),
                "execution_mode": provider.get("execution_mode", "direct-api"),
                "model": provider_model(provider),
                "enabled": provider.get("enabled", True) is not False,
                "weight": provider.get("weight", 1),
                "account_ref": account_ref_for(provider) if provider.get("enabled", True) is not False else None,
                "max_parallel": provider.get("max_parallel", args.default_account_max_parallel),
                "rate_limit_per_minute": provider.get("rate_limit_per_minute", args.default_rate_limit_per_minute),
            }
            for provider in provider_pool
            if isinstance(provider, dict)
        ],
        "schedule_policy": build_schedule_policy(
            shard_entries,
            args.max_campaign_parallel,
            args.default_account_max_parallel,
            args.default_rate_limit_per_minute,
        ),
        "direct_provider_policy_attestation": aggregate_direct_provider_policy(provider_pool),
        "aggregate": summarize_rows(rows),
        "redaction_attestation": aggregate_redaction_attestations(shard_redaction_attestations),
        "shard_entries": shard_entries,
        "approval_gate": {
            "required": True,
            "approved": bool(args.approved),
            "rule": "Commands include --execute only when --approved and an approval note or approval-note file are provided.",
        },
        "approval_attestation": {
            "status": "approved" if args.approved else "approval_required",
            "approved": bool(args.approved),
            "approval_note_present": bool(note_info),
            "approval_note_sha256": note_info.get("sha256") if note_info else None,
            "approval_note_source": note_info.get("source") if note_info else None,
            "approval_note_file_sha256": note_info.get("file_sha256") if note_info else None,
            "approval_note_decision_id": note_info.get("decision_id") if note_info else None,
            "execute_commands": sum(1 for entry in shard_entries if "--execute" in entry["command"]),
            "rule": "Planner only emits executable shard commands when --approved and an approval note or approval-note file are present.",
            "redaction": "approval note is represented only by SHA-256 when present",
        },
        "redaction": "plan omits manifest rows, file contents, object keys, source refs, proposal rows, and secrets; worker shard manifests are sanitized by default",
    }
    output_dir.mkdir(parents=True, exist_ok=True)
    plan_path = output_dir / "campaign-plan.json"
    plan_path.write_text(json.dumps(campaign, indent=2, sort_keys=True), encoding="utf-8")

    print(json.dumps({
        "status": campaign["status"],
        "campaign_id": args.campaign_id,
        "plan": str(plan_path),
        "jobs_planned": len(rows),
        "shards": len(shard_entries),
        "approved": bool(args.approved),
        "providers": sorted({entry["provider"] for entry in shard_entries}),
        "max_campaign_parallel": args.max_campaign_parallel,
        "redaction": campaign["redaction"],
    }, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
