#!/usr/bin/env python3
"""Build a locked, external worker bundle for semantic review agents.

The bundle is a small standalone working directory for Codewith workers:
sanitized manifest, copied bounded review artifacts, schema, prompt, and output
directory. Shared stdout is aggregate-only and never includes file IDs, source
paths, artifact contents, object keys, filenames, or secrets.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import shlex
import time
from pathlib import Path
from typing import Any


DEFAULT_SPARK_MODEL = "gpt-5.3-codex-spark"
DEFAULT_MIMO_MODEL = "xiaomi/mimo-v2.5-pro"
DEFAULT_OPENROUTER_MODEL = "openai/gpt-5.1-codex-mini"

ENV_ALLOWLIST = {
    "CODEWITH_HOME",
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

CONTROLLED_HOME_RELATIVE = "sandbox-home"
CONTROLLED_TMP_RELATIVE = "tmp"
DECLARED_WRITABLE_DIRS = ["output", CONTROLLED_HOME_RELATIVE, CONTROLLED_TMP_RELATIVE]

ALLOWED_MANIFEST_KEYS = {
    "artifact_ready",
    "artifact_status",
    "content_ready",
    "content_strategy",
    "duplicate_group_id",
    "expected_ext",
    "ext",
    "extractor",
    "extractor_lane",
    "file_id",
    "mime",
    "modified_at",
    "owner",
    "review_artifact",
    "review_status",
    "root_type",
    "route",
    "size",
    "storage_provider",
}

DISALLOWED_KEYS = {
    "acl",
    "canonical_name",
    "checksum",
    "drive_id",
    "file_name",
    "filename",
    "google_drive_id",
    "key",
    "labels",
    "name",
    "object_key",
    "original_filename",
    "original_name",
    "path",
    "permissions",
    "private_metadata",
    "revision_id",
    "s3_key",
    "sha256",
    "source_ref",
    "target_path",
}

SENSITIVE_PATTERNS = (
    re.compile(r"objects/sha256/"),
    re.compile(r"open-files://"),
    re.compile(r"s3://"),
    re.compile(r"https?://(?:drive|docs)\.google\.com/"),
    re.compile(r'"object_key"\s*:'),
    re.compile(r'"source_ref"\s*:'),
    re.compile(r'"transcript"\s*:'),
    re.compile(r'"extracted_text"\s*:'),
)


def now_utc() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def load_jsonl(path: Path, limit: int | None) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    with path.open("r", encoding="utf-8") as handle:
        for line_no, line in enumerate(handle, start=1):
            stripped = line.strip()
            if not stripped:
                continue
            value = json.loads(stripped)
            if not isinstance(value, dict):
                raise SystemExit(f"invalid manifest row at line {line_no}: row is not an object")
            rows.append(value)
            if limit is not None and len(rows) >= limit:
                break
    return rows


def write_jsonl(path: Path, rows: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, sort_keys=True) + "\n")


def is_under(child: Path, parent: Path) -> bool:
    try:
        child.resolve().relative_to(parent.resolve())
        return True
    except ValueError:
        return False


def has_git_ancestor(path: Path) -> bool:
    current = path.expanduser().resolve()
    if current.is_file():
        current = current.parent
    for parent in (current, *current.parents):
        git_marker = parent / ".git"
        if git_marker.exists():
            return True
    return False


def provider_default(provider: str) -> tuple[str, str | None, list[str]]:
    if provider == "spark":
        return DEFAULT_SPARK_MODEL, "account001", []
    if provider == "mimo":
        return DEFAULT_MIMO_MODEL, None, ["--profile", "openrouter"]
    if provider == "openrouter":
        return DEFAULT_OPENROUTER_MODEL, None, ["--profile", "openrouter"]
    raise SystemExit(f"unsupported provider: {provider}")


def provider_egress_hosts(provider: str) -> list[str]:
    if provider == "spark":
        return ["api.openai.com"]
    if provider in {"mimo", "openrouter"}:
        return ["openrouter.ai"]
    raise SystemExit(f"unsupported provider: {provider}")


def network_egress_policy(provider: str) -> dict[str, Any]:
    return {
        "mode": "provider-egress-allowlist",
        "deny_by_default": True,
        "provider": provider,
        "provider_endpoint_hosts": provider_egress_hosts(provider),
        "allowed_purposes": ["model_inference_only"],
        "arbitrary_url_fetch_allowed": False,
        "google_drive_access_allowed": False,
        "raw_file_bytes_allowed": False,
        "s3_object_access_allowed": False,
        "secret_values_in_payload_allowed": False,
        "provider_data_collection": "deny",
        "redaction": "egress policy contains provider host classes and booleans only; no URLs with paths, secrets, file IDs, object keys, source refs, or payloads",
    }


def safe_row(row: dict[str, Any], copied_review: str) -> dict[str, Any]:
    unknown_sensitive = sorted(key for key in row if key.lower() in DISALLOWED_KEYS)
    if unknown_sensitive:
        raise ValueError("manifest row contains disallowed private metadata fields")
    safe = {
        key: row.get(key)
        for key in sorted(ALLOWED_MANIFEST_KEYS - {"review_artifact"})
        if key in row
    }
    file_id = safe.get("file_id")
    if not isinstance(file_id, str) or not file_id:
        raise ValueError("manifest row missing file_id")
    safe["review_artifact"] = copied_review
    return safe


def copied_review_name(index: int) -> str:
    return f"review-artifacts/job-{index:06d}.review.json"


def resolve_review_artifact(value: str, manifest_dir: Path) -> Path:
    path = Path(value).expanduser()
    if not path.is_absolute():
        path = manifest_dir / path
    return path.resolve()


def copy_review_artifact(index: int, row: dict[str, Any], input_dir: Path, manifest_dir: Path) -> tuple[dict[str, Any] | None, dict[str, Any]]:
    review_artifact = row.get("review_artifact")
    summary = {
        "status": "pending",
        "owner": row.get("owner") or "unknown",
        "extractor_lane": row.get("extractor_lane") or "unknown",
        "content_ready": bool(row.get("content_ready")),
    }
    if not isinstance(review_artifact, str) or not review_artifact:
        summary["status"] = "missing_review_artifact"
        return None, summary
    source = resolve_review_artifact(review_artifact, manifest_dir)
    if not source.exists() or not source.is_file():
        summary["status"] = "review_artifact_not_found"
        return None, summary
    copied_relative = copied_review_name(index)
    copied = input_dir / copied_relative
    copied.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(source, copied)
    try:
        safe = safe_row(row, copied_relative)
    except ValueError as exc:
        summary["status"] = "invalid_manifest_row"
        summary["reason"] = str(exc)
        copied.unlink(missing_ok=True)
        return None, summary
    summary["status"] = "ready"
    return safe, summary


def write_prompt(path: Path) -> None:
    path.write_text(
        """You are an open-files semantic review worker running inside a locked bundle.

Hard rules:
- Do not print private filenames, paths, object keys, source refs, URLs, extracted text, transcripts, ACL payloads, or row payloads.
- Do not run extractors, download files, inspect the repo, inspect the database, or read outside this bundle.
- Read only `input/manifest.jsonl` and the `review_artifact` paths referenced by that manifest.
- Preserve canonical S3 bytes; propose metadata only.
- Write proposal rows only to `output/proposals.jsonl`.
- Write per-row errors only to `output/errors.jsonl`.
- Your final response must match `input/worker-final.schema.json` and contain aggregate counts only.

For each job:
1. Use the owner, MIME, extension, lane/status, and bounded review artifact to classify the file.
2. Propose exactly one JSON object per readable job with fields:
   `file_id`, `canonical_name`, `target_path`, `document_kind`, `confidence`, `requires_review`, and `reason`.
3. Use lowercase kebab-case filenames and owner-prefixed target paths. The target path basename must equal `canonical_name`.
4. Preserve `expected_ext` exactly when it exists.
5. If `content_ready` is false, use confidence `low` and set `requires_review` to true.
6. For this stage, set `requires_review` to true for every proposal.
7. Keep `reason` under 300 characters and describe only aggregate evidence such as artifact status, document kind, date signal, route, or MIME.
8. If a job is missing a readable review artifact, write an error row with `file_id`, `status`, and `reason`.
""",
        encoding="utf-8",
    )


def build_command(
    bundle_dir: Path,
    provider: str,
    model: str,
    auth_profile: str | None,
    reasoning_effort: str | None,
    *,
    skip_git_repo_check: bool,
) -> list[str]:
    schema = bundle_dir / "input" / "worker-final.schema.json"
    final_output = bundle_dir / "output" / "final.json"
    _default_model, default_auth, provider_flags = provider_default(provider)
    cmd = [
        "codewith",
        "exec",
        "--ephemeral",
        "--disable",
        "image_generation",
        "-m",
        model,
        "-C",
        str(bundle_dir),
        "-o",
        str(final_output),
        "--output-schema",
        str(schema),
    ]
    if skip_git_repo_check:
        cmd.append("--skip-git-repo-check")
    if reasoning_effort:
        cmd.extend(["-c", f'model_reasoning_effort="{reasoning_effort}"'])
    if provider == "spark":
        profile = auth_profile if auth_profile is not None else default_auth
        if profile:
            cmd.extend(["--auth-profile", profile])
    else:
        cmd.extend(provider_flags)
    cmd.extend(["--sandbox", "workspace-write", "-"])
    return cmd


def write_runner_script(path: Path, command: list[str], prompt: Path) -> None:
    env_parts = [
        'CODEWITH_HOME="$CODEWITH_HOME_VALUE"',
        'HOME="$SANDBOX_HOME"',
        'LANG="${LANG:-C.UTF-8}"',
        'LC_ALL="${LC_ALL:-}"',
        'LOGNAME="${LOGNAME:-}"',
        'PATH="${PATH:-/usr/local/bin:/usr/bin:/bin}"',
        'SHELL="${SHELL:-/bin/sh}"',
        'TERM="${TERM:-dumb}"',
        'TMPDIR="$SANDBOX_TMP"',
        'USER="${USER:-}"',
        'XDG_CACHE_HOME="$SANDBOX_HOME/.cache"',
        'XDG_CONFIG_HOME="$SANDBOX_HOME/.config"',
        'XDG_DATA_HOME="$SANDBOX_HOME/.local/share"',
    ]
    path.write_text(
        "#!/usr/bin/env bash\n"
        "set -euo pipefail\n"
        "cd \"$(dirname \"$0\")\"\n"
        f"SANDBOX_HOME=\"$PWD/{CONTROLLED_HOME_RELATIVE}\"\n"
        f"SANDBOX_TMP=\"$PWD/{CONTROLLED_TMP_RELATIVE}\"\n"
        "HOST_HOME=\"${HOME:-}\"\n"
        "CODEWITH_HOME_VALUE=\"${CODEWITH_HOME:-${HOST_HOME}/.codewith}\"\n"
        "if [ -z \"$CODEWITH_HOME_VALUE\" ]; then\n"
        "  echo \"CODEWITH_HOME is required when host HOME is unavailable\" >&2\n"
        "  exit 2\n"
        "fi\n"
        "mkdir -p \"$SANDBOX_HOME/.cache\" \"$SANDBOX_HOME/.config\" \"$SANDBOX_HOME/.local/share\" \"$SANDBOX_TMP\"\n"
        "exec env -i \\\n  "
        + " \\\n  ".join(env_parts)
        + " \\\n  "
        + shlex.join(command)
        + " < "
        + shlex.quote(str(prompt))
        + "\n",
        encoding="utf-8",
    )
    path.chmod(0o700)


def scan_text(path: Path) -> int:
    try:
        text = path.read_text(encoding="utf-8", errors="replace")
    except UnicodeDecodeError:
        return 0
    return sum(1 for pattern in SENSITIVE_PATTERNS if pattern.search(text))


def relative_path(path: Path, root: Path) -> str:
    return path.resolve().relative_to(root.resolve()).as_posix()


def bundle_integrity_files(bundle_dir: Path) -> list[Path]:
    input_dir = bundle_dir / "input"
    files = [
        input_dir / "manifest.jsonl",
        input_dir / "worker-final.schema.json",
        bundle_dir / "prompt.md",
        bundle_dir / "environment-policy.json",
        bundle_dir / "command.json",
        bundle_dir / "run-worker.sh",
    ]
    review_dir = input_dir / "review-artifacts"
    if review_dir.exists():
        files.extend(sorted(path for path in review_dir.rglob("*") if path.is_file()))
    return [path for path in files if path.exists()]


def write_bundle_integrity(bundle_dir: Path, provider: str) -> dict[str, Any]:
    skip_git_repo_check = not has_git_ancestor(bundle_dir)
    files = [
        {
            "path": relative_path(path, bundle_dir),
            "bytes": path.stat().st_size,
            "sha256": file_sha256(path),
        }
        for path in bundle_integrity_files(bundle_dir)
    ]
    payload = {
        "created_at": now_utc(),
        "kind": "locked_worker_bundle_integrity",
        "status": "ok",
        "files": files,
        "file_count": len(files),
        "skip_git_repo_check": skip_git_repo_check,
        "skip_git_repo_check_justification": (
            "bundle has no Git ancestor; integrity is checked by relative file hashes and copied artifact checksums"
            if skip_git_repo_check
            else "bundle has a Git ancestor; codewith can perform its normal repository check while -C confines the worker root"
        ),
        "git_ancestor_present": has_git_ancestor(bundle_dir),
        "home_policy": "controlled-bundle-home",
        "host_home_inherited": False,
        "execution_surface": {
            "repo_checkout_access": False,
            "database_access": False,
            "raw_download_access": False,
            "s3_object_access": False,
            "private_manifest_access": "sanitized_bundle_manifest_only",
            "review_artifact_access": "copied_bounded_review_artifacts_only",
            "declared_writable_dirs": DECLARED_WRITABLE_DIRS,
        },
        "network_egress_policy": network_egress_policy(provider),
        "redaction": "integrity manifest contains relative bundle paths, byte counts, and hashes only; no file IDs, filenames, source refs, object keys, extracted text, or secrets",
    }
    integrity_path = bundle_dir / "bundle-integrity.json"
    integrity_path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return payload


def validate_integrity(bundle_dir: Path) -> dict[str, Any]:
    integrity_path = bundle_dir / "bundle-integrity.json"
    if not integrity_path.exists():
        return {"status": "missing", "errors": [{"code": "missing_integrity_manifest"}]}
    payload = load_json(integrity_path)
    if not isinstance(payload, dict):
        return {"status": "error", "errors": [{"code": "invalid_integrity_manifest"}]}
    errors: list[dict[str, str]] = []
    entries = payload.get("files")
    if not isinstance(entries, list):
        errors.append({"code": "invalid_integrity_files", "message": "integrity files must be a list"})
        entries = []
    for entry in entries:
        if not isinstance(entry, dict):
            errors.append({"code": "invalid_integrity_entry", "message": "integrity entry is not an object"})
            continue
        rel = entry.get("path")
        if not isinstance(rel, str) or rel.startswith("/") or ".." in Path(rel).parts:
            errors.append({"code": "invalid_integrity_path", "message": "integrity path is not a safe relative path"})
            continue
        path = (bundle_dir / rel).resolve()
        if not is_under(path, bundle_dir):
            errors.append({"code": "integrity_path_escape", "message": "integrity path escapes bundle"})
            continue
        if not path.exists() or not path.is_file():
            errors.append({"code": "integrity_file_missing", "message": "integrity file is missing"})
            continue
        if entry.get("bytes") != path.stat().st_size:
            errors.append({"code": "integrity_bytes_mismatch", "message": "integrity byte count changed"})
        if entry.get("sha256") != file_sha256(path):
            errors.append({"code": "integrity_sha_mismatch", "message": "integrity checksum changed"})
    if payload.get("host_home_inherited") is not False:
        errors.append({"code": "host_home_policy_mismatch", "message": "integrity manifest must record host HOME as not inherited"})
    if payload.get("skip_git_repo_check") not in {True, False}:
        errors.append({"code": "skip_git_policy_missing", "message": "integrity manifest must record skip-git policy"})
    if payload.get("skip_git_repo_check") is True and not payload.get("skip_git_repo_check_justification"):
        errors.append({"code": "skip_git_justification_missing", "message": "skip-git policy requires justification"})
    execution_surface = payload.get("execution_surface") if isinstance(payload.get("execution_surface"), dict) else {}
    for key in ("repo_checkout_access", "database_access", "raw_download_access", "s3_object_access"):
        if execution_surface.get(key) is not False:
            errors.append({"code": "execution_surface_policy_mismatch", "message": f"{key} must be false"})
    if execution_surface.get("declared_writable_dirs") != DECLARED_WRITABLE_DIRS:
        errors.append({"code": "declared_writable_dirs_mismatch", "message": "declared writable dirs do not match locked bundle policy"})
    egress_policy = payload.get("network_egress_policy") if isinstance(payload.get("network_egress_policy"), dict) else {}
    if not network_egress_policy_valid(egress_policy):
        errors.append({"code": "network_egress_policy_invalid", "message": "network egress policy must be provider-only and deny-by-default"})
    return {
        "status": "ok" if not errors else "error",
        "errors": errors,
        "file_count": len(entries),
        "sha256": file_sha256(integrity_path),
        "redaction": "integrity validation omits private row values and artifact contents",
    }


def validate_bundle(bundle_dir: Path, rows: list[dict[str, Any]]) -> dict[str, Any]:
    errors: list[dict[str, str]] = []
    input_dir = bundle_dir / "input"
    output_dir = bundle_dir / "output"
    manifest_path = input_dir / "manifest.jsonl"
    review_dir = input_dir / "review-artifacts"

    if not manifest_path.exists():
        errors.append({"code": "missing_manifest", "location": "bundle", "message": "input manifest missing"})
    if not output_dir.exists():
        errors.append({"code": "missing_output_dir", "location": "bundle", "message": "output directory missing"})

    symlink_count = sum(1 for path in bundle_dir.rglob("*") if path.is_symlink())
    if symlink_count:
        errors.append({"code": "symlink_found", "location": "bundle", "message": "bundle contains symlinks"})

    absolute_review_paths = 0
    missing_reviews = 0
    path_escape_reviews = 0
    for row in rows:
        review_artifact = row.get("review_artifact")
        if not isinstance(review_artifact, str):
            missing_reviews += 1
            continue
        review_path = Path(review_artifact)
        if review_path.is_absolute():
            absolute_review_paths += 1
            continue
        resolved = (input_dir / review_path).resolve()
        if not is_under(resolved, review_dir):
            path_escape_reviews += 1
            continue
        if not resolved.exists():
            missing_reviews += 1

    if absolute_review_paths:
        errors.append({"code": "absolute_review_paths", "location": "manifest", "message": "manifest contains absolute review artifact paths"})
    if path_escape_reviews:
        errors.append({"code": "review_path_escape", "location": "manifest", "message": "review artifact path escapes review directory"})
    if missing_reviews:
        errors.append({"code": "missing_review_artifacts", "location": "manifest", "message": "review artifacts are missing"})

    sensitive_hits = 0
    for path in bundle_dir.rglob("*"):
        if path.is_file() and path.suffix.lower() in {".json", ".jsonl", ".md", ".sh"}:
            sensitive_hits += scan_text(path)
    if sensitive_hits:
        errors.append({"code": "sensitive_marker_hits", "location": "bundle", "message": "bundle contains disallowed source/object markers"})
    integrity = validate_integrity(bundle_dir)
    if integrity["status"] != "ok":
        errors.append({"code": "integrity_validation_failed", "location": "bundle", "message": "bundle integrity manifest is missing or invalid"})

    return {
        "status": "ok" if not errors else "error",
        "errors": errors,
        "symlinks": symlink_count,
        "sensitive_marker_hits": sensitive_hits,
        "integrity": integrity,
        "rows": len(rows),
        "redaction": "validation summary omits file IDs, filenames, paths, object keys, source refs, extracted text, and review contents",
    }


def count_by(rows: list[dict[str, Any]], field: str) -> dict[str, int]:
    counts: dict[str, int] = {}
    for row in rows:
        key = str(row.get(field) or "unknown")
        counts[key] = counts.get(key, 0) + 1
    return dict(sorted(counts.items()))


def minimal_env_summary() -> dict[str, Any]:
    return {
        "policy": "minimal-allowlist",
        "home_policy": "controlled-bundle-home",
        "host_home_inherited": False,
        "controlled_paths": {
            "HOME": CONTROLLED_HOME_RELATIVE,
            "TMPDIR": CONTROLLED_TMP_RELATIVE,
            "XDG_CACHE_HOME": f"{CONTROLLED_HOME_RELATIVE}/.cache",
            "XDG_CONFIG_HOME": f"{CONTROLLED_HOME_RELATIVE}/.config",
            "XDG_DATA_HOME": f"{CONTROLLED_HOME_RELATIVE}/.local/share",
        },
        "codewith_home_policy": "preserve CODEWITH_HOME when provided, otherwise derive it from the pre-sandbox host HOME for auth only",
        "allowed_keys": sorted(ENV_ALLOWLIST),
        "present_allowed_keys": sorted(key for key in ENV_ALLOWLIST if os.environ.get(key)),
        "secret_values_included": False,
    }


def execution_surface_summary() -> dict[str, Any]:
    return {
        "repo_checkout_access": False,
        "database_access": False,
        "raw_download_access": False,
        "s3_object_access": False,
        "private_manifest_access": "sanitized_bundle_manifest_only",
        "review_artifact_access": "copied_bounded_review_artifacts_only",
        "declared_writable_dirs": DECLARED_WRITABLE_DIRS,
        "skip_git_repo_check_policy": "only_when_no_git_ancestor",
    }


def network_egress_policy_valid(policy: dict[str, Any]) -> bool:
    hosts = policy.get("provider_endpoint_hosts")
    safe_hosts = (
        isinstance(hosts, list)
        and len(hosts) > 0
        and all(isinstance(host, str) and host and "/" not in host and "*" not in host for host in hosts)
    )
    return (
        policy.get("mode") == "provider-egress-allowlist"
        and policy.get("deny_by_default") is True
        and safe_hosts
        and policy.get("allowed_purposes") == ["model_inference_only"]
        and policy.get("arbitrary_url_fetch_allowed") is False
        and policy.get("google_drive_access_allowed") is False
        and policy.get("raw_file_bytes_allowed") is False
        and policy.get("s3_object_access_allowed") is False
        and policy.get("secret_values_in_payload_allowed") is False
        and policy.get("provider_data_collection") == "deny"
    )


def main() -> int:
    parser = argparse.ArgumentParser(description="Build a locked semantic-review worker bundle.")
    parser.add_argument("--manifest", required=True, help="Private review manifest JSONL")
    parser.add_argument("--output-dir", required=True, help="Bundle output directory")
    parser.add_argument("--provider", choices=["spark", "openrouter", "mimo"], default="spark")
    parser.add_argument("--model", help="Model slug")
    parser.add_argument("--auth-profile", help="Codewith auth profile for Spark")
    parser.add_argument("--reasoning-effort", choices=["low", "medium", "high", "xhigh", "none"], default="high")
    parser.add_argument("--limit", type=int, help="Maximum jobs to copy into the bundle")
    parser.add_argument("--overwrite", action="store_true", help="Replace an existing bundle directory")
    args = parser.parse_args()

    if args.limit is not None and args.limit < 0:
        raise SystemExit("--limit cannot be negative")

    manifest_path = Path(args.manifest).expanduser().resolve()
    if not manifest_path.exists():
        raise SystemExit("manifest not found")
    bundle_dir = Path(args.output_dir).expanduser().resolve()
    if bundle_dir.exists() and args.overwrite:
        shutil.rmtree(bundle_dir)
    if bundle_dir.exists() and any(bundle_dir.iterdir()):
        raise SystemExit("output directory already exists; pass --overwrite to replace it")

    input_dir = bundle_dir / "input"
    output_dir = bundle_dir / "output"
    input_dir.mkdir(parents=True, exist_ok=True)
    output_dir.mkdir(parents=True, exist_ok=True)
    (bundle_dir / CONTROLLED_HOME_RELATIVE).mkdir(parents=True, exist_ok=True)
    (bundle_dir / CONTROLLED_TMP_RELATIVE).mkdir(parents=True, exist_ok=True)

    rows = load_jsonl(manifest_path, args.limit)
    safe_rows: list[dict[str, Any]] = []
    summaries: list[dict[str, Any]] = []
    manifest_dir = manifest_path.parent
    for index, row in enumerate(rows, start=1):
        safe, summary = copy_review_artifact(index, row, input_dir, manifest_dir)
        summaries.append(summary)
        if safe is not None:
            safe_rows.append(safe)

    schema_src = Path(__file__).resolve().parents[1] / "schemas" / "worker-final.schema.json"
    schema_dst = input_dir / "worker-final.schema.json"
    shutil.copyfile(schema_src, schema_dst)
    manifest_dst = input_dir / "manifest.jsonl"
    write_jsonl(manifest_dst, safe_rows)
    prompt = bundle_dir / "prompt.md"
    write_prompt(prompt)
    (bundle_dir / "environment-policy.json").write_text(json.dumps(minimal_env_summary(), indent=2, sort_keys=True), encoding="utf-8")

    default_model, default_auth, _provider_flags = provider_default(args.provider)
    model = args.model or default_model
    auth_profile = args.auth_profile if args.auth_profile is not None else default_auth
    reasoning_effort = None if args.reasoning_effort == "none" else args.reasoning_effort
    git_ancestor_present = has_git_ancestor(bundle_dir)
    skip_git_repo_check = not git_ancestor_present
    command = build_command(
        bundle_dir,
        args.provider,
        model,
        auth_profile,
        reasoning_effort,
        skip_git_repo_check=skip_git_repo_check,
    )
    runner_script = bundle_dir / "run-worker.sh"
    write_runner_script(runner_script, command, prompt)
    command_payload = {
        "created_at": now_utc(),
        "provider": args.provider,
        "model": model,
        "auth_profile": auth_profile if args.provider == "spark" else None,
        "reasoning_effort": reasoning_effort,
        "cwd": str(bundle_dir),
        "stdin": str(prompt),
        "outputs": {
            "proposals": "output/proposals.jsonl",
            "errors": "output/errors.jsonl",
            "final": "output/final.json",
        },
        "command": command,
        "runner_script": str(runner_script),
        "shell": shlex.join(command),
        "minimal_env_wrapper": "run-worker.sh launches codewith through env -i with only allowlisted keys and a controlled bundle-local HOME",
        "home_policy": {
            "mode": "controlled-bundle-home",
            "host_home_inherited": False,
            "home": CONTROLLED_HOME_RELATIVE,
            "tmp": CONTROLLED_TMP_RELATIVE,
        },
        "git_ancestor_present": git_ancestor_present,
        "skip_git_repo_check": skip_git_repo_check,
        "skip_git_repo_check_justification": (
            "bundle has no Git ancestor; bundle-integrity.json records relative file hashes"
            if skip_git_repo_check
            else "bundle has a Git ancestor; normal repository check remains enabled"
        ),
        "sandbox": "workspace-write in isolated bundle directory; bundle excludes repo, DB, raw downloads, and source object paths",
        "execution_surface": execution_surface_summary(),
        "network_egress_policy": network_egress_policy(args.provider),
        "redaction": "command omits manifest rows, review artifact contents, file IDs, object keys, and secrets",
    }
    (bundle_dir / "command.json").write_text(json.dumps(command_payload, indent=2, sort_keys=True), encoding="utf-8")
    integrity_payload = write_bundle_integrity(bundle_dir, args.provider)

    validation = validate_bundle(bundle_dir, safe_rows)
    summary_payload = {
        "kind": "locked_worker_bundle_summary",
        "status": "ready" if validation["status"] == "ok" and safe_rows else "empty" if not safe_rows else "error",
        "sanitized": True,
        "bundle": str(bundle_dir),
        "manifest": str(manifest_dst),
        "prompt": str(prompt),
        "jobs_requested": len(rows),
        "jobs_bundled": len(safe_rows),
        "by_collector_status": count_by(summaries, "status"),
        "by_lane": count_by(summaries, "extractor_lane"),
        "by_owner": count_by(summaries, "owner"),
        "provider": args.provider,
        "model": model,
        "command": str(bundle_dir / "command.json"),
        "manifest_sha256": file_sha256(manifest_dst),
        "integrity": {
            "path": str(bundle_dir / "bundle-integrity.json"),
            "sha256": file_sha256(bundle_dir / "bundle-integrity.json"),
            "file_count": integrity_payload["file_count"],
            "status": integrity_payload["status"],
        },
        "validation": validation,
        "redaction": "summary omits file IDs, filenames, source paths, object keys, source refs, extracted text, review artifact contents, and secrets",
    }
    summary_path = bundle_dir / "bundle-summary.json"
    summary_path.write_text(json.dumps(summary_payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps(summary_payload, indent=2, sort_keys=True))
    return 0 if summary_payload["status"] in {"ready", "empty"} else 1


if __name__ == "__main__":
    raise SystemExit(main())
