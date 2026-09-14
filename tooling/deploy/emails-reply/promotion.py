#!/usr/bin/env python3
"""Eight-path reply overlay using the existing protected Emails mutation engine.

No new AWS actions or roles. The imported engine runs with this fixed recipe,
source admission and task transformation; original search defaults are unchanged.
"""
import copy
import gzip
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import re
import tarfile

ROOT = Path(__file__).resolve().parent

def sibling(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

engine = sibling("emails_reply_engine", ROOT.parent / "emails-search" / "promotion.py")
strict = sibling("emails_reply_patch", ROOT / "strict_patch.py")
require, encode, digest = engine.require, engine.encode, engine.digest
BASE = "sha256:b718e7b1eada661b9bf346d541a75d0ff86b2f84a205d6f8e8bb1e93be761b3e"
BASE_CONFIG = "sha256:98960b8c427848f8493bb841d5e9857f7de0d14164bc8b41738324d750ffc4d8"
BASE_SOURCE = "65b7210b9cca2b00b4ce6d3ce780b023762cb4e7"
PATHS = tuple(sorted(strict.ALLOWED_PATHS))
NEW_PATHS = strict.NEW_PATHS


def recipe():
    rules = json.loads((ROOT / "recipe.json").read_bytes())
    require(rules.get("schema") == "emails.reply-overlay-recipe.v1" and rules.get("baseImageDigest") == BASE and rules.get("baseConfigDigest") == BASE_CONFIG and rules.get("baseSourceCommit") == BASE_SOURCE, "RECIPE_BASE")
    require(len(rules["files"]) == 8 and {r["path"] for r in rules["files"]} == set(PATHS), "RECIPE_SCOPE")
    require(all((r["uid"],r["gid"],r["mode"]) == strict.EXPECTED_METADATA[r["path"]] and r["newFile"] == (r["path"] in NEW_PATHS) for r in rules["files"]), "RECIPE_METADATA")
    require(rules["patchFile"] == "reply-headers.patch" and hashlib.sha256((ROOT / rules["patchFile"]).read_bytes()).hexdigest() == rules["patchSha256"], "RECIPE_PATCH")
    require(rules.get("previousPatchSha256") == "849d5fad1065b837f64ee5caab5133abc13e5981293dd9b308fd176a97e93bf2", "SEARCH_CHAIN")
    mapping(rules.get("sesMessageIdDomains"))
    return rules


def base_reconciliation(rules):
    evidence = rules.get("baseReconciliation")
    require(isinstance(evidence, dict) and set(evidence) == {"preparedRunId","promotedRunId","preparedSha256","promotedSha256"}, "ACTUAL_SEARCH_RECONCILIATION_REQUIRED")
    for key in ("preparedRunId","promotedRunId"):
        require(isinstance(evidence[key], str) and re.fullmatch(r"[1-9][0-9]{0,19}", evidence[key]), "BASE_RUN_ID")
    for key in ("preparedSha256","promotedSha256"):
        require(isinstance(evidence[key], str) and re.fullmatch(r"[0-9a-f]{64}", evidence[key]), "BASE_ARTIFACT_HASH")
    return evidence


def mapping(value):
    if value is None:
        return None
    require(isinstance(value, str) and len(value.encode()) <= 8192, "SES_MAPPING_BOUND")
    try:
        parsed = json.loads(value)
    except (ValueError, TypeError):
        raise ValueError("SES_MAPPING_JSON") from None
    require(isinstance(parsed, dict) and 1 <= len(parsed) <= 32, "SES_MAPPING_SHAPE")
    for region, row in parsed.items():
        require(re.fullmatch(r"[a-z]{2}(?:-[a-z]+)+-\d", region) and isinstance(row, dict) and set(row) == {"domain","evidence_sha256","verified_at"}, "SES_MAPPING_SHAPE")
        domain = row["domain"]
        require(isinstance(domain, str) and len(domain) <= 253 and all(re.fullmatch(r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?", label) for label in domain.split(".")), "SES_MAPPING_DOMAIN")
        require(isinstance(row["evidence_sha256"], str) and re.fullmatch(r"[a-f0-9]{64}", row["evidence_sha256"]), "SES_MAPPING_EVIDENCE")
        require(isinstance(row["verified_at"], str) and re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z", row["verified_at"]), "SES_MAPPING_DATE")
        import datetime
        try:
            datetime.datetime.fromisoformat(row["verified_at"].replace("Z", "+00:00"))
        except ValueError:
            raise ValueError("SES_MAPPING_DATE") from None
    return value


def active_preimages(manifest, config, fetch=None):
    fetch = fetch or engine.blob
    require(1 <= len(manifest["layers"]) <= 32 and len(manifest["layers"]) == len(config["rootfs"]["diff_ids"]), "LAYER_COUNT")
    ancestors = {str(p) for n in PATHS for p in Path(n).parents if str(p) != "."}
    relevant, state, total = set(PATHS) | ancestors, {}, 0
    for index, desc in enumerate(manifest["layers"]):
        require(desc["mediaType"] == engine.OCI_LAYER, "LAYER_TYPE")
        with gzip.GzipFile(fileobj=io.BytesIO(fetch(desc))) as stream:
            data = stream.read(512 * 1024 * 1024 + 1)
        total += len(data)
        require(len(data) <= 512 * 1024 * 1024 and total <= 1024 * 1024 * 1024, "EXPANDED_LAYER_LIMIT")
        require(digest(data) == config["rootfs"]["diff_ids"][index], "LAYER_DIFF_ID_DRIFT")
        additions, removed = {}, []
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
    require(ancestors <= state.keys() and set(PATHS) - NEW_PATHS <= state.keys(), "MISSING_IMAGE_SOURCE")
    require(not (NEW_PATHS & state.keys()), "NEW_FILE_COLLISION")
    return {p: None if p in NEW_PATHS else state[p] for p in PATHS}


def make_layer(files):
    require(set(files) == set(PATHS), "OVERLAY_PATH_SCOPE")
    out = io.BytesIO()
    with tarfile.open(fileobj=out, mode="w", format=tarfile.USTAR_FORMAT) as tar:
        for path in sorted(files):
            data = files[path]
            require(isinstance(data, bytes) and 0 < len(data) <= 1024 * 1024, "OVERLAY_FILE_LIMIT")
            member = tarfile.TarInfo(path)
            member.size, member.mtime = len(data), 0
            member.uid, member.gid, member.mode = strict.EXPECTED_METADATA[path]
            tar.addfile(member, io.BytesIO(data))
    raw, compressed = out.getvalue(), io.BytesIO()
    with gzip.GzipFile(filename="", mode="wb", fileobj=compressed, mtime=0, compresslevel=9) as stream:
        stream.write(raw)
    return compressed.getvalue(), digest(raw)


def build(source):
    rules = recipe()
    manifest = engine.image_manifest(BASE)
    require(manifest["config"]["digest"] == BASE_CONFIG and manifest["config"]["mediaType"] == engine.OCI_CONFIG, "BASE_CONFIG_DRIFT")
    config = json.loads(engine.blob(manifest["config"]))
    require(config["architecture"] == "amd64" and config["os"] == "linux" and config["rootfs"]["type"] == "layers", "BASE_PLATFORM")
    pre = active_preimages(manifest, config)
    for row in rules["files"]:
        if row["newFile"]:
            require(pre[row["path"]] is None, "NEW_FILE_COLLISION")
        else:
            data, uid, gid, mode = pre[row["path"]]
            require((len(data),hashlib.sha256(data).hexdigest(),uid,gid,mode) == (row["beforeBytes"],row["beforeSha256"],row["uid"],row["gid"],row["mode"]), "PREIMAGE_DRIFT")
    files = strict.apply_reviewed_patch(rules, (ROOT / "reply-headers.patch").read_bytes(), {p: None if pre[p] is None else pre[p][0] for p in PATHS})
    layer, diff_id = make_layer(files)
    manifest, config_bytes = engine.append_overlay(manifest, config, layer, diff_id, source)
    receipt = {"baseImageDigest":BASE,"baseConfigDigest":BASE_CONFIG,"imageDigest":digest(encode(manifest)),"configDigest":digest(config_bytes),"layerDigest":digest(layer),"layerDiffId":diff_id,"baseLayers":manifest["layers"][:-1],"files":rules["files"],"runtimeConfigurationPreserved":True,"baseLayersPreserved":True,"imageExecuted":False,"dependencyInstallation":False}
    return manifest, config_bytes, layer, receipt


search_task_candidate = engine.task_candidate

def task_candidate(task, image_digest):
    # Reuse exact family/roles/startup/secret/pool admission, then preserve the
    # already-established search environment byte-for-byte.
    result = search_task_candidate(task, image_digest)
    original = next(c for c in task["containerDefinitions"] if c.get("name") == "emails")
    web = next(c for c in result["containerDefinitions"] if c.get("name") == "emails")
    rows = copy.deepcopy(original.get("environment", []))
    env = {r["name"]:r["value"] for r in rows}
    require(env.get("EMAILS_SEARCH_CONCURRENCY") == "8", "SEARCH_CAPACITY_DRIFT")
    name = "EMAILS_SES_MESSAGE_ID_DOMAINS"
    require(not any(r.get("name") == name for r in web.get("secrets", [])), "IDENTITY_SECRET_CONFLICT")
    if name in env:
        mapping(env[name])
    desired = mapping(recipe().get("sesMessageIdDomains"))
    if desired is not None:
        require(name not in env or env[name] == desired, "IDENTITY_MAPPING_DRIFT")
        if name not in env:
            rows.append({"name":name,"value":desired})
    web["environment"] = rows
    return result


engine.ROOT, engine.BASE, engine.BASE_CONFIG, engine.PATHS = ROOT, BASE, BASE_CONFIG, PATHS
engine.TAG_PREFIX = "reply-headers-"
engine.OVERLAY_DESCRIPTION = "hasna/apps reviewed Emails reply overlay "
engine.recipe, engine.build, engine.task_candidate = recipe, build, task_candidate
shared_prepare = engine.prepare

def prepare(source, out):
    base_reconciliation(recipe())
    return shared_prepare(source, out)

engine.prepare = prepare


if __name__ == "__main__":
    try:
        base_reconciliation(recipe())
        engine.main()
    except Exception as error:
        message = str(error) if type(error) is ValueError and re.fullmatch(r"[A-Z_]+(?::[a-z/-]+)?", str(error)) else type(error).__name__
        raise SystemExit("Emails reply promotion stopped: " + message + "; inspect retained metadata before retry or rollback")
