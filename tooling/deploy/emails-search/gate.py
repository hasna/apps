#!/usr/bin/env python3
"""Read-only exact-main CI and prior prepared-artifact admission."""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile

_spec = importlib.util.spec_from_file_location("emails_overlay_recipes", Path(__file__).with_name("recipes.py"))
recipes = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(recipes)


def require(ok, code):
    if not ok:
        raise ValueError(code)


def gh(path):
    r = subprocess.run(["gh", "api", path], capture_output=True, timeout=60)
    require(r.returncode == 0 and len(r.stdout) < 8 * 1024 * 1024, "GITHUB_READ_REFUSED")
    return json.loads(r.stdout)


def admit_runs(runs, source):
    return any(r.get("head_sha") == source and r.get("head_branch") == "main" and r.get("event") == "push" and r.get("status") == "completed" and r.get("conclusion") == "success" and r.get("name") == "ci" and r.get("path") == ".github/workflows/ci.yml" for r in runs)


def admit_preparation(run, source=None):
    prepared_source = run.get("head_sha")
    require(
        isinstance(prepared_source, str)
        and re.fullmatch(r"[0-9a-f]{40}", prepared_source)
        and (source is None or prepared_source == source)
        and run.get("head_branch") == "main"
        and run.get("event") == "workflow_dispatch"
        and run.get("status") == "completed"
        and run.get("conclusion") == "success"
        and run.get("path") == ".github/workflows/emails-search-promotion.yml",
        "PREPARATION_RUN_NOT_TRUSTED",
    )
    return prepared_source



def verify_prepared_file(path, expected_sha256, expected_source, purpose=recipes.SEARCH, run_id=None):
    identity = recipes.select(purpose)
    require(path.is_file() and not path.is_symlink() and path.stat().st_size < 65536, "PREPARED_ARTIFACT_DIGEST")
    raw = path.read_bytes()
    require(hashlib.sha256(raw).hexdigest() == expected_sha256, "PREPARED_ARTIFACT_DIGEST")
    try:
        prepared = json.loads(raw)
    except Exception:
        raise ValueError("PREPARED_ARTIFACT_JSON")
    require(
        prepared.get("schema") == identity["preparedSchema"]
        and prepared.get("sourceCommit") == expected_source,
        "PREPARED_RUN_SOURCE_DRIFT",
    )
    require(prepared.get("purpose") == (None if purpose == recipes.SEARCH else purpose), "PREPARED_PURPOSE")
    if purpose == recipes.DELIVERY:
        require(prepared.get("purpose") == purpose and prepared.get("producerRunId") == run_id, "PREPARED_PURPOSE_OR_RUN_DRIFT")
    return prepared


def download_and_verify_preparation(repo, run, destination, expected_sha256, expected_source, purpose=recipes.SEARCH):
    identity = recipes.select(purpose)
    destination.mkdir(mode=0o700)
    result = subprocess.run(
        ["gh", "run", "download", run, "--repo", repo, "--name", identity["artifact"] + "-prepared", "--dir", str(destination)],
        capture_output=True,
        timeout=90,
    )
    require(result.returncode == 0, "ARTIFACT_DOWNLOAD_REFUSED")
    path = destination / "prepared.json"
    verify_prepared_file(path, expected_sha256, expected_source, purpose, run)
    path.chmod(0o600)
    return path

def main():
    p = argparse.ArgumentParser()
    p.add_argument("--recipe", choices=recipes.NAMES, default=recipes.SEARCH)
    p.add_argument("--phase", choices=["prepare", "reconcile", "promote", "rollback"], required=True)
    p.add_argument("--source", required=True)
    p.add_argument("--run", default="")
    p.add_argument("--prepared-sha256", default="")
    p.add_argument("--download", type=Path)
    args = p.parse_args()
    identity = recipes.select(args.recipe)
    repo = os.environ.get("GITHUB_REPOSITORY")
    require(repo == "hasna/apps" and os.environ.get("GITHUB_REF") == "refs/heads/main" and os.environ.get("GITHUB_EVENT_NAME") == "workflow_dispatch", "MAIN_DISPATCH_ONLY")
    require(re.fullmatch(r"[0-9a-f]{40}", args.source) and args.source == os.environ.get("GITHUB_SHA"), "WORKFLOW_SOURCE")
    require(gh(f"repos/{repo}/git/ref/heads/main")["object"]["sha"] == args.source, "SUPERSEDED_SOURCE")
    runs = gh(f"repos/{repo}/actions/workflows/ci.yml/runs?branch=main&event=push&status=completed&head_sha={args.source}&per_page=100")["workflow_runs"]
    require(admit_runs(runs, args.source), "EXACT_MAIN_CI_REQUIRED")
    recipe = json.loads(Path(__file__).with_name(identity["file"]).read_bytes())
    for source in recipe.get("sourceCommits", [recipe["sourceCommit"]]):
        require(re.fullmatch(r"[0-9a-f]{40}", source), "OVERLAY_SOURCE")
        result = subprocess.run(["git", "merge-base", "--is-ancestor", source, args.source], capture_output=True)
        require(result.returncode == 0, "OVERLAY_PUBLIC_SOURCE_NOT_MERGED")
    if args.phase in {"reconcile", "promote", "rollback"}:
        require(re.fullmatch(r"[1-9][0-9]{0,19}", args.run) and re.fullmatch(r"[0-9a-f]{64}", args.prepared_sha256), "PREPARED_REVIEW_BINDING")
        prepared_source = admit_preparation(
            gh(f"repos/{repo}/actions/runs/{args.run}"),
            None if args.phase == "reconcile" else args.source,
        )
        if args.phase == "reconcile":
            require(
                subprocess.run(
                    ["git", "merge-base", "--is-ancestor", prepared_source, args.source],
                    capture_output=True,
                ).returncode == 0,
                "PREPARATION_SOURCE_NOT_ANCESTOR",
            )
        artifacts = gh(f"repos/{repo}/actions/runs/{args.run}/artifacts?per_page=100")["artifacts"]
        rows = [a for a in artifacts if a["name"] == identity["artifact"] + "-prepared" and not a.get("expired")]
        require(len(rows) == 1, "PREPARED_ARTIFACT_COUNT")
        if args.download is not None:
            download_and_verify_preparation(repo, args.run, args.download, args.prepared_sha256, prepared_source, args.recipe)
        else:
            with tempfile.TemporaryDirectory(prefix="emails-prepared-gate-") as temporary:
                download_and_verify_preparation(repo, args.run, Path(temporary) / "artifact", args.prepared_sha256, prepared_source, args.recipe)
    print("Exact-main CI and promotion input admission passed")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        raise SystemExit("Emails gate refused: " + (str(error) if type(error) is ValueError else type(error).__name__))
