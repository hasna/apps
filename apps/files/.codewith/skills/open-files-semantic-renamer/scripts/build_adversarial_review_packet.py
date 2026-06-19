#!/usr/bin/env python3
"""Build aggregate-safe packets for adversarial open-files review agents.

The packet is for reviewing migration/indexing/renaming process safety, not for
reviewing individual private files. It intentionally excludes filenames, file
IDs, object keys, source refs, extracted text, transcripts, ACL payloads, and
row payloads.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
import time
from pathlib import Path
from typing import Any


DEFAULT_OUTPUT_DIR = ".codewith/private-artifacts/adversarial-review"

SENSITIVE_PATTERNS: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("json_file_id_key", re.compile(r'"file_id"\s*:')),
    ("private_file_id_value", re.compile(r'\bf_[A-Za-z0-9][A-Za-z0-9_-]{5,}\b')),
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

PROMPT_PREAMBLE = """\
You are an adversarial reviewer for the open-files migration system.

You must review only the aggregate packet files in this directory. Do not inspect
the repository, SQLite databases, S3 objects, private manifests, filenames,
file IDs, object keys, source refs, extracted text, transcripts, ACL payloads,
or row payloads. Treat the corpus as private. Your answer must follow the JSON
schema exactly and must not include private values.
"""


def now_utc() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise SystemExit(f"invalid JSON artifact: {path}") from exc
    if not isinstance(value, dict):
        raise SystemExit(f"invalid JSON object artifact: {path}")
    return value


def optional_json(path: Path | None) -> dict[str, Any] | None:
    if path is None:
        return None
    if not path.exists():
        return None
    return load_json(path)


def scan_text(text: str) -> dict[str, int]:
    counts: dict[str, int] = {}
    for code, pattern in SENSITIVE_PATTERNS:
        count = len(pattern.findall(text))
        if count:
            counts[code] = count
    return counts


def canonical_json_text(value: dict[str, Any]) -> str:
    return json.dumps(value, indent=2, sort_keys=True) + "\n"


def text_sha256(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def scan_file(path: Path) -> dict[str, int]:
    try:
        return scan_text(path.read_text(encoding="utf-8"))
    except UnicodeDecodeError:
        return {"non_utf8_artifact": 1}


def source_artifact_entry(label: str, path: Path) -> dict[str, Any]:
    return {
        "label": label,
        "present": path.exists(),
        "bytes": path.stat().st_size if path.exists() else 0,
        "sha256": file_sha256(path) if path.exists() else None,
        "sensitive_marker_counts": scan_file(path) if path.exists() else {},
    }


def validation_summary(value: dict[str, Any] | None) -> dict[str, Any]:
    if not value:
        return {"present": False}
    validation = value.get("validation")
    if not isinstance(validation, dict):
        validation = value
    return {
        "present": True,
        "status": validation.get("status"),
        "errors_count": len(validation.get("errors") or []),
        "warnings_count": len(validation.get("warnings") or []),
        "private_id_leaks": validation.get("plan_private_id_leaks"),
        "sensitive_marker_hits": validation.get("plan_sensitive_marker_hits"),
        "duplicate_private_file_ids": validation.get("duplicate_private_file_ids"),
    }


def aggregate_invariants(aggregate: Any) -> dict[str, Any]:
    if not isinstance(aggregate, dict):
        return {"present": False}
    dimensions: dict[str, dict[str, int]] = {}
    for key, value in aggregate.items():
        if key == "totals" or not isinstance(value, list):
            continue
        dimensions[key] = {
            "count": sum(int(row.get("count") or 0) for row in value if isinstance(row, dict)),
            "bytes": sum(int(row.get("bytes") or 0) for row in value if isinstance(row, dict)),
        }
    return {
        "present": True,
        "declared_totals": aggregate.get("totals") if isinstance(aggregate.get("totals"), dict) else None,
        "computed_dimensions": dict(sorted(dimensions.items())),
    }


def compact_aggregate(aggregate: Any) -> dict[str, Any]:
    if not isinstance(aggregate, dict):
        return {}
    output: dict[str, Any] = {}
    for key in ("totals", "by_lane", "by_strategy", "by_recommended_kind", "by_coverage_status", "by_owner"):
        value = aggregate.get(key)
        if value is not None:
            output[key] = value
    for key in ("by_outcome", "by_outcome_lane", "by_outcome_coverage"):
        value = aggregate.get(key)
        if value is not None:
            output[key] = value
    by_lane_size = aggregate.get("by_lane_size")
    if isinstance(by_lane_size, list):
        output["by_lane_size_summary"] = {
            "buckets": len(by_lane_size),
            "count": sum(int(row.get("count") or 0) for row in by_lane_size if isinstance(row, dict)),
            "bytes": sum(int(row.get("bytes") or 0) for row in by_lane_size if isinstance(row, dict)),
        }
    return output


def runtime_attestation_summary(summary: dict[str, Any] | None) -> dict[str, Any]:
    if not summary:
        return {"present": False}
    attestation = summary.get("approval_attestation")
    if not isinstance(attestation, dict):
        return {"present": True, "approval_attestation": None}
    preflight = summary.get("global_execution_preflight")
    return {
        "present": True,
        "status": summary.get("status"),
        "approval_attestation": {
            "status": attestation.get("status"),
            "decision": attestation.get("decision"),
            "runtime_enforced": attestation.get("runtime_enforced"),
            "execute_requested": attestation.get("execute_requested"),
            "plan_approved": attestation.get("plan_approved"),
            "approval_note_present": attestation.get("approval_note_present"),
            "validation_status": attestation.get("validation_status"),
            "jobs_selected": attestation.get("jobs_selected"),
            "shards_selected": attestation.get("shards_selected"),
            "execute_commands_in_plan": attestation.get("execute_commands_in_plan"),
        },
        "global_execution_preflight": {
            "status": preflight.get("status"),
            "allowed": preflight.get("allowed"),
            "reason": preflight.get("reason"),
            "execution_scope": preflight.get("execution_scope"),
            "gate_present": preflight.get("gate_present"),
            "gate_status": preflight.get("gate_status"),
            "requires_operator_approval_before_scale": preflight.get("requires_operator_approval_before_scale"),
            "full_extraction_complete": preflight.get("full_extraction_complete"),
            "hard_blocker_lanes": preflight.get("hard_blocker_lanes"),
            "pending_lanes": preflight.get("pending_lanes"),
            "selected_jobs": preflight.get("selected_jobs"),
            "selected_bytes": preflight.get("selected_bytes"),
            "max_canary_jobs": preflight.get("max_canary_jobs"),
            "max_canary_bytes": preflight.get("max_canary_bytes"),
        } if isinstance(preflight, dict) else None,
    }


def immutable_metadata_runtime_summary(summary: dict[str, Any] | None) -> dict[str, Any]:
    if not summary:
        return {"present": False}
    attestation = summary.get("runtime_attestation")
    if not isinstance(attestation, dict):
        return {"present": True, "runtime_attestation": None}
    return {
        "present": True,
        "runtime_attestation": {
            "status": attestation.get("status"),
            "jobs": attestation.get("jobs"),
            "attested_jobs": attestation.get("attested_jobs"),
            "missing_attestations": attestation.get("missing_attestations"),
            "invalid_attestations": attestation.get("invalid_attestations"),
            "statuses": attestation.get("statuses") if isinstance(attestation.get("statuses"), dict) else None,
            "immutable_bytes_attested_jobs": attestation.get("immutable_bytes_attested_jobs"),
            "metadata_only_attested_jobs": attestation.get("metadata_only_attested_jobs"),
            "search_index_write_attempted_jobs": attestation.get("search_index_write_attempted_jobs"),
            "search_index_write_succeeded_jobs": attestation.get("search_index_write_succeeded_jobs"),
            "source_byte_write_attempted_jobs": attestation.get("source_byte_write_attempted_jobs"),
            "s3_mutation_attempted_jobs": attestation.get("s3_mutation_attempted_jobs"),
            "attestation_files_sha256": attestation.get("attestation_files_sha256"),
        },
        "redaction": "runtime attestation summary contains counts and hashes only",
    }


def safe_search_index_summary(
    packet: dict[str, Any] | None,
    validation: dict[str, Any] | None,
    runtime_summary: dict[str, Any] | None,
    duplicate_attestation: dict[str, Any] | None = None,
) -> dict[str, Any]:
    if not packet:
        return {"present": False}
    planned = packet.get("planned")
    coverage = packet.get("coverage")
    completeness = packet.get("completeness")
    commands = packet.get("commands")
    search_probe = runtime_summary.get("search_probe_attestation") if isinstance(runtime_summary, dict) and isinstance(runtime_summary.get("search_probe_attestation"), dict) else {}
    return {
        "present": True,
        "kind": packet.get("kind"),
        "plan_status": packet.get("plan_status"),
        "approved": packet.get("approved"),
        "approval_required": packet.get("approval_required"),
        "coverage": coverage if isinstance(coverage, dict) else {},
        "declared_totals": packet.get("declared_totals") if isinstance(packet.get("declared_totals"), dict) else {},
        "planned": {
            "jobs": planned.get("jobs") if isinstance(planned, dict) else None,
            "bytes": planned.get("bytes") if isinstance(planned, dict) else None,
            "shards": planned.get("shards") if isinstance(planned, dict) else None,
            "aggregate": compact_aggregate(planned.get("aggregate") if isinstance(planned, dict) else None),
        },
        "completeness": {
            "aggregate": compact_aggregate(completeness.get("aggregate") if isinstance(completeness, dict) else None),
            "outcome_policy_keys": sorted((completeness.get("outcome_policy") or {}).keys()) if isinstance(completeness, dict) and isinstance(completeness.get("outcome_policy"), dict) else [],
        },
        "aggregate_invariants": aggregate_invariants(planned.get("aggregate") if isinstance(planned, dict) else None),
        "validation": validation_summary(validation or packet),
        "runtime_negative_execute": runtime_attestation_summary(runtime_summary),
        "runtime_immutable_metadata": immutable_metadata_runtime_summary(runtime_summary),
        "search_probe_attestation": {
            "status": search_probe.get("status"),
            "probes": search_probe.get("probes"),
            "matched_expected_file_probes": search_probe.get("matched_expected_file_probes"),
            "failed_probes": search_probe.get("failed_probes"),
            "skipped_probes": search_probe.get("skipped_probes"),
            "latency_budget_ms": search_probe.get("latency_budget_ms"),
            "max_latency_ms": search_probe.get("max_latency_ms"),
            "p95_latency_ms": search_probe.get("p95_latency_ms"),
            "private_probe_results_sha256": search_probe.get("private_probe_results_sha256"),
            "redaction": "query strings and expected file IDs stay in private probe artifacts; packet exposes counts, hashes, and latency only",
        },
        "scale_readiness_attestation": runtime_summary.get("scale_readiness_attestation") if isinstance(runtime_summary, dict) and isinstance(runtime_summary.get("scale_readiness_attestation"), dict) else None,
        "duplicate_preserve_policy": safe_duplicate_preserve_summary(duplicate_attestation),
        "command_names": sorted(commands.keys()) if isinstance(commands, dict) else [],
        "redaction": "aggregate only; no private row values included",
    }


def safe_duplicate_preserve_summary(value: dict[str, Any] | None) -> dict[str, Any]:
    if not value:
        return {"present": False}
    organization = value.get("organization_duplicates") if isinstance(value.get("organization_duplicates"), dict) else {}
    reconciliation = value.get("planner_reconciliation") if isinstance(value.get("planner_reconciliation"), dict) else {}
    scale = value.get("scale_readiness") if isinstance(value.get("scale_readiness"), dict) else {}
    manifest_audit = value.get("private_manifest_audit") if isinstance(value.get("private_manifest_audit"), dict) else {}
    policy = value.get("duplicate_policy") if isinstance(value.get("duplicate_policy"), dict) else {}
    return {
        "present": True,
        "kind": value.get("kind"),
        "status": value.get("status"),
        "policy_ok": value.get("policy_ok"),
        "search_index_ready": value.get("search_index_ready"),
        "blockers": value.get("blockers") if isinstance(value.get("blockers"), list) else [],
        "duplicate_policy": policy,
        "planner_reconciliation": {
            "exempt_duplicate_rows": reconciliation.get("exempt_duplicate_rows"),
            "exempt_duplicate_bytes": reconciliation.get("exempt_duplicate_bytes"),
            "exempt_duplicate_missing_rows": reconciliation.get("exempt_duplicate_missing_rows"),
            "duplicate_counts_match_db": reconciliation.get("duplicate_counts_match_db"),
            "duplicate_bytes_match_db": reconciliation.get("duplicate_bytes_match_db"),
            "declared_totals_reconciled": reconciliation.get("declared_totals_reconciled"),
            "unplanned_in_scope_files": reconciliation.get("unplanned_in_scope_files"),
        },
        "organization_duplicates": {
            "active_duplicate_groups": organization.get("active_duplicate_groups"),
            "active_duplicate_group_rows": organization.get("active_duplicate_group_rows"),
            "duplicate_non_survivor_rows": organization.get("duplicate_non_survivor_rows"),
            "duplicate_survivor_rows": organization.get("duplicate_survivor_rows"),
            "groups_with_planned_survivor": organization.get("groups_with_planned_survivor"),
            "groups_with_indexed_survivor": organization.get("groups_with_indexed_survivor"),
            "groups_without_active_survivor": organization.get("groups_without_active_survivor"),
            "groups_without_planned_or_indexed_survivor": organization.get("groups_without_planned_or_indexed_survivor"),
            "duplicate_non_survivor_rows_accidentally_planned": organization.get("duplicate_non_survivor_rows_accidentally_planned"),
        },
        "private_manifest_audit": {
            "shard_manifests_read": manifest_audit.get("shard_manifests_read"),
            "shard_manifest_errors": manifest_audit.get("shard_manifest_errors"),
            "planned_private_ids_count": manifest_audit.get("planned_private_ids_count"),
        },
        "scale_readiness": {
            "duplicate_policy_attested": scale.get("duplicate_policy_attested"),
            "requires_search_index_ready": scale.get("requires_search_index_ready"),
            "approved_to_scale": scale.get("approved_to_scale"),
        },
        "redaction": "duplicate preserve summary contains aggregate counts and booleans only",
    }


def safe_stage_dependency_gate(value: dict[str, Any] | None) -> dict[str, Any]:
    if not value:
        return {"present": False}
    stages: list[dict[str, Any]] = []
    for item in value.get("stages") if isinstance(value.get("stages"), list) else []:
        if not isinstance(item, dict):
            continue
        evidence = item.get("evidence") if isinstance(item.get("evidence"), dict) else {}
        stages.append({
            "key": item.get("key"),
            "order": item.get("order"),
            "status": item.get("status"),
            "complete": item.get("complete"),
            "required_for_scale": item.get("required_for_scale"),
            "deferred_until_final_pass": item.get("deferred_until_final_pass"),
            "blockers": item.get("blockers") if isinstance(item.get("blockers"), list) else [],
            "evidence": evidence,
        })
    return {
        "present": True,
        "kind": value.get("kind"),
        "version": value.get("version"),
        "status": value.get("status"),
        "approved_to_scale": value.get("approved_to_scale"),
        "current_stage_order": value.get("current_stage_order"),
        "first_blocking_stage": value.get("first_blocking_stage"),
        "blocking_stage_count": value.get("blocking_stage_count"),
        "hard_blocking_stage_count": value.get("hard_blocking_stage_count"),
        "deferred_stage_count": value.get("deferred_stage_count"),
        "scale_rules": value.get("scale_rules") if isinstance(value.get("scale_rules"), dict) else {},
        "stages": stages,
        "redaction": "stage dependency gate contains ordered aggregate stage statuses only",
    }


def safe_stage_dependency_verification(value: dict[str, Any] | None) -> dict[str, Any]:
    if not value:
        return {"present": False}
    return {
        "present": True,
        "kind": value.get("kind"),
        "version": value.get("version"),
        "status": value.get("status"),
        "gate_status": value.get("gate_status"),
        "approved_to_scale": value.get("approved_to_scale"),
        "summary": value.get("summary") if isinstance(value.get("summary"), dict) else {},
        "gates": value.get("gates") if isinstance(value.get("gates"), dict) else {},
        "source_artifacts": value.get("source_artifacts") if isinstance(value.get("source_artifacts"), dict) else {},
        "errors_count": len(value.get("errors") or []) if isinstance(value.get("errors"), list) else None,
        "warnings_count": len(value.get("warnings") or []) if isinstance(value.get("warnings"), list) else None,
        "redaction": "stage dependency verification contains aggregate gate booleans, counts, and error codes only",
    }


def safe_campaign_summary(plan: dict[str, Any] | None, runtime_summary: dict[str, Any] | None) -> dict[str, Any]:
    if not plan:
        return {"present": False}
    entries = plan.get("shard_entries")
    if not isinstance(entries, list):
        entries = []
    provider_pool = plan.get("provider_pool")
    if not isinstance(provider_pool, list):
        provider_pool = []
    commands = [entry.get("command") for entry in entries if isinstance(entry, dict) and isinstance(entry.get("command"), list)]
    return {
        "present": True,
        "kind": plan.get("kind"),
        "status": plan.get("status"),
        "approved": plan.get("approved"),
        "approval_gate": plan.get("approval_gate") if isinstance(plan.get("approval_gate"), dict) else None,
        "approval_attestation": plan.get("approval_attestation") if isinstance(plan.get("approval_attestation"), dict) else None,
        "worker_manifest_sanitized": plan.get("worker_manifest_sanitized"),
        "redaction_attestation": plan.get("redaction_attestation") if isinstance(plan.get("redaction_attestation"), dict) else None,
        "direct_provider_policy_attestation": plan.get("direct_provider_policy_attestation") if isinstance(plan.get("direct_provider_policy_attestation"), dict) else None,
        "schedule_policy": plan.get("schedule_policy") if isinstance(plan.get("schedule_policy"), dict) else None,
        "runtime_negative_execute": runtime_attestation_summary(runtime_summary),
        "jobs_planned": plan.get("jobs_planned"),
        "shards": plan.get("shards"),
        "execute_commands": sum(1 for command in commands if "--execute" in command),
        "provider_types": sorted({
            str(entry.get("provider_type") or entry.get("provider"))
            for entry in entries
            if isinstance(entry, dict) and (entry.get("provider_type") or entry.get("provider"))
        } | {
            str(entry.get("provider"))
            for entry in provider_pool
            if isinstance(entry, dict) and entry.get("provider")
        }),
        "execution_modes": sorted({
            str(entry.get("execution_mode"))
            for entry in [*entries, *provider_pool]
            if isinstance(entry, dict) and entry.get("execution_mode")
        }),
        "command_count": len(commands),
        "aggregate": plan.get("aggregate") if isinstance(plan.get("aggregate"), dict) else {},
        "redaction": "worker shards must stay sanitized before any model dispatch",
    }


def safe_llm_provider_readiness(value: dict[str, Any] | None) -> dict[str, Any]:
    if not value:
        return {"present": False}
    planned_routes = value.get("planned_routes") if isinstance(value.get("planned_routes"), dict) else {}
    policy_gate = value.get("direct_provider_policy_gate") if isinstance(value.get("direct_provider_policy_gate"), dict) else {}
    schedule_gate = value.get("schedule_gate") if isinstance(value.get("schedule_gate"), dict) else {}
    non_mutation = value.get("non_mutation_attestation") if isinstance(value.get("non_mutation_attestation"), dict) else {}
    redaction_check = value.get("redaction_check") if isinstance(value.get("redaction_check"), dict) else {}
    checks = policy_gate.get("checks") if isinstance(policy_gate.get("checks"), dict) else {}
    return {
        "present": True,
        "kind": value.get("kind"),
        "status": value.get("status"),
        "planned_routes": {
            "account_ref_count": planned_routes.get("account_ref_count"),
            "direct_route_count": len(planned_routes.get("direct_routes") or []) if isinstance(planned_routes.get("direct_routes"), list) else None,
            "direct_gateway_count": len(planned_routes.get("direct_gateways") or []) if isinstance(planned_routes.get("direct_gateways"), list) else None,
            "codewith_profile_count": planned_routes.get("codewith_profile_count"),
            "codewith_tool_available": planned_routes.get("codewith_tool_available"),
        },
        "direct_provider_policy_gate": {
            "status": policy_gate.get("status"),
            "direct_provider_count": policy_gate.get("direct_provider_count"),
            "allowed_host_count": policy_gate.get("allowed_host_count"),
            "checks": {
                key: checks.get(key)
                for key in (
                    "status_ok",
                    "real_file_ids_not_sent",
                    "raw_file_bytes_not_sent",
                    "raw_extracts_not_sent",
                    "secret_values_not_sent",
                    "provider_data_collection_denied",
                    "provider_data_collection_allowed_count_zero",
                    "allowed_hosts_safe",
                )
            },
        },
        "schedule_gate": {
            "status": schedule_gate.get("status"),
            "account_count": schedule_gate.get("account_count"),
            "invalid_account_count": schedule_gate.get("invalid_account_count"),
            "max_campaign_parallel": schedule_gate.get("max_campaign_parallel"),
        },
        "non_mutation_attestation": {
            "provider_calls_made": non_mutation.get("provider_calls_made"),
            "corpus_bytes_mutated": non_mutation.get("corpus_bytes_mutated"),
            "s3_objects_mutated": non_mutation.get("s3_objects_mutated"),
            "metadata_rows_mutated": non_mutation.get("metadata_rows_mutated"),
            "search_index_rows_mutated": non_mutation.get("search_index_rows_mutated"),
        },
        "redaction_check": {
            "passed": redaction_check.get("passed"),
            "sensitive_marker_counts": redaction_check.get("sensitive_marker_counts") if isinstance(redaction_check.get("sensitive_marker_counts"), dict) else {},
        },
        "errors_count": len(value.get("errors") or []) if isinstance(value.get("errors"), list) else None,
        "redaction": "provider readiness summary contains aggregate route counts, policy booleans, and non-mutation flags only",
    }


def safe_campaign_results_summary(results: dict[str, Any] | None) -> dict[str, Any]:
    if not results:
        return {"present": False}
    proposal_validation = results.get("proposal_validation")
    rename_gate = results.get("rename_correctness_gate")
    runtime_gate = results.get("runtime_attestation_gate")
    scale_gate = results.get("scale_readiness_attestation")
    return {
        "present": True,
        "status": results.get("status"),
        "approved": results.get("approved"),
        "jobs_planned": results.get("jobs_planned"),
        "shards": results.get("shards"),
        "shard_states": results.get("shard_states") if isinstance(results.get("shard_states"), dict) else {},
        "proposal_rows": results.get("proposal_rows"),
        "error_rows": results.get("error_rows"),
        "runtime_attestation_rows": results.get("runtime_attestation_rows"),
        "expected_runtime_attestation_rows": results.get("expected_runtime_attestation_rows"),
        "coverage": results.get("coverage") if isinstance(results.get("coverage"), dict) else {},
        "proposal_validation": {
            "status": proposal_validation.get("status"),
            "rows": proposal_validation.get("rows"),
            "errors": proposal_validation.get("errors"),
            "duplicate_target_paths": proposal_validation.get("duplicate_target_paths"),
            "duplicate_file_ids": proposal_validation.get("duplicate_file_ids"),
        } if isinstance(proposal_validation, dict) else None,
        "rename_correctness_gate": rename_gate if isinstance(rename_gate, dict) else None,
        "runtime_attestation_gate": runtime_gate if isinstance(runtime_gate, dict) else None,
        "scale_readiness_attestation": scale_gate if isinstance(scale_gate, dict) else None,
        "redaction": "campaign result summary contains aggregate counts only; no proposal rows or private values included",
    }


def safe_deferred_media_summary(summary: dict[str, Any] | None) -> dict[str, Any]:
    if not summary:
        return {"present": False}
    return {
        "present": True,
        "kind": summary.get("kind"),
        "status": summary.get("status"),
        "totals": summary.get("totals") if isinstance(summary.get("totals"), dict) else {},
        "completion_buckets": summary.get("completion_buckets") if isinstance(summary.get("completion_buckets"), list) else [],
        "retry_buckets": summary.get("retry_buckets") if isinstance(summary.get("retry_buckets"), list) else [],
        "by_lane": summary.get("by_lane") if isinstance(summary.get("by_lane"), list) else [],
        "by_media_kind": summary.get("by_media_kind") if isinstance(summary.get("by_media_kind"), list) else [],
        "by_lane_completion": summary.get("by_lane_completion") if isinstance(summary.get("by_lane_completion"), list) else [],
        "completion_gate": summary.get("completion_gate") if isinstance(summary.get("completion_gate"), dict) else {},
        "redaction": "deferred media summary contains aggregate counts and byte totals only",
    }


def safe_extraction_readiness_gate(summary: dict[str, Any] | None) -> dict[str, Any]:
    if not summary:
        return {"present": False}
    return {
        "present": True,
        "kind": summary.get("kind"),
        "status": summary.get("status"),
        "totals": summary.get("totals") if isinstance(summary.get("totals"), dict) else {},
        "status_counts": summary.get("status_counts") if isinstance(summary.get("status_counts"), dict) else {},
        "gate": summary.get("gate") if isinstance(summary.get("gate"), dict) else {},
        "lanes": summary.get("lanes") if isinstance(summary.get("lanes"), list) else [],
        "redaction": "extraction readiness gate is aggregate only; no file IDs, filenames, object keys, extracted text, or row payloads included",
    }


def safe_extraction_readiness_verification(summary: dict[str, Any] | None) -> dict[str, Any]:
    if not summary:
        return {"present": False}
    checks = summary.get("checks") if isinstance(summary.get("checks"), dict) else {}
    source_artifacts = summary.get("source_artifacts") if isinstance(summary.get("source_artifacts"), dict) else {}
    verification_summary = summary.get("summary") if isinstance(summary.get("summary"), dict) else {}
    return {
        "present": True,
        "kind": summary.get("kind"),
        "version": summary.get("version"),
        "status": summary.get("status"),
        "gate_status": summary.get("gate_status"),
        "summary": verification_summary,
        "checks": {
            "source_artifacts_present": checks.get("source_artifacts_present"),
            "source_artifacts_current": checks.get("source_artifacts_current"),
            "semantic_projection_current": checks.get("semantic_projection_current"),
            "redaction_ok": checks.get("redaction_ok"),
            "expected_lanes_present": checks.get("expected_lanes_present"),
            "totals_consistent": checks.get("totals_consistent"),
            "gate_flags_consistent": checks.get("gate_flags_consistent"),
        },
        "source_artifacts": {
            "expected_sources": source_artifacts.get("expected_sources"),
            "present_sources": source_artifacts.get("present_sources"),
            "current_checked": source_artifacts.get("current_checked"),
            "current_mismatched": source_artifacts.get("current_mismatched") if isinstance(source_artifacts.get("current_mismatched"), list) else [],
            "current_missing_paths": source_artifacts.get("current_missing_paths") if isinstance(source_artifacts.get("current_missing_paths"), list) else [],
        },
        "errors_count": len(summary.get("errors") or []) if isinstance(summary.get("errors"), list) else None,
        "warnings_count": len(summary.get("warnings") or []) if isinstance(summary.get("warnings"), list) else None,
        "redaction": "extraction readiness verification contains aggregate checks, counts, and hashes only",
    }


def safe_bundle_summary(bundle_dir: Path | None) -> dict[str, Any]:
    if bundle_dir is None or not bundle_dir.exists():
        return {"present": False}

    summary = optional_json(bundle_dir / "bundle-summary.json") or {}
    command = optional_json(bundle_dir / "command.json") or {}
    environment_policy = optional_json(bundle_dir / "environment-policy.json") or {}
    integrity = optional_json(bundle_dir / "bundle-integrity.json") or {}
    verification = optional_json(bundle_dir / "locked-worker-bundle-verification.json") or {}
    command_list = command.get("command") if isinstance(command.get("command"), list) else []
    integrity_files = integrity.get("files") if isinstance(integrity.get("files"), list) else []
    return {
        "present": True,
        "top_level_files": sorted(path.name for path in bundle_dir.iterdir() if path.is_file()),
        "bundle_summary": {
            "kind": summary.get("kind"),
            "jobs": summary.get("jobs"),
            "provider": summary.get("provider"),
            "model": summary.get("model"),
            "execution_mode": summary.get("execution_mode"),
            "sanitized": summary.get("sanitized"),
        },
        "command_policy": {
            "sandbox": command.get("sandbox"),
            "skip_git_repo_check": "--skip-git-repo-check" in command_list,
            "skip_git_repo_check_attested": command.get("skip_git_repo_check"),
            "skip_git_repo_check_justification": command.get("skip_git_repo_check_justification"),
            "disabled_features": [
                command_list[index + 1]
                for index, token in enumerate(command_list[:-1])
                if token == "--disable"
            ],
            "dangerous_bypass": "--dangerously-bypass-approvals-and-sandbox" in command_list,
            "auth_profile": command.get("auth_profile"),
            "model": command.get("model"),
            "minimal_env_wrapper": command.get("minimal_env_wrapper"),
            "home_policy": command.get("home_policy"),
            "git_ancestor_present": command.get("git_ancestor_present"),
            "execution_surface": command.get("execution_surface") if isinstance(command.get("execution_surface"), dict) else None,
            "network_egress_policy": command.get("network_egress_policy") if isinstance(command.get("network_egress_policy"), dict) else None,
            "reasoning_effort": command.get("reasoning_effort"),
        },
        "environment_policy": {
            "mode": environment_policy.get("policy"),
            "home_policy": environment_policy.get("home_policy"),
            "host_home_inherited": environment_policy.get("host_home_inherited"),
            "allowlist": environment_policy.get("allowed_keys"),
            "present_allowed_keys": environment_policy.get("present_allowed_keys"),
            "secret_values_included": environment_policy.get("secret_values_included"),
        },
        "integrity": {
            "present": bool(integrity),
            "status": integrity.get("status"),
            "file_count": integrity.get("file_count"),
            "hashed_paths": [
                entry.get("path")
                for entry in integrity_files
                if isinstance(entry, dict) and isinstance(entry.get("path"), str)
            ],
            "skip_git_repo_check": integrity.get("skip_git_repo_check"),
            "git_ancestor_present": integrity.get("git_ancestor_present"),
            "host_home_inherited": integrity.get("host_home_inherited"),
            "execution_surface": integrity.get("execution_surface") if isinstance(integrity.get("execution_surface"), dict) else None,
            "network_egress_policy": integrity.get("network_egress_policy") if isinstance(integrity.get("network_egress_policy"), dict) else None,
            "sha256": summary.get("integrity", {}).get("sha256") if isinstance(summary.get("integrity"), dict) else None,
        },
        "verification": {
            "present": bool(verification),
            "status": verification.get("status"),
            "gates": verification.get("gates") if isinstance(verification.get("gates"), dict) else None,
            "network_egress_policy": verification.get("network_egress_policy") if isinstance(verification.get("network_egress_policy"), dict) else None,
            "errors_count": len(verification.get("errors") or []) if isinstance(verification.get("errors"), list) else None,
            "warnings_count": len(verification.get("warnings") or []) if isinstance(verification.get("warnings"), list) else None,
        },
    }


def review_schema() -> dict[str, Any]:
    risk = {
        "type": "object",
        "additionalProperties": False,
        "required": ["severity", "code", "finding", "evidence", "recommendation"],
        "properties": {
            "severity": {"type": "string", "enum": ["blocker", "high", "medium", "low"]},
            "code": {"type": "string", "minLength": 3},
            "finding": {"type": "string", "minLength": 1},
            "evidence": {"type": "string", "minLength": 1},
            "recommendation": {"type": "string", "minLength": 1},
        },
    }
    return {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "title": "OpenFilesAdversarialReview",
        "type": "object",
        "additionalProperties": False,
        "required": [
            "reviewer",
            "verdict",
            "approved_to_scale",
            "blockers",
            "risks",
            "required_next_actions",
            "privacy_confirmation",
            "input_attestation",
            "summary",
        ],
        "properties": {
            "reviewer": {"type": "string", "enum": ["reviewer_a", "reviewer_b"]},
            "verdict": {"type": "string", "enum": ["pass", "pass_with_conditions", "fail"]},
            "approved_to_scale": {"type": "boolean"},
            "blockers": {"type": "array", "items": {"type": "string"}},
            "risks": {"type": "array", "items": risk},
            "required_next_actions": {"type": "array", "items": {"type": "string"}},
            "privacy_confirmation": {
                "type": "object",
                "additionalProperties": False,
                "required": [
                    "reviewed_only_packet_files",
                    "no_private_values_in_response",
                    "no_file_content_requested",
                ],
                "properties": {
                    "reviewed_only_packet_files": {"type": "boolean"},
                    "no_private_values_in_response": {"type": "boolean"},
                    "no_file_content_requested": {"type": "boolean"},
                },
            },
            "input_attestation": {
                "type": "object",
                "additionalProperties": False,
                "required": [
                    "reviewer",
                    "packet_sha256",
                    "schema_sha256",
                    "reviewer_prompt_sha256",
                ],
                "properties": {
                    "reviewer": {"type": "string", "enum": ["reviewer_a", "reviewer_b"]},
                    "packet_sha256": {"type": "string", "pattern": "^[0-9a-f]{64}$"},
                    "schema_sha256": {"type": "string", "pattern": "^[0-9a-f]{64}$"},
                    "reviewer_prompt_sha256": {"type": "string", "pattern": "^[0-9a-f]{64}$"},
                },
            },
            "summary": {"type": "string", "minLength": 1},
        },
    }


def reviewer_prompt(reviewer: str, packet_file: str, schema_file: str, attestation_file: str | None = None) -> str:
    if reviewer == "reviewer_a":
        focus = [
            "Attack privacy, redaction, sandboxing, approval gates, and provider/data-retention risks.",
            "Look for any path where a worker could receive private row values, object keys, file IDs, or extracted content before approval.",
            "Check whether immutable S3 bytes and metadata-only apply are protected by the process.",
        ]
    else:
        focus = [
            "Attack scalability, indexing completeness, extraction coverage, duplicate handling, and naming correctness.",
            "Look for places where plans could look complete while leaving lanes unindexed, stale, or unsearchable.",
            "Check whether deferred audio/video and OCR/vision lanes are explicitly tracked to completion.",
        ]

    body = [
        PROMPT_PREAMBLE,
        f"Reviewer id: {reviewer}",
        "",
        "Files you may read:",
        f"- {packet_file}",
        f"- {schema_file}",
        "",
        "Focus:",
        *[f"- {item}" for item in focus],
        "",
        "Return JSON only. Use the schema file as the contract.",
    ]
    if attestation_file:
        body.extend([
            "",
            "Input attestation:",
            f"- Read {attestation_file} and copy it exactly into the required input_attestation field.",
            "- Treat mismatched or missing attestation values as a blocker.",
        ])
    return "\n".join(body) + "\n"


def direct_reviewer_prompt(
    reviewer: str,
    packet: dict[str, Any],
    schema: dict[str, Any],
    attestation: dict[str, Any],
) -> str:
    base = reviewer_prompt(reviewer, "inline packet below", "inline schema below")
    return (
        base
        + "\nDo not use tools, shell commands, web search, MCP, or filesystem access. "
        + "Base the review only on the inline JSON below.\n\n"
        + "Copy this object exactly into the required input_attestation field:\n"
        + json.dumps(attestation, indent=2, sort_keys=True)
        + "\n\n"
        + "INLINE_ADVERSARIAL_REVIEW_PACKET_JSON:\n"
        + json.dumps(packet, indent=2, sort_keys=True)
        + "\n\nINLINE_REVIEWER_FINAL_SCHEMA_JSON:\n"
        + json.dumps(schema, indent=2, sort_keys=True)
        + "\n"
    )


def fail_on_sensitive_source_markers(entries: list[dict[str, Any]]) -> None:
    failures = [
        {"label": entry["label"], "marker_codes": sorted(entry["sensitive_marker_counts"].keys())}
        for entry in entries
        if entry.get("sensitive_marker_counts")
    ]
    if failures:
        print(json.dumps({"status": "blocked", "sensitive_source_artifacts": failures}, indent=2, sort_keys=True), file=sys.stderr)
        raise SystemExit(2)


def write_json(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(canonical_json_text(value), encoding="utf-8")


def safe_extraction_worker_image_verification(value: dict[str, Any] | None) -> dict[str, Any]:
    if not value:
        return {"present": False}
    static = value.get("static") if isinstance(value.get("static"), dict) else {}
    docker = value.get("docker") if isinstance(value.get("docker"), dict) else {}
    runtime = value.get("runtime") if isinstance(value.get("runtime"), dict) else None
    static_redaction = static.get("redaction_checks") if isinstance(static.get("redaction_checks"), dict) else {}
    policy = (
        value.get("worker_runtime_policy")
        if isinstance(value.get("worker_runtime_policy"), dict)
        else static.get("worker_runtime_policy") if isinstance(static.get("worker_runtime_policy"), dict) else {}
    )
    runtime_summary = None
    if runtime:
        runtime_summary = {
            "status": runtime.get("status"),
            "build_status": (runtime.get("build") or {}).get("status") if isinstance(runtime.get("build"), dict) else None,
            "smoke_status": (runtime.get("smoke") or {}).get("status") if isinstance(runtime.get("smoke"), dict) else None,
            "worker_inventory_status": ((runtime.get("worker_inventory") or {}).get("inventory_summary") or {}).get("status") if isinstance(runtime.get("worker_inventory"), dict) and isinstance((runtime.get("worker_inventory") or {}).get("inventory_summary"), dict) else None,
            "docker_run_policy_status": ((runtime.get("docker_run_policy") or {}).get("status") if isinstance(runtime.get("docker_run_policy"), dict) else None),
        }
    return {
        "present": True,
        "kind": value.get("kind"),
        "status": value.get("status"),
        "static_status": static.get("status"),
        "static_errors_count": len(static.get("errors") or []),
        "static_warnings_count": len(static.get("warnings") or []),
        "docker_status": docker.get("status"),
        "docker_binary_present": bool(docker.get("path")),
        "runtime": runtime_summary,
        "worker_runtime_policy": {
            "present": bool(policy),
            "status": policy.get("status"),
            "network_mode": policy.get("network_mode"),
            "network_disabled": policy.get("network_disabled") is True,
            "provider_egress_allowed": policy.get("provider_egress_allowed") is True,
            "arbitrary_url_fetch_allowed": policy.get("arbitrary_url_fetch_allowed") is True,
            "google_drive_access_allowed": policy.get("google_drive_access_allowed") is True,
            "s3_object_access_allowed": policy.get("s3_object_access_allowed") is True,
            "db_access_allowed": policy.get("db_access_allowed") is True,
            "corpus_mounts_allowed": policy.get("corpus_mounts_allowed") is True,
            "secret_env_allowed": policy.get("secret_env_allowed") is True,
            "read_only_rootfs": policy.get("read_only_rootfs") is True,
            "cap_drop_all": policy.get("cap_drop_all") is True,
            "no_new_privileges": policy.get("no_new_privileges") is True,
            "command_logs_hashed_only": policy.get("command_logs_hashed_only") is True,
            "private_values_in_command": policy.get("private_values_in_command") is True,
        },
        "archive_tool_packages": [
            package
            for package in (static.get("required_packages") or [])
            if package in {"p7zip-full", "libarchive-tools", "unzip", "file"}
        ],
        "redaction_checks": {
            "smoke_does_not_use_include_names": bool(static_redaction.get("smoke_does_not_use_include_names")),
            "smoke_checks_hashed_names": bool(static_redaction.get("smoke_checks_hashed_names")),
            "smoke_checks_member_name_leaks": bool(static_redaction.get("smoke_checks_member_name_leaks")),
        },
        "next_actions": value.get("next_actions") if isinstance(value.get("next_actions"), list) else [],
        "redaction": "summary only; command logs are represented by byte counts and hashes in source evidence",
    }


def safe_extraction_approval_dashboard(value: dict[str, Any] | None) -> dict[str, Any]:
    if not value:
        return {"present": False}
    overall = value.get("overall") if isinstance(value.get("overall"), dict) else {}
    sections = value.get("sections") if isinstance(value.get("sections"), dict) else {}
    approval_items = value.get("approval_items") if isinstance(value.get("approval_items"), list) else []
    safe_items: list[dict[str, Any]] = []
    for item in approval_items:
        if not isinstance(item, dict):
            continue
        note = item.get("approval_note") if isinstance(item.get("approval_note"), dict) else {}
        safe_items.append({
            "id": item.get("id"),
            "priority": item.get("priority"),
            "status": item.get("status"),
            "ready_for_approval": item.get("ready_for_approval"),
            "approval_note": {
                "summary_present": note.get("summary_present"),
                "present": note.get("present"),
                "valid": note.get("valid"),
                "approved": note.get("approved"),
                "status": note.get("status"),
                "scope": note.get("scope"),
                "approved_at": note.get("approved_at"),
                "expires_at": note.get("expires_at"),
                "approved_by_present": note.get("approved_by_present"),
                "approval_note_present": note.get("approval_note_present"),
                "approval_note_sha256": note.get("approval_note_sha256"),
                "approval_request_checked": note.get("approval_request_checked"),
                "remediation_action_ids": note.get("remediation_action_ids") if isinstance(note.get("remediation_action_ids"), list) else [],
                "remediation_status": note.get("remediation_status"),
                "command_hashes_match": note.get("command_hashes_match"),
                "artifact_sha256": note.get("artifact_sha256"),
                "errors": note.get("errors") if isinstance(note.get("errors"), list) else [],
            },
            "reason": item.get("reason"),
        })
    extraction = sections.get("extraction_readiness") if isinstance(sections.get("extraction_readiness"), dict) else {}
    tool_remediation = sections.get("tool_remediation") if isinstance(sections.get("tool_remediation"), dict) else {}
    archive_worker = sections.get("archive_worker_image") if isinstance(sections.get("archive_worker_image"), dict) else {}
    search_index = sections.get("search_index_population") if isinstance(sections.get("search_index_population"), dict) else {}
    llm = sections.get("llm_review_campaign") if isinstance(sections.get("llm_review_campaign"), dict) else {}
    deferred_media = sections.get("deferred_media") if isinstance(sections.get("deferred_media"), dict) else {}
    return {
        "present": True,
        "kind": value.get("kind"),
        "status": value.get("status"),
        "overall": {
            "ready_for_operator_review": overall.get("ready_for_operator_review"),
            "ready_approval_items": overall.get("ready_approval_items"),
            "approval_items": overall.get("approval_items"),
            "approved_approval_notes": overall.get("approved_approval_notes"),
            "approval_notes_complete": overall.get("approval_notes_complete"),
            "pending_approval_note_items": overall.get("pending_approval_note_items") if isinstance(overall.get("pending_approval_note_items"), list) else [],
            "blocked_or_missing_prep_items": overall.get("blocked_or_missing_prep_items") if isinstance(overall.get("blocked_or_missing_prep_items"), list) else [],
            "final_media_pass_deferred": overall.get("final_media_pass_deferred"),
            "corpus_bytes_mutated": overall.get("corpus_bytes_mutated"),
            "s3_objects_mutated": overall.get("s3_objects_mutated"),
            "metadata_rows_mutated": overall.get("metadata_rows_mutated"),
        },
        "approval_items": safe_items,
        "tool_remediation": {
            "present": tool_remediation.get("present"),
            "status": tool_remediation.get("status"),
            "summary": tool_remediation.get("summary") if isinstance(tool_remediation.get("summary"), dict) else {},
            "action_ids": [
                item.get("id")
                for item in tool_remediation.get("actions", [])
                if isinstance(item, dict) and isinstance(item.get("id"), str)
            ] if isinstance(tool_remediation.get("actions"), list) else [],
            "redaction_check": tool_remediation.get("redaction_check") if isinstance(tool_remediation.get("redaction_check"), dict) else {},
        },
        "section_statuses": {
            "extraction_readiness": extraction.get("status"),
            "tool_remediation": tool_remediation.get("status"),
            "archive_worker_image": (archive_worker.get("approval") or {}).get("status") if isinstance(archive_worker.get("approval"), dict) else None,
            "search_index_population": (search_index.get("approval") or {}).get("status") if isinstance(search_index.get("approval"), dict) else None,
            "llm_review_campaign": (llm.get("approval") or {}).get("approval_status") if isinstance(llm.get("approval"), dict) else None,
            "deferred_media": deferred_media.get("status"),
        },
        "redaction": "approval dashboard summary contains aggregate status and readiness only; no private row values or command logs included",
    }


def safe_approval_request_packet(value: dict[str, Any] | None) -> dict[str, Any]:
    if not value:
        return {"present": False}
    templates: list[dict[str, Any]] = []
    for item in value.get("templates") if isinstance(value.get("templates"), list) else []:
        if not isinstance(item, dict):
            continue
        command_hashes = item.get("command_hashes") if isinstance(item.get("command_hashes"), list) else []
        templates.append({
            "decision_id": item.get("decision_id"),
            "priority": item.get("priority"),
            "status": item.get("status"),
            "ready_for_approval": item.get("ready_for_approval"),
            "scope": item.get("scope"),
            "command_hash_count": len(command_hashes),
            "remediation_action_ids": item.get("remediation_action_ids") if isinstance(item.get("remediation_action_ids"), list) else [],
            "remediation_status": item.get("remediation_status"),
            "template_sha256": item.get("template_sha256"),
            "sensitive_marker_counts": item.get("sensitive_marker_counts") if isinstance(item.get("sensitive_marker_counts"), dict) else {},
        })
    return {
        "present": True,
        "kind": value.get("kind"),
        "status": value.get("status"),
        "template_count": value.get("template_count"),
        "source_status": value.get("source_status") if isinstance(value.get("source_status"), dict) else {},
        "non_mutation_attestation": value.get("non_mutation_attestation") if isinstance(value.get("non_mutation_attestation"), dict) else {},
        "templates": templates,
        "redaction_check": value.get("redaction_check") if isinstance(value.get("redaction_check"), dict) else {},
        "redaction": "approval request packet summary contains template metadata, hashes, and non-mutation flags only",
    }


def safe_approval_request_verification(value: dict[str, Any] | None) -> dict[str, Any]:
    if not value:
        return {"present": False}
    return {
        "present": True,
        "kind": value.get("kind"),
        "status": value.get("status"),
        "packet_status": value.get("packet_status"),
        "template_count": value.get("template_count"),
        "decision_count": len(value.get("decision_ids")) if isinstance(value.get("decision_ids"), list) else None,
        "gates": value.get("gates") if isinstance(value.get("gates"), dict) else {},
        "source_status": value.get("source_status") if isinstance(value.get("source_status"), dict) else {},
        "errors_count": len(value.get("errors") or []) if isinstance(value.get("errors"), list) else None,
        "warnings_count": len(value.get("warnings") or []) if isinstance(value.get("warnings"), list) else None,
        "redaction": "approval request verification contains aggregate gate booleans, counts, hashes-valid status, and error counts only",
    }


def safe_replacement_readiness_gate(value: dict[str, Any] | None) -> dict[str, Any]:
    if not value:
        return {"present": False}
    requirements: list[dict[str, Any]] = []
    for item in value.get("requirements") if isinstance(value.get("requirements"), list) else []:
        if not isinstance(item, dict):
            continue
        requirements.append({
            "key": item.get("key"),
            "title": item.get("title"),
            "status": item.get("status"),
            "complete": item.get("complete"),
            "blockers": item.get("blockers") if isinstance(item.get("blockers"), list) else [],
            "evidence": item.get("evidence") if isinstance(item.get("evidence"), dict) else {},
        })
    return {
        "present": True,
        "kind": value.get("kind"),
        "status": value.get("status"),
        "approved_to_replace_google_drive": value.get("approved_to_replace_google_drive"),
        "summary": value.get("summary") if isinstance(value.get("summary"), dict) else {},
        "requirements": requirements,
        "redaction": "replacement readiness gate contains aggregate requirement status and counts only",
    }


def build_packet(
    output_dir: Path,
    search_index_packet_path: Path | None,
    search_index_validation_path: Path | None,
    search_index_runtime_summary_path: Path | None,
    duplicate_preserve_attestation_path: Path | None,
    stage_dependency_gate_path: Path | None,
    stage_dependency_verification_path: Path | None,
    llm_campaign_plan_path: Path | None,
    llm_campaign_runtime_summary_path: Path | None,
    llm_provider_readiness_path: Path | None,
    llm_campaign_results_summary_path: Path | None,
    deferred_media_summary_path: Path | None,
    extraction_readiness_gate_path: Path | None,
    extraction_readiness_verification_path: Path | None,
    extraction_worker_image_verification_path: Path | None,
    extraction_approval_dashboard_path: Path | None,
    approval_request_packet_path: Path | None,
    approval_request_verification_path: Path | None,
    replacement_readiness_gate_path: Path | None,
    locked_worker_bundle_dir: Path | None,
    strict_source_scan: bool,
) -> dict[str, Any]:
    source_entries: list[dict[str, Any]] = []
    for label, path in (
        ("search_index_approval_packet", search_index_packet_path),
        ("search_index_validation", search_index_validation_path),
        ("search_index_runtime_summary", search_index_runtime_summary_path),
        ("duplicate_preserve_attestation", duplicate_preserve_attestation_path),
        ("stage_dependency_gate", stage_dependency_gate_path),
        ("stage_dependency_verification", stage_dependency_verification_path),
        ("llm_campaign_plan", llm_campaign_plan_path),
        ("llm_campaign_runtime_summary", llm_campaign_runtime_summary_path),
        ("llm_provider_readiness", llm_provider_readiness_path),
        ("llm_campaign_results_summary", llm_campaign_results_summary_path),
        ("deferred_media_summary", deferred_media_summary_path),
        ("extraction_readiness_gate", extraction_readiness_gate_path),
        ("extraction_readiness_verification", extraction_readiness_verification_path),
        ("extraction_worker_image_verification", extraction_worker_image_verification_path),
        ("extraction_approval_dashboard", extraction_approval_dashboard_path),
        ("approval_request_packet", approval_request_packet_path),
        ("approval_request_packet_verification", approval_request_verification_path),
        ("replacement_readiness_gate", replacement_readiness_gate_path),
    ):
        if path is not None:
            source_entries.append(source_artifact_entry(label, path))
    if locked_worker_bundle_dir is not None and locked_worker_bundle_dir.exists():
        for filename in ("bundle-summary.json", "command.json", "environment-policy.json", "bundle-integrity.json", "locked-worker-bundle-verification.json", "prompt.md", "run-worker.sh"):
            path = locked_worker_bundle_dir / filename
            if path.exists():
                source_entries.append(source_artifact_entry(f"locked_worker_bundle/{filename}", path))

    if strict_source_scan:
        fail_on_sensitive_source_markers(source_entries)

    search_index_packet = optional_json(search_index_packet_path)
    search_index_validation = optional_json(search_index_validation_path)
    search_index_runtime_summary = optional_json(search_index_runtime_summary_path)
    duplicate_preserve_attestation = optional_json(duplicate_preserve_attestation_path)
    stage_dependency_gate = optional_json(stage_dependency_gate_path)
    stage_dependency_verification = optional_json(stage_dependency_verification_path)
    llm_campaign_plan = optional_json(llm_campaign_plan_path)
    llm_campaign_runtime_summary = optional_json(llm_campaign_runtime_summary_path)
    llm_provider_readiness = optional_json(llm_provider_readiness_path)
    llm_campaign_results_summary = optional_json(llm_campaign_results_summary_path)
    deferred_media_summary = optional_json(deferred_media_summary_path)
    extraction_readiness_gate = optional_json(extraction_readiness_gate_path)
    extraction_readiness_verification = optional_json(extraction_readiness_verification_path)
    extraction_worker_image_verification = optional_json(extraction_worker_image_verification_path)
    extraction_approval_dashboard = optional_json(extraction_approval_dashboard_path)
    approval_request_packet = optional_json(approval_request_packet_path)
    approval_request_verification = optional_json(approval_request_verification_path)
    replacement_readiness_gate = optional_json(replacement_readiness_gate_path)

    packet = {
        "generated_at": now_utc(),
        "kind": "open_files_adversarial_review_packet",
        "scope": {
            "purpose": "two-agent adversarial review of migration/indexing/renaming readiness before scaled execution",
            "allowed": [
                "review aggregate counts and statuses",
                "review approval gates and validation requirements",
                "review sandbox/provider policy shape",
                "recommend blockers and next actions",
            ],
            "disallowed": [
                "reading private corpus files",
                "reading private manifests with filenames or file IDs",
                "using S3 object keys or source refs",
                "quoting extracted text, transcripts, ACL payloads, or row payloads",
            ],
        },
        "current_state": {
            "canonical_s3_keys_immutable": True,
            "metadata_only_organization": True,
            "legacy_sources_preserved_until_final_audit": True,
            "audio_video_deferred_until_end": True,
            "scaled_agent_execution_requires_approval": True,
        },
        "artifacts": {
            "stage_dependency_gate": safe_stage_dependency_gate(stage_dependency_gate),
            "stage_dependency_verification": safe_stage_dependency_verification(stage_dependency_verification),
            "search_index": safe_search_index_summary(search_index_packet, search_index_validation, search_index_runtime_summary, duplicate_preserve_attestation),
            "llm_campaign": safe_campaign_summary(llm_campaign_plan, llm_campaign_runtime_summary),
            "llm_provider_readiness": safe_llm_provider_readiness(llm_provider_readiness),
            "llm_campaign_results": safe_campaign_results_summary(llm_campaign_results_summary),
            "deferred_media_completion": safe_deferred_media_summary(deferred_media_summary),
            "extraction_readiness": safe_extraction_readiness_gate(extraction_readiness_gate),
            "extraction_readiness_verification": safe_extraction_readiness_verification(extraction_readiness_verification),
            "extraction_worker_image": safe_extraction_worker_image_verification(extraction_worker_image_verification),
            "extraction_approval_dashboard": safe_extraction_approval_dashboard(extraction_approval_dashboard),
            "approval_request_packet": safe_approval_request_packet(approval_request_packet),
            "approval_request_verification": safe_approval_request_verification(approval_request_verification),
            "replacement_readiness_gate": safe_replacement_readiness_gate(replacement_readiness_gate),
            "locked_worker_bundle": safe_bundle_summary(locked_worker_bundle_dir),
        },
        "reviewers": {
            "reviewer_a": {
                "role": "privacy/security/sandbox adversary",
                "must_answer": "Can scaled workers run without leaking private corpus data or bypassing approval gates?",
            },
            "reviewer_b": {
                "role": "scalability/correctness/search adversary",
                "must_answer": "Can the indexing/extraction/rename process reach complete searchable coverage without hiding gaps?",
            },
        },
        "source_artifact_checks": source_entries,
        "redaction_contract": {
            "packet_must_not_include": [
                "file IDs",
                "filenames",
                "object keys",
                "source refs",
                "extracted text",
                "transcripts",
                "ACL payloads",
                "row payloads",
            ],
            "output_sensitive_marker_counts": {},
        },
    }

    output_scan = scan_text(json.dumps(packet, sort_keys=True))
    packet["redaction_contract"]["output_sensitive_marker_counts"] = output_scan
    if output_scan:
        raise SystemExit("generated packet contains sensitive markers")

    output_dir.mkdir(parents=True, exist_ok=True)
    schema = review_schema()
    packet_text = canonical_json_text(packet)
    schema_text = canonical_json_text(schema)
    (output_dir / "adversarial-review-packet.json").write_text(packet_text, encoding="utf-8")
    (output_dir / "reviewer-final.schema.json").write_text(schema_text, encoding="utf-8")
    reviewer_prompts: dict[str, str] = {
        "reviewer_a": reviewer_prompt(
            "reviewer_a",
            "adversarial-review-packet.json",
            "reviewer-final.schema.json",
            "reviewer-a-input-attestation.json",
        ),
        "reviewer_b": reviewer_prompt(
            "reviewer_b",
            "adversarial-review-packet.json",
            "reviewer-final.schema.json",
            "reviewer-b-input-attestation.json",
        ),
    }
    (output_dir / "reviewer-a-prompt.md").write_text(reviewer_prompts["reviewer_a"], encoding="utf-8")
    (output_dir / "reviewer-b-prompt.md").write_text(reviewer_prompts["reviewer_b"], encoding="utf-8")
    attestations = {
        "reviewer_a": {
            "reviewer": "reviewer_a",
            "packet_sha256": text_sha256(packet_text),
            "schema_sha256": text_sha256(schema_text),
            "reviewer_prompt_sha256": text_sha256(reviewer_prompts["reviewer_a"]),
        },
        "reviewer_b": {
            "reviewer": "reviewer_b",
            "packet_sha256": text_sha256(packet_text),
            "schema_sha256": text_sha256(schema_text),
            "reviewer_prompt_sha256": text_sha256(reviewer_prompts["reviewer_b"]),
        },
    }
    write_json(output_dir / "reviewer-a-input-attestation.json", attestations["reviewer_a"])
    write_json(output_dir / "reviewer-b-input-attestation.json", attestations["reviewer_b"])
    (output_dir / "reviewer-a-direct-prompt.md").write_text(
        direct_reviewer_prompt("reviewer_a", packet, schema, attestations["reviewer_a"]),
        encoding="utf-8",
    )
    (output_dir / "reviewer-b-direct-prompt.md").write_text(
        direct_reviewer_prompt("reviewer_b", packet, schema, attestations["reviewer_b"]),
        encoding="utf-8",
    )

    for generated in (
        output_dir / "adversarial-review-packet.json",
        output_dir / "reviewer-final.schema.json",
        output_dir / "reviewer-a-prompt.md",
        output_dir / "reviewer-b-prompt.md",
        output_dir / "reviewer-a-input-attestation.json",
        output_dir / "reviewer-b-input-attestation.json",
        output_dir / "reviewer-a-direct-prompt.md",
        output_dir / "reviewer-b-direct-prompt.md",
    ):
        generated_scan = scan_file(generated)
        if generated_scan:
            raise SystemExit(f"generated artifact contains sensitive markers: {generated.name}")

    return packet


def main() -> int:
    parser = argparse.ArgumentParser(description="Build aggregate-safe adversarial review packets.")
    parser.add_argument("--output-dir", default=DEFAULT_OUTPUT_DIR)
    parser.add_argument("--search-index-packet")
    parser.add_argument("--search-index-validation")
    parser.add_argument("--search-index-runtime-summary")
    parser.add_argument("--duplicate-preserve-attestation")
    parser.add_argument("--stage-dependency-gate")
    parser.add_argument("--stage-dependency-verification")
    parser.add_argument("--llm-campaign-plan")
    parser.add_argument("--llm-campaign-runtime-summary")
    parser.add_argument("--llm-provider-readiness")
    parser.add_argument("--llm-campaign-results-summary")
    parser.add_argument("--deferred-media-summary")
    parser.add_argument("--extraction-readiness-gate")
    parser.add_argument("--extraction-readiness-verification")
    parser.add_argument("--extraction-worker-image-verification")
    parser.add_argument("--extraction-approval-dashboard")
    parser.add_argument("--approval-request-packet")
    parser.add_argument("--approval-request-verification")
    parser.add_argument("--replacement-readiness-gate")
    parser.add_argument("--locked-worker-bundle-dir")
    parser.add_argument("--allow-sensitive-source-artifacts", action="store_true")
    args = parser.parse_args()

    packet = build_packet(
        output_dir=Path(args.output_dir).expanduser().resolve(),
        search_index_packet_path=Path(args.search_index_packet).expanduser().resolve() if args.search_index_packet else None,
        search_index_validation_path=Path(args.search_index_validation).expanduser().resolve() if args.search_index_validation else None,
        search_index_runtime_summary_path=Path(args.search_index_runtime_summary).expanduser().resolve() if args.search_index_runtime_summary else None,
        duplicate_preserve_attestation_path=Path(args.duplicate_preserve_attestation).expanduser().resolve() if args.duplicate_preserve_attestation else None,
        stage_dependency_gate_path=Path(args.stage_dependency_gate).expanduser().resolve() if args.stage_dependency_gate else None,
        stage_dependency_verification_path=Path(args.stage_dependency_verification).expanduser().resolve() if args.stage_dependency_verification else None,
        llm_campaign_plan_path=Path(args.llm_campaign_plan).expanduser().resolve() if args.llm_campaign_plan else None,
        llm_campaign_runtime_summary_path=Path(args.llm_campaign_runtime_summary).expanduser().resolve() if args.llm_campaign_runtime_summary else None,
        llm_provider_readiness_path=Path(args.llm_provider_readiness).expanduser().resolve() if args.llm_provider_readiness else None,
        llm_campaign_results_summary_path=Path(args.llm_campaign_results_summary).expanduser().resolve() if args.llm_campaign_results_summary else None,
        deferred_media_summary_path=Path(args.deferred_media_summary).expanduser().resolve() if args.deferred_media_summary else None,
        extraction_readiness_gate_path=Path(args.extraction_readiness_gate).expanduser().resolve() if args.extraction_readiness_gate else None,
        extraction_readiness_verification_path=Path(args.extraction_readiness_verification).expanduser().resolve() if args.extraction_readiness_verification else None,
        extraction_worker_image_verification_path=Path(args.extraction_worker_image_verification).expanduser().resolve() if args.extraction_worker_image_verification else None,
        extraction_approval_dashboard_path=Path(args.extraction_approval_dashboard).expanduser().resolve() if args.extraction_approval_dashboard else None,
        approval_request_packet_path=Path(args.approval_request_packet).expanduser().resolve() if args.approval_request_packet else None,
        approval_request_verification_path=Path(args.approval_request_verification).expanduser().resolve() if args.approval_request_verification else None,
        replacement_readiness_gate_path=Path(args.replacement_readiness_gate).expanduser().resolve() if args.replacement_readiness_gate else None,
        locked_worker_bundle_dir=Path(args.locked_worker_bundle_dir).expanduser().resolve() if args.locked_worker_bundle_dir else None,
        strict_source_scan=not args.allow_sensitive_source_artifacts,
    )
    print(json.dumps({"status": "ok", "output_dir": args.output_dir, "source_artifacts": len(packet["source_artifact_checks"])}, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
