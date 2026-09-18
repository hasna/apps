#!/usr/bin/env python3
import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("emails_migration_gate", ROOT / "gate.py")
g = importlib.util.module_from_spec(spec)
spec.loader.exec_module(g)
SOURCE = "a" * 40


class GateTest(unittest.TestCase):
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
