"""Conservative, read-only migration-input admission for immutable OCI images.

No image code is evaluated. Equal reviewed definition inputs permit an image-only
deployment; any byte change (including unrelated auth-bundle edits) needs the
separate migration-aware path. A historical overlay's git source is not evidence
of the definitions in its base image.
"""
import gzip
import io
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import subprocess
import tarfile
import tempfile

ROOT = Path(__file__).resolve().parent
CORE = "app/src/server/self-hosted/migrations.ts"
STORAGE = "app/src/storage-kit/"
CONTRACTS = "app/node_modules/@hasna/contracts/"
AUTH = CONTRACTS + "dist/auth/index.js"
PACKAGE = CONTRACTS + "package.json"
APP_PACKAGE = "app/package.json"
MODULES = (CORE, *(STORAGE + name + ".ts" for name in ("index", "migrations", "tls", "query", "pool", "health")), AUTH)
FILES = {*MODULES, PACKAGE, APP_PACKAGE}
ANCESTORS = {str(parent) for name in FILES for parent in PurePosixPath(name).parents if str(parent) != "."}
# Bun resolves a .js import to .ts only when the .js path is absent. Nearest
# node_modules and package boundaries must not redirect the fixed auth import.
FORBIDDEN = {name[:-3] + ".js" for name in MODULES if name.endswith(".ts")} | {
    prefix + "/node_modules"
    for prefix in ("app/src", "app/src/server", "app/src/server/self-hosted")
} | {prefix + "/package.json" for prefix in ANCESTORS if prefix.startswith("app/src")}
# Bun honors tsconfig path aliases for package imports. No image-local resolver
# configuration may replace the fixed module routing checked below.
FORBIDDEN |= {(prefix + "/" if prefix else "") + config
              for prefix in ANCESTORS | {""}
              for config in ("tsconfig.json", "jsconfig.json", "bunfig.toml")}
RELEVANT = FILES | ANCESTORS | FORBIDDEN
MAX_BLOB = 128 * 1024 * 1024
MAX_EXPANDED = 512 * 1024 * 1024
MAX_TOTAL = 1024 * 1024 * 1024
MAX_FILE = 4 * 1024 * 1024
MEDIA_FAMILIES = {
    "application/vnd.oci.image.manifest.v1+json": (
        "application/vnd.oci.image.config.v1+json", "application/vnd.oci.image.layer.v1.tar+gzip"),
    "application/vnd.docker.distribution.manifest.v2+json": (
        "application/vnd.docker.container.image.v1+json", "application/vnd.docker.image.rootfs.diff.tar.gzip"),
}
IMPORTS = {
    CORE: {"../../storage-kit/index.js", "@hasna/contracts/auth"},
    STORAGE + "index.ts": {"./tls.js", "./query.js", "./pool.js", "./migrations.js", "./health.js"},
    STORAGE + "migrations.ts": {"node:crypto"},
    STORAGE + "tls.ts": {"node:fs"},
    STORAGE + "query.ts": set(),
    STORAGE + "pool.ts": {"pg", "./tls.js"},
    STORAGE + "health.ts": {"./migrations.js"},
    AUTH: {"crypto"},
}


def require(ok, code):
    if not ok:
        raise ValueError(code)


def read_manifest(image_digest, promotion):
    # The historical overlay reader accepts OCI only. Current Docker builds also
    # emit schema-2 Docker manifests; retain their original bytes/digest rather
    # than converting media types or trusting a translated registry response.
    result = promotion.aws("ecr", "batch-get-image", "--repository-name", promotion.REPO, "--image-ids", "imageDigest=" + promotion.sha(image_digest))
    require(not result.get("failures") and len(result.get("images", [])) == 1, "MIGRATION_IMAGE_UNAVAILABLE")
    row = result["images"][0]
    raw = row["imageManifest"].encode()
    require(promotion.digest(raw) == image_digest and row["imageId"]["imageDigest"] == image_digest, "MIGRATION_MANIFEST_DIGEST")
    manifest = json.loads(raw)
    require(manifest.get("schemaVersion") == 2 and manifest.get("mediaType") in MEDIA_FAMILIES, "MIGRATION_MANIFEST_TYPE")
    require(set(manifest) == {"schemaVersion", "mediaType", "config", "layers"}, "MIGRATION_MANIFEST_FIELDS")
    return manifest


def verified_blob(descriptor, promotion):
    require(isinstance(descriptor, dict), "MIGRATION_BLOB_DESCRIPTOR")
    promotion.sha(descriptor.get("digest"))
    size = descriptor.get("size")
    require(type(size) is int and 0 < size <= MAX_BLOB, "MIGRATION_BLOB_LIMIT")
    data = promotion.blob(descriptor)
    require(len(data) == size and promotion.digest(data) == descriptor["digest"], "MIGRATION_BLOB_DIGEST")
    return data


def active_inputs(manifest, config, promotion):
    """Read selected regular files in memory; never extract tar paths to disk."""
    layers = manifest.get("layers")
    rootfs = config.get("rootfs", {})
    require(config.get("architecture") == "amd64" and config.get("os") == "linux" and rootfs.get("type") == "layers", "MIGRATION_IMAGE_PLATFORM")
    diff_ids = rootfs.get("diff_ids")
    require(isinstance(layers, list) and 1 <= len(layers) <= 32 and isinstance(diff_ids, list) and len(layers) == len(diff_ids), "MIGRATION_LAYER_COUNT")
    state = {}
    total = 0
    for index, descriptor in enumerate(layers):
        require(descriptor.get("mediaType") == MEDIA_FAMILIES[manifest["mediaType"]][1], "MIGRATION_LAYER_TYPE")
        compressed = verified_blob(descriptor, promotion)
        with gzip.GzipFile(fileobj=io.BytesIO(compressed)) as stream:
            raw = stream.read(MAX_EXPANDED + 1)
        total += len(raw)
        require(len(raw) <= MAX_EXPANDED and total <= MAX_TOTAL, "MIGRATION_LAYER_EXPANSION")
        require(promotion.digest(raw) == promotion.sha(diff_ids[index]), "MIGRATION_DIFF_ID")
        additions, removed = {}, set()
        with tarfile.open(fileobj=io.BytesIO(raw), mode="r:") as archive:
            for count, member in enumerate(archive, 1):
                require(count <= 100000, "MIGRATION_LAYER_ENTRY_LIMIT")
                name = member.name.removeprefix("./").rstrip("/")
                if name in ("", "."):
                    require(member.isdir() and member.name in (".", "./"), "MIGRATION_UNSAFE_PATH")
                    continue
                require(name and not name.startswith("/") and all(part not in ("", ".", "..") for part in name.split("/")), "MIGRATION_UNSAFE_PATH")
                base = name.rsplit("/", 1)[-1]
                parent = name.rsplit("/", 1)[0] if "/" in name else ""
                if base.startswith(".wh."):
                    require(member.isfile() and member.size == 0, "MIGRATION_WHITEOUT_TYPE")
                    if base == ".wh..wh..opq":
                        removed.update(path for path in RELEVANT if not parent or path.startswith(parent + "/"))
                    else:
                        target = (parent + "/" if parent else "") + base[4:]
                        require(base != ".wh.", "MIGRATION_WHITEOUT_TARGET")
                        removed.update(path for path in RELEVANT if path == target or path.startswith(target + "/"))
                elif name in RELEVANT or any(name.startswith(prefix + "/") for prefix in FORBIDDEN):
                    require(name not in additions, "MIGRATION_DUPLICATE_PATH")
                    require(name not in FORBIDDEN and not any(name.startswith(prefix + "/") for prefix in FORBIDDEN), "MIGRATION_RESOLUTION_SHADOW")
                    if name in ANCESTORS:
                        require(member.isdir(), "MIGRATION_ANCESTOR_LINK_OR_FILE")
                        additions[name] = None
                    else:
                        require(member.isfile() and 0 <= member.size <= MAX_FILE, "MIGRATION_INPUT_LINK_OR_LIMIT")
                        data = archive.extractfile(member).read(MAX_FILE + 1)
                        require(len(data) == member.size, "MIGRATION_INPUT_SIZE")
                        additions[name] = data
        # OCI whiteouts affect lower layers only, independent of tar ordering.
        for name in removed:
            state.pop(name, None)
        state.update(additions)
    require(FILES | ANCESTORS <= state.keys(), "MISSING_MIGRATION_INPUT")
    return {name: state[name] for name in FILES}


def validate_routing(files):
    app = json.loads(files[APP_PACKAGE])
    require(app.get("name") == "@hasna/emails" and app.get("type") == "module" and "imports" not in app and "browser" not in app, "MIGRATION_APP_PACKAGE")
    package = json.loads(files[PACKAGE])
    require(package.get("name") == "@hasna/contracts" and package.get("type") == "module", "MIGRATION_AUTH_PACKAGE")
    auth_export = package.get("exports", {}).get("./auth")
    require(auth_export == {"types": "./dist/auth/index.d.ts", "import": "./dist/auth/index.js"}, "MIGRATION_AUTH_EXPORT")
    # Use Bun's parser, never an import/eval of image content. The trusted helper
    # has an empty environment and isolated cwd (no image config or credentials).
    bun = shutil.which("bun")
    require(bun is not None, "MIGRATION_PARSER_UNAVAILABLE")
    payload = json.dumps({name: files[name].decode("utf-8") for name in MODULES}).encode()
    with tempfile.TemporaryDirectory(prefix="emails-migration-parser-") as directory:
        result = subprocess.run([bun, "--no-env-file", str(ROOT / "scan_migration_imports.ts")], input=payload, capture_output=True, cwd=directory, env={"PATH": os.path.dirname(bun)}, timeout=30)
    require(result.returncode == 0 and len(result.stdout) <= 65536, "MIGRATION_PARSE_REFUSED")
    imports = json.loads(result.stdout)
    require(set(imports) == set(MODULES), "MIGRATION_PARSE_SCOPE")
    for name, expected in IMPORTS.items():
        rows = imports[name]
        require(isinstance(rows, list) and all(row.get("kind") == "import-statement" for row in rows), "MIGRATION_DYNAMIC_DEPENDENCY")
        require({row.get("path") for row in rows} == expected, "MIGRATION_UNREVIEWED_DEPENDENCY")
    return auth_export


def inspect(image_digest, promotion):
    # Shared audited ECR transport/blob primitives retain their bounds and HTTPS
    # origin verification; this reader supports the two explicit image families.
    promotion.sha(image_digest)
    manifest = read_manifest(image_digest, promotion)
    require(manifest.get("config", {}).get("mediaType") == MEDIA_FAMILIES[manifest["mediaType"]][0], "MIGRATION_CONFIG_TYPE")
    config = json.loads(verified_blob(manifest["config"], promotion))
    files = active_inputs(manifest, config, promotion)
    routing = validate_routing(files)
    inputs = {name: promotion.digest(files[name]) for name in MODULES}
    # Package version/description do not affect resolution; bind exact auth
    # export routing separately and reject every additional condition.
    inputs[PACKAGE + "#exports/auth"] = promotion.digest(promotion.encode(routing))
    inputs[APP_PACKAGE + "#migration-routing"] = promotion.digest(promotion.encode({"name": "@hasna/emails", "type": "module", "imports": None, "browser": None}))
    return {"imageDigest": image_digest, "configDigest": manifest["config"]["digest"], "definitionInputs": inputs, "definitionInputsDigest": promotion.digest(promotion.encode(inputs)), "layersVerified": len(manifest["layers"])}


def admit(deployed_digest, candidate_digest, promotion, receipt_path=None):
    deployed = inspect(deployed_digest, promotion)
    candidate = inspect(candidate_digest, promotion)
    changed = deployed["definitionInputs"] != candidate["definitionInputs"]
    evidence = {"schema": "emails.image-migration-admission.v1", "deployed": deployed, "candidate": candidate, "comparison": "exact-definition-input-bytes", "migrationDefinitionChanged": changed, "imageCodeExecuted": False}
    if receipt_path is not None:
        promotion.save(receipt_path, evidence)
    require(not changed, "MIGRATION_DEFINITION_DRIFT")
    return evidence
