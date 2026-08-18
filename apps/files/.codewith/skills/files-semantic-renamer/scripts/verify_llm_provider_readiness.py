#!/usr/bin/env python3
"""Verify aggregate LLM provider readiness for an open-files campaign plan.

This verifier is read-only. It checks that planned direct/API and Codewith
provider routes have an available key/tool path and that the campaign's direct
provider data policy is still privacy-preserving.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import time
from pathlib import Path
from typing import Any


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


def scan_text(text: str) -> dict[str, int]:
    counts: dict[str, int] = {}
    for code, pattern in SENSITIVE_PATTERNS:
        count = len(pattern.findall(text))
        if count:
            counts[code] = count
    return counts


def account_refs(plan: dict[str, Any]) -> list[str]:
    refs: list[str] = []
    schedule = plan.get("schedule_policy") if isinstance(plan.get("schedule_policy"), dict) else {}
    for account in schedule.get("accounts") if isinstance(schedule.get("accounts"), list) else []:
        if not isinstance(account, dict):
            continue
        ref = account.get("account_ref")
        if isinstance(ref, str) and ref:
            refs.append(ref)
    if refs:
        return sorted(set(refs))
    entries = plan.get("shard_entries") if isinstance(plan.get("shard_entries"), list) else []
    for entry in entries:
        if not isinstance(entry, dict):
            continue
        ref = entry.get("account_ref")
        if isinstance(ref, str) and ref:
            refs.append(ref)
    return sorted(set(refs))


def direct_gateway_from_account_ref(account_ref: str) -> str | None:
    parts = account_ref.split(":")
    if len(parts) >= 3 and parts[0] == "direct-api":
        return parts[1]
    return None


def codewith_profile_from_account_ref(account_ref: str) -> str | None:
    parts = account_ref.split(":")
    if len(parts) >= 2 and parts[0] == "codewith":
        return parts[1]
    return None


def provider_available(provider_inventory: dict[str, Any], provider: str) -> dict[str, Any]:
    providers = provider_inventory.get("providers") if isinstance(provider_inventory.get("providers"), dict) else {}
    entry = providers.get(provider) if isinstance(providers.get(provider), dict) else {}
    env_warnings = entry.get("env_format_warnings") if isinstance(entry.get("env_format_warnings"), list) else []
    return {
        "provider": provider,
        "env_available": entry.get("env_available") is True,
        "vault_available": entry.get("vault_available") is True,
        "available": entry.get("env_available") is True or entry.get("vault_available") is True,
        "env_format_warning_count": len(env_warnings),
    }


def direct_policy_gate(plan: dict[str, Any]) -> dict[str, Any]:
    policy = plan.get("direct_provider_policy_attestation") if isinstance(plan.get("direct_provider_policy_attestation"), dict) else {}
    allowed_hosts = policy.get("allowed_hosts") if isinstance(policy.get("allowed_hosts"), list) else []
    safe_hosts = all(host == "openrouter.ai" for host in allowed_hosts)
    checks = {
        "status_ok": policy.get("status") == "ok",
        "real_file_ids_not_sent": policy.get("real_file_ids_sent") is False,
        "raw_file_bytes_not_sent": policy.get("raw_file_bytes_sent") is False,
        "raw_extracts_not_sent": policy.get("raw_extracts_sent") is False,
        "secret_values_not_sent": policy.get("secret_values_sent") is False,
        "provider_data_collection_denied": policy.get("provider_data_collection_denied_by_default") is True,
        "provider_data_collection_allowed_count_zero": int(policy.get("provider_data_collection_allowed_count") or 0) == 0,
        "allowed_hosts_safe": safe_hosts,
    }
    return {
        "status": "ok" if all(checks.values()) else "failed",
        "checks": checks,
        "direct_provider_count": int(policy.get("direct_provider_count") or 0),
        "allowed_host_count": len(allowed_hosts),
        "redaction": "aggregate-only provider policy gate; no payload rows, file IDs, filenames, object keys, source refs, extracted text, proposal rows, or secrets",
    }


def schedule_gate(plan: dict[str, Any]) -> dict[str, Any]:
    schedule = plan.get("schedule_policy") if isinstance(plan.get("schedule_policy"), dict) else {}
    accounts = schedule.get("accounts") if isinstance(schedule.get("accounts"), list) else []
    invalid_accounts = 0
    for account in accounts:
        if not isinstance(account, dict):
            invalid_accounts += 1
            continue
        max_parallel = account.get("max_parallel")
        rate = account.get("rate_limit_per_minute")
        if not isinstance(max_parallel, int) or max_parallel <= 0:
            invalid_accounts += 1
        if not isinstance(rate, int) or rate <= 0:
            invalid_accounts += 1
    return {
        "status": "ok" if schedule.get("status") == "ok" and invalid_accounts == 0 else "failed",
        "account_count": len(accounts),
        "invalid_account_count": invalid_accounts,
        "max_campaign_parallel": schedule.get("max_campaign_parallel"),
        "redaction": "aggregate-only schedule gate; no file IDs, filenames, object keys, source refs, proposal rows, or secrets",
    }


def build_readiness(plan_path: Path, provider_inventory_path: Path) -> dict[str, Any]:
    plan = load_json(plan_path)
    inventory = load_json(provider_inventory_path)
    refs = account_refs(plan)
    direct_gateways = sorted({gateway for ref in refs for gateway in [direct_gateway_from_account_ref(ref)] if gateway})
    codewith_profiles = sorted({profile for ref in refs for profile in [codewith_profile_from_account_ref(ref)] if profile})
    direct_routes = [provider_available(inventory, gateway) for gateway in direct_gateways]
    tools = inventory.get("tools") if isinstance(inventory.get("tools"), dict) else {}
    codewith_tool_available = tools.get("codewith") is True
    missing_direct = [route["provider"] for route in direct_routes if route.get("available") is not True]
    missing_codewith = codewith_profiles and not codewith_tool_available
    policy = direct_policy_gate(plan)
    schedule = schedule_gate(plan)
    errors: list[str] = []
    if missing_direct:
        errors.append("missing_direct_provider_key")
    if missing_codewith:
        errors.append("missing_codewith_tool")
    if policy["status"] != "ok":
        errors.append("direct_provider_policy_failed")
    if schedule["status"] != "ok":
        errors.append("schedule_policy_failed")

    if errors:
        if any(error.startswith("missing_") for error in errors):
            status = "blocked_provider_route"
        else:
            status = "blocked_policy"
    else:
        status = "ok"
    output = {
        "kind": "open_files_llm_provider_readiness",
        "version": 1,
        "created_at": now_utc(),
        "status": status,
        "errors": errors,
        "redaction": "aggregate-only; omits provider secret values, worker rows, file IDs, filenames, object keys, source refs, extracted text, proposal rows, and command logs",
        "source_artifacts": {
            "campaign_plan": {
                "present": plan_path.exists(),
                "bytes": plan_path.stat().st_size,
                "sha256": file_sha256(plan_path),
            },
            "provider_inventory": {
                "present": provider_inventory_path.exists(),
                "bytes": provider_inventory_path.stat().st_size,
                "sha256": file_sha256(provider_inventory_path),
            },
        },
        "planned_routes": {
            "account_ref_count": len(refs),
            "direct_gateways": direct_gateways,
            "codewith_profile_count": len(codewith_profiles),
            "direct_routes": direct_routes,
            "codewith_tool_available": codewith_tool_available,
        },
        "direct_provider_policy_gate": policy,
        "schedule_gate": schedule,
        "non_mutation_attestation": {
            "provider_calls_made": False,
            "corpus_bytes_mutated": False,
            "s3_objects_mutated": False,
            "metadata_rows_mutated": False,
            "search_index_rows_mutated": False,
        },
    }
    marker_counts = scan_text(json.dumps(output, sort_keys=True))
    output["redaction_check"] = {
        "passed": not marker_counts,
        "sensitive_marker_counts": marker_counts,
    }
    if marker_counts:
        output["status"] = "redaction_failed"
    return output


def main() -> int:
    parser = argparse.ArgumentParser(description="Verify LLM provider readiness from a campaign plan and redacted provider inventory.")
    parser.add_argument("--campaign-plan", required=True)
    parser.add_argument("--provider-inventory", required=True)
    parser.add_argument("--output")
    args = parser.parse_args()

    output = build_readiness(
        plan_path=Path(args.campaign_plan).expanduser().resolve(),
        provider_inventory_path=Path(args.provider_inventory).expanduser().resolve(),
    )
    if args.output:
        path = Path(args.output).expanduser().resolve()
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(output, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps({
        "kind": output["kind"],
        "status": output["status"],
        "errors": output["errors"],
        "planned_routes": output["planned_routes"],
        "direct_provider_policy_gate": output["direct_provider_policy_gate"],
        "schedule_gate": output["schedule_gate"],
        "redaction_check": output["redaction_check"],
    }, indent=2, sort_keys=True))
    return 0 if output["status"] == "ok" else 1


if __name__ == "__main__":
    raise SystemExit(main())
