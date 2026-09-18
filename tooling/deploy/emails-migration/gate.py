#!/usr/bin/env python3
"""Credential-free exact-main and reviewed-artifact gate for Emails migrations."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile

REPO = "hasna/apps"
WORKFLOW = ".github/workflows/emails-current-migration-deploy.yml"
SEARCH_WORKFLOW = ".github/workflows/emails-search-promotion.yml"
FAILED_WORKFLOW = ".github/workflows/emails-current-server-deploy.yml"
SHA40 = re.compile(r"[0-9a-f]{40}")
SHA64 = re.compile(r"[0-9a-f]{64}")
RUN_ID = re.compile(r"[1-9][0-9]{0,19}")
MAX = 8 * 1024 * 1024
FAILED_FILES = {"register-intent.json", "registered.json", "update-intent.json", "reconciliation-required.json"}


def require(ok, code):
    if not ok:
        raise ValueError(code)


def require_phase(phase):
    require(phase != "execute", "MIGRATION_EXECUTION_DISABLED")
    require(phase in {"reconcile", "prepare"}, "PHASE")


def gh(path):
    result = subprocess.run(["gh", "api", path], stdin=subprocess.DEVNULL, capture_output=True, timeout=60)
    require(result.returncode == 0 and len(result.stdout) <= MAX, "GITHUB_READ_REFUSED")
    try:
        return json.loads(result.stdout)
    except Exception:
        raise ValueError("GITHUB_JSON_REFUSED")


def git_ok(*args):
    return subprocess.run(["git", *args], stdin=subprocess.DEVNULL, capture_output=True, timeout=30).returncode == 0


def exact_ci_success(rows, source):
    return any(
        row.get("head_sha") == source
        and row.get("head_branch") == "main"
        and row.get("event") == "push"
        and row.get("status") == "completed"
        and row.get("conclusion") == "success"
        and row.get("path") == ".github/workflows/ci.yml"
        and row.get("name") == "ci"
        for row in rows
    )


def run_metadata(run_id, path, source, exact=True, require_same_app=True):
    require(RUN_ID.fullmatch(str(run_id)), "RUN_ID")
    run = gh(f"repos/{REPO}/actions/runs/{run_id}")
    run_source = run.get("head_sha")
    require(
        SHA40.fullmatch(run_source or "")
        and run.get("head_branch") == "main"
        and run.get("event") == "workflow_dispatch"
        and run.get("status") == "completed"
        and run.get("conclusion") in ({"success"} if path != FAILED_WORKFLOW else {"failure"})
        and run.get("path") == path,
        "RUN_NOT_TRUSTED",
    )
    if exact:
        require(run_source == source, "RUN_SOURCE")
    else:
        require(git_ok("merge-base", "--is-ancestor", run_source, source), "RUN_SOURCE_NOT_ANCESTOR")
        if require_same_app:
            require(git_ok("diff", "--quiet", run_source, source, "--", "apps/emails/**"), "EMAILS_SOURCE_DRIFT")
    return run_source


def artifact(run_id, name, destination):
    rows = gh(f"repos/{REPO}/actions/runs/{run_id}/artifacts?per_page=100").get("artifacts", [])
    matches = [row for row in rows if row.get("name") == name and not row.get("expired")]
    require(len(matches) == 1, "ARTIFACT_COUNT")
    destination.mkdir(mode=0o700, parents=True)
    result = subprocess.run(
        ["gh", "run", "download", str(run_id), "--repo", REPO, "--name", name, "--dir", str(destination)],
        stdin=subprocess.DEVNULL,
        capture_output=True,
        timeout=90,
    )
    require(result.returncode == 0, "ARTIFACT_DOWNLOAD")
    return matches[0], {path.name: path for path in destination.iterdir()}


def read(path, expected_sha, code):
    require(path.is_file() and not path.is_symlink() and path.stat().st_size < 1024 * 1024, code)
    raw = path.read_bytes()
    require(SHA64.fullmatch(expected_sha or "") and hashlib.sha256(raw).hexdigest() == expected_sha, code)
    try:
        return json.loads(raw)
    except Exception:
        raise ValueError(code)


def anchor_input(source, run_id, expected_sha, destination):
    run_source = run_metadata(run_id, SEARCH_WORKFLOW, source, exact=False, require_same_app=False)
    _, files = artifact(run_id, "emails-search-reconciled", destination)
    require(set(files) == {"reconciled.json"}, "ANCHOR_FILE_SET")
    value = read(files["reconciled.json"], expected_sha, "ANCHOR_REVIEW_BINDING")
    require(value.get("schema") == "emails.promotion-reconciliation.v1" and value.get("sourceCommit") == run_source, "ANCHOR_SCHEMA")
    require(value.get("state") == "descendant_overlay_live_stable", "ANCHOR_STATE")
    require(value.get("service", {}).get("stable") is True and value.get("service", {}).get("healthy") is True, "ANCHOR_HEALTH")
    return value


def failed_input(source, run_id, destination):
    run_source = run_metadata(run_id, FAILED_WORKFLOW, source, exact=False, require_same_app=False)
    _, files = artifact(run_id, "emails-current-deployed", destination)
    require(set(files) == FAILED_FILES, "FAILED_FILE_SET")
    values = {}
    for name, path in files.items():
        require(path.is_file() and not path.is_symlink() and path.stat().st_size < 65536, "FAILED_RECEIPT")
        values[name] = json.loads(path.read_bytes())
    intent, registered, update, required = (values[name] for name in ("register-intent.json", "registered.json", "update-intent.json", "reconciliation-required.json"))
    require(intent.get("schema") == "emails.current-deploy-intent.v1" and intent.get("sourceCommit") == run_source, "FAILED_INTENT")
    candidate = registered.get("taskDefinition")
    image = registered.get("imageDigest")
    require(update.get("after") == candidate == required.get("taskCandidate"), "FAILED_CANDIDATE_BINDING")
    require(update.get("before") == intent.get("taskBefore") == required.get("taskBefore"), "FAILED_ANCHOR_BINDING")
    require(intent.get("imageDigest") == image and re.fullmatch(r"sha256:[0-9a-f]{64}", image or ""), "FAILED_IMAGE_BINDING")
    require(required.get("automaticRetry") is False and required.get("automaticRollback") is False, "FAILED_RETRY_BOUNDARY")
    return {"runId": int(run_id), "sourceCommit": run_source, "taskDefinition": candidate, "imageDigest": image, "taskBefore": update["before"]}


def migration_reconciliation(source, run_id, expected_sha, destination):
    run_metadata(run_id, WORKFLOW, source, exact=True)
    _, files = artifact(run_id, "emails-current-migration-reconciled", destination)
    require(set(files) == {"reconciled.json"}, "MIGRATION_RECONCILIATION_FILE_SET")
    value = read(files["reconciled.json"], expected_sha, "MIGRATION_RECONCILIATION_REVIEW_BINDING")
    require(value.get("schema") == "emails.current-migration-reconciliation.v1" and value.get("sourceCommit") == source, "MIGRATION_RECONCILIATION_SCHEMA")
    require(value.get("migrationDefinitionChanged") is True and value.get("awsMutationCalls") == 0 and type(value.get("historicalCandidateAppDiffersFromCurrent")) is bool, "MIGRATION_RECONCILIATION_STATE")
    historical = value.get("historicalAnchor")
    current = value.get("anchor")
    failed = value.get("failedCandidates")
    require(isinstance(historical, dict) and isinstance(current, dict) and isinstance(failed, list) and len(failed) == 2, "KMS_BASELINE_RECONCILIATION")
    historical_task = historical.get("taskDefinition")
    current_task = current.get("taskDefinition")
    require(isinstance(historical_task, str) and historical_task and isinstance(current_task, str) and current_task and historical_task != current_task and value.get("kmsBaselineConfigured") is True, "KMS_BASELINE_RECONCILIATION")
    require(all(isinstance(row, dict) and row.get("taskBefore") == historical_task for row in failed), "FAILED_HISTORICAL_ANCHOR")
    return value


def migration_plan(source, run_id, expected_sha, reconciliation_sha, destination):
    run_metadata(run_id, WORKFLOW, source, exact=True)
    _, files = artifact(run_id, "emails-current-migration-prepared", destination)
    require(set(files) == {"prepared.json"}, "MIGRATION_PLAN_FILE_SET")
    value = read(files["prepared.json"], expected_sha, "MIGRATION_PLAN_REVIEW_BINDING")
    require(value.get("schema") == "emails.current-migration-prepared.v1" and value.get("sourceCommit") == source, "MIGRATION_PLAN_SCHEMA")
    require(value.get("migrationReconciledSha256") == reconciliation_sha, "MIGRATION_PLAN_RECONCILIATION")
    require(value.get("serviceUpdated") is False and value.get("databaseMutated") is False, "MIGRATION_PLAN_MUTATION_BOUNDARY")
    candidate = value.get("candidate", {})
    require(isinstance(candidate, dict), "MIGRATION_PLAN_CANDIDATE")
    proof_id = hashlib.sha256(json.dumps({"source": source, "task": candidate.get("taskDefinition"), "image": candidate.get("imageDigest")}, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    require(value.get("kmsProof") == {"schema": "emails.migration-kms-proof.v1", "configured": True, "roundTrip": True, "keyMaterialEmitted": False, "proofId": proof_id}, "MIGRATION_PLAN_KMS_PROOF")
    return value


def validate(args, destination):
    require_phase(args.phase)
    source = args.source
    require(os.environ.get("GITHUB_REPOSITORY") == REPO, "REPOSITORY")
    require(os.environ.get("GITHUB_REF") == "refs/heads/main" and os.environ.get("GITHUB_EVENT_NAME") == "workflow_dispatch", "MAIN_DISPATCH_ONLY")
    require(SHA40.fullmatch(source or "") and source == os.environ.get("GITHUB_SHA"), "WORKFLOW_SOURCE")
    require(gh(f"repos/{REPO}/git/ref/heads/main")["object"]["sha"] == source, "SUPERSEDED_SOURCE")
    runs = gh(f"repos/{REPO}/actions/workflows/ci.yml/runs?branch=main&event=push&status=completed&head_sha={source}&per_page=100").get("workflow_runs", [])
    require(exact_ci_success(runs, source), "EXACT_MAIN_CI_REQUIRED")
    if args.phase == "reconcile":
        anchor_input(source, args.anchor_run, args.anchor_sha256, destination / "anchor")
        require(len(args.failed_run) == 2 and len(set(args.failed_run)) == 2, "FAILED_RUN_SET")
        for run_id in args.failed_run:
            failed_input(source, run_id, destination / f"failed-{run_id}")
    else:
        migration_reconciliation(source, args.migration_reconciliation_run, args.migration_reconciled_sha256, destination / "migration-reconciliation")
        if args.phase == "execute":
            migration_plan(source, args.plan_run, args.plan_sha256, args.migration_reconciled_sha256, destination / "plan")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--phase", required=True)
    parser.add_argument("--source", required=True)
    parser.add_argument("--anchor-run", default="")
    parser.add_argument("--anchor-sha256", default="")
    parser.add_argument("--failed-run", action="append", default=[])
    parser.add_argument("--migration-reconciliation-run", default="")
    parser.add_argument("--migration-reconciled-sha256", default="")
    parser.add_argument("--plan-run", default="")
    parser.add_argument("--plan-sha256", default="")
    parser.add_argument("--download", type=Path)
    args = parser.parse_args()
    if args.download is not None:
        args.download.mkdir(mode=0o700)
        validate(args, args.download)
    else:
        with tempfile.TemporaryDirectory(prefix="emails-migration-gate-") as temporary:
            validate(args, Path(temporary))
    print("Exact-main reviewed Emails migration admission passed")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        message = str(error) if type(error) is ValueError else type(error).__name__
        raise SystemExit("Emails migration gate refused: " + message)
