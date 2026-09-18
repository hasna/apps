"""Synthetic adversarial controls; actual source regressions run during build."""
import copy
import gzip
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tarfile
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent


def load(name):
    spec = importlib.util.spec_from_file_location("delivery_" + name, ROOT / (name + ".py"))
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value


m, gate, strict = load("promotion"), load("gate"), load("strict_patch")


class DeliveryControls(unittest.TestCase):
    def setUp(self):
        m.select_recipe("delivery-headers")
        self.before = {
            "family": m.SERVICE, "taskRoleArn": m.TASK_ROLE, "executionRoleArn": m.EXEC_ROLE,
            "taskDefinitionArn": f"arn:aws:ecs:{m.REGION}:{m.ACCOUNT}:task-definition/{m.SERVICE}:90",
            "revision": 90, "status": "ACTIVE", "networkMode": "awsvpc", "cpu": "1024", "tags": [],
            "containerDefinitions": [{"name": "emails", "image": m.REPOSITORY + "@" + m.BASE,
                "command": ["src/server/index.ts"], "environment": [
                    {"name": "EMAILS_MODE", "value": "self_hosted"},
                    {"name": "EMAILS_SEARCH_CONCURRENCY", "value": "4"},
                    {"name": "EMAILS_PG_POOL_MAX", "value": "3"}],
                "secrets": [{"name": "DATABASE_URL", "valueFrom": "synthetic-reference"}],
                "healthCheck": {"command": ["CMD", "synthetic"]}},
                {"name": "sidecar", "image": "untouched"}],
        }
        self.image = "sha256:" + "1" * 64

    def tearDown(self):
        m.select_recipe("search-capacity")

    def test_finite_selector_and_exact_recipe(self):
        self.assertEqual(m.recipe()["baseConfigDigest"], m.BASE_CONFIG)
        for value in ("", "../recipe.json", "current", None, "search"):
            with self.assertRaisesRegex(ValueError, "UNKNOWN_RECIPE"):
                m.select_recipe(value)

    def test_image_is_the_only_task_delta_including_environment_order(self):
        original = copy.deepcopy(self.before)
        expected = m.task_payload(self.before)
        expected["containerDefinitions"][0]["image"] = m.REPOSITORY + "@" + self.image
        self.assertEqual(m.task_candidate(self.before, self.image), expected)
        self.assertEqual(self.before, original)

    def test_wrong_base_startup_roles_and_unknown_task_fields_refuse(self):
        for key, value in (("taskRoleArn", "foreign"), ("family", "foreign"), ("unknown", True)):
            with self.assertRaises(ValueError):
                m.task_candidate({**self.before, key: value}, self.image)
        for key, value in (("image", m.REPOSITORY + "@" + self.image), ("command", ["other"]), ("entryPoint", ["other"])):
            task = copy.deepcopy(self.before)
            task["containerDefinitions"][0][key] = value
            with self.assertRaises(ValueError):
                m.task_candidate(task, self.image)

    def test_overlay_has_exact_measured_metadata_and_deterministic_bytes(self):
        files = {name: b"synthetic\n" for name in m.PATHS}
        first = m.make_layer(files)
        self.assertEqual(first, m.make_layer(files))
        with tarfile.open(fileobj=io.BytesIO(gzip.decompress(first[0]))) as archive:
            rows = archive.getmembers()
            self.assertEqual({row.name for row in rows}, set(m.PATHS))
            for row in rows:
                self.assertTrue(row.isfile())
                self.assertEqual((row.uid, row.gid, row.mode), m.IDENTITY["metadata"][row.name])
                self.assertEqual(row.mtime, 0)
        with self.assertRaises(ValueError):
            m.make_layer({**files, "app/package.json": b"{}"})

    def synthetic_patch(self):
        pre = {name: b"before\n" for name in m.PATHS}
        delta = b"".join(b"--- a/" + name.encode() + b"\n+++ b/" + name.encode() + b"\n@@ -1 +1 @@\n-before\n+after\n" for name in m.PATHS)
        recipe = {"schema": m.IDENTITY["schema"], "purpose": "delivery-headers",
                  "patchSha256": hashlib.sha256(delta).hexdigest(), "files": []}
        for name in m.PATHS:
            uid, gid, mode = m.IDENTITY["metadata"][name]
            recipe["files"].append({"path": name, "uid": uid, "gid": gid, "mode": mode,
                "beforeSha256": hashlib.sha256(b"before\n").hexdigest(), "beforeBytes": 7,
                "afterSha256": hashlib.sha256(b"after\n").hexdigest(), "afterBytes": 6})
        return recipe, delta, pre

    def test_strict_patch_refuses_cross_purpose_metadata_and_preimage_changes(self):
        recipe, delta, pre = self.synthetic_patch()
        self.assertEqual(strict.apply_reviewed_patch(recipe, delta, pre, "delivery-headers"), {name: b"after\n" for name in m.PATHS})
        with self.assertRaises(ValueError):
            strict.apply_reviewed_patch(recipe, delta, pre)
        for field, value in (("uid", 0), ("mode", 0o644), ("path", "app/package.json"), ("beforeSha256", "0" * 64)):
            altered = copy.deepcopy(recipe)
            altered["files"][0][field] = value
            with self.assertRaises(ValueError):
                strict.apply_reviewed_patch(altered, delta, pre, "delivery-headers")
        with self.assertRaises(ValueError):
            strict.apply_reviewed_patch({**recipe, "purpose": "search-capacity"}, delta, pre, "delivery-headers")

    def test_gate_binds_source_purpose_and_producer_run(self):
        source = "a" * 40
        plan = {"schema": "emails.delivery-prepared.v1", "purpose": "delivery-headers", "sourceCommit": source, "producerRunId": "123"}
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "prepared.json"
            path.write_bytes(m.encode(plan))
            digest = hashlib.sha256(path.read_bytes()).hexdigest()
            self.assertEqual(gate.verify_prepared_file(path, digest, source, "delivery-headers", "123"), plan)
            for purpose, run, sha in (("search-capacity", "123", source), ("delivery-headers", "124", source), ("delivery-headers", "123", "b" * 40)):
                with self.assertRaises(ValueError):
                    gate.verify_prepared_file(path, digest, sha, purpose, run)

    def test_wrong_purpose_refuses_before_cloud_or_image_reads(self):
        plan = {"schema": "emails.promotion-prepared.v1", "sourceCommit": "a" * 40,
                "recipeSha256": hashlib.sha256(m.recipe_path().read_bytes()).hexdigest()}
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "prepared.json"
            path.write_bytes(m.encode(plan))
            with patch.object(m, "aws", side_effect=AssertionError("NO_CLOUD")), patch.object(m, "build", side_effect=AssertionError("NO_IMAGE")):
                with self.assertRaisesRegex(ValueError, "PREPARED_SOURCE"):
                    m.reviewed_plan("a" * 40, path, hashlib.sha256(path.read_bytes()).hexdigest())

    def test_actual_migration_drift_stops_review_before_task_or_mutation(self):
        receipt = {"imageDigest": self.image}
        plan = {"schema": "emails.delivery-prepared.v1", "purpose": "delivery-headers", "sourceCommit": "a" * 40,
                "recipeSha256": hashlib.sha256(m.recipe_path().read_bytes()).hexdigest(), "image": receipt}
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "prepared.json"
            path.write_bytes(m.encode(plan))
            with patch.object(m, "build", return_value=({}, b"", b"", receipt)), patch.object(m, "image_manifest", return_value={}), patch.object(m, "migration_equality", side_effect=ValueError("MIGRATION_DEFINITION_DRIFT")), patch.object(m, "current_service", side_effect=AssertionError("NO_TASK_OR_MUTATION")):
                with self.assertRaisesRegex(ValueError, "MIGRATION_DEFINITION_DRIFT"):
                    m.promote("a" * 40, Path(directory), path, hashlib.sha256(path.read_bytes()).hexdigest())

    def reconciliation(self, selected="base", drift=None):
        candidate = m.task_candidate(self.before, self.image)
        previous = self.before["taskDefinitionArn"]
        current = previous if selected == "base" else previous.rsplit(":", 1)[0] + ":94"
        actual = {**copy.deepcopy(candidate), "taskDefinitionArn": current, "revision": 94, "status": "ACTIVE"}
        if drift == "env":
            actual["containerDefinitions"][0]["environment"].append({"name": "UNREVIEWED", "value": "true"})
        if drift == "image":
            actual["containerDefinitions"][0]["image"] = m.REPOSITORY + "@sha256:" + "2" * 64
        service = {"serviceName": m.SERVICE, "status": "ACTIVE", "desiredCount": 1, "runningCount": 1, "pendingCount": 0,
                   "taskDefinition": current, "deployments": [{"status": "PRIMARY", "rolloutState": "COMPLETED", "taskDefinition": current}]}
        plan = {"taskDefinitionBefore": previous, "taskAfterDigest": m.digest(m.encode(candidate)), "desiredCount": 1, "producerRunId": "123", "recipeSha256": "a" * 64}
        rows = [{"taskDefinition": current, "lastStatus": "RUNNING", "healthStatus": "HEALTHY", "imageDigest": m.BASE if selected == "base" else self.image}]
        if drift == "running_image": rows[0]["imageDigest"] = "sha256:" + "3" * 64
        if drift == "count": rows = []
        snapshots = [(rows, "same"), (rows, "changed" if drift == "race" else "same")]
        with tempfile.TemporaryDirectory() as directory, patch.object(m, "delivery_readiness", return_value={"ready": True}), patch.object(m, "task_read", side_effect=lambda arn: self.before if arn == previous else actual), patch.object(m, "current_service", return_value=service), patch.object(m, "running_task_snapshot", side_effect=snapshots) as read, patch.object(m, "aws", side_effect=AssertionError("NO_MUTATION")):
            out = Path(directory)
            m.reconcile_delivery("a" * 40, out, "b" * 64, plan, {"imageDigest": self.image}, "a" * 40)
            receipt = json.loads((out / "reconciled.json").read_bytes())
            self.assertEqual(read.call_count, 2)
            return receipt

    def test_reconciliation_accepts_only_exact_base_or_candidate_with_two_live_reads(self):
        for selected in ("base", "candidate"):
            self.assertEqual(self.reconciliation(selected)["state"], selected + "_live_stable")

    def test_reconciliation_rejects_task_env_descendant_image_task_count_and_race(self):
        for drift in ("env", "image", "running_image", "count", "race"):
            with self.subTest(drift=drift), self.assertRaises(ValueError):
                self.reconciliation("candidate", drift)

    def test_live_proof_requires_exact_running_digest_and_two_stable_observations(self):
        selected = self.before["taskDefinitionArn"]
        service = {"serviceName": m.SERVICE, "status": "ACTIVE", "desiredCount": 1, "runningCount": 1,
                   "pendingCount": 0, "taskDefinition": selected,
                   "deployments": [{"status": "PRIMARY", "rolloutState": "COMPLETED", "taskDefinition": selected}]}
        rows = [{"taskDefinition": selected, "lastStatus": "RUNNING", "healthStatus": "HEALTHY", "imageDigest": m.BASE}]
        for drift in (None, "race", "image", "count"):
            tasks = copy.deepcopy(rows)
            if drift == "image": tasks[0]["imageDigest"] = self.image
            if drift == "count": tasks = []
            snapshots = [(tasks, "first"), (tasks, "second" if drift == "race" else "first")]
            with self.subTest(drift=drift), patch.object(m, "current_service", return_value=service), patch.object(m, "delivery_readiness", return_value={"ready": True}), patch.object(m, "running_task_snapshot", side_effect=snapshots) as read:
                if drift:
                    with self.assertRaises(ValueError): m.delivery_live_proof(selected, m.BASE, 1)
                else:
                    self.assertEqual(m.delivery_live_proof(selected, m.BASE, 1)["runningTasks"], rows)
                    self.assertEqual(read.call_count, 2)

    def test_delivery_public_ready_refuses_incompatible_schema_before_proof(self):
        class Public:
            def __init__(self, ready): self.ready = ready
            def get(self, path):
                return {"status": "ok", "version": "1.4.10", "mode": "self_hosted", "name": "emails"} if path == "/version" else self.ready
        good = {"status": "ready", "version": "1.4.10", "mode": "self_hosted", "pendingMigrations": [], "migrationIssues": []}
        for changed in ({}, {"version": "1.6.3"}, {"pendingMigrations": ["synthetic"]}, {"migrationIssues": ["unknown"]}, {"status": "unready"}):
            with self.subTest(changed=changed), patch.object(m.importlib.util, "module_from_spec", return_value=Public({**good, **changed})), patch("importlib.machinery.SourceFileLoader.exec_module"):
                if changed:
                    with self.assertRaises(ValueError): m.delivery_readiness()
                else:
                    self.assertTrue(m.delivery_readiness()["ready"])


if __name__ == "__main__":
    unittest.main()
