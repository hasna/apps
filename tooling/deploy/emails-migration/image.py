#!/usr/bin/env python3
"""Inspect one immutable current Emails image; never registers or launches a task."""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[3]
EMAILS = ROOT / "apps" / "emails"
PROMOTION = ROOT / "tooling" / "deploy" / "emails-search" / "promotion.py"
_spec = importlib.util.spec_from_file_location("emails_image_promotion", PROMOTION)
promotion = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(promotion)
admission = promotion.migration_module()


def require(ok, code):
    if not ok:
        raise ValueError(code)


def prepare(source, image_digest, emails=EMAILS):
    require(re.fullmatch(r"[0-9a-f]{40}", source or ""), "SOURCE_COMMIT")
    promotion.sha(image_digest)
    version = json.loads((emails / "package.json").read_bytes()).get("version")
    require(isinstance(version, str) and re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+", version), "EMAILS_VERSION")
    require(promotion.aws("sts", "get-caller-identity").get("Account") == promotion.ACCOUNT, "AWS_ACCOUNT")
    inspected = admission.inspect(image_digest, promotion)
    require(inspected.get("sourceRevision") == source and inspected.get("imageVersion") == version
            and inspected.get("imageDigest") == image_digest, "IMAGE_SOURCE_OR_VERSION")
    inputs = inspected.get("definitionInputs")
    require(isinstance(inputs, dict), "IMAGE_DEFINITION_INPUTS")
    local = {}
    for name in admission.MODULES:
        if not name.startswith("app/src/"):
            continue
        path = emails / name.removeprefix("app/")
        require(path.is_file() and not path.is_symlink() and path.stat().st_size < admission.MAX_FILE,
                "SOURCE_MODULE_UNAVAILABLE")
        local[name] = promotion.digest(path.read_bytes())
        require(inputs.get(name) == local[name], "IMAGE_SOURCE_MODULE_MISMATCH")
    for field in ("configDigest", "definitionInputsDigest"):
        promotion.sha(inspected.get(field))
    require(type(inspected.get("layersVerified")) is int and inspected["layersVerified"] >= 1,
            "IMAGE_LAYERS_NOT_VERIFIED")
    return {
        "schema": "emails.current-migration-image.v1",
        "sourceCommit": source,
        "imageVersion": version,
        "imageRepository": promotion.REPOSITORY,
        "imageDigest": image_digest,
        "configDigest": inspected["configDigest"],
        "definitionInputsDigest": inspected["definitionInputsDigest"],
        "definitionInputs": inputs,
        "sourceModules": local,
        "layersVerified": inspected["layersVerified"],
        "taskRegistered": False,
        "taskLaunched": False,
        "serviceUpdated": False,
        "databaseMutated": False,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True)
    parser.add_argument("--image-digest", required=True)
    parser.add_argument("--out", required=True, type=Path)
    args = parser.parse_args()
    require(os.environ.get("GITHUB_REPOSITORY") == "hasna/apps"
            and os.environ.get("GITHUB_REF") == "refs/heads/main"
            and os.environ.get("GITHUB_EVENT_NAME") == "workflow_dispatch"
            and os.environ.get("GITHUB_SHA") == args.source, "MAIN_DISPATCH_ONLY")
    os.umask(0o077)
    receipt = prepare(args.source, args.image_digest)
    args.out.mkdir(mode=0o700)
    promotion.save(args.out / "image.json", receipt)
    print("Immutable Emails migration image inspected and recorded")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        message = str(error) if type(error) is ValueError and re.fullmatch(r"[A-Z0-9_:-]+", str(error)) else type(error).__name__
        raise SystemExit("Emails migration image preparation refused: " + message)
