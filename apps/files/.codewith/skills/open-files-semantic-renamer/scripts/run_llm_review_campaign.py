#!/usr/bin/env python3
"""Run an approved open-files LLM review campaign plan.

This launcher is dry-run by default. When execution is explicitly requested, it
validates the plan first, refuses unapproved plans, runs planned shard commands,
and captures worker stdout/stderr to private per-shard logs. Stdout from this
script remains aggregate-only.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any


SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))
CORPUS_READER_SCRIPTS = SCRIPT_DIR.parent.parent / "open-files-corpus-reader" / "scripts"
sys.path.insert(0, str(CORPUS_READER_SCRIPTS))

from global_execution_preflight import build_global_execution_preflight, plan_approval_token  # noqa: E402
from validate_llm_review_campaign import command_flags, flag_value, validate_campaign  # noqa: E402


ENV_ALLOWLIST = {
    "CODEWITH_HOME",
    "FILES_DB_PATH",
    "HASNA_FILES_DATA_DIR",
    "HASNA_FILES_DB_PATH",
    "HOME",
    "LANG",
    "LC_ALL",
    "LOGNAME",
    "PATH",
    "SHELL",
    "TERM",
    "TMPDIR",
    "USER",
    "XDG_CACHE_HOME",
    "XDG_CONFIG_HOME",
    "XDG_DATA_HOME",
}


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_plan(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise SystemExit("campaign plan must be a JSON object")
    return value


def resolve_path(value: Any, base: Path) -> Path:
    if isinstance(value, str) and value:
        path = Path(value).expanduser()
        if not path.is_absolute():
            path = base / path
        return path.resolve()
    return base.resolve()


def command_cwd(command: list[str], fallback: Path) -> Path:
    flags = command_flags(command)
    cwd_value = flag_value(flags, "--cwd")
    if cwd_value:
        return Path(cwd_value).expanduser().resolve()
    return fallback.resolve()


def command_timeout(command: list[str], default_seconds: int) -> int:
    flags = command_flags(command)
    timeout_value = flag_value(flags, "--timeout-seconds")
    if not timeout_value:
        return default_seconds
    try:
        return max(1, int(float(timeout_value))) + 60
    except ValueError:
        return default_seconds


def minimal_launcher_env(base_env: dict[str, str]) -> dict[str, str]:
    env = {key: value for key, value in base_env.items() if key in ENV_ALLOWLIST and value}
    env["OPEN_FILES_CAMPAIGN_LAUNCHER_ENV"] = "minimal-allowlist"
    return env


def safe_entry(entry: dict[str, Any]) -> dict[str, Any]:
    return {
        "shard": entry.get("shard"),
        "jobs": entry.get("jobs"),
        "provider": entry.get("provider"),
        "provider_type": entry.get("provider_type"),
        "execution_mode": entry.get("execution_mode"),
    }


def run_entry(entry: dict[str, Any], plan_root: Path, timeout_seconds: int) -> dict[str, Any]:
    started = time.monotonic()
    command = entry.get("command")
    if not isinstance(command, list) or not all(isinstance(item, str) for item in command):
        return {**safe_entry(entry), "status": "failed", "returncode": None, "reason": "invalid_command"}

    output_dir = resolve_path(entry.get("output_dir"), plan_root)
    output_dir.mkdir(parents=True, exist_ok=True)
    stdout_log = output_dir / "campaign-launcher.stdout.log"
    stderr_log = output_dir / "campaign-launcher.stderr.log"
    cwd = command_cwd(command, plan_root)
    timeout = command_timeout(command, timeout_seconds)

    result: dict[str, Any] = {
        **safe_entry(entry),
        "status": "running",
        "returncode": None,
        "logs": {
            "stdout": str(stdout_log),
            "stderr": str(stderr_log),
        },
        "environment": {
            "policy": "minimal-allowlist",
            "allowed_keys": sorted(minimal_launcher_env(os.environ)),
        },
    }
    try:
        with stdout_log.open("w", encoding="utf-8") as stdout_handle, stderr_log.open("w", encoding="utf-8") as stderr_handle:
            completed = subprocess.run(
                command,
                cwd=str(cwd),
                check=False,
                stdout=stdout_handle,
                stderr=stderr_handle,
                text=True,
                timeout=timeout,
                env=minimal_launcher_env(os.environ),
            )
        result["returncode"] = completed.returncode
        result["status"] = "completed" if completed.returncode == 0 else "failed"
    except subprocess.TimeoutExpired:
        result["status"] = "failed"
        result["reason"] = "timeout"
    except OSError:
        result["status"] = "failed"
        result["reason"] = "launch_error"

    result["duration_seconds"] = round(time.monotonic() - started, 3)
    return result


def planned_entries(entries: list[dict[str, Any]], max_shards: int | None) -> list[dict[str, Any]]:
    if max_shards is None:
        return entries
    return entries[: max(0, max_shards)]


def aggregate_run_results(results: list[dict[str, Any]]) -> dict[str, int]:
    aggregate = {"completed": 0, "failed": 0, "skipped": 0}
    for result in results:
        status = str(result.get("status") or "failed")
        if status in aggregate:
            aggregate[status] += 1
    return aggregate


def schedule_gate(plan: dict[str, Any], entries: list[dict[str, Any]], requested_parallel: int) -> dict[str, Any]:
    policy = plan.get("schedule_policy")
    if not isinstance(policy, dict):
        return {"status": "blocked", "reason": "missing_schedule_policy", "requested_parallel": requested_parallel}
    max_campaign_parallel = policy.get("max_campaign_parallel")
    if not isinstance(max_campaign_parallel, int) or max_campaign_parallel <= 0:
        return {"status": "blocked", "reason": "invalid_max_campaign_parallel", "requested_parallel": requested_parallel}
    account_counts: dict[str, int] = {}
    account_caps: dict[str, int] = {}
    for entry in entries:
        account_ref = str(entry.get("account_ref") or "unknown")
        account_counts[account_ref] = account_counts.get(account_ref, 0) + 1
        cap = entry.get("account_max_parallel")
        if isinstance(cap, int) and cap > 0:
            account_caps[account_ref] = min(account_caps.get(account_ref, cap), cap)
        else:
            account_caps[account_ref] = 0
    account_parallel_blockers = [
        account_ref
        for account_ref, selected in account_counts.items()
        if selected > 1 and requested_parallel > account_caps.get(account_ref, 0)
    ]
    if requested_parallel > max_campaign_parallel:
        status = "blocked"
        reason = "parallel_exceeds_campaign_policy"
    elif account_parallel_blockers:
        status = "blocked"
        reason = "parallel_could_exceed_account_policy"
    else:
        status = "ok"
        reason = None
    return {
        "status": status,
        "reason": reason,
        "requested_parallel": requested_parallel,
        "max_campaign_parallel": max_campaign_parallel,
        "selected_shards": len(entries),
        "accounts_selected": len(account_counts),
        "account_parallel_blockers": sorted(account_parallel_blockers),
        "redaction": "schedule gate contains account labels and counts only; no file IDs, filenames, object keys, source refs, proposal rows, or secrets",
    }


def approval_attestation(
    plan_path: Path,
    plan: dict[str, Any],
    validation: dict[str, Any],
    execute_requested: bool,
    selected_entries: list[dict[str, Any]],
    decision: str,
) -> dict[str, Any]:
    approved = bool(plan.get("approved"))
    validation_ok = validation.get("status") == "ok"
    if not execute_requested:
        status = "not_requested"
    elif not validation_ok:
        status = "validation_failed"
    elif not approved:
        status = "blocked"
    else:
        status = "verified"
    return {
        "status": status,
        "decision": decision,
        "runtime_enforced": bool(execute_requested),
        "execute_requested": bool(execute_requested),
        "plan_approved": approved,
        "approval_note_present": bool(plan.get("approval_note")) or ((plan.get("approval_attestation") or {}).get("approval_note_present") is True if isinstance(plan.get("approval_attestation"), dict) else False),
        "approval_note_sha256": (plan.get("approval_attestation") or {}).get("approval_note_sha256") if isinstance(plan.get("approval_attestation"), dict) else None,
        "validation_status": validation.get("status"),
        "plan_sha256": file_sha256(plan_path),
        "shards_selected": len(selected_entries),
        "jobs_selected": sum(int(entry.get("jobs") or 0) for entry in selected_entries),
        "execute_commands_in_plan": validation.get("execute_commands"),
        "redaction_preflight_status": (validation.get("redaction_attestation") or {}).get("status") if isinstance(validation.get("redaction_attestation"), dict) else None,
        "redaction_preflight_rows": (validation.get("redaction_attestation") or {}).get("rows") if isinstance(validation.get("redaction_attestation"), dict) else None,
        "rule": "Launcher refuses execution unless validation is ok, plan.approved is true, and --execute was explicitly requested.",
        "redaction": "attestation omits manifest rows, file IDs, filenames, object keys, source refs, proposal rows, and secrets",
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Run or dry-run an approved LLM review campaign plan.")
    parser.add_argument("--plan", required=True, help="Path to campaign-plan.json")
    parser.add_argument("--execute", action="store_true", help="Actually execute approved shard commands")
    parser.add_argument("--max-shards", type=int, help="Maximum shards to launch")
    parser.add_argument("--execution-scope", choices=["canary", "scale"], default="canary", help="Execution scope used by the global readiness preflight")
    parser.add_argument("--max-canary-jobs", type=int, default=10, help="Maximum jobs allowed when --execution-scope=canary")
    parser.add_argument("--extraction-readiness-gate", help="Optional extraction-lane-readiness-gate.json path for global execution preflight")
    parser.add_argument("--parallel", type=int, default=1, help="Maximum shard commands to run concurrently")
    parser.add_argument(
        "--allow-existing-state",
        action="store_true",
        help="Allow existing state files for resume campaigns during validation",
    )
    parser.add_argument("--continue-on-failure", action="store_true", help="Continue launching shards after a failure")
    parser.add_argument("--timeout-seconds", type=int, default=960, help="Fallback per-shard timeout")
    parser.add_argument("--summary-output", help="Optional path to write aggregate launch summary")
    args = parser.parse_args()

    if args.parallel <= 0:
        raise SystemExit("--parallel must be positive")
    if args.max_shards is not None and args.max_shards < 0:
        raise SystemExit("--max-shards cannot be negative")
    if args.max_canary_jobs < 0:
        raise SystemExit("--max-canary-jobs cannot be negative")

    plan_path = Path(args.plan).expanduser().resolve()
    plan_root = plan_path.parent
    validation = validate_campaign(
        plan_path,
        allow_existing_state=args.allow_existing_state,
        require_sanitized_rows=True,
    )
    plan = load_plan(plan_path)
    entries = planned_entries([entry for entry in plan.get("shard_entries", []) if isinstance(entry, dict)], args.max_shards)
    approval_token = plan_approval_token(plan)

    summary: dict[str, Any] = {
        "status": "validation_failed" if validation["status"] != "ok" else "dry_run",
        "plan": str(plan_path),
        "approved": bool(plan.get("approved")),
        "execute_requested": bool(args.execute),
        "shards_selected": len(entries),
        "jobs_selected": sum(int(entry.get("jobs") or 0) for entry in entries),
        "parallel": args.parallel,
        "schedule_gate": schedule_gate(plan, entries, args.parallel),
        "validation": {
            "status": validation["status"],
            "errors": validation["errors"],
            "warnings": validation["warnings"],
            "redaction_attestation": validation.get("redaction_attestation"),
            "require_sanitized_rows": validation.get("require_sanitized_rows"),
        },
        "results": [],
        "global_execution_preflight": build_global_execution_preflight(
            plan_root=plan_root,
            explicit_gate_path=args.extraction_readiness_gate,
            execute_requested=args.execute,
            execution_scope=args.execution_scope,
            selected_jobs=sum(int(entry.get("jobs") or 0) for entry in entries),
            selected_bytes=None,
            max_canary_jobs=args.max_canary_jobs,
            max_canary_bytes=None,
            **approval_token,
        ),
        "redaction": "launcher summary omits worker stdout/stderr, manifest rows, filenames, object keys, source refs, file IDs, proposal rows, and secrets",
    }
    summary["approval_attestation"] = approval_attestation(
        plan_path,
        plan,
        validation,
        args.execute,
        entries,
        str(summary["status"]),
    )

    if validation["status"] != "ok":
        summary["approval_attestation"] = approval_attestation(plan_path, plan, validation, args.execute, entries, "validation_failed")
        output = json.dumps(summary, indent=2, sort_keys=True)
        print(output)
        if args.summary_output:
            Path(args.summary_output).expanduser().resolve().write_text(output + "\n", encoding="utf-8")
        return 1

    if summary["schedule_gate"]["status"] != "ok":
        summary["status"] = "schedule_policy_violation"
        summary["results"] = [{**safe_entry(entry), "status": "skipped"} for entry in entries]
        summary["aggregate"] = aggregate_run_results(summary["results"])
        summary["approval_attestation"] = approval_attestation(plan_path, plan, validation, args.execute, entries, "schedule_policy_violation")
        output = json.dumps(summary, indent=2, sort_keys=True)
        print(output)
        if args.summary_output:
            summary_path = Path(args.summary_output).expanduser().resolve()
            summary_path.parent.mkdir(parents=True, exist_ok=True)
            summary_path.write_text(output + "\n", encoding="utf-8")
        return 1

    if not args.execute:
        summary["results"] = [{**safe_entry(entry), "status": "skipped"} for entry in entries]
        summary["aggregate"] = aggregate_run_results(summary["results"])
        summary["approval_attestation"] = approval_attestation(plan_path, plan, validation, False, entries, "dry_run")
        output = json.dumps(summary, indent=2, sort_keys=True)
        print(output)
        if args.summary_output:
            summary_path = Path(args.summary_output).expanduser().resolve()
            summary_path.parent.mkdir(parents=True, exist_ok=True)
            summary_path.write_text(output + "\n", encoding="utf-8")
        return 0

    if not plan.get("approved"):
        summary["status"] = "approval_required"
        summary["results"] = [{**safe_entry(entry), "status": "skipped"} for entry in entries]
        summary["aggregate"] = aggregate_run_results(summary["results"])
        summary["approval_attestation"] = approval_attestation(plan_path, plan, validation, True, entries, "approval_required")
        output = json.dumps(summary, indent=2, sort_keys=True)
        print(output)
        if args.summary_output:
            summary_path = Path(args.summary_output).expanduser().resolve()
            summary_path.parent.mkdir(parents=True, exist_ok=True)
            summary_path.write_text(output + "\n", encoding="utf-8")
        return 1

    if summary["global_execution_preflight"]["allowed"] is not True:
        summary["status"] = "global_execution_preflight_blocked"
        summary["results"] = [{**safe_entry(entry), "status": "skipped"} for entry in entries]
        summary["aggregate"] = aggregate_run_results(summary["results"])
        summary["approval_attestation"] = approval_attestation(plan_path, plan, validation, True, entries, "global_execution_preflight_blocked")
        output = json.dumps(summary, indent=2, sort_keys=True)
        print(output)
        if args.summary_output:
            summary_path = Path(args.summary_output).expanduser().resolve()
            summary_path.parent.mkdir(parents=True, exist_ok=True)
            summary_path.write_text(output + "\n", encoding="utf-8")
        return 1

    results: list[dict[str, Any]] = []
    stop_launching = False
    if args.parallel == 1:
        for entry in entries:
            if stop_launching:
                results.append({**safe_entry(entry), "status": "skipped", "reason": "previous_failure"})
                continue
            result = run_entry(entry, plan_root, args.timeout_seconds)
            results.append(result)
            if result.get("status") == "failed" and not args.continue_on_failure:
                stop_launching = True
    else:
        with ThreadPoolExecutor(max_workers=args.parallel) as executor:
            future_to_entry = {
                executor.submit(run_entry, entry, plan_root, args.timeout_seconds): entry
                for entry in entries
            }
            for future in as_completed(future_to_entry):
                result = future.result()
                results.append(result)

    aggregate = aggregate_run_results(results)
    summary["status"] = "completed" if aggregate["failed"] == 0 else "failed"
    summary["results"] = results
    summary["aggregate"] = aggregate
    summary["approval_attestation"] = approval_attestation(plan_path, plan, validation, True, entries, str(summary["status"]))
    output = json.dumps(summary, indent=2, sort_keys=True)
    print(output)
    summary_path = Path(args.summary_output).expanduser().resolve() if args.summary_output else plan_root / "campaign-launch-summary.json"
    summary_path.parent.mkdir(parents=True, exist_ok=True)
    summary_path.write_text(output + "\n", encoding="utf-8")
    return 0 if summary["status"] == "completed" else 1


if __name__ == "__main__":
    raise SystemExit(main())
