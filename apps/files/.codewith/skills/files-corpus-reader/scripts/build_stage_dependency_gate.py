#!/usr/bin/env python3
"""Build an aggregate-only sequential stage dependency gate.

This artifact makes the open-files scale order explicit. It does not execute
jobs or read corpus content; it only combines aggregate readiness artifacts and
reports which stage blocks search/index/rename scale.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import time
from pathlib import Path
from typing import Any


def now_utc() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def file_sha256(path: Path) -> str:
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


def as_int(value: Any) -> int:
    try:
        return int(value or 0)
    except (TypeError, ValueError):
        return 0


def source_entry(label: str, path: Path | None) -> dict[str, Any]:
    return {
        "label": label,
        "present": bool(path and path.exists()),
        "bytes": path.stat().st_size if path and path.exists() else 0,
        "sha256": file_sha256(path) if path and path.exists() else None,
    }


def stage(
    key: str,
    order: int,
    complete: bool,
    blockers: list[str],
    evidence: dict[str, Any],
    *,
    required_for_scale: bool = True,
    deferred_until_final_pass: bool = False,
) -> dict[str, Any]:
    if complete:
        status = "complete"
    elif deferred_until_final_pass:
        status = "deferred"
    else:
        status = "blocked"
    return {
        "key": key,
        "order": order,
        "status": status,
        "complete": complete,
        "required_for_scale": required_for_scale,
        "deferred_until_final_pass": deferred_until_final_pass,
        "blockers": blockers,
        "evidence": evidence,
    }


def duplicate_stage(duplicate: dict[str, Any] | None) -> dict[str, Any]:
    if not duplicate:
        return stage(
            "duplicate_preserve_policy",
            10,
            False,
            ["duplicate preserve attestation missing"],
            {"present": False},
        )
    organization = duplicate.get("organization_duplicates") if isinstance(duplicate.get("organization_duplicates"), dict) else {}
    scale = duplicate.get("scale_readiness") if isinstance(duplicate.get("scale_readiness"), dict) else {}
    complete = duplicate.get("policy_ok") is True
    blockers = list(duplicate.get("blockers") or []) if isinstance(duplicate.get("blockers"), list) else []
    blockers = [
        item
        for item in blockers
        if item != "search index population still pending for planned survivor rows"
    ]
    return stage(
        "duplicate_preserve_policy",
        10,
        complete,
        blockers,
        {
            "present": True,
            "status": duplicate.get("status"),
            "policy_ok": duplicate.get("policy_ok"),
            "search_index_ready": duplicate.get("search_index_ready"),
            "active_duplicate_groups": organization.get("active_duplicate_groups"),
            "duplicate_non_survivor_rows": organization.get("duplicate_non_survivor_rows"),
            "groups_without_planned_or_indexed_survivor": organization.get("groups_without_planned_or_indexed_survivor"),
            "duplicate_non_survivor_rows_accidentally_planned": organization.get("duplicate_non_survivor_rows_accidentally_planned"),
            "scale_duplicate_policy_attested": scale.get("duplicate_policy_attested"),
        },
    )


def extraction_verification_gate(
    readiness: dict[str, Any] | None,
    verification: dict[str, Any] | None,
) -> tuple[bool, list[str], dict[str, Any]]:
    if not verification:
        return False, ["extraction lane readiness verification missing"], {
            "verification_present": False,
        }
    checks = verification.get("checks") if isinstance(verification.get("checks"), dict) else {}
    source_artifacts = verification.get("source_artifacts") if isinstance(verification.get("source_artifacts"), dict) else {}
    readiness_status = readiness.get("status") if isinstance(readiness, dict) else None
    gate_status = verification.get("gate_status")
    blockers: list[str] = []
    if verification.get("status") != "ok":
        blockers.append("extraction lane readiness verification is not ok")
    if gate_status != readiness_status:
        blockers.append("extraction lane readiness verification gate status does not match readiness gate")
    if checks.get("source_artifacts_present") is not True:
        blockers.append("extraction lane readiness verification source artifacts are incomplete")
    if checks.get("source_artifacts_current") is not True:
        blockers.append("extraction lane readiness verification source artifacts are not current")
    if checks.get("semantic_projection_current") is not True:
        blockers.append("extraction lane readiness semantic projection is not current")
    if checks.get("redaction_ok") is not True:
        blockers.append("extraction lane readiness verification redaction check is not ok")
    current_mismatched = source_artifacts.get("current_mismatched") if isinstance(source_artifacts.get("current_mismatched"), list) else []
    current_missing = source_artifacts.get("current_missing_paths") if isinstance(source_artifacts.get("current_missing_paths"), list) else []
    return not blockers, blockers, {
        "verification_present": True,
        "verification_status": verification.get("status"),
        "verification_gate_status": gate_status,
        "verification_source_artifacts_present": checks.get("source_artifacts_present"),
        "verification_source_artifacts_current": checks.get("source_artifacts_current"),
        "verification_semantic_projection_current": checks.get("semantic_projection_current"),
        "verification_redaction_ok": checks.get("redaction_ok"),
        "verification_current_checked": source_artifacts.get("current_checked"),
        "verification_current_mismatched": len(current_mismatched),
        "verification_current_missing_paths": len(current_missing),
    }


def extraction_stage(
    readiness: dict[str, Any] | None,
    readiness_verification: dict[str, Any] | None,
) -> dict[str, Any]:
    if not readiness:
        verification_ok, verification_blockers, verification_evidence = extraction_verification_gate(readiness, readiness_verification)
        return stage(
            "extraction_lane_readiness",
            20,
            False,
            ["extraction lane readiness gate missing", *verification_blockers],
            {"present": False, **verification_evidence, "verification_ok": verification_ok},
        )
    gate = readiness.get("gate") if isinstance(readiness.get("gate"), dict) else {}
    totals = readiness.get("totals") if isinstance(readiness.get("totals"), dict) else {}
    status_counts = readiness.get("status_counts") if isinstance(readiness.get("status_counts"), dict) else {}
    pending = as_int(totals.get("pending_lanes"))
    hard = as_int(totals.get("hard_blocker_lanes"))
    sampled_no_usable = as_int(totals.get("sampled_no_usable_lanes"))
    verification_ok, verification_blockers, verification_evidence = extraction_verification_gate(readiness, readiness_verification)
    complete = (
        gate.get("full_extraction_complete") is True
        and pending == 0
        and hard == 0
        and sampled_no_usable == 0
        and gate.get("all_sampled_non_deferred_non_approval_lanes_have_usable_output") is not False
        and gate.get("requires_provider_or_tool_work") is not True
        and gate.get("final_media_pass_required") is not True
        and verification_ok
    )
    blockers: list[str] = list(verification_blockers)
    if gate.get("all_active_lanes_explicitly_routed") is not True:
        blockers.append("not all active lanes are explicitly routed")
    if hard:
        blockers.append("hard blocker lanes remain")
    if pending:
        blockers.append("pending extraction lanes remain")
    if sampled_no_usable:
        blockers.append("sampled lanes produced no usable extraction output")
    if gate.get("all_sampled_non_deferred_non_approval_lanes_have_usable_output") is False and not sampled_no_usable:
        blockers.append("sampled lane usability gate is false")
    if gate.get("requires_provider_or_tool_work") is True:
        blockers.append("provider or tool work is still required")
    if gate.get("final_media_pass_required") is True:
        blockers.append("final media pass is still required")
    return stage(
        "extraction_lane_readiness",
        20,
        complete,
        blockers,
        {
            "present": True,
            "status": readiness.get("status"),
            "verification_ok": verification_ok,
            **verification_evidence,
            "full_extraction_complete": gate.get("full_extraction_complete"),
            "requires_operator_approval_before_scale": gate.get("requires_operator_approval_before_scale"),
            "requires_provider_or_tool_work": gate.get("requires_provider_or_tool_work"),
            "final_media_pass_required": gate.get("final_media_pass_required"),
            "all_sampled_non_deferred_non_approval_lanes_have_usable_output": gate.get("all_sampled_non_deferred_non_approval_lanes_have_usable_output"),
            "pending_lanes": pending,
            "hard_blocker_lanes": hard,
            "sampled_no_usable_lanes": sampled_no_usable,
            "status_counts": status_counts,
        },
    )


def media_stage(media: dict[str, Any] | None) -> dict[str, Any]:
    if not media:
        return stage(
            "deferred_media_final_pass",
            30,
            False,
            ["deferred media completion summary missing"],
            {"present": False},
            deferred_until_final_pass=True,
        )
    gate = media.get("completion_gate") if isinstance(media.get("completion_gate"), dict) else {}
    totals = media.get("totals") if isinstance(media.get("totals"), dict) else {}
    unresolved = as_int(totals.get("unresolved_media_files"))
    complete = gate.get("complete") is True and unresolved == 0
    blockers: list[str] = []
    if gate.get("final_media_pass_required") is True:
        blockers.append("final media transcription/keyframe pass required")
    if unresolved:
        blockers.append("unresolved media files remain")
    return stage(
        "deferred_media_final_pass",
        30,
        complete,
        blockers,
        {
            "present": True,
            "status": media.get("status"),
            "active_media_files": totals.get("active_media_files"),
            "indexed_media_files": totals.get("indexed_media_files"),
            "unresolved_media_files": unresolved,
            "completion_gate_complete": gate.get("complete"),
            "final_media_pass_required": gate.get("final_media_pass_required"),
        },
        deferred_until_final_pass=not complete,
    )


def approval_stage(
    dashboard: dict[str, Any] | None,
    drive_notes: dict[str, Any] | None,
    drive_notes_verification: dict[str, Any] | None,
) -> dict[str, Any]:
    if not dashboard:
        return stage(
            "operator_approval_dashboard",
            40,
            False,
            ["operator approval dashboard missing"],
            {"present": False},
        )
    overall = dashboard.get("overall") if isinstance(dashboard.get("overall"), dict) else {}
    blocked = overall.get("blocked_or_missing_prep_items") if isinstance(overall.get("blocked_or_missing_prep_items"), list) else []
    ready_items = as_int(overall.get("ready_approval_items"))
    approval_items = as_int(overall.get("approval_items"))
    approved_notes = as_int(overall.get("approved_approval_notes"))
    notes_complete = overall.get("approval_notes_complete") is True
    drive_required = as_int((drive_notes or {}).get("required_decision_count")) if isinstance(drive_notes, dict) else 0
    drive_approved = as_int((drive_notes or {}).get("approved_required_decision_count")) if isinstance(drive_notes, dict) else 0
    drive_missing = len((drive_notes or {}).get("missing_required_decisions") or []) if isinstance(drive_notes, dict) and isinstance((drive_notes or {}).get("missing_required_decisions"), list) else 0
    drive_invalid = len((drive_notes or {}).get("invalid_required_decisions") or []) if isinstance(drive_notes, dict) and isinstance((drive_notes or {}).get("invalid_required_decisions"), list) else 0
    drive_notes_status = (drive_notes or {}).get("status") if isinstance(drive_notes, dict) else None
    drive_verification_status = (drive_notes_verification or {}).get("status") if isinstance(drive_notes_verification, dict) else None
    drive_complete = (
        drive_notes_status == "approved"
        and drive_required > 0
        and drive_approved >= drive_required
        and drive_missing == 0
        and drive_invalid == 0
        and drive_verification_status == "ok"
    )
    complete = overall.get("ready_for_operator_review") is True and notes_complete and not blocked and drive_complete
    blockers: list[str] = []
    if ready_items and not notes_complete:
        blockers.append("operator approval items remain")
    if approval_items and approved_notes < approval_items:
        blockers.append("validated operator approval notes are incomplete")
    if blocked:
        blockers.append("blocked or missing prep items remain")
    if not isinstance(drive_notes, dict):
        blockers.append("Drive approval notes summary missing")
    elif drive_required and (drive_notes_status != "approved" or drive_approved < drive_required or drive_missing or drive_invalid):
        blockers.append("validated Drive approval notes are incomplete")
    elif drive_required == 0:
        blockers.append("Drive approval note decision set is empty")
    if drive_verification_status != "ok":
        blockers.append("Drive approval notes verification is not ok")
    return stage(
        "operator_approval_dashboard",
        40,
        complete,
        blockers,
        {
            "present": True,
            "status": dashboard.get("status"),
            "ready_for_operator_review": overall.get("ready_for_operator_review"),
            "ready_approval_items": ready_items,
            "approval_items": approval_items,
            "approved_approval_notes": approved_notes,
            "approval_notes_complete": notes_complete,
            "blocked_or_missing_prep_items": len(blocked),
            "final_media_pass_deferred": overall.get("final_media_pass_deferred"),
            "drive_approval_notes_status": drive_notes_status,
            "drive_approval_notes_verification_status": drive_verification_status,
            "drive_required_decision_count": drive_required,
            "drive_approved_required_decision_count": drive_approved,
            "drive_missing_required_decisions": drive_missing,
            "drive_invalid_required_decisions": drive_invalid,
        },
    )


def search_stage(search_runtime: dict[str, Any] | None, duplicate: dict[str, Any] | None) -> list[dict[str, Any]]:
    if not search_runtime:
        base_evidence = {"present": False}
        return [
            stage("search_index_canary", 50, False, ["search-index runtime summary missing"], base_evidence),
            stage("search_index_full_population", 60, False, ["search-index runtime summary missing"], base_evidence),
        ]
    scale = search_runtime.get("scale_readiness_attestation") if isinstance(search_runtime.get("scale_readiness_attestation"), dict) else {}
    runtime = search_runtime.get("runtime_attestation") if isinstance(search_runtime.get("runtime_attestation"), dict) else {}
    search_probe = search_runtime.get("search_probe_attestation") if isinstance(search_runtime.get("search_probe_attestation"), dict) else {}
    canary = scale.get("canary") if isinstance(scale.get("canary"), dict) else {}
    full = scale.get("full_run") if isinstance(scale.get("full_run"), dict) else {}
    duplicate_scale = duplicate.get("scale_readiness") if isinstance(duplicate, dict) and isinstance(duplicate.get("scale_readiness"), dict) else {}
    search_probe_ok = search_probe.get("status") == "ok"
    canary_complete = canary.get("verified") is True and runtime.get("status") == "ok" and search_probe_ok
    full_complete = full.get("verified") is True and duplicate_scale.get("approved_to_scale") is True and search_probe_ok
    canary_blockers: list[str] = []
    if canary.get("verified") is not True:
        canary_blockers.append("search-index canary is not verified")
    if runtime.get("status") != "ok":
        canary_blockers.append("search-index runtime attestation is not ok")
    if not search_probe_ok:
        canary_blockers.append("search-index CLI search probe is not ok")
    full_blockers: list[str] = []
    if full.get("verified") is not True:
        full_blockers.append("search-index full run is not verified")
    if duplicate_scale.get("approved_to_scale") is not True:
        full_blockers.append("duplicate/search-index scale readiness is not approved")
    if not search_probe_ok:
        full_blockers.append("search-index CLI search probe is not ok")
    evidence = {
        "present": True,
        "status": search_runtime.get("status"),
        "scale_readiness_status": scale.get("status"),
        "runtime_attestation_status": runtime.get("status"),
        "search_probe_status": search_probe.get("status"),
        "search_probe_probes": search_probe.get("probes"),
        "search_probe_max_latency_ms": search_probe.get("max_latency_ms"),
        "search_probe_latency_budget_ms": search_probe.get("latency_budget_ms"),
        "canary_verified": canary.get("verified"),
        "full_run_verified": full.get("verified"),
        "remaining_jobs": full.get("remaining_jobs"),
    }
    return [
        stage("search_index_canary", 50, canary_complete, canary_blockers, evidence),
        stage("search_index_full_population", 60, full_complete, full_blockers, evidence),
    ]


def provider_stage(provider_readiness: dict[str, Any] | None) -> dict[str, Any]:
    if not provider_readiness:
        return stage(
            "llm_provider_readiness",
            70,
            False,
            ["LLM provider readiness summary missing"],
            {"present": False},
        )
    policy = provider_readiness.get("direct_provider_policy_gate") if isinstance(provider_readiness.get("direct_provider_policy_gate"), dict) else {}
    checks = policy.get("checks") if isinstance(policy.get("checks"), dict) else {}
    schedule = provider_readiness.get("schedule_gate") if isinstance(provider_readiness.get("schedule_gate"), dict) else {}
    non_mutation = provider_readiness.get("non_mutation_attestation") if isinstance(provider_readiness.get("non_mutation_attestation"), dict) else {}
    redaction = provider_readiness.get("redaction_check") if isinstance(provider_readiness.get("redaction_check"), dict) else {}
    required_policy_checks = (
        "status_ok",
        "real_file_ids_not_sent",
        "raw_file_bytes_not_sent",
        "raw_extracts_not_sent",
        "secret_values_not_sent",
        "provider_data_collection_denied",
        "provider_data_collection_allowed_count_zero",
        "allowed_hosts_safe",
    )
    non_mutation_keys = (
        "provider_calls_made",
        "corpus_bytes_mutated",
        "s3_objects_mutated",
        "metadata_rows_mutated",
        "search_index_rows_mutated",
    )
    blockers: list[str] = []
    if provider_readiness.get("status") != "ok":
        blockers.append("LLM provider readiness status is not ok")
    if policy.get("status") != "ok" or any(checks.get(key) is not True for key in required_policy_checks):
        blockers.append("LLM provider privacy policy gate is not ok")
    if schedule.get("status") != "ok" or as_int(schedule.get("invalid_account_count")) != 0 or as_int(schedule.get("max_campaign_parallel")) < 1:
        blockers.append("LLM provider schedule gate is not ok")
    if any(non_mutation.get(key) is not False for key in non_mutation_keys):
        blockers.append("LLM provider readiness check is not non-mutating")
    if redaction.get("passed") is not True or bool(redaction.get("sensitive_marker_counts")):
        blockers.append("LLM provider readiness redaction check is not passed")
    return stage(
        "llm_provider_readiness",
        70,
        not blockers,
        blockers,
        {
            "present": True,
            "status": provider_readiness.get("status"),
            "policy_status": policy.get("status"),
            "schedule_status": schedule.get("status"),
            "invalid_account_count": as_int(schedule.get("invalid_account_count")),
            "max_campaign_parallel": as_int(schedule.get("max_campaign_parallel")),
            "provider_calls_made": non_mutation.get("provider_calls_made"),
            "corpus_bytes_mutated": non_mutation.get("corpus_bytes_mutated"),
            "s3_objects_mutated": non_mutation.get("s3_objects_mutated"),
            "metadata_rows_mutated": non_mutation.get("metadata_rows_mutated"),
            "search_index_rows_mutated": non_mutation.get("search_index_rows_mutated"),
            "redaction_passed": redaction.get("passed"),
        },
    )


def llm_stage(llm_results: dict[str, Any] | None) -> list[dict[str, Any]]:
    if not llm_results:
        base_evidence = {"present": False}
        return [
            stage("llm_rename_canary", 80, False, ["LLM campaign result summary missing"], base_evidence),
            stage("llm_rename_full_campaign", 90, False, ["LLM campaign result summary missing"], base_evidence),
            stage("metadata_apply_readiness", 100, False, ["LLM campaign result summary missing"], base_evidence),
        ]
    scale = llm_results.get("scale_readiness_attestation") if isinstance(llm_results.get("scale_readiness_attestation"), dict) else {}
    canary = scale.get("canary") if isinstance(scale.get("canary"), dict) else {}
    full = scale.get("full_run") if isinstance(scale.get("full_run"), dict) else {}
    rename = llm_results.get("rename_correctness_gate") if isinstance(llm_results.get("rename_correctness_gate"), dict) else {}
    runtime = llm_results.get("runtime_attestation_gate") if isinstance(llm_results.get("runtime_attestation_gate"), dict) else {}
    canary_complete = canary.get("verified") is True and rename.get("status") == "ok" and runtime.get("status") == "ok"
    full_complete = full.get("verified") is True and canary_complete
    apply_complete = rename.get("metadata_apply_ready") is True and full_complete
    evidence = {
        "present": True,
        "status": llm_results.get("status"),
        "scale_readiness_status": scale.get("status"),
        "canary_verified": canary.get("verified"),
        "full_run_verified": full.get("verified"),
        "remaining_jobs": full.get("remaining_jobs"),
        "rename_gate_status": rename.get("status"),
        "runtime_attestation_gate_status": runtime.get("status"),
        "metadata_apply_ready": rename.get("metadata_apply_ready"),
    }
    canary_blockers: list[str] = []
    if canary.get("verified") is not True:
        canary_blockers.append("LLM rename canary is not verified")
    if rename.get("status") != "ok":
        canary_blockers.append("rename correctness gate is not ok")
    if runtime.get("status") != "ok":
        canary_blockers.append("LLM runtime attestation gate is not ok")
    full_blockers = [] if full_complete else ["LLM rename full campaign is not verified"]
    apply_blockers = [] if apply_complete else ["metadata apply is not ready and still requires reviewed proposals"]
    return [
        stage("llm_rename_canary", 80, canary_complete, canary_blockers, evidence),
        stage("llm_rename_full_campaign", 90, full_complete, full_blockers, evidence),
        stage("metadata_apply_readiness", 100, apply_complete, apply_blockers, evidence),
    ]


def build_gate(
    extraction_readiness: dict[str, Any] | None,
    extraction_readiness_verification: dict[str, Any] | None,
    deferred_media: dict[str, Any] | None,
    search_runtime: dict[str, Any] | None,
    provider_readiness: dict[str, Any] | None,
    llm_results: dict[str, Any] | None,
    duplicate_attestation: dict[str, Any] | None,
    approval_dashboard: dict[str, Any] | None,
    drive_approval_notes: dict[str, Any] | None = None,
    drive_approval_notes_verification: dict[str, Any] | None = None,
    sources: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    stages = [
        duplicate_stage(duplicate_attestation),
        extraction_stage(extraction_readiness, extraction_readiness_verification),
        media_stage(deferred_media),
        approval_stage(approval_dashboard, drive_approval_notes, drive_approval_notes_verification),
        *search_stage(search_runtime, duplicate_attestation),
        provider_stage(provider_readiness),
        *llm_stage(llm_results),
    ]
    stages.sort(key=lambda item: int(item["order"]))
    blocking = [item for item in stages if item["required_for_scale"] and item["complete"] is not True]
    hard_blocking = [item for item in blocking if item["deferred_until_final_pass"] is not True]
    current_index = next((int(item["order"]) for item in stages if item["complete"] is not True), None)
    return {
        "kind": "open_files_stage_dependency_gate",
        "version": 1,
        "generated_at": now_utc(),
        "status": "ready_to_scale" if not blocking else "blocked",
        "approved_to_scale": not blocking,
        "current_stage_order": current_index,
        "first_blocking_stage": blocking[0]["key"] if blocking else None,
        "blocking_stage_count": len(blocking),
        "hard_blocking_stage_count": len(hard_blocking),
        "deferred_stage_count": sum(1 for item in stages if item["status"] == "deferred"),
        "stages": stages,
        "scale_rules": {
            "requires_duplicate_policy_attested": True,
            "requires_extraction_lanes_complete": True,
            "requires_final_media_pass_for_full_replacement": True,
            "requires_operator_approval_items_resolved": True,
            "requires_search_index_canary_and_full_population": True,
            "requires_llm_provider_readiness": True,
            "requires_llm_rename_canary_full_campaign_and_runtime_attestation": True,
            "requires_metadata_apply_after_review_only": True,
        },
        "source_artifacts": sources or [],
        "redaction": "stage dependency gate contains aggregate counts and booleans only; no file IDs, filenames, object keys, source refs, extracted text, transcripts, ACL payloads, row payloads, or secrets",
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Build aggregate-only open-files stage dependency gate.")
    parser.add_argument("--extraction-readiness-gate", required=True)
    parser.add_argument("--extraction-readiness-verification", required=True)
    parser.add_argument("--deferred-media-summary", required=True)
    parser.add_argument("--search-index-runtime-summary", required=True)
    parser.add_argument("--llm-provider-readiness", required=True)
    parser.add_argument("--llm-campaign-results-summary", required=True)
    parser.add_argument("--duplicate-preserve-attestation", required=True)
    parser.add_argument("--extraction-approval-dashboard", required=True)
    parser.add_argument("--drive-approval-notes-summary", required=True)
    parser.add_argument("--drive-approval-notes-verification", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    output = Path(args.output).expanduser().resolve()
    paths = {
        "extraction_readiness_gate": Path(args.extraction_readiness_gate).expanduser().resolve(),
        "extraction_readiness_verification": Path(args.extraction_readiness_verification).expanduser().resolve(),
        "deferred_media_summary": Path(args.deferred_media_summary).expanduser().resolve(),
        "search_index_runtime_summary": Path(args.search_index_runtime_summary).expanduser().resolve(),
        "llm_provider_readiness": Path(args.llm_provider_readiness).expanduser().resolve(),
        "llm_campaign_results_summary": Path(args.llm_campaign_results_summary).expanduser().resolve(),
        "duplicate_preserve_attestation": Path(args.duplicate_preserve_attestation).expanduser().resolve(),
        "extraction_approval_dashboard": Path(args.extraction_approval_dashboard).expanduser().resolve(),
        "drive_approval_notes_summary": Path(args.drive_approval_notes_summary).expanduser().resolve(),
        "drive_approval_notes_verification": Path(args.drive_approval_notes_verification).expanduser().resolve(),
    }
    gate = build_gate(
        load_json(paths["extraction_readiness_gate"]),
        load_json(paths["extraction_readiness_verification"]),
        load_json(paths["deferred_media_summary"]),
        load_json(paths["search_index_runtime_summary"]),
        load_json(paths["llm_provider_readiness"]),
        load_json(paths["llm_campaign_results_summary"]),
        load_json(paths["duplicate_preserve_attestation"]),
        load_json(paths["extraction_approval_dashboard"]),
        load_json(paths["drive_approval_notes_summary"]),
        load_json(paths["drive_approval_notes_verification"]),
        sources=[source_entry(label, path) for label, path in paths.items()],
    )
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(gate, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps(gate, indent=2, sort_keys=True))
    return 0 if gate["status"] != "ready_to_scale" else 0


if __name__ == "__main__":
    raise SystemExit(main())
