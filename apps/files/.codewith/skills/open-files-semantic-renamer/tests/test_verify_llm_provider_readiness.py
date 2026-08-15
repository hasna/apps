#!/usr/bin/env python3
"""Offline tests for LLM provider readiness verification."""

from __future__ import annotations

import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


SCRIPT_DIR = Path(__file__).resolve().parents[1] / "scripts"
SCRIPT = SCRIPT_DIR / "verify_llm_provider_readiness.py"


def load_module():
    if str(SCRIPT_DIR) not in sys.path:
        sys.path.insert(0, str(SCRIPT_DIR))
    spec = importlib.util.spec_from_file_location("verify_llm_provider_readiness", SCRIPT)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"failed to load {SCRIPT}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def run_script(*args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["python3", str(SCRIPT), *args],
        check=False,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )


def write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, sort_keys=True), encoding="utf-8")


def plan(account_ref: str = "direct-api:openrouter:default") -> dict:
    return {
        "kind": "campaign-plan",
        "schedule_policy": {
            "status": "ok",
            "max_campaign_parallel": 1,
            "accounts": [
                {
                    "account_ref": account_ref,
                    "max_parallel": 1,
                    "rate_limit_per_minute": 30,
                    "jobs": 1,
                    "shards": 1,
                }
            ],
        },
        "direct_provider_policy_attestation": {
            "status": "ok",
            "allowed_hosts": ["openrouter.ai"],
            "direct_provider_count": 1 if account_ref.startswith("direct-api:") else 0,
            "job_identity_policy": "synthetic-job-ref",
            "payload_class": "sanitized-bounded-review-jobs",
            "provider_data_collection_allowed_count": 0,
            "provider_data_collection_denied_by_default": True,
            "raw_extracts_sent": False,
            "raw_file_bytes_sent": False,
            "real_file_ids_sent": False,
            "secret_values_sent": False,
        },
    }


def inventory(openrouter_available: bool = True, codewith_available: bool = True) -> dict:
    return {
        "redaction": "secret values omitted",
        "tools": {
            "codewith": codewith_available,
            "secrets": True,
        },
        "providers": {
            "openrouter": {
                "env_available": openrouter_available,
                "vault_available": False,
                "env_format_warnings": [],
                "env_key_names_present": ["OPENROUTER_API_KEY"] if openrouter_available else [],
            }
        },
    }


class VerifyLlmProviderReadinessTests(unittest.TestCase):
    def test_direct_openrouter_route_is_ready_with_available_key_and_safe_policy(self) -> None:
        verifier = load_module()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            plan_path = root / "plan.json"
            inventory_path = root / "inventory.json"
            write_json(plan_path, plan())
            write_json(inventory_path, inventory(openrouter_available=True))

            result = verifier.build_readiness(plan_path, inventory_path)

        self.assertEqual(result["status"], "ok")
        self.assertEqual(result["planned_routes"]["direct_gateways"], ["openrouter"])
        self.assertTrue(result["planned_routes"]["direct_routes"][0]["available"])
        self.assertEqual(result["direct_provider_policy_gate"]["status"], "ok")
        self.assertTrue(result["redaction_check"]["passed"])

    def test_missing_direct_key_blocks_without_secret_values(self) -> None:
        verifier = load_module()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            plan_path = root / "plan.json"
            inventory_path = root / "inventory.json"
            write_json(plan_path, plan())
            write_json(inventory_path, inventory(openrouter_available=False))

            result = verifier.build_readiness(plan_path, inventory_path)

        self.assertEqual(result["status"], "blocked_provider_route")
        self.assertIn("missing_direct_provider_key", result["errors"])
        encoded = json.dumps(result)
        self.assertNotIn("sk-", encoded)
        self.assertNotIn("f_private_", encoded)
        self.assertNotIn("s3://", encoded)

    def test_policy_failure_blocks_even_when_key_exists(self) -> None:
        verifier = load_module()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            plan_value = plan()
            plan_value["direct_provider_policy_attestation"]["raw_extracts_sent"] = True
            plan_path = root / "plan.json"
            inventory_path = root / "inventory.json"
            write_json(plan_path, plan_value)
            write_json(inventory_path, inventory(openrouter_available=True))

            result = verifier.build_readiness(plan_path, inventory_path)

        self.assertEqual(result["status"], "blocked_policy")
        self.assertIn("direct_provider_policy_failed", result["errors"])

    def test_codewith_route_uses_codewith_tool_availability(self) -> None:
        verifier = load_module()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            plan_path = root / "plan.json"
            inventory_path = root / "inventory.json"
            write_json(plan_path, plan("codewith:account001"))
            write_json(inventory_path, inventory(openrouter_available=False, codewith_available=True))

            result = verifier.build_readiness(plan_path, inventory_path)

        self.assertEqual(result["status"], "ok")
        self.assertEqual(result["planned_routes"]["direct_gateways"], [])
        self.assertEqual(result["planned_routes"]["codewith_profile_count"], 1)
        self.assertTrue(result["planned_routes"]["codewith_tool_available"])

    def test_cli_writes_output(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            plan_path = root / "plan.json"
            inventory_path = root / "inventory.json"
            output = root / "provider-readiness.json"
            write_json(plan_path, plan())
            write_json(inventory_path, inventory())

            proc = run_script("--campaign-plan", str(plan_path), "--provider-inventory", str(inventory_path), "--output", str(output))

            self.assertEqual(proc.returncode, 0, proc.stderr)
            self.assertTrue(output.exists())
            self.assertIn('"status": "ok"', proc.stdout)


if __name__ == "__main__":
    unittest.main()
