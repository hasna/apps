#!/usr/bin/env python3
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("emails_migration_deploy", ROOT / "deploy.py")
d = importlib.util.module_from_spec(spec)
spec.loader.exec_module(d)
p = d.promotion
SOURCE = "a" * 40
TASK = f"arn:aws:ecs:{p.REGION}:{p.ACCOUNT}:task-definition/{p.SERVICE}:90"
CANDIDATE = f"arn:aws:ecs:{p.REGION}:{p.ACCOUNT}:task-definition/{p.SERVICE}:93"
KMS_ANCHOR = f"arn:aws:ecs:{p.REGION}:{p.ACCOUNT}:task-definition/{p.SERVICE}:91"
FIRST_FAILED = f"arn:aws:ecs:{p.REGION}:{p.ACCOUNT}:task-definition/{p.SERVICE}:92"
IMAGE = "sha256:" + "b" * 64
OLD_IMAGE = "sha256:" + "c" * 64


class DeployTest(unittest.TestCase):
    def test_reconcile_binds_historical_failures_to_old_anchor_and_kms_to_live_anchor(self):
        historical = {"family": p.SERVICE, "containerDefinitions": [{"name": "emails", "image": p.REPOSITORY + "@" + OLD_IMAGE, "environment": [{"name": "X", "value": "same"}]}]}
        baseline = copy.deepcopy(historical)
        baseline["containerDefinitions"][0]["environment"].extend([
            {"name": "EMAILS_PROVIDER_KMS_KEY_ID", "value": "alias/emails-provider-root"},
            {"name": "EMAILS_PROVIDER_KMS_REGION", "value": p.REGION},
        ])
        failed = []
        definitions = {TASK: historical, KMS_ANCHOR: baseline}
        for number, task, image in ((1, FIRST_FAILED, IMAGE), (2, CANDIDATE, "sha256:" + "d" * 64)):
            payload = copy.deepcopy(historical)
            payload["containerDefinitions"][0]["image"] = p.REPOSITORY + "@" + image
            definitions[task] = payload
            failed.append({"runId": number, "taskDefinition": task, "imageDigest": image, "taskBefore": TASK, "sourceCommit": SOURCE})
        previous = {"service": {"taskDefinition": TASK, "desiredCount": 1}, "descendant": {"imageDigest": OLD_IMAGE, "digest": p.digest(p.encode(historical))}}
        service = {"serviceName": p.SERVICE, "status": "ACTIVE", "taskDefinition": KMS_ANCHOR, "desiredCount": 1, "runningCount": 1, "pendingCount": 0, "deployments": [{"taskDefinition": KMS_ANCHOR, "status": "PRIMARY", "rolloutState": "COMPLETED"}]}
        with patch.object(p, "task_read", side_effect=lambda task: definitions[task]), patch.object(p, "current_service", return_value=service), patch.object(d, "running_snapshot", return_value=([], "running")):
            result = d.reconcile_state(previous, failed)
        self.assertEqual(result["historicalAnchor"]["taskDefinition"], TASK)
        self.assertEqual(result["anchor"]["taskDefinition"], KMS_ANCHOR)
        self.assertTrue(result["kmsBaselineConfigured"])
        self.assertEqual([row["taskDefinition"] for row in result["failedCandidates"]], [FIRST_FAILED, CANDIDATE])

        without_kms = copy.deepcopy(baseline)
        without_kms["containerDefinitions"][0]["environment"] = [{"name": "X", "value": "same"}]
        with self.assertRaisesRegex(ValueError, "KMS_BASELINE_PAIR"):
            d.require_kms_baseline(historical, without_kms)
        with_unrelated_change = copy.deepcopy(baseline)
        with_unrelated_change["cpu"] = "2048"
        with self.assertRaisesRegex(ValueError, "KMS_BASELINE_TASK_DRIFT"):
            d.require_kms_baseline(historical, with_unrelated_change)

    def test_candidate_changes_only_emails_image(self):
        task = {"family": p.SERVICE, "containerDefinitions": [{"name": "emails", "image": p.REPOSITORY + "@" + OLD_IMAGE, "environment": [{"name": "X", "value": "same"}]}, {"name": "observer", "image": "observer@sha256:" + "d" * 64}]}
        candidate, before = d.image_only_candidate(task, IMAGE)
        self.assertEqual(before, OLD_IMAGE)
        self.assertEqual(candidate["containerDefinitions"][0]["image"], p.REPOSITORY + "@" + IMAGE)
        restored = copy.deepcopy(candidate)
        restored["containerDefinitions"][0]["image"] = p.REPOSITORY + "@" + OLD_IMAGE
        self.assertEqual(restored, p.task_payload(task))

    def test_expected_drift_requires_actual_input_difference(self):
        before = {"definitionInputs": {"a": "1"}, "imageDigest": OLD_IMAGE}
        after = {"definitionInputs": {"a": "2"}, "imageDigest": IMAGE}
        with patch.object(d.admission_module, "inspect", side_effect=[before, after]):
            self.assertTrue(d.expected_drift(OLD_IMAGE, IMAGE)["migrationDefinitionChanged"])
        with patch.object(d.admission_module, "inspect", side_effect=[before, before]):
            with self.assertRaisesRegex(ValueError, "MIGRATION_DEFINITION_DRIFT_EXPECTED"):
                d.expected_drift(OLD_IMAGE, IMAGE)

    def test_task_request_is_bounded_and_never_contains_a_service_update(self):
        service = {"networkConfiguration": {"awsvpcConfiguration": {"subnets": ["subnet-a"], "securityGroups": ["sg-a"], "assignPublicIp": "DISABLED"}}, "launchType": "FARGATE", "platformVersion": "1.4.0"}
        request = d.task_request(service, CANDIDATE, "plan", {})
        self.assertEqual(request["taskDefinition"], CANDIDATE)
        self.assertEqual(request["count"], 1)
        self.assertNotIn("service", request)
        self.assertLessEqual(len(d.encode(request["overrides"])), 8192)

    def test_roll_forward_wait_ignores_historical_failed_deployment_but_not_failed_primary(self):
        base = {"serviceName": p.SERVICE, "status": "ACTIVE", "taskDefinition": CANDIDATE, "desiredCount": 1, "runningCount": 1, "pendingCount": 0, "deploymentController": {"type": "ECS"}, "deploymentConfiguration": {"minimumHealthyPercent": 100, "maximumPercent": 200, "deploymentCircuitBreaker": {"enable": True, "rollback": False}}}
        progressing = {**base, "deployments": [{"status": "PRIMARY", "taskDefinition": CANDIDATE, "rolloutState": "IN_PROGRESS"}, {"status": "ACTIVE", "taskDefinition": TASK, "rolloutState": "FAILED"}]}
        complete = {**base, "deployments": [{"status": "PRIMARY", "taskDefinition": CANDIDATE, "rolloutState": "COMPLETED", "desiredCount": 1, "runningCount": 1, "pendingCount": 0}]}
        with patch.object(p, "current_service", side_effect=[progressing, complete]), patch.object(d.time, "sleep"):
            self.assertEqual(d.wait_roll_forward(CANDIDATE, 1, timeout=30, interval=0), complete)
        failed = {**base, "deployments": [{"status": "PRIMARY", "taskDefinition": CANDIDATE, "rolloutState": "FAILED"}]}
        with patch.object(p, "current_service", return_value=failed):
            with self.assertRaisesRegex(ValueError, "ROLL_FORWARD_DEPLOYMENT_FAILED"):
                d.wait_roll_forward(CANDIDATE, 1, timeout=1, interval=0)

    def test_execute_runs_one_apply_and_one_service_update_without_rollback(self):
        service = {"serviceName": p.SERVICE, "taskDefinition": TASK, "desiredCount": 1, "runningCount": 1, "pendingCount": 0, "deployments": [], "deploymentController": {"type": "ECS"}, "deploymentConfiguration": {"minimumHealthyPercent": 100, "maximumPercent": 200, "deploymentCircuitBreaker": {"enable": True, "rollback": True}}}
        reconciled = {"schema": "emails.current-migration-reconciliation.v1", "sourceCommit": SOURCE, "serviceDigest": "service", "runningTasksDigest": "running", "runningTasks": [], "anchor": {"taskDefinition": TASK, "imageDigest": OLD_IMAGE, "desiredCount": 1}, "failedCandidates": []}
        ledger = [{"id": "0001", "checksum": "sha256:" + "1" * 64}]
        before_hash = "1" * 64
        plan_hash = "2" * 64
        after_hash = "3" * 64
        plan_rows = [{"id": "0001", "checksum": "sha256:" + "1" * 64, "state": "pending"}]
        prepared = {
            "schema": "emails.current-migration-prepared.v1",
            "sourceCommit": SOURCE,
            "migrationReconciledSha256": "",
            "candidate": {"taskDefinition": CANDIDATE, "taskPayloadDigest": "payload", "imageDigest": IMAGE},
            "ledgerBefore": [],
            "ledgerBeforeSha256": before_hash,
            "plan": plan_rows,
            "planSha256": plan_hash,
            "expectedAfterLedger": ledger,
            "expectedAfterLedgerSha256": after_hash,
            "taskScriptSha256": hashlib.sha256(d.task_script().encode()).hexdigest(),
        }
        proof_id = d.kms_proof_id(SOURCE, CANDIDATE, IMAGE)
        kms_proof = {"schema": "emails.migration-kms-proof.v1", "configured": True, "roundTrip": True, "keyMaterialEmitted": False, "proofId": proof_id}
        prepared["kmsProof"] = kms_proof
        preflight = {"ledger": [], "ledgerSha256": before_hash, "plan": plan_rows, "planSha256": plan_hash, "expectedAfterLedger": ledger, "expectedAfterLedgerSha256": after_hash}
        applied = {"beforeLedger": [], "beforeLedgerSha256": before_hash, "plan": plan_rows, "planSha256": plan_hash, "appliedMigrationIds": ["0001"], "afterLedger": ledger, "afterLedgerSha256": after_hash, "databaseMutated": True, "automaticRollback": False}
        calls = []
        update_bodies = []
        def aws(*args, **kwargs):
            calls.append(args[:2])
            if args[:2] == ("ecs", "update-service"):
                update_bodies.append(kwargs.get("body"))
            if args[:2] == ("sts", "get-caller-identity"): return {"Account": p.ACCOUNT}
            if args[:2] == ("ecs", "update-service"): return {"service": {}}
            raise AssertionError(args)
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            (root / "migration-reconciliation").mkdir(); (root / "plan").mkdir()
            recon_path = root / "migration-reconciliation" / "reconciled.json"
            recon_path.write_text(json.dumps(reconciled))
            prepared["migrationReconciledSha256"] = hashlib.sha256(recon_path.read_bytes()).hexdigest()
            (root / "plan" / "prepared.json").write_text(json.dumps(prepared))
            out = root / "out"
            stable = copy.deepcopy(service)
            stable["deploymentConfiguration"]["deploymentCircuitBreaker"]["rollback"] = False
            with patch.object(d, "require_main_source"), patch.object(d, "service_matches_reconciliation", return_value=service), patch.object(d, "verify_candidate", return_value={}), patch.object(d, "run_receipt_task", side_effect=[(preflight, {"taskArnSha256": "p"}), (kms_proof, {"taskArnSha256": "k"}), (applied, {"taskArnSha256": "m"})]) as tasks, patch.object(p, "aws", side_effect=aws), patch.object(p, "current_service", return_value=service), patch.object(d, "wait_roll_forward", return_value=stable), patch.object(d, "running_snapshot", return_value=([], "running")):
                d.execute(SOURCE, root, out)
            self.assertEqual([call.args[2] for call in tasks.call_args_list], ["plan", "kms", "apply"])
            self.assertEqual(calls.count(("ecs", "update-service")), 1)
            self.assertEqual(update_bodies[0]["taskDefinition"], CANDIDATE)
            self.assertFalse(update_bodies[0]["deploymentConfiguration"]["deploymentCircuitBreaker"]["rollback"])
            self.assertTrue((out / "migration-applied.json").is_file())
            self.assertTrue((out / "deployed.json").is_file())
            self.assertFalse((out / "roll-forward-required.json").exists())

            calls.clear()
            bad_proof = {**kms_proof, "roundTrip": False}
            refused = root / "refused"
            with patch.object(d, "service_matches_reconciliation", return_value=service), patch.object(d, "verify_candidate", return_value={}), patch.object(d, "run_receipt_task", side_effect=[(preflight, {"taskArnSha256": "p"}), (bad_proof, {"taskArnSha256": "k"})]) as tasks, patch.object(p, "aws", side_effect=aws):
                with self.assertRaisesRegex(ValueError, "KMS_PROOF"):
                    d.execute(SOURCE, root, refused)
            self.assertEqual([call.args[2] for call in tasks.call_args_list], ["plan", "kms"])
            self.assertNotIn(("ecs", "update-service"), calls)
            self.assertTrue((refused / "preflight-reconciliation-required.json").is_file())
            self.assertFalse((refused / "migration-run-intent.json").exists())


if __name__ == "__main__":
    unittest.main()
