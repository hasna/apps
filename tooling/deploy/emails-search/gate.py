#!/usr/bin/env python3
"""Read-only exact-main CI and prior prepared-artifact admission."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess


def require(ok, code):
    if not ok:
        raise ValueError(code)


def gh(path):
    r = subprocess.run(["gh", "api", path], capture_output=True, timeout=60)
    require(r.returncode == 0 and len(r.stdout) < 8 * 1024 * 1024, "GITHUB_READ_REFUSED")
    return json.loads(r.stdout)


def admit_runs(runs, source):
    return any(r.get("head_sha") == source and r.get("head_branch") == "main" and r.get("event") == "push" and r.get("status") == "completed" and r.get("conclusion") == "success" and r.get("name") == "ci" and r.get("path") == ".github/workflows/ci.yml" for r in runs)


def admit_preparation(run, source):
    require(run.get("head_sha") == source and run.get("head_branch") == "main" and run.get("event") == "workflow_dispatch" and run.get("status") == "completed" and run.get("conclusion") == "success" and run.get("path") == ".github/workflows/emails-search-promotion.yml", "PREPARATION_RUN_NOT_TRUSTED")


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--phase", choices=["prepare", "promote", "rollback"], required=True)
    p.add_argument("--source", required=True)
    p.add_argument("--run", default="")
    p.add_argument("--prepared-sha256", default="")
    p.add_argument("--download", type=Path)
    args = p.parse_args()
    repo = os.environ.get("GITHUB_REPOSITORY")
    require(repo == "hasna/apps" and os.environ.get("GITHUB_REF") == "refs/heads/main" and os.environ.get("GITHUB_EVENT_NAME") == "workflow_dispatch", "MAIN_DISPATCH_ONLY")
    require(re.fullmatch(r"[0-9a-f]{40}", args.source) and args.source == os.environ.get("GITHUB_SHA"), "WORKFLOW_SOURCE")
    require(gh(f"repos/{repo}/git/ref/heads/main")["object"]["sha"] == args.source, "SUPERSEDED_SOURCE")
    runs = gh(f"repos/{repo}/actions/workflows/ci.yml/runs?branch=main&event=push&status=completed&head_sha={args.source}&per_page=100")["workflow_runs"]
    require(admit_runs(runs, args.source), "EXACT_MAIN_CI_REQUIRED")
    recipe = json.loads(Path(__file__).with_name("recipe.json").read_bytes())
    source = recipe["sourceCommit"]
    require(re.fullmatch(r"[0-9a-f]{40}", source), "OVERLAY_SOURCE")
    result = subprocess.run(["git", "merge-base", "--is-ancestor", source, args.source], capture_output=True)
    require(result.returncode == 0, "OVERLAY_PUBLIC_SOURCE_NOT_MERGED")
    if args.phase in {"promote", "rollback"}:
        require(re.fullmatch(r"[1-9][0-9]{0,19}", args.run) and re.fullmatch(r"[0-9a-f]{64}", args.prepared_sha256), "PREPARED_REVIEW_BINDING")
        admit_preparation(gh(f"repos/{repo}/actions/runs/{args.run}"), args.source)
        artifacts = gh(f"repos/{repo}/actions/runs/{args.run}/artifacts?per_page=100")["artifacts"]
        rows = [a for a in artifacts if a["name"] == "emails-search-prepared" and not a.get("expired")]
        require(len(rows) == 1, "PREPARED_ARTIFACT_COUNT")
        if args.download is not None:
            args.download.mkdir(mode=0o700)
            r = subprocess.run(["gh", "run", "download", args.run, "--repo", repo, "--name", "emails-search-prepared", "--dir", str(args.download)], capture_output=True, timeout=90)
            require(r.returncode == 0, "ARTIFACT_DOWNLOAD_REFUSED")
            path = args.download / "prepared.json"
            require(path.is_file() and not path.is_symlink() and path.stat().st_size < 65536 and hashlib.sha256(path.read_bytes()).hexdigest() == args.prepared_sha256, "PREPARED_ARTIFACT_DIGEST")
    print("Exact-main CI and promotion input admission passed")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        raise SystemExit("Emails gate refused: " + (str(error) if type(error) is ValueError else type(error).__name__))
