"""Aggregate-only global execution preflight for open-files runners."""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any


DEFAULT_GATE_NAME = "extraction-lane-readiness-gate.json"
SHA256_RE = re.compile(r"^[a-f0-9]{64}$")


def load_json(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError(f"expected JSON object: {path}")
    return value


def default_gate_candidates(plan_root: Path) -> list[Path]:
    candidates: list[Path] = []
    current = plan_root.resolve()
    for base in [current, *current.parents[:3]]:
        candidate = base / DEFAULT_GATE_NAME
        if candidate not in candidates:
            candidates.append(candidate)
    return candidates


def resolve_gate_path(plan_root: Path, explicit_path: str | None) -> Path | None:
    if explicit_path:
        return Path(explicit_path).expanduser().resolve()
    for candidate in default_gate_candidates(plan_root):
        if candidate.exists():
            return candidate
    return None


def plan_approval_token(plan: dict[str, Any]) -> dict[str, Any]:
    plan_approval = plan.get("approval_attestation") if isinstance(plan.get("approval_attestation"), dict) else {}
    approval_note_sha256 = plan_approval.get("approval_note_sha256")
    approval_note_sha256_valid = isinstance(approval_note_sha256, str) and SHA256_RE.fullmatch(approval_note_sha256) is not None
    approval_token_present = bool(plan.get("approval_note")) or plan_approval.get("approval_note_present") is True
    return {
        "approval_token_present": approval_token_present,
        "approval_token_valid": plan.get("approved") is True and approval_token_present and approval_note_sha256_valid,
        "approval_token_sha256": approval_note_sha256 if approval_note_sha256_valid else None,
        "approval_token_source": "plan_approval_attestation",
    }


def build_global_execution_preflight(
    *,
    plan_root: Path,
    explicit_gate_path: str | None,
    execute_requested: bool,
    execution_scope: str,
    selected_jobs: int,
    selected_bytes: int | None,
    max_canary_jobs: int,
    max_canary_bytes: int | None,
    approval_token_present: bool = False,
    approval_token_valid: bool = False,
    approval_token_sha256: str | None = None,
    approval_token_source: str = "plan_approval_attestation",
) -> dict[str, Any]:
    approval_fields = {
        "approval_token_required_for_execute": True,
        "approval_token_present": bool(approval_token_present),
        "approval_token_valid": bool(approval_token_valid),
        "approval_token_sha256": approval_token_sha256 if approval_token_valid else None,
        "approval_token_source": approval_token_source,
    }
    if not execute_requested:
        return {
            "status": "not_requested",
            "allowed": True,
            "execution_scope": execution_scope,
            "gate_present": False,
            **approval_fields,
            "rule": "Global execution preflight is enforced only for explicit execution; explicit execution requires a validated approval token.",
            "redaction": "aggregate-only; no file IDs, filenames, object keys, source refs, extracted text, transcripts, row payloads, or secrets",
        }

    gate_path = resolve_gate_path(plan_root, explicit_gate_path)
    if gate_path is None:
        return {
            "status": "missing_readiness_gate",
            "allowed": False,
            "reason": "extraction readiness gate is required for explicit execution",
            "execution_scope": execution_scope,
            "gate_present": False,
            "selected_jobs": selected_jobs,
            "selected_bytes": selected_bytes,
            **approval_fields,
            "rule": "Explicit execution requires a validated approval token and an aggregate extraction readiness gate; plan approval gates are necessary but not sufficient.",
            "redaction": "aggregate-only; no file IDs, filenames, object keys, source refs, extracted text, transcripts, row payloads, or secrets",
        }

    gate_doc = load_json(gate_path)
    gate = gate_doc.get("gate") if isinstance(gate_doc.get("gate"), dict) else {}
    totals = gate_doc.get("totals") if isinstance(gate_doc.get("totals"), dict) else {}
    requires_operator_before_scale = gate.get("requires_operator_approval_before_scale") is True
    full_extraction_complete = gate.get("full_extraction_complete") is True
    hard_blocker_lanes = int(totals.get("hard_blocker_lanes") or 0)
    pending_lanes = int(totals.get("pending_lanes") or 0)

    canary_jobs_ok = selected_jobs <= max_canary_jobs
    canary_bytes_ok = max_canary_bytes is None or selected_bytes is None or selected_bytes <= max_canary_bytes

    if not approval_token_valid:
        allowed = False
        if execution_scope == "canary":
            status = "canary_approval_token_required"
            reason = "explicit canary execution requires a validated approval token"
        else:
            status = "scale_approval_token_required"
            reason = "explicit scale execution requires a validated approval token"
    elif execution_scope == "canary":
        if hard_blocker_lanes > 0:
            allowed = False
            status = "canary_blocked_by_global_hard_blockers"
            reason = "hard blocker extraction lanes remain"
        else:
            allowed = canary_jobs_ok and canary_bytes_ok
            status = "canary_allowed_pending_global_completion" if allowed and requires_operator_before_scale else "ok" if allowed else "canary_limits_exceeded"
            reason = None if allowed else "selected work exceeds canary limits"
    else:
        allowed = (
            full_extraction_complete
            and not requires_operator_before_scale
            and hard_blocker_lanes == 0
            and pending_lanes == 0
        )
        status = "ok" if allowed else "scale_blocked_by_global_gate"
        reason = None if allowed else "global extraction readiness is not complete"

    return {
        "status": status,
        "allowed": allowed,
        "reason": reason,
        "execution_scope": execution_scope,
        "gate_present": True,
        "gate_status": gate.get("status") or gate_doc.get("status"),
        "requires_operator_approval_before_scale": requires_operator_before_scale,
        "full_extraction_complete": full_extraction_complete,
        "hard_blocker_lanes": hard_blocker_lanes,
        "pending_lanes": pending_lanes,
        "selected_jobs": selected_jobs,
        "selected_bytes": selected_bytes,
        "max_canary_jobs": max_canary_jobs,
        "max_canary_bytes": max_canary_bytes,
        **approval_fields,
        "rule": "Canary execution may proceed only with a validated approval token, inside explicit canary caps, and with zero hard blocker lanes; scale execution requires a validated approval token, complete extraction readiness, zero pending/hard blocker lanes, and no operator-approval-before-scale flag.",
        "redaction": "aggregate-only; no file IDs, filenames, object keys, source refs, extracted text, transcripts, row payloads, or secrets",
    }


def skipped_results(count: int) -> dict[str, int]:
    return {"skipped": count}
