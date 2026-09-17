#!/usr/bin/env python3
"""Verify a prior Skills publication before an image-preserving configuration reload."""
import datetime
import hashlib
import io
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import zipfile

ROOT = Path(__file__).resolve().parents[2]
REPOSITORY = "hasna/apps"
WORKFLOW = ".github/workflows/deploy-skills.yml"
CONTROLLER_FILES = {
    WORKFLOW,
    "tooling/ci/skills-runtime-config-reload.py",
    "tooling/ci/tests/skills-runtime-config-reload.test.py",
    "tooling/ci/tests/standard/skills-runtime-config-reload.test.ts",
}
API_JOB = "build + scan + migrate + deploy"
GATE_JOB = "gate (successful ci for the exact main commit)"
RUNTIME_JOB = "build + scan + publish isolated runtime image"
API_STEPS = [
    "Verify source is the gated ci-passed main commit",
    "Build native ARM64 image locally",
    "Generate local vulnerability report",
    "Enforce local vulnerability gate",
    "Configure AWS credentials",
    "Load deploy manifest",
    "Login to Amazon ECR",
    "Push scanned image",
    "Run database migration",
    "Deploy API service",
    "Deploy worker service",
    "Smoke health endpoint",
]
SHA = re.compile(r"[a-f0-9]{40}")
DIGEST = re.compile(r"sha256:[a-f0-9]{64}")
MANIFEST_TYPES = {"application/vnd.oci.image.manifest.v1+json", "application/vnd.docker.distribution.manifest.v2+json"}


class Refusal(Exception):
    pass


def require(value, code):
    if not value:
        raise Refusal(code)


def sha(data):
    return "sha256:" + hashlib.sha256(data).hexdigest()


def command(args, maximum=16 * 1024 * 1024):
    process = subprocess.run(args, cwd=ROOT, capture_output=True, timeout=60)
    require(process.returncode == 0, "READ_COMMAND_FAILED")
    require(len(process.stdout) <= maximum, "READ_RESPONSE_TOO_LARGE")
    return process.stdout


def github(path, binary=False):
    require(path.startswith(f"repos/{REPOSITORY}/actions/"), "GITHUB_PATH_REFUSED")
    raw = command(["gh", "api", "--hostname", "github.com", path])
    return raw if binary else json.loads(raw)


def git(*args):
    return command(["git", *args], 1024 * 1024)


def step(job, name):
    matches = [item for item in job.get("steps", []) if item.get("name") == name]
    require(len(matches) == 1 and matches[0].get("status") == "completed" and matches[0].get("conclusion") == "success", "PRIOR_STEP_NOT_SUCCESSFUL")
    return matches[0]


def job(jobs, name):
    matches = [item for item in jobs if item.get("name") == name]
    require(len(matches) == 1 and matches[0].get("status") == "completed" and matches[0].get("conclusion") == "success", "PRIOR_JOB_NOT_SUCCESSFUL")
    require(type(matches[0].get("id")) is int and matches[0]["id"] > 0, "PRIOR_JOB_ID_INVALID")
    return matches[0]


def timestamp(value):
    require(isinstance(value, str) and value.endswith("Z"), "LOG_TIMESTAMP_INVALID")
    return datetime.datetime.fromisoformat(value.removesuffix("Z") + "+00:00").timestamp()


def pushed_digest(log, push, source):
    # Job metadata timestamps have second precision; Docker lines include fractions.
    start, end = timestamp(push.get("started_at")), timestamp(push.get("completed_at"))
    require(0 <= end - start <= 1200, "PUSH_STEP_TIME_INVALID")
    lines = re.sub(r"\x1b\[[0-9;]*m", "", log.decode("utf-8-sig")).splitlines()
    matches = []
    for line in lines:
        found = re.fullmatch(r"(\S+) " + re.escape(source) + r": digest: (sha256:[a-f0-9]{64}) size: ([1-9][0-9]*)", line)
        if found:
            require(start <= timestamp(found[1]) < end + 1, "DIGEST_OUTSIDE_PUSH_STEP")
            matches.append(found[2])
    require(len(matches) == 1, "UNIQUE_PUSHED_DIGEST_REQUIRED")
    window = "\n".join(line.partition(" ")[2] for line in lines if line.partition(" ")[0].endswith("Z") and start <= timestamp(line.partition(" ")[0]) < end + 1)
    for marker in ['IMAGE="${ECR_URL}:${SOURCE_SHA}"', 'docker tag "${LOCAL_IMAGE}:${SOURCE_SHA}" "${IMAGE}"', 'docker push "${IMAGE}"']:
        require(marker in window, "PUSH_COMMAND_BINDING_MISSING")
    return matches[0]


def runtime_receipt(artifact, raw, source):
    require(artifact.get("digest") == sha(raw), "RUNTIME_ARTIFACT_DIGEST_MISMATCH")
    require(len(raw) <= 1024 * 1024, "RUNTIME_ARTIFACT_TOO_LARGE")
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        entries = archive.infolist()
        require(len(entries) == 1 and entries[0].filename == "runtime-image-receipt.json" and entries[0].file_size <= 8192, "RUNTIME_ARTIFACT_LAYOUT_INVALID")
        receipt = json.loads(archive.read(entries[0]))
    require(receipt.get("sourceSha") == source and receipt.get("architecture") == "ARM64", "RUNTIME_ARTIFACT_SOURCE_MISMATCH")
    require(type(receipt.get("critical")) is int and receipt["critical"] == 0 and type(receipt.get("high")) is int and receipt["high"] == 0, "RUNTIME_SCAN_GATE_MISSING")
    require(isinstance(receipt.get("imageDigest"), str) and DIGEST.fullmatch(receipt["imageDigest"]), "RUNTIME_DIGEST_INVALID")
    return receipt["imageDigest"]


def verify_provenance(controller, source, run_id, expected_digest, fetch=github, repository_git=git):
    require(SHA.fullmatch(controller or "") and SHA.fullmatch(source or "") and DIGEST.fullmatch(expected_digest or ""), "RELOAD_SOURCE_OR_DIGEST_INVALID")
    require(type(run_id) is int and run_id > 0, "RELOAD_RUN_ID_INVALID")
    require(repository_git("rev-parse", "HEAD").decode().strip() == controller, "CONTROLLER_CHECKOUT_MISMATCH")
    repository_git("merge-base", "--is-ancestor", source, controller)
    changed = repository_git("diff", "--no-renames", "--name-only", "-z", source, controller).decode().split("\0")
    require(set(filter(None, changed)) <= CONTROLLER_FILES, "RELEASE_BUILD_INPUTS_CHANGED")
    base = f"repos/{REPOSITORY}/actions/runs/{run_id}"
    run = fetch(base)
    require(run.get("id") == run_id and run.get("path") == WORKFLOW and run.get("event") == "workflow_run" and run.get("head_branch") == "main" and run.get("head_sha") == source, "PRIOR_AUTOMATIC_RELEASE_MISMATCH")
    require(run.get("status") == "completed" and run.get("conclusion") == "success", "PRIOR_RUN_NOT_SUCCESSFUL")
    attempt = run.get("run_attempt")
    require(type(attempt) is int and attempt > 0, "PRIOR_ATTEMPT_INVALID")
    response = fetch(base + f"/attempts/{attempt}/jobs?per_page=100")
    jobs = response.get("jobs", [])
    require(response.get("total_count") == len(jobs) and len(jobs) <= 100, "PRIOR_JOBS_INCOMPLETE")
    gate, api = job(jobs, GATE_JOB), job(jobs, API_JOB)
    job(jobs, RUNTIME_JOB)
    steps = [step(api, name) for name in API_STEPS]
    numbers = [item.get("number") for item in steps]
    require(all(type(value) is int and value > 0 for value in numbers) and numbers == sorted(set(numbers)), "PRIOR_SCAN_DEPLOY_ORDER_INVALID")
    gate_log = fetch(f"repos/{REPOSITORY}/actions/jobs/{gate['id']}/logs", True)
    gate_sources = re.findall(rb"RUN_HEAD_SHA: ([a-f0-9]{40})(?:\r?\n|$)", gate_log)
    require(gate_sources and set(gate_sources) == {source.encode()}, "PRIOR_CI_GATE_SOURCE_MISMATCH")
    api_log = fetch(f"repos/{REPOSITORY}/actions/jobs/{api['id']}/logs", True)
    require(pushed_digest(api_log, step(api, "Push scanned image"), source) == expected_digest, "PRIOR_PUSHED_DIGEST_MISMATCH")
    listing = fetch(base + "/artifacts?per_page=100")
    artifacts = listing.get("artifacts", [])
    require(listing.get("total_count") == len(artifacts) and len(artifacts) <= 100, "PRIOR_ARTIFACTS_INCOMPLETE")
    matches = [item for item in artifacts if item.get("name") == "skills-runtime-image-" + source]
    require(len(matches) == 1 and matches[0].get("expired") is False, "PRIOR_RUNTIME_ARTIFACT_MISSING")
    artifact = matches[0]
    require(artifact.get("workflow_run", {}).get("id") == run_id and artifact["workflow_run"].get("head_sha") == source, "PRIOR_RUNTIME_ARTIFACT_RUN_MISMATCH")
    require(type(artifact.get("id")) is int and artifact["id"] > 0, "PRIOR_RUNTIME_ARTIFACT_ID_INVALID")
    runtime = runtime_receipt(artifact, fetch(f"repos/{REPOSITORY}/actions/artifacts/{artifact['id']}/zip", True), source)
    return {"controllerSourceSha": controller, "releaseSourceSha": source, "priorDeploymentRunId": run_id, "priorDeploymentAttempt": attempt, "apiImageDigest": expected_digest, "runtimeImageDigest": runtime, "priorApiJobId": api["id"], "priorApiLogSha256": sha(api_log), "priorRuntimeArtifactId": artifact["id"], "buildInputsIdentical": True, "priorScanAndPushVerified": True}


def resolve_image(repository, source, digest, runtime_digest, environment, aws):
    match = re.fullmatch(r"([0-9]{12})\.dkr\.ecr\.([a-z0-9-]+)\.amazonaws\.com/([a-z0-9]+(?:[._/-][a-z0-9]+)*)", repository or "")
    require(match and SHA.fullmatch(source or "") and DIGEST.fullmatch(digest or "") and DIGEST.fullmatch(runtime_digest or ""), "RELOAD_IMAGE_REFERENCE_INVALID")
    account, region, name = match.groups()
    require(region == os.environ.get("AWS_REGION"), "RELOAD_IMAGE_REGION_MISMATCH")
    require(aws(["sts", "get-caller-identity", "--query", "Account"]) == account, "RELOAD_ACCOUNT_MISMATCH")
    config = json.loads(environment.get("HASNA_SKILLS_RUNTIME_CONFIG", "null"))
    require(isinstance(config, dict) and config.get("imageDigest") == runtime_digest and isinstance(config.get("taskDefinition"), str) and config["taskDefinition"] and config.get("reviewedBundles"), "ACTIVATED_RUNTIME_IMAGE_MISMATCH")
    response = aws(["ecr", "batch-get-image", "--registry-id", account, "--repository-name", name, "--image-ids", "imageTag=" + source])
    require(not response.get("failures") and len(response.get("images", [])) == 1, "PRIOR_PUBLISHED_IMAGE_UNAVAILABLE")
    image = response["images"][0]
    require(image.get("registryId") == account and image.get("repositoryName") == name and image.get("imageId", {}).get("imageTag") == source and image["imageId"].get("imageDigest") == digest, "PUBLISHED_API_IMAGE_IDENTITY_MISMATCH")
    raw = image.get("imageManifest", "").encode()
    require(len(raw) <= 1024 * 1024 and sha(raw) == digest, "PUBLISHED_API_MANIFEST_DIGEST_MISMATCH")
    manifest = json.loads(raw)
    require(manifest.get("schemaVersion") == 2 and manifest.get("mediaType") in MANIFEST_TYPES and "manifests" not in manifest, "PUBLISHED_API_PLATFORM_MANIFEST_REQUIRED")
    return repository + "@" + digest


def output(values):
    with open(os.environ["GITHUB_OUTPUT"], "a", encoding="utf-8") as handle:
        for key, value in values.items():
            require("\n" not in str(value) and "\r" not in str(value), "OUTPUT_LINE_INVALID")
            handle.write(f"{key}={value}\n")


def main():
    require(len(sys.argv) == 2 and sys.argv[1] in {"gate", "image"}, "CONTROLLER_MODE_INVALID")
    if sys.argv[1] == "gate":
        enabled = os.environ.get("RELOAD_RUNTIME_CONFIG", "false") == "true"
        inputs = [os.environ.get(name, "") for name in ["RELOAD_SOURCE_SHA", "RELOAD_FROM_RUN_ID", "RELOAD_API_IMAGE_DIGEST"]]
        if not enabled:
            require(not any(inputs), "RELOAD_INPUTS_REQUIRE_MODE")
            require(os.environ.get("GITHUB_EVENT_NAME") != "workflow_dispatch" or os.environ.get("PUBLISH_RUNTIME_IMAGE") != "false", "RUNTIME_REUSE_REQUIRES_RELOAD_MODE")
            output({"reload_runtime_config": "false"})
            return
        require(os.environ.get("GITHUB_EVENT_NAME") == "workflow_dispatch" and os.environ.get("GITHUB_REF") == "refs/heads/main" and os.environ.get("GITHUB_REPOSITORY") == REPOSITORY, "RELOAD_REQUIRES_MANUAL_MAIN")
        require(os.environ.get("PUBLISH_RUNTIME_IMAGE") == "false", "RELOAD_MUST_REUSE_RUNTIME_IMAGE")
        require(re.fullmatch(r"[1-9][0-9]{0,19}", inputs[1]), "RELOAD_RUN_ID_INVALID")
        proof = verify_provenance(os.environ.get("CONTROLLER_SOURCE_SHA"), inputs[0], int(inputs[1]), inputs[2])
        path = Path(os.environ["RUNNER_TEMP"]) / "skills-runtime-config-reload-provenance.json"
        with path.open("x") as handle:
            json.dump(proof, handle, indent=2)
        output({"reload_runtime_config": "true", "release_source_sha": proof["releaseSourceSha"], "api_image_digest": proof["apiImageDigest"], "runtime_image_digest": proof["runtimeImageDigest"]})
    else:
        def aws(args):
            require(tuple(args[:2]) in {("sts", "get-caller-identity"), ("ecr", "batch-get-image")}, "READ_ONLY_IMAGE_OPERATION_REQUIRED")
            return json.loads(command(["aws", *args, "--region", os.environ["AWS_REGION"], "--output", "json", "--no-cli-pager"]))
        image = resolve_image(os.environ.get("ECR_URL"), os.environ.get("RELOAD_SOURCE_SHA"), os.environ.get("RELOAD_API_IMAGE_DIGEST"), os.environ.get("RELOAD_RUNTIME_IMAGE_DIGEST"), json.loads(os.environ.get("ENVIRONMENT_OVERRIDES", "null")), aws)
        output({"image": image})
    print("Skills configuration reload evidence verified; raw remote output suppressed.")


if __name__ == "__main__":
    os.umask(0o077)
    try:
        main()
    except Exception as error:
        print(str(error) if isinstance(error, Refusal) else "RELOAD_VERIFICATION_FAILED", file=sys.stderr)
        sys.exit(1)
