#!/usr/bin/env python3
"""Collect and validate aggregate results for an LLM review campaign.

This script reads private shard manifests and runner state files, merges
proposal/error rows into private aggregate files, validates proposals, and
prints only aggregate status. It does not apply metadata.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
from pathlib import Path
from typing import Any


VALIDATOR = Path(__file__).resolve().parent / "validate_metadata_proposals.py"


def load_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise SystemExit(f"invalid JSON file: {path}") from exc
    if not isinstance(value, dict):
        raise SystemExit(f"invalid JSON file: {path}")
    return value


def load_jsonl(path: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    if not path.exists():
        return rows
    with path.open("r", encoding="utf-8") as handle:
        for line_no, line in enumerate(handle, start=1):
            stripped = line.strip()
            if not stripped:
                continue
            try:
                value = json.loads(stripped)
            except json.JSONDecodeError:
                rows.append({"_collector_error": "invalid_json", "_line": line_no})
                continue
            if isinstance(value, dict):
                rows.append(value)
            else:
                rows.append({"_collector_error": "row_not_object", "_line": line_no})
    return rows


def write_jsonl(path: Path, rows: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, sort_keys=True) + "\n")


def resolve_path(value: Any, base: Path) -> Path | None:
    if not isinstance(value, str) or not value:
        return None
    path = Path(value).expanduser()
    if not path.is_absolute():
        path = base / path
    return path.resolve()


def file_ids(rows: list[dict[str, Any]]) -> list[str]:
    ids: list[str] = []
    for row in rows:
        value = row.get("file_id")
        if isinstance(value, str) and value:
            ids.append(value)
    return ids


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


def expected_runtime_ref(shard: str, chunk_ref: str, job_ref: str) -> str:
    return "\0".join((shard, chunk_ref, job_ref))


def chunk_ref_for_key(value: Any) -> str:
    if isinstance(value, int):
        return f"chunk-{value:04d}"
    if isinstance(value, str) and value.isdigit():
        return f"chunk-{int(value):04d}"
    if isinstance(value, str) and value:
        return value
    return "chunk-unknown"


def manifest_by_file_id(rows: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    by_id: dict[str, dict[str, Any]] = {}
    for row in rows:
        file_id = row.get("file_id")
        if isinstance(file_id, str) and file_id:
            by_id[file_id] = row
    return by_id


def expected_extension(row: dict[str, Any] | None) -> str | None:
    if not row:
        return None
    for key in ("expected_ext", "ext"):
        value = row.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip().lower().lstrip(".")
    mime = str(row.get("mime") or "").split(";")[0].lower()
    return {
        "application/pdf": "pdf",
        "image/jpeg": "jpg",
        "image/png": "png",
        "image/gif": "gif",
        "text/plain": "txt",
        "text/csv": "csv",
        "application/json": "json",
        "application/zip": "zip",
    }.get(mime)


def path_rows(path_value: Any, base: Path) -> list[dict[str, Any]]:
    path = resolve_path(path_value, base)
    if path is None:
        return []
    return load_jsonl(path)


def collect_entry(entry: dict[str, Any], plan_root: Path) -> dict[str, Any]:
    shard = str(entry.get("shard") or "shard")
    shard_manifest = resolve_path(entry.get("manifest"), plan_root)
    manifest_rows = load_jsonl(shard_manifest) if shard_manifest else []
    state_file = resolve_path(entry.get("state_file"), plan_root)
    result: dict[str, Any] = {
        "shard": shard,
        "jobs_planned": len(manifest_rows),
        "provider": entry.get("provider"),
        "provider_type": entry.get("provider_type"),
        "execution_mode": entry.get("execution_mode"),
        "state_status": "missing",
        "proposal_rows": 0,
        "error_rows": 0,
        "runtime_attestation_rows": 0,
        "chunks_total": 0,
        "completed_chunks": 0,
        "missing_state": False,
        "manifest_rows": manifest_rows,
        "proposals": [],
        "errors": [],
        "runtime_attestations": [],
        "expected_runtime_attestations": [],
        "expected_runtime_manifest_errors": 0,
    }
    if state_file is None or not state_file.exists():
        result["missing_state"] = True
        return result

    state = load_json(state_file)
    chunks = state.get("chunks")
    completed_chunks = state.get("completed_chunks")
    result["state_status"] = state.get("status") if isinstance(state.get("status"), str) else "unknown"
    result["chunks_total"] = int(state.get("chunks_total") or 0) if isinstance(state.get("chunks_total"), int) else 0
    result["completed_chunks"] = len(completed_chunks) if isinstance(completed_chunks, list) else 0
    result["direct_usage_totals"] = state.get("direct_usage_totals") if isinstance(state.get("direct_usage_totals"), dict) else None

    if isinstance(chunks, dict):
        for chunk_key, chunk in chunks.items():
            if not isinstance(chunk, dict):
                continue
            outputs = chunk.get("outputs")
            if not isinstance(outputs, dict):
                continue
            chunk_ref = chunk_ref_for_key(chunk_key)
            chunk_manifest_rows = path_rows(outputs.get("manifest"), plan_root)
            jobs = chunk.get("jobs")
            expected_jobs = len(chunk_manifest_rows)
            if isinstance(jobs, int) and jobs >= 0:
                if expected_jobs == 0 and jobs > 0:
                    result["expected_runtime_manifest_errors"] += 1
                    expected_jobs = jobs
                elif expected_jobs != jobs:
                    result["expected_runtime_manifest_errors"] += 1
            for job_index in range(1, expected_jobs + 1):
                row = chunk_manifest_rows[job_index - 1] if job_index <= len(chunk_manifest_rows) else None
                job_ref = f"job-{job_index:06d}"
                result["expected_runtime_attestations"].append({
                    "ref": expected_runtime_ref(shard, chunk_ref, job_ref),
                    "source_identity_sha256": hash_file_ids([row]) if isinstance(row, dict) else None,
                })
            proposal_rows = path_rows(outputs.get("proposals"), plan_root)
            error_rows = path_rows(outputs.get("errors"), plan_root)
            runtime_rows = path_rows(outputs.get("runtime_attestations"), plan_root)
            for row in runtime_rows:
                row["_collector_shard"] = shard
            result["proposals"].extend(proposal_rows)
            result["errors"].extend(error_rows)
            result["runtime_attestations"].extend(runtime_rows)
    result["proposal_rows"] = len(result["proposals"])
    result["error_rows"] = len(result["errors"])
    result["runtime_attestation_rows"] = len(result["runtime_attestations"])
    return result


def coverage_counts(scheduled_ids: list[str], proposal_ids: list[str], error_ids: list[str]) -> dict[str, int]:
    scheduled = set(scheduled_ids)
    observed_ids = proposal_ids + error_ids
    observed = set(observed_ids)
    return {
        "scheduled": len(scheduled_ids),
        "scheduled_unique": len(scheduled),
        "proposals": len(proposal_ids),
        "errors": len(error_ids),
        "observed": len(observed_ids),
        "observed_unique": len(observed),
        "missing": len(scheduled - observed),
        "extra": len(observed - scheduled),
        "duplicate_outputs": len(observed_ids) - len(observed),
        "duplicate_scheduled": len(scheduled_ids) - len(scheduled),
    }


def validate_proposals(
    proposals: Path,
    manifest: Path,
    errors_output: Path,
    skip_db_check: bool,
) -> dict[str, Any]:
    if not proposals.exists() or proposals.stat().st_size == 0:
        return {"status": "skipped", "rows": 0, "errors": 0, "errors_output": str(errors_output)}
    cmd = [
        "python3",
        str(VALIDATOR),
        str(proposals),
        "--errors-output",
        str(errors_output),
        "--manifest",
        str(manifest),
        "--require-review",
    ]
    if skip_db_check:
        cmd.append("--skip-db-check")
    proc = subprocess.run(cmd, check=False, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    try:
        summary = json.loads(proc.stdout)
    except json.JSONDecodeError:
        summary = {"status": "invalid", "rows": None, "errors": None}
    return {
        "status": summary.get("status", "invalid"),
        "rows": summary.get("rows"),
        "errors": summary.get("errors"),
        "duplicate_target_paths": summary.get("duplicate_target_paths"),
        "duplicate_file_ids": summary.get("duplicate_file_ids"),
        "errors_output": str(errors_output),
        "returncode": proc.returncode,
    }


def rename_correctness_gate(
    manifest_rows: list[dict[str, Any]],
    proposal_rows: list[dict[str, Any]],
    error_rows: list[dict[str, Any]],
    coverage: dict[str, int],
    proposal_validation: dict[str, Any],
    runtime_gate: dict[str, Any],
) -> dict[str, Any]:
    manifest = manifest_by_file_id(manifest_rows)
    confidence_counts = {"high": 0, "medium": 0, "low": 0, "unknown": 0}
    canonical_name_rows = 0
    target_path_rows = 0
    basename_match_rows = 0
    extension_expected_rows = 0
    extension_preserved_rows = 0
    requires_review_rows = 0
    low_confidence_requires_review_violations = 0
    reason_present_rows = 0

    for row in proposal_rows:
        canonical_name = row.get("canonical_name")
        target_path = row.get("target_path")
        if isinstance(canonical_name, str) and canonical_name:
            canonical_name_rows += 1
        if isinstance(target_path, str) and target_path:
            target_path_rows += 1
        if isinstance(canonical_name, str) and isinstance(target_path, str) and target_path.split("/")[-1] == canonical_name:
            basename_match_rows += 1
        file_id = row.get("file_id")
        ext = expected_extension(manifest.get(file_id) if isinstance(file_id, str) else None)
        if ext:
            extension_expected_rows += 1
            if isinstance(canonical_name, str) and canonical_name.endswith(f".{ext}"):
                extension_preserved_rows += 1
        confidence = row.get("confidence")
        if confidence in {"high", "medium", "low"}:
            confidence_counts[str(confidence)] += 1
        else:
            confidence_counts["unknown"] += 1
        requires_review = row.get("requires_review")
        if requires_review is True:
            requires_review_rows += 1
        if confidence == "low" and requires_review is not True:
            low_confidence_requires_review_violations += 1
        if isinstance(row.get("reason"), str) and row.get("reason"):
            reason_present_rows += 1

    coverage_complete = not any(
        coverage.get(key, 0)
        for key in ("missing", "extra", "duplicate_outputs", "duplicate_scheduled")
    )
    schema_valid = proposal_validation.get("status") == "valid"
    error_free = len(error_rows) == 0
    all_rows_have_names = canonical_name_rows == len(proposal_rows) and target_path_rows == len(proposal_rows)
    all_basenames_match = basename_match_rows == len(proposal_rows)
    all_extensions_preserved = extension_preserved_rows == extension_expected_rows
    all_require_review = requires_review_rows == len(proposal_rows)
    all_reasons_present = reason_present_rows == len(proposal_rows)
    no_duplicate_names = not proposal_validation.get("duplicate_target_paths") and not proposal_validation.get("duplicate_file_ids")
    runtime_attestation_complete = runtime_gate.get("status") == "ok"
    ready = all([
        len(proposal_rows) > 0 or coverage.get("scheduled", 0) == 0,
        coverage_complete,
        schema_valid,
        runtime_attestation_complete,
        error_free,
        all_rows_have_names,
        all_basenames_match,
        all_extensions_preserved,
        all_require_review,
        all_reasons_present,
        no_duplicate_names,
        low_confidence_requires_review_violations == 0,
    ])
    if ready:
        status = "ok"
    elif not proposal_rows and coverage.get("scheduled", 0) and coverage.get("observed", 0) == 0:
        status = "pending"
    else:
        status = "blocked"
    return {
        "status": status,
        "coverage_complete": coverage_complete,
        "schema_valid": schema_valid,
        "runtime_attestation_complete": runtime_attestation_complete,
        "runtime_attestation_gate_status": runtime_gate.get("status"),
        "requires_runtime_attestation_gate_ok": True,
        "error_free": error_free,
        "proposal_rows": len(proposal_rows),
        "error_rows": len(error_rows),
        "canonical_name_rows": canonical_name_rows,
        "target_path_rows": target_path_rows,
        "basename_match_rows": basename_match_rows,
        "extension_expected_rows": extension_expected_rows,
        "extension_preserved_rows": extension_preserved_rows,
        "requires_review_rows": requires_review_rows,
        "reason_present_rows": reason_present_rows,
        "confidence": confidence_counts,
        "duplicate_target_paths": proposal_validation.get("duplicate_target_paths"),
        "duplicate_file_ids": proposal_validation.get("duplicate_file_ids"),
        "low_confidence_requires_review_violations": low_confidence_requires_review_violations,
        "metadata_apply_ready": False,
        "metadata_apply_blocker": (
            "runtime attestation gate not ok; proposals require human review before metadata apply"
            if proposal_rows and not runtime_attestation_complete
            else "proposals require human review before metadata apply"
            if proposal_rows
            else "no proposals collected"
        ),
        "redaction": "rename correctness gate reports counts only; no file IDs, filenames, target paths, proposal rows, or private values",
    }


def runtime_attestation_gate(
    attestation_rows: list[dict[str, Any]],
    expected_refs: list[dict[str, Any]],
    planned_outputs: int,
    expected_manifest_errors: int,
) -> dict[str, Any]:
    statuses: dict[str, int] = {}
    immutable_count = 0
    metadata_only_count = 0
    provider_payload_policy_count = 0
    provider_payload_policy_violations = 0
    metadata_apply_attempted = 0
    search_index_write_attempted = 0
    source_write_attempted = 0
    s3_mutation_attempted = 0
    validation_ok_count = 0
    requires_review_before_apply_count = 0
    source_identity_matched_count = 0
    invalid_rows = 0
    required_field_errors = 0
    source_identity_mismatches = 0
    safety_count_violations = 0
    observed_refs: list[str] = []
    expected_by_ref = {
        str(row.get("ref")): row
        for row in expected_refs
        if isinstance(row.get("ref"), str) and row.get("ref")
    }
    for row in attestation_rows:
        if row.get("_collector_error"):
            invalid_rows += 1
            continue
        shard = row.get("_collector_shard")
        chunk_ref = row.get("chunk_ref")
        job_ref = row.get("job_ref")
        if not isinstance(shard, str) or not isinstance(chunk_ref, str) or not isinstance(job_ref, str):
            required_field_errors += 1
        else:
            ref = expected_runtime_ref(shard, chunk_ref, job_ref)
            observed_refs.append(ref)
            expected = expected_by_ref.get(ref)
            expected_hash = expected.get("source_identity_sha256") if isinstance(expected, dict) else None
            actual_hash = row.get("source_identity_sha256")
            if isinstance(expected_hash, str) and expected_hash:
                if actual_hash == expected_hash:
                    source_identity_matched_count += 1
                else:
                    source_identity_mismatches += 1
        if row.get("kind") != "open_files_llm_job_runtime_attestation" or row.get("version") != 1:
            required_field_errors += 1
        if row.get("source_identity_disclosure") != "hash-only":
            required_field_errors += 1
        status = str(row.get("status") or "unknown")
        statuses[status] = statuses.get(status, 0) + 1
        provider_policy = row.get("provider_payload_policy") if isinstance(row.get("provider_payload_policy"), dict) else {}
        canonical_policy = row.get("canonical_bytes_policy") if isinstance(row.get("canonical_bytes_policy"), dict) else {}
        write_policy = row.get("write_policy") if isinstance(row.get("write_policy"), dict) else {}
        validation = row.get("validation") if isinstance(row.get("validation"), dict) else {}
        row_safety_counts = row.get("row_safety_counts") if isinstance(row.get("row_safety_counts"), dict) else {}
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
        if validation.get("worker_output_validation_ok") is True:
            validation_ok_count += 1
        if validation.get("requires_human_review_before_apply") is True:
            requires_review_before_apply_count += 1
        if any(isinstance(value, int) and value != 0 for value in row_safety_counts.values()):
            safety_count_violations += 1
        if write_policy.get("metadata_apply_attempted") is True:
            metadata_apply_attempted += 1
        if write_policy.get("search_index_write_attempted") is True:
            search_index_write_attempted += 1
        if write_policy.get("source_byte_write_attempted") is True:
            source_write_attempted += 1
        if canonical_policy.get("s3_mutation_attempted_by_runner") is True:
            s3_mutation_attempted += 1

    expected_outputs = len(expected_by_ref)
    observed_unique = set(observed_refs)
    expected_unique = set(expected_by_ref)
    missing = len(expected_unique - observed_unique)
    extra = len(observed_unique - expected_unique)
    duplicate_refs = len(observed_refs) - len(observed_unique)
    ok = (
        expected_outputs > 0
        and missing == 0
        and extra == 0
        and duplicate_refs == 0
        and invalid_rows == 0
        and required_field_errors == 0
        and expected_manifest_errors == 0
        and source_identity_mismatches == 0
        and safety_count_violations == 0
        and statuses.get("requires_review", 0) == 0
        and statuses.get("ok", 0) == expected_outputs
        and provider_payload_policy_count == expected_outputs
        and provider_payload_policy_violations == 0
        and immutable_count == expected_outputs
        and metadata_only_count == expected_outputs
        and validation_ok_count == expected_outputs
        and requires_review_before_apply_count == expected_outputs
        and source_identity_matched_count == expected_outputs
        and metadata_apply_attempted == 0
        and search_index_write_attempted == 0
        and source_write_attempted == 0
        and s3_mutation_attempted == 0
    )
    if ok:
        status = "ok"
    elif expected_outputs == 0 and len(attestation_rows) == 0 and expected_manifest_errors == 0:
        status = "pending"
    else:
        status = "blocked"
    return {
        "status": status,
        "planned_outputs": planned_outputs,
        "expected_outputs": expected_outputs,
        "attestation_rows": len(attestation_rows),
        "missing_attestations": missing,
        "extra_attestations": extra,
        "duplicate_attestation_refs": duplicate_refs,
        "expected_manifest_errors": expected_manifest_errors,
        "invalid_attestation_rows": invalid_rows,
        "required_field_errors": required_field_errors,
        "source_identity_matched_rows": source_identity_matched_count,
        "source_identity_mismatches": source_identity_mismatches,
        "worker_output_validation_ok_rows": validation_ok_count,
        "requires_review_before_apply_rows": requires_review_before_apply_count,
        "row_safety_count_violation_rows": safety_count_violations,
        "statuses": dict(sorted(statuses.items())),
        "provider_payload_policy_attested_rows": provider_payload_policy_count,
        "provider_payload_policy_violation_rows": provider_payload_policy_violations,
        "immutable_bytes_attested_rows": immutable_count,
        "metadata_only_attested_rows": metadata_only_count,
        "metadata_apply_attempted_rows": metadata_apply_attempted,
        "search_index_write_attempted_rows": search_index_write_attempted,
        "source_byte_write_attempted_rows": source_write_attempted,
        "s3_mutation_attempted_rows": s3_mutation_attempted,
        "redaction": "runtime attestation gate reports counts only; no file IDs, filenames, target paths, proposal rows, object keys, source refs, or private values",
    }


def scale_readiness_attestation(
    plan: dict[str, Any],
    status: str,
    coverage: dict[str, int],
    rename_gate: dict[str, Any],
    runtime_gate: dict[str, Any],
) -> dict[str, Any]:
    planned_jobs = int(plan.get("jobs_planned") or 0)
    observed_jobs = int(coverage.get("observed_unique") or 0)
    rename_ok = rename_gate.get("status") == "ok"
    runtime_ok = runtime_gate.get("status") == "ok"
    canary_verified = status == "complete" and observed_jobs > 0 and rename_ok and runtime_ok
    full_verified = (
        status == "complete"
        and planned_jobs > 0
        and observed_jobs >= planned_jobs
        and int(coverage.get("missing") or 0) == 0
        and rename_ok
        and runtime_ok
    )
    canary_scope = observed_jobs > 0 and (planned_jobs == 0 or observed_jobs < planned_jobs)
    return {
        "status": "full_run_verified" if full_verified else "canary_verified" if canary_verified else "pending_canary" if observed_jobs == 0 else "blocked",
        "planned_jobs": planned_jobs,
        "observed_jobs": observed_jobs,
        "canary": {
            "scope": "canary" if canary_scope else "full-run-candidate" if observed_jobs >= planned_jobs and planned_jobs > 0 else "none",
            "verified": canary_verified,
            "requires_operator_approval": True,
            "rename_gate_status": rename_gate.get("status"),
            "runtime_attestation_gate_status": runtime_gate.get("status"),
        },
        "full_run": {
            "verified": full_verified,
            "requires_canary_verified_first": True,
            "requires_all_planned_jobs_observed": True,
            "requires_rename_gate_ok": True,
            "requires_runtime_attestation_gate_ok": True,
            "remaining_jobs": max(0, planned_jobs - observed_jobs),
        },
        "redaction": "scale readiness attestation contains counts and booleans only; no file IDs, filenames, target paths, proposal rows, object keys, source refs, or private values",
    }


def derive_status(
    shard_summaries: list[dict[str, Any]],
    coverage: dict[str, int],
    proposal_validation: dict[str, Any],
    require_complete: bool,
) -> tuple[str, int]:
    missing_state = sum(1 for shard in shard_summaries if shard.get("missing_state"))
    incomplete = sum(1 for shard in shard_summaries if shard.get("state_status") not in {"completed"} and not shard.get("missing_state"))
    coverage_bad = any(coverage[key] for key in ("missing", "extra", "duplicate_outputs", "duplicate_scheduled"))
    validation_bad = proposal_validation.get("status") == "invalid"
    if missing_state == len(shard_summaries):
        return ("not_started", 1 if require_complete else 0)
    if missing_state or incomplete:
        return ("incomplete", 1 if require_complete else 0)
    if coverage_bad or validation_bad:
        return ("invalid", 1)
    return ("complete", 0)


def main() -> int:
    parser = argparse.ArgumentParser(description="Collect aggregate LLM review campaign outputs without applying metadata.")
    parser.add_argument("--plan", required=True, help="Path to campaign-plan.json")
    parser.add_argument("--output-dir", help="Private output directory for aggregate result artifacts")
    parser.add_argument("--require-complete", action="store_true", help="Fail unless every shard is complete and coverage-valid")
    parser.add_argument("--skip-db-check", action="store_true", help="Skip DB uniqueness check during proposal validation")
    args = parser.parse_args()

    plan_path = Path(args.plan).expanduser().resolve()
    plan_root = plan_path.parent
    output_dir = Path(args.output_dir).expanduser().resolve() if args.output_dir else plan_root / "collected-results"
    plan = load_json(plan_path)
    entries = [entry for entry in plan.get("shard_entries", []) if isinstance(entry, dict)]
    shard_results = [collect_entry(entry, plan_root) for entry in entries]

    manifest_rows: list[dict[str, Any]] = []
    proposal_rows: list[dict[str, Any]] = []
    error_rows: list[dict[str, Any]] = []
    runtime_attestation_rows: list[dict[str, Any]] = []
    expected_runtime_attestation_rows: list[dict[str, Any]] = []
    expected_runtime_manifest_errors = 0
    shard_summaries: list[dict[str, Any]] = []
    for result in shard_results:
        manifest_rows.extend(result.pop("manifest_rows"))
        proposal_rows.extend(result.pop("proposals"))
        error_rows.extend(result.pop("errors"))
        runtime_attestation_rows.extend(result.pop("runtime_attestations"))
        expected_runtime_attestation_rows.extend(result.pop("expected_runtime_attestations"))
        expected_runtime_manifest_errors += int(result.pop("expected_runtime_manifest_errors") or 0)
        shard_summaries.append(result)

    output_dir.mkdir(parents=True, exist_ok=True)
    combined_manifest = output_dir / "campaign.manifest.jsonl"
    combined_proposals = output_dir / "campaign.proposals.jsonl"
    combined_errors = output_dir / "campaign.errors.jsonl"
    proposal_validation_errors = output_dir / "campaign.proposal-validation-errors.jsonl"
    write_jsonl(combined_manifest, manifest_rows)
    write_jsonl(combined_proposals, proposal_rows)
    write_jsonl(combined_errors, error_rows)

    coverage = coverage_counts(file_ids(manifest_rows), file_ids(proposal_rows), file_ids(error_rows))
    proposal_validation = validate_proposals(
        combined_proposals,
        combined_manifest,
        proposal_validation_errors,
        args.skip_db_check,
    )
    status, exit_code = derive_status(shard_summaries, coverage, proposal_validation, args.require_complete)
    runtime_gate = runtime_attestation_gate(
        runtime_attestation_rows,
        expected_runtime_attestation_rows,
        len(manifest_rows),
        expected_runtime_manifest_errors,
    )
    rename_gate = rename_correctness_gate(
        manifest_rows,
        proposal_rows,
        error_rows,
        coverage,
        proposal_validation,
        runtime_gate,
    )
    if status == "complete" and rename_gate["status"] != "ok":
        status = "invalid"
        exit_code = 1
    if status == "complete" and runtime_gate["status"] != "ok":
        status = "invalid"
        exit_code = 1
    scale_gate = scale_readiness_attestation(plan, status, coverage, rename_gate, runtime_gate)
    summary = {
        "status": status,
        "approved": bool(plan.get("approved")),
        "jobs_planned": plan.get("jobs_planned"),
        "shards": len(entries),
        "shard_states": {
            "missing": sum(1 for shard in shard_summaries if shard.get("missing_state")),
            "completed": sum(1 for shard in shard_summaries if shard.get("state_status") == "completed"),
            "incomplete": sum(1 for shard in shard_summaries if shard.get("state_status") not in {"completed", "missing"} and not shard.get("missing_state")),
        },
        "proposal_rows": len(proposal_rows),
        "error_rows": len(error_rows),
        "runtime_attestation_rows": len(runtime_attestation_rows),
        "expected_runtime_attestation_rows": len(expected_runtime_attestation_rows),
        "coverage": coverage,
        "proposal_validation": proposal_validation,
        "rename_correctness_gate": rename_gate,
        "runtime_attestation_gate": runtime_gate,
        "scale_readiness_attestation": scale_gate,
        "artifacts": {
            "manifest": str(combined_manifest),
            "proposals": str(combined_proposals),
            "errors": str(combined_errors),
            "proposal_validation_errors": str(proposal_validation_errors),
        },
        "shards_summary": [
            {
                "shard": shard.get("shard"),
                "jobs_planned": shard.get("jobs_planned"),
                "state_status": shard.get("state_status"),
                "proposal_rows": shard.get("proposal_rows"),
                "error_rows": shard.get("error_rows"),
                "runtime_attestation_rows": shard.get("runtime_attestation_rows"),
                "completed_chunks": shard.get("completed_chunks"),
                "chunks_total": shard.get("chunks_total"),
                "provider": shard.get("provider"),
                "provider_type": shard.get("provider_type"),
                "execution_mode": shard.get("execution_mode"),
            }
            for shard in shard_summaries
        ],
        "redaction": "summary omits manifest row payloads, filenames, object keys, source refs, file IDs, proposal row payloads, validation row payloads, and secrets",
    }
    summary_path = output_dir / "campaign-results-summary.json"
    summary_path.write_text(json.dumps(summary, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps(summary, indent=2, sort_keys=True))
    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())
