#!/usr/bin/env python3
"""Verify and summarize aggregate-safe adversarial reviewer results."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import time
from pathlib import Path
from typing import Any


DEFAULT_DIR = ".codewith/private-artifacts/adversarial-review"
DEFAULT_PACKET = f"{DEFAULT_DIR}/adversarial-review-packet.json"
DEFAULT_SCHEMA = f"{DEFAULT_DIR}/reviewer-final.schema.json"
DEFAULT_REVIEWER_A_PROMPT = f"{DEFAULT_DIR}/reviewer-a-prompt.md"
DEFAULT_REVIEWER_B_PROMPT = f"{DEFAULT_DIR}/reviewer-b-prompt.md"
REQUIRED_REVIEWERS = ("reviewer_a", "reviewer_b")
REQUIRED_KEYS = {
    "reviewer",
    "verdict",
    "approved_to_scale",
    "blockers",
    "risks",
    "required_next_actions",
    "privacy_confirmation",
    "input_attestation",
    "summary",
}
ALLOWED_VERDICTS = {"pass", "pass_with_conditions", "fail"}
ALLOWED_SEVERITIES = {"blocker", "high", "medium", "low"}
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


def now_utc() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def load_json(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise SystemExit(f"expected JSON object: {path}")
    return value


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def scan_text(text: str) -> dict[str, int]:
    counts: dict[str, int] = {}
    for code, pattern in SENSITIVE_PATTERNS:
        count = len(pattern.findall(text))
        if count:
            counts[code] = count
    return counts


def expected_attestation(reviewer: str, packet: Path, schema: Path, prompt: Path) -> dict[str, str]:
    return {
        "reviewer": reviewer,
        "packet_sha256": file_sha256(packet),
        "schema_sha256": file_sha256(schema),
        "reviewer_prompt_sha256": file_sha256(prompt),
    }


def validate_review(
    path: Path,
    expected_reviewer: str,
    expected_input_attestation: dict[str, str],
) -> tuple[dict[str, Any], list[str], list[str]]:
    errors: list[str] = []
    warnings: list[str] = []
    text = path.read_text(encoding="utf-8")
    marker_counts = scan_text(text)
    if marker_counts:
        errors.append("sensitive_marker_hits")
    review = json.loads(text)
    if not isinstance(review, dict):
        raise SystemExit(f"expected JSON object: {path}")

    missing = sorted(REQUIRED_KEYS - set(review.keys()))
    errors.extend(f"missing_key:{key}" for key in missing)
    if review.get("reviewer") != expected_reviewer:
        errors.append("reviewer_mismatch")
    if review.get("verdict") not in ALLOWED_VERDICTS:
        errors.append("invalid_verdict")
    if not isinstance(review.get("approved_to_scale"), bool):
        errors.append("invalid_approved_to_scale")
    for key in ("blockers", "risks", "required_next_actions"):
        if not isinstance(review.get(key), list):
            errors.append(f"invalid_list:{key}")

    privacy = review.get("privacy_confirmation") if isinstance(review.get("privacy_confirmation"), dict) else {}
    for key in ("reviewed_only_packet_files", "no_private_values_in_response", "no_file_content_requested"):
        if privacy.get(key) is not True:
            errors.append(f"privacy_confirmation_not_true:{key}")

    attestation = review.get("input_attestation") if isinstance(review.get("input_attestation"), dict) else {}
    if not attestation:
        errors.append("input_attestation_missing")
    for key, expected in expected_input_attestation.items():
        value = attestation.get(key)
        if value != expected:
            errors.append(f"input_attestation_mismatch:{key}")
    for key in ("packet_sha256", "schema_sha256", "reviewer_prompt_sha256"):
        value = attestation.get(key)
        if not isinstance(value, str) or not re.fullmatch(r"[0-9a-f]{64}", value):
            errors.append(f"input_attestation_invalid_hash:{key}")

    risk_codes: list[str] = []
    severities: dict[str, int] = {}
    for risk in review.get("risks") if isinstance(review.get("risks"), list) else []:
        if not isinstance(risk, dict):
            errors.append("invalid_risk")
            continue
        severity = risk.get("severity")
        code = risk.get("code")
        if severity not in ALLOWED_SEVERITIES:
            errors.append("invalid_risk_severity")
        else:
            severities[str(severity)] = severities.get(str(severity), 0) + 1
        if not isinstance(code, str) or len(code) < 3:
            errors.append("invalid_risk_code")
        else:
            risk_codes.append(code)
        for key in ("finding", "evidence", "recommendation"):
            if not isinstance(risk.get(key), str) or not risk.get(key):
                errors.append(f"invalid_risk_field:{key}")

    summary = {
        "reviewer": expected_reviewer,
        "present": path.exists(),
        "verdict": review.get("verdict"),
        "approved_to_scale": review.get("approved_to_scale"),
        "blockers": len(review.get("blockers") or []) if isinstance(review.get("blockers"), list) else None,
        "risks": len(review.get("risks") or []) if isinstance(review.get("risks"), list) else None,
        "risk_codes": sorted(risk_codes),
        "severity_counts": dict(sorted(severities.items())),
        "required_next_actions": len(review.get("required_next_actions") or []) if isinstance(review.get("required_next_actions"), list) else None,
        "privacy_confirmation": {
            "reviewed_only_packet_files": privacy.get("reviewed_only_packet_files"),
            "no_private_values_in_response": privacy.get("no_private_values_in_response"),
            "no_file_content_requested": privacy.get("no_file_content_requested"),
        },
        "input_attestation": {
            "present": bool(attestation),
            "reviewer_matches": attestation.get("reviewer") == expected_input_attestation.get("reviewer"),
            "packet_sha256_matches": attestation.get("packet_sha256") == expected_input_attestation.get("packet_sha256"),
            "schema_sha256_matches": attestation.get("schema_sha256") == expected_input_attestation.get("schema_sha256"),
            "reviewer_prompt_sha256_matches": attestation.get("reviewer_prompt_sha256") == expected_input_attestation.get("reviewer_prompt_sha256"),
        },
        "sensitive_marker_counts": marker_counts,
    }
    if review.get("verdict") == "pass" and review.get("approved_to_scale") is False:
        warnings.append("pass_verdict_not_approved_to_scale")
    return summary, errors, warnings


def build_summary(
    reviewer_a: Path,
    reviewer_b: Path,
    *,
    packet: Path | None = None,
    schema: Path | None = None,
    reviewer_a_prompt: Path | None = None,
    reviewer_b_prompt: Path | None = None,
) -> dict[str, Any]:
    errors: list[str] = []
    warnings: list[str] = []
    reviewers: list[dict[str, Any]] = []
    packet_path = Path(packet or DEFAULT_PACKET).expanduser().resolve()
    schema_path = Path(schema or DEFAULT_SCHEMA).expanduser().resolve()
    prompt_paths = {
        "reviewer_a": Path(reviewer_a_prompt or DEFAULT_REVIEWER_A_PROMPT).expanduser().resolve(),
        "reviewer_b": Path(reviewer_b_prompt or DEFAULT_REVIEWER_B_PROMPT).expanduser().resolve(),
    }
    expected_attestations: dict[str, dict[str, str]] = {}
    for expected in REQUIRED_REVIEWERS:
        missing_sources = [
            label
            for label, source_path in (
                ("packet", packet_path),
                ("schema", schema_path),
                ("reviewer_prompt", prompt_paths[expected]),
            )
            if not source_path.exists()
        ]
        if missing_sources:
            errors.extend(f"missing_freshness_source:{expected}:{label}" for label in missing_sources)
            expected_attestations[expected] = {
                "reviewer": expected,
                "packet_sha256": "",
                "schema_sha256": "",
                "reviewer_prompt_sha256": "",
            }
        else:
            expected_attestations[expected] = expected_attestation(
                expected,
                packet_path,
                schema_path,
                prompt_paths[expected],
            )

    for expected, path in (("reviewer_a", reviewer_a), ("reviewer_b", reviewer_b)):
        if not path.exists():
            errors.append(f"missing_review:{expected}")
            reviewers.append({"reviewer": expected, "present": False})
            continue
        summary, review_errors, review_warnings = validate_review(path, expected, expected_attestations[expected])
        reviewers.append(summary)
        errors.extend(f"{expected}:{error}" for error in review_errors)
        warnings.extend(f"{expected}:{warning}" for warning in review_warnings)

    blocker_count = sum(int(item.get("blockers") or 0) for item in reviewers)
    approved_to_scale = all(item.get("approved_to_scale") is True for item in reviewers if item.get("present") is True)
    if errors:
        status = "failed"
    elif blocker_count:
        status = "reviewed_with_blockers"
    elif approved_to_scale:
        status = "approved_to_scale"
    else:
        status = "reviewed_not_approved"

    return {
        "kind": "open_files_adversarial_review_results_verification",
        "version": 1,
        "created_at": now_utc(),
        "status": status,
        "approved_to_scale": approved_to_scale,
        "reviewers": reviewers,
        "freshness": {
            "packet_present": packet_path.exists(),
            "schema_present": schema_path.exists(),
            "reviewer_a_prompt_present": prompt_paths["reviewer_a"].exists(),
            "reviewer_b_prompt_present": prompt_paths["reviewer_b"].exists(),
            "all_input_attestations_match": all(
                item.get("input_attestation", {}).get("reviewer_matches") is True
                and item.get("input_attestation", {}).get("packet_sha256_matches") is True
                and item.get("input_attestation", {}).get("schema_sha256_matches") is True
                and item.get("input_attestation", {}).get("reviewer_prompt_sha256_matches") is True
                for item in reviewers
                if item.get("present") is True
            ),
        },
        "totals": {
            "reviewers_present": sum(1 for item in reviewers if item.get("present") is True),
            "blockers": blocker_count,
            "risks": sum(int(item.get("risks") or 0) for item in reviewers),
            "blocker_severity_risks": sum(int((item.get("severity_counts") or {}).get("blocker") or 0) for item in reviewers),
        },
        "redaction": "aggregate-only; omits reviewer narrative text, private filenames, file IDs, object keys, source refs, extracted text, transcripts, ACL payloads, row payloads, command logs, and secrets",
        "errors": errors,
        "warnings": warnings,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Verify aggregate-safe adversarial reviewer JSON outputs.")
    parser.add_argument("--reviewer-a", default=f"{DEFAULT_DIR}/reviewer-a-current-result.json")
    parser.add_argument("--reviewer-b", default=f"{DEFAULT_DIR}/reviewer-b-current-result.json")
    parser.add_argument("--packet", default=DEFAULT_PACKET)
    parser.add_argument("--schema", default=DEFAULT_SCHEMA)
    parser.add_argument("--reviewer-a-prompt", default=DEFAULT_REVIEWER_A_PROMPT)
    parser.add_argument("--reviewer-b-prompt", default=DEFAULT_REVIEWER_B_PROMPT)
    parser.add_argument("--output", default=f"{DEFAULT_DIR}/adversarial-review-results-verification.json")
    args = parser.parse_args()

    summary = build_summary(
        Path(args.reviewer_a).expanduser().resolve(),
        Path(args.reviewer_b).expanduser().resolve(),
        packet=Path(args.packet).expanduser().resolve(),
        schema=Path(args.schema).expanduser().resolve(),
        reviewer_a_prompt=Path(args.reviewer_a_prompt).expanduser().resolve(),
        reviewer_b_prompt=Path(args.reviewer_b_prompt).expanduser().resolve(),
    )
    output = Path(args.output).expanduser().resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(summary, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps({
        "kind": summary["kind"],
        "status": summary["status"],
        "approved_to_scale": summary["approved_to_scale"],
        "totals": summary["totals"],
        "errors": summary["errors"],
        "warnings": summary["warnings"],
    }, indent=2, sort_keys=True))
    return 0 if not summary["errors"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
