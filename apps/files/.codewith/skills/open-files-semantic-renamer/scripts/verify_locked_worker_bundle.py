#!/usr/bin/env python3
"""Verify a locked semantic-review worker bundle without running the worker.

The verifier emits aggregate policy status only. It does not print manifest
rows, file IDs, review contents, object keys, source refs, or secrets.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any


SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))

from build_locked_worker_bundle import (  # noqa: E402
    CONTROLLED_HOME_RELATIVE,
    CONTROLLED_TMP_RELATIVE,
    DECLARED_WRITABLE_DIRS,
    has_git_ancestor,
    load_json,
    load_jsonl,
    network_egress_policy_valid,
    validate_bundle,
)


SECRET_ENV_KEYS = {
    "AWS_ACCESS_KEY_ID",
    "AWS_SECRET_ACCESS_KEY",
    "AWS_SESSION_TOKEN",
    "OPENAI_API_KEY",
    "OPENROUTER_API_KEY",
    "ANTHROPIC_API_KEY",
    "XAI_API_KEY",
    "GOOGLE_API_KEY",
    "GEMINI_API_KEY",
    "GROQ_API_KEY",
    "ELEVENLABS_API_KEY",
}

MUTATION_COMMAND_MARKERS = {
    "--dangerously-bypass-approvals-and-sandbox",
    "--allow-bypass-sandbox",
    "danger-full-access",
}


def is_under(child: Path, parent: Path) -> bool:
    try:
        child.resolve().relative_to(parent.resolve())
        return True
    except ValueError:
        return False


def flag_value(command: list[str], flag: str) -> str | None:
    for index, token in enumerate(command[:-1]):
        if token == flag:
            return command[index + 1]
    return None


def load_command(bundle_dir: Path) -> dict[str, Any]:
    value = load_json(bundle_dir / "command.json")
    if not isinstance(value, dict):
        raise SystemExit("command.json must be an object")
    return value


def load_environment(bundle_dir: Path) -> dict[str, Any]:
    value = load_json(bundle_dir / "environment-policy.json")
    if not isinstance(value, dict):
        raise SystemExit("environment-policy.json must be an object")
    return value


def load_integrity(bundle_dir: Path) -> dict[str, Any]:
    value = load_json(bundle_dir / "bundle-integrity.json")
    if not isinstance(value, dict):
        raise SystemExit("bundle-integrity.json must be an object")
    return value


def issue(code: str, message: str) -> dict[str, str]:
    return {"code": code, "message": message}


def verify_bundle(bundle_dir: Path) -> dict[str, Any]:
    bundle_dir = bundle_dir.expanduser().resolve()
    errors: list[dict[str, str]] = []
    warnings: list[dict[str, str]] = []

    manifest = bundle_dir / "input" / "manifest.jsonl"
    rows = load_jsonl(manifest, None) if manifest.exists() else []
    bundle_validation = validate_bundle(bundle_dir, rows)
    if bundle_validation.get("status") != "ok":
        errors.append(issue("bundle_validation_failed", "bundle validation is not ok"))

    command_payload = load_command(bundle_dir)
    environment = load_environment(bundle_dir)
    integrity = load_integrity(bundle_dir)
    command = command_payload.get("command")
    if not isinstance(command, list) or not all(isinstance(item, str) for item in command):
        errors.append(issue("invalid_command", "command must be a list of strings"))
        command = []

    command_text = "\n".join(command)
    no_bypass = not any(marker in command for marker in MUTATION_COMMAND_MARKERS) and not any(marker in command_text for marker in MUTATION_COMMAND_MARKERS)
    if not no_bypass:
        errors.append(issue("sandbox_bypass_present", "command contains a sandbox bypass or danger-full-access marker"))

    cwd_value = flag_value(command, "-C")
    cwd_confined = bool(cwd_value and Path(cwd_value).expanduser().resolve() == bundle_dir)
    if not cwd_confined:
        errors.append(issue("cwd_not_bundle", "command working directory is not the bundle directory"))

    final_output = flag_value(command, "-o")
    output_confined = bool(final_output and is_under(Path(final_output).expanduser(), bundle_dir / "output"))
    if not output_confined:
        errors.append(issue("output_not_confined", "worker final output is not under bundle output directory"))

    schema_path = flag_value(command, "--output-schema")
    schema_confined = bool(schema_path and is_under(Path(schema_path).expanduser(), bundle_dir / "input"))
    if not schema_confined:
        errors.append(issue("schema_not_confined", "worker schema is not under bundle input directory"))

    sandbox_value = flag_value(command, "--sandbox")
    sandbox_ok = sandbox_value in {"workspace-write", "read-only"}
    if not sandbox_ok:
        errors.append(issue("invalid_sandbox", "command sandbox is not read-only or workspace-write"))

    env_allowed = environment.get("allowed_keys")
    if not isinstance(env_allowed, list) or not all(isinstance(key, str) for key in env_allowed):
        errors.append(issue("invalid_env_allowlist", "environment allowed_keys must be a string list"))
        env_allowed = []
    leaked_secret_env = sorted(set(env_allowed) & SECRET_ENV_KEYS)
    if leaked_secret_env:
        errors.append(issue("secret_env_allowed", "environment allowlist contains provider or cloud secret keys"))

    minimal_env = environment.get("policy") == "minimal-allowlist" and environment.get("secret_values_included") is False
    controlled_home = (
        environment.get("home_policy") == "controlled-bundle-home"
        and environment.get("host_home_inherited") is False
        and (bundle_dir / CONTROLLED_HOME_RELATIVE).exists()
        and (bundle_dir / CONTROLLED_TMP_RELATIVE).exists()
    )
    if not minimal_env:
        errors.append(issue("minimal_env_policy_failed", "environment policy is not minimal allowlist without secret values"))
    if not controlled_home:
        errors.append(issue("controlled_home_policy_failed", "controlled HOME/TMP policy is missing or runtime dirs are absent"))

    runner_script = bundle_dir / "run-worker.sh"
    runner_text = runner_script.read_text(encoding="utf-8", errors="replace") if runner_script.exists() else ""
    runner_env_i = "env -i" in runner_text and 'HOME="$SANDBOX_HOME"' in runner_text
    if not runner_env_i:
        errors.append(issue("runner_env_wrapper_missing", "run-worker.sh does not force env -i with controlled HOME"))

    allowed_writable_dirs = DECLARED_WRITABLE_DIRS
    for rel in allowed_writable_dirs:
        if not (bundle_dir / rel).exists():
            warnings.append(issue("writable_runtime_dir_missing", f"{rel} is not present"))

    git_ancestor_present = has_git_ancestor(bundle_dir)
    skip_git_in_command = "--skip-git-repo-check" in command
    skip_git_attested = command_payload.get("skip_git_repo_check") is skip_git_in_command
    if not skip_git_attested:
        errors.append(issue("skip_git_attestation_mismatch", "command skip-git flag and command payload attestation differ"))
    skip_git_policy_valid = (
        skip_git_in_command is False
        and command_payload.get("git_ancestor_present") is True
        and git_ancestor_present is True
        and integrity.get("skip_git_repo_check") is False
    ) or (
        skip_git_in_command is True
        and command_payload.get("git_ancestor_present") is False
        and git_ancestor_present is False
        and integrity.get("skip_git_repo_check") is True
        and bool(command_payload.get("skip_git_repo_check_justification"))
        and bool(integrity.get("skip_git_repo_check_justification"))
    )
    if not skip_git_policy_valid:
        errors.append(issue("skip_git_policy_invalid", "skip-git policy must match current Git ancestry and carry justification when used"))

    execution_surface = command_payload.get("execution_surface") if isinstance(command_payload.get("execution_surface"), dict) else {}
    integrity_surface = integrity.get("execution_surface") if isinstance(integrity.get("execution_surface"), dict) else {}
    command_egress = command_payload.get("network_egress_policy") if isinstance(command_payload.get("network_egress_policy"), dict) else {}
    integrity_egress = integrity.get("network_egress_policy") if isinstance(integrity.get("network_egress_policy"), dict) else {}
    execution_surface_ok = True
    for key in ("repo_checkout_access", "database_access", "raw_download_access", "s3_object_access"):
        if execution_surface.get(key) is not False or integrity_surface.get(key) is not False:
            execution_surface_ok = False
            errors.append(issue("execution_surface_policy_failed", f"{key} must be false in command and integrity attestations"))
    if execution_surface.get("declared_writable_dirs") != allowed_writable_dirs or integrity_surface.get("declared_writable_dirs") != allowed_writable_dirs:
        execution_surface_ok = False
        errors.append(issue("declared_writable_dirs_policy_failed", "declared writable dirs must match locked bundle policy"))
    if execution_surface.get("private_manifest_access") != "sanitized_bundle_manifest_only":
        execution_surface_ok = False
        errors.append(issue("private_manifest_policy_failed", "worker must use only the sanitized bundle manifest"))
    if execution_surface.get("review_artifact_access") != "copied_bounded_review_artifacts_only":
        execution_surface_ok = False
        errors.append(issue("review_artifact_policy_failed", "worker must use only copied bounded review artifacts"))
    network_egress_policy_ok = (
        network_egress_policy_valid(command_egress)
        and network_egress_policy_valid(integrity_egress)
        and command_egress == integrity_egress
    )
    if not network_egress_policy_ok:
        errors.append(issue("network_egress_policy_failed", "network egress policy must be matching provider-only deny-by-default attestations"))

    gates = {
        "bundle_validation_ok": bundle_validation.get("status") == "ok",
        "no_sandbox_bypass": no_bypass,
        "skip_git_repo_check_policy_valid": skip_git_policy_valid,
        "cwd_confined_to_bundle": cwd_confined,
        "output_confined_to_output_dir": output_confined,
        "schema_confined_to_input_dir": schema_confined,
        "sandbox_mode_limited": sandbox_ok,
        "minimal_env_allowlist": minimal_env,
        "no_secret_env_allowed": not leaked_secret_env,
        "controlled_home_tmp": controlled_home,
        "runner_uses_env_i": runner_env_i,
        "execution_surface_attested": execution_surface_ok,
        "network_egress_policy_attested": network_egress_policy_ok,
        "only_declared_writable_runtime_dirs": execution_surface.get("declared_writable_dirs") == allowed_writable_dirs,
    }

    return {
        "kind": "locked_worker_bundle_verification",
        "status": "ok" if not errors else "error",
        "bundle": str(bundle_dir),
        "jobs": len(rows),
        "provider": command_payload.get("provider"),
        "model": command_payload.get("model"),
        "git_ancestor_present": git_ancestor_present,
        "skip_git_repo_check": skip_git_in_command,
        "gates": gates,
        "network_egress_policy": {
            "mode": command_egress.get("mode"),
            "deny_by_default": command_egress.get("deny_by_default"),
            "provider": command_egress.get("provider"),
            "provider_endpoint_hosts": command_egress.get("provider_endpoint_hosts"),
            "allowed_purposes": command_egress.get("allowed_purposes"),
            "arbitrary_url_fetch_allowed": command_egress.get("arbitrary_url_fetch_allowed"),
            "google_drive_access_allowed": command_egress.get("google_drive_access_allowed"),
            "raw_file_bytes_allowed": command_egress.get("raw_file_bytes_allowed"),
            "s3_object_access_allowed": command_egress.get("s3_object_access_allowed"),
            "secret_values_in_payload_allowed": command_egress.get("secret_values_in_payload_allowed"),
            "provider_data_collection": command_egress.get("provider_data_collection"),
        },
        "allowed_writable_dirs": allowed_writable_dirs,
        "errors": errors,
        "warnings": warnings,
        "redaction": "verification summary omits manifest rows, file IDs, filenames, object keys, source refs, extracted text, review contents, and secrets",
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Verify a locked semantic-review worker bundle.")
    parser.add_argument("--bundle-dir", required=True)
    parser.add_argument("--output", help="Optional verification summary JSON path")
    args = parser.parse_args()

    summary = verify_bundle(Path(args.bundle_dir))
    output = json.dumps(summary, indent=2, sort_keys=True)
    if args.output:
        output_path = Path(args.output).expanduser().resolve()
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(output + "\n", encoding="utf-8")
    print(output)
    return 0 if summary["status"] == "ok" else 1


if __name__ == "__main__":
    raise SystemExit(main())
