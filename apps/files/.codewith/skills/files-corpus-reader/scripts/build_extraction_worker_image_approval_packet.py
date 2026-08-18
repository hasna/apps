#!/usr/bin/env python3
"""Build an aggregate-only approval packet for the extraction worker image.

This packet is for approving the Docker build/smoke/inventory capture path. It
does not build images, run extractors, download corpus files, or mutate S3/DB
state.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import time
from pathlib import Path
from typing import Any


DEFAULT_VERIFICATION = ".codewith/private-artifacts/extraction-worker-image-verification.json"
DEFAULT_OUTPUT = ".codewith/private-artifacts/extraction-worker-image-approval-packet.json"
DEFAULT_WORKER_INVENTORY = ".codewith/private-artifacts/extraction-worker-tool-inventory.json"
DEFAULT_GATE = ".codewith/private-artifacts/extraction-lane-readiness-gate.json"

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


def source_artifact(label: str, path: Path) -> dict[str, Any]:
    return {
        "label": label,
        "present": path.exists(),
        "bytes": path.stat().st_size if path.exists() else 0,
        "sha256": file_sha256(path) if path.exists() else None,
    }


def scan_text(text: str) -> dict[str, int]:
    counts: dict[str, int] = {}
    for code, pattern in SENSITIVE_PATTERNS:
        count = len(pattern.findall(text))
        if count:
            counts[code] = count
    return counts


def compact_runtime_policy(policy: dict[str, Any] | None) -> dict[str, Any]:
    if not isinstance(policy, dict):
        return {"present": False, "status": "missing"}
    return {
        "present": True,
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
        "tmpfs_paths": policy.get("tmpfs_paths") if isinstance(policy.get("tmpfs_paths"), list) else [],
        "cap_drop_all": policy.get("cap_drop_all") is True,
        "no_new_privileges": policy.get("no_new_privileges") is True,
        "pids_limit": policy.get("pids_limit"),
        "memory_limit": policy.get("memory_limit"),
        "cpus": policy.get("cpus"),
        "command_logs_hashed_only": policy.get("command_logs_hashed_only") is True,
        "private_values_in_command": policy.get("private_values_in_command") is True,
    }


def runtime_policy_ok(policy: dict[str, Any]) -> bool:
    return (
        policy.get("present") is True
        and policy.get("status") == "ok"
        and policy.get("network_mode") == "none"
        and policy.get("network_disabled") is True
        and policy.get("provider_egress_allowed") is False
        and policy.get("arbitrary_url_fetch_allowed") is False
        and policy.get("google_drive_access_allowed") is False
        and policy.get("s3_object_access_allowed") is False
        and policy.get("db_access_allowed") is False
        and policy.get("corpus_mounts_allowed") is False
        and policy.get("secret_env_allowed") is False
        and policy.get("read_only_rootfs") is True
        and "/tmp" in {str(path) for path in policy.get("tmpfs_paths", [])}
        and policy.get("cap_drop_all") is True
        and policy.get("no_new_privileges") is True
        and policy.get("command_logs_hashed_only") is True
        and policy.get("private_values_in_command") is False
    )


def finalize_packet(packet: dict[str, Any]) -> dict[str, Any]:
    marker_counts = scan_text(json.dumps(packet, sort_keys=True))
    source_artifacts = packet.get("source_artifacts") if isinstance(packet.get("source_artifacts"), dict) else {}
    packet["redaction_check"] = {
        "passed": not marker_counts,
        "sensitive_marker_counts": marker_counts,
    }
    packet["packet_errors"] = ["sensitive_marker_hits"] if marker_counts else []
    packet["approval_packet_checks"] = {
        "redaction_ok": not marker_counts,
        "source_artifacts_present": bool(source_artifacts) and all(item.get("present") is True for item in source_artifacts.values() if isinstance(item, dict)),
        "source_artifact_hashes_ok": bool(source_artifacts) and all(isinstance(item.get("sha256"), str) and re.fullmatch(r"[0-9a-f]{64}", item["sha256"]) for item in source_artifacts.values() if isinstance(item, dict)),
    }
    return packet


def summarize_verification(value: dict[str, Any]) -> dict[str, Any]:
    static = value.get("static") if isinstance(value.get("static"), dict) else {}
    docker = value.get("docker") if isinstance(value.get("docker"), dict) else {}
    runtime = value.get("runtime") if isinstance(value.get("runtime"), dict) else None
    gates = value.get("gates") if isinstance(value.get("gates"), dict) else {}
    runtime_policy = compact_runtime_policy(
        value.get("worker_runtime_policy")
        if isinstance(value.get("worker_runtime_policy"), dict)
        else static.get("worker_runtime_policy") if isinstance(static.get("worker_runtime_policy"), dict) else None
    )
    return {
        "status": value.get("status"),
        "static_status": static.get("status"),
        "static_errors_count": len(static.get("errors") or []),
        "static_warnings_count": len(static.get("warnings") or []),
        "docker_status": docker.get("status"),
        "docker_binary_present": bool(docker.get("path")),
        "runtime_status": runtime.get("status") if runtime else None,
        "worker_runtime_policy": runtime_policy,
        "worker_runtime_policy_ok": runtime_policy_ok(runtime_policy),
        "verification_gates": {
            "worker_runtime_network_disabled": gates.get("worker_runtime_network_disabled"),
            "worker_runtime_provider_egress_disabled": gates.get("worker_runtime_provider_egress_disabled"),
            "worker_runtime_s3_access_disabled": gates.get("worker_runtime_s3_access_disabled"),
            "worker_runtime_db_access_disabled": gates.get("worker_runtime_db_access_disabled"),
            "worker_runtime_corpus_mounts_disabled": gates.get("worker_runtime_corpus_mounts_disabled"),
            "worker_runtime_logs_hashed_only": gates.get("worker_runtime_logs_hashed_only"),
            "worker_runtime_policy_attested": gates.get("worker_runtime_policy_attested"),
        },
        "next_actions": value.get("next_actions") if isinstance(value.get("next_actions"), list) else [],
    }


def docker_access_remediation(summary: dict[str, Any]) -> dict[str, Any]:
    docker_status = str(summary.get("docker_status") or "unknown")
    if docker_status == "available":
        blocker = "none"
        action = "rerun approved build/smoke/inventory capture when operator approval is present"
    elif docker_status == "permission_denied":
        blocker = "docker_socket_permission_denied"
        action = "grant Docker socket access to this operator session or run the approved build/smoke in CI with Docker access"
    elif docker_status in {"daemon_unavailable", "unavailable"}:
        blocker = "docker_daemon_unavailable"
        action = "start Docker daemon or run the approved build/smoke in CI with Docker access"
    elif docker_status == "not_found":
        blocker = "docker_binary_not_found"
        action = "install Docker CLI/engine or run the approved build/smoke in CI with Docker access"
    else:
        blocker = "docker_access_unknown"
        action = "inspect aggregate Docker verification status and rerun static verification before approval"
    return {
        "required": docker_status != "available",
        "blocker": blocker,
        "docker_status": docker_status,
        "docker_binary_present": bool(summary.get("docker_binary_present")),
        "safe_next_action": action,
        "requires_corpus_access": False,
        "requires_s3_or_db_mutation": False,
        "redaction": "aggregate-only Docker access guidance; no Docker logs, corpus identifiers, object keys, source refs, secrets, or command output",
    }


def build_packet(
    verification_path: Path,
    worker_inventory_path: Path,
    gate_output_path: Path,
) -> dict[str, Any]:
    verification = load_json(verification_path)
    summary = summarize_verification(verification)
    static_ok = summary["static_status"] == "ok" and summary["static_errors_count"] == 0
    runtime_policy_ready = summary["worker_runtime_policy_ok"] is True
    docker_ready = summary["docker_status"] == "available"
    runtime_ready = summary["runtime_status"] == "ok"
    if not static_ok:
        status = "blocked_static_verification"
    elif not runtime_policy_ready:
        status = "blocked_runtime_policy_verification"
    elif runtime_ready:
        status = "complete"
    else:
        status = "ready_for_operator_approval"

    packet = {
        "kind": "open_files_extraction_worker_image_approval_packet",
        "version": 1,
        "created_at": now_utc(),
        "status": status,
        "approval_required": not runtime_ready,
        "redaction": "aggregate-only; no corpus filenames, file IDs, object keys, source refs, extracted text, transcripts, ACL payloads, row payloads, command logs, or secrets",
        "scope": {
            "purpose": "approve Docker/CI build, smoke, and worker tool inventory capture for archive extraction worker readiness",
            "allowed": [
                "build the repo-local extraction worker image",
                "run the synthetic archive smoke script with Docker network disabled",
                "capture worker-produced extraction tool inventory with Docker network disabled",
                "rerun extraction readiness gate using --worker-tool-inventory",
                "rebuild aggregate adversarial review packet",
            ],
            "prohibited": [
                "reading corpus files",
                "downloading S3 or Google Drive source bytes",
                "running per-file extractors against real rows",
                "running worker containers with network access",
                "allowing provider, S3, Google Drive, or database egress from worker runtime containers",
                "mutating S3 objects or canonical byte keys",
                "writing organization metadata or search index rows",
                "printing private filenames, object keys, source refs, extracted text, transcripts, ACL payloads, row payloads, or secret values",
            ],
        },
        "source_artifacts": {
            "verification": source_artifact("extraction_worker_image_verification", verification_path),
        },
        "current_verification": summary,
        "worker_runtime_policy": summary["worker_runtime_policy"],
        "docker_access_remediation": docker_access_remediation(summary),
        "gates": {
            "static_verification_ok": static_ok,
            "worker_runtime_policy_ok": runtime_policy_ready,
            "worker_runtime_network_disabled": summary["worker_runtime_policy"].get("network_disabled") is True,
            "worker_runtime_provider_egress_disabled": summary["worker_runtime_policy"].get("provider_egress_allowed") is False,
            "worker_runtime_s3_access_disabled": summary["worker_runtime_policy"].get("s3_object_access_allowed") is False,
            "worker_runtime_db_access_disabled": summary["worker_runtime_policy"].get("db_access_allowed") is False,
            "worker_runtime_corpus_mounts_disabled": summary["worker_runtime_policy"].get("corpus_mounts_allowed") is False,
            "worker_runtime_logs_hashed_only": summary["worker_runtime_policy"].get("command_logs_hashed_only") is True,
            "docker_access_available": docker_ready,
            "runtime_build_smoke_complete": runtime_ready,
            "safe_to_request_operator_approval": static_ok and runtime_policy_ready and not runtime_ready,
            "corpus_access_required": False,
            "s3_or_db_mutation_required": False,
        },
        "commands": {
            "refresh_static_verification": (
                "python3 .codewith/skills/files-corpus-reader/scripts/verify_extraction_worker_image.py "
                "--output .codewith/private-artifacts/extraction-worker-image-verification.json"
            ),
            "approved_build_smoke_and_inventory": (
                "python3 .codewith/skills/files-corpus-reader/scripts/verify_extraction_worker_image.py "
                "--build "
                f"--worker-tool-inventory-output {worker_inventory_path} "
                "--output .codewith/private-artifacts/extraction-worker-image-verification.json"
            ),
            "rerun_readiness_gate_with_worker_inventory": (
                "python3 .codewith/skills/files-corpus-reader/scripts/extraction_lane_readiness_gate.py "
                "--corpus-map .codewith/private-artifacts/corpus-map/corpus-map-public.json "
                "--tool-inventory .codewith/private-artifacts/extraction-tool-inventory.json "
                f"--worker-tool-inventory {worker_inventory_path} "
                "--smoke-summary .codewith/private-artifacts/extraction-smoke-summary.json "
                "--deferred-media-summary .codewith/private-artifacts/deferred-media-completion/deferred-media-completion-summary.json "
                f"--output {gate_output_path}"
            ),
            "rebuild_adversarial_packet": (
                "python3 .codewith/skills/files-semantic-renamer/scripts/build_adversarial_review_packet.py "
                "--output-dir .codewith/private-artifacts/adversarial-review "
                "--search-index-packet .codewith/private-artifacts/search-index-current-plan/search-index-approval-packet.json "
                "--search-index-validation .codewith/private-artifacts/search-index-current-plan/search-index-plan-validation.json "
                "--llm-campaign-plan .codewith/private-artifacts/llm-campaigns/sanitized-one-job/campaign-plan.json "
                "--llm-campaign-runtime-summary .codewith/private-artifacts/llm-campaigns/sanitized-one-job/unapproved-execute-summary.json "
                "--llm-campaign-results-summary .codewith/private-artifacts/llm-campaigns/sanitized-one-job/collected-results/campaign-results-summary.json "
                "--deferred-media-summary .codewith/private-artifacts/deferred-media-completion/deferred-media-completion-summary.json "
                f"--extraction-readiness-gate {gate_output_path} "
                "--extraction-worker-image-verification .codewith/private-artifacts/extraction-worker-image-verification.json "
                "--locked-worker-bundle-dir .codewith/private-artifacts/locked-worker-bundles/mimo-one-direct-api"
            ),
        },
        "expected_artifacts_after_approval": {
            "worker_tool_inventory": str(worker_inventory_path),
            "worker_image_verification": ".codewith/private-artifacts/extraction-worker-image-verification.json",
            "readiness_gate": str(gate_output_path),
            "adversarial_review_packet": ".codewith/private-artifacts/adversarial-review/adversarial-review-packet.json",
        },
    }
    return finalize_packet(packet)


def main() -> int:
    parser = argparse.ArgumentParser(description="Build extraction worker image approval packet.")
    parser.add_argument("--verification", default=DEFAULT_VERIFICATION)
    parser.add_argument("--worker-tool-inventory-output", default=DEFAULT_WORKER_INVENTORY)
    parser.add_argument("--readiness-gate-output", default=DEFAULT_GATE)
    parser.add_argument("--output", default=DEFAULT_OUTPUT)
    args = parser.parse_args()

    packet = build_packet(
        verification_path=Path(args.verification).expanduser().resolve(),
        worker_inventory_path=Path(args.worker_tool_inventory_output),
        gate_output_path=Path(args.readiness_gate_output),
    )
    output = Path(args.output).expanduser().resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(packet, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps({key: packet[key] for key in ("kind", "status", "approval_required", "gates")}, indent=2, sort_keys=True))
    return 0 if packet["status"] in {"ready_for_operator_approval", "complete"} and packet["redaction_check"]["passed"] is True else 1


if __name__ == "__main__":
    raise SystemExit(main())
