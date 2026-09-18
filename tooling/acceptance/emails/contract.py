"""Closed, credential-free inputs for an isolated image acceptance run."""
import hashlib
import json
import re
from pathlib import Path


class Refused(ValueError):
    pass


def require(condition, code):
    if not condition:
        raise Refused(code)


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()


def digest(raw):
    return "sha256:" + hashlib.sha256(raw).hexdigest()


def _pairs(items):
    result = {}
    for key, value in items:
        require(key not in result, "DUPLICATE_JSON_KEY")
        result[key] = value
    return result


def loads(raw):
    require(isinstance(raw, bytes) and len(raw) <= 1024 * 1024, "INPUT_SIZE")
    try:
        return json.loads(raw, object_pairs_hook=_pairs,
                          parse_constant=lambda _: (_ for _ in ()).throw(Refused("NONFINITE_JSON")))
    except (UnicodeError, json.JSONDecodeError):
        raise Refused("INVALID_JSON") from None


def keys(value, fields):
    require(isinstance(value, dict) and set(value) == set(fields.split()), "UNEXPECTED_FIELDS")


def image_reference(value):
    # Registry names are metadata only: the runner never pulls or logs in.
    require(isinstance(value, str) and len(value) <= 512 and re.fullmatch(
        r"[a-z0-9][a-z0-9.:-]*(?:/[a-z0-9][a-z0-9._-]*)+@sha256:[0-9a-f]{64}", value), "IMMUTABLE_IMAGE_REQUIRED")
    require(":" not in value.split("/")[-1].split("@")[0], "IMAGE_TAG_FORBIDDEN")


def canonical_reference(value):
    require(isinstance(value, str) and value.count("@") == 1, "IMAGE_REFERENCE")
    repository, content_digest = value.split("@")
    first = repository.split("/")[0]
    if "/" not in repository:
        repository = "docker.io/library/"+repository
    elif "." not in first and ":" not in first and first != "localhost":
        repository = "docker.io/"+repository
    if repository.startswith("index.docker.io/"):
        repository = "docker.io/"+repository[len("index.docker.io/"):]
    if repository.startswith("docker.io/") and repository.count("/") == 1:
        repository = "docker.io/library/"+repository[len("docker.io/"):]
    return repository+"@"+content_digest


def has_repo_digest(image, reference):
    refs = image.get("RepoDigests") or []
    require(isinstance(refs, list), "IMAGE_REPO_DIGESTS")
    return canonical_reference(reference) in [canonical_reference(ref) for ref in refs]


def same_execution_config(stored, inspected):
    """Docker inspect is an API projection, not the original hashed OCI JSON.

    Linux does not use the legacy ArgsEscaped field. Docker may omit it and
    inject empty container-era attach fields. Compare every execution setting,
    allowing only those named inert serialization defaults. The raw config
    bytes must independently hash to the actual local image ID.
    """
    require(isinstance(stored, dict) and isinstance(inspected, dict), "IMAGE_CONFIG_DRIFT")
    fields = {"User", "Env", "Entrypoint", "Cmd", "Volumes", "WorkingDir", "Labels", "ExposedPorts", "Healthcheck", "StopSignal", "OnBuild", "Shell"}
    defaults = {"Hostname": "", "Domainname": "", "AttachStdin": False, "AttachStdout": False, "AttachStderr": False,
                "Tty": False, "OpenStdin": False, "StdinOnce": False, "Image": ""}
    def normalized(field, value):
        if value is None and field in ("OnBuild", "Shell"):
            return []
        return value
    for field in fields:
        require(normalized(field, stored.get(field)) == normalized(field, inspected.get(field)), "IMAGE_EXECUTION_CONFIG_DRIFT")
    for config in (stored, inspected):
        for field, value in config.items():
            if field in fields:
                continue
            if field == "ArgsEscaped":
                require(type(value) is bool, "IMAGE_CONFIG_ARGS_ESCAPED")
            else:
                require(field in defaults and value == defaults[field], "IMAGE_CONFIG_UNSUPPORTED_FIELD")


COMMANDS = {"api": ["src/server/index.ts"], "worker": ["src/server/index.ts", "ingest-worker"]}
ENTRYPOINT = ["/usr/local/bin/bun"]


def pair_input(raw):
    value = loads(raw)
    keys(value, "schema_version api worker postgres migrations")
    require(type(value["schema_version"]) is int and value["schema_version"] == 1, "INPUT_VERSION")
    for component in COMMANDS:
        member = value[component]
        keys(member, "image source_sha version command manifest_path config_path")
        image_reference(member["image"])
        for field in ("manifest_path", "config_path"):
            require(isinstance(member[field], str) and len(member[field]) <= 4096 and Path(member[field]).is_absolute(), "ARTIFACT_PATH")
        require(isinstance(member["source_sha"], str) and re.fullmatch("[0-9a-f]{40}", member["source_sha"]), "SOURCE_SHA")
        require(isinstance(member["version"], str) and re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+(?:[-+][A-Za-z0-9.-]+)?", member["version"]), "VERSION")
        require(member["command"] == COMMANDS[component], "COMMAND_SCOPE")
    keys(value["postgres"], "image")
    image_reference(value["postgres"]["image"])
    inventory = value["migrations"]
    require(isinstance(inventory, dict) and 1 <= len(inventory) <= 256, "MIGRATION_INVENTORY")
    for name, checksum in inventory.items():
        require(isinstance(name, str) and re.fullmatch(r"[A-Za-z0-9_.-]{1,128}", name), "MIGRATION_ID")
        require(isinstance(checksum, str) and re.fullmatch(r"sha256:[0-9a-f]{64}", checksum), "MIGRATION_CHECKSUM")
    return value


def inspected_image(component, expected, rows, manifest_raw, config_raw):
    require(isinstance(rows, list) and len(rows) == 1 and isinstance(rows[0], dict), "IMAGE_INSPECTION")
    image = rows[0]
    require(has_repo_digest(image, expected["image"]), "IMAGE_MANIFEST_DRIFT")
    require(image.get("Os") == "linux" and image.get("Architecture") == "amd64", "IMAGE_PLATFORM")
    require(isinstance(image.get("Id"), str) and re.fullmatch(r"sha256:[0-9a-f]{64}", image["Id"]), "IMAGE_CONFIG_ID")
    config = image.get("Config")
    require(isinstance(config, dict), "IMAGE_CONFIG")
    manifest, stored = loads(manifest_raw), loads(config_raw)
    families = {"application/vnd.oci.image.manifest.v1+json": ("application/vnd.oci.image.config.v1+json", "application/vnd.oci.image.layer.v1.tar+gzip"),
                "application/vnd.docker.distribution.manifest.v2+json": ("application/vnd.docker.container.image.v1+json", "application/vnd.docker.image.rootfs.diff.tar.gzip")}
    require(isinstance(manifest, dict) and manifest.get("schemaVersion") == 2 and manifest.get("mediaType") in families, "IMAGE_MANIFEST_FORMAT")
    require(digest(manifest_raw) == expected["image"].split("@")[1], "IMAGE_MANIFEST_BYTES")
    cfg_type, layer_type = families[manifest["mediaType"]]
    descriptor = manifest.get("config") or {}
    require(descriptor.get("digest") == digest(config_raw) == image["Id"] and descriptor.get("size") == len(config_raw)
            and descriptor.get("mediaType") == cfg_type, "IMAGE_CONFIG_BYTES")
    require(isinstance(stored, dict) and stored.get("os") == "linux"
            and stored.get("architecture") == "amd64", "IMAGE_CONFIG_DRIFT")
    same_execution_config(stored.get("config"), config)
    layers = manifest.get("layers")
    diff_ids = (stored.get("rootfs") or {}).get("diff_ids")
    require(isinstance(layers, list) and 1 <= len(layers) <= 128 and isinstance(diff_ids, list) and len(layers) == len(diff_ids), "IMAGE_LAYER_BOUNDS")
    require(stored["rootfs"].get("type") == "layers" and image.get("RootFS") == {"Type": "layers", "Layers": diff_ids}, "IMAGE_LAYER_DRIFT")
    for layer, diff_id in zip(layers, diff_ids):
        require(isinstance(layer, dict) and layer.get("mediaType") == layer_type and type(layer.get("size")) is int
                and 0 < layer["size"] <= 1024**3 and isinstance(layer.get("digest"), str)
                and re.fullmatch(r"sha256:[0-9a-f]{64}", layer["digest"]) and isinstance(diff_id, str)
                and re.fullmatch(r"sha256:[0-9a-f]{64}", diff_id) and not layer.get("urls"), "IMAGE_LAYER_DESCRIPTOR")
    require(config.get("WorkingDir") == "/app" and config.get("User") in ("1000", "1000:1000"), "IMAGE_RUNTIME_SCOPE")
    require(config.get("Entrypoint") == ENTRYPOINT and config.get("Cmd") in list(COMMANDS.values()), "IMAGE_ENTRYPOINT")
    labels = config.get("Labels") or {}
    require(labels.get("org.opencontainers.image.revision") == expected["source_sha"], "IMAGE_SOURCE")
    require(labels.get("org.opencontainers.image.version") == expected["version"], "IMAGE_VERSION")
    require(labels.get("org.opencontainers.image.source") == "https://github.com/hasna/apps", "IMAGE_SOURCE_REPOSITORY")
    require(config.get("OnBuild") in (None, []), "IMAGE_ONBUILD")
    # Never expose arbitrary image environment values in a proof or diagnostic.
    allowed_env = {"HOME", "PATH", "EMAILS_DATABASE_CA_FILE", "NODE_EXTRA_CA_CERTS", "NODE_ENV", "HOST", "PORT"}
    env = config.get("Env") or []
    require(isinstance(env, list) and all(isinstance(row, str) and "=" in row and row.split("=", 1)[0] in allowed_env for row in env), "IMAGE_ENVIRONMENT")
    require(set(config.get("Volumes") or {}) <= {"/tmp"}, "IMAGE_VOLUMES")
    return {"manifest_digest": expected["image"].split("@", 1)[1], "config_id": image["Id"],
            "platform": "linux/amd64", "source_sha": expected["source_sha"], "version": expected["version"],
            "resolved_command": ENTRYPOINT + COMMANDS[component],
            "entrypoint_sha256": digest(canonical(ENTRYPOINT + COMMANDS[component])),
            "layer_descriptors": layers, "rootfs_diff_ids": diff_ids,
            "image_configuration_sha256": digest(canonical(config))}


def inspected_container(rows, admitted, network, name):
    require(isinstance(rows, list) and len(rows) == 1, "CONTAINER_INSPECTION")
    row = rows[0]
    require(row.get("Name") == "/"+name and row.get("Image") == admitted["config_id"], "CONTAINER_IMAGE_DRIFT")
    require(row.get("Path") == ENTRYPOINT[0] and row.get("Args") == admitted["resolved_command"][1:], "CONTAINER_COMMAND_DRIFT")
    host = row.get("HostConfig") or {}
    require(host.get("NetworkMode") == network and host.get("Privileged") is False and host.get("ReadonlyRootfs") is True, "CONTAINER_ISOLATION")
    require(set((row.get("NetworkSettings") or {}).get("Networks") or {}) == {network}, "CONTAINER_NETWORK_DRIFT")
    require(host.get("PortBindings") in (None, {}) and host.get("PidMode") in (None, "") and host.get("IpcMode") == "private", "CONTAINER_HOST_ACCESS")
    require(host.get("CapDrop") == ["ALL"] and not host.get("CapAdd") and "no-new-privileges" in (host.get("SecurityOpt") or []), "CONTAINER_CAPABILITIES")
    require(all(m.get("Type") == "tmpfs" or m.get("Type") == "bind" and m.get("Destination") == "/fixtures/fixture.pem" and m.get("RW") is False
                for m in row.get("Mounts", [])), "CONTAINER_MOUNT_SCOPE")
    return row
