#!/usr/bin/env python3
"""One reviewed Emails overlay. No image execution, migration, or secret-value APIs.

Prepare may write two content-addressed ECR blobs and one immutable image tag.
Promote requires the SHA256 of a previously reviewed, metadata-only prepared plan.
Unknown writes stop for reconciliation; ECS has a precheck, not an atomic CAS.
"""
import argparse
import copy
import gzip
import hashlib
import io
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
import tarfile
import time
import urllib.parse
import urllib.request

ACCOUNT = "789877399345"
REGION = "us-east-1"
CLUSTER = "oss-fleet-prod"
SERVICE = "emails-prod"
REPO = "mailery"
REPOSITORY = f"{ACCOUNT}.dkr.ecr.{REGION}.amazonaws.com/{REPO}"
BASE = "sha256:a4f4ee450413ed60eed62b76551d647fc848633a6095e23a14a5369d4d34c268"
BASE_CONFIG = "sha256:4500f0fcd28d26d89bf161387a2566d2f851b5c216bc068c8f24e4ab3ddd5ca1"
TASK_ROLE = f"arn:aws:iam::{ACCOUNT}:role/emails-prod-task"
EXEC_ROLE = f"arn:aws:iam::{ACCOUNT}:role/emails-prod-exec"
PATHS = tuple("app/src/server/self-hosted/" + name + ".ts" for name in ("search-admission", "store", "serve"))
OCI_MANIFEST = "application/vnd.oci.image.manifest.v1+json"
OCI_CONFIG = "application/vnd.oci.image.config.v1+json"
OCI_LAYER = "application/vnd.oci.image.layer.v1.tar+gzip"
READ_ONLY_TASK_FIELDS = {"taskDefinitionArn", "revision", "status", "requiresAttributes", "compatibilities", "registeredAt", "registeredBy", "deregisteredAt"}
TASK_FIELDS = {"family", "taskRoleArn", "executionRoleArn", "networkMode", "containerDefinitions", "volumes", "placementConstraints", "requiresCompatibilities", "cpu", "memory", "tags", "pidMode", "ipcMode", "proxyConfiguration", "inferenceAccelerators", "ephemeralStorage", "runtimePlatform", "enableFaultInjection"}
ROOT = Path(__file__).resolve().parent
TAG_PREFIX = "search-capacity-"
OVERLAY_DESCRIPTION = "hasna/apps reviewed Emails search overlay "


def require(ok, reason):
    if not ok:
        raise ValueError(reason)


def encode(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()


def digest(data):
    return "sha256:" + hashlib.sha256(data).hexdigest()


def sha(value):
    require(isinstance(value, str) and re.fullmatch(r"sha256:[0-9a-f]{64}", value), "BAD_DIGEST")
    return value


def save(path, value):
    data = encode(value) + b"\n"
    with path.open("xb") as f:
        os.chmod(path, 0o600)
        f.write(data)
        f.flush()
        os.fsync(f.fileno())
    fd = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)
    return hashlib.sha256(data).hexdigest()


def aws(*args, body=None, timeout=120):
    # No SDK dependency or automatic mutation retries. Never print AWS bodies or
    # raw diagnostic text: task environments can contain credential values.
    env = {**os.environ, "AWS_MAX_ATTEMPTS": "1", "AWS_PAGER": ""}
    command = ["aws", "--region", REGION, "--output", "json", "--no-cli-pager", *args]
    if body is not None:
        # /dev/stdin keeps complete task definitions out of argv and files.
        command += ["--cli-input-json", "file:///dev/stdin"]
    result = subprocess.run(command, input=None if body is None else encode(body), capture_output=True, timeout=timeout, env=env)
    require(result.returncode == 0, "AWS_OPERATION_REFUSED_OR_UNCERTAIN:" + "/".join(args[:2]))
    require(len(result.stdout) <= 8 * 1024 * 1024, "AWS_RESPONSE_LIMIT")
    return json.loads(result.stdout or b"{}")


def image_manifest(image_digest):
    result = aws("ecr", "batch-get-image", "--repository-name", REPO, "--image-ids", "imageDigest=" + sha(image_digest))
    require(not result.get("failures") and len(result.get("images", [])) == 1, "IMAGE_UNAVAILABLE")
    row = result["images"][0]
    raw = row["imageManifest"].encode()
    require(digest(raw) == image_digest and row["imageId"]["imageDigest"] == image_digest, "MANIFEST_DIGEST_DRIFT")
    value = json.loads(raw)
    require(value.get("schemaVersion") == 2 and value.get("mediaType") == OCI_MANIFEST, "UNSUPPORTED_MANIFEST")
    require(set(value) == {"schemaVersion", "mediaType", "config", "layers"}, "UNREVIEWED_MANIFEST_FIELDS")
    return value


def blob(descriptor):
    expected = sha(descriptor["digest"])
    size = descriptor["size"]
    require(type(size) is int and 0 <= size <= 128 * 1024 * 1024, "BLOB_SIZE_LIMIT")
    result = aws("ecr", "get-download-url-for-layer", "--repository-name", REPO, "--layer-digest", expected)
    url = result["downloadUrl"]
    parsed = urllib.parse.urlsplit(url)
    require(parsed.scheme == "https" and parsed.hostname.endswith(".amazonaws.com") and not parsed.username and not parsed.password, "UNEXPECTED_BLOB_ORIGIN")
    with urllib.request.urlopen(url, timeout=60) as response:
        data = response.read(size + 1)
    require(len(data) == size and digest(data) == expected, "BLOB_DIGEST_DRIFT")
    return data


def recipe():
    value = json.loads((ROOT / "recipe.json").read_bytes())
    require(value.get("schema") == "emails.source-overlay-recipe.v1" and value["baseImageDigest"] == BASE, "RECIPE_BASE")
    require(len(value["files"]) == 3 and {r["path"] for r in value["files"]} == set(PATHS), "RECIPE_SCOPE")
    require(all((r["uid"], r["gid"], r["mode"]) == (0, 0, 0o644) for r in value["files"]), "RECIPE_OWNERSHIP")
    require(value["patchFile"] == "search-capacity.patch", "RECIPE_PATCH")
    require(hashlib.sha256((ROOT / value["patchFile"]).read_bytes()).hexdigest() == value["patchSha256"], "PATCH_DRIFT")
    return value


def active_preimages(manifest, config, fetch=blob):
    require(1 <= len(manifest["layers"]) <= 32 and len(manifest["layers"]) == len(config["rootfs"]["diff_ids"]), "LAYER_COUNT")
    ancestors = {str(p) for n in PATHS for p in Path(n).parents if str(p) != "."}
    relevant = set(PATHS) | ancestors
    state = {}
    total = 0
    for index, desc in enumerate(manifest["layers"]):
        require(desc["mediaType"] == OCI_LAYER, "LAYER_TYPE")
        compressed = fetch(desc)
        with gzip.GzipFile(fileobj=io.BytesIO(compressed)) as stream:
            data = stream.read(512 * 1024 * 1024 + 1)
        total += len(data)
        require(len(data) <= 512 * 1024 * 1024 and total <= 1024 * 1024 * 1024, "EXPANDED_LAYER_LIMIT")
        require(digest(data) == config["rootfs"]["diff_ids"][index], "LAYER_DIFF_ID_DRIFT")
        additions = {}
        removed = []
        with tarfile.open(fileobj=io.BytesIO(data), mode="r:") as tar:
            for count, member in enumerate(tar, 1):
                require(count <= 100000, "LAYER_ENTRY_LIMIT")
                name = member.name.removeprefix("./").rstrip("/")
                require(not name.startswith("/") and ".." not in name.split("/"), "UNSAFE_LAYER_PATH")
                basename = name.rsplit("/", 1)[-1]
                parent = name.rsplit("/", 1)[0] if "/" in name else ""
                if basename == ".wh..wh..opq":
                    removed += [n for n in relevant if n.startswith(parent + "/")]
                elif basename.startswith(".wh."):
                    target = ((parent + "/") if parent else "") + basename[4:]
                    removed += [n for n in relevant if n == target or n.startswith(target + "/")]
                elif name in relevant:
                    require(name not in additions, "DUPLICATE_RELEVANT_LAYER_ENTRY")
                    if name in ancestors:
                        require(member.isdir(), "UNSAFE_SOURCE_ANCESTOR")
                        additions[name] = None
                    else:
                        require(member.isfile() and member.size <= 4 * 1024 * 1024, "UNSAFE_SOURCE_FILE")
                        additions[name] = (tar.extractfile(member).read(), member.uid, member.gid, member.mode)
        for name in removed:
            state.pop(name, None)
        state.update(additions)
    require(ancestors <= state.keys() and set(PATHS) <= state.keys(), "MISSING_IMAGE_SOURCE")
    return {p: state[p] for p in PATHS}


def make_layer(files):
    require(set(files) == set(PATHS), "OVERLAY_PATH_SCOPE")
    out = io.BytesIO()
    with tarfile.open(fileobj=out, mode="w", format=tarfile.USTAR_FORMAT) as tar:
        for path in sorted(files):
            data = files[path]
            require(isinstance(data, bytes) and len(data) <= 4 * 1024 * 1024, "OVERLAY_FILE_LIMIT")
            member = tarfile.TarInfo(path)
            member.size, member.uid, member.gid, member.mode, member.mtime = len(data), 0, 0, 0o644, 0
            tar.addfile(member, io.BytesIO(data))
    data = out.getvalue()
    compressed = io.BytesIO()
    with gzip.GzipFile(filename="", mode="wb", fileobj=compressed, mtime=0, compresslevel=9) as stream:
        stream.write(data)
    return compressed.getvalue(), digest(data)


def append_overlay(manifest, config, layer, diff_id, source):
    require(re.fullmatch(r"[0-9a-f]{40}", source), "SOURCE_COMMIT")
    updated = copy.deepcopy(config)
    updated["rootfs"]["diff_ids"].append(sha(diff_id))
    updated.setdefault("history", []).append({"created_by": OVERLAY_DESCRIPTION + source})
    config_bytes = encode(updated)
    result = copy.deepcopy(manifest)
    result["config"] = {"mediaType": OCI_CONFIG, "digest": digest(config_bytes), "size": len(config_bytes)}
    result["layers"].append({"mediaType": OCI_LAYER, "digest": digest(layer), "size": len(layer)})
    return result, config_bytes


def build(source):
    spec = importlib.util.spec_from_file_location("reviewed_emails_patch", ROOT / "strict_patch.py")
    patch_module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(patch_module)
    apply_reviewed_patch = patch_module.apply_reviewed_patch
    rules = recipe()
    manifest = image_manifest(BASE)
    require(manifest["config"]["digest"] == BASE_CONFIG and manifest["config"]["mediaType"] == OCI_CONFIG, "BASE_CONFIG_DRIFT")
    config = json.loads(blob(manifest["config"]))
    require(config["architecture"] == "amd64" and config["os"] == "linux" and config["rootfs"]["type"] == "layers", "BASE_PLATFORM")
    pre = active_preimages(manifest, config)
    for row in rules["files"]:
        data, uid, gid, mode = pre[row["path"]]
        require((len(data), hashlib.sha256(data).hexdigest(), uid, gid, mode) == (row["beforeBytes"], row["beforeSha256"], row["uid"], row["gid"], row["mode"]), "PREIMAGE_DRIFT")
    files = apply_reviewed_patch(rules, (ROOT / "search-capacity.patch").read_bytes(), {p: pre[p][0] for p in PATHS})
    for row in rules["files"]:
        require(len(files[row["path"]]) == row["afterBytes"] and hashlib.sha256(files[row["path"]]).hexdigest() == row["afterSha256"], "POSTIMAGE_DRIFT")
    layer, diff_id = make_layer(files)
    result, config_bytes = append_overlay(manifest, config, layer, diff_id, source)
    receipt = {"baseImageDigest": BASE, "baseConfigDigest": BASE_CONFIG, "imageDigest": digest(encode(result)), "configDigest": digest(config_bytes), "layerDigest": digest(layer), "layerDiffId": diff_id, "baseLayers": manifest["layers"], "files": rules["files"], "runtimeConfigurationPreserved": True, "baseLayersPreserved": True, "imageExecuted": False, "dependencyInstallation": False}
    return result, config_bytes, layer, receipt


def task_candidate(task, image_digest):
    sha(image_digest)
    require(not (set(task) - TASK_FIELDS - READ_ONLY_TASK_FIELDS), "UNKNOWN_TASK_FIELDS")
    require(task.get("family") == SERVICE and task.get("taskRoleArn") == TASK_ROLE and task.get("executionRoleArn") == EXEC_ROLE, "TASK_IDENTITY")
    containers = task.get("containerDefinitions", [])
    require(len([c for c in containers if c.get("name") == "emails"]) == 1, "WEB_CONTAINER_IDENTITY")
    result = {k: copy.deepcopy(v) for k, v in task.items() if k not in READ_ONLY_TASK_FIELDS}
    web = next(c for c in result["containerDefinitions"] if c["name"] == "emails")
    require(web.get("image") == REPOSITORY + "@" + BASE, "BASE_TASK_IMAGE_DRIFT")
    require(not web.get("entryPoint") and web.get("command") == ["src/server/index.ts"], "TASK_STARTUP_DRIFT")
    rows = web.get("environment", [])
    require(isinstance(rows, list) and all(set(r) == {"name", "value"} and isinstance(r["value"], str) for r in rows), "ENVIRONMENT_SHAPE")
    require(len({r["name"] for r in rows}) == len(rows), "DUPLICATE_ENVIRONMENT")
    env = {r["name"]: r["value"] for r in rows}
    require(env.get("EMAILS_MODE") == "self_hosted", "EMAILS_MODE")
    owned = "EMAILS_SEARCH_CONCURRENCY"
    require(not any(r.get("name") in {owned, "EMAILS_PG_POOL_MAX", "EMAILS_MODE"} for r in web.get("secrets", [])), "RUNTIME_SECRET_CONFLICT")
    pool = env.get("EMAILS_PG_POOL_MAX", "10")
    require(re.fullmatch(r"[1-9][0-9]*", pool) and 9 <= int(pool) <= 1000, "POOL_CAPACITY")
    web["environment"] = [r for r in rows if r["name"] != owned] + [{"name": owned, "value": "8"}]
    web["image"] = REPOSITORY + "@" + image_digest
    return result


def service_binding(service):
    require(service.get("serviceName") == SERVICE and service.get("status") == "ACTIVE" and type(service.get("desiredCount")) is int and service["desiredCount"] >= 1, "SERVICE_IDENTITY")
    require(service.get("pendingCount") == 0 and service.get("runningCount") == service["desiredCount"], "SERVICE_NOT_STABLE")
    deployments = service.get("deployments", [])
    require(len(deployments) == 1 and deployments[0].get("status") == "PRIMARY" and deployments[0].get("rolloutState") == "COMPLETED" and deployments[0].get("taskDefinition") == service["taskDefinition"], "DEPLOYMENT_NOT_STABLE")
    return service["taskDefinition"]


def current_service():
    result = aws("ecs", "describe-services", "--cluster", CLUSTER, "--services", SERVICE)
    require(not result.get("failures") and len(result.get("services", [])) == 1, "SERVICE_UNAVAILABLE")
    return result["services"][0]


def task_read(arn):
    result = aws("ecs", "describe-task-definition", "--task-definition", arn, "--include", "TAGS")
    return {**result["taskDefinition"], "tags": result.get("tags", [])}


def upload_blob(data, path):
    d = digest(data)
    exists = aws("ecr", "batch-check-layer-availability", "--repository-name", REPO, "--layer-digests", d)
    if any(r.get("layerDigest") == d and r.get("layerAvailability") == "AVAILABLE" for r in exists.get("layers", [])):
        return
    require(len(data) < 5 * 1024 * 1024, "SINGLE_PART_BLOB_LIMIT")
    path.write_bytes(data)
    os.chmod(path, 0o600)
    upload = aws("ecr", "initiate-layer-upload", "--repository-name", REPO)["uploadId"]
    aws("ecr", "upload-layer-part", "--repository-name", REPO, "--upload-id", upload, "--part-first-byte", "0", "--part-last-byte", str(len(data) - 1), "--layer-part-blob", "fileb://" + str(path))
    done = aws("ecr", "complete-layer-upload", "--repository-name", REPO, "--upload-id", upload, "--layer-digests", d)
    require(done.get("layerDigest") == d, "UPLOADED_BLOB_DRIFT")
    path.unlink()


def prepare(source, out):
    service = current_service()
    before_arn = service_binding(service)
    before = task_read(before_arn)
    # Validate task admission before expensive image work or any ECR writes.
    task_candidate(before, BASE)
    manifest, cfg, layer, image_receipt = build(source)
    candidate = task_candidate(before, image_receipt["imageDigest"])
    before_hash = digest(encode(before))
    require(service_binding(current_service()) == before_arn and digest(encode(task_read(before_arn))) == before_hash, "PREPARE_RUNTIME_DRIFT")
    tag = TAG_PREFIX + source
    intent = {"schema": "emails.promotion-prepared.v1", "sourceCommit": source, "recipeSha256": hashlib.sha256((ROOT / "recipe.json").read_bytes()).hexdigest(), "taskDefinitionBefore": before_arn, "taskBeforeDigest": before_hash, "taskAfterDigest": digest(encode(candidate)), "desiredCount": service["desiredCount"], "image": image_receipt, "tag": tag}
    save(out / "prepare-intent.json", intent)
    upload_blob(layer, out / "layer-private.bin")
    upload_blob(cfg, out / "config-private.bin")
    # Content-addressed tag, never a mutable latest tag. Refuse conflicting tags.
    present = aws("ecr", "batch-get-image", "--repository-name", REPO, "--image-ids", "imageTag=" + tag)
    if present.get("images"):
        require(len(present["images"]) == 1 and present["images"][0]["imageId"]["imageDigest"] == image_receipt["imageDigest"], "TAG_OCCUPIED")
    else:
        require(len(present.get("failures", [])) == 1 and present["failures"][0].get("failureCode") == "ImageNotFound", "TAG_READ_UNCERTAIN")
        put = aws("ecr", "put-image", body={"repositoryName": REPO, "imageTag": tag, "imageManifest": encode(manifest).decode(), "imageManifestMediaType": OCI_MANIFEST})
        require(put["image"]["imageId"]["imageDigest"] == image_receipt["imageDigest"], "PUT_IMAGE_DIGEST_DRIFT")
    require(image_manifest(image_receipt["imageDigest"]) == manifest, "PUSH_READBACK_DRIFT")
    plan_hash = save(out / "prepared.json", intent)
    save(out / "summary.json", {"phase": "prepared", "preparedSha256": plan_hash, "imageDigest": image_receipt["imageDigest"], "runtimeChanged": False})


def reviewed_plan(source, prepared, expected_hash):
    raw = prepared.read_bytes()
    require(re.fullmatch(r"[0-9a-f]{64}", expected_hash) and hashlib.sha256(raw).hexdigest() == expected_hash and len(raw) < 65536, "PREPARED_DIGEST")
    plan = json.loads(raw)
    require(plan["schema"] == "emails.promotion-prepared.v1" and plan["sourceCommit"] == source and plan["recipeSha256"] == hashlib.sha256((ROOT / "recipe.json").read_bytes()).hexdigest(), "PREPARED_SOURCE")
    # Reconstruct all immutable image bytes from the same reviewed source. A
    # substituted artifact cannot change the admitted source or image config.
    manifest, cfg, layer, image_receipt = build(source)
    require(plan["image"] == image_receipt and image_manifest(image_receipt["imageDigest"]) == manifest, "PREPARED_IMAGE_DRIFT")
    return plan, image_receipt


def promote(source, out, prepared, expected_hash):
    plan, image_receipt = reviewed_plan(source, prepared, expected_hash)
    service = current_service()
    before_arn = service_binding(service)
    require(before_arn == plan["taskDefinitionBefore"] and service["desiredCount"] == plan["desiredCount"], "SERVICE_PLAN_DRIFT")
    before = task_read(before_arn)
    require(digest(encode(before)) == plan["taskBeforeDigest"], "TASK_PLAN_DRIFT")
    candidate = task_candidate(before, image_receipt["imageDigest"])
    require(digest(encode(candidate)) == plan["taskAfterDigest"], "CANDIDATE_PLAN_DRIFT")
    save(out / "register-intent.json", {"preparedSha256": expected_hash, "taskBefore": before_arn, "taskCandidateDigest": plan["taskAfterDigest"], "imageDigest": image_receipt["imageDigest"]})
    result = aws("ecs", "register-task-definition", body=candidate)
    new_arn = result["taskDefinition"]["taskDefinitionArn"]
    require(new_arn.startswith(f"arn:aws:ecs:{REGION}:{ACCOUNT}:task-definition/{SERVICE}:"), "REGISTERED_FAMILY")
    save(out / "registered.json", {"taskDefinition": new_arn})
    registered = task_read(new_arn)
    registered_payload = {k: v for k, v in registered.items() if k not in READ_ONLY_TASK_FIELDS}
    require(registered_payload == candidate, "REGISTERED_TASK_DRIFT")
    fresh = current_service()
    require(service_binding(fresh) == before_arn and fresh["desiredCount"] == plan["desiredCount"], "PRE_UPDATE_SERVICE_DRIFT")
    save(out / "update-intent.json", {"before": before_arn, "after": new_arn})
    # There is no ECS compare-and-swap API. The external exclusive promotion
    # window remains required; do not overwrite a concurrently changed service.
    aws("ecs", "update-service", "--cluster", CLUSTER, "--service", SERVICE, "--task-definition", new_arn)
    try:
        aws("ecs", "wait", "services-stable", "--cluster", CLUSTER, "--services", SERVICE, timeout=1200)
        live = current_service()
        require(service_binding(live) == new_arn and live["desiredCount"] == plan["desiredCount"], "LIVE_SERVICE_DRIFT")
        tasks = aws("ecs", "list-tasks", "--cluster", CLUSTER, "--service-name", SERVICE, "--desired-status", "RUNNING")["taskArns"]
        require(len(tasks) == plan["desiredCount"] and len(tasks) <= 100, "LIVE_TASK_COUNT")
        rows = aws("ecs", "describe-tasks", "--cluster", CLUSTER, "--tasks", *tasks)
        require(not rows.get("failures") and len(rows.get("tasks", [])) == len(tasks), "LIVE_TASK_READ")
        for task in rows["tasks"]:
            web = [c for c in task.get("containers", []) if c.get("name") == "emails"]
            require(task.get("taskDefinitionArn") == new_arn and task.get("lastStatus") == "RUNNING" and task.get("healthStatus") == "HEALTHY" and len(web) == 1 and web[0].get("imageDigest") == image_receipt["imageDigest"], "LIVE_IMAGE_DRIFT")
        save(out / "promoted.json", {"preparedSha256": expected_hash, "sourceCommit": source, "taskBefore": before_arn, "taskAfter": new_arn, "imageDigest": image_receipt["imageDigest"], "runningTasks": tasks, "searchConcurrency": 8, "runtimeConfigurationPreserved": True})
    except Exception:
        # A failed waiter/read is uncertainty, not permission for an automatic
        # rollback. Preserve the exact previous revision for a separately
        # reviewed guarded rollback; never overwrite another deployment.
        save(out / "reconciliation-required.json", {"taskBefore": before_arn, "taskCandidate": new_arn, "automaticRetry": False, "automaticRollback": False})
        raise


def rollback(source, out, prepared, expected_hash):
    plan, image_receipt = reviewed_plan(source, prepared, expected_hash)
    before_arn = plan["taskDefinitionBefore"]
    before = task_read(before_arn)
    require(digest(encode(before)) == plan["taskBeforeDigest"], "ROLLBACK_PREVIOUS_TASK_DRIFT")
    candidate = task_candidate(before, image_receipt["imageDigest"])
    require(digest(encode(candidate)) == plan["taskAfterDigest"], "ROLLBACK_CANDIDATE_PLAN")
    service = current_service()
    current = service.get("taskDefinition", "")
    require(service.get("serviceName") == SERVICE and service.get("status") == "ACTIVE" and service.get("desiredCount") == plan["desiredCount"] and current != before_arn, "ROLLBACK_SERVICE_ADMISSION")
    require(current.startswith(f"arn:aws:ecs:{REGION}:{ACCOUNT}:task-definition/{SERVICE}:"), "ROLLBACK_TASK_FAMILY")
    actual = task_read(current)
    require({k: v for k, v in actual.items() if k not in READ_ONLY_TASK_FIELDS} == candidate, "ROLLBACK_FOREIGN_DEPLOYMENT")
    fresh = current_service()
    require(fresh.get("taskDefinition") == current and fresh.get("desiredCount") == plan["desiredCount"], "ROLLBACK_PRE_UPDATE_DRIFT")
    save(out / "rollback-intent.json", {"preparedSha256": expected_hash, "from": current, "to": before_arn})
    aws("ecs", "update-service", "--cluster", CLUSTER, "--service", SERVICE, "--task-definition", before_arn)
    aws("ecs", "wait", "services-stable", "--cluster", CLUSTER, "--services", SERVICE, timeout=1200)
    live = current_service()
    require(service_binding(live) == before_arn and live["desiredCount"] == plan["desiredCount"], "ROLLBACK_LIVE_DRIFT")
    save(out / "rolled-back.json", {"preparedSha256": expected_hash, "taskBefore": current, "taskAfter": before_arn, "newRegistrations": 0, "deregisteredTasks": 0})


def main():
    p = argparse.ArgumentParser()
    p.add_argument("phase", choices=["prepare", "promote", "rollback"])
    p.add_argument("--source", required=True)
    p.add_argument("--out", type=Path, required=True)
    p.add_argument("--prepared", type=Path)
    p.add_argument("--prepared-sha256")
    args = p.parse_args()
    require(re.fullmatch(r"[0-9a-f]{40}", args.source), "SOURCE_COMMIT")
    require(aws("sts", "get-caller-identity")["Account"] == ACCOUNT, "AWS_ACCOUNT")
    os.umask(0o077)
    args.out.mkdir(mode=0o700)
    if args.phase == "prepare":
        prepare(args.source, args.out)
    else:
        require(args.prepared is not None and args.prepared_sha256 is not None, "REVIEWED_PREPARED_REQUIRED")
        operation = promote if args.phase == "promote" else rollback
        operation(args.source, args.out, args.prepared, args.prepared_sha256)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        # Controlled identifiers only. Never stringify raw cloud/JSON errors.
        message = str(error) if type(error) is ValueError and re.fullmatch(r"[A-Z_]+(?::[a-z/-]+)?", str(error)) else type(error).__name__
        raise SystemExit("Emails promotion stopped: " + message + "; inspect retained metadata before retry or rollback")
