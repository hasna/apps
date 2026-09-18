#!/usr/bin/env python3
"""Synthetic OCI regressions; no registry, AWS, or database access."""
import copy
import gzip
import importlib.util
import io
import json
from pathlib import Path
import tarfile
import tempfile
import unittest
import os
import shutil
import subprocess
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("deploy", ROOT / "deploy.py")
deploy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(deploy)
p = deploy.promotion


def layer(entries):
    stream = io.BytesIO()
    with tarfile.open(fileobj=stream, mode="w") as archive:
        for name, value in entries:
            row = tarfile.TarInfo(name)
            if value is None:
                row.type = tarfile.DIRTYPE
            elif isinstance(value, tuple):
                row.type, row.linkname = value
            else:
                row.size = len(value)
            archive.addfile(row, io.BytesIO(value) if isinstance(value, bytes) else None)
    raw = stream.getvalue()
    return gzip.compress(raw), p.digest(raw)


def fixture_files():
    # Ordinary image files only; intentionally tiny, generated fixtures.
    return {
        "app/package.json": b'{"name":"@hasna/emails","type":"module"}',
        "app/src/server/self-hosted/migrations.ts": b'import { defineMigration } from "../../storage-kit/index.js"; import { apiKeyMigrations } from "@hasna/contracts/auth"; export const migrations = [defineMigration("core", "SELECT 1"), ...apiKeyMigrations()];',
        "app/src/storage-kit/index.ts": b'export * from "./tls.js"; export * from "./query.js"; export * from "./pool.js"; export * from "./migrations.js"; export * from "./health.js";',
        "app/src/storage-kit/migrations.ts": b'import {createHash} from "node:crypto"; export function defineMigration(id, sql) { return {id, sql}; }',
        "app/src/storage-kit/tls.ts": b'import {readFileSync} from "node:fs"; export const sslMode = "require";',
        "app/src/storage-kit/query.ts": b'export const query = 1;',
        "app/src/storage-kit/pool.ts": b'import pg from "pg"; import {tls} from "./tls.js";',
        "app/src/storage-kit/health.ts": b'import {MigrationLedger} from "./migrations.js";',
        "app/node_modules/@hasna/contracts/package.json": json.dumps({"name": "@hasna/contracts", "type": "module", "exports": {"./auth": {"types": "./dist/auth/index.d.ts", "import": "./dist/auth/index.js"}}}).encode(),
        "app/node_modules/@hasna/contracts/dist/auth/index.js": b'import {createHash} from "crypto"; export function apiKeyMigrations() { return [{id:"auth",sql:"SELECT 2"}]; }',
    }


class Registry:
    def __init__(self):
        self.manifests = {}
        self.blobs = {}

    def image(self, files=None, extra_layers=(), docker=False):
        files = fixture_files() if files is None else files
        dirs = {str(parent) for path in files for parent in Path(path).parents if str(parent) != "."}
        layers = [layer([(name, None) for name in sorted(dirs)] + list(files.items())), *extra_layers]
        descriptors = []
        for data, _ in layers:
            digest = p.digest(data)
            self.blobs[digest] = data
            descriptors.append({"mediaType": "application/vnd.docker.image.rootfs.diff.tar.gzip" if docker else p.OCI_LAYER, "digest": digest, "size": len(data)})
        config = p.encode({"architecture": "amd64", "os": "linux", "rootfs": {"type": "layers", "diff_ids": [diff for _, diff in layers]}})
        self.blobs[p.digest(config)] = config
        manifest = {"schemaVersion": 2, "mediaType": "application/vnd.docker.distribution.manifest.v2+json" if docker else p.OCI_MANIFEST, "config": {"mediaType": "application/vnd.docker.container.image.v1+json" if docker else p.OCI_CONFIG, "digest": p.digest(config), "size": len(config)}, "layers": descriptors}
        digest = p.digest(p.encode(manifest))
        self.manifests[digest] = manifest
        return digest

    def compare(self, before, after):
        with patch.object(deploy.migrations, "read_manifest", side_effect=lambda d, _: self.manifests[d]), patch.object(p, "blob", side_effect=lambda d: self.blobs[d["digest"]]):
            return deploy.migrations.admit(before, after, p)


class MigrationAdmissionTest(unittest.TestCase):
    def test_equal_inputs_across_oci_and_docker_schema_two_are_admitted(self):
        registry = Registry()
        self.assertFalse(registry.compare(registry.image(), registry.image(docker=True))["migrationDefinitionChanged"])

    def test_manifest_reader_binds_both_media_families_to_actual_digest(self):
        registry = Registry()
        for docker in [False, True]:
            image = registry.image(docker=docker)
            manifest = registry.manifests[image]
            response = {"images": [{"imageManifest": p.encode(manifest).decode(), "imageId": {"imageDigest": image}}]}
            with patch.object(p, "aws", return_value=response) as aws:
                self.assertEqual(deploy.migrations.read_manifest(image, p), manifest)
                self.assertEqual(aws.call_args.args[:2], ("ecr", "batch-get-image"))
            for change in ["body", "image-id", "unsupported"]:
                bad = copy.deepcopy(response)
                expected = image
                if change == "body":
                    bad["images"][0]["imageManifest"] += " "
                elif change == "image-id":
                    bad["images"][0]["imageId"]["imageDigest"] = "sha256:" + "0" * 64
                else:
                    altered = copy.deepcopy(manifest)
                    altered["mediaType"] = "application/vnd.oci.image.index.v1+json"
                    bad["images"][0]["imageManifest"] = p.encode(altered).decode()
                    expected = p.digest(p.encode(altered))
                    bad["images"][0]["imageId"]["imageDigest"] = expected
                with self.subTest(docker=docker, change=change), patch.object(p, "aws", return_value=bad), self.assertRaises(ValueError):
                    deploy.migrations.read_manifest(expected, p)

    def test_unknown_or_mixed_config_and_layer_media_types_refuse(self):
        for field in ["config", "layer"]:
            registry = Registry()
            before = registry.image()
            after = registry.image(docker=True)
            manifest = registry.manifests[after]
            descriptor = manifest["config"] if field == "config" else manifest["layers"][0]
            descriptor["mediaType"] = p.OCI_CONFIG if field == "config" else p.OCI_LAYER
            with self.subTest(field=field), self.assertRaisesRegex(ValueError, "MIGRATION_CONFIG_TYPE|MIGRATION_LAYER_TYPE"):
                registry.compare(before, after)

    def test_actual_core_drift_is_refused_even_when_git_recipe_matches(self):
        registry = Registry()
        before = registry.image()
        files = fixture_files()
        files["app/src/server/self-hosted/migrations.ts"] += b'\nexport const laterMigration = "SELECT 3";'
        with self.assertRaisesRegex(ValueError, "MIGRATION_DEFINITION_DRIFT"):
            registry.compare(before, registry.image(files))

    def test_dependency_only_drift_is_refused(self):
        for name in ["app/node_modules/@hasna/contracts/dist/auth/index.js", "app/src/storage-kit/migrations.ts"]:
            with self.subTest(name=name):
                registry = Registry()
                before = registry.image()
                files = fixture_files()
                files[name] += b'\n// dependency release changed\n'
                with self.assertRaisesRegex(ValueError, "MIGRATION_DEFINITION_DRIFT"):
                    registry.compare(before, registry.image(files))

    def test_same_definitions_admitted_with_unrelated_image_change(self):
        registry = Registry()
        before = registry.image()
        after = registry.image(extra_layers=[layer([("app/server-version.txt", b"next")])])
        result = registry.compare(before, after)
        self.assertFalse(result["migrationDefinitionChanged"])
        self.assertEqual(result["deployed"]["imageDigest"], before)
        self.assertEqual(result["candidate"]["imageDigest"], after)
        self.assertEqual(result["deployed"]["definitionInputs"], result["candidate"]["definitionInputs"])

    def test_missing_dependency_and_changed_exports_refused(self):
        for change in ["missing", "export", "conditional-export", "import", "dynamic", "computed"]:
            with self.subTest(change=change):
                registry = Registry()
                before = registry.image()
                files = fixture_files()
                path = "app/node_modules/@hasna/contracts/dist/auth/index.js"
                if change == "missing":
                    del files[path]
                elif change == "import":
                    files[path] += b'import external from "unreviewed-dependency";'
                elif change in ("dynamic", "computed"):
                    files[path] += b'import("unreviewed-dependency");' if change == "dynamic" else b'import(process.env.MODULE);'
                else:
                    package = json.loads(files["app/node_modules/@hasna/contracts/package.json"])
                    package["exports"]["./auth"]["import" if change == "export" else "bun"] = "./other.js"
                    files["app/node_modules/@hasna/contracts/package.json"] = json.dumps(package).encode()
                with self.assertRaises(ValueError):
                    registry.compare(before, registry.image(files))

    def test_whiteouts_remove_lower_definition_and_directory(self):
        for name in ["app/src/server/self-hosted/.wh.migrations.ts", "app/src/server/self-hosted/.wh..wh..opq", "app/src/.wh.storage-kit", ".wh.app", ".wh..wh..opq"]:
            with self.subTest(name=name):
                registry = Registry()
                before = registry.image()
                with self.assertRaisesRegex(ValueError, "MISSING_MIGRATION_INPUT"):
                    registry.compare(before, registry.image(extra_layers=[layer([(name, b"")])]))

    def test_same_layer_whiteout_then_replacement_is_active(self):
        registry = Registry()
        before = registry.image()
        files = fixture_files()
        name = "app/src/server/self-hosted/migrations.ts"
        after = registry.image(extra_layers=[layer([(name, files[name]), ("app/src/server/self-hosted/.wh.migrations.ts", b"")])])
        self.assertFalse(registry.compare(before, after)["migrationDefinitionChanged"])

    def test_links_shadows_and_unsafe_paths_refused(self):
        for name, value in [
            ("app/src/storage-kit", (tarfile.SYMTYPE, "elsewhere")),
            ("app/src/storage-kit/migrations.ts", (tarfile.LNKTYPE, "other.ts")),
            ("app/src/server/self-hosted/migrations.js", b"shadow"),
            ("app/src/node_modules", (tarfile.SYMTYPE, "/redirected")),
            ("app/src/server/self-hosted/node_modules/@hasna/contracts/package.json", b'{"name":"@hasna/contracts"}'),
            ("../app/src/storage-kit/migrations.ts", b"escape"),
        ]:
            with self.subTest(name=name):
                registry = Registry()
                before = registry.image()
                with self.assertRaises(ValueError):
                    registry.compare(before, registry.image(extra_layers=[layer([(name, value)])]))

    def test_package_self_reference_that_bun_resolves_is_refused(self):
        package = json.dumps({"name": "@hasna/contracts", "type": "module", "exports": {"./auth": "./shadow.ts"}}).encode()
        bun = shutil.which("bun")
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "package.json").write_bytes(package)
            (root / "shadow.ts").write_text('export const marker = "self-reference";')
            (root / "probe.ts").write_text('import {marker} from "@hasna/contracts/auth"; process.stdout.write(marker);')
            result = subprocess.run([bun, "--no-env-file", "probe.ts"], cwd=directory, env={"PATH": os.path.dirname(bun)}, capture_output=True, timeout=10)
            self.assertEqual((result.returncode, result.stdout), (0, b"self-reference"))
        registry = Registry()
        before = registry.image()
        files = fixture_files()
        files["app/package.json"] = package
        with self.assertRaisesRegex(ValueError, "MIGRATION_APP_PACKAGE"):
            registry.compare(before, registry.image(files))

    def test_tsconfig_alias_that_bun_resolves_is_refused(self):
        config = json.dumps({"compilerOptions": {"paths": {"@hasna/contracts/auth": ["./shadow.ts"]}}}).encode()
        # Harmless authored probe, not execution of OCI source or dependencies.
        bun = shutil.which("bun")
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "tsconfig.json").write_bytes(config)
            (root / "shadow.ts").write_text('export const marker = "shadow";')
            (root / "probe.ts").write_text('import {marker} from "@hasna/contracts/auth"; process.stdout.write(marker);')
            result = subprocess.run([bun, "--no-env-file", "probe.ts"], cwd=directory, env={"PATH": os.path.dirname(bun)}, capture_output=True, timeout=10)
            self.assertEqual((result.returncode, result.stdout), (0, b"shadow"))
        registry = Registry()
        before = registry.image()
        for name in ["tsconfig.json", "app/tsconfig.json", "app/src/server/self-hosted/tsconfig.json", "app/jsconfig.json", "app/bunfig.toml"]:
            with self.subTest(name=name), self.assertRaisesRegex(ValueError, "MIGRATION_RESOLUTION_SHADOW"):
                registry.compare(before, registry.image(extra_layers=[layer([(name, config)])]))

    def test_root_directory_entry_is_harmless(self):
        registry = Registry()
        before = registry.image()
        after = registry.image(extra_layers=[layer([("./", None)])])
        self.assertFalse(registry.compare(before, after)["migrationDefinitionChanged"])

    def test_refusal_retains_actual_compared_image_evidence(self):
        registry = Registry()
        before = registry.image()
        files = fixture_files()
        files["app/src/server/self-hosted/migrations.ts"] += b"\n// changed\n"
        after = registry.image(files)
        with tempfile.TemporaryDirectory() as directory, patch.object(deploy.migrations, "read_manifest", side_effect=lambda d, _: registry.manifests[d]), patch.object(p, "blob", side_effect=lambda d: registry.blobs[d["digest"]]):
            path = Path(directory) / "comparison.json"
            with self.assertRaisesRegex(ValueError, "MIGRATION_DEFINITION_DRIFT"):
                deploy.migrations.admit(before, after, p, receipt_path=path)
            evidence = json.loads(path.read_bytes())
            self.assertTrue(evidence["migrationDefinitionChanged"])
            self.assertEqual(evidence["deployed"]["imageDigest"], before)
            self.assertEqual(evidence["candidate"]["imageDigest"], after)

    def test_layer_digest_and_diff_id_and_size_bounds_refused(self):
        for change in ["blob", "diff", "size", "duplicate"]:
            with self.subTest(change=change):
                registry = Registry()
                before = registry.image()
                after = registry.image(extra_layers=[layer([("unrelated", b"next")])])
                manifest = registry.manifests[after]
                if change == "blob":
                    registry.blobs[manifest["layers"][-1]["digest"]] += b"corrupt"
                elif change == "size":
                    manifest["layers"][-1]["size"] = 1024 ** 3
                elif change == "duplicate":
                    path = "app/src/storage-kit/migrations.ts"
                    after = registry.image(extra_layers=[layer([(path, b"one"), (path, b"two")])])
                else:
                    config = json.loads(registry.blobs[manifest["config"]["digest"]])
                    config["rootfs"]["diff_ids"][-1] = "sha256:" + "f" * 64
                    raw = p.encode(config)
                    registry.blobs[p.digest(raw)] = raw
                    manifest["config"] = {"mediaType": p.OCI_CONFIG, "digest": p.digest(raw), "size": len(raw)}
                with self.assertRaises(ValueError):
                    registry.compare(before, after)

    def test_admission_refusal_occurs_before_any_aws_mutation(self):
        registry = Registry()
        old = registry.image()
        files = fixture_files()
        files["app/src/server/self-hosted/migrations.ts"] += b"\n// drift\n"
        new = registry.image(files)
        task = {"containerDefinitions": [{"name": "emails", "image": p.REPOSITORY + "@" + old}]}
        reconciled = {"service": {"taskDefinition": "anchor", "desiredCount": 1}, "descendant": {"digest": p.digest(p.encode(task)), "imageDigest": old}}
        calls = []
        def aws(*args, **kwargs):
            calls.append(args[:2])
            self.assertEqual(args[:2], ("sts", "get-caller-identity"))
            return {"Account": p.ACCOUNT}
        with tempfile.TemporaryDirectory() as directory, patch.object(deploy, "read_reconciled", return_value=reconciled), patch.object(p, "aws", side_effect=aws), patch.object(p, "current_service", return_value={"desiredCount": 1}), patch.object(p, "service_binding", return_value="anchor"), patch.object(p, "task_read", return_value=task), patch.object(deploy, "running_tasks", return_value=[]), patch.object(deploy.migrations, "read_manifest", side_effect=lambda d, _: registry.manifests[d]), patch.object(p, "blob", side_effect=lambda d: registry.blobs[d["digest"]]):
            with self.assertRaisesRegex(ValueError, "MIGRATION_DEFINITION_DRIFT"):
                deploy.deploy("c" * 40, Path("unused"), "d" * 64, new, Path(directory) / "receipts")
            self.assertEqual(calls, [("sts", "get-caller-identity")])
            self.assertFalse((Path(directory) / "receipts" / "register-intent.json").exists())

    def test_service_change_during_image_reads_refuses_before_registration(self):
        registry = Registry()
        old = registry.image()
        new = registry.image(extra_layers=[layer([("app/unrelated.txt", b"new")])])
        task = {"containerDefinitions": [{"name": "emails", "image": p.REPOSITORY + "@" + old}]}
        reconciled = {"service": {"taskDefinition": "anchor", "desiredCount": 1}, "descendant": {"digest": p.digest(p.encode(task)), "imageDigest": old}}
        calls = []
        def aws(*args, **kwargs):
            calls.append(args[:2])
            self.assertEqual(args[:2], ("sts", "get-caller-identity"))
            return {"Account": p.ACCOUNT}
        with tempfile.TemporaryDirectory() as directory, patch.object(deploy, "read_reconciled", return_value=reconciled), patch.object(p, "aws", side_effect=aws), patch.object(p, "current_service", return_value={"desiredCount": 1}), patch.object(p, "service_binding", side_effect=["anchor", "different"]), patch.object(p, "task_read", return_value=task), patch.object(deploy, "running_tasks", return_value=[]), patch.object(deploy.migrations, "read_manifest", side_effect=lambda d, _: registry.manifests[d]), patch.object(p, "blob", side_effect=lambda d: registry.blobs[d["digest"]]):
            with self.assertRaisesRegex(ValueError, "PRE_REGISTER_SERVICE_DRIFT"):
                deploy.deploy("c" * 40, Path("unused"), "d" * 64, new, Path(directory) / "receipts")
            self.assertEqual(calls, [("sts", "get-caller-identity")])
            self.assertFalse((Path(directory) / "receipts" / "register-intent.json").exists())


if __name__ == "__main__":
    unittest.main()
