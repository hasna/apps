#!/usr/bin/env python3
"""Offline tests for the approval-gated LLM campaign launcher."""

from __future__ import annotations

import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PLANNER = ROOT / "scripts" / "plan_llm_review_campaign.py"
LAUNCHER = ROOT / "scripts" / "run_llm_review_campaign.py"


def write_manifest(path: Path, rows: int) -> None:
    with path.open("w", encoding="utf-8") as handle:
        for index in range(rows):
            handle.write(json.dumps({
                "file_id": f"f_private_{index}",
                "owner": "finance",
                "extractor_lane": "text",
                "expected_ext": "txt",
                "private_metadata": {"file_name": f"private-{index}.txt"},
                "source_ref": f"s3://private/object-{index}",
            }, sort_keys=True) + "\n")


def write_fake_runner(root: Path) -> None:
    runner = root / ".codewith" / "skills" / "open-files-semantic-renamer" / "scripts" / "run_llm_review_batch.py"
    runner.parent.mkdir(parents=True, exist_ok=True)
    runner.write_text(
        """#!/usr/bin/env python3
import os
import sys
blocked = [
    "AWS_ACCESS_KEY_ID",
    "AWS_SECRET_ACCESS_KEY",
    "AWS_SESSION_TOKEN",
    "OPENAI_API_KEY",
    "OPENROUTER_API_KEY",
    "XAI_API_KEY",
]
leaked = [name for name in blocked if os.environ.get(name)]
if leaked:
    print("LEAKED_ENV " + ",".join(leaked))
    sys.exit(9)
if os.environ.get("OPEN_FILES_CAMPAIGN_LAUNCHER_ENV") != "minimal-allowlist":
    print("MISSING_LAUNCHER_ENV_POLICY")
    sys.exit(8)
print("PRIVATE_WORKER_STDOUT f_private_0")
sys.stderr.write("PRIVATE_WORKER_STDERR s3://private/object-0\\n")
sys.exit(0)
""",
        encoding="utf-8",
    )


def write_global_gate(path: Path) -> None:
    path.write_text(json.dumps({
        "kind": "open_files_extraction_lane_readiness_gate",
        "status": "pending_completion",
        "gate": {
            "status": "pending_completion",
            "requires_operator_approval_before_scale": True,
            "full_extraction_complete": False,
        },
        "totals": {
            "hard_blocker_lanes": 0,
            "pending_lanes": 8,
        },
    }), encoding="utf-8")


def run_script(script: Path, *args: str, env: dict[str, str] | None = None) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["python3", str(script), *args],
        check=False,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        env=env,
    )


def plan_campaign(root: Path, approved: bool = False) -> Path:
    manifest = root / "manifest.jsonl"
    output = root / "campaign"
    write_manifest(manifest, 2)
    args = [
        "--manifest",
        str(manifest),
        "--output-dir",
        str(output),
        "--jobs-per-shard",
        "1",
        "--campaign-id",
        "launcher-test",
        "--cwd",
        str(root),
    ]
    if approved:
        args.extend(["--approved", "--approval-note", "approved-offline-test"])
    proc = run_script(PLANNER, *args)
    if proc.returncode != 0:
        raise AssertionError(proc.stderr)
    return output / "campaign-plan.json"


class CampaignLauncherTests(unittest.TestCase):
    def test_unapproved_plan_dry_run_skips_all_shards(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            plan = plan_campaign(Path(tmp), approved=False)
            proc = run_script(LAUNCHER, "--plan", str(plan))

        self.assertEqual(proc.returncode, 0, proc.stderr)
        summary = json.loads(proc.stdout)
        self.assertEqual(summary["status"], "dry_run")
        self.assertFalse(summary["approved"])
        self.assertEqual(summary["schedule_gate"]["status"], "ok")
        self.assertEqual(summary["approval_attestation"]["status"], "not_requested")
        self.assertEqual(summary["approval_attestation"]["redaction_preflight_status"], "ok")
        self.assertTrue(summary["validation"]["require_sanitized_rows"])
        self.assertFalse(summary["approval_attestation"]["runtime_enforced"])
        self.assertEqual(summary["aggregate"]["skipped"], 2)
        self.assertEqual(summary["aggregate"]["completed"], 0)
        self.assertNotIn("f_private_", proc.stdout)
        self.assertNotIn("s3://private", proc.stdout)

    def test_unapproved_plan_execute_is_refused(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            plan = plan_campaign(root, approved=False)
            gate = root / "extraction-lane-readiness-gate.json"
            write_global_gate(gate)
            proc = run_script(
                LAUNCHER,
                "--plan",
                str(plan),
                "--execute",
                "--extraction-readiness-gate",
                str(gate),
            )

        self.assertNotEqual(proc.returncode, 0)
        summary = json.loads(proc.stdout)
        self.assertEqual(summary["status"], "approval_required")
        self.assertEqual(summary["approval_attestation"]["status"], "blocked")
        self.assertEqual(summary["schedule_gate"]["status"], "ok")
        self.assertTrue(summary["approval_attestation"]["runtime_enforced"])
        self.assertFalse(summary["approval_attestation"]["plan_approved"])
        self.assertEqual(summary["approval_attestation"]["redaction_preflight_status"], "ok")
        self.assertEqual(summary["aggregate"]["skipped"], 2)
        self.assertFalse(summary["global_execution_preflight"]["allowed"])
        self.assertEqual(summary["global_execution_preflight"]["status"], "canary_approval_token_required")
        self.assertFalse(summary["global_execution_preflight"]["approval_token_valid"])

    def test_approved_execute_captures_worker_output_privately(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            write_fake_runner(root)
            plan = plan_campaign(root, approved=True)
            gate = root / "extraction-lane-readiness-gate.json"
            write_global_gate(gate)
            env = {
                **os.environ,
                "AWS_ACCESS_KEY_ID": "private-access-key",
                "AWS_SECRET_ACCESS_KEY": "private-secret-key",
                "AWS_SESSION_TOKEN": "private-session-token",
                "OPENAI_API_KEY": "private-openai-key",
                "OPENROUTER_API_KEY": "private-openrouter-key",
                "XAI_API_KEY": "private-xai-key",
            }
            proc = run_script(
                LAUNCHER,
                "--plan",
                str(plan),
                "--execute",
                "--max-shards",
                "1",
                "--extraction-readiness-gate",
                str(gate),
                env=env,
            )

            self.assertEqual(proc.returncode, 0, proc.stderr)
            summary = json.loads(proc.stdout)
            stdout_log = Path(summary["results"][0]["logs"]["stdout"])
            stderr_log = Path(summary["results"][0]["logs"]["stderr"])
            stdout_text = stdout_log.read_text(encoding="utf-8")
            stderr_text = stderr_log.read_text(encoding="utf-8")

        self.assertEqual(summary["status"], "completed")
        self.assertEqual(summary["approval_attestation"]["status"], "verified")
        self.assertTrue(summary["approval_attestation"]["plan_approved"])
        self.assertTrue(summary["approval_attestation"]["approval_note_present"])
        self.assertEqual(summary["approval_attestation"]["redaction_preflight_status"], "ok")
        self.assertRegex(summary["approval_attestation"]["approval_note_sha256"], r"^[a-f0-9]{64}$")
        self.assertTrue(summary["global_execution_preflight"]["allowed"])
        self.assertEqual(summary["global_execution_preflight"]["status"], "canary_allowed_pending_global_completion")
        self.assertTrue(summary["global_execution_preflight"]["approval_token_valid"])
        self.assertEqual(summary["aggregate"]["completed"], 1)
        self.assertEqual(summary["aggregate"]["failed"], 0)
        self.assertIn("PRIVATE_WORKER_STDOUT", stdout_text)
        self.assertIn("PRIVATE_WORKER_STDERR", stderr_text)
        self.assertNotIn("PRIVATE_WORKER_STDOUT", proc.stdout)
        self.assertNotIn("PRIVATE_WORKER_STDERR", proc.stdout)
        self.assertNotIn("LEAKED_ENV", proc.stdout)
        self.assertNotIn("f_private_", proc.stdout)
        self.assertNotIn("s3://private", proc.stdout)
        self.assertIn("environment", summary["results"][0])
        self.assertIn("OPEN_FILES_CAMPAIGN_LAUNCHER_ENV", summary["results"][0]["environment"]["allowed_keys"])
        self.assertNotIn("AWS_ACCESS_KEY_ID", summary["results"][0]["environment"]["allowed_keys"])
        self.assertNotIn("OPENAI_API_KEY", summary["results"][0]["environment"]["allowed_keys"])

    def test_launcher_rejects_parallel_above_campaign_policy(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            write_fake_runner(root)
            plan = plan_campaign(root, approved=True)
            proc = run_script(LAUNCHER, "--plan", str(plan), "--execute", "--parallel", "2")

        self.assertNotEqual(proc.returncode, 0)
        summary = json.loads(proc.stdout)
        self.assertEqual(summary["status"], "schedule_policy_violation")
        self.assertEqual(summary["schedule_gate"]["status"], "blocked")
        self.assertEqual(summary["schedule_gate"]["reason"], "parallel_exceeds_campaign_policy")
        self.assertNotIn("f_private_", proc.stdout)

    def test_approved_scale_execute_is_blocked_by_global_gate(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            write_fake_runner(root)
            plan = plan_campaign(root, approved=True)
            gate = root / "extraction-lane-readiness-gate.json"
            write_global_gate(gate)
            proc = run_script(
                LAUNCHER,
                "--plan",
                str(plan),
                "--execute",
                "--execution-scope",
                "scale",
                "--max-shards",
                "1",
                "--extraction-readiness-gate",
                str(gate),
            )

        self.assertNotEqual(proc.returncode, 0)
        summary = json.loads(proc.stdout)
        self.assertEqual(summary["status"], "global_execution_preflight_blocked")
        self.assertEqual(summary["global_execution_preflight"]["status"], "scale_blocked_by_global_gate")
        self.assertEqual(summary["aggregate"]["skipped"], 1)
        self.assertNotIn("f_private_", proc.stdout)


if __name__ == "__main__":
    unittest.main()
