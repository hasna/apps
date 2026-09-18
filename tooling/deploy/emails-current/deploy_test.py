#!/usr/bin/env python3
import copy
import importlib.util
import pathlib
import unittest

ROOT = pathlib.Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("deploy", ROOT / "deploy.py")
deploy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(deploy)


class DeployTest(unittest.TestCase):
    def test_candidate_changes_only_emails_image(self):
        old = deploy.promotion.REPOSITORY + "@sha256:" + "a" * 64
        new = "sha256:" + "b" * 64
        task = {
            "family": "emails-prod",
            "containerDefinitions": [
                {"name": "emails", "image": old, "environment": [{"name": "EXAMPLE", "value": "unchanged"}]},
                {"name": "observer", "image": "observer@sha256:" + "c" * 64},
            ],
            "taskDefinitionArn": "arn:old",
            "revision": 90,
            "status": "ACTIVE",
        }
        payload, previous = deploy.candidate_payload(task, new)
        self.assertEqual(previous, old)
        self.assertEqual(payload["containerDefinitions"][0]["image"], deploy.promotion.REPOSITORY + "@" + new)
        restored = copy.deepcopy(payload)
        restored["containerDefinitions"][0]["image"] = old
        self.assertEqual(restored, deploy.promotion.task_payload(task))

    def test_rejects_tag_and_foreign_repository(self):
        for image in [deploy.promotion.REPOSITORY + ":latest", "other.example/emails@sha256:" + "a" * 64]:
            with self.assertRaises(ValueError):
                deploy.candidate_payload({"containerDefinitions": [{"name": "emails", "image": image}]}, "sha256:" + "b" * 64)


if __name__ == "__main__":
    unittest.main()
