#!/usr/bin/env python3
import copy
import importlib.util
import pathlib
import unittest

ROOT = pathlib.Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("gate", ROOT / "gate.py")
gate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)

SOURCE = "a" * 40
SHA = "b" * 64
TASK = "arn:aws:ecs:us-east-1:123456789012:task-definition/emails-prod:90"
IMAGE = "sha256:" + "c" * 64
DIGEST = "sha256:" + "d" * 64


def fixture():
    running = {"taskArnSha256": "e" * 64, "taskDefinition": TASK, "lastStatus": "RUNNING", "healthStatus": "HEALTHY", "imageDigest": IMAGE}
    deployment = {"taskDefinition": TASK, "status": "PRIMARY", "rolloutState": "COMPLETED", "desiredCount": 1, "runningCount": 1, "pendingCount": 0}
    return {
        "schema": "emails.promotion-reconciliation.v1",
        "sourceCommit": SOURCE,
        "preparedSourceCommit": "f" * 40,
        "preparedSha256": "1" * 64,
        "task88": {},
        "task89": {},
        "descendant": {"taskDefinition": TASK, "imageDigest": IMAGE, "digest": DIGEST},
        "service": {"taskDefinition": TASK, "stable": True, "healthy": True, "desiredCount": 1, "runningCount": 1, "pendingCount": 0, "deployments": [deployment], "runningTasks": [running]},
        "state": "descendant_overlay_live_stable",
        "rollback": {"preMigrationAnchor": TASK, "automatic": False, "tasks88And89AreHistoricalOnly": True, "validAfterForwardMigration": False, "requiresSeparateReview": True},
    }


class GateTest(unittest.TestCase):
    def test_accepts_exact_stable_descendant(self):
        self.assertEqual(gate.validate_reconciled(fixture(), SOURCE, SHA)["state"], "descendant_overlay_live_stable")

    def test_rejects_drift_and_unstable_state(self):
        changes = [
            lambda value: value["service"].__setitem__("taskDefinition", TASK[:-2] + "91"),
            lambda value: value["service"].__setitem__("healthy", False),
            lambda value: value.__setitem__("state", "candidate_live_stable"),
            lambda value: value["rollback"].__setitem__("validAfterForwardMigration", True),
            lambda value: value["service"]["runningTasks"][0].__setitem__("imageDigest", "sha256:" + "9" * 64),
        ]
        for change in changes:
            value = copy.deepcopy(fixture())
            change(value)
            with self.assertRaises(ValueError):
                gate.validate_reconciled(value, SOURCE, SHA)


if __name__ == "__main__":
    unittest.main()
