#!/usr/bin/env python3
"""Build an aggregate-only final Google Drive replacement readiness gate."""

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


def load_json(path: Path) -> dict[str, Any]:
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


def as_int(value: Any) -> int:
    try:
        return int(value or 0)
    except (TypeError, ValueError):
        return 0


def stage_by_key(stage_gate: dict[str, Any], key: str) -> dict[str, Any]:
    stages = stage_gate.get("stages") if isinstance(stage_gate.get("stages"), list) else []
    for stage in stages:
        if isinstance(stage, dict) and stage.get("key") == key:
            return stage
    return {}


def requirement(key: str, title: str, status: str, blockers: list[str], evidence: dict[str, Any]) -> dict[str, Any]:
    return {
        "key": key,
        "title": title,
        "status": status,
        "complete": status == "complete",
        "blockers": blockers,
        "evidence": evidence,
    }


def blocked_or_complete(complete: bool, blockers: list[str]) -> str:
    return "complete" if complete and not blockers else "blocked"


def extraction_verification_gate(
    extraction_gate: dict[str, Any],
    verification: dict[str, Any] | None,
) -> tuple[bool, list[str], dict[str, Any]]:
    if not verification:
        return False, ["extraction lane readiness verification missing"], {
            "verification_present": False,
        }
    checks = verification.get("checks") if isinstance(verification.get("checks"), dict) else {}
    source_artifacts = verification.get("source_artifacts") if isinstance(verification.get("source_artifacts"), dict) else {}
    gate_status = verification.get("gate_status")
    readiness_status = extraction_gate.get("status")
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


def build_gate(
    *,
    stage_gate: dict[str, Any],
    extraction_gate: dict[str, Any],
    extraction_verification: dict[str, Any] | None,
    media_summary: dict[str, Any],
    approval_dashboard: dict[str, Any],
    approval_notes: dict[str, Any],
    drive_approval_notes: dict[str, Any],
    drive_approval_notes_verification: dict[str, Any],
    operator_blocker_report: dict[str, Any],
    search_runtime: dict[str, Any],
    llm_results: dict[str, Any],
    adversarial_results: dict[str, Any] | None,
    sources: list[dict[str, Any]],
) -> dict[str, Any]:
    stage = lambda key: stage_by_key(stage_gate, key)
    extraction_totals = extraction_gate.get("totals") if isinstance(extraction_gate.get("totals"), dict) else {}
    extraction_gate_values = extraction_gate.get("gate") if isinstance(extraction_gate.get("gate"), dict) else {}
    media_totals = media_summary.get("totals") if isinstance(media_summary.get("totals"), dict) else {}
    media_gate = media_summary.get("completion_gate") if isinstance(media_summary.get("completion_gate"), dict) else {}
    approval_overall = approval_dashboard.get("overall") if isinstance(approval_dashboard.get("overall"), dict) else {}
    drive_notes_status = drive_approval_notes.get("status")
    drive_required = as_int(drive_approval_notes.get("required_decision_count"))
    drive_approved = as_int(drive_approval_notes.get("approved_required_decision_count"))
    drive_missing = len(drive_approval_notes.get("missing_required_decisions") or []) if isinstance(drive_approval_notes.get("missing_required_decisions"), list) else 0
    drive_invalid = len(drive_approval_notes.get("invalid_required_decisions") or []) if isinstance(drive_approval_notes.get("invalid_required_decisions"), list) else 0
    drive_verification_status = drive_approval_notes_verification.get("status")
    search_scale = search_runtime.get("scale_readiness_attestation") if isinstance(search_runtime.get("scale_readiness_attestation"), dict) else {}
    search_full = search_scale.get("full_run") if isinstance(search_scale.get("full_run"), dict) else {}
    rename_gate = llm_results.get("rename_correctness_gate") if isinstance(llm_results.get("rename_correctness_gate"), dict) else {}
    rename_runtime = llm_results.get("runtime_attestation_gate") if isinstance(llm_results.get("runtime_attestation_gate"), dict) else {}
    rename_scale = llm_results.get("scale_readiness_attestation") if isinstance(llm_results.get("scale_readiness_attestation"), dict) else {}
    rename_full = rename_scale.get("full_run") if isinstance(rename_scale.get("full_run"), dict) else {}
    adv_totals = (adversarial_results or {}).get("totals") if isinstance((adversarial_results or {}).get("totals"), dict) else {}
    adv_freshness = (adversarial_results or {}).get("freshness") if isinstance((adversarial_results or {}).get("freshness"), dict) else {}
    verification_ok, verification_blockers, verification_evidence = extraction_verification_gate(
        extraction_gate,
        extraction_verification,
    )

    requirements: list[dict[str, Any]] = []

    active_files = as_int(extraction_totals.get("active_files"))
    mapped_complete = (
        active_files > 0
        and extraction_gate_values.get("all_expected_lanes_present") is True
        and extraction_gate_values.get("all_active_lanes_explicitly_routed") is True
        and verification_ok
    )
    mapped_blockers: list[str] = list(verification_blockers)
    if active_files <= 0:
        mapped_blockers.append("active file inventory is missing")
    if extraction_gate_values.get("all_expected_lanes_present") is not True:
        mapped_blockers.append("expected extraction lanes are not all present")
    if extraction_gate_values.get("all_active_lanes_explicitly_routed") is not True:
        mapped_blockers.append("not all active files are explicitly routed")
    requirements.append(requirement(
        "active_file_mapping",
        "Every active file is inventoried and routed",
        blocked_or_complete(mapped_complete, mapped_blockers),
        mapped_blockers,
        {
            "active_files": active_files,
            "active_bytes": as_int(extraction_totals.get("active_bytes")),
            "routed_lanes": as_int(extraction_totals.get("routed_lanes")),
            "all_expected_lanes_present": extraction_gate_values.get("all_expected_lanes_present"),
            "all_active_lanes_explicitly_routed": extraction_gate_values.get("all_active_lanes_explicitly_routed"),
            "verification_ok": verification_ok,
            **verification_evidence,
        },
    ))

    duplicate_stage = stage("duplicate_preserve_policy")
    duplicate_evidence = duplicate_stage.get("evidence") if isinstance(duplicate_stage.get("evidence"), dict) else {}
    duplicate_complete = duplicate_stage.get("complete") is True and duplicate_evidence.get("policy_ok") is True
    duplicate_blockers = [] if duplicate_complete else ["duplicate preserve policy is not fully attested"]
    requirements.append(requirement(
        "immutable_bytes_duplicate_preserve",
        "Canonical bytes stay immutable and duplicate source rows are preserved",
        blocked_or_complete(duplicate_complete, duplicate_blockers),
        duplicate_blockers,
        {
            "stage_status": duplicate_stage.get("status"),
            "policy_ok": duplicate_evidence.get("policy_ok"),
            "scale_duplicate_policy_attested": duplicate_evidence.get("scale_duplicate_policy_attested"),
            "duplicate_non_survivor_rows": duplicate_evidence.get("duplicate_non_survivor_rows"),
        },
    ))

    extraction_complete = (
        extraction_gate_values.get("full_extraction_complete") is True
        and as_int(extraction_totals.get("pending_lanes")) == 0
        and as_int(extraction_totals.get("hard_blocker_lanes")) == 0
        and extraction_gate_values.get("all_sampled_non_deferred_non_approval_lanes_have_usable_output") is not False
        and verification_ok
    )
    extraction_blockers: list[str] = list(verification_blockers)
    if extraction_gate_values.get("full_extraction_complete") is not True:
        extraction_blockers.append("full extraction is not complete")
    if as_int(extraction_totals.get("pending_lanes")):
        extraction_blockers.append("pending extraction lanes remain")
    if as_int(extraction_totals.get("hard_blocker_lanes")):
        extraction_blockers.append("hard blocker extraction lanes remain")
    if extraction_gate_values.get("all_sampled_non_deferred_non_approval_lanes_have_usable_output") is False:
        extraction_blockers.append("sampled non-deferred/non-approval lanes lack usable output")
    requirements.append(requirement(
        "read_extraction_coverage",
        "Every active file is read/extracted or explicitly routed to required OCR/transcription/human review",
        blocked_or_complete(extraction_complete, extraction_blockers),
        extraction_blockers,
        {
            "status": extraction_gate.get("status"),
            "pending_lanes": as_int(extraction_totals.get("pending_lanes")),
            "hard_blocker_lanes": as_int(extraction_totals.get("hard_blocker_lanes")),
            "sampled_files": as_int(extraction_totals.get("sampled_files")),
            "sampled_usable_files": as_int(extraction_totals.get("sampled_usable_files")),
            "sampled_no_usable_lanes": as_int(extraction_totals.get("sampled_no_usable_lanes")),
            "status_counts": extraction_gate.get("status_counts") if isinstance(extraction_gate.get("status_counts"), dict) else {},
            "verification_ok": verification_ok,
            **verification_evidence,
        },
    ))

    media_complete = media_gate.get("complete") is True and as_int(media_totals.get("unresolved_media_files")) == 0
    media_status = "complete" if media_complete else "deferred" if media_gate.get("final_media_pass_required") is True else "blocked"
    media_blockers = [] if media_complete else ["final media transcription/keyframe pass remains unresolved"]
    requirements.append(requirement(
        "deferred_media_completion",
        "Audio/video files have transcription/keyframe coverage before final replacement",
        media_status,
        media_blockers,
        {
            "status": media_summary.get("status"),
            "active_media_files": as_int(media_totals.get("active_media_files")),
            "indexed_media_files": as_int(media_totals.get("indexed_media_files")),
            "unresolved_media_files": as_int(media_totals.get("unresolved_media_files")),
            "final_media_pass_required": media_gate.get("final_media_pass_required"),
        },
    ))

    approvals_complete = (
        approval_overall.get("approval_notes_complete") is True
        and as_int(approval_overall.get("approved_approval_notes")) >= as_int(approval_overall.get("approval_items"))
        and approval_notes.get("status") in {"complete", "approved", "ok"}
        and drive_notes_status == "approved"
        and drive_required > 0
        and drive_approved >= drive_required
        and drive_missing == 0
        and drive_invalid == 0
        and drive_verification_status == "ok"
    )
    approvals_blockers: list[str] = []
    if not approvals_complete:
        if not (
            approval_overall.get("approval_notes_complete") is True
            and as_int(approval_overall.get("approved_approval_notes")) >= as_int(approval_overall.get("approval_items"))
            and approval_notes.get("status") in {"complete", "approved", "ok"}
        ):
            approvals_blockers.append("validated operator approval notes are incomplete")
        if drive_notes_status != "approved" or drive_required == 0 or drive_approved < drive_required or drive_missing or drive_invalid:
            approvals_blockers.append("validated Drive approval notes are incomplete")
        if drive_verification_status != "ok":
            approvals_blockers.append("Drive approval notes verification is not ok")
    requirements.append(requirement(
        "operator_approval_gates",
        "All execution and metadata gates have current validated operator approvals",
        blocked_or_complete(approvals_complete, approvals_blockers),
        approvals_blockers,
        {
            "dashboard_status": approval_dashboard.get("status"),
            "approval_notes_status": approval_notes.get("status"),
            "approval_request_packet_present": approval_notes.get("approval_request_packet_present"),
            "approval_request_packet_status": approval_notes.get("approval_request_packet_status"),
            "approval_items": as_int(approval_overall.get("approval_items")),
            "approved_approval_notes": as_int(approval_overall.get("approved_approval_notes")),
            "drive_approval_notes_status": drive_notes_status,
            "drive_approval_notes_verification_status": drive_verification_status,
            "drive_required_decision_count": drive_required,
            "drive_approved_required_decision_count": drive_approved,
            "drive_missing_required_decisions": drive_missing,
            "drive_invalid_required_decisions": drive_invalid,
            "ready_dashboard_decisions": (operator_blocker_report.get("safe_next_step") or {}).get("ready_dashboard_decisions") if isinstance(operator_blocker_report.get("safe_next_step"), dict) else None,
        },
    ))

    search_complete = (
        search_runtime.get("status") == "completed"
        and (search_runtime.get("runtime_attestation") or {}).get("status") == "ok"
        and (search_runtime.get("search_probe_attestation") or {}).get("status") == "ok"
        and search_scale.get("status") == "full_run_verified"
        and search_full.get("verified") is True
        and as_int(search_full.get("remaining_jobs")) == 0
    )
    search_blockers = [] if search_complete else ["search-index canary/full population, runtime attestation, and CLI search probe are incomplete"]
    requirements.append(requirement(
        "files_cli_search_index",
        "All active survivor files are indexed into fast files CLI search surfaces",
        blocked_or_complete(search_complete, search_blockers),
        search_blockers,
        {
            "runtime_status": search_runtime.get("status"),
            "runtime_attestation_status": (search_runtime.get("runtime_attestation") or {}).get("status") if isinstance(search_runtime.get("runtime_attestation"), dict) else None,
            "search_probe_status": (search_runtime.get("search_probe_attestation") or {}).get("status") if isinstance(search_runtime.get("search_probe_attestation"), dict) else None,
            "search_probe_probes": (search_runtime.get("search_probe_attestation") or {}).get("probes") if isinstance(search_runtime.get("search_probe_attestation"), dict) else None,
            "search_probe_max_latency_ms": (search_runtime.get("search_probe_attestation") or {}).get("max_latency_ms") if isinstance(search_runtime.get("search_probe_attestation"), dict) else None,
            "search_probe_latency_budget_ms": (search_runtime.get("search_probe_attestation") or {}).get("latency_budget_ms") if isinstance(search_runtime.get("search_probe_attestation"), dict) else None,
            "scale_readiness_status": search_scale.get("status"),
            "planned_jobs": search_scale.get("planned_jobs"),
            "remaining_jobs": search_full.get("remaining_jobs"),
            "canary_verified": (search_scale.get("canary") or {}).get("verified") if isinstance(search_scale.get("canary"), dict) else None,
            "full_run_verified": search_full.get("verified"),
        },
    ))

    rename_complete = (
        rename_gate.get("status") == "ok"
        and rename_gate.get("metadata_apply_ready") is True
        and rename_runtime.get("status") == "ok"
        and rename_scale.get("status") == "full_run_verified"
        and rename_full.get("verified") is True
        and as_int(rename_full.get("remaining_jobs")) == 0
    )
    rename_blockers = [] if rename_complete else ["semantic rename proposals, correctness gate, or runtime attestation are incomplete"]
    requirements.append(requirement(
        "semantic_rename_readiness",
        "All active files have reviewed agent-friendly canonical names and target paths ready for metadata apply",
        blocked_or_complete(rename_complete, rename_blockers),
        rename_blockers,
        {
            "campaign_status": llm_results.get("status"),
            "proposal_rows": rename_gate.get("proposal_rows"),
            "target_path_rows": rename_gate.get("target_path_rows"),
            "canonical_name_rows": rename_gate.get("canonical_name_rows"),
            "rename_gate_status": rename_gate.get("status"),
            "metadata_apply_ready": rename_gate.get("metadata_apply_ready"),
            "runtime_attestation_gate_status": rename_runtime.get("status"),
            "scale_readiness_status": rename_scale.get("status"),
            "remaining_jobs": rename_full.get("remaining_jobs"),
        },
    ))

    metadata_stage = stage("metadata_apply_readiness")
    metadata_complete = metadata_stage.get("complete") is True
    metadata_blockers = [] if metadata_complete else ["metadata apply is not ready and still requires reviewed proposals"]
    requirements.append(requirement(
        "metadata_apply_readiness",
        "Reviewed metadata-only canonical names/target paths can be applied without S3 key rewrites",
        blocked_or_complete(metadata_complete, metadata_blockers),
        metadata_blockers,
        {
            "stage_status": metadata_stage.get("status"),
            "stage_blockers": metadata_stage.get("blockers") if isinstance(metadata_stage.get("blockers"), list) else [],
            "metadata_apply_ready": (metadata_stage.get("evidence") or {}).get("metadata_apply_ready") if isinstance(metadata_stage.get("evidence"), dict) else None,
        },
    ))

    adversarial_complete = (
        bool(adversarial_results)
        and adversarial_results.get("status") == "approved_to_scale"
        and adversarial_results.get("approved_to_scale") is True
        and as_int(adv_totals.get("reviewers_present")) == 2
        and as_int(adv_totals.get("blockers")) == 0
        and adv_freshness.get("all_input_attestations_match") is True
        and not adversarial_results.get("errors")
    )
    adversarial_blockers = [] if adversarial_complete else ["two adversarial reviewers have not approved scale-up without blockers"]
    requirements.append(requirement(
        "adversarial_validation",
        "Two adversarial reviewers validate the complete replacement state",
        blocked_or_complete(adversarial_complete, adversarial_blockers),
        adversarial_blockers,
        {
            "present": bool(adversarial_results),
            "status": (adversarial_results or {}).get("status"),
            "approved_to_scale": (adversarial_results or {}).get("approved_to_scale"),
            "reviewers_present": adv_totals.get("reviewers_present"),
            "blockers": adv_totals.get("blockers"),
            "risks": adv_totals.get("risks"),
            "freshness_all_input_attestations_match": adv_freshness.get("all_input_attestations_match"),
            "packet_present": adv_freshness.get("packet_present"),
            "schema_present": adv_freshness.get("schema_present"),
            "reviewer_a_prompt_present": adv_freshness.get("reviewer_a_prompt_present"),
            "reviewer_b_prompt_present": adv_freshness.get("reviewer_b_prompt_present"),
            "errors": len((adversarial_results or {}).get("errors") or []),
            "warnings": len((adversarial_results or {}).get("warnings") or []),
        },
    ))

    counts: dict[str, int] = {}
    for item in requirements:
        counts[item["status"]] = counts.get(item["status"], 0) + 1
    status = "ready" if counts.get("complete", 0) == len(requirements) else "blocked"
    if status != "ready" and counts.get("blocked", 0) == 0 and counts.get("deferred", 0):
        status = "deferred"

    return {
        "kind": "open_files_google_drive_replacement_readiness_gate",
        "version": 1,
        "generated_at": now_utc(),
        "status": status,
        "approved_to_replace_google_drive": status == "ready",
        "redaction": "aggregate-only final readiness gate; no private filenames, file IDs, object keys, source refs, extracted text, transcripts, ACL payloads, row payloads, command logs, or secrets",
        "source_artifacts": sources,
        "summary": {
            "requirements": len(requirements),
            "complete": counts.get("complete", 0),
            "blocked": counts.get("blocked", 0),
            "deferred": counts.get("deferred", 0),
            "missing": counts.get("missing", 0),
            "first_incomplete_requirement": next((item["key"] for item in requirements if item["status"] != "complete"), None),
        },
        "requirements": requirements,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Build aggregate final Google Drive replacement readiness gate.")
    parser.add_argument("--stage-dependency-gate", required=True)
    parser.add_argument("--extraction-readiness-gate", required=True)
    parser.add_argument("--extraction-readiness-verification", required=True)
    parser.add_argument("--deferred-media-summary", required=True)
    parser.add_argument("--extraction-approval-dashboard", required=True)
    parser.add_argument("--approval-notes-summary", required=True)
    parser.add_argument("--drive-approval-notes-summary", required=True)
    parser.add_argument("--drive-approval-notes-verification", required=True)
    parser.add_argument("--operator-approval-blocker-report", required=True)
    parser.add_argument("--search-index-runtime-summary", required=True)
    parser.add_argument("--llm-campaign-results-summary", required=True)
    parser.add_argument("--adversarial-review-results")
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    paths = {
        "stage_dependency_gate": Path(args.stage_dependency_gate).expanduser().resolve(),
        "extraction_readiness_gate": Path(args.extraction_readiness_gate).expanduser().resolve(),
        "extraction_readiness_verification": Path(args.extraction_readiness_verification).expanduser().resolve(),
        "deferred_media_summary": Path(args.deferred_media_summary).expanduser().resolve(),
        "extraction_approval_dashboard": Path(args.extraction_approval_dashboard).expanduser().resolve(),
        "approval_notes_summary": Path(args.approval_notes_summary).expanduser().resolve(),
        "drive_approval_notes_summary": Path(args.drive_approval_notes_summary).expanduser().resolve(),
        "drive_approval_notes_verification": Path(args.drive_approval_notes_verification).expanduser().resolve(),
        "operator_approval_blocker_report": Path(args.operator_approval_blocker_report).expanduser().resolve(),
        "search_index_runtime_summary": Path(args.search_index_runtime_summary).expanduser().resolve(),
        "llm_campaign_results_summary": Path(args.llm_campaign_results_summary).expanduser().resolve(),
        "adversarial_review_results": Path(args.adversarial_review_results).expanduser().resolve() if args.adversarial_review_results else None,
    }
    sources = [source_entry(label, path) for label, path in paths.items()]
    gate = build_gate(
        stage_gate=load_json(paths["stage_dependency_gate"]),
        extraction_gate=load_json(paths["extraction_readiness_gate"]),
        extraction_verification=load_json(paths["extraction_readiness_verification"]),
        media_summary=load_json(paths["deferred_media_summary"]),
        approval_dashboard=load_json(paths["extraction_approval_dashboard"]),
        approval_notes=load_json(paths["approval_notes_summary"]),
        drive_approval_notes=load_json(paths["drive_approval_notes_summary"]),
        drive_approval_notes_verification=load_json(paths["drive_approval_notes_verification"]),
        operator_blocker_report=load_json(paths["operator_approval_blocker_report"]),
        search_runtime=load_json(paths["search_index_runtime_summary"]),
        llm_results=load_json(paths["llm_campaign_results_summary"]),
        adversarial_results=load_json(paths["adversarial_review_results"]) if paths["adversarial_review_results"] else None,
        sources=sources,
    )
    output = Path(args.output).expanduser().resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(gate, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps({
        "kind": gate["kind"],
        "status": gate["status"],
        "approved_to_replace_google_drive": gate["approved_to_replace_google_drive"],
        "summary": gate["summary"],
    }, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
