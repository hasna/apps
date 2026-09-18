#!/usr/bin/env python3
"""One reviewed Emails overlay. No image execution, migration, or secret-value APIs.

Prepare may write two content-addressed ECR blobs and one immutable image tag.
Promote requires the SHA256 of a previously reviewed, metadata-only prepared plan.
Unknown writes stop for reconciliation; ECS has a precheck, not an atomic CAS.
"""
import argparse
import copy
from datetime import datetime, timedelta, timezone
import fcntl
import gzip
import hashlib
import io
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
import shutil
import tempfile
import time
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

_spec = importlib.util.spec_from_file_location("emails_overlay_recipes", ROOT / "recipes.py")
recipes = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(recipes)
IDENTITY = recipes.select()


def select_recipe(name):
    # Called exactly once by the CLI, before any cloud authority is exercised.
    global IDENTITY, BASE, BASE_CONFIG, PATHS
    IDENTITY = recipes.select(name)
    BASE, BASE_CONFIG, PATHS = IDENTITY["base"], IDENTITY["config"], IDENTITY["paths"]


def purpose_fields():
    return {} if IDENTITY["name"] == recipes.SEARCH else {"purpose": IDENTITY["name"]}


def recipe_path():
    return ROOT / IDENTITY["file"]


def migration_module():
    spec = importlib.util.spec_from_file_location("emails_overlay_migration", ROOT.parent / "emails-current" / "migration_admission.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def migration_equality(candidate_digest):
    # Authenticate actual registry manifests, every layer and parser-bound input.
    # No import/evaluation of image code and no mutation or secret APIs.
    from types import SimpleNamespace
    cache = {}
    def cached_blob(descriptor):
        key = (descriptor["digest"], descriptor["size"])
        if key not in cache:
            cache[key] = blob(descriptor)
        return cache[key]
    transport = SimpleNamespace(aws=aws, blob=cached_blob, sha=sha, digest=digest, encode=encode, REPO=REPO)
    return migration_module().admit(BASE, candidate_digest, transport)


def delivery_readiness():
    spec = importlib.util.spec_from_file_location("emails_delivery_public", ROOT.parent / "emails-current" / "public_proof.py")
    public = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(public)
    version, ready = public.get("/version"), public.get("/ready")
    require(version == {"status": "ok", "version": "1.4.10", "mode": "self_hosted", "name": "emails"}, "DELIVERY_PUBLIC_VERSION")
    require(ready.get("status") == "ready" and ready.get("version") == "1.4.10" and ready.get("mode") == "self_hosted"
            and ready.get("pendingMigrations") == [] and ready.get("migrationIssues") == [], "DELIVERY_PUBLIC_SCHEMA_READY")
    return {"version": "1.4.10", "ready": True, "pendingMigrations": 0, "migrationIssues": 0}


def delivery_live_proof(selected, image_digest, desired):
    service = current_service()
    require(service_binding(service) == selected and service["desiredCount"] == desired, "DELIVERY_LIVE_SERVICE")
    service_digest = reconciliation_service_digest(service)
    first, first_digest = running_task_snapshot({selected})
    require(len(first) == desired and all(
        row["taskDefinition"] == selected and row["lastStatus"] == "RUNNING"
        and row["healthStatus"] == "HEALTHY" and row["imageDigest"] == image_digest
        for row in first), "DELIVERY_LIVE_TASKS")
    ready = delivery_readiness()
    require(reconciliation_service_digest(current_service()) == service_digest, "DELIVERY_LIVE_RACE")
    second, second_digest = running_task_snapshot({selected})
    require(first_digest == second_digest and same_json(first, second), "DELIVERY_LIVE_RACE")
    require(reconciliation_service_digest(current_service()) == service_digest, "DELIVERY_LIVE_RACE")
    return {"taskDefinition": selected, "imageDigest": image_digest, "runningTasks": first, "publicReady": ready}


def require(ok, reason):
    if not ok:
        raise ValueError(reason)


def encode(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()


def same_json(left, right):
    return encode(left) == encode(right)


def digest(data):
    return "sha256:" + hashlib.sha256(data).hexdigest()


def sha(value):
    require(isinstance(value, str) and re.fullmatch(r"sha256:[0-9a-f]{64}", value), "BAD_DIGEST")
    return value


def save(path, value):
    if IDENTITY["name"] == recipes.DELIVERY:
        require(isinstance(value, dict) and value.get("purpose", recipes.DELIVERY) == recipes.DELIVERY, "RECEIPT_PURPOSE")
        value = {**value, **purpose_fields()}
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
    fd = None
    try:
        if body is not None:
            data = encode(body)
            require(len(data) <= 8 * 1024 * 1024, "AWS_REQUEST_LIMIT")
            require(callable(getattr(os, "memfd_create", None)), "AWS_MEMFD_REQUIRED")
            # AWS CLI file loading needs a reopenable file, not /dev/stdin.
            # Linux CI passes only this sealed, anonymous memory descriptor.
            # Complete task bodies never become argv or named disk files.
            fd = os.memfd_create("emails-aws-json", os.MFD_CLOEXEC | os.MFD_ALLOW_SEALING)
            os.fchmod(fd, 0o600)
            remaining = memoryview(data)
            while remaining:
                written = os.write(fd, remaining)
                require(written > 0, "AWS_REQUEST_WRITE_REFUSED")
                remaining = remaining[written:]
            os.lseek(fd, 0, os.SEEK_SET)
            seals = fcntl.F_SEAL_WRITE | fcntl.F_SEAL_GROW | fcntl.F_SEAL_SHRINK | fcntl.F_SEAL_SEAL
            fcntl.fcntl(fd, fcntl.F_ADD_SEALS, seals)
            require(fcntl.fcntl(fd, fcntl.F_GET_SEALS) == seals, "AWS_REQUEST_SEAL_REFUSED")
            command += ["--cli-input-json", f"file:///proc/self/fd/{fd}"]
        result = subprocess.run(command, stdin=subprocess.DEVNULL, pass_fds=() if fd is None else (fd,), capture_output=True, timeout=timeout, env=env)
    finally:
        if fd is not None:
            os.close(fd)
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
    value = json.loads(recipe_path().read_bytes())
    require(value.get("schema") == IDENTITY["schema"] and value["baseImageDigest"] == BASE, "RECIPE_BASE")
    require(value.get("purpose") == (None if IDENTITY["name"] == recipes.SEARCH else IDENTITY["name"]), "RECIPE_PURPOSE")
    if IDENTITY["name"] == recipes.DELIVERY:
        require(value.get("baseConfigDigest") == BASE_CONFIG and value.get("packageVersionPreserved") == "1.4.10", "RECIPE_BASE_CONFIG")
        require(all(value.get(key) is False for key in ("dependenciesChanged", "migrationsChanged", "entrypointChanged", "fullProducerEquivalenceClaimed")), "RECIPE_COMPATIBILITY")
    require(len(value["files"]) == 3 and {r["path"] for r in value["files"]} == set(PATHS), "RECIPE_SCOPE")
    require(all((r["uid"], r["gid"], r["mode"]) == IDENTITY["metadata"][r["path"]] for r in value["files"]), "RECIPE_OWNERSHIP")
    require(value["patchFile"] == IDENTITY["patch"], "RECIPE_PATCH")
    require(hashlib.sha256((ROOT / value["patchFile"]).read_bytes()).hexdigest() == value["patchSha256"], "PATCH_DRIFT")
    return value


def active_preimages(manifest, config, fetch=blob, paths=None):
    paths = PATHS if paths is None else paths
    require(1 <= len(manifest["layers"]) <= 32 and len(manifest["layers"]) == len(config["rootfs"]["diff_ids"]), "LAYER_COUNT")
    ancestors = {str(p) for n in paths for p in Path(n).parents if str(p) != "."}
    relevant = set(paths) | ancestors
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
    require(ancestors <= state.keys() and set(paths) <= state.keys(), "MISSING_IMAGE_SOURCE")
    return {p: state[p] for p in paths}


def delivery_runtime_checks(preimages, files):
    """Exercise authenticated route/provider source with synthetic boundaries."""
    helper = "app/src/lib/reply-headers.ts"
    raw, uid, gid, mode = preimages[helper]
    require((hashlib.sha256(raw).hexdigest(), uid, gid, mode) == (
        "96c4abb0079d659ac8d49926986b63b15e7bd602a62fad5c9e3018aac0e44a24", 0, 0, 0o664), "REPLY_HELPER_DRIFT")
    bun = shutil.which("bun")
    require(bun is not None, "DELIVERY_TEST_RUNTIME_REQUIRED")
    with tempfile.TemporaryDirectory(prefix="emails-delivery-source-") as directory:
        root = Path(directory)
        for test_mode in ("baseline", "patched"):
            for path in (*PATHS, helper):
                target = root / path
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(files[path] if test_mode == "patched" and path in files else preimages[path][0])
            result = subprocess.run([bun, "--no-env-file", str(ROOT / "delivery_runtime_test.ts"),
                                     "--source-root", directory, "--mode", test_mode],
                                    capture_output=True, cwd=directory, timeout=60,
                                    env={"PATH": str(Path(bun).parent)})
            require(result.returncode == 0, "DELIVERY_RUNTIME_TEST_REFUSED")


def make_layer(files):
    require(set(files) == set(PATHS), "OVERLAY_PATH_SCOPE")
    out = io.BytesIO()
    with tarfile.open(fileobj=out, mode="w", format=tarfile.USTAR_FORMAT) as tar:
        for path in sorted(files):
            data = files[path]
            require(isinstance(data, bytes) and len(data) <= 4 * 1024 * 1024, "OVERLAY_FILE_LIMIT")
            member = tarfile.TarInfo(path)
            member.size, member.uid, member.gid, member.mode, member.mtime = len(data), *IDENTITY["metadata"][path], 0
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
    updated.setdefault("history", []).append({"created_by": "hasna/apps reviewed Emails " + IDENTITY["history"] + " overlay " + source})
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
    cache = {}
    def cached_blob(descriptor):
        key = (descriptor["digest"], descriptor["size"])
        if key not in cache:
            cache[key] = blob(descriptor)
        return cache[key]
    read_paths = (*PATHS, "app/src/lib/reply-headers.ts") if IDENTITY["name"] == recipes.DELIVERY else PATHS
    pre = active_preimages(manifest, config, cached_blob, read_paths)
    for row in rules["files"]:
        data, uid, gid, mode = pre[row["path"]]
        require((len(data), hashlib.sha256(data).hexdigest(), uid, gid, mode) == (row["beforeBytes"], row["beforeSha256"], row["uid"], row["gid"], row["mode"]), "PREIMAGE_DRIFT")
    files = apply_reviewed_patch(rules, (ROOT / IDENTITY["patch"]).read_bytes(), {p: pre[p][0] for p in PATHS}, IDENTITY["name"])
    for row in rules["files"]:
        require(len(files[row["path"]]) == row["afterBytes"] and hashlib.sha256(files[row["path"]]).hexdigest() == row["afterSha256"], "POSTIMAGE_DRIFT")
    layer, diff_id = make_layer(files)
    result, config_bytes = append_overlay(manifest, config, layer, diff_id, source)
    receipt = {**purpose_fields(), "baseImageDigest": BASE, "baseConfigDigest": BASE_CONFIG, "imageDigest": digest(encode(result)), "configDigest": digest(config_bytes), "layerDigest": digest(layer), "layerDiffId": diff_id, "baseLayers": manifest["layers"], "files": rules["files"], "runtimeConfigurationPreserved": True, "baseLayersPreserved": True, "imageExecuted": False, "dependencyInstallation": False}
    if IDENTITY["name"] == recipes.DELIVERY:
        delivery_runtime_checks(pre, files)
        # Before any upload, inspect the reconstructed OCI candidate as well as
        # its authenticated parent. The registry copy is inspected again after
        # preparation and before promotion/rollback/reconciliation.
        from types import SimpleNamespace
        cache[(digest(layer), len(layer))] = layer
        transport = SimpleNamespace(blob=cached_blob, sha=sha, digest=digest)
        migration = migration_module()
        before = migration.active_inputs(manifest, config, transport)
        after = migration.active_inputs(result, json.loads(config_bytes), transport)
        migration.validate_routing(before)
        migration.validate_routing(after)
        require(before == after, "MIGRATION_DEFINITION_DRIFT")
        receipt["migrationInputsDigest"] = digest(encode({name: digest(raw) for name, raw in before.items()}))
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
    if IDENTITY["name"] == recipes.SEARCH:
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


def wait_for_service(task_definition, desired_count, timeout=1200, interval=15):
    """Wait for our stronger completion contract without repeating any write."""
    deadline = time.monotonic() + timeout
    while True:
        service = current_service()
        require(service.get("taskDefinition") == task_definition and service.get("desiredCount") == desired_count, "LIVE_SERVICE_DRIFT")
        require(not any(row.get("rolloutState") == "FAILED" for row in service.get("deployments", [])), "DEPLOYMENT_FAILED")
        try:
            service_binding(service)
            return service
        except ValueError as error:
            if str(error) not in {"SERVICE_NOT_STABLE", "DEPLOYMENT_NOT_STABLE"}:
                raise
        remaining = deadline - time.monotonic()
        require(remaining > 0, "DEPLOYMENT_COMPLETION_TIMEOUT")
        time.sleep(min(interval, remaining))


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
    if IDENTITY["name"] == recipes.DELIVERY:
        delivery_live_proof(before_arn, BASE, service["desiredCount"])
    before_hash = digest(encode(before))
    require(service_binding(current_service()) == before_arn and digest(encode(task_read(before_arn))) == before_hash, "PREPARE_RUNTIME_DRIFT")
    tag = IDENTITY["name"] + "-" + source
    intent = {**purpose_fields(), "schema": IDENTITY["preparedSchema"], "sourceCommit": source, "recipeSha256": hashlib.sha256(recipe_path().read_bytes()).hexdigest(), "taskDefinitionBefore": before_arn, "taskBeforeDigest": before_hash, "taskAfterDigest": digest(encode(candidate)), "desiredCount": service["desiredCount"], "image": image_receipt, "tag": tag}
    if IDENTITY["name"] == recipes.DELIVERY:
        run_id = os.environ.get("GITHUB_RUN_ID", "")
        require(re.fullmatch(r"[1-9][0-9]{0,19}", run_id), "PREPARATION_RUN_ID")
        intent["producerRunId"] = run_id
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
    if IDENTITY["name"] == recipes.DELIVERY:
        intent["migrationAdmission"] = migration_equality(image_receipt["imageDigest"])
    plan_hash = save(out / "prepared.json", intent)
    save(out / "summary.json", {"phase": "prepared", "preparedSha256": plan_hash, "imageDigest": image_receipt["imageDigest"], "runtimeChanged": False})


def reviewed_plan(source, prepared, expected_hash):
    raw = prepared.read_bytes()
    require(re.fullmatch(r"[0-9a-f]{64}", expected_hash) and hashlib.sha256(raw).hexdigest() == expected_hash and len(raw) < 65536, "PREPARED_DIGEST")
    plan = json.loads(raw)
    require(plan["schema"] == IDENTITY["preparedSchema"] and plan["sourceCommit"] == source and plan["recipeSha256"] == hashlib.sha256(recipe_path().read_bytes()).hexdigest(), "PREPARED_SOURCE")
    require(plan.get("purpose") == (None if IDENTITY["name"] == recipes.SEARCH else IDENTITY["name"]), "PREPARED_PURPOSE")
    # Reconstruct all immutable image bytes from the same reviewed source. A
    # substituted artifact cannot change the admitted source or image config.
    manifest, cfg, layer, image_receipt = build(source)
    require(plan["image"] == image_receipt and image_manifest(image_receipt["imageDigest"]) == manifest, "PREPARED_IMAGE_DRIFT")
    if IDENTITY["name"] == recipes.DELIVERY:
        require(plan.get("migrationAdmission") == migration_equality(image_receipt["imageDigest"]), "PREPARED_MIGRATION_DRIFT")
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
    if IDENTITY["name"] == recipes.DELIVERY:
        delivery_live_proof(before_arn, BASE, service["desiredCount"])
    save(out / "register-intent.json", {"preparedSha256": expected_hash, "taskBefore": before_arn, "taskCandidateDigest": plan["taskAfterDigest"], "imageDigest": image_receipt["imageDigest"]})
    # ECS describes an untagged task as tags=[], but rejects that field during
    # registration. Preserve the canonical candidate for digest/readback checks.
    request = copy.deepcopy(candidate)
    if request.get("tags") == []:
        del request["tags"]
    result = aws("ecs", "register-task-definition", body=request)
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
        live = wait_for_service(new_arn, plan["desiredCount"])
        require(service_binding(live) == new_arn and live["desiredCount"] == plan["desiredCount"], "LIVE_SERVICE_DRIFT")
        tasks = aws("ecs", "list-tasks", "--cluster", CLUSTER, "--service-name", SERVICE, "--desired-status", "RUNNING")["taskArns"]
        require(len(tasks) == plan["desiredCount"] and len(tasks) <= 100, "LIVE_TASK_COUNT")
        rows = aws("ecs", "describe-tasks", "--cluster", CLUSTER, "--tasks", *tasks)
        require(not rows.get("failures") and len(rows.get("tasks", [])) == len(tasks), "LIVE_TASK_READ")
        for task in rows["tasks"]:
            web = [c for c in task.get("containers", []) if c.get("name") == "emails"]
            require(task.get("taskDefinitionArn") == new_arn and task.get("lastStatus") == "RUNNING" and task.get("healthStatus") == "HEALTHY" and len(web) == 1 and web[0].get("imageDigest") == image_receipt["imageDigest"], "LIVE_IMAGE_DRIFT")
        if IDENTITY["name"] == recipes.DELIVERY:
            save(out / "public-ready.json", delivery_live_proof(new_arn, image_receipt["imageDigest"], plan["desiredCount"]))
        save(out / "promoted.json", {"preparedSha256": expected_hash, "sourceCommit": source, "taskBefore": before_arn, "taskAfter": new_arn, "imageDigest": image_receipt["imageDigest"], "runningTasks": tasks, **({"searchConcurrency": 8} if IDENTITY["name"] == recipes.SEARCH else purpose_fields()), "runtimeConfigurationPreserved": True})
    except Exception:
        # A failed waiter/read is uncertainty, not permission for an automatic
        # rollback. Preserve the exact previous revision for a separately
        # reviewed guarded rollback; never overwrite another deployment.
        save(out / "reconciliation-required.json", {"taskBefore": before_arn, "taskCandidate": new_arn, "automaticRetry": False, "automaticRollback": False})
        raise



def task_payload(task):
    return {k: copy.deepcopy(v) for k, v in task.items() if k not in READ_ONLY_TASK_FIELDS}


def task_image(payload):
    rows = [c for c in payload.get("containerDefinitions", []) if c.get("name") == "emails"]
    require(len(rows) == 1, "WEB_CONTAINER_IDENTITY")
    image = rows[0].get("image")
    prefix = REPOSITORY + "@"
    require(isinstance(image, str) and image.startswith(prefix), "RECONCILE_IMAGE_REPOSITORY")
    return sha(image[len(prefix):])



def parsed_docker_timestamp_ns(value, code):
    require(isinstance(value, str) and len(value) <= 64, code)
    match = re.fullmatch(
        r"([0-9]{4})-([0-9]{2})-([0-9]{2})T([0-9]{2}):([0-9]{2}):([0-9]{2})(?:[.]([0-9]{1,9}))?(Z|[+-][0-9]{2}:[0-9]{2})",
        value,
    )
    require(match is not None, code)
    year, month, day, hour, minute, second = map(int, match.groups()[:6])
    # Go/Docker RFC3339Nano timestamps do not emit leap-second values. Refuse
    # rather than widening this one historical normalization to generic RFC3339.
    require(second <= 59, code)
    fraction = match.group(7) or ""
    zone = match.group(8)
    require(zone != "-00:00", code)
    if zone == "Z":
        offset = timezone.utc
    else:
        offset_hours, offset_minutes = map(int, zone[1:].split(":"))
        require(offset_hours <= 23 and offset_minutes <= 59, code)
        offset_delta = timedelta(hours=offset_hours, minutes=offset_minutes)
        offset = timezone(offset_delta if zone[0] == "+" else -offset_delta)
    try:
        parsed = datetime(year, month, day, hour, minute, second, tzinfo=offset)
    except ValueError:
        raise ValueError(code)
    utc = parsed.astimezone(timezone.utc)
    epoch = datetime(1970, 1, 1, tzinfo=timezone.utc)
    elapsed = utc - epoch
    whole_seconds = elapsed.days * 86400 + elapsed.seconds
    nanoseconds = int(fraction.ljust(9, "0")) if fraction else 0
    return whole_seconds * 1_000_000_000 + nanoseconds


def appended_history_entry(parent_history, child_history):
    require(len(child_history) == len(parent_history) + 1, "RECONCILE_DESCENDANT_HISTORY")
    appended = child_history[-1]
    if same_json(child_history[:-1], parent_history):
        return appended, False
    require(parent_history and same_json(child_history[:-2], parent_history[:-1]), "RECONCILE_DESCENDANT_HISTORY")
    parent_tail = parent_history[-1]
    stamped_tail = child_history[-2]
    require(isinstance(parent_tail, dict) and isinstance(stamped_tail, dict) and "created" not in parent_tail, "RECONCILE_DESCENDANT_HISTORY")
    require(set(stamped_tail) == set(parent_tail) | {"created"} and same_json({key: stamped_tail[key] for key in parent_tail}, parent_tail), "RECONCILE_DESCENDANT_HISTORY")
    stamped_at = parsed_docker_timestamp_ns(stamped_tail.get("created"), "RECONCILE_DESCENDANT_HISTORY_TIMESTAMP")
    appended_at = parsed_docker_timestamp_ns(appended.get("created") if isinstance(appended, dict) else None, "RECONCILE_DESCENDANT_HISTORY_TIMESTAMP")
    delta_ns = appended_at - stamped_at
    require(0 <= delta_ns <= 5_000_000_000, "RECONCILE_DESCENDANT_HISTORY_TIMESTAMP")
    return appended, True


def descendant_overlay_lineage(parent_digest, child_digest):
    require(parent_digest != child_digest, "RECONCILE_DESCENDANT_IMAGE_UNCHANGED")
    parent_manifest = image_manifest(parent_digest)
    child_manifest = image_manifest(child_digest)
    require(len(child_manifest["layers"]) == len(parent_manifest["layers"]) + 1, "RECONCILE_DESCENDANT_LAYER_COUNT")
    require(same_json(child_manifest["layers"][:-1], parent_manifest["layers"]), "RECONCILE_DESCENDANT_LAYER_PREFIX")
    parent_config = json.loads(blob(parent_manifest["config"]))
    child_config = json.loads(blob(child_manifest["config"]))
    require(set(parent_config) == set(child_config) == {"architecture", "config", "created", "history", "os", "rootfs"}, "RECONCILE_DESCENDANT_CONFIG_FIELDS")
    require(parent_config["architecture"] == child_config["architecture"] == "amd64" and parent_config["os"] == child_config["os"] == "linux", "RECONCILE_DESCENDANT_PLATFORM")
    parent_diff_ids = parent_config.get("rootfs", {}).get("diff_ids", [])
    child_diff_ids = child_config.get("rootfs", {}).get("diff_ids", [])
    require(parent_config.get("rootfs", {}).get("type") == child_config.get("rootfs", {}).get("type") == "layers", "RECONCILE_DESCENDANT_ROOTFS")
    require(len(child_diff_ids) == len(parent_diff_ids) + 1 and same_json(child_diff_ids[:-1], parent_diff_ids), "RECONCILE_DESCENDANT_DIFF_IDS")
    parent_runtime = copy.deepcopy(parent_config["config"])
    child_runtime = copy.deepcopy(child_config["config"])
    parent_labels = parent_runtime.pop("Labels", {}) or {}
    child_labels = child_runtime.pop("Labels", {}) or {}
    require(same_json(parent_runtime, child_runtime), "RECONCILE_DESCENDANT_RUNTIME_DRIFT")
    require(all(child_labels.get(key) == value for key, value in parent_labels.items()), "RECONCILE_DESCENDANT_LABEL_DRIFT")
    added_labels = sorted(set(child_labels) - set(parent_labels))
    require(1 <= len(added_labels) <= 8, "RECONCILE_DESCENDANT_LABEL_COUNT")
    require(all(re.fullmatch(r"com[.]hasna[.][a-z0-9.-]{1,120}", key) and isinstance(child_labels[key], str) and 1 <= len(child_labels[key]) <= 256 and not re.search(r"[\x00-\x1f\x7f]", child_labels[key]) for key in added_labels), "RECONCILE_DESCENDANT_LABELS")
    parent_history = parent_config.get("history", [])
    child_history = child_config.get("history", [])
    require(isinstance(parent_history, list) and isinstance(child_history, list), "RECONCILE_DESCENDANT_HISTORY")
    appended_history, parent_history_stamped = appended_history_entry(parent_history, child_history)
    layer = child_manifest["layers"][-1]
    require(layer.get("mediaType") == OCI_LAYER and isinstance(layer.get("size"), int) and 0 < layer["size"] <= 8 * 1024 * 1024, "RECONCILE_DESCENDANT_LAYER")
    compressed_layer = blob(layer)
    with gzip.GzipFile(fileobj=io.BytesIO(compressed_layer)) as stream:
        uncompressed_layer = stream.read(64 * 1024 * 1024 + 1)
    require(0 < len(uncompressed_layer) <= 64 * 1024 * 1024, "RECONCILE_DESCENDANT_LAYER_EXPANSION")
    require(digest(uncompressed_layer) == child_diff_ids[-1], "RECONCILE_DESCENDANT_DIFF_ID_BINDING")
    require(isinstance(appended_history, dict) and appended_history.get("empty_layer") is not True and isinstance(appended_history.get("created_by"), str) and appended_history["created_by"].strip(), "RECONCILE_DESCENDANT_HISTORY_LAYER")
    return {
        "parentImageDigest": parent_digest,
        "childImageDigest": child_digest,
        "layerDigest": sha(layer["digest"]),
        "layerSize": layer["size"],
        "diffId": sha(child_diff_ids[-1]),
        "addedLabelNames": added_labels,
        "runtimeConfigurationPreserved": True,
        "parentLayersPreserved": True,
        "parentHistoryTimestampNormalized": parent_history_stamped,
    }


def historical_reviewed_plan(current_source, prepared, expected_hash):
    raw = prepared.read_bytes()
    require(re.fullmatch(r"[0-9a-f]{64}", expected_hash) and hashlib.sha256(raw).hexdigest() == expected_hash and len(raw) < 65536, "PREPARED_DIGEST")
    plan = json.loads(raw)
    prepared_source = plan.get("sourceCommit")
    require(isinstance(prepared_source, str) and re.fullmatch(r"[0-9a-f]{40}", prepared_source), "PREPARED_SOURCE")
    require(
        subprocess.run(
            ["git", "merge-base", "--is-ancestor", prepared_source, current_source],
            stdin=subprocess.DEVNULL,
            capture_output=True,
            timeout=30,
        ).returncode == 0,
        "PREPARED_SOURCE_NOT_ANCESTOR",
    )
    verified, image_receipt = reviewed_plan(prepared_source, prepared, expected_hash)
    return verified, image_receipt, prepared_source


def running_task_snapshot(known_tasks):
    task_arns = aws("ecs", "list-tasks", "--cluster", CLUSTER, "--service-name", SERVICE, "--desired-status", "RUNNING").get("taskArns", [])
    require(isinstance(task_arns, list) and len(task_arns) <= 100 and all(isinstance(arn, str) and arn for arn in task_arns), "LIVE_TASK_COUNT")
    task_arns = sorted(task_arns)
    controlled = []
    safe = []
    if task_arns:
        rows = aws("ecs", "describe-tasks", "--cluster", CLUSTER, "--tasks", *task_arns)
        require(not rows.get("failures") and len(rows.get("tasks", [])) == len(task_arns), "LIVE_TASK_READ")
        by_arn = {row.get("taskArn"): row for row in rows["tasks"]}
        require(set(by_arn) == set(task_arns), "LIVE_TASK_IDENTITY")
        for task_arn in task_arns:
            task = by_arn[task_arn]
            definition = task.get("taskDefinitionArn")
            require(definition in known_tasks, "RECONCILE_FOREIGN_RUNNING_TASK")
            web = [c for c in task.get("containers", []) if c.get("name") == "emails"]
            require(len(web) == 1, "WEB_CONTAINER_IDENTITY")
            row = {
                "taskArn": task_arn,
                "taskDefinition": definition,
                "lastStatus": task.get("lastStatus"),
                "healthStatus": task.get("healthStatus"),
                "imageDigest": web[0].get("imageDigest"),
            }
            controlled.append(row)
            safe.append({
                "taskArnSha256": hashlib.sha256(task_arn.encode()).hexdigest(),
                "taskDefinition": definition,
                "lastStatus": row["lastStatus"],
                "healthStatus": row["healthStatus"],
                "imageDigest": row["imageDigest"],
            })
    return safe, digest(encode(controlled))


def reconciliation_service_digest(service):
    deployments = service.get("deployments", [])
    controlled = {
        "serviceName": service.get("serviceName"),
        "status": service.get("status"),
        "taskDefinition": service.get("taskDefinition"),
        "desiredCount": service.get("desiredCount"),
        "runningCount": service.get("runningCount"),
        "pendingCount": service.get("pendingCount"),
        "deployments": [
            {
                "taskDefinition": row.get("taskDefinition"),
                "status": row.get("status"),
                "rolloutState": row.get("rolloutState"),
                "desiredCount": row.get("desiredCount"),
                "runningCount": row.get("runningCount"),
                "pendingCount": row.get("pendingCount"),
            }
            for row in deployments
        ],
    }
    return digest(encode(controlled))


def reconcile_delivery(source, out, expected_hash, plan, image_receipt, prepared_source):
    """Only the exact prepared base or exact image-only candidate may be live."""
    previous = plan["taskDefinitionBefore"]
    before = task_read(previous)
    require(before.get("taskDefinitionArn") == previous and before.get("status") == "ACTIVE", "RECONCILE_BASE_IDENTITY")
    candidate = task_candidate(before, image_receipt["imageDigest"])
    require(digest(encode(candidate)) == plan["taskAfterDigest"], "RECONCILE_BASE_PAYLOAD_DRIFT")
    service = current_service()
    selected = service_binding(service)
    require(service["desiredCount"] == plan["desiredCount"], "RECONCILE_DESIRED_COUNT")
    if selected == previous:
        live_image = BASE
    else:
        require(selected.startswith(f"arn:aws:ecs:{REGION}:{ACCOUNT}:task-definition/{SERVICE}:"), "RECONCILE_FOREIGN_TASK")
        actual = task_read(selected)
        require(actual.get("taskDefinitionArn") == selected and actual.get("status") == "ACTIVE" and same_json(task_payload(actual), candidate), "RECONCILE_CANDIDATE_DRIFT")
        live_image = image_receipt["imageDigest"]
    service_digest = reconciliation_service_digest(service)
    tasks, tasks_digest = running_task_snapshot({selected})
    require(len(tasks) == service["desiredCount"] and all(
        row["taskDefinition"] == selected and row["lastStatus"] == "RUNNING"
        and row["healthStatus"] == "HEALTHY" and row["imageDigest"] == live_image
        for row in tasks), "RECONCILE_RUNNING_TASKS")
    require(reconciliation_service_digest(current_service()) == service_digest, "RECONCILE_SERVICE_RACE")
    ready = delivery_readiness()
    require(reconciliation_service_digest(current_service()) == service_digest, "RECONCILE_SERVICE_RACE")
    repeated, repeated_digest = running_task_snapshot({selected})
    require(tasks_digest == repeated_digest and same_json(tasks, repeated), "RECONCILE_RUNNING_TASK_RACE")
    require(reconciliation_service_digest(current_service()) == service_digest, "RECONCILE_SERVICE_RACE")
    save(out / "reconciled.json", {
        "schema": "emails.delivery-reconciliation.v1", "sourceCommit": source,
        "preparedSourceCommit": prepared_source, "producerRunId": plan["producerRunId"],
        "preparedSha256": expected_hash, "recipeSha256": plan["recipeSha256"],
        "taskBefore": previous, "taskCandidateDigest": plan["taskAfterDigest"],
        "service": {"taskDefinition": selected, "desiredCount": service["desiredCount"],
                    "imageDigest": live_image, "runningTasks": tasks, "stable": True, "healthy": True},
        "publicReady": ready, "state": "base_live_stable" if selected == previous else "candidate_live_stable",
        "rollback": {"automatic": False, "preMigrationAnchor": previous,
                     "validAfterForwardMigration": False, "requiresSeparateReview": True},
    })


def reconcile(source, out, prepared, expected_hash):
    """Read-only reconciliation of the exact reviewed 88/89 promotion state.

    The receipt deliberately excludes task environment and secret-reference values.
    It binds only controlled identifiers, canonical task hashes, image digests and
    service convergence facts. No AWS mutation API is called. Historical prepared
    evidence is accepted only when its exact main source is an ancestor of the
    current exact-main workflow source.
    """
    plan, image_receipt, prepared_source = historical_reviewed_plan(source, prepared, expected_hash)
    if IDENTITY["name"] == recipes.DELIVERY:
        return reconcile_delivery(source, out, expected_hash, plan, image_receipt, prepared_source)
    expected_before = plan["taskDefinitionBefore"]
    require(expected_before.endswith(":88"), "RECONCILE_EXPECTED_TASK_88")
    expected_candidate = expected_before.rsplit(":", 1)[0] + ":89"

    before = task_read(expected_before)
    candidate = task_read(expected_candidate)
    require(
        before.get("taskDefinitionArn") == expected_before
        and before.get("revision") == 88
        and before.get("status") == "ACTIVE",
        "RECONCILE_TASK_88_IDENTITY",
    )
    before_payload_digest = digest(encode(task_payload(before)))
    expected_payload = task_candidate(before, image_receipt["imageDigest"])
    require(digest(encode(expected_payload)) == plan["taskAfterDigest"], "RECONCILE_TASK_88_PAYLOAD_DRIFT")
    candidate_payload = task_payload(candidate)
    require(same_json(candidate_payload, expected_payload), "RECONCILE_TASK_89_DRIFT")

    service = current_service()
    service_digest = reconciliation_service_digest(service)
    require(service.get("serviceName") == SERVICE and service.get("status") == "ACTIVE", "SERVICE_IDENTITY")
    current = service.get("taskDefinition")
    require(isinstance(current, str) and current.startswith(expected_before.rsplit(":", 1)[0] + ":"), "RECONCILE_FOREIGN_TASK")
    current_revision = current.rsplit(":", 1)[-1]
    require(current_revision.isdigit() and 88 <= int(current_revision) <= 10_000, "RECONCILE_TASK_REVISION")
    known_tasks = {expected_before, expected_candidate}
    descendant = None
    current_image_digest = BASE if current == expected_before else image_receipt["imageDigest"]
    if current not in known_tasks:
        require(int(current_revision) > 89, "RECONCILE_FOREIGN_TASK")
        current_task = task_read(current)
        current_payload = task_payload(current_task)
        current_image_digest = task_image(current_payload)
        normalized_current = copy.deepcopy(current_payload)
        normalized_web = next(c for c in normalized_current["containerDefinitions"] if c.get("name") == "emails")
        normalized_web["image"] = REPOSITORY + "@" + image_receipt["imageDigest"]
        require(same_json(normalized_current, candidate_payload), "RECONCILE_DESCENDANT_TASK_DRIFT")
        descendant = {
            "taskDefinition": current,
            "digest": digest(encode(current_payload)),
            "imageDigest": current_image_digest,
            "lineage": descendant_overlay_lineage(image_receipt["imageDigest"], current_image_digest),
        }
        known_tasks.add(current)
    deployments = service.get("deployments", [])
    require(isinstance(deployments, list) and 1 <= len(deployments) <= 3, "RECONCILE_DEPLOYMENTS")
    safe_deployments = []
    for row in deployments:
        arn = row.get("taskDefinition")
        require(arn in known_tasks, "RECONCILE_FOREIGN_DEPLOYMENT")
        safe_deployments.append({
            "taskDefinition": arn,
            "status": row.get("status"),
            "rolloutState": row.get("rolloutState"),
            "desiredCount": row.get("desiredCount"),
            "runningCount": row.get("runningCount"),
            "pendingCount": row.get("pendingCount"),
        })

    observed, running_digest = running_task_snapshot(known_tasks)

    stable = service_binding(service) == current
    expected_live_digest = current_image_digest
    healthy = len(observed) == service.get("desiredCount") and all(
        row["taskDefinition"] == current
        and row["lastStatus"] == "RUNNING"
        and row["healthStatus"] == "HEALTHY"
        and row["imageDigest"] == expected_live_digest
        for row in observed
    )
    require(healthy, "RECONCILE_RUNNING_TASKS")
    require(reconciliation_service_digest(current_service()) == service_digest, "RECONCILE_SERVICE_RACE")
    observed_again, running_digest_again = running_task_snapshot(known_tasks)
    require(running_digest_again == running_digest and same_json(observed_again, observed), "RECONCILE_RUNNING_TASK_RACE")
    require(reconciliation_service_digest(current_service()) == service_digest, "RECONCILE_SERVICE_RACE")
    state = "descendant_overlay_live_stable" if descendant else "candidate_live_stable" if current == expected_candidate else "base_live_stable"
    receipt = {
        "schema": "emails.promotion-reconciliation.v1",
        "sourceCommit": source,
        "preparedSourceCommit": prepared_source,
        "preparedSha256": expected_hash,
        "task88": {
            "taskDefinition": expected_before,
            "historicalReadDigest": plan["taskBeforeDigest"],
            "currentPayloadDigest": before_payload_digest,
            "readOnlyRepresentationMayDiffer": True,
            "imageDigest": BASE,
        },
        "task89": {"taskDefinition": expected_candidate, "digest": plan["taskAfterDigest"], "imageDigest": image_receipt["imageDigest"]},
        "descendant": descendant,
        "service": {
            "taskDefinition": current,
            "desiredCount": service.get("desiredCount"),
            "runningCount": service.get("runningCount"),
            "pendingCount": service.get("pendingCount"),
            "stable": stable,
            "healthy": healthy,
            "deployments": safe_deployments,
            "runningTasks": observed,
        },
        "state": state,
        "rollback": {
            "automatic": False,
            "preMigrationAnchor": current,
            "tasks88And89AreHistoricalOnly": current not in {expected_before, expected_candidate},
            "validAfterForwardMigration": False,
            "requiresSeparateReview": True,
        },
    }
    save(out / "reconciled.json", receipt)

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
    if IDENTITY["name"] == recipes.DELIVERY:
        delivery_readiness()
    fresh = current_service()
    require(fresh.get("taskDefinition") == current and fresh.get("desiredCount") == plan["desiredCount"], "ROLLBACK_PRE_UPDATE_DRIFT")
    save(out / "rollback-intent.json", {"preparedSha256": expected_hash, "from": current, "to": before_arn})
    aws("ecs", "update-service", "--cluster", CLUSTER, "--service", SERVICE, "--task-definition", before_arn)
    live = wait_for_service(before_arn, plan["desiredCount"])
    require(service_binding(live) == before_arn and live["desiredCount"] == plan["desiredCount"], "ROLLBACK_LIVE_DRIFT")
    if IDENTITY["name"] == recipes.DELIVERY:
        save(out / "public-ready.json", delivery_live_proof(before_arn, BASE, plan["desiredCount"]))
    save(out / "rolled-back.json", {"preparedSha256": expected_hash, "taskBefore": current, "taskAfter": before_arn, "newRegistrations": 0, "deregisteredTasks": 0})


def main():
    p = argparse.ArgumentParser()
    p.add_argument("phase", choices=["prepare", "reconcile", "promote", "rollback"])
    p.add_argument("--recipe", choices=recipes.NAMES, default=recipes.SEARCH)
    p.add_argument("--source", required=True)
    p.add_argument("--out", type=Path, required=True)
    p.add_argument("--prepared", type=Path)
    p.add_argument("--prepared-sha256")
    args = p.parse_args()
    select_recipe(args.recipe)
    require(re.fullmatch(r"[0-9a-f]{40}", args.source), "SOURCE_COMMIT")
    require(aws("sts", "get-caller-identity")["Account"] == ACCOUNT, "AWS_ACCOUNT")
    os.umask(0o077)
    args.out.mkdir(mode=0o700)
    if args.phase == "prepare":
        prepare(args.source, args.out)
    else:
        require(args.prepared is not None and args.prepared_sha256 is not None, "REVIEWED_PREPARED_REQUIRED")
        operation = reconcile if args.phase == "reconcile" else promote if args.phase == "promote" else rollback
        operation(args.source, args.out, args.prepared, args.prepared_sha256)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        # Controlled identifiers only. Never stringify raw cloud/JSON errors.
        message = str(error) if type(error) is ValueError and re.fullmatch(r"[A-Z0-9_]+(?::[a-z0-9/-]+)?", str(error)) else type(error).__name__
        raise SystemExit("Emails promotion stopped: " + message + "; inspect retained metadata before retry or rollback")
