#!/usr/bin/env python3
"""Offline tests for LLM review campaign planning."""

from __future__ import annotations

import json
import subprocess
import tempfile
import unittest
from pathlib import Path


SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "plan_llm_review_campaign.py"


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


def write_approval_note(path: Path, decision_id: str = "llm_review_campaign", note: str = "approved from private file") -> None:
    path.write_text(
        json.dumps(
            {
                "kind": "open_files_operator_approval_note",
                "version": 1,
                "decision_id": decision_id,
                "status": "approved",
                "scope": "canary",
                "approved_by": "operator",
                "approved_at": "2026-06-16T15:00:00Z",
                "approval_note": note,
            },
            sort_keys=True,
        ),
        encoding="utf-8",
    )


class CampaignPlannerTests(unittest.TestCase):
    def run_planner(self, *args: str) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            ["python3", str(SCRIPT), *args],
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )

    def test_default_plan_requires_approval_and_redacts_rows(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            manifest = root / "manifest.jsonl"
            output = root / "campaign"
            write_manifest(manifest, 5)
            proc = self.run_planner(
                "--manifest",
                str(manifest),
                "--output-dir",
                str(output),
                "--jobs-per-shard",
                "2",
                "--campaign-id",
                "test-campaign",
            )
            self.assertEqual(proc.returncode, 0, proc.stderr)
            summary = json.loads(proc.stdout)
            plan = json.loads((output / "campaign-plan.json").read_text(encoding="utf-8"))
            shard_rows = [
                json.loads(line)
                for line in (output / "shards" / "shard-0001.jsonl").read_text(encoding="utf-8").splitlines()
                if line.strip()
            ]

        self.assertEqual(summary["status"], "approval_required")
        self.assertFalse(plan["approved"])
        self.assertTrue(plan["worker_manifest_sanitized"])
        self.assertEqual(plan["approval_attestation"]["status"], "approval_required")
        self.assertFalse(plan["approval_attestation"]["approval_note_present"])
        self.assertEqual(plan["redaction_attestation"]["status"], "ok")
        self.assertEqual(plan["redaction_attestation"]["rows"], 5)
        self.assertEqual(plan["direct_provider_policy_attestation"]["status"], "ok")
        self.assertEqual(plan["direct_provider_policy_attestation"]["job_identity_policy"], "synthetic-job-ref")
        self.assertFalse(plan["direct_provider_policy_attestation"]["real_file_ids_sent"])
        self.assertEqual(plan["direct_provider_policy_attestation"]["provider_data_collection_allowed_count"], 0)
        self.assertEqual(plan["schedule_policy"]["status"], "ok")
        self.assertEqual(plan["schedule_policy"]["max_campaign_parallel"], 1)
        self.assertEqual(plan["schedule_policy"]["accounts"][0]["account_ref"], "direct-api:openrouter:default")
        self.assertEqual(plan["schedule_policy"]["accounts"][0]["max_parallel"], 1)
        self.assertEqual(plan["jobs_planned"], 5)
        self.assertEqual(plan["shards"], 3)
        self.assertEqual(len(plan["shard_entries"]), 3)
        for entry in plan["shard_entries"]:
            self.assertNotIn("--execute", entry["command"])
            self.assertEqual(entry["account_ref"], "direct-api:openrouter:default")
            self.assertEqual(entry["account_max_parallel"], 1)
            self.assertEqual(entry["rate_limit_per_minute"], 30)
            self.assertIn("--state-file", entry["command"])
            self.assertIn("--max-chunks", entry["command"])
            self.assertIn("manifest_sha256", entry)
            self.assertEqual(entry["redaction_attestation"]["status"], "ok")
            self.assertEqual(entry["redaction_attestation"]["disallowed_key_hits"], 0)
            self.assertEqual(entry["direct_provider_policy"]["payload_policy"]["job_identity_policy"], "synthetic-job-ref")
            self.assertFalse(entry["direct_provider_policy"]["payload_policy"]["real_file_ids_sent"])
        plan_text = json.dumps(plan)
        self.assertNotIn("f_private_", plan_text)
        self.assertNotIn("private-0.pdf", plan_text)
        self.assertNotIn("s3://private", plan_text)
        self.assertIn("worker shard manifests are sanitized", plan["redaction"])
        self.assertEqual(shard_rows[0]["file_id"], "f_private_0")
        self.assertNotIn("private_metadata", shard_rows[0])
        self.assertNotIn("source_ref", shard_rows[0])
        self.assertNotIn("file_name", shard_rows[0])

    def test_legacy_private_worker_fields_require_explicit_flag(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            manifest = root / "manifest.jsonl"
            output = root / "campaign"
            write_manifest(manifest, 1)
            proc = self.run_planner(
                "--manifest",
                str(manifest),
                "--output-dir",
                str(output),
                "--include-private-worker-fields",
            )
            self.assertEqual(proc.returncode, 0, proc.stderr)
            plan = json.loads((output / "campaign-plan.json").read_text(encoding="utf-8"))
            shard_rows = [
                json.loads(line)
                for line in (output / "shards" / "shard-0001.jsonl").read_text(encoding="utf-8").splitlines()
                if line.strip()
            ]

        self.assertFalse(plan["worker_manifest_sanitized"])
        self.assertIn("private_metadata", shard_rows[0])
        self.assertIn("source_ref", shard_rows[0])

    def test_approved_mixed_provider_plan_adds_execute_and_provider_options(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            manifest = root / "manifest.jsonl"
            output = root / "campaign"
            pool = root / "providers.json"
            write_manifest(manifest, 4)
            pool.write_text(json.dumps({
                "providers": [
                    {
                        "name": "mimo-fast",
                        "provider": "mimo",
                        "execution_mode": "direct-api",
                        "model": "xiaomi/mimo-v2.5-pro",
                        "weight": 1,
                        "chunk_size": 2,
                        "max_chunks_per_invocation": 1,
                        "direct_max_run_cost_usd": 0.5,
                    },
                    {
                        "name": "spark-account001",
                        "provider": "spark",
                        "execution_mode": "codewith",
                        "model": "gpt-5.3-codex-spark",
                        "auth_profile": "account001",
                        "reasoning_effort": "high",
                        "weight": 1,
                        "max_parallel": 1,
                    },
                ]
            }), encoding="utf-8")
            proc = self.run_planner(
                "--manifest",
                str(manifest),
                "--output-dir",
                str(output),
                "--provider-pool",
                str(pool),
                "--jobs-per-shard",
                "2",
                "--approved",
                "--approval-note",
                "operator-approved-test",
                "--max-campaign-parallel",
                "2",
            )
            self.assertEqual(proc.returncode, 0, proc.stderr)
            plan = json.loads((output / "campaign-plan.json").read_text(encoding="utf-8"))

        self.assertTrue(plan["approved"])
        self.assertEqual(plan["status"], "approved")
        self.assertEqual(plan["approval_attestation"]["status"], "approved")
        self.assertTrue(plan["approval_attestation"]["approval_note_present"])
        self.assertRegex(plan["approval_attestation"]["approval_note_sha256"], r"^[a-f0-9]{64}$")
        self.assertEqual(plan["direct_provider_policy_attestation"]["status"], "ok")
        self.assertEqual(plan["direct_provider_policy_attestation"]["direct_provider_count"], 1)
        self.assertEqual(plan["schedule_policy"]["max_campaign_parallel"], 2)
        self.assertEqual({account["account_ref"] for account in plan["schedule_policy"]["accounts"]}, {"codewith:account001", "direct-api:openrouter:default"})
        providers = {entry["provider"]: entry for entry in plan["shard_entries"]}
        self.assertEqual(set(providers), {"mimo-fast", "spark-account001"})
        mimo_command = providers["mimo-fast"]["command"]
        spark_command = providers["spark-account001"]["command"]
        self.assertIn("--execute", mimo_command)
        self.assertIn("--direct-max-run-cost-usd", mimo_command)
        self.assertIn("--execute", spark_command)
        self.assertIn("--auth-profile", spark_command)
        self.assertIn("account001", spark_command)
        self.assertIn("--reasoning-effort", spark_command)
        self.assertIn("high", spark_command)

    def test_approved_plan_requires_note(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            manifest = root / "manifest.jsonl"
            write_manifest(manifest, 1)
            proc = self.run_planner(
                "--manifest",
                str(manifest),
                "--output-dir",
                str(root / "campaign"),
                "--approved",
            )
        self.assertNotEqual(proc.returncode, 0)
        self.assertIn("--approval-note or --approval-note-file is required", proc.stderr)

    def test_approved_plan_accepts_private_approval_note_file_without_storing_note_text(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            manifest = root / "manifest.jsonl"
            note_path = root / "approval-note.json"
            output = root / "campaign"
            write_manifest(manifest, 1)
            write_approval_note(note_path, note="private llm approval")
            proc = self.run_planner(
                "--manifest",
                str(manifest),
                "--output-dir",
                str(output),
                "--approved",
                "--approval-note-file",
                str(note_path),
            )
            self.assertEqual(proc.returncode, 0, proc.stderr)
            plan = json.loads((output / "campaign-plan.json").read_text(encoding="utf-8"))

        self.assertTrue(plan["approved"])
        self.assertIsNone(plan["approval_note"])
        self.assertEqual(plan["approval_attestation"]["approval_note_source"], "file_json")
        self.assertEqual(plan["approval_attestation"]["approval_note_decision_id"], "llm_review_campaign")
        self.assertTrue(plan["approval_attestation"]["approval_note_present"])
        self.assertRegex(plan["approval_attestation"]["approval_note_sha256"], r"^[a-f0-9]{64}$")
        self.assertNotIn("private llm approval", json.dumps(plan))


if __name__ == "__main__":
    unittest.main()
