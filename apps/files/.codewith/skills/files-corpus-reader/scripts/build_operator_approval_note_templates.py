#!/usr/bin/env python3
"""Build private operator approval-note templates and a redacted request packet.

The generated templates are not approvals. They are private fill-in artifacts
that an operator can edit into real approval-note JSON files after review. The
public packet contains only aggregate readiness, decision IDs, command names,
and SHA-256 hashes.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import time
from pathlib import Path
from typing import Any


DEFAULT_DASHBOARD = ".codewith/private-artifacts/extraction-approval-dashboard.json"
DEFAULT_APPROVAL_NOTES_SUMMARY = ".codewith/private-artifacts/operator-approvals/approval-notes-summary.json"
DEFAULT_STAGE_VERIFICATION = ".codewith/private-artifacts/stage-dependency-verification.json"
DEFAULT_OUTPUT_DIR = ".codewith/private-artifacts/operator-approvals/templates"
DEFAULT_PACKET_OUTPUT = ".codewith/private-artifacts/operator-approvals/approval-request-packet.json"

DECISION_SCOPE = {
    "ocr_vision_canary": "provider-use",
    "large_file_canary": "canary",
    "archive_worker_image": "worker-build",
    "search_index_population": "canary",
    "llm_review_campaign": "canary",
    "deferred_media_final_pass": "media-final-pass",
}

DECISION_ALLOWED_ACTIONS = {
    "ocr_vision_canary": [
        "approve deterministic OCR tooling or bounded vision-provider use",
        "produce private OCR/vision request artifacts only",
        "do not mutate canonical S3 bytes or metadata rows",
    ],
    "large_file_canary": [
        "run the bounded non-audio large-file extraction canary only",
        "collect private review artifacts and aggregate status",
        "do not run full-corpus large-file extraction",
    ],
    "archive_worker_image": [
        "build and smoke the archive worker image with Docker or CI access",
        "capture worker tool inventory as an aggregate artifact",
        "do not read corpus archives during image build/smoke",
    ],
    "search_index_population": [
        "run the bounded search-index canary only",
        "write derived search documents through the files CLI",
        "do not run full search-index population until canary verification passes",
    ],
    "llm_review_campaign": [
        "run the sanitized one-job LLM rename/review canary only",
        "send sanitized bounded job payloads to the approved provider path",
        "do not apply metadata proposals automatically",
    ],
}

DECISION_REMEDIATION_ACTION_IDS = {
    "ocr_vision_canary": ["enable_ocr_or_vision_lane"],
    "large_file_canary": ["approve_large_file_runner_canary"],
    "archive_worker_image": ["enable_archive_inventory_tools", "grant_worker_docker_access_or_ci"],
    "search_index_population": [],
    "llm_review_campaign": [],
}

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
    ("google_drive_url", re.compile(r"(drive|docs)\.google\.com/")),
)

STAGE_READINESS_REQUIRED_KEYS = (
    "search_index_canary_stage_status",
    "search_index_full_stage_status",
    "search_index_runtime_attestation_status",
    "search_index_scale_readiness_status",
    "search_index_search_probe_status",
    "search_index_remaining_jobs",
    "llm_rename_canary_stage_status",
    "llm_rename_full_stage_status",
    "llm_rename_campaign_status",
    "llm_rename_canary_verified",
    "llm_rename_full_run_verified",
    "llm_rename_scale_readiness_status",
    "llm_rename_gate_status",
    "llm_rename_runtime_attestation_gate_status",
    "llm_rename_remaining_jobs",
    "metadata_apply_stage_status",
    "metadata_apply_ready",
)


def now_utc() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def text_sha256(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def source_entry(label: str, path: Path | None) -> dict[str, Any]:
    return {
        "label": label,
        "present": bool(path and path.exists()),
        "bytes": path.stat().st_size if path and path.exists() else 0,
        "sha256": file_sha256(path) if path and path.exists() else None,
    }


def load_json(path: Path | None) -> dict[str, Any] | None:
    if path is None or not path.exists():
        return None
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise SystemExit(f"expected JSON object: {path}")
    return value


def scan_text(text: str) -> dict[str, int]:
    counts: dict[str, int] = {}
    for code, pattern in SENSITIVE_PATTERNS:
        count = len(pattern.findall(text))
        if count:
            counts[code] = count
    return counts


def dict_value(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def stage_readiness_summary(stage_verification: dict[str, Any] | None) -> dict[str, Any]:
    summary = dict_value(dict_value(stage_verification).get("summary"))
    return {
        key: summary.get(key)
        for key in STAGE_READINESS_REQUIRED_KEYS
        if key in summary
    }


def command_hashes(section: dict[str, Any] | None) -> list[dict[str, Any]]:
    commands = section.get("commands") if isinstance(section, dict) and isinstance(section.get("commands"), dict) else {}
    output: list[dict[str, Any]] = []
    for name, command in sorted(commands.items()):
        if not isinstance(command, str):
            continue
        output.append({
            "name": name,
            "sha256": text_sha256(command),
            "bytes": len(command.encode("utf-8")),
        })
    return output


def section_for_decision(dashboard: dict[str, Any], decision_id: str) -> dict[str, Any]:
    sections = dashboard.get("sections") if isinstance(dashboard.get("sections"), dict) else {}
    mapping = {
        "ocr_vision_canary": "ocr_vision_canary",
        "large_file_canary": "large_file_canary",
        "archive_worker_image": "archive_worker_image",
        "search_index_population": "search_index_population",
        "llm_review_campaign": "llm_review_campaign",
        "deferred_media_final_pass": "deferred_media",
    }
    value = sections.get(mapping.get(decision_id, ""))
    return value if isinstance(value, dict) else {}


def evidence_summary(section: dict[str, Any], decision_id: str) -> dict[str, Any]:
    if decision_id == "ocr_vision_canary":
        lane = section.get("readiness_lane") if isinstance(section.get("readiness_lane"), dict) else {}
        smoke = section.get("smoke_lane") if isinstance(section.get("smoke_lane"), dict) else {}
        return {
            "active_files": lane.get("active_files"),
            "active_bytes": lane.get("active_bytes"),
            "route_status": lane.get("route_status"),
            "provider_required": lane.get("provider_required"),
            "smoke_samples": smoke.get("samples"),
            "smoke_usable": smoke.get("usable"),
        }
    approval = section.get("approval") if isinstance(section.get("approval"), dict) else {}
    validation = section.get("validation") if isinstance(section.get("validation"), dict) else {}
    runtime = section.get("runtime") if isinstance(section.get("runtime"), dict) else {}
    return {
        "approval_status": approval.get("status") or approval.get("approval_status"),
        "approval_required": approval.get("approval_required"),
        "approved": approval.get("approved"),
        "planned_jobs": approval.get("planned_jobs") or approval.get("jobs_planned"),
        "planned_bytes": approval.get("planned_bytes") or approval.get("bytes_planned"),
        "validation_status": validation.get("status"),
        "runtime_status": runtime.get("status"),
    }


def remediation_context(dashboard: dict[str, Any], decision_id: str) -> dict[str, Any]:
    sections = dashboard.get("sections") if isinstance(dashboard.get("sections"), dict) else {}
    remediation = sections.get("tool_remediation") if isinstance(sections.get("tool_remediation"), dict) else {}
    actions = remediation.get("actions") if isinstance(remediation.get("actions"), list) else []
    allowed_ids = DECISION_REMEDIATION_ACTION_IDS.get(decision_id, [])
    linked: list[dict[str, Any]] = []
    for action in actions:
        if not isinstance(action, dict) or action.get("id") not in allowed_ids:
            continue
        linked.append({
            "id": action.get("id"),
            "priority": action.get("priority"),
            "category": action.get("category"),
            "lanes": action.get("lanes") if isinstance(action.get("lanes"), list) else [],
            "active_files": action.get("active_files"),
            "approval_required": action.get("approval_required"),
            "deferred_until_final_pass": action.get("deferred_until_final_pass"),
            "worker_image_can_help": action.get("worker_image_can_help"),
            "package_candidates": action.get("package_candidates") if isinstance(action.get("package_candidates"), list) else [],
            "safe_next_action": action.get("safe_next_action"),
        })
    summary = remediation.get("summary") if isinstance(remediation.get("summary"), dict) else {}
    return {
        "present": bool(remediation),
        "status": remediation.get("status"),
        "summary": {
            key: summary.get(key)
            for key in (
                "action_count",
                "non_deferred_action_count",
                "approval_required_action_count",
                "deferred_action_count",
                "requires_operator_approval_before_scale",
                "requires_provider_or_tool_work",
                "final_media_pass_required",
            )
            if key in summary
        },
        "linked_action_ids": [item["id"] for item in linked if isinstance(item.get("id"), str)],
        "linked_actions": linked,
        "redaction_check": remediation.get("redaction_check") if isinstance(remediation.get("redaction_check"), dict) else {},
    }


def template_for_item(
    item: dict[str, Any],
    section: dict[str, Any],
    dashboard: dict[str, Any],
    stage_readiness: dict[str, Any],
    generated_at: str,
    expires_at: str | None,
) -> dict[str, Any]:
    decision_id = str(item.get("id") or "")
    return {
        "kind": "open_files_operator_approval_note",
        "version": 1,
        "template_status": "pending_operator_fill",
        "decision_id": decision_id,
        "status": "approved",
        "scope": DECISION_SCOPE.get(decision_id, "canary"),
        "approved_by": "<operator-name-or-handle>",
        "approved_at": generated_at,
        "expires_at": expires_at,
        "approval_note": "<replace with private operator approval note>",
        "approval_note_sha256": "<optional; validator computes this from approval_note when omitted>",
        "allowed_actions": DECISION_ALLOWED_ACTIONS.get(decision_id, []),
        "explicitly_not_approved": [
            "full-corpus scale execution",
            "metadata apply",
            "S3 object mutation or key rewrite",
            "duplicate row deletion",
            "private filename, object-key, source-ref, transcript, or extracted-text disclosure",
        ],
        "evidence_summary": evidence_summary(section, decision_id),
        "stage_readiness_context": stage_readiness,
        "remediation_context": remediation_context(dashboard, decision_id),
        "command_hashes": command_hashes(section),
        "operator_checklist": [
            "review the corresponding aggregate approval packet and dashboard section",
            "confirm the approval scope is only the listed canary/build/provider-use action",
            "confirm rollback and private artifact locations are understood",
            "save the completed approval note in the operator approvals directory, not the templates directory",
            "rerun validate_operator_approval_notes.py before any execution command",
        ],
        "redaction": "template contains aggregate evidence and command hashes; replace approval_note privately before moving to the approval notes directory",
    }


def build_templates(
    dashboard: dict[str, Any],
    approval_notes_summary: dict[str, Any] | None,
    output_dir: Path,
    expires_at: str | None,
    stage_verification: dict[str, Any] | None = None,
    sources: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    generated_at = now_utc()
    stage_readiness = stage_readiness_summary(stage_verification)
    stage_readiness_sha256 = text_sha256(json.dumps(stage_readiness, sort_keys=True))
    output_dir.mkdir(parents=True, exist_ok=True)
    approval_items = dashboard.get("approval_items") if isinstance(dashboard.get("approval_items"), list) else []
    pending: list[dict[str, Any]] = []
    for item in approval_items:
        if not isinstance(item, dict):
            continue
        decision_id = str(item.get("id") or "")
        if decision_id == "deferred_media_final_pass":
            continue
        note = item.get("approval_note") if isinstance(item.get("approval_note"), dict) else {}
        if item.get("ready_for_approval") is not True or note.get("approved") is True:
            continue
        pending.append(item)

    template_entries: list[dict[str, Any]] = []
    for item in pending:
        decision_id = str(item.get("id") or "")
        section = section_for_decision(dashboard, decision_id)
        template = template_for_item(item, section, dashboard, stage_readiness, generated_at, expires_at)
        template_path = output_dir / f"{decision_id}.template.json"
        template_path.write_text(json.dumps(template, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        template_scan = scan_text(json.dumps(template, sort_keys=True))
        template_entries.append({
            "decision_id": decision_id,
            "priority": item.get("priority"),
            "status": item.get("status"),
            "ready_for_approval": item.get("ready_for_approval"),
            "template_file": template_path.name,
            "template_sha256": text_sha256(template_path.read_text(encoding="utf-8")),
            "scope": template.get("scope"),
            "command_hashes": template.get("command_hashes"),
            "stage_readiness_sha256": stage_readiness_sha256,
            "remediation_action_ids": template.get("remediation_context", {}).get("linked_action_ids") if isinstance(template.get("remediation_context"), dict) else [],
            "remediation_status": template.get("remediation_context", {}).get("status") if isinstance(template.get("remediation_context"), dict) else None,
            "sensitive_marker_counts": template_scan,
        })

    packet = {
        "kind": "open_files_operator_approval_note_template_packet",
        "version": 1,
        "created_at": generated_at,
        "status": "templates_ready" if template_entries else "no_pending_templates",
        "redaction": "aggregate-only request packet; approval note text is not included and templates remain private fill-in artifacts",
        "source_status": {
            "dashboard_status": dashboard.get("status"),
            "ready_for_operator_review": (dashboard.get("overall") or {}).get("ready_for_operator_review") if isinstance(dashboard.get("overall"), dict) else None,
            "approval_notes_status": approval_notes_summary.get("status") if isinstance(approval_notes_summary, dict) else None,
            "approved_required_decision_count": approval_notes_summary.get("approved_required_decision_count") if isinstance(approval_notes_summary, dict) else None,
            "stage_verification_status": dict_value(stage_verification).get("status"),
            "stage_gate_status": dict_value(stage_verification).get("gate_status"),
            "remediation_status": ((dashboard.get("sections") or {}).get("tool_remediation") or {}).get("status") if isinstance(dashboard.get("sections"), dict) and isinstance((dashboard.get("sections") or {}).get("tool_remediation"), dict) else None,
            "remediation_action_count": (((dashboard.get("sections") or {}).get("tool_remediation") or {}).get("summary") or {}).get("action_count") if isinstance(dashboard.get("sections"), dict) and isinstance((dashboard.get("sections") or {}).get("tool_remediation"), dict) and isinstance(((dashboard.get("sections") or {}).get("tool_remediation") or {}).get("summary"), dict) else None,
        },
        "stage_readiness": stage_readiness,
        "stage_readiness_sha256": stage_readiness_sha256,
        "source_artifacts": [] if sources is None else sources,
        "non_mutation_attestation": {
            "templates_only": True,
            "approvals_granted": False,
            "execution_launched": False,
            "corpus_bytes_mutated": False,
            "s3_objects_mutated": False,
            "metadata_rows_mutated": False,
        },
        "template_dir": str(output_dir),
        "template_count": len(template_entries),
        "templates": template_entries,
    }
    marker_counts = scan_text(json.dumps(packet, sort_keys=True))
    packet["redaction_check"] = {
        "sensitive_marker_counts": marker_counts,
        "passed": not marker_counts and all(not entry["sensitive_marker_counts"] for entry in template_entries),
    }
    if not packet["redaction_check"]["passed"]:
        packet["status"] = "redaction_failed"
    return packet


def main() -> int:
    parser = argparse.ArgumentParser(description="Build private operator approval-note templates.")
    parser.add_argument("--dashboard", default=DEFAULT_DASHBOARD)
    parser.add_argument("--approval-notes-summary", default=DEFAULT_APPROVAL_NOTES_SUMMARY)
    parser.add_argument("--stage-verification", default=DEFAULT_STAGE_VERIFICATION)
    parser.add_argument("--output-dir", default=DEFAULT_OUTPUT_DIR)
    parser.add_argument("--packet-output", default=DEFAULT_PACKET_OUTPUT)
    parser.add_argument("--expires-at", help="Optional ISO timestamp copied into each template")
    args = parser.parse_args()

    dashboard_path = Path(args.dashboard).expanduser().resolve()
    approval_notes_path = Path(args.approval_notes_summary).expanduser().resolve()
    stage_verification_path = Path(args.stage_verification).expanduser().resolve()
    dashboard = load_json(dashboard_path)
    if dashboard is None:
        raise SystemExit("dashboard artifact is required")
    approval_notes = load_json(approval_notes_path)
    stage_verification = load_json(stage_verification_path)
    output_dir = Path(args.output_dir).expanduser().resolve()
    packet = build_templates(
        dashboard,
        approval_notes,
        output_dir,
        args.expires_at,
        stage_verification=stage_verification,
        sources=[
            source_entry("extraction_approval_dashboard", dashboard_path),
            source_entry("approval_notes_summary", approval_notes_path),
            source_entry("stage_dependency_verification", stage_verification_path),
        ],
    )
    packet_output = Path(args.packet_output).expanduser().resolve()
    packet_output.parent.mkdir(parents=True, exist_ok=True)
    packet_output.write_text(json.dumps(packet, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps({
        "kind": packet["kind"],
        "status": packet["status"],
        "template_count": packet["template_count"],
        "redaction_check": packet["redaction_check"],
    }, indent=2, sort_keys=True))
    return 0 if packet["redaction_check"]["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
