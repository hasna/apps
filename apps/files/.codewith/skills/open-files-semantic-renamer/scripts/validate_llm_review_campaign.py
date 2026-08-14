#!/usr/bin/env python3
"""Validate an open-files LLM review campaign plan before execution.

The validator reads private shard manifests to verify coverage and redaction,
but it only prints aggregate counts and issue codes. Do not add row values,
filenames, object keys, source refs, or file IDs to stdout/stderr.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import shlex
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any


RUNNER = ".codewith/skills/open-files-semantic-renamer/scripts/run_llm_review_batch.py"
OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions"
DIRECT_ALLOWED_EGRESS_HOSTS = ("openrouter.ai",)
SENSITIVE_KEYS = {
    "acl",
    "canonical_name",
    "checksum",
    "drive_id",
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
}
SENSITIVE_SUBSTRINGS = (
    "s3://",
    "objects/sha256/",
    "drive.google.com/",
    "docs.google.com/",
)
WORKER_DISALLOWED_ROW_KEYS = SENSITIVE_KEYS - {"file_id"}
SENSITIVE_VALUE_MARKERS = SENSITIVE_SUBSTRINGS


@dataclass(frozen=True)
class Issue:
    code: str
    location: str
    message: str

    def to_json(self) -> dict[str, str]:
        return {"code": self.code, "location": self.location, "message": self.message}


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def text_sha256(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def row_key_digest(rows: list[dict[str, Any]]) -> str:
    keys = sorted({str(key) for row in rows for key in row.keys()})
    return text_sha256("\n".join(keys))


def allowed_row_keys_sha256(worker_allowed_row_keys: Any) -> str | None:
    if not isinstance(worker_allowed_row_keys, list) or not all(isinstance(key, str) for key in worker_allowed_row_keys):
        return None
    return row_key_digest([{key: None for key in worker_allowed_row_keys}])


def count_sensitive_value_markers(value: Any) -> int:
    if isinstance(value, dict):
        return sum(count_sensitive_value_markers(child) for child in value.values())
    if isinstance(value, list):
        return sum(count_sensitive_value_markers(child) for child in value)
    if not isinstance(value, str):
        return 0
    return sum(1 for marker in SENSITIVE_VALUE_MARKERS if marker in value)


def expected_redaction_attestation(
    rows: list[dict[str, Any]],
    manifest_sha256: str,
    sanitized: bool,
    worker_allowed_row_keys: Any,
) -> dict[str, Any]:
    disallowed_key_hits = 0
    private_prefixed_key_hits = 0
    for row in rows:
        for key in row:
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
        "allowed_row_keys_sha256": allowed_row_keys_sha256(worker_allowed_row_keys) if sanitized else None,
        "disallowed_key_hits": disallowed_key_hits,
        "private_prefixed_key_hits": private_prefixed_key_hits,
        "sensitive_value_marker_hits": sensitive_marker_hits,
        "status": "ok" if sanitized and disallowed_key_hits == 0 and private_prefixed_key_hits == 0 and sensitive_marker_hits == 0 else "requires_review",
    }


def compare_redaction_attestation(
    entry_attestation: Any,
    expected: dict[str, Any],
    location: str,
    errors: list[Issue],
) -> dict[str, Any] | None:
    if not isinstance(entry_attestation, dict):
        errors.append(Issue("redaction_attestation_missing", location, "shard redaction attestation is missing"))
        return None
    for key, expected_value in expected.items():
        if entry_attestation.get(key) != expected_value:
            errors.append(Issue("redaction_attestation_mismatch", location, "shard redaction attestation does not match private manifest"))
            break
    return expected


def expected_aggregate_redaction(attestations: list[dict[str, Any]]) -> dict[str, Any]:
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
    }


def load_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise SystemExit(f"invalid campaign plan JSON: {exc}") from exc


def load_jsonl(path: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    with path.open("r", encoding="utf-8") as handle:
        for line_no, line in enumerate(handle, start=1):
            stripped = line.strip()
            if not stripped:
                continue
            try:
                value = json.loads(stripped)
            except json.JSONDecodeError as exc:
                raise SystemExit(f"invalid private shard JSONL at line {line_no}") from exc
            if not isinstance(value, dict):
                raise SystemExit(f"invalid private shard JSONL at line {line_no}: row is not an object")
            rows.append(value)
    return rows


def resolve_path(value: Any, base: Path) -> Path | None:
    if not isinstance(value, str) or not value:
        return None
    path = Path(value).expanduser()
    if not path.is_absolute():
        path = base / path
    return path.resolve()


def is_under(child: Path, parent: Path) -> bool:
    try:
        child.relative_to(parent)
    except ValueError:
        return False
    return True


def sorted_counts(rows: list[dict[str, Any]], field: str) -> dict[str, int]:
    counts: dict[str, int] = {}
    for row in rows:
        key = str(row.get(field) or "unknown")
        counts[key] = counts.get(key, 0) + 1
    return dict(sorted(counts.items()))


def row_summary(rows: list[dict[str, Any]]) -> dict[str, dict[str, int]]:
    return {
        "by_lane": sorted_counts(rows, "extractor_lane"),
        "by_owner": sorted_counts(rows, "owner"),
    }


def expected_schedule_policy(
    entries: list[dict[str, Any]],
    max_campaign_parallel: int,
    default_account_max_parallel: int,
    default_rate_limit_per_minute: int,
) -> dict[str, Any]:
    accounts: dict[str, dict[str, Any]] = {}
    providers: dict[str, dict[str, Any]] = {}
    for entry in entries:
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
    }


def validate_positive_int(value: Any, location: str, field: str, errors: list[Issue]) -> int | None:
    if not isinstance(value, int) or value <= 0:
        errors.append(Issue("invalid_schedule_policy", location, f"{field} must be a positive integer"))
        return None
    return value


def collect_sensitive_values(value: Any, values: set[str], sensitive_context: bool = False) -> None:
    if isinstance(value, dict):
        for key, nested in value.items():
            lowered = str(key).lower()
            next_context = sensitive_context or lowered in SENSITIVE_KEYS or lowered.startswith("private_")
            collect_sensitive_values(nested, values, next_context)
        return
    if isinstance(value, list):
        for nested in value:
            collect_sensitive_values(nested, values, sensitive_context)
        return
    if not isinstance(value, str):
        return

    candidate = value.strip()
    if len(candidate) < 6:
        return
    if sensitive_context or any(marker in candidate for marker in SENSITIVE_SUBSTRINGS):
        values.add(candidate)


def command_flags(command: list[str]) -> dict[str, list[str | None]]:
    flags: dict[str, list[str | None]] = {}
    index = 0
    while index < len(command):
        token = command[index]
        if not token.startswith("--"):
            index += 1
            continue
        if index + 1 < len(command) and not command[index + 1].startswith("--"):
            flags.setdefault(token, []).append(command[index + 1])
            index += 2
        else:
            flags.setdefault(token, []).append(None)
            index += 1
    return flags


def has_flag(command: list[str], flag: str) -> bool:
    return flag in command


def flag_value(flags: dict[str, list[str | None]], flag: str) -> str | None:
    values = flags.get(flag) or []
    for value in values:
        if value is not None:
            return value
    return None


def require_flag(
    errors: list[Issue],
    flags: dict[str, list[str | None]],
    flag: str,
    location: str,
    expected: str | None = None,
) -> None:
    value = flag_value(flags, flag)
    if value is None:
        errors.append(Issue("missing_command_flag", location, f"missing required flag {flag}"))
        return
    if expected is not None and value != expected:
        errors.append(Issue("command_flag_mismatch", location, f"flag {flag} does not match planned value"))


def validate_direct_provider_policy(
    entry: dict[str, Any],
    command: list[str],
    location: str,
    errors: list[Issue],
) -> None:
    policy = entry.get("direct_provider_policy")
    if not isinstance(policy, dict):
        errors.append(Issue("direct_provider_policy_missing", location, "direct provider policy attestation is missing"))
        return
    egress = policy.get("egress")
    payload_policy = policy.get("payload_policy")
    if not isinstance(egress, dict):
        errors.append(Issue("direct_provider_policy_mismatch", location, "direct provider egress policy is missing"))
        return
    if not isinstance(payload_policy, dict):
        errors.append(Issue("direct_provider_policy_mismatch", location, "direct provider payload policy is missing"))
        return

    allows_data_collection = has_flag(command, "--allow-provider-data-collection")
    expected_status = "requires_review" if allows_data_collection else "ok"
    checks = [
        policy.get("status") == expected_status,
        egress.get("mode") == "single-https-provider-gateway",
        egress.get("gateway") == "openrouter-compatible",
        egress.get("allowed_hosts") == list(DIRECT_ALLOWED_EGRESS_HOSTS),
        egress.get("endpoint_host") == "openrouter.ai",
        egress.get("endpoint_path") == "/api/v1/chat/completions",
        egress.get("endpoint_url_sha256") == text_sha256(OPENROUTER_API_URL),
        policy.get("provider_data_collection") == ("allow" if allows_data_collection else "deny"),
        policy.get("provider_data_collection_denied") is (not allows_data_collection),
        payload_policy.get("payload_class") == "sanitized-bounded-review-jobs",
        payload_policy.get("job_identity_policy") == "synthetic-job-ref",
        payload_policy.get("real_file_ids_sent") is False,
        payload_policy.get("review_artifacts_sanitized") is True,
        payload_policy.get("raw_file_bytes_sent") is False,
        payload_policy.get("raw_extracts_sent") is False,
        payload_policy.get("secret_values_sent") is False,
    ]
    if not all(checks):
        errors.append(Issue("direct_provider_policy_mismatch", location, "direct provider policy attestation does not match command safety requirements"))


def validate_command(
    entry: dict[str, Any],
    approved: bool,
    allow_sandbox_bypass: bool,
    plan_root: Path,
    errors: list[Issue],
    warnings: list[Issue],
) -> int:
    location = str(entry.get("shard") or "shard")
    command = entry.get("command")
    if not isinstance(command, list) or not all(isinstance(item, str) for item in command):
        errors.append(Issue("invalid_command", location, "command must be a list of strings"))
        return 0

    execute_count = 1 if has_flag(command, "--execute") else 0
    if len(command) < 2 or command[0] != "python3" or command[1] != RUNNER:
        errors.append(Issue("unexpected_runner_command", location, "command does not target the expected runner"))

    flags = command_flags(command)
    require_flag(errors, flags, "--manifest", location, str(entry.get("manifest") or ""))
    require_flag(errors, flags, "--output-dir", location, str(entry.get("output_dir") or ""))
    require_flag(errors, flags, "--state-file", location, str(entry.get("state_file") or ""))
    require_flag(errors, flags, "--provider", location, str(entry.get("provider_type") or ""))
    require_flag(errors, flags, "--execution-mode", location, str(entry.get("execution_mode") or ""))
    require_flag(errors, flags, "--chunk-size", location)
    require_flag(errors, flags, "--max-chunks", location)
    require_flag(errors, flags, "--max-download-bytes", location)
    require_flag(errors, flags, "--timeout-seconds", location)

    model = entry.get("model")
    if isinstance(model, str) and model:
        require_flag(errors, flags, "--model", location, model)

    if approved and "--execute" not in command:
        errors.append(Issue("approved_command_missing_execute", location, "approved plan command is not executable"))
    if not approved and "--execute" in command:
        errors.append(Issue("unapproved_command_has_execute", location, "unapproved plan command is executable"))
    if "--allow-bypass-sandbox" in command and not allow_sandbox_bypass:
        errors.append(Issue("sandbox_bypass_not_allowed", location, "campaign command bypasses sandbox"))
    if not approved and "--allow-provider-data-collection" in command:
        errors.append(Issue("unapproved_provider_data_collection", location, "unapproved plan allows provider data collection"))

    execution_mode = entry.get("execution_mode")
    if execution_mode == "direct-api":
        require_flag(errors, flags, "--direct-retries", location)
        require_flag(errors, flags, "--direct-max-tokens", location)
        require_flag(errors, flags, "--direct-max-run-cost-usd", location)
        require_flag(errors, flags, "--direct-chunk-delay-seconds", location)
        validate_direct_provider_policy(entry, command, location, errors)
    elif execution_mode == "codewith":
        require_flag(errors, flags, "--reasoning-effort", location)
    else:
        errors.append(Issue("unsupported_execution_mode", location, "execution mode is unsupported"))

    shell = entry.get("shell")
    if isinstance(shell, str) and shell != shlex.join(command):
        warnings.append(Issue("shell_command_out_of_sync", location, "shell string does not match command list"))

    output_dir = resolve_path(entry.get("output_dir"), plan_root)
    state_file = resolve_path(entry.get("state_file"), plan_root)
    if output_dir and not is_under(output_dir, plan_root / "runs"):
        errors.append(Issue("output_dir_outside_campaign", location, "output directory is outside campaign runs directory"))
    if state_file and output_dir and not is_under(state_file, output_dir):
        errors.append(Issue("state_file_outside_output", location, "state file is outside shard output directory"))

    return execute_count


def validate_campaign(
    plan_path: Path,
    allow_existing_state: bool = False,
    allow_sandbox_bypass: bool = False,
    require_sanitized_rows: bool = False,
) -> dict[str, Any]:
    plan_path = plan_path.expanduser().resolve()
    plan_root = plan_path.parent
    plan_text = plan_path.read_text(encoding="utf-8")
    plan = load_json(plan_path)
    if not isinstance(plan, dict):
        raise SystemExit("campaign plan must be a JSON object")

    errors: list[Issue] = []
    warnings: list[Issue] = []
    approved = bool(plan.get("approved"))
    status = plan.get("status")
    if approved and status != "approved":
        errors.append(Issue("approval_status_mismatch", "plan", "approved plan has wrong status"))
    if not approved and status != "approval_required":
        errors.append(Issue("approval_status_mismatch", "plan", "unapproved plan has wrong status"))
    approval_gate = plan.get("approval_gate")
    if not isinstance(approval_gate, dict) or approval_gate.get("required") is not True:
        errors.append(Issue("approval_gate_missing", "plan", "approval gate is missing or disabled"))
    elif bool(approval_gate.get("approved")) != approved:
        errors.append(Issue("approval_gate_mismatch", "plan", "approval gate approved value does not match plan"))
    approval_attestation = plan.get("approval_attestation")
    if not isinstance(approval_attestation, dict):
        errors.append(Issue("approval_attestation_missing", "plan", "approval attestation is missing"))
    else:
        expected_status = "approved" if approved else "approval_required"
        if approval_attestation.get("status") != expected_status:
            errors.append(Issue("approval_attestation_mismatch", "plan", "approval attestation status does not match plan"))
        if bool(approval_attestation.get("approved")) != approved:
            errors.append(Issue("approval_attestation_mismatch", "plan", "approval attestation approved value does not match plan"))
        note_present = approval_attestation.get("approval_note_present") is True
        note_hash = approval_attestation.get("approval_note_sha256")
        if approved and not note_present:
            errors.append(Issue("approved_plan_missing_note", "plan", "approved plan is missing approval note attestation"))
        if isinstance(plan.get("approval_note"), str) and plan.get("approval_note"):
            expected_note_hash = text_sha256(plan["approval_note"])
            if note_hash != expected_note_hash:
                errors.append(Issue("approval_attestation_mismatch", "plan", "approval note hash does not match plan"))
        elif note_present and (not isinstance(note_hash, str) or not re.fullmatch(r"[a-f0-9]{64}", note_hash)):
            errors.append(Issue("approval_attestation_mismatch", "plan", "approval note hash is missing or invalid"))

    manifest_path = resolve_path(plan.get("manifest"), plan_root)
    expected_sha = plan.get("manifest_sha256")
    if manifest_path is None:
        errors.append(Issue("manifest_path_missing", "plan", "manifest path is missing"))
    elif not manifest_path.exists():
        errors.append(Issue("manifest_missing", "plan", "source manifest does not exist"))
    elif isinstance(expected_sha, str) and file_sha256(manifest_path) != expected_sha:
        errors.append(Issue("manifest_sha_mismatch", "plan", "source manifest checksum does not match plan"))

    entries = plan.get("shard_entries")
    if not isinstance(entries, list):
        errors.append(Issue("invalid_shard_entries", "plan", "shard_entries must be a list"))
        entries = []

    all_file_ids: list[str] = []
    sensitive_values: set[str] = set()
    jobs_from_shards = 0
    state_files_existing = 0
    execute_commands = 0
    direct_entry_count = 0
    direct_data_collection_allowed_commands = 0
    provider_types: set[str] = set()
    schedule_entries: list[dict[str, Any]] = []
    aggregate_rows: list[dict[str, Any]] = []
    verified_redaction_attestations: list[dict[str, Any]] = []

    for index, entry in enumerate(entries, start=1):
        location = str(entry.get("shard") or f"shard-{index:04d}") if isinstance(entry, dict) else f"shard-{index:04d}"
        if not isinstance(entry, dict):
            errors.append(Issue("invalid_shard_entry", location, "shard entry must be an object"))
            continue

        provider_type = entry.get("provider_type")
        if isinstance(provider_type, str):
            provider_types.add(provider_type)
        account_ref = entry.get("account_ref")
        if not isinstance(account_ref, str) or not account_ref:
            errors.append(Issue("invalid_schedule_policy", location, "shard entry is missing account_ref"))
        validate_positive_int(entry.get("account_max_parallel"), location, "account_max_parallel", errors)
        validate_positive_int(entry.get("rate_limit_per_minute"), location, "rate_limit_per_minute", errors)
        validate_positive_int(entry.get("schedule_sequence"), location, "schedule_sequence", errors)
        cooldown = entry.get("cooldown_seconds")
        if not isinstance(cooldown, (int, float)) or float(cooldown) < 0:
            errors.append(Issue("invalid_schedule_policy", location, "cooldown_seconds must be a non-negative number"))
        schedule_entries.append(entry)
        command_for_policy = entry.get("command")
        if entry.get("execution_mode") == "direct-api":
            direct_entry_count += 1
            if isinstance(command_for_policy, list) and all(isinstance(item, str) for item in command_for_policy):
                if has_flag(command_for_policy, "--allow-provider-data-collection"):
                    direct_data_collection_allowed_commands += 1

        shard_manifest = resolve_path(entry.get("manifest"), plan_root)
        if shard_manifest is None:
            errors.append(Issue("shard_manifest_missing", location, "shard manifest path is missing"))
            continue
        if not is_under(shard_manifest, plan_root / "shards"):
            errors.append(Issue("shard_manifest_outside_campaign", location, "shard manifest is outside campaign shards directory"))
        if not shard_manifest.exists():
            errors.append(Issue("shard_manifest_not_found", location, "shard manifest does not exist"))
            continue

        shard_sha256 = file_sha256(shard_manifest)
        if entry.get("manifest_sha256") != shard_sha256:
            errors.append(Issue("shard_manifest_sha_mismatch", location, "shard manifest checksum changed"))
        rows = load_jsonl(shard_manifest)
        aggregate_rows.extend(rows)
        jobs_from_shards += len(rows)
        if entry.get("jobs") != len(rows):
            errors.append(Issue("shard_job_count_mismatch", location, "shard job count does not match private manifest"))
        summary = row_summary(rows)
        if entry.get("by_lane") != summary["by_lane"]:
            errors.append(Issue("shard_lane_summary_mismatch", location, "shard lane summary does not match private manifest"))
        if entry.get("by_owner") != summary["by_owner"]:
            errors.append(Issue("shard_owner_summary_mismatch", location, "shard owner summary does not match private manifest"))
        expected_attestation = expected_redaction_attestation(
            rows,
            shard_sha256,
            bool(plan.get("worker_manifest_sanitized")),
            plan.get("worker_allowed_row_keys"),
        )
        verified_attestation = compare_redaction_attestation(
            entry.get("redaction_attestation"),
            expected_attestation,
            location,
            errors,
        )
        if verified_attestation is not None:
            verified_redaction_attestations.append(verified_attestation)

        for row in rows:
            collect_sensitive_values(row, sensitive_values)
            if require_sanitized_rows:
                unsafe_keys = sorted(
                    key
                    for key in row
                    if str(key).lower() in WORKER_DISALLOWED_ROW_KEYS
                    or str(key).lower().startswith("private_")
                )
                if unsafe_keys:
                    errors.append(Issue("unsafe_worker_row_fields", location, "one or more private rows contain fields that must be removed before worker dispatch"))
            file_id = row.get("file_id")
            if isinstance(file_id, str) and file_id:
                all_file_ids.append(file_id)
            else:
                errors.append(Issue("row_missing_file_id", location, "one or more private rows are missing file IDs"))

        state_file = resolve_path(entry.get("state_file"), plan_root)
        if state_file is None:
            errors.append(Issue("state_file_missing", location, "state file path is missing"))
        elif state_file.exists():
            state_files_existing += 1
            if not allow_existing_state:
                errors.append(Issue("state_file_already_exists", location, "state file already exists before campaign execution"))

        execute_commands += validate_command(entry, approved, allow_sandbox_bypass, plan_root, errors, warnings)

    direct_policy = plan.get("direct_provider_policy_attestation")
    if direct_entry_count:
        if not isinstance(direct_policy, dict):
            errors.append(Issue("direct_provider_policy_missing", "plan", "aggregate direct provider policy attestation is missing"))
        else:
            allowed_count = direct_policy.get("provider_data_collection_allowed_count")
            direct_provider_count = direct_policy.get("direct_provider_count")
            expected_status = "requires_review" if allowed_count else "ok"
            checks = [
                direct_policy.get("status") == expected_status,
                isinstance(direct_provider_count, int) and direct_provider_count > 0,
                direct_policy.get("allowed_hosts") == list(DIRECT_ALLOWED_EGRESS_HOSTS),
                direct_policy.get("payload_class") == "sanitized-bounded-review-jobs",
                direct_policy.get("job_identity_policy") == "synthetic-job-ref",
                direct_policy.get("real_file_ids_sent") is False,
                direct_policy.get("raw_file_bytes_sent") is False,
                direct_policy.get("raw_extracts_sent") is False,
                direct_policy.get("secret_values_sent") is False,
            ]
            if direct_data_collection_allowed_commands == 0:
                checks.append(allowed_count == 0)
                checks.append(direct_policy.get("provider_data_collection_denied_by_default") is True)
            elif isinstance(allowed_count, int):
                checks.append(allowed_count > 0)
            else:
                checks.append(False)
            if not all(checks):
                errors.append(Issue("direct_provider_policy_mismatch", "plan", "aggregate direct provider policy attestation does not match shard safety requirements"))
    elif isinstance(direct_policy, dict) and direct_policy.get("status") not in {"not_applicable", "ok"}:
        errors.append(Issue("direct_provider_policy_mismatch", "plan", "aggregate direct provider policy has unexpected status"))

    if plan.get("jobs_planned") != jobs_from_shards:
        errors.append(Issue("jobs_planned_mismatch", "plan", "jobs_planned does not equal private shard job total"))
    if plan.get("shards") != len(entries):
        errors.append(Issue("shard_count_mismatch", "plan", "shard count does not equal shard_entries length"))

    schedule_policy = plan.get("schedule_policy")
    expected_schedule: dict[str, Any] | None = None
    if not isinstance(schedule_policy, dict):
        errors.append(Issue("schedule_policy_missing", "plan", "schedule policy is missing"))
    else:
        max_campaign_parallel = validate_positive_int(schedule_policy.get("max_campaign_parallel"), "plan", "max_campaign_parallel", errors)
        default_account_max_parallel = validate_positive_int(schedule_policy.get("default_account_max_parallel"), "plan", "default_account_max_parallel", errors)
        default_rate_limit_per_minute = validate_positive_int(schedule_policy.get("default_rate_limit_per_minute"), "plan", "default_rate_limit_per_minute", errors)
        if max_campaign_parallel and default_account_max_parallel and default_rate_limit_per_minute:
            expected_schedule = expected_schedule_policy(
                schedule_entries,
                max_campaign_parallel,
                default_account_max_parallel,
                default_rate_limit_per_minute,
            )
            for key in ("status", "max_campaign_parallel", "default_account_max_parallel", "default_rate_limit_per_minute", "accounts", "providers"):
                if schedule_policy.get(key) != expected_schedule[key]:
                    errors.append(Issue("schedule_policy_mismatch", "plan", "schedule policy does not match shard entries"))
                    break

    aggregate = plan.get("aggregate")
    expected_aggregate = row_summary(aggregate_rows)
    if isinstance(aggregate, dict):
        if aggregate.get("by_lane") != expected_aggregate["by_lane"]:
            errors.append(Issue("aggregate_lane_summary_mismatch", "plan", "aggregate lane summary does not match private manifests"))
        if aggregate.get("by_owner") != expected_aggregate["by_owner"]:
            errors.append(Issue("aggregate_owner_summary_mismatch", "plan", "aggregate owner summary does not match private manifests"))
    else:
        errors.append(Issue("aggregate_missing", "plan", "aggregate summary is missing"))

    expected_redaction = expected_aggregate_redaction(verified_redaction_attestations)
    plan_redaction = plan.get("redaction_attestation")
    if not isinstance(plan_redaction, dict):
        errors.append(Issue("redaction_attestation_missing", "plan", "aggregate redaction attestation is missing"))
    else:
        for key, expected_value in expected_redaction.items():
            if plan_redaction.get(key) != expected_value:
                errors.append(Issue("redaction_attestation_mismatch", "plan", "aggregate redaction attestation does not match shard attestations"))
                break

    duplicate_file_ids = len(all_file_ids) - len(set(all_file_ids))
    if duplicate_file_ids:
        errors.append(Issue("duplicate_planned_file_ids", "plan", "private shard manifests contain duplicate file IDs"))

    leaked_sensitive_values = sum(1 for value in sensitive_values if value in plan_text)
    if leaked_sensitive_values:
        errors.append(Issue("plan_leaks_sensitive_row_values", "plan", "plan text contains sensitive private row values"))
    if "s3://" in plan_text or "objects/sha256/" in plan_text:
        errors.append(Issue("plan_contains_object_reference", "plan", "plan text contains an object reference pattern"))

    return {
        "status": "ok" if not errors else "error",
        "plan": str(plan_path),
        "approved": approved,
        "jobs_planned": plan.get("jobs_planned"),
        "jobs_from_shards": jobs_from_shards,
        "shards": len(entries),
        "provider_types": sorted(provider_types),
        "execute_commands": execute_commands,
        "direct_provider_policy": {
            "status": direct_policy.get("status") if isinstance(direct_policy, dict) else None,
            "direct_entry_count": direct_entry_count,
            "provider_data_collection_allowed_commands": direct_data_collection_allowed_commands,
            "job_identity_policy": direct_policy.get("job_identity_policy") if isinstance(direct_policy, dict) else None,
            "real_file_ids_sent": direct_policy.get("real_file_ids_sent") if isinstance(direct_policy, dict) else None,
        },
        "schedule_policy": {
            "status": expected_schedule["status"] if expected_schedule else None,
            "max_campaign_parallel": expected_schedule["max_campaign_parallel"] if expected_schedule else None,
            "accounts": expected_schedule["accounts"] if expected_schedule else [],
            "providers": expected_schedule["providers"] if expected_schedule else [],
        },
        "state_files_existing": state_files_existing,
        "duplicate_file_ids": duplicate_file_ids,
        "sensitive_values_checked": len(sensitive_values),
        "sensitive_value_leaks": leaked_sensitive_values,
        "require_sanitized_rows": require_sanitized_rows,
        "redaction_attestation": {
            "status": expected_redaction["status"],
            "shards": expected_redaction["shards"],
            "rows": expected_redaction["rows"],
            "disallowed_key_hits": expected_redaction["disallowed_key_hits"],
            "private_prefixed_key_hits": expected_redaction["private_prefixed_key_hits"],
            "sensitive_value_marker_hits": expected_redaction["sensitive_value_marker_hits"],
            "attestation_sha256": expected_redaction["attestation_sha256"],
        },
        "errors": [issue.to_json() for issue in errors],
        "warnings": [issue.to_json() for issue in warnings],
        "redaction": "summary omits manifest rows, filenames, object keys, source refs, file IDs, proposal rows, and secrets",
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate a planned LLM review campaign without executing it.")
    parser.add_argument("--plan", required=True, help="Path to campaign-plan.json")
    parser.add_argument(
        "--allow-existing-state",
        action="store_true",
        help="Allow pre-existing runner state files for resume validation",
    )
    parser.add_argument(
        "--allow-sandbox-bypass",
        action="store_true",
        help="Allow legacy pilot commands that bypass Codewith sandbox during validation only",
    )
    parser.add_argument(
        "--require-sanitized-rows",
        action="store_true",
        help="Reject shard rows with worker-unsafe private metadata fields such as source refs, paths, names, object keys, ACLs, or private_* payloads.",
    )
    parser.add_argument("--summary-output", help="Optional path to write redacted validation summary JSON")
    args = parser.parse_args()

    summary = validate_campaign(
        Path(args.plan),
        allow_existing_state=args.allow_existing_state,
        allow_sandbox_bypass=args.allow_sandbox_bypass,
        require_sanitized_rows=args.require_sanitized_rows,
    )
    output = json.dumps(summary, indent=2, sort_keys=True)
    print(output)
    if args.summary_output:
        summary_path = Path(args.summary_output).expanduser().resolve()
        summary_path.parent.mkdir(parents=True, exist_ok=True)
        summary_path.write_text(output + "\n", encoding="utf-8")
    return 0 if summary["status"] == "ok" else 1


if __name__ == "__main__":
    raise SystemExit(main())
