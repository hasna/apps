#!/usr/bin/env python3
"""Reviewed, roll-forward-only Emails migration-aware deployment orchestration."""
import argparse
import copy
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
import time

ROOT = Path(__file__).resolve().parent
CURRENT = ROOT.parent / "emails-current"
SEARCH = ROOT.parent / "emails-search" / "promotion.py"
spec = importlib.util.spec_from_file_location("emails_search_promotion", SEARCH)
promotion = importlib.util.module_from_spec(spec)
spec.loader.exec_module(promotion)
spec = importlib.util.spec_from_file_location("emails_migration_admission", CURRENT / "migration_admission.py")
admission_module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(admission_module)

TASK_SCRIPT_PATH = ROOT / "task_receipt.js"
TASK_PATTERN = re.compile(r"arn:aws:ecs:us-east-1:789877399345:task-definition/emails-prod:[1-9][0-9]*")
DIGEST_PATTERN = re.compile(r"sha256:[0-9a-f]{64}")
SHA64 = re.compile(r"[0-9a-f]{64}")
RECEIPT_MARKER = "EMAILS_MIGRATION_RECEIPT:"
MIGRATION_EXECUTION_ENABLED = False  # Requires atomic migration and paired API/worker cutover review.


def require(ok, code):
    if not ok:
        raise ValueError(code)


def encode(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":")).encode()


def digest(value):
    return hashlib.sha256(encode(value)).hexdigest()


def file_digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def read(path, schema=None):
    require(path.is_file() and not path.is_symlink() and path.stat().st_size < 1024 * 1024, "RECEIPT_FILE")
    value = json.loads(path.read_bytes())
    if schema is not None:
        require(value.get("schema") == schema, "RECEIPT_SCHEMA")
    return value


def require_main_source(source):
    result = subprocess.run(
        ["gh", "api", f"repos/hasna/apps/git/ref/heads/main", "--jq", ".object.sha"],
        stdin=subprocess.DEVNULL,
        capture_output=True,
        timeout=60,
        env={**os.environ, "GH_PAGER": "cat"},
    )
    require(result.returncode == 0 and result.stdout.decode().strip() == source, "SUPERSEDED_SOURCE")


def task_payload(task):
    return promotion.task_payload(task)


def task_image(payload):
    return promotion.task_image(payload)


def image_only_candidate(anchor, image_digest):
    promotion.sha(image_digest)
    payload = task_payload(anchor)
    rows = [row for row in payload.get("containerDefinitions", []) if row.get("name") == "emails"]
    require(len(rows) == 1, "WEB_CONTAINER_IDENTITY")
    before = rows[0].get("image")
    require(isinstance(before, str) and before.startswith(promotion.REPOSITORY + "@"), "ANCHOR_IMAGE")
    rows[0]["image"] = promotion.REPOSITORY + "@" + image_digest
    restored = copy.deepcopy(payload)
    next(row for row in restored["containerDefinitions"] if row.get("name") == "emails")["image"] = before
    require(restored == task_payload(anchor), "CANDIDATE_TASK_DRIFT")
    return payload, before.removeprefix(promotion.REPOSITORY + "@")


def load_failed(directory):
    intent = read(directory / "register-intent.json", "emails.current-deploy-intent.v1")
    registered = read(directory / "registered.json")
    update = read(directory / "update-intent.json")
    required = read(directory / "reconciliation-required.json")
    task_definition = registered.get("taskDefinition")
    image_digest = registered.get("imageDigest")
    require(TASK_PATTERN.fullmatch(task_definition or "") and DIGEST_PATTERN.fullmatch(image_digest or ""), "FAILED_IDENTITY")
    require(update.get("after") == task_definition == required.get("taskCandidate"), "FAILED_TASK_BINDING")
    require(update.get("before") == intent.get("taskBefore") == required.get("taskBefore"), "FAILED_ANCHOR_BINDING")
    require(intent.get("imageDigest") == image_digest, "FAILED_IMAGE_BINDING")
    require(required.get("automaticRetry") is False and required.get("automaticRollback") is False, "FAILED_AUTOMATION")
    return {
        "runId": int(directory.name.removeprefix("failed-")),
        "sourceCommit": intent["sourceCommit"],
        "taskDefinition": task_definition,
        "imageDigest": image_digest,
        "taskBefore": update["before"],
    }


def controlled_service(service):
    return {
        "serviceName": service.get("serviceName"),
        "status": service.get("status"),
        "taskDefinition": service.get("taskDefinition"),
        "desiredCount": service.get("desiredCount"),
        "runningCount": service.get("runningCount"),
        "pendingCount": service.get("pendingCount"),
        "networkConfigurationSha256": digest(service.get("networkConfiguration", {})),
        "capacityProviderStrategy": service.get("capacityProviderStrategy", []),
        "launchType": service.get("launchType"),
        "platformVersion": service.get("platformVersion"),
        "deploymentController": service.get("deploymentController"),
        "deploymentConfigurationSha256": digest(service.get("deploymentConfiguration", {})),
        "deployments": [
            {
                "taskDefinition": row.get("taskDefinition"),
                "status": row.get("status"),
                "rolloutState": row.get("rolloutState"),
                "desiredCount": row.get("desiredCount"),
                "runningCount": row.get("runningCount"),
                "pendingCount": row.get("pendingCount"),
                "failedTasks": row.get("failedTasks"),
            }
            for row in service.get("deployments", [])
        ],
    }


def roll_forward_deployment_configuration(service):
    require(service.get("deploymentController", {}).get("type") == "ECS", "DEPLOYMENT_CONTROLLER")
    current = service.get("deploymentConfiguration", {})
    minimum = current.get("minimumHealthyPercent")
    maximum = current.get("maximumPercent")
    require(type(minimum) is int and 0 <= minimum <= 100 and type(maximum) is int and 100 <= maximum <= 200, "DEPLOYMENT_PERCENTAGES")
    result = {"minimumHealthyPercent": minimum, "maximumPercent": maximum}
    circuit = current.get("deploymentCircuitBreaker")
    if isinstance(circuit, dict):
        require(type(circuit.get("enable")) is bool, "DEPLOYMENT_CIRCUIT_BREAKER")
        result["deploymentCircuitBreaker"] = {"enable": circuit["enable"], "rollback": False}
    alarms = current.get("alarms")
    if isinstance(alarms, dict):
        names = alarms.get("alarmNames")
        require(isinstance(names, list) and all(isinstance(name, str) and name for name in names) and type(alarms.get("enable")) is bool, "DEPLOYMENT_ALARMS")
        result["alarms"] = {"alarmNames": names, "enable": alarms["enable"], "rollback": False}
    return result


def require_no_automatic_rollback(service):
    config = service.get("deploymentConfiguration", {})
    circuit = config.get("deploymentCircuitBreaker", {})
    alarms = config.get("alarms", {})
    require(circuit.get("rollback") is not True and alarms.get("rollback") is not True, "AUTOMATIC_ROLLBACK_ENABLED")


def running_snapshot(anchor_task, anchor_image, desired):
    arns = promotion.aws("ecs", "list-tasks", "--cluster", promotion.CLUSTER, "--service-name", promotion.SERVICE, "--desired-status", "RUNNING").get("taskArns", [])
    require(isinstance(arns, list) and len(arns) == desired and len(arns) <= 100, "RUNNING_TASK_COUNT")
    rows = promotion.aws("ecs", "describe-tasks", "--cluster", promotion.CLUSTER, "--tasks", *arns)
    require(not rows.get("failures") and len(rows.get("tasks", [])) == desired, "RUNNING_TASK_READ")
    safe, controlled = [], []
    for task in rows["tasks"]:
        web = [row for row in task.get("containers", []) if row.get("name") == "emails"]
        require(
            task.get("taskDefinitionArn") == anchor_task
            and task.get("lastStatus") == "RUNNING"
            and task.get("healthStatus") == "HEALTHY"
            and len(web) == 1
            and web[0].get("imageDigest") == anchor_image,
            "RUNNING_ANCHOR_DRIFT",
        )
        controlled.append({"taskArn": task.get("taskArn"), "taskDefinition": anchor_task, "imageDigest": anchor_image})
        safe.append({
            "taskArnSha256": hashlib.sha256(task["taskArn"].encode()).hexdigest(),
            "taskDefinition": anchor_task,
            "imageDigest": anchor_image,
            "lastStatus": "RUNNING",
            "healthStatus": "HEALTHY",
        })
    return safe, digest(controlled)


def require_kms_baseline(historical_payload, current_payload):
    historical = copy.deepcopy(historical_payload)
    current = copy.deepcopy(current_payload)
    old_web = [row for row in historical.get("containerDefinitions", []) if row.get("name") == "emails"]
    new_web = [row for row in current.get("containerDefinitions", []) if row.get("name") == "emails"]
    require(len(old_web) == len(new_web) == 1, "KMS_BASELINE_CONTAINER")
    names = {"EMAILS_PROVIDER_KMS_KEY_ID", "EMAILS_PROVIDER_KMS_REGION"}
    old_env = old_web[0].get("environment", [])
    new_env = new_web[0].get("environment", [])
    require(isinstance(old_env, list) and isinstance(new_env, list), "KMS_BASELINE_ENVIRONMENT")
    require(not any(row.get("name") in names for row in old_env), "HISTORICAL_KMS_BINDING")
    require(not any(row.get("name") in names for row in old_web[0].get("secrets", [])), "HISTORICAL_KMS_SECRET")
    require(not any(row.get("name") in names for row in new_web[0].get("secrets", [])), "KMS_BASELINE_SECRET")
    added = [row for row in new_env if row.get("name") in names]
    require(len(added) == 2 and {row.get("name") for row in added} == names, "KMS_BASELINE_PAIR")
    values = {row["name"]: row.get("value") for row in added}
    require(isinstance(values["EMAILS_PROVIDER_KMS_KEY_ID"], str) and values["EMAILS_PROVIDER_KMS_KEY_ID"].strip(), "KMS_BASELINE_KEY")
    require(values["EMAILS_PROVIDER_KMS_REGION"] == promotion.REGION, "KMS_BASELINE_REGION")
    new_web[0]["environment"] = [row for row in new_env if row.get("name") not in names]
    require(current == historical, "KMS_BASELINE_TASK_DRIFT")


def reconcile_state(anchor_value, failed):
    historical_task = anchor_value["service"]["taskDefinition"]
    anchor_image = anchor_value["descendant"]["imageDigest"]
    desired = anchor_value["service"]["desiredCount"]
    require(TASK_PATTERN.fullmatch(historical_task or "") and DIGEST_PATTERN.fullmatch(anchor_image or ""), "ANCHOR_IDENTITY")
    historical_payload = task_payload(promotion.task_read(historical_task))
    require(task_image(historical_payload) == anchor_image, "HISTORICAL_IMAGE_DRIFT")
    require(promotion.digest(promotion.encode(historical_payload)) == anchor_value["descendant"]["digest"], "HISTORICAL_TASK_DRIFT")
    candidates = []
    known = {historical_task}
    for item in failed:
        require(item["taskBefore"] == historical_task, "FAILED_ANCHOR_DRIFT")
        definition = promotion.task_read(item["taskDefinition"])
        payload = task_payload(definition)
        require(task_image(payload) == item["imageDigest"], "FAILED_IMAGE_DRIFT")
        normalized = copy.deepcopy(payload)
        next(row for row in normalized["containerDefinitions"] if row.get("name") == "emails")["image"] = promotion.REPOSITORY + "@" + anchor_image
        require(normalized == historical_payload, "FAILED_TASK_CONFIGURATION_DRIFT")
        candidates.append({**item, "taskPayloadDigest": digest(payload)})
        known.add(item["taskDefinition"])
    service = promotion.current_service()
    controlled = controlled_service(service)
    require(service.get("serviceName") == promotion.SERVICE and service.get("status") == "ACTIVE", "SERVICE_IDENTITY")
    require(service.get("desiredCount") == desired and service.get("runningCount") == desired and service.get("pendingCount") == 0, "SERVICE_COUNTS")
    anchor_task = service.get("taskDefinition")
    require(TASK_PATTERN.fullmatch(anchor_task or "") and anchor_task not in known, "KMS_BASELINE_IDENTITY")
    anchor_payload = task_payload(promotion.task_read(anchor_task))
    require(task_image(anchor_payload) == anchor_image, "KMS_BASELINE_IMAGE_DRIFT")
    require_kms_baseline(historical_payload, anchor_payload)
    known.add(anchor_task)
    deployments = service.get("deployments", [])
    require(1 <= len(deployments) <= 4 and all(row.get("taskDefinition") in known for row in deployments), "SERVICE_DEPLOYMENTS")
    running, running_digest = running_snapshot(anchor_task, anchor_image, desired)
    require(digest(controlled_service(promotion.current_service())) == digest(controlled), "SERVICE_RACE")
    running_again, running_digest_again = running_snapshot(anchor_task, anchor_image, desired)
    require(running_again == running and running_digest_again == running_digest, "RUNNING_TASK_RACE")
    return {
        "historicalAnchor": {
            "taskDefinition": historical_task,
            "taskPayloadDigest": digest(historical_payload),
            "imageDigest": anchor_image,
        },
        "anchor": {
            "taskDefinition": anchor_task,
            "taskPayloadDigest": digest(anchor_payload),
            "imageDigest": anchor_image,
            "desiredCount": desired,
        },
        "kmsBaselineConfigured": True,
        "failedCandidates": candidates,
        "service": controlled,
        "serviceDigest": digest(controlled),
        "runningTasks": running,
        "runningTasksDigest": running_digest,
    }


def expected_drift(before_image, candidate_image):
    before = admission_module.inspect(before_image, promotion)
    candidate = admission_module.inspect(candidate_image, promotion)
    changed = before["definitionInputs"] != candidate["definitionInputs"]
    evidence = {
        "schema": "emails.image-migration-admission.v1",
        "deployed": before,
        "candidate": candidate,
        "comparison": "exact-definition-input-bytes",
        "migrationDefinitionChanged": changed,
        "imageCodeExecuted": False,
    }
    require(evidence["migrationDefinitionChanged"] is True, "MIGRATION_DEFINITION_DRIFT_EXPECTED")
    return evidence


def kms_proof_id(source, task_definition, image_digest):
    return hashlib.sha256(encode({"source": source, "task": task_definition, "image": image_digest})).hexdigest()


def require_kms_proof(value, proof_id):
    require(value == {"schema": "emails.migration-kms-proof.v1", "configured": True, "roundTrip": True, "keyMaterialEmitted": False, "proofId": proof_id}, "KMS_PROOF")


def reconcile(source, inputs, out):
    anchor = read(inputs / "anchor" / "reconciled.json", "emails.promotion-reconciliation.v1")
    failed = sorted((load_failed(path) for path in inputs.glob("failed-*")), key=lambda row: row["runId"])
    require(len(failed) == 2, "FAILED_RECEIPT_COUNT")
    require(promotion.aws("sts", "get-caller-identity")["Account"] == promotion.ACCOUNT, "AWS_ACCOUNT")
    state = reconcile_state(anchor, failed)
    latest = failed[-1]
    admission = expected_drift(state["anchor"]["imageDigest"], latest["imageDigest"])
    require(admission["candidate"].get("sourceRevision") == latest["sourceCommit"], "FAILED_IMAGE_SOURCE_BINDING")
    receipt = {
        "schema": "emails.current-migration-reconciliation.v1",
        "sourceCommit": source,
        "anchorSourceCommit": anchor["sourceCommit"],
        "anchorReconciledSha256": file_digest(inputs / "anchor" / "reconciled.json"),
        **state,
        "migrationAdmission": admission,
        "migrationAdmissionSha256": digest(admission),
        "migrationDefinitionChanged": True,
        "state": "failed_candidates_reconciled_to_historical_anchor_and_live_kms_baseline",
        "awsMutationCalls": 0,
        "automaticRetry": False,
        "automaticRollback": False,
    }
    out.mkdir(mode=0o700)
    promotion.save(out / "reconciled.json", receipt)
    return receipt


def task_script():
    raw = TASK_SCRIPT_PATH.read_text()
    require(1000 < len(raw.encode()) < 16384, "TASK_SCRIPT_SIZE")
    return raw


def task_request(service, task_definition, operation, environment):
    request = {
        "cluster": promotion.CLUSTER,
        "taskDefinition": task_definition,
        "count": 1,
        "startedBy": f"emails-{operation}-{os.environ.get('GITHUB_RUN_ID', 'local')}"[:36],
        "networkConfiguration": service.get("networkConfiguration"),
        "overrides": {
            "containerOverrides": [{
                "name": "emails",
                "command": ["-e", task_script()],
                "environment": [{"name": "EMAILS_MIGRATION_OPERATION", "value": operation}, *[
                    {"name": key, "value": value} for key, value in sorted(environment.items())
                ]],
            }],
        },
        "enableExecuteCommand": False,
    }
    require(isinstance(request["networkConfiguration"], dict) and "awsvpcConfiguration" in request["networkConfiguration"], "TASK_NETWORK")
    strategy = service.get("capacityProviderStrategy", [])
    if strategy:
        request["capacityProviderStrategy"] = strategy
    else:
        request["launchType"] = service.get("launchType") or "FARGATE"
    platform = service.get("platformVersion")
    if isinstance(platform, str) and platform:
        request["platformVersion"] = platform
    require(len(encode(request["overrides"])) <= 8192, "TASK_OVERRIDE_LIMIT")
    return request


def wait_roll_forward(task_definition, desired_count, timeout=1800, interval=15):
    deadline = time.monotonic() + timeout
    while True:
        service = promotion.current_service()
        require(service.get("taskDefinition") == task_definition and service.get("desiredCount") == desired_count, "ROLL_FORWARD_SERVICE_DRIFT")
        primary = [row for row in service.get("deployments", []) if row.get("status") == "PRIMARY"]
        require(len(primary) == 1 and primary[0].get("taskDefinition") == task_definition, "ROLL_FORWARD_PRIMARY_DRIFT")
        require(primary[0].get("rolloutState") != "FAILED", "ROLL_FORWARD_DEPLOYMENT_FAILED")
        try:
            require_no_automatic_rollback(service)
            if promotion.service_binding(service) == task_definition:
                return service
        except ValueError as error:
            if str(error) not in {"SERVICE_NOT_STABLE", "DEPLOYMENT_NOT_STABLE"}:
                raise
        require(time.monotonic() < deadline, "ROLL_FORWARD_TIMEOUT")
        time.sleep(interval)


def wait_task(task_arn, task_definition, timeout=1200):
    deadline = time.monotonic() + timeout
    while True:
        result = promotion.aws("ecs", "describe-tasks", "--cluster", promotion.CLUSTER, "--tasks", task_arn)
        require(not result.get("failures") and len(result.get("tasks", [])) == 1, "MIGRATION_TASK_READ")
        task = result["tasks"][0]
        require(task.get("taskDefinitionArn") == task_definition, "MIGRATION_TASK_DEFINITION")
        if task.get("lastStatus") == "STOPPED":
            web = [row for row in task.get("containers", []) if row.get("name") == "emails"]
            require(len(web) == 1 and type(web[0].get("exitCode")) is int, "MIGRATION_CONTAINER_RESULT")
            return task, web[0]
        require(time.monotonic() < deadline, "MIGRATION_TASK_TIMEOUT")
        time.sleep(10)


def task_log_receipt(task_arn, task_definition, expected_schema, timeout=180):
    definition = promotion.task_read(task_definition)
    web = [row for row in definition.get("containerDefinitions", []) if row.get("name") == "emails"]
    require(len(web) == 1, "MIGRATION_LOG_CONTAINER")
    config = web[0].get("logConfiguration", {})
    options = config.get("options", {}) if config.get("logDriver") == "awslogs" else {}
    group = options.get("awslogs-group")
    prefix = options.get("awslogs-stream-prefix")
    require(isinstance(group, str) and group and isinstance(prefix, str) and prefix, "MIGRATION_LOG_CONFIGURATION")
    stream = f"{prefix}/emails/{task_arn.rsplit('/', 1)[-1]}"
    deadline = time.monotonic() + timeout
    while True:
        rows = promotion.aws("logs", "describe-log-streams", "--log-group-name", group, "--log-stream-name-prefix", stream, "--limit", "10").get("logStreams", [])
        if any(row.get("logStreamName") == stream for row in rows):
            events = promotion.aws("logs", "get-log-events", "--log-group-name", group, "--log-stream-name", stream, "--limit", "100").get("events", [])
            matches = [row.get("message", "")[len(RECEIPT_MARKER):] for row in events if isinstance(row.get("message"), str) and row["message"].startswith(RECEIPT_MARKER)]
            if matches:
                require(len(matches) == 1 and len(matches[0]) < 1024 * 1024, "MIGRATION_LOG_RECEIPT_COUNT")
                value = json.loads(matches[0])
                require(value.get("schema") == expected_schema, "MIGRATION_LOG_RECEIPT_SCHEMA")
                return value, {"taskArnSha256": hashlib.sha256(task_arn.encode()).hexdigest(), "logGroupSha256": hashlib.sha256(group.encode()).hexdigest(), "logStreamSha256": hashlib.sha256(stream.encode()).hexdigest()}
        require(time.monotonic() < deadline, "MIGRATION_LOG_TIMEOUT")
        time.sleep(5)


def run_receipt_task(service, task_definition, operation, environment, expected_schema):
    request = task_request(service, task_definition, operation, environment)
    result = promotion.aws("ecs", "run-task", body=request, timeout=120)
    require(not result.get("failures") and len(result.get("tasks", [])) == 1, "MIGRATION_TASK_START")
    task_arn = result["tasks"][0].get("taskArn")
    require(isinstance(task_arn, str) and task_arn, "MIGRATION_TASK_ARN")
    _, container = wait_task(task_arn, task_definition)
    require(container.get("exitCode") == 0, "MIGRATION_TASK_EXIT")
    receipt, evidence = task_log_receipt(task_arn, task_definition, expected_schema)
    return receipt, evidence


def load_migration_reconciliation(inputs):
    return read(inputs / "migration-reconciliation" / "reconciled.json", "emails.current-migration-reconciliation.v1")


def service_matches_reconciliation(reconciled):
    service = promotion.current_service()
    require(digest(controlled_service(service)) == reconciled["serviceDigest"], "SERVICE_RECONCILIATION_DRIFT")
    running, running_digest = running_snapshot(reconciled["anchor"]["taskDefinition"], reconciled["anchor"]["imageDigest"], reconciled["anchor"]["desiredCount"])
    require(running_digest == reconciled["runningTasksDigest"] and running == reconciled["runningTasks"], "RUNNING_RECONCILIATION_DRIFT")
    return service


def prepare(source, inputs, image_digest, out):
    reconciled = load_migration_reconciliation(inputs)
    require(reconciled.get("sourceCommit") == source, "MIGRATION_RECONCILIATION_SOURCE")
    require(promotion.aws("sts", "get-caller-identity")["Account"] == promotion.ACCOUNT, "AWS_ACCOUNT")
    service = service_matches_reconciliation(reconciled)
    anchor_task = reconciled["anchor"]["taskDefinition"]
    anchor = promotion.task_read(anchor_task)
    candidate_payload, before_image = image_only_candidate(anchor, image_digest)
    require(before_image == reconciled["anchor"]["imageDigest"], "ANCHOR_IMAGE_DRIFT")
    migration_admission = expected_drift(before_image, image_digest)
    require(migration_admission["candidate"].get("sourceRevision") == source, "CANDIDATE_IMAGE_SOURCE_BINDING")
    out.mkdir(mode=0o700)
    promotion.save(out / "register-intent.json", {
        "schema": "emails.current-migration-register-intent.v1",
        "sourceCommit": source,
        "migrationReconciledSha256": file_digest(inputs / "migration-reconciliation" / "reconciled.json"),
        "anchorTaskDefinition": anchor_task,
        "candidateTaskPayloadDigest": digest(candidate_payload),
        "candidateImageDigest": image_digest,
        "serviceUpdated": False,
        "databaseMutated": False,
        "automaticRollback": False,
    })
    request = copy.deepcopy(candidate_payload)
    if request.get("tags") == []:
        del request["tags"]
    result = promotion.aws("ecs", "register-task-definition", body=request)
    candidate_task = result.get("taskDefinition", {}).get("taskDefinitionArn")
    require(TASK_PATTERN.fullmatch(candidate_task or ""), "CANDIDATE_TASK_REGISTER")
    registered = promotion.task_read(candidate_task)
    require(task_payload(registered) == candidate_payload, "CANDIDATE_TASK_REGISTER_DRIFT")
    promotion.save(out / "registered.json", {
        "schema": "emails.current-migration-registered.v1",
        "candidateTaskDefinition": candidate_task,
        "candidateTaskPayloadDigest": digest(candidate_payload),
        "candidateImageDigest": image_digest,
        "serviceUpdated": False,
        "databaseMutated": False,
    })
    require(digest(controlled_service(promotion.current_service())) == reconciled["serviceDigest"], "SERVICE_CHANGED_AFTER_REGISTRATION")
    promotion.save(out / "plan-run-intent.json", {
        "schema": "emails.current-migration-plan-run-intent.v1",
        "candidateTaskDefinition": candidate_task,
        "taskScriptSha256": hashlib.sha256(task_script().encode()).hexdigest(),
        "databaseMutated": False,
        "automaticRetry": False,
    })
    try:
        plan, task_evidence = run_receipt_task(service, candidate_task, "plan", {}, "emails.migration-production-plan.v1")
    except Exception:
        promotion.save(out / "plan-reconciliation-required.json", {
            "schema": "emails.current-migration-plan-reconciliation-required.v1",
            "candidateTaskDefinition": candidate_task,
            "candidateImageDigest": image_digest,
            "serviceUpdated": False,
            "databaseMutated": False,
            "automaticRetry": False,
            "automaticRollback": False,
        })
        raise
    require(plan.get("databaseMutated") is False and SHA64.fullmatch(plan.get("ledgerSha256", "")) and SHA64.fullmatch(plan.get("planSha256", "")) and SHA64.fullmatch(plan.get("expectedAfterLedgerSha256", "")), "MIGRATION_PLAN_RECEIPT")
    require(any(row.get("state") == "pending" for row in plan.get("plan", [])), "MIGRATION_PLAN_EMPTY")
    proof_id = kms_proof_id(source, candidate_task, image_digest)
    try:
        kms, kms_task = run_receipt_task(service, candidate_task, "kms", {"EMAILS_MIGRATION_PROOF_ID": proof_id}, "emails.migration-kms-proof.v1")
        require_kms_proof(kms, proof_id)
    except Exception:
        promotion.save(out / "kms-reconciliation-required.json", {
            "schema": "emails.current-migration-kms-reconciliation-required.v1",
            "candidateTaskDefinition": candidate_task,
            "candidateImageDigest": image_digest,
            "serviceUpdated": False,
            "databaseMutated": False,
            "automaticRetry": False,
            "automaticRollback": False,
        })
        raise
    receipt = {
        "schema": "emails.current-migration-prepared.v1",
        "sourceCommit": source,
        "migrationReconciledSha256": file_digest(inputs / "migration-reconciliation" / "reconciled.json"),
        "serviceDigest": reconciled["serviceDigest"],
        "anchor": reconciled["anchor"],
        "candidate": {
            "taskDefinition": candidate_task,
            "taskPayloadDigest": digest(candidate_payload),
            "imageDigest": image_digest,
        },
        "migrationAdmission": migration_admission,
        "migrationAdmissionSha256": digest(migration_admission),
        "taskScriptSha256": hashlib.sha256(task_script().encode()).hexdigest(),
        "ledgerBefore": plan["ledger"],
        "ledgerBeforeSha256": plan["ledgerSha256"],
        "plan": plan["plan"],
        "planSha256": plan["planSha256"],
        "expectedAfterLedger": plan["expectedAfterLedger"],
        "expectedAfterLedgerSha256": plan["expectedAfterLedgerSha256"],
        "planTask": task_evidence,
        "kmsProof": kms,
        "kmsProofTask": kms_task,
        "serviceUpdated": False,
        "databaseMutated": False,
        "automaticRollback": False,
    }
    promotion.save(out / "prepared.json", receipt)
    return receipt


def load_prepared(inputs):
    return read(inputs / "plan" / "prepared.json", "emails.current-migration-prepared.v1")


def verify_candidate(prepared):
    candidate = promotion.task_read(prepared["candidate"]["taskDefinition"])
    payload = task_payload(candidate)
    require(digest(payload) == prepared["candidate"]["taskPayloadDigest"] and task_image(payload) == prepared["candidate"]["imageDigest"], "CANDIDATE_TASK_DRIFT")
    return candidate


def execute(source, inputs, out):
    require(MIGRATION_EXECUTION_ENABLED, "MIGRATION_EXECUTION_DISABLED")
    reconciled = load_migration_reconciliation(inputs)
    prepared = load_prepared(inputs)
    require(reconciled.get("sourceCommit") == source == prepared.get("sourceCommit"), "EXECUTION_SOURCE")
    require(file_digest(inputs / "migration-reconciliation" / "reconciled.json") == prepared["migrationReconciledSha256"], "EXECUTION_RECONCILIATION")
    require(promotion.aws("sts", "get-caller-identity")["Account"] == promotion.ACCOUNT, "AWS_ACCOUNT")
    service = service_matches_reconciliation(reconciled)
    require(hashlib.sha256(task_script().encode()).hexdigest() == prepared["taskScriptSha256"], "TASK_SCRIPT_DRIFT")
    verify_candidate(prepared)
    out.mkdir(mode=0o700)
    promotion.save(out / "preflight-intent.json", {
        "schema": "emails.current-migration-preflight-intent.v1",
        "sourceCommit": source,
        "candidateTaskDefinition": prepared["candidate"]["taskDefinition"],
        "ledgerBeforeSha256": prepared["ledgerBeforeSha256"],
        "planSha256": prepared["planSha256"],
        "expectedAfterLedgerSha256": prepared["expectedAfterLedgerSha256"],
        "databaseMutated": False,
        "automaticRetry": False,
    })
    try:
        preflight, preflight_task = run_receipt_task(service, prepared["candidate"]["taskDefinition"], "plan", {}, "emails.migration-production-plan.v1")
        require(
            preflight.get("ledgerSha256") == prepared["ledgerBeforeSha256"]
            and preflight.get("planSha256") == prepared["planSha256"]
            and preflight.get("expectedAfterLedgerSha256") == prepared["expectedAfterLedgerSha256"]
            and preflight.get("ledger") == prepared["ledgerBefore"]
            and preflight.get("plan") == prepared["plan"]
            and preflight.get("expectedAfterLedger") == prepared["expectedAfterLedger"],
            "PRODUCTION_PLAN_DRIFT",
        )
        proof_id = kms_proof_id(source, prepared["candidate"]["taskDefinition"], prepared["candidate"]["imageDigest"])
        require_kms_proof(prepared["kmsProof"], proof_id)
        kms, kms_task = run_receipt_task(service, prepared["candidate"]["taskDefinition"], "kms", {"EMAILS_MIGRATION_PROOF_ID": proof_id}, "emails.migration-kms-proof.v1")
        require_kms_proof(kms, proof_id)
    except Exception:
        promotion.save(out / "preflight-reconciliation-required.json", {
            "schema": "emails.current-migration-preflight-reconciliation-required.v1",
            "sourceCommit": source,
            "candidateTaskDefinition": prepared["candidate"]["taskDefinition"],
            "databaseMutated": False,
            "automaticRetry": False,
            "automaticRollback": False,
        })
        raise
    require_main_source(source)
    service = service_matches_reconciliation(reconciled)
    promotion.save(out / "execution-intent.json", {
        "schema": "emails.current-migration-execution-intent.v1",
        "sourceCommit": source,
        "preparedSha256": file_digest(inputs / "plan" / "prepared.json"),
        "migrationReconciledSha256": prepared["migrationReconciledSha256"],
        "candidateTaskDefinition": prepared["candidate"]["taskDefinition"],
        "candidateImageDigest": prepared["candidate"]["imageDigest"],
        "ledgerBeforeSha256": prepared["ledgerBeforeSha256"],
        "planSha256": prepared["planSha256"],
        "expectedAfterLedgerSha256": prepared["expectedAfterLedgerSha256"],
        "preflightTask": preflight_task,
        "preflightKmsProof": kms,
        "preflightKmsProofTask": kms_task,
        "migrationRunAttempts": 0,
        "serviceUpdateAttempts": 0,
        "automaticRollback": False,
    })
    forward_applied = False
    migration_attempted = False
    try:
        promotion.save(out / "migration-run-intent.json", {
            "schema": "emails.current-migration-run-intent.v1",
            "candidateTaskDefinition": prepared["candidate"]["taskDefinition"],
            "ledgerBeforeSha256": prepared["ledgerBeforeSha256"],
            "planSha256": prepared["planSha256"],
            "expectedAfterLedgerSha256": prepared["expectedAfterLedgerSha256"],
            "migrationRunAttempts": 1,
            "automaticRetry": False,
            "automaticRollback": False,
        })
        migration_attempted = True
        applied, migration_task = run_receipt_task(
            service,
            prepared["candidate"]["taskDefinition"],
            "apply",
            {
                "EMAILS_MIGRATION_EXPECTED_AFTER_LEDGER_SHA256": prepared["expectedAfterLedgerSha256"],
                "EMAILS_MIGRATION_EXPECTED_LEDGER_SHA256": prepared["ledgerBeforeSha256"],
                "EMAILS_MIGRATION_EXPECTED_PLAN_SHA256": prepared["planSha256"],
            },
            "emails.migration-production-applied.v1",
        )
        expected_pending = [row["id"] for row in prepared["plan"] if row["state"] == "pending"]
        require(
            applied.get("beforeLedgerSha256") == prepared["ledgerBeforeSha256"]
            and applied.get("planSha256") == prepared["planSha256"]
            and applied.get("afterLedgerSha256") == prepared["expectedAfterLedgerSha256"]
            and applied.get("beforeLedger") == prepared["ledgerBefore"]
            and applied.get("plan") == prepared["plan"]
            and applied.get("afterLedger") == prepared["expectedAfterLedger"]
            and applied.get("appliedMigrationIds") == expected_pending
            and applied.get("automaticRollback") is False
            and applied.get("databaseMutated") is True,
            "MIGRATION_APPLY_RECEIPT",
        )
        forward_applied = True
        promotion.save(out / "migration-applied.json", {
            "schema": "emails.current-migration-applied.v1",
            "sourceCommit": source,
            "candidateTaskDefinition": prepared["candidate"]["taskDefinition"],
            "candidateImageDigest": prepared["candidate"]["imageDigest"],
            "ledgerBefore": applied["beforeLedger"],
            "ledgerBeforeSha256": applied["beforeLedgerSha256"],
            "plan": applied["plan"],
            "planSha256": applied["planSha256"],
            "appliedMigrationIds": applied["appliedMigrationIds"],
            "ledgerAfter": applied["afterLedger"],
            "ledgerAfterSha256": applied["afterLedgerSha256"],
            "migrationTask": migration_task,
            "migrationRunAttempts": 1,
            "automaticRetry": False,
            "automaticRollback": False,
        })
        live = promotion.current_service()
        require(live.get("serviceName") == promotion.SERVICE and live.get("taskDefinition") in {reconciled["anchor"]["taskDefinition"], *[row["taskDefinition"] for row in reconciled["failedCandidates"]]}, "PRE_UPDATE_SERVICE_DRIFT")
        require(live.get("desiredCount") == reconciled["anchor"]["desiredCount"], "PRE_UPDATE_DESIRED_DRIFT")
        deployment_configuration = roll_forward_deployment_configuration(live)
        update_request = {
            "cluster": promotion.CLUSTER,
            "service": promotion.SERVICE,
            "taskDefinition": prepared["candidate"]["taskDefinition"],
            "deploymentConfiguration": deployment_configuration,
        }
        promotion.save(out / "service-update-intent.json", {
            "schema": "emails.current-migration-service-update-intent.v1",
            "before": live["taskDefinition"],
            "after": prepared["candidate"]["taskDefinition"],
            "ledgerAfterSha256": applied["afterLedgerSha256"],
            "deploymentConfigurationSha256": digest(deployment_configuration),
            "serviceUpdateAttempts": 1,
            "automaticRollback": False,
        })
        promotion.aws("ecs", "update-service", body=update_request)
        stable = wait_roll_forward(prepared["candidate"]["taskDefinition"], reconciled["anchor"]["desiredCount"])
        require_no_automatic_rollback(stable)
        running, running_digest = running_snapshot(prepared["candidate"]["taskDefinition"], prepared["candidate"]["imageDigest"], reconciled["anchor"]["desiredCount"])
        promotion.save(out / "deployed.json", {
            "schema": "emails.current-migration-deployed.v1",
            "sourceCommit": source,
            "candidateTaskDefinition": prepared["candidate"]["taskDefinition"],
            "candidateImageDigest": prepared["candidate"]["imageDigest"],
            "serviceDigest": digest(controlled_service(stable)),
            "runningTasks": running,
            "runningTasksDigest": running_digest,
            "ledgerAfterSha256": applied["afterLedgerSha256"],
            "serviceUpdateAttempts": 1,
            "automaticRollback": False,
            "rollForwardOnly": True,
        })
    except Exception:
        if forward_applied:
            name = "roll-forward-required.json"
            schema = "emails.current-migration-roll-forward-required.v1"
            forward_state = True
            uncertain = False
        elif migration_attempted:
            name = "migration-outcome-uncertain.json"
            schema = "emails.current-migration-outcome-uncertain.v1"
            forward_state = "unknown"
            uncertain = True
        else:
            name = "migration-reconciliation-required.json"
            schema = "emails.current-migration-reconciliation-required.v1"
            forward_state = False
            uncertain = False
        promotion.save(out / name, {
            "schema": schema,
            "sourceCommit": source,
            "candidateTaskDefinition": prepared["candidate"]["taskDefinition"],
            "candidateImageDigest": prepared["candidate"]["imageDigest"],
            "forwardMigrationApplied": forward_state,
            "databaseMutationUncertain": uncertain,
            "automaticRetry": False,
            "automaticRollback": False,
        })
        raise


def finalize(source, inputs, execution, public_proof, out):
    prepared = load_prepared(inputs)
    deployed = read(execution / "deployed.json", "emails.current-migration-deployed.v1")
    applied = read(execution / "migration-applied.json", "emails.current-migration-applied.v1")
    public = read(public_proof, "emails.public-live-proof.v1")
    require(prepared.get("sourceCommit") == deployed.get("sourceCommit") == applied.get("sourceCommit") == source, "FINAL_SOURCE")
    require(public.get("baseUrl") == "https://api.hasna.com/emails" and public.get("doubleV1Paths") == 0 and public.get("providerCredentialOperations") is True and public.get("replyAuthorityContract") is True, "FINAL_PUBLIC_PROOF")
    require(promotion.aws("sts", "get-caller-identity")["Account"] == promotion.ACCOUNT, "AWS_ACCOUNT")
    candidate = verify_candidate(prepared)
    service = promotion.current_service()
    require(promotion.service_binding(service) == prepared["candidate"]["taskDefinition"], "FINAL_SERVICE")
    require_no_automatic_rollback(service)
    running, running_digest = running_snapshot(prepared["candidate"]["taskDefinition"], prepared["candidate"]["imageDigest"], prepared["anchor"]["desiredCount"])
    final_plan, plan_task = run_receipt_task(service, prepared["candidate"]["taskDefinition"], "plan", {}, "emails.migration-production-plan.v1")
    require(
        final_plan.get("ledgerSha256") == prepared["expectedAfterLedgerSha256"]
        and final_plan.get("ledger") == prepared["expectedAfterLedger"]
        and all(row.get("state") == "already_applied" for row in final_plan.get("plan", [])),
        "FINAL_LEDGER",
    )
    proof_id = kms_proof_id(source, prepared["candidate"]["taskDefinition"], prepared["candidate"]["imageDigest"])
    kms, kms_task = run_receipt_task(service, prepared["candidate"]["taskDefinition"], "kms", {"EMAILS_MIGRATION_PROOF_ID": proof_id}, "emails.migration-kms-proof.v1")
    require_kms_proof(kms, proof_id)
    receipt = {
        "schema": "emails.current-migration-final-reconciliation.v1",
        "sourceCommit": source,
        "candidateTaskDefinition": prepared["candidate"]["taskDefinition"],
        "candidateTaskPayloadDigest": digest(task_payload(candidate)),
        "candidateImageDigest": prepared["candidate"]["imageDigest"],
        "serviceDigest": digest(controlled_service(service)),
        "runningTasks": running,
        "runningTasksDigest": running_digest,
        "ledgerBeforeSha256": applied["ledgerBeforeSha256"],
        "ledgerAfterSha256": final_plan["ledgerSha256"],
        "finalPlanTask": plan_task,
        "kmsProof": kms,
        "kmsProofTask": kms_task,
        "publicProofSha256": file_digest(public_proof),
        "baseUrl": public["baseUrl"],
        "doubleV1Paths": public["doubleV1Paths"],
        "providerCredentialOperations": public["providerCredentialOperations"],
        "replyAuthorityContract": public["replyAuthorityContract"],
        "serviceUpdateAttempts": 1,
        "migrationRunAttempts": 1,
        "automaticRollback": False,
        "rollForwardOnly": True,
    }
    promotion.save(out / "final-reconciliation.json", receipt)
    return receipt


def mark_failure(source, out):
    final = out / "final-reconciliation.json"
    if final.exists() or (out / "roll-forward-required.json").exists() or (out / "migration-outcome-uncertain.json").exists():
        return
    if (out / "migration-applied.json").exists():
        applied = read(out / "migration-applied.json", "emails.current-migration-applied.v1")
        promotion.save(out / "roll-forward-required.json", {
            "schema": "emails.current-migration-roll-forward-required.v1",
            "sourceCommit": source,
            "candidateTaskDefinition": applied["candidateTaskDefinition"],
            "candidateImageDigest": applied["candidateImageDigest"],
            "forwardMigrationApplied": True,
            "databaseMutationUncertain": False,
            "automaticRetry": False,
            "automaticRollback": False,
        })


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("phase", choices=["reconcile", "prepare", "execute", "finalize", "mark-failure"])
    parser.add_argument("--source", required=True)
    parser.add_argument("--inputs", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--image-digest")
    parser.add_argument("--execution", type=Path)
    parser.add_argument("--public-proof", type=Path)
    args = parser.parse_args()
    require(re.fullmatch(r"[0-9a-f]{40}", args.source), "SOURCE_COMMIT")
    os.umask(0o077)
    if args.phase == "reconcile":
        reconcile(args.source, args.inputs, args.out)
    elif args.phase == "prepare":
        require(DIGEST_PATTERN.fullmatch(args.image_digest or ""), "CANDIDATE_IMAGE")
        prepare(args.source, args.inputs, args.image_digest, args.out)
    elif args.phase == "execute":
        execute(args.source, args.inputs, args.out)
    elif args.phase == "finalize":
        require(args.execution is not None and args.public_proof is not None, "FINAL_INPUTS")
        finalize(args.source, args.inputs, args.execution, args.public_proof, args.out)
    else:
        mark_failure(args.source, args.out)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        message = str(error) if type(error) is ValueError and re.fullmatch(r"[A-Z0-9_:-]+", str(error)) else type(error).__name__
        raise SystemExit("Emails migration deployment stopped: " + message + "; no automatic retry or rollback")
