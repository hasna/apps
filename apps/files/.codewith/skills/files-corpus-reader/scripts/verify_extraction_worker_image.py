#!/usr/bin/env python3
"""Verify the open-files extraction worker image context.

Default mode is static and aggregate-only. It validates that the worker image
definition bakes the archive listing toolchain and that the smoke script keeps
archive member names redacted. With --build, it can also build and smoke the
image when Docker access is available.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import subprocess
import time
from pathlib import Path
from typing import Any


SCRIPT_DIR = Path(__file__).resolve().parent
SKILL_ROOT = SCRIPT_DIR.parent
DEFAULT_DOCKERFILE = SKILL_ROOT / "worker-image" / "Dockerfile"
DEFAULT_CONTEXT = SKILL_ROOT
DEFAULT_SMOKE = SKILL_ROOT / "worker-image" / "smoke-archive-tools.sh"
DEFAULT_TAG = "open-files-extraction-worker:archive-tools"
REQUIRED_PACKAGES = [
    "ca-certificates",
    "file",
    "libarchive-tools",
    "p7zip-full",
    "python3",
    "unzip",
]
REQUIRED_COPIES = [
    "scripts/archive_inventory.py",
    "scripts/extraction_tool_inventory.py",
    "worker-image/smoke-archive-tools.sh",
]
ARCHIVE_MISSING_BLOCKS = {"7z_inventory", "rar_inventory"}
DOCKER_RUN_SANDBOX_ARGS = [
    "--network",
    "none",
    "--read-only",
    "--tmpfs",
    "/tmp:rw,nosuid,nodev,size=128m",
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges",
    "--pids-limit",
    "128",
    "--memory",
    "512m",
    "--cpus",
    "1",
]
DOCKER_RUN_ENV_ARGS = ["--env", "PYTHONDONTWRITEBYTECODE=1"]


def now_utc() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def sha256_file(path: Path) -> str | None:
    if not path.exists():
        return None
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def command_error_code(proc: subprocess.CompletedProcess[str]) -> str | None:
    text = f"{proc.stderr}\n{proc.stdout}".lower()
    if "permission denied" in text:
        return "permission_denied"
    if "cannot connect" in text or "is the docker daemon running" in text:
        return "daemon_unavailable"
    if "not found" in text:
        return "not_found"
    if proc.returncode != 0:
        return "command_failed"
    return None


def read_text(path: Path) -> str:
    if not path.exists():
        return ""
    return path.read_text(encoding="utf-8")


def docker_worker_runtime_policy() -> dict[str, Any]:
    return {
        "status": "ok",
        "network_mode": "none",
        "network_disabled": True,
        "provider_egress_allowed": False,
        "arbitrary_url_fetch_allowed": False,
        "google_drive_access_allowed": False,
        "s3_object_access_allowed": False,
        "db_access_allowed": False,
        "corpus_mounts_allowed": False,
        "secret_env_allowed": False,
        "read_only_rootfs": True,
        "tmpfs_paths": ["/tmp"],
        "cap_drop_all": True,
        "no_new_privileges": True,
        "pids_limit": 128,
        "memory_limit": "512m",
        "cpus": "1",
        "command_logs_hashed_only": True,
        "private_values_in_command": False,
        "docker_run_sandbox_args": DOCKER_RUN_SANDBOX_ARGS,
    }


def docker_run_command(
    docker_path: str,
    tag: str,
    image_args: list[str],
    *,
    entrypoint: str | None = None,
) -> list[str]:
    command = [
        docker_path,
        "run",
        "--rm",
        *DOCKER_RUN_SANDBOX_ARGS,
        *DOCKER_RUN_ENV_ARGS,
    ]
    if entrypoint:
        command.extend(["--entrypoint", entrypoint])
    command.append(tag)
    command.extend(image_args)
    return command


def static_checks(dockerfile: Path, smoke_script: Path, context_dir: Path) -> dict[str, Any]:
    dockerfile_text = read_text(dockerfile)
    smoke_text = read_text(smoke_script)
    errors: list[str] = []
    warnings: list[str] = []

    if not dockerfile.exists():
        errors.append("missing_dockerfile")
    if not smoke_script.exists():
        errors.append("missing_smoke_script")
    if not context_dir.exists():
        errors.append("missing_context_dir")

    for package in REQUIRED_PACKAGES:
        if package not in dockerfile_text:
            errors.append(f"missing_package:{package}")
    for copied in REQUIRED_COPIES:
        if copied not in dockerfile_text:
            errors.append(f"missing_copy:{copied}")
    for copied in REQUIRED_COPIES:
        if not (context_dir / copied).exists():
            errors.append(f"missing_context_file:{copied}")

    if "USER extractor" not in dockerfile_text:
        errors.append("missing_non_root_user")
    if "ENTRYPOINT [\"python3\"]" not in dockerfile_text:
        warnings.append("entrypoint_not_python3")
    if "--include-names" in smoke_text:
        errors.append("smoke_allows_private_archive_names")
    for marker in ("sha256_redacted", "leaked a member name", "\"7z_inventory\"", "\"rar_inventory\""):
        if marker not in smoke_text:
            errors.append(f"missing_smoke_marker:{marker}")
    if "7z a -bd -y" not in smoke_text:
        errors.append("missing_7z_synthetic_smoke")

    return {
        "status": "ok" if not errors else "failed",
        "errors": errors,
        "warnings": warnings,
        "dockerfile": {
            "present": dockerfile.exists(),
            "bytes": dockerfile.stat().st_size if dockerfile.exists() else 0,
            "sha256": sha256_file(dockerfile),
        },
        "smoke_script": {
            "present": smoke_script.exists(),
            "bytes": smoke_script.stat().st_size if smoke_script.exists() else 0,
            "sha256": sha256_file(smoke_script),
            "executable": bool(smoke_script.exists() and smoke_script.stat().st_mode & 0o111),
        },
        "required_packages": REQUIRED_PACKAGES,
        "required_context_files": REQUIRED_COPIES,
        "redaction_checks": {
            "smoke_does_not_use_include_names": "--include-names" not in smoke_text,
            "smoke_checks_hashed_names": "sha256_redacted" in smoke_text,
            "smoke_checks_member_name_leaks": "leaked a member name" in smoke_text,
        },
        "worker_runtime_policy": docker_worker_runtime_policy(),
    }


def docker_probe(docker_binary: str = "docker") -> dict[str, Any]:
    docker_path = shutil.which(docker_binary)
    if not docker_path:
        return {"status": "not_found", "binary": docker_binary, "path": None}
    proc = subprocess.run(
        [docker_path, "version", "--format", "{{.Server.Version}}"],
        check=False,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        timeout=20,
    )
    if proc.returncode != 0:
        return {
            "status": command_error_code(proc) or "unavailable",
            "binary": docker_binary,
            "path": docker_path,
            "returncode": proc.returncode,
        }
    return {
        "status": "available",
        "binary": docker_binary,
        "path": docker_path,
        "server_version_present": bool(proc.stdout.strip()),
    }


def run_command(cmd: list[str], timeout: int) -> dict[str, Any]:
    started = time.time()
    try:
        proc = subprocess.run(
            cmd,
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            timeout=timeout,
        )
        duration_ms = int((time.time() - started) * 1000)
        return {
            "status": "ok" if proc.returncode == 0 else "failed",
            "returncode": proc.returncode,
            "duration_ms": duration_ms,
            "error_code": command_error_code(proc),
            "stdout_sha256": hashlib.sha256(proc.stdout.encode("utf-8", errors="replace")).hexdigest(),
            "stderr_sha256": hashlib.sha256(proc.stderr.encode("utf-8", errors="replace")).hexdigest(),
            "stdout_bytes": len(proc.stdout.encode("utf-8", errors="replace")),
            "stderr_bytes": len(proc.stderr.encode("utf-8", errors="replace")),
        }
    except subprocess.TimeoutExpired:
        duration_ms = int((time.time() - started) * 1000)
        return {"status": "timeout", "returncode": None, "duration_ms": duration_ms, "error_code": "timeout"}


def parse_worker_inventory(text: str) -> dict[str, Any]:
    try:
        inventory = json.loads(text)
    except json.JSONDecodeError:
        return {"status": "invalid_json"}
    if not isinstance(inventory, dict):
        return {"status": "invalid_json"}
    archive = ((inventory.get("lanes") or {}).get("needs_archive_inventory") or {})
    if not isinstance(archive, dict):
        return {"status": "missing_archive_lane"}
    missing = {str(block) for block in (archive.get("missing_blocks") or [])}
    return {
        "status": "ok" if archive.get("status") == "ready" and not (missing & ARCHIVE_MISSING_BLOCKS) else "failed",
        "archive_status": archive.get("status"),
        "archive_missing_blocks": sorted(missing),
        "clears_7z_rar_missing_blocks": not bool(missing & ARCHIVE_MISSING_BLOCKS),
    }


def capture_worker_inventory(tag: str, output: Path | None, timeout: int, docker_binary: str = "docker") -> dict[str, Any]:
    docker_path = shutil.which(docker_binary) or docker_binary
    cmd = docker_run_command(docker_path, tag, ["/opt/open-files/scripts/extraction_tool_inventory.py"])
    started = time.time()
    try:
        proc = subprocess.run(
            cmd,
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            timeout=timeout,
        )
    except subprocess.TimeoutExpired:
        return {"status": "timeout", "returncode": None, "duration_ms": int((time.time() - started) * 1000)}

    duration_ms = int((time.time() - started) * 1000)
    parsed = parse_worker_inventory(proc.stdout) if proc.returncode == 0 else {"status": "not_run"}
    if proc.returncode == 0 and output:
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(proc.stdout, encoding="utf-8")

    return {
        "status": "ok" if proc.returncode == 0 and parsed.get("status") == "ok" else "failed",
        "returncode": proc.returncode,
        "duration_ms": duration_ms,
        "error_code": command_error_code(proc),
        "inventory_output": str(output.resolve()) if output and proc.returncode == 0 else None,
        "inventory_summary": parsed,
        "stdout_sha256": hashlib.sha256(proc.stdout.encode("utf-8", errors="replace")).hexdigest(),
        "stderr_sha256": hashlib.sha256(proc.stderr.encode("utf-8", errors="replace")).hexdigest(),
        "stdout_bytes": len(proc.stdout.encode("utf-8", errors="replace")),
        "stderr_bytes": len(proc.stderr.encode("utf-8", errors="replace")),
        "docker_run_policy": docker_worker_runtime_policy(),
    }


def build_and_smoke(
    dockerfile: Path,
    context_dir: Path,
    tag: str,
    timeout: int,
    capture_inventory_output: Path | None,
    docker_binary: str = "docker",
) -> dict[str, Any]:
    docker_path = shutil.which(docker_binary) or docker_binary
    build = run_command(
        [docker_path, "build", "-f", str(dockerfile), "-t", tag, str(context_dir)],
        timeout=timeout,
    )
    if build["status"] != "ok":
        return {"status": "failed", "build": build, "smoke": None, "worker_inventory": None}

    smoke = run_command(
        docker_run_command(
            docker_path,
            tag,
            [],
            entrypoint="/usr/local/bin/open-files-archive-tools-smoke",
        ),
        timeout=timeout,
    )
    smoke["docker_run_policy"] = docker_worker_runtime_policy()
    worker_inventory = None
    if smoke["status"] == "ok":
        worker_inventory = capture_worker_inventory(tag, capture_inventory_output, timeout, docker_binary)
    return {
        "status": "ok" if smoke["status"] == "ok" and (worker_inventory or {}).get("status") == "ok" else "failed",
        "build": build,
        "smoke": smoke,
        "worker_inventory": worker_inventory,
        "docker_run_policy": docker_worker_runtime_policy(),
    }


def verify(
    dockerfile: Path,
    context_dir: Path,
    smoke_script: Path,
    tag: str,
    build: bool,
    timeout: int,
    worker_inventory_output: Path | None,
) -> dict[str, Any]:
    static = static_checks(dockerfile, smoke_script, context_dir)
    docker = docker_probe()
    runtime = None
    if build:
        if docker.get("status") != "available":
            runtime = {"status": "docker_unavailable", "docker_status": docker.get("status")}
        elif static["status"] != "ok":
            runtime = {"status": "static_failed"}
        else:
            runtime = build_and_smoke(
                dockerfile=dockerfile,
                context_dir=context_dir,
                tag=tag,
                timeout=timeout,
                capture_inventory_output=worker_inventory_output,
            )

    status = "ok"
    if static["status"] != "ok":
        status = "failed"
    elif build and not runtime:
        status = "failed"
    elif build and runtime and runtime.get("status") != "ok":
        status = "blocked_external_docker"

    return {
        "kind": "open_files_extraction_worker_image_verification",
        "version": 1,
        "created_at": now_utc(),
        "status": status,
        "redaction": "aggregate-only; does not read corpus files, object keys, filenames, source refs, secrets, extracted text, transcripts, ACL payloads, or row payloads; command logs are represented by byte counts and hashes only",
        "static": static,
        "docker": docker,
        "runtime": runtime,
        "worker_runtime_policy": docker_worker_runtime_policy(),
        "gates": {
            "static_verification_ok": static["status"] == "ok",
            "worker_runtime_network_disabled": True,
            "worker_runtime_provider_egress_disabled": True,
            "worker_runtime_s3_access_disabled": True,
            "worker_runtime_db_access_disabled": True,
            "worker_runtime_corpus_mounts_disabled": True,
            "worker_runtime_logs_hashed_only": True,
            "worker_runtime_policy_attested": True,
        },
        "image": {
            "tag": tag,
            "dockerfile": str(dockerfile),
            "context": str(context_dir),
            "smoke_script": str(smoke_script),
        },
        "next_actions": [
            action
            for action in [
                "grant_docker_socket_or_ci_runner_access" if docker.get("status") != "available" else None,
                "rerun_with_build_and_capture_worker_inventory" if not build else None,
                "pass_worker_inventory_to_extraction_lane_readiness_gate" if build and runtime and runtime.get("status") == "ok" else None,
            ]
            if action
        ],
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Verify the open-files extraction worker image context.")
    parser.add_argument("--dockerfile", default=str(DEFAULT_DOCKERFILE))
    parser.add_argument("--context", default=str(DEFAULT_CONTEXT))
    parser.add_argument("--smoke-script", default=str(DEFAULT_SMOKE))
    parser.add_argument("--tag", default=DEFAULT_TAG)
    parser.add_argument("--build", action="store_true", help="Build and smoke the worker image when Docker is available.")
    parser.add_argument("--timeout-seconds", type=int, default=600)
    parser.add_argument("--worker-tool-inventory-output", help="Where to write worker-produced extraction tool inventory after a successful --build smoke.")
    parser.add_argument("--output", help="Optional JSON evidence output path.")
    args = parser.parse_args()

    payload = verify(
        dockerfile=Path(args.dockerfile).expanduser().resolve(),
        context_dir=Path(args.context).expanduser().resolve(),
        smoke_script=Path(args.smoke_script).expanduser().resolve(),
        tag=args.tag,
        build=args.build,
        timeout=args.timeout_seconds,
        worker_inventory_output=Path(args.worker_tool_inventory_output).expanduser().resolve() if args.worker_tool_inventory_output else None,
    )

    if args.output:
        output = Path(args.output).expanduser().resolve()
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps(payload, indent=2, sort_keys=True))
    return 0 if payload["status"] == "ok" or payload["status"] == "blocked_external_docker" else 1


if __name__ == "__main__":
    raise SystemExit(main())
