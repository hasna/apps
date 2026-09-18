#!/usr/bin/env python3
"""CI preparation only: build a synthetic candidate, push to a loopback registry,
then invoke the separate no-pull acceptance runner. No external image publication.
"""
import json
import os
import secrets
from pathlib import Path
import subprocess
import sys
import tempfile
import urllib.request

from contract import canonical, digest, require
from run import Docker, HERE, cleanup_owned_resources

ROOT = HERE.parents[2]
REGISTRY = "registry:2@sha256:46faa9a1ae6813194b53921a370f2f4f8c5e1aae228a89bceafef5847a6a3278"
POSTGRES = "docker.io/library/postgres@sha256:57c72fd2a128e416c7fcc499958864df5301e940bca0a56f58fddf30ffc07777"


def main():
    require(os.environ.get("GITHUB_ACTIONS") == "true", "CI_PREPARATION_ONLY")
    output = ROOT / "emails-pair-proof"
    output.mkdir(exist_ok=False)
    sha = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip()
    version = json.loads((ROOT / "apps/emails/package.json").read_bytes())["version"]
    with tempfile.TemporaryDirectory(prefix="emails-pair-ci-") as temporary:
        d = Docker(Path(temporary))
        registry = d.network+"-registry"
        resource_id = secrets.token_hex(10)
        try:
            d.call("pull", "--platform=linux/amd64", REGISTRY, timeout=180)
            d.call("pull", "--platform=linux/amd64", POSTGRES, timeout=180)
            d.containers.append(registry)
            d.call("run", "--detach", "--pull=never", "--name", registry, "--label", f"emails.pair={d.prefix}",
                   "--publish", "127.0.0.1::5000", "--env", "REGISTRY_HTTP_SECRET=synthetic-ci-registry",
                   "--tmpfs", "/var/lib/registry:rw,nosuid,size=2147483648", REGISTRY)
            row = d.json("inspect", registry)[0]
            binding = row["NetworkSettings"]["Ports"]["5000/tcp"]
            require(len(binding) == 1 and binding[0]["HostIp"] == "127.0.0.1", "REGISTRY_NOT_LOOPBACK")
            registry_base = "127.0.0.1:"+binding[0]["HostPort"]
            tag = registry_base+"/emails:fixture"
            # Build/pull are allowed here, never inside run.py. Build logs are
            # retained as an artifact; no ambient Docker credentials are inherited.
            with (output / "build.log").open("wb") as log:
                result = subprocess.run([d.binary, "--host", "unix:///var/run/docker.sock", "buildx", "build", "--load",
                                         "--platform=linux/amd64", "--provenance=false", "--sbom=false", "--build-arg", "VERSION="+version,
                                         "--build-arg", "REVISION="+sha, "--tag", tag, "--file", "apps/emails/Dockerfile", "apps/emails"],
                                        cwd=ROOT, env=d.env, stdout=log, stderr=subprocess.STDOUT, timeout=900, check=False)
            require(result.returncode == 0, "CI_IMAGE_BUILD_FAILED")
            d.call("push", tag, timeout=180)
            opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
            def read(path):
                request = urllib.request.Request("http://"+registry_base+path, headers={"Accept": "application/vnd.oci.image.manifest.v1+json,application/vnd.docker.distribution.manifest.v2+json"})
                with opener.open(request, timeout=10) as response:
                    raw = response.read(1024*1024+1)
                    require(len(raw) <= 1024*1024, "REGISTRY_METADATA_SIZE")
                    return raw
            manifest_raw = read("/v2/emails/manifests/fixture")
            manifest = json.loads(manifest_raw)
            config_raw = read("/v2/emails/blobs/"+manifest["config"]["digest"])
            require(digest(config_raw) == manifest["config"]["digest"], "REGISTRY_CONFIG_DIGEST")
            image = registry_base+"/emails@"+digest(manifest_raw)
            # Resolve the locally pushed immutable ref before entering the no-pull runner.
            d.call("pull", image, timeout=60)
            (output / "manifest.json").write_bytes(manifest_raw)
            (output / "config.json").write_bytes(config_raw)
            code = 'import {emailsSelfHostedMigrations as m} from "./apps/emails/src/server/self-hosted/migrations.ts";console.log(JSON.stringify(Object.fromEntries(m().map(x=>[x.id,x.checksum]))));'
            inventory = subprocess.check_output(["bun", "--no-env-file", "--no-install", "-e", code], cwd=ROOT, timeout=30)
            member = {"image": image, "source_sha": sha, "version": version,
                      "manifest_path": str(output / "manifest.json"), "config_path": str(output / "config.json")}
            pair = {"schema_version": 1, "api": {**member, "command": ["src/server/index.ts"]},
                    "worker": {**member, "command": ["src/server/index.ts", "ingest-worker"]},
                    "postgres": {"image": POSTGRES}, "migrations": json.loads(inventory)}
            (output / "pair.json").write_bytes(canonical(pair))
            (output / "provenance.json").write_bytes(canonical({"kind": "locally-built-ci-fixture", "source_sha": sha,
                                                               "manifest_digest": digest(manifest_raw), "config_digest": digest(config_raw),
                                                               "external_publication": False, "production_artifact_acceptance": False}))
            process = subprocess.Popen([sys.executable, "-B", str(HERE / "run.py"), "--pair", str(output / "pair.json"),
                                        "--output", str(output / "proof.json"), "--resource-id", resource_id], cwd=ROOT)
            try:
                return process.wait(timeout=600)
            except subprocess.TimeoutExpired:
                process.terminate()
                try:
                    process.wait(timeout=70)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=10)
                raise
        finally:
            try:
                cleanup_owned_resources(d, resource_id)
            finally:
                require(d.cleanup(), "CI_REGISTRY_CLEANUP_FAILED")


if __name__ == "__main__":
    raise SystemExit(main())
