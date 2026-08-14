#!/usr/bin/env python3
"""Build a consolidated, aggregate-only extraction approval dashboard.

The dashboard coordinates approval-gated extraction, indexing, archive-worker,
and LLM review work. It reads existing summary/approval artifacts and emits
only counts, statuses, gates, and safe command strings from approval packets.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import time
from pathlib import Path
from typing import Any


DEFAULT_OUTPUT = ".codewith/private-artifacts/extraction-approval-dashboard.json"

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
    ("google_drive_url", re.compile(r"(drive|docs)\.google\.com/", re.I)),
)


def now_utc() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def file_sha256(path: Path) -> str | None:
    if not path.exists():
        return None
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_json(path: Path | None) -> dict[str, Any] | None:
    if path is None or not path.exists():
        return None
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise SystemExit(f"expected JSON object: {path}")
    return value


def source_entry(label: str, path: Path | None) -> dict[str, Any]:
    return {
        "label": label,
        "present": bool(path and path.exists()),
        "bytes": path.stat().st_size if path and path.exists() else 0,
        "sha256": file_sha256(path) if path and path.exists() else None,
    }


def valid_sha256(value: Any) -> bool:
    return isinstance(value, str) and bool(re.fullmatch(r"[0-9a-f]{64}", value))


def scan_text(text: str) -> dict[str, int]:
    counts: dict[str, int] = {}
    for code, pattern in SENSITIVE_PATTERNS:
        count = len(pattern.findall(text))
        if count:
            counts[code] = count
    return counts


def finalize_dashboard(dashboard: dict[str, Any]) -> dict[str, Any]:
    source_artifacts = dashboard.get("source_artifacts") if isinstance(dashboard.get("source_artifacts"), list) else []
    missing_sources = sorted(
        str(item.get("label"))
        for item in source_artifacts
        if isinstance(item, dict) and item.get("present") is not True
    )
    invalid_hashes = sorted(
        str(item.get("label"))
        for item in source_artifacts
        if isinstance(item, dict)
        and item.get("present") is True
        and not valid_sha256(item.get("sha256"))
    )
    overall = dashboard.get("overall") if isinstance(dashboard.get("overall"), dict) else {}
    non_mutation_attested = (
        overall.get("corpus_bytes_mutated") is False
        and overall.get("s3_objects_mutated") is False
        and overall.get("metadata_rows_mutated") is False
    )
    tool_remediation = (
        dashboard.get("sections", {}).get("tool_remediation")
        if isinstance(dashboard.get("sections"), dict)
        and isinstance(dashboard.get("sections", {}).get("tool_remediation"), dict)
        else {}
    )
    tool_redaction = tool_remediation.get("redaction_check") if isinstance(tool_remediation.get("redaction_check"), dict) else {}
    approval_notes = (
        dashboard.get("sections", {}).get("operator_approval_notes")
        if isinstance(dashboard.get("sections"), dict)
        and isinstance(dashboard.get("sections", {}).get("operator_approval_notes"), dict)
        else {}
    )
    approval_redaction = approval_notes.get("redaction_check") if isinstance(approval_notes.get("redaction_check"), dict) else {}
    marker_counts = scan_text(json.dumps(dashboard, sort_keys=True))
    dashboard_errors = [f"source_artifact_missing:{label}" for label in missing_sources]
    dashboard_errors.extend(f"source_artifact_sha256_invalid:{label}" for label in invalid_hashes)
    if marker_counts:
        dashboard_errors.append("sensitive_marker_hits")
    if not non_mutation_attested:
        dashboard_errors.append("non_mutation_attestation_invalid")
    if tool_redaction.get("passed") is False:
        dashboard_errors.append("tool_remediation_redaction_failed")
    if approval_redaction.get("passed") is False:
        dashboard_errors.append("approval_notes_redaction_failed")

    dashboard["redaction_check"] = {
        "passed": not marker_counts,
        "sensitive_marker_counts": marker_counts,
    }
    dashboard["dashboard_checks"] = {
        "redaction_ok": not marker_counts,
        "source_artifacts_present": not missing_sources,
        "source_artifact_hashes_ok": not invalid_hashes,
        "non_mutation_attested": non_mutation_attested,
        "tool_remediation_redaction_ok": tool_redaction.get("passed") is not False,
        "approval_notes_redaction_ok": approval_redaction.get("passed") is not False,
    }
    dashboard["dashboard_errors"] = dashboard_errors
    return dashboard


def command_subset(value: dict[str, Any] | None, names: list[str]) -> dict[str, str]:
    commands = value.get("commands") if isinstance(value, dict) and isinstance(value.get("commands"), dict) else {}
    output: dict[str, str] = {}
    for name in names:
        command = commands.get(name)
        if isinstance(command, str):
            output[name] = command
    return output


def count_requirements(lanes: list[dict[str, Any]]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for lane in lanes:
        requirements = lane.get("requirements")
        if not isinstance(requirements, list):
            continue
        for requirement in requirements:
            key = str(requirement)
            counts[key] = counts.get(key, 0) + 1
    return dict(sorted(counts.items()))


def lane_summary(readiness: dict[str, Any] | None, lane: str) -> dict[str, Any]:
    lanes = readiness.get("lanes") if isinstance(readiness, dict) and isinstance(readiness.get("lanes"), list) else []
    for item in lanes:
        if isinstance(item, dict) and item.get("lane") == lane:
            return {
                "present": True,
                "route_status": item.get("route_status"),
                "active_files": item.get("active_files"),
                "active_bytes": item.get("active_bytes"),
                "tool_status": item.get("tool_status"),
                "tool_inventory_source": item.get("tool_inventory_source"),
                "provider_required": item.get("provider_required"),
                "large_file_runner_required_files": item.get("large_file_runner_required_files"),
                "deferred_media_files": item.get("deferred_media_files"),
                "requirements": item.get("requirements") if isinstance(item.get("requirements"), list) else [],
            }
    return {"present": False}


def smoke_lane_summary(smoke: dict[str, Any] | None, lane: str) -> dict[str, Any]:
    by_lane = smoke.get("by_lane") if isinstance(smoke, dict) and isinstance(smoke.get("by_lane"), dict) else {}
    value = by_lane.get(lane)
    if not isinstance(value, dict):
        return {"present": False}
    return {
        "present": True,
        "samples": int(value.get("samples") or 0),
        "routed": int(value.get("routed") or 0),
        "usable": int(value.get("usable") or 0),
        "failed": int(value.get("failed") or 0),
        "not_implemented": int(value.get("not_implemented") or 0),
        "skipped_size": int(value.get("skipped_size") or 0),
    }


def validation_summary(value: dict[str, Any] | None) -> dict[str, Any]:
    if not value:
        return {"present": False}
    return {
        "present": True,
        "status": value.get("status") or ("ok" if value.get("errors") == [] else None),
        "approved": value.get("approved"),
        "jobs_planned": value.get("jobs_planned"),
        "bytes_planned": value.get("bytes_planned"),
        "errors_count": len(value.get("errors") or []),
        "warnings_count": len(value.get("warnings") or []),
        "plan_private_id_leaks": value.get("plan_private_id_leaks"),
        "plan_sensitive_marker_hits": value.get("plan_sensitive_marker_hits"),
    }


def approval_packet_summary(value: dict[str, Any] | None) -> dict[str, Any]:
    if not value:
        return {"present": False}
    planned = value.get("planned") if isinstance(value.get("planned"), dict) else {}
    coverage = value.get("coverage") if isinstance(value.get("coverage"), dict) else {}
    return {
        "present": True,
        "kind": value.get("kind"),
        "status": value.get("status") or value.get("plan_status"),
        "approval_required": bool(value.get("approval_required")),
        "approved": bool(value.get("approved")),
        "planned_jobs": planned.get("jobs") or value.get("jobs_planned"),
        "planned_bytes": planned.get("bytes") or value.get("bytes_planned"),
        "coverage": {
            key: coverage.get(key)
            for key in ("active_files", "indexed_files", "missing_files", "stale_only_files")
            if key in coverage
        },
    }


def runtime_approval_summary(value: dict[str, Any] | None) -> dict[str, Any]:
    if not value:
        return {"present": False}
    attestation = value.get("approval_attestation") if isinstance(value.get("approval_attestation"), dict) else {}
    scale = value.get("scale_readiness_attestation") if isinstance(value.get("scale_readiness_attestation"), dict) else {}
    search_probe = value.get("search_probe_attestation") if isinstance(value.get("search_probe_attestation"), dict) else {}
    return {
        "present": True,
        "status": value.get("status"),
        "approved": value.get("approved"),
        "approval_attestation": {
            "status": attestation.get("status"),
            "decision": attestation.get("decision"),
            "runtime_enforced": attestation.get("runtime_enforced"),
            "execute_requested": attestation.get("execute_requested"),
            "plan_approved": attestation.get("plan_approved"),
            "validation_status": attestation.get("validation_status"),
            "jobs_selected": attestation.get("jobs_selected"),
            "shards_selected": attestation.get("shards_selected"),
        },
        "scale_readiness_status": scale.get("status"),
        "search_probe": {
            "status": search_probe.get("status"),
            "probes": search_probe.get("probes"),
            "matched_expected_file_probes": search_probe.get("matched_expected_file_probes"),
            "failed_probes": search_probe.get("failed_probes"),
            "skipped_probes": search_probe.get("skipped_probes"),
            "latency_budget_ms": search_probe.get("latency_budget_ms"),
            "max_latency_ms": search_probe.get("max_latency_ms"),
            "p95_latency_ms": search_probe.get("p95_latency_ms"),
            "private_probe_results_sha256": search_probe.get("private_probe_results_sha256"),
        },
    }


def approval_notes_summary(value: dict[str, Any] | None) -> dict[str, Any]:
    if not value:
        return {
            "present": False,
            "status": "missing",
            "required_decision_count": 0,
            "approved_required_decision_count": 0,
            "missing_required_decisions": [],
            "invalid_required_decisions": [],
        }
    return {
        "present": True,
        "status": value.get("status"),
        "artifact_count": value.get("artifact_count"),
        "valid_artifact_count": value.get("valid_artifact_count"),
        "required_decision_count": value.get("required_decision_count"),
        "approved_required_decision_count": value.get("approved_required_decision_count"),
        "approval_request_packet_present": value.get("approval_request_packet_present"),
        "approval_request_packet_status": value.get("approval_request_packet_status"),
        "approval_request_template_count": value.get("approval_request_template_count"),
        "missing_required_decisions": value.get("missing_required_decisions") if isinstance(value.get("missing_required_decisions"), list) else [],
        "invalid_required_decisions": value.get("invalid_required_decisions") if isinstance(value.get("invalid_required_decisions"), list) else [],
        "duplicate_decisions": value.get("duplicate_decisions") if isinstance(value.get("duplicate_decisions"), list) else [],
        "redaction_check": value.get("redaction_check") if isinstance(value.get("redaction_check"), dict) else None,
    }


def approval_note_for(value: dict[str, Any] | None, decision_id: str) -> dict[str, Any]:
    if not value:
        return {
            "summary_present": False,
            "present": False,
            "valid": False,
            "status": None,
            "approved": False,
            "errors": ["approval_notes_summary_missing"],
        }
    items = value.get("required_decisions") if isinstance(value.get("required_decisions"), list) else []
    for item in items:
        if not isinstance(item, dict) or item.get("decision_id") != decision_id:
            continue
        errors = item.get("errors") if isinstance(item.get("errors"), list) else []
        return {
            "summary_present": True,
            "present": item.get("present") is True,
            "valid": item.get("valid") is True,
            "status": item.get("status"),
            "approved": item.get("valid") is True and item.get("status") == "approved",
            "scope": item.get("scope"),
            "approved_at": item.get("approved_at"),
            "expires_at": item.get("expires_at"),
            "approved_by_present": item.get("approved_by_present") is True,
            "approval_note_present": item.get("approval_note_present") is True,
            "approval_note_sha256": item.get("approval_note_sha256"),
            "approval_request_checked": item.get("approval_request_checked"),
            "remediation_action_ids": item.get("remediation_action_ids") if isinstance(item.get("remediation_action_ids"), list) else [],
            "remediation_status": item.get("remediation_status"),
            "command_hashes_match": item.get("command_hashes_match"),
            "artifact_sha256": item.get("artifact_sha256"),
            "errors": errors,
        }
    return {
        "summary_present": True,
        "present": False,
        "valid": False,
        "status": None,
        "approved": False,
        "errors": ["approval_note_decision_missing"],
    }


def worker_image_summary(approval: dict[str, Any] | None, verification: dict[str, Any] | None) -> dict[str, Any]:
    gates = approval.get("gates") if isinstance(approval, dict) and isinstance(approval.get("gates"), dict) else {}
    current = approval.get("current_verification") if isinstance(approval, dict) and isinstance(approval.get("current_verification"), dict) else {}
    runtime_policy = approval.get("worker_runtime_policy") if isinstance(approval, dict) and isinstance(approval.get("worker_runtime_policy"), dict) else {}
    docker = verification.get("docker") if isinstance(verification, dict) and isinstance(verification.get("docker"), dict) else {}
    return {
        "approval": approval_packet_summary(approval),
        "static_verification_ok": gates.get("static_verification_ok"),
        "worker_runtime_policy_ok": gates.get("worker_runtime_policy_ok"),
        "worker_runtime_network_disabled": gates.get("worker_runtime_network_disabled"),
        "worker_runtime_provider_egress_disabled": gates.get("worker_runtime_provider_egress_disabled"),
        "worker_runtime_s3_access_disabled": gates.get("worker_runtime_s3_access_disabled"),
        "worker_runtime_db_access_disabled": gates.get("worker_runtime_db_access_disabled"),
        "worker_runtime_corpus_mounts_disabled": gates.get("worker_runtime_corpus_mounts_disabled"),
        "worker_runtime_logs_hashed_only": gates.get("worker_runtime_logs_hashed_only"),
        "worker_runtime_policy": {
            "present": runtime_policy.get("present"),
            "status": runtime_policy.get("status"),
            "network_mode": runtime_policy.get("network_mode"),
            "network_disabled": runtime_policy.get("network_disabled"),
            "provider_egress_allowed": runtime_policy.get("provider_egress_allowed"),
            "s3_object_access_allowed": runtime_policy.get("s3_object_access_allowed"),
            "db_access_allowed": runtime_policy.get("db_access_allowed"),
            "corpus_mounts_allowed": runtime_policy.get("corpus_mounts_allowed"),
            "command_logs_hashed_only": runtime_policy.get("command_logs_hashed_only"),
        },
        "docker_access_available": gates.get("docker_access_available"),
        "runtime_build_smoke_complete": gates.get("runtime_build_smoke_complete"),
        "safe_to_request_operator_approval": gates.get("safe_to_request_operator_approval"),
        "docker_status": current.get("docker_status") or docker.get("status"),
        "next_actions": approval.get("current_verification", {}).get("next_actions") if isinstance(approval, dict) and isinstance(approval.get("current_verification"), dict) else [],
        "commands": command_subset(approval, [
            "refresh_static_verification",
            "approved_build_smoke_and_inventory",
            "rerun_readiness_gate_with_worker_inventory",
            "rebuild_adversarial_packet",
        ]),
    }


def tool_remediation_summary(value: dict[str, Any] | None) -> dict[str, Any]:
    if not value:
        return {"present": False}
    actions: list[dict[str, Any]] = []
    for item in value.get("actions") if isinstance(value.get("actions"), list) else []:
        if not isinstance(item, dict):
            continue
        actions.append({
            "id": item.get("id"),
            "priority": item.get("priority"),
            "category": item.get("category"),
            "lanes": item.get("lanes") if isinstance(item.get("lanes"), list) else [],
            "active_files": item.get("active_files"),
            "approval_required": item.get("approval_required"),
            "deferred_until_final_pass": item.get("deferred_until_final_pass"),
            "worker_image_can_help": item.get("worker_image_can_help"),
            "package_candidates": item.get("package_candidates") if isinstance(item.get("package_candidates"), list) else [],
            "safe_next_action": item.get("safe_next_action"),
        })
    return {
        "present": True,
        "kind": value.get("kind"),
        "status": value.get("status"),
        "summary": value.get("summary") if isinstance(value.get("summary"), dict) else {},
        "actions": actions,
        "redaction_check": value.get("redaction_check") if isinstance(value.get("redaction_check"), dict) else {},
    }


def build_dashboard(args: argparse.Namespace) -> dict[str, Any]:
    paths = {
        "extraction_readiness": Path(args.extraction_readiness).expanduser().resolve(),
        "tool_remediation": Path(args.tool_remediation).expanduser().resolve(),
        "ocr_smoke": Path(args.ocr_smoke).expanduser().resolve(),
        "worker_image_verification": Path(args.worker_image_verification).expanduser().resolve(),
        "worker_image_approval": Path(args.worker_image_approval).expanduser().resolve(),
        "search_index_approval": Path(args.search_index_approval).expanduser().resolve(),
        "search_index_validation": Path(args.search_index_validation).expanduser().resolve(),
        "search_index_runtime": Path(args.search_index_runtime).expanduser().resolve(),
        "large_file_approval": Path(args.large_file_approval).expanduser().resolve(),
        "large_file_validation": Path(args.large_file_validation).expanduser().resolve(),
        "large_file_dry_run_verification": Path(args.large_file_dry_run_verification).expanduser().resolve(),
        "llm_campaign_plan": Path(args.llm_campaign_plan).expanduser().resolve(),
        "llm_campaign_validation": Path(args.llm_campaign_validation).expanduser().resolve(),
        "llm_campaign_runtime": Path(args.llm_campaign_runtime).expanduser().resolve(),
        "llm_campaign_results": Path(args.llm_campaign_results).expanduser().resolve(),
        "deferred_media": Path(args.deferred_media).expanduser().resolve(),
        "approval_notes_summary": Path(args.approval_notes_summary).expanduser().resolve(),
    }
    loaded = {key: load_json(path) for key, path in paths.items()}

    readiness = loaded["extraction_readiness"]
    readiness_lanes = readiness.get("lanes") if isinstance(readiness, dict) and isinstance(readiness.get("lanes"), list) else []
    readiness_gate = readiness.get("gate") if isinstance(readiness, dict) and isinstance(readiness.get("gate"), dict) else {}
    readiness_totals = readiness.get("totals") if isinstance(readiness, dict) and isinstance(readiness.get("totals"), dict) else {}

    large_validation = validation_summary(loaded["large_file_validation"])
    large_approval = approval_packet_summary(loaded["large_file_approval"])
    large_dry = loaded["large_file_dry_run_verification"] or {}
    large_summary = {
        "approval": large_approval,
        "validation": large_validation,
        "dry_run_verification": {
            "present": bool(loaded["large_file_dry_run_verification"]),
            "status": large_dry.get("status"),
            "errors_count": len(large_dry.get("errors") or []) if isinstance(large_dry, dict) else None,
        },
        "commands": command_subset(loaded["large_file_approval"], [
            "regenerate_approved_plan",
            "execute_canary_after_approval",
            "verify_canary_after_execution",
            "collect_review_manifest_after_verification",
        ]),
    }

    search_summary = {
        "approval": approval_packet_summary(loaded["search_index_approval"]),
        "validation": validation_summary(loaded["search_index_validation"]),
        "runtime": runtime_approval_summary(loaded["search_index_runtime"]),
        "commands": command_subset(loaded["search_index_approval"], [
            "pre_stats",
            "regenerate_approved_plan",
            "execute_canary_after_approval",
            "verify_canary_after_execution",
            "post_stats",
        ]),
    }

    llm_plan = loaded["llm_campaign_plan"] or {}
    llm_results = loaded["llm_campaign_results"] or {}
    llm_summary = {
        "approval": {
            "present": bool(loaded["llm_campaign_plan"]),
            "approved": llm_plan.get("approved"),
            "approval_status": (llm_plan.get("approval_attestation") or {}).get("status") if isinstance(llm_plan.get("approval_attestation"), dict) else None,
            "jobs_planned": llm_plan.get("jobs_planned"),
            "shards": llm_plan.get("shards"),
            "worker_manifest_sanitized": llm_plan.get("worker_manifest_sanitized"),
        },
        "validation": validation_summary(loaded["llm_campaign_validation"]),
        "runtime": runtime_approval_summary(loaded["llm_campaign_runtime"]),
        "results": {
            "present": bool(loaded["llm_campaign_results"]),
            "rename_gate_status": (llm_results.get("rename_correctness_gate") or {}).get("status") if isinstance(llm_results.get("rename_correctness_gate"), dict) else None,
            "runtime_attestation_gate_status": (llm_results.get("runtime_attestation_gate") or {}).get("status") if isinstance(llm_results.get("runtime_attestation_gate"), dict) else None,
            "scale_readiness_status": (llm_results.get("scale_readiness_attestation") or {}).get("status") if isinstance(llm_results.get("scale_readiness_attestation"), dict) else None,
            "coverage": {
                key: (llm_results.get("coverage") or {}).get(key)
                for key in ("scheduled", "observed", "missing", "errors", "proposals")
                if isinstance(llm_results.get("coverage"), dict) and key in llm_results.get("coverage")
            },
        },
    }

    media = loaded["deferred_media"] or {}
    media_gate = media.get("completion_gate") if isinstance(media.get("completion_gate"), dict) else {}
    media_summary = {
        "present": bool(loaded["deferred_media"]),
        "status": media.get("status"),
        "active_media_files": media.get("active_media_files"),
        "active_media_bytes": media.get("active_media_bytes"),
        "completion_gate": {
            "complete": media_gate.get("complete"),
            "final_media_pass_required": media_gate.get("final_media_pass_required"),
            "cannot_hide_behind_boolean_deferral": media_gate.get("cannot_hide_behind_boolean_deferral"),
        },
    }

    ocr_summary = {
        "readiness_lane": lane_summary(readiness, "needs_ocr_or_vision"),
        "smoke_lane": smoke_lane_summary(loaded["ocr_smoke"], "needs_ocr_or_vision"),
        "approval_task": "Run approved OCR/vision lane canary and collect review jobs",
        "approval_required": True,
    }

    sections = {
        "extraction_readiness": {
            "status": readiness.get("status") if readiness else None,
            "totals": {
                key: readiness_totals.get(key)
                for key in (
                    "active_files",
                    "sampled_files",
                    "sampled_routed_files",
                    "sampled_failed_files",
                    "sampled_not_implemented_files",
                    "large_file_runner_required_files",
                    "deferred_media_files",
                    "pending_lanes",
                    "hard_blocker_lanes",
                )
                if key in readiness_totals
            },
            "gate": {
                key: readiness_gate.get(key)
                for key in (
                    "all_active_lanes_explicitly_routed",
                    "no_failed_smoke_samples",
                    "no_not_implemented_samples",
                    "requires_operator_approval_before_scale",
                    "requires_provider_or_tool_work",
                    "final_media_pass_required",
                    "full_extraction_complete",
                )
                if key in readiness_gate
            },
            "requirement_counts": count_requirements(readiness_lanes),
            "pending_lanes": readiness_gate.get("pending_lanes") if isinstance(readiness_gate.get("pending_lanes"), list) else [],
        },
        "tool_remediation": tool_remediation_summary(loaded["tool_remediation"]),
        "ocr_vision_canary": ocr_summary,
        "large_file_canary": large_summary,
        "archive_worker_image": worker_image_summary(loaded["worker_image_approval"], loaded["worker_image_verification"]),
        "search_index_population": search_summary,
        "llm_review_campaign": llm_summary,
        "deferred_media": media_summary,
        "operator_approval_notes": approval_notes_summary(loaded["approval_notes_summary"]),
    }

    approval_items = [
        {
            "id": "ocr_vision_canary",
            "priority": "critical",
            "status": ocr_summary["readiness_lane"].get("route_status"),
            "reason": "vision/OCR lane requires provider approval or deterministic OCR tooling before scalable semantic classification",
            "ready_for_approval": ocr_summary["readiness_lane"].get("present") is True,
            "approval_note": approval_note_for(loaded["approval_notes_summary"], "ocr_vision_canary"),
        },
        {
            "id": "large_file_canary",
            "priority": "critical",
            "status": large_approval.get("status"),
            "reason": "large PDF/Office/archive rows require approved bounded extraction canary before scale",
            "ready_for_approval": large_validation.get("status") in {"ok", None} and large_approval.get("approval_required") is True,
            "approval_note": approval_note_for(loaded["approval_notes_summary"], "large_file_canary"),
        },
        {
            "id": "archive_worker_image",
            "priority": "high",
            "status": (loaded["worker_image_approval"] or {}).get("status"),
            "reason": "archive 7z/rar worker build and smoke require Docker/CI access",
            "ready_for_approval": (loaded["worker_image_approval"] or {}).get("status") == "ready_for_operator_approval",
            "approval_note": approval_note_for(loaded["approval_notes_summary"], "archive_worker_image"),
        },
        {
            "id": "search_index_population",
            "priority": "high",
            "status": search_summary["approval"].get("status"),
            "reason": "fast searchable file CLI requires approved extraction/index canaries before full index population",
            "ready_for_approval": search_summary["validation"].get("status") == "ok" and search_summary["approval"].get("approval_required") is True,
            "approval_note": approval_note_for(loaded["approval_notes_summary"], "search_index_population"),
        },
        {
            "id": "llm_review_campaign",
            "priority": "high",
            "status": llm_summary["approval"].get("approval_status"),
            "reason": "semantic rename proposals require approved sanitized LLM campaign execution",
            "ready_for_approval": llm_summary["validation"].get("status") == "ok" and llm_summary["approval"].get("approved") is False,
            "approval_note": approval_note_for(loaded["approval_notes_summary"], "llm_review_campaign"),
        },
        {
            "id": "deferred_media_final_pass",
            "priority": "deferred",
            "status": "deferred",
            "reason": "audio/video processing intentionally remains deferred until final media pass",
            "ready_for_approval": False,
            "approval_note": approval_note_for(loaded["approval_notes_summary"], "deferred_media_final_pass"),
        },
    ]

    blockers = [
        item["id"]
        for item in approval_items
        if item["id"] != "deferred_media_final_pass" and item["ready_for_approval"] is not True
    ]
    approved_notes = [
        item["id"]
        for item in approval_items
        if item["id"] != "deferred_media_final_pass" and item.get("approval_note", {}).get("approved") is True
    ]
    missing_or_invalid_notes = [
        item["id"]
        for item in approval_items
        if item["id"] != "deferred_media_final_pass" and item.get("approval_note", {}).get("approved") is not True
    ]
    dashboard_status = "ready_for_operator_review" if not blockers else "needs_prep"

    dashboard = {
        "kind": "open_files_extraction_approval_dashboard",
        "version": 1,
        "created_at": now_utc(),
        "status": dashboard_status,
        "redaction": "aggregate-only; omits private filenames, file IDs, object keys, source refs, extracted text, transcripts, ACL payloads, row payloads, command logs, and secrets",
        "source_artifacts": [source_entry(label, path) for label, path in paths.items()],
        "overall": {
            "ready_for_operator_review": dashboard_status == "ready_for_operator_review",
            "ready_approval_items": sum(1 for item in approval_items if item["ready_for_approval"]),
            "approval_items": len([item for item in approval_items if item["id"] != "deferred_media_final_pass"]),
            "approved_approval_notes": len(approved_notes),
            "approval_notes_complete": len(missing_or_invalid_notes) == 0,
            "pending_approval_note_items": missing_or_invalid_notes,
            "blocked_or_missing_prep_items": blockers,
            "final_media_pass_deferred": True,
            "corpus_bytes_mutated": False,
            "s3_objects_mutated": False,
            "metadata_rows_mutated": False,
        },
        "approval_items": approval_items,
        "sections": sections,
    }
    return finalize_dashboard(dashboard)


def main() -> int:
    parser = argparse.ArgumentParser(description="Build consolidated extraction approval dashboard.")
    parser.add_argument("--extraction-readiness", default=".codewith/private-artifacts/extraction-lane-readiness-gate.json")
    parser.add_argument("--tool-remediation", default=".codewith/private-artifacts/extraction-tool-remediation-packet.json")
    parser.add_argument("--ocr-smoke", default=".codewith/private-artifacts/extraction-smoke-ocr-summary.json")
    parser.add_argument("--worker-image-verification", default=".codewith/private-artifacts/extraction-worker-image-verification.json")
    parser.add_argument("--worker-image-approval", default=".codewith/private-artifacts/extraction-worker-image-approval-packet.json")
    parser.add_argument("--search-index-approval", default=".codewith/private-artifacts/search-index-current-plan/search-index-approval-packet.json")
    parser.add_argument("--search-index-validation", default=".codewith/private-artifacts/search-index-current-plan/search-index-plan-validation.json")
    parser.add_argument("--search-index-runtime", default=".codewith/private-artifacts/search-index-nonmedia-plan/unapproved-execute-summary.json")
    parser.add_argument("--large-file-approval", default=".codewith/private-artifacts/large-file-canary-balanced-nonaudio/large-file-approval-packet.json")
    parser.add_argument("--large-file-validation", default=".codewith/private-artifacts/large-file-canary-balanced-nonaudio/large-file-extraction-validation-summary.json")
    parser.add_argument("--large-file-dry-run-verification", default=".codewith/private-artifacts/large-file-canary-balanced-nonaudio/large-file-dry-run-verification.json")
    parser.add_argument("--llm-campaign-plan", default=".codewith/private-artifacts/llm-campaigns/sanitized-one-job/campaign-plan.json")
    parser.add_argument("--llm-campaign-validation", default=".codewith/private-artifacts/llm-campaigns/sanitized-one-job/campaign-validation.json")
    parser.add_argument("--llm-campaign-runtime", default=".codewith/private-artifacts/llm-campaigns/sanitized-one-job/unapproved-execute-summary.json")
    parser.add_argument("--llm-campaign-results", default=".codewith/private-artifacts/llm-campaigns/sanitized-one-job/collected-results/campaign-results-summary.json")
    parser.add_argument("--deferred-media", default=".codewith/private-artifacts/deferred-media-completion/deferred-media-completion-summary.json")
    parser.add_argument("--approval-notes-summary", default=".codewith/private-artifacts/operator-approvals/approval-notes-summary.json")
    parser.add_argument("--output", default=DEFAULT_OUTPUT)
    args = parser.parse_args()

    dashboard = build_dashboard(args)
    output = Path(args.output).expanduser().resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(dashboard, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps({
        "kind": dashboard["kind"],
        "status": dashboard["status"],
        "overall": dashboard["overall"],
        "dashboard_checks": dashboard["dashboard_checks"],
        "dashboard_errors": dashboard["dashboard_errors"],
        "redaction_check": dashboard["redaction_check"],
    }, indent=2, sort_keys=True))
    return 0 if not dashboard["dashboard_errors"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
