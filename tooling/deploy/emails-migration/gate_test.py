#!/usr/bin/env python3
import importlib.util
import hashlib
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("emails_migration_gate", ROOT / "gate.py")
g = importlib.util.module_from_spec(spec)
spec.loader.exec_module(g)
SOURCE = "a" * 40


class GateTest(unittest.TestCase):
    def test_execute_phase_is_disabled_before_artifact_or_aws_authority(self):
        self.assertEqual(g.require_phase("reconcile"), None)
        self.assertEqual(g.require_phase("prepare"), None)
        with self.assertRaisesRegex(ValueError, "MIGRATION_EXECUTION_DISABLED"):
            g.require_phase("execute")
        with patch.object(g, "gh", side_effect=AssertionError("GitHub read must not occur")):
            with self.assertRaisesRegex(ValueError, "MIGRATION_EXECUTION_DISABLED"):
                g.validate(SimpleNamespace(phase="execute"), Path("unused"))

    def test_migration_receipt_requires_separate_kms_anchor(self):
        value = {"schema": "emails.current-migration-reconciliation.v1", "sourceCommit": SOURCE, "migrationDefinitionChanged": True, "awsMutationCalls": 0, "historicalAnchor": {"taskDefinition": "old"}, "anchor": {"taskDefinition": "new"}, "failedCandidates": [{"taskBefore": "old"}, {"taskBefore": "old"}], "kmsBaselineConfigured": True}
        with tempfile.TemporaryDirectory() as td:
            path = Path(td) / "reconciled.json"
            def verify(row):
                path.write_text(json.dumps(row))
                sha = hashlib.sha256(path.read_bytes()).hexdigest()
                with patch.object(g, "run_metadata"), patch.object(g, "artifact", return_value=(None, {"reconciled.json": path})):
                    return g.migration_reconciliation(SOURCE, "123", sha, Path(td))
            self.assertEqual(verify(value)["anchor"]["taskDefinition"], "new")
            with self.assertRaisesRegex(ValueError, "KMS_BASELINE_RECONCILIATION"):
                verify({**value, "anchor": {"taskDefinition": "old"}})
            with self.assertRaisesRegex(ValueError, "FAILED_HISTORICAL_ANCHOR"):
                verify({**value, "failedCandidates": [{"taskBefore": "new"}, {"taskBefore": "old"}]})

    def test_prepared_receipt_requires_bound_kms_round_trip(self):
        candidate = {"taskDefinition": "task-91", "imageDigest": "sha256:" + "b" * 64}
        proof_id = hashlib.sha256(json.dumps({"source": SOURCE, "task": candidate["taskDefinition"], "image": candidate["imageDigest"]}, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
        value = {"schema": "emails.current-migration-prepared.v1", "sourceCommit": SOURCE, "migrationReconciledSha256": "r" * 64, "serviceUpdated": False, "databaseMutated": False, "candidate": candidate, "kmsProof": {"schema": "emails.migration-kms-proof.v1", "configured": True, "roundTrip": True, "keyMaterialEmitted": False, "proofId": proof_id}}
        with tempfile.TemporaryDirectory() as td:
            path = Path(td) / "prepared.json"
            def verify(row):
                path.write_text(json.dumps(row))
                sha = hashlib.sha256(path.read_bytes()).hexdigest()
                with patch.object(g, "run_metadata"), patch.object(g, "artifact", return_value=(None, {"prepared.json": path})):
                    return g.migration_plan(SOURCE, "123", sha, "r" * 64, Path(td))
            self.assertEqual(verify(value)["kmsProof"]["proofId"], proof_id)
            with self.assertRaisesRegex(ValueError, "MIGRATION_PLAN_KMS_PROOF"):
                verify({**value, "kmsProof": {**value["kmsProof"], "proofId": "0" * 64}})

    def test_exact_ci_requires_exact_successful_main_push(self):
        row = {"head_sha": SOURCE, "head_branch": "main", "event": "push", "status": "completed", "conclusion": "success", "path": ".github/workflows/ci.yml", "name": "ci"}
        self.assertTrue(g.exact_ci_success([row], SOURCE))
        for key, value in [("head_sha", "b" * 40), ("event", "pull_request"), ("conclusion", "failure"), ("path", ".github/workflows/other.yml")]:
            changed = {**row, key: value}
            self.assertFalse(g.exact_ci_success([changed], SOURCE))

    def test_failed_run_can_be_historical_but_anchor_requires_same_app(self):
        failed = {"head_sha": "b" * 40, "head_branch": "main", "event": "workflow_dispatch", "status": "completed", "conclusion": "failure", "path": g.FAILED_WORKFLOW}
        with patch.object(g, "gh", return_value=failed), patch.object(g, "git_ok", side_effect=[True]) as git:
            self.assertEqual(g.run_metadata("123", g.FAILED_WORKFLOW, SOURCE, exact=False, require_same_app=False), "b" * 40)
            self.assertEqual(git.call_count, 1)
        successful = {**failed, "conclusion": "success", "path": g.SEARCH_WORKFLOW}
        with patch.object(g, "gh", return_value=successful), patch.object(g, "git_ok", side_effect=[True, False]):
            with self.assertRaisesRegex(ValueError, "EMAILS_SOURCE_DRIFT"):
                g.run_metadata("123", g.SEARCH_WORKFLOW, SOURCE, exact=False, require_same_app=True)


if __name__ == "__main__":
    unittest.main()
