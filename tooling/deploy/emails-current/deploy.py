#!/usr/bin/env python3
"""Deploy one exact current Emails image by cloning the reconciled live task."""
import argparse
import copy
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parent
RELEVANT_PATHS = (
    "apps/emails/**",
    ".github/workflows/emails-current-server-deploy.yml",
    ".github/workflows/emails-search-promotion.yml",
    ".github/workflows/emails-search-promotion-execute.yml",
    "tooling/deploy/emails-current/**",
    "tooling/deploy/emails-search/**",
)
SEARCH = ROOT.parent / "emails-search" / "promotion.py"
spec = importlib.util.spec_from_file_location("emails_search_promotion", SEARCH)
promotion = importlib.util.module_from_spec(spec)
spec.loader.exec_module(promotion)


def require(ok, code):
    if not ok:
        raise ValueError(code)


def read_reconciled(path, expected_sha, source):
    require(path.is_file() and not path.is_symlink() and path.stat().st_size < 65536, "RECONCILED_FILE")
    raw = path.read_bytes()
    require(hashlib.sha256(raw).hexdigest() == expected_sha, "RECONCILED_DIGEST")
    value = json.loads(raw)
    reconciliation_source = value.get("sourceCommit")
    require(value.get("schema") == "emails.promotion-reconciliation.v1" and re.fullmatch(r"[0-9a-f]{40}", reconciliation_source or ""), "RECONCILED_SOURCE")
    require(subprocess.run(["git", "merge-base", "--is-ancestor", reconciliation_source, source], stdin=subprocess.DEVNULL, capture_output=True, timeout=30).returncode == 0, "RECONCILED_SOURCE_NOT_ANCESTOR")
    require(subprocess.run(["git", "diff", "--quiet", reconciliation_source, source, "--", *RELEVANT_PATHS], stdin=subprocess.DEVNULL, capture_output=True, timeout=30).returncode == 0, "RECONCILED_SCOPE_DRIFT")
    require(value.get("state") == "descendant_overlay_live_stable", "RECONCILED_STATE")
    descendant = value.get("descendant")
    service = value.get("service")
    rollback = value.get("rollback")
    require(isinstance(descendant, dict) and isinstance(service, dict) and isinstance(rollback, dict), "RECONCILED_SHAPE")
    require(service.get("stable") is True and service.get("healthy") is True, "RECONCILED_HEALTH")
    require(service.get("taskDefinition") == descendant.get("taskDefinition") == rollback.get("preMigrationAnchor"), "RECONCILED_TASK")
    require(rollback.get("validAfterForwardMigration") is False and rollback.get("tasks88And89AreHistoricalOnly") is True, "RECONCILED_ROLLBACK")
    return value


def candidate_payload(current, image_digest):
    promotion.sha(image_digest)
    payload = promotion.task_payload(current)
    rows = [row for row in payload.get("containerDefinitions", []) if row.get("name") == "emails"]
    require(len(rows) == 1, "WEB_CONTAINER_IDENTITY")
    previous = rows[0].get("image")
    require(isinstance(previous, str) and previous.startswith(promotion.REPOSITORY + "@"), "CURRENT_IMAGE_REFERENCE")
    rows[0]["image"] = promotion.REPOSITORY + "@" + image_digest
    return payload, previous


def running_tasks(task_definition, desired_count, image_digest):
    arns = promotion.aws("ecs", "list-tasks", "--cluster", promotion.CLUSTER, "--service-name", promotion.SERVICE, "--desired-status", "RUNNING").get("taskArns", [])
    require(isinstance(arns, list) and len(arns) == desired_count and len(arns) <= 100, "LIVE_TASK_COUNT")
    rows = promotion.aws("ecs", "describe-tasks", "--cluster", promotion.CLUSTER, "--tasks", *arns)
    require(not rows.get("failures") and len(rows.get("tasks", [])) == desired_count, "LIVE_TASK_READ")
    safe = []
    for task in rows["tasks"]:
        web = [row for row in task.get("containers", []) if row.get("name") == "emails"]
        require(
            task.get("taskDefinitionArn") == task_definition
            and task.get("lastStatus") == "RUNNING"
            and task.get("healthStatus") == "HEALTHY"
            and len(web) == 1
            and web[0].get("imageDigest") == image_digest,
            "LIVE_IMAGE_DRIFT",
        )
        safe.append({
            "taskArnSha256": hashlib.sha256(task["taskArn"].encode()).hexdigest(),
            "taskDefinition": task_definition,
            "lastStatus": task.get("lastStatus"),
            "healthStatus": task.get("healthStatus"),
            "imageDigest": image_digest,
        })
    return safe


def deploy(source, reconciled_path, reconciled_sha, image_digest, out):
    require(re.fullmatch(r"[0-9a-f]{40}", source), "SOURCE_COMMIT")
    promotion.sha(image_digest)
    reconciled = read_reconciled(reconciled_path, reconciled_sha, source)
    require(promotion.aws("sts", "get-caller-identity")["Account"] == promotion.ACCOUNT, "AWS_ACCOUNT")
    anchor = reconciled["service"]["taskDefinition"]
    desired = reconciled["service"]["desiredCount"]
    current_service = promotion.current_service()
    require(promotion.service_binding(current_service) == anchor and current_service.get("desiredCount") == desired, "SERVICE_RECONCILIATION_DRIFT")
    current = promotion.task_read(anchor)
    current_payload = promotion.task_payload(current)
    require(promotion.digest(promotion.encode(current_payload)) == reconciled["descendant"]["digest"], "TASK_RECONCILIATION_DRIFT")
    require(promotion.task_image(current_payload) == reconciled["descendant"]["imageDigest"], "IMAGE_RECONCILIATION_DRIFT")
    candidate, previous_image = candidate_payload(current, image_digest)
    require(previous_image.endswith(reconciled["descendant"]["imageDigest"]), "PREVIOUS_IMAGE_DRIFT")
    require(candidate != current_payload, "CANDIDATE_IMAGE_UNCHANGED")
    normalized = copy.deepcopy(candidate)
    next(row for row in normalized["containerDefinitions"] if row.get("name") == "emails")["image"] = previous_image
    require(normalized == current_payload, "CANDIDATE_TASK_DRIFT")
    out.mkdir(mode=0o700)
    promotion.save(out / "register-intent.json", {
        "schema": "emails.current-deploy-intent.v1",
        "sourceCommit": source,
        "reconciledSha256": reconciled_sha,
        "taskBefore": anchor,
        "taskCandidateDigest": promotion.digest(promotion.encode(candidate)),
        "imageDigest": image_digest,
        "migrationDefinitionChanged": False,
    })
    request = copy.deepcopy(candidate)
    if request.get("tags") == []:
        del request["tags"]
    result = promotion.aws("ecs", "register-task-definition", body=request)
    new_arn = result["taskDefinition"]["taskDefinitionArn"]
    require(new_arn.startswith(f"arn:aws:ecs:{promotion.REGION}:{promotion.ACCOUNT}:task-definition/{promotion.SERVICE}:"), "REGISTERED_FAMILY")
    registered = promotion.task_read(new_arn)
    require(promotion.task_payload(registered) == candidate, "REGISTERED_TASK_DRIFT")
    promotion.save(out / "registered.json", {"taskDefinition": new_arn, "imageDigest": image_digest})
    fresh = promotion.current_service()
    require(promotion.service_binding(fresh) == anchor and fresh.get("desiredCount") == desired, "PRE_UPDATE_SERVICE_DRIFT")
    promotion.save(out / "update-intent.json", {"before": anchor, "after": new_arn})
    promotion.aws("ecs", "update-service", "--cluster", promotion.CLUSTER, "--service", promotion.SERVICE, "--task-definition", new_arn)
    try:
        live = promotion.wait_for_service(new_arn, desired)
        require(promotion.service_binding(live) == new_arn, "LIVE_SERVICE_DRIFT")
        tasks = running_tasks(new_arn, desired, image_digest)
        promotion.save(out / "deployed.json", {
            "schema": "emails.current-deployed.v1",
            "sourceCommit": source,
            "reconciledSha256": reconciled_sha,
            "taskBefore": anchor,
            "taskAfter": new_arn,
            "imageDigest": image_digest,
            "desiredCount": desired,
            "runningTasks": tasks,
            "taskConfigurationPreserved": True,
            "migrationDefinitionChanged": False,
            "automaticRollback": False,
        })
    except Exception:
        promotion.save(out / "reconciliation-required.json", {
            "taskBefore": anchor,
            "taskCandidate": new_arn,
            "automaticRetry": False,
            "automaticRollback": False,
        })
        raise


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True)
    parser.add_argument("--reconciled", type=Path, required=True)
    parser.add_argument("--reconciled-sha256", required=True)
    parser.add_argument("--image-digest", required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    os.umask(0o077)
    deploy(args.source, args.reconciled, args.reconciled_sha256, args.image_digest, args.out)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        message = str(error) if type(error) is ValueError and re.fullmatch(r"[A-Z_]+", str(error)) else type(error).__name__
        raise SystemExit("Emails current deploy stopped: " + message + "; inspect metadata before any retry")
