#!/usr/bin/env python3
"""Offline tests for LLM review campaign validation."""

from __future__ import annotations

import json
import subprocess
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PLANNER = ROOT / "scripts" / "plan_llm_review_campaign.py"
VALIDATOR = ROOT / "scripts" / "validate_llm_review_campaign.py"


def write_manifest(path: Path, rows: int) -> None:
    with path.open("w", encoding="utf-8") as handle:
        for index in range(rows):
            handle.write(json.dumps({
                "file_id": f"f_private_{index}",
                "owner": "finance" if index % 2 == 0 else "people",
                "extractor_lane": "text" if index % 2 == 0 else "pdf",
                "expected_ext": "txt" if index % 2 == 0 else "pdf",
                "private_metadata": {"file_name": f"private-{index}.pdf"},
                "source_ref": f"s3://private/object-{index}",
            }, sort_keys=True) + "\n")


def run_script(script: Path, *args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["python3", str(script), *args],
        check=False,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )


def plan_campaign(root: Path, rows: int = 5) -> Path:
    manifest = root / "manifest.jsonl"
    output = root / "campaign"
    write_manifest(manifest, rows)
    proc = run_script(
        PLANNER,
        "--manifest",
        str(manifest),
        "--output-dir",
        str(output),
        "--jobs-per-shard",
        "2",
        "--campaign-id",
        "validator-test",
    )
    if proc.returncode != 0:
        raise AssertionError(proc.stderr)
    return output / "campaign-plan.json"


def plan_legacy_private_campaign(root: Path, rows: int = 5) -> Path:
    manifest = root / "manifest.jsonl"
    output = root / "campaign"
    write_manifest(manifest, rows)
    proc = run_script(
        PLANNER,
        "--manifest",
        str(manifest),
        "--output-dir",
        str(output),
        "--jobs-per-shard",
        "2",
        "--campaign-id",
        "validator-test",
        "--include-private-worker-fields",
    )
    if proc.returncode != 0:
        raise AssertionError(proc.stderr)
    return output / "campaign-plan.json"


class CampaignValidatorTests(unittest.TestCase):
    def test_valid_unapproved_plan_passes_and_redacts_summary(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            plan = plan_campaign(Path(tmp), rows=5)
            proc = run_script(VALIDATOR, "--plan", str(plan))

        self.assertEqual(proc.returncode, 0, proc.stderr)
        summary = json.loads(proc.stdout)
        self.assertEqual(summary["status"], "ok")
        self.assertFalse(summary["approved"])
        self.assertEqual(summary["jobs_from_shards"], 5)
        self.assertEqual(summary["execute_commands"], 0)
        self.assertEqual(summary["redaction_attestation"]["status"], "ok")
        self.assertEqual(summary["redaction_attestation"]["rows"], 5)
        self.assertEqual(summary["direct_provider_policy"]["status"], "ok")
        self.assertEqual(summary["direct_provider_policy"]["job_identity_policy"], "synthetic-job-ref")
        self.assertFalse(summary["direct_provider_policy"]["real_file_ids_sent"])
        self.assertEqual(summary["schedule_policy"]["status"], "ok")
        self.assertEqual(summary["schedule_policy"]["max_campaign_parallel"], 1)
        self.assertEqual(summary["schedule_policy"]["accounts"][0]["account_ref"], "direct-api:openrouter:default")
        self.assertGreater(summary["sensitive_values_checked"], 0)
        summary_text = json.dumps(summary)
        self.assertNotIn("f_private_", summary_text)
        self.assertNotIn("private-0.pdf", summary_text)
        self.assertNotIn("s3://private", summary_text)

    def test_strict_sanitized_mode_accepts_default_planner_shards(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            plan = plan_campaign(Path(tmp), rows=2)
            proc = run_script(VALIDATOR, "--plan", str(plan), "--require-sanitized-rows")

        self.assertEqual(proc.returncode, 0, proc.stderr)
        summary = json.loads(proc.stdout)
        self.assertEqual(summary["status"], "ok")
        self.assertTrue(summary["require_sanitized_rows"])

    def test_strict_sanitized_mode_rejects_private_worker_fields(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            plan = plan_legacy_private_campaign(Path(tmp), rows=2)
            proc = run_script(VALIDATOR, "--plan", str(plan), "--require-sanitized-rows")

        self.assertNotEqual(proc.returncode, 0)
        summary = json.loads(proc.stdout)
        codes = {error["code"] for error in summary["errors"]}
        self.assertIn("unsafe_worker_row_fields", codes)
        self.assertTrue(summary["require_sanitized_rows"])
        self.assertNotIn("f_private_", proc.stdout)
        self.assertNotIn("private-0.pdf", proc.stdout)
        self.assertNotIn("s3://private", proc.stdout)

    def test_unapproved_plan_with_execute_fails(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            plan = plan_campaign(Path(tmp), rows=2)
            data = json.loads(plan.read_text(encoding="utf-8"))
            data["shard_entries"][0]["command"].append("--execute")
            data["shard_entries"][0]["shell"] += " --execute"
            plan.write_text(json.dumps(data, indent=2, sort_keys=True), encoding="utf-8")
            proc = run_script(VALIDATOR, "--plan", str(plan))

        self.assertNotEqual(proc.returncode, 0)
        summary = json.loads(proc.stdout)
        codes = {error["code"] for error in summary["errors"]}
        self.assertIn("unapproved_command_has_execute", codes)

    def test_tampered_approval_attestation_fails(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            plan = plan_campaign(Path(tmp), rows=2)
            data = json.loads(plan.read_text(encoding="utf-8"))
            data["approval_attestation"]["status"] = "approved"
            plan.write_text(json.dumps(data, indent=2, sort_keys=True), encoding="utf-8")
            proc = run_script(VALIDATOR, "--plan", str(plan))

        self.assertNotEqual(proc.returncode, 0)
        codes = {error["code"] for error in json.loads(proc.stdout)["errors"]}
        self.assertIn("approval_attestation_mismatch", codes)

    def test_tampered_redaction_attestation_fails(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            plan = plan_campaign(Path(tmp), rows=2)
            data = json.loads(plan.read_text(encoding="utf-8"))
            data["shard_entries"][0]["redaction_attestation"]["rows"] = 999
            plan.write_text(json.dumps(data, indent=2, sort_keys=True), encoding="utf-8")
            proc = run_script(VALIDATOR, "--plan", str(plan), "--require-sanitized-rows")

        self.assertNotEqual(proc.returncode, 0)
        codes = {error["code"] for error in json.loads(proc.stdout)["errors"]}
        self.assertIn("redaction_attestation_mismatch", codes)

    def test_tampered_direct_provider_policy_fails(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            plan = plan_campaign(Path(tmp), rows=2)
            data = json.loads(plan.read_text(encoding="utf-8"))
            data["direct_provider_policy_attestation"]["real_file_ids_sent"] = True
            data["shard_entries"][0]["direct_provider_policy"]["egress"]["endpoint_host"] = "example.invalid"
            plan.write_text(json.dumps(data, indent=2, sort_keys=True), encoding="utf-8")
            proc = run_script(VALIDATOR, "--plan", str(plan))

        self.assertNotEqual(proc.returncode, 0)
        codes = {error["code"] for error in json.loads(proc.stdout)["errors"]}
        self.assertIn("direct_provider_policy_mismatch", codes)

    def test_tampered_schedule_policy_fails(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            plan = plan_campaign(Path(tmp), rows=2)
            data = json.loads(plan.read_text(encoding="utf-8"))
            data["schedule_policy"]["accounts"][0]["max_parallel"] = 99
            plan.write_text(json.dumps(data, indent=2, sort_keys=True), encoding="utf-8")
            proc = run_script(VALIDATOR, "--plan", str(plan))

        self.assertNotEqual(proc.returncode, 0)
        codes = {error["code"] for error in json.loads(proc.stdout)["errors"]}
        self.assertIn("schedule_policy_mismatch", codes)

    def test_duplicate_private_file_ids_fail_without_printing_values(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            plan = plan_campaign(Path(tmp), rows=4)
            data = json.loads(plan.read_text(encoding="utf-8"))
            first_manifest = Path(data["shard_entries"][0]["manifest"])
            rows = [json.loads(line) for line in first_manifest.read_text(encoding="utf-8").splitlines() if line.strip()]
            rows[1]["file_id"] = rows[0]["file_id"]
            with first_manifest.open("w", encoding="utf-8") as handle:
                for row in rows:
                    handle.write(json.dumps(row, sort_keys=True) + "\n")
            proc = run_script(VALIDATOR, "--plan", str(plan))

        self.assertNotEqual(proc.returncode, 0)
        summary = json.loads(proc.stdout)
        codes = {error["code"] for error in summary["errors"]}
        self.assertIn("duplicate_planned_file_ids", codes)
        self.assertEqual(summary["duplicate_file_ids"], 1)
        self.assertNotIn("f_private_", proc.stdout)

    def test_plan_sensitive_value_leak_fails_without_printing_value(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            plan = plan_campaign(Path(tmp), rows=2)
            data = json.loads(plan.read_text(encoding="utf-8"))
            data["unsafe_debug"] = "f_private_0"
            plan.write_text(json.dumps(data, indent=2, sort_keys=True), encoding="utf-8")
            proc = run_script(VALIDATOR, "--plan", str(plan))

        self.assertNotEqual(proc.returncode, 0)
        summary = json.loads(proc.stdout)
        codes = {error["code"] for error in summary["errors"]}
        self.assertIn("plan_leaks_sensitive_row_values", codes)
        self.assertEqual(summary["sensitive_value_leaks"], 1)
        self.assertNotIn("f_private_0", proc.stdout)

    def test_existing_state_file_requires_explicit_resume_validation(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            plan = plan_campaign(Path(tmp), rows=1)
            data = json.loads(plan.read_text(encoding="utf-8"))
            state_file = Path(data["shard_entries"][0]["state_file"])
            state_file.parent.mkdir(parents=True, exist_ok=True)
            state_file.write_text(json.dumps({"status": "partial"}), encoding="utf-8")
            proc = run_script(VALIDATOR, "--plan", str(plan))
            resume_proc = run_script(VALIDATOR, "--plan", str(plan), "--allow-existing-state")

        self.assertNotEqual(proc.returncode, 0)
        codes = {error["code"] for error in json.loads(proc.stdout)["errors"]}
        self.assertIn("state_file_already_exists", codes)
        self.assertEqual(resume_proc.returncode, 0, resume_proc.stderr)

    def test_sandbox_bypass_command_fails_by_default(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            manifest = root / "manifest.jsonl"
            output = root / "campaign"
            pool = root / "providers.json"
            write_manifest(manifest, 1)
            pool.write_text(json.dumps({
                "providers": [
                    {
                        "name": "spark-bypass-pilot",
                        "provider": "spark",
                        "execution_mode": "codewith",
                        "model": "gpt-5.3-codex-spark",
                        "auth_profile": "account001",
                        "allow_bypass_sandbox": True,
                    }
                ]
            }), encoding="utf-8")
            planner_proc = run_script(
                PLANNER,
                "--manifest",
                str(manifest),
                "--output-dir",
                str(output),
                "--provider-pool",
                str(pool),
                "--approved",
                "--approval-note",
                "legacy-bypass-pilot",
            )
            self.assertEqual(planner_proc.returncode, 0, planner_proc.stderr)
            plan = output / "campaign-plan.json"
            proc = run_script(VALIDATOR, "--plan", str(plan))
            override_proc = run_script(VALIDATOR, "--plan", str(plan), "--allow-sandbox-bypass")

        self.assertNotEqual(proc.returncode, 0)
        codes = {error["code"] for error in json.loads(proc.stdout)["errors"]}
        self.assertIn("sandbox_bypass_not_allowed", codes)
        self.assertEqual(override_proc.returncode, 0, override_proc.stderr)


if __name__ == "__main__":
    unittest.main()
