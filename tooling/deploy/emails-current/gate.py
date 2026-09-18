#!/usr/bin/env python3
"""Read-only admission for deploying the exact current Emails server."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile


def require(ok, code):
    if not ok:
        raise ValueError(code)


def gh(path):
    result = subprocess.run(["gh", "api", path], stdin=subprocess.DEVNULL, capture_output=True, timeout=60)
    require(result.returncode == 0 and len(result.stdout) < 8 * 1024 * 1024, "GITHUB_READ_REFUSED")
    return json.loads(result.stdout)


def exact_ci_success(runs, source):
    return any(
        row.get("head_sha") == source
        and row.get("head_branch") == "main"
        and row.get("event") == "push"
        and row.get("status") == "completed"
        and row.get("conclusion") == "success"
        and row.get("name") == "ci"
        and row.get("path") == ".github/workflows/ci.yml"
        for row in runs
    )


def validate_reconciled(value, source, expected_sha):
    require(set(value) == {
        "schema", "sourceCommit", "preparedSourceCommit", "preparedSha256",
        "task88", "task89", "descendant", "service", "state", "rollback",
    }, "RECONCILED_FIELDS")
    require(value.get("schema") == "emails.promotion-reconciliation.v1", "RECONCILED_SCHEMA")
    require(value.get("sourceCommit") == source, "RECONCILED_SOURCE")
    require(re.fullmatch(r"[0-9a-f]{40}", value.get("preparedSourceCommit", "")), "RECONCILED_PREPARED_SOURCE")
    require(re.fullmatch(r"[0-9a-f]{64}", value.get("preparedSha256", "")), "RECONCILED_PREPARED_DIGEST")
    require(value.get("state") == "descendant_overlay_live_stable", "RECONCILED_STATE")

    descendant = value.get("descendant")
    service = value.get("service")
    rollback = value.get("rollback")
    require(isinstance(descendant, dict) and isinstance(service, dict) and isinstance(rollback, dict), "RECONCILED_SHAPE")
    task_definition = descendant.get("taskDefinition")
    image_digest = descendant.get("imageDigest")
    task_digest = descendant.get("digest")
    require(isinstance(task_definition, str) and re.fullmatch(r"arn:aws:ecs:us-east-1:[0-9]{12}:task-definition/emails-prod:[1-9][0-9]*", task_definition), "RECONCILED_TASK")
    require(re.fullmatch(r"sha256:[0-9a-f]{64}", image_digest or ""), "RECONCILED_IMAGE")
    require(re.fullmatch(r"sha256:[0-9a-f]{64}", task_digest or ""), "RECONCILED_TASK_DIGEST")
    require(service.get("taskDefinition") == task_definition, "RECONCILED_SERVICE_TASK")
    require(service.get("stable") is True and service.get("healthy") is True, "RECONCILED_SERVICE_HEALTH")
    desired = service.get("desiredCount")
    require(type(desired) is int and desired >= 1, "RECONCILED_DESIRED_COUNT")
    require(service.get("runningCount") == desired and service.get("pendingCount") == 0, "RECONCILED_SERVICE_COUNTS")
    deployments = service.get("deployments")
    require(isinstance(deployments, list) and len(deployments) == 1, "RECONCILED_DEPLOYMENTS")
    deployment = deployments[0]
    require(
        deployment.get("taskDefinition") == task_definition
        and deployment.get("status") == "PRIMARY"
        and deployment.get("rolloutState") == "COMPLETED"
        and deployment.get("desiredCount") == desired
        and deployment.get("runningCount") == desired
        and deployment.get("pendingCount") == 0,
        "RECONCILED_DEPLOYMENT_STATE",
    )
    tasks = service.get("runningTasks")
    require(isinstance(tasks, list) and len(tasks) == desired, "RECONCILED_RUNNING_TASKS")
    require(all(
        row.get("taskDefinition") == task_definition
        and row.get("lastStatus") == "RUNNING"
        and row.get("healthStatus") == "HEALTHY"
        and row.get("imageDigest") == image_digest
        and re.fullmatch(r"[0-9a-f]{64}", row.get("taskArnSha256", ""))
        for row in tasks
    ), "RECONCILED_RUNNING_TASK_STATE")
    require(
        rollback.get("preMigrationAnchor") == task_definition
        and rollback.get("automatic") is False
        and rollback.get("tasks88And89AreHistoricalOnly") is True
        and rollback.get("validAfterForwardMigration") is False
        and rollback.get("requiresSeparateReview") is True,
        "RECONCILED_ROLLBACK_BOUNDARY",
    )
    require(re.fullmatch(r"[0-9a-f]{64}", expected_sha), "RECONCILED_REVIEW_BINDING")
    return value


def verify_file(path, expected_sha, source):
    require(path.is_file() and not path.is_symlink() and path.stat().st_size < 65536, "RECONCILED_ARTIFACT_DIGEST")
    raw = path.read_bytes()
    require(hashlib.sha256(raw).hexdigest() == expected_sha, "RECONCILED_ARTIFACT_DIGEST")
    try:
        value = json.loads(raw)
    except Exception:
        raise ValueError("RECONCILED_ARTIFACT_JSON")
    validate_reconciled(value, source, expected_sha)
    path.chmod(0o600)
    return value


def download(repo, run, destination, expected_sha, source):
    destination.mkdir(mode=0o700)
    result = subprocess.run(
        ["gh", "run", "download", run, "--repo", repo, "--name", "emails-search-reconciled", "--dir", str(destination)],
        stdin=subprocess.DEVNULL,
        capture_output=True,
        timeout=90,
    )
    require(result.returncode == 0, "RECONCILED_DOWNLOAD_REFUSED")
    files = list(destination.iterdir())
    require(len(files) == 1 and files[0].name == "reconciled.json", "RECONCILED_FILE_SET")
    return verify_file(files[0], expected_sha, source)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True)
    parser.add_argument("--run", required=True)
    parser.add_argument("--reconciled-sha256", required=True)
    parser.add_argument("--download", type=Path)
    args = parser.parse_args()
    repo = os.environ.get("GITHUB_REPOSITORY")
    require(repo == "hasna/apps", "REPOSITORY")
    require(os.environ.get("GITHUB_REF") == "refs/heads/main" and os.environ.get("GITHUB_EVENT_NAME") == "workflow_dispatch", "MAIN_DISPATCH_ONLY")
    require(re.fullmatch(r"[0-9a-f]{40}", args.source) and args.source == os.environ.get("GITHUB_SHA"), "WORKFLOW_SOURCE")
    require(re.fullmatch(r"[1-9][0-9]{0,19}", args.run), "RECONCILIATION_RUN_BINDING")
    require(re.fullmatch(r"[0-9a-f]{64}", args.reconciled_sha256), "RECONCILIATION_DIGEST_BINDING")
    require(gh(f"repos/{repo}/git/ref/heads/main")["object"]["sha"] == args.source, "SUPERSEDED_SOURCE")
    runs = gh(f"repos/{repo}/actions/workflows/ci.yml/runs?branch=main&event=push&status=completed&head_sha={args.source}&per_page=100")["workflow_runs"]
    require(exact_ci_success(runs, args.source), "EXACT_MAIN_CI_REQUIRED")
    run = gh(f"repos/{repo}/actions/runs/{args.run}")
    require(
        run.get("head_sha") == args.source
        and run.get("head_branch") == "main"
        and run.get("event") == "workflow_dispatch"
        and run.get("status") == "completed"
        and run.get("conclusion") == "success"
        and run.get("path") == ".github/workflows/emails-search-promotion.yml",
        "RECONCILIATION_RUN_NOT_TRUSTED",
    )
    artifacts = gh(f"repos/{repo}/actions/runs/{args.run}/artifacts?per_page=100")["artifacts"]
    rows = [row for row in artifacts if row.get("name") == "emails-search-reconciled" and not row.get("expired")]
    require(len(rows) == 1, "RECONCILED_ARTIFACT_COUNT")
    if args.download is not None:
        download(repo, args.run, args.download, args.reconciled_sha256, args.source)
    else:
        with tempfile.TemporaryDirectory(prefix="emails-reconciled-gate-") as temporary:
            download(repo, args.run, Path(temporary) / "artifact", args.reconciled_sha256, args.source)
    print("Exact-main CI and reconciled Emails runtime admission passed")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        message = str(error) if type(error) is ValueError else type(error).__name__
        raise SystemExit("Emails current deploy gate refused: " + message)
