#!/usr/bin/env python3
"""Offline tests for locked worker bundle verification."""

from __future__ import annotations

import json
import subprocess
import tempfile
import unittest
from pathlib import Path

from test_build_locked_worker_bundle import SCRIPT as BUILDER
from test_build_locked_worker_bundle import write_manifest


SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "verify_locked_worker_bundle.py"


def run_script(script: Path, *args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["python3", str(script), *args],
        check=False,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )


class VerifyLockedWorkerBundleTests(unittest.TestCase):
    def test_verifies_ready_bundle_without_private_stdout(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            manifest = write_manifest(root)
            bundle = root / "bundle"
            build_proc = run_script(BUILDER, "--manifest", str(manifest), "--output-dir", str(bundle), "--provider", "spark")
            self.assertEqual(build_proc.returncode, 0, build_proc.stderr)
            proc = run_script(SCRIPT, "--bundle-dir", str(bundle), "--output", str(bundle / "locked-worker-bundle-verification.json"))
            summary = json.loads(proc.stdout)

        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertEqual(summary["status"], "ok")
        self.assertTrue(summary["gates"]["no_sandbox_bypass"])
        self.assertTrue(summary["gates"]["skip_git_repo_check_policy_valid"])
        self.assertTrue(summary["gates"]["controlled_home_tmp"])
        self.assertTrue(summary["gates"]["no_secret_env_allowed"])
        self.assertTrue(summary["gates"]["execution_surface_attested"])
        self.assertTrue(summary["gates"]["network_egress_policy_attested"])
        self.assertEqual(summary["network_egress_policy"]["mode"], "provider-egress-allowlist")
        self.assertTrue(summary["network_egress_policy"]["deny_by_default"])
        self.assertEqual(summary["network_egress_policy"]["provider_endpoint_hosts"], ["api.openai.com"])
        self.assertEqual(summary["network_egress_policy"]["allowed_purposes"], ["model_inference_only"])
        self.assertFalse(summary["network_egress_policy"]["s3_object_access_allowed"])
        self.assertEqual(summary["network_egress_policy"]["provider_data_collection"], "deny")
        self.assertEqual(summary["allowed_writable_dirs"], ["output", "sandbox-home", "tmp"])
        self.assertTrue(summary["skip_git_repo_check"])
        self.assertNotIn("f_private_bundle", proc.stdout)

    def test_verifies_git_worktree_bundle_without_skip_git_flag(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            project = root / "project"
            project.mkdir()
            (project / ".git").mkdir()
            manifest = write_manifest(root)
            bundle = project / "bundle"
            build_proc = run_script(BUILDER, "--manifest", str(manifest), "--output-dir", str(bundle), "--provider", "spark")
            self.assertEqual(build_proc.returncode, 0, build_proc.stderr)
            proc = run_script(SCRIPT, "--bundle-dir", str(bundle))
            summary = json.loads(proc.stdout)

        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertTrue(summary["git_ancestor_present"])
        self.assertFalse(summary["skip_git_repo_check"])
        self.assertTrue(summary["gates"]["skip_git_repo_check_policy_valid"])

    def test_rejects_sandbox_bypass_in_command(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            manifest = write_manifest(root)
            bundle = root / "bundle"
            build_proc = run_script(BUILDER, "--manifest", str(manifest), "--output-dir", str(bundle), "--provider", "spark")
            self.assertEqual(build_proc.returncode, 0, build_proc.stderr)
            command_path = bundle / "command.json"
            command = json.loads(command_path.read_text(encoding="utf-8"))
            command["command"].append("--dangerously-bypass-approvals-and-sandbox")
            command_path.write_text(json.dumps(command, indent=2, sort_keys=True), encoding="utf-8")
            proc = run_script(SCRIPT, "--bundle-dir", str(bundle))
            summary = json.loads(proc.stdout)

        self.assertNotEqual(proc.returncode, 0)
        codes = {error["code"] for error in summary["errors"]}
        self.assertIn("sandbox_bypass_present", codes)

    def test_rejects_secret_env_allowlist(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            manifest = write_manifest(root)
            bundle = root / "bundle"
            build_proc = run_script(BUILDER, "--manifest", str(manifest), "--output-dir", str(bundle), "--provider", "spark")
            self.assertEqual(build_proc.returncode, 0, build_proc.stderr)
            env_path = bundle / "environment-policy.json"
            env = json.loads(env_path.read_text(encoding="utf-8"))
            env["allowed_keys"].append("AWS_SECRET_ACCESS_KEY")
            env_path.write_text(json.dumps(env, indent=2, sort_keys=True), encoding="utf-8")
            proc = run_script(SCRIPT, "--bundle-dir", str(bundle))
            summary = json.loads(proc.stdout)

        self.assertNotEqual(proc.returncode, 0)
        codes = {error["code"] for error in summary["errors"]}
        self.assertIn("secret_env_allowed", codes)
        self.assertNotIn("AWS_SECRET_ACCESS_KEY", proc.stderr)

    def test_rejects_execution_surface_repo_access(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            manifest = write_manifest(root)
            bundle = root / "bundle"
            build_proc = run_script(BUILDER, "--manifest", str(manifest), "--output-dir", str(bundle), "--provider", "spark")
            self.assertEqual(build_proc.returncode, 0, build_proc.stderr)
            command_path = bundle / "command.json"
            command = json.loads(command_path.read_text(encoding="utf-8"))
            command["execution_surface"]["repo_checkout_access"] = True
            command_path.write_text(json.dumps(command, indent=2, sort_keys=True), encoding="utf-8")
            proc = run_script(SCRIPT, "--bundle-dir", str(bundle))
            summary = json.loads(proc.stdout)

        self.assertNotEqual(proc.returncode, 0)
        self.assertFalse(summary["gates"]["execution_surface_attested"])
        codes = {error["code"] for error in summary["errors"]}
        self.assertIn("execution_surface_policy_failed", codes)

    def test_rejects_network_egress_policy_s3_access(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            manifest = write_manifest(root)
            bundle = root / "bundle"
            build_proc = run_script(BUILDER, "--manifest", str(manifest), "--output-dir", str(bundle), "--provider", "spark")
            self.assertEqual(build_proc.returncode, 0, build_proc.stderr)
            command_path = bundle / "command.json"
            command = json.loads(command_path.read_text(encoding="utf-8"))
            command["network_egress_policy"]["s3_object_access_allowed"] = True
            command_path.write_text(json.dumps(command, indent=2, sort_keys=True), encoding="utf-8")
            proc = run_script(SCRIPT, "--bundle-dir", str(bundle))
            summary = json.loads(proc.stdout)

        self.assertNotEqual(proc.returncode, 0)
        self.assertFalse(summary["gates"]["network_egress_policy_attested"])
        codes = {error["code"] for error in summary["errors"]}
        self.assertIn("network_egress_policy_failed", codes)

    def test_rejects_network_egress_policy_wildcard_host(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            manifest = write_manifest(root)
            bundle = root / "bundle"
            build_proc = run_script(BUILDER, "--manifest", str(manifest), "--output-dir", str(bundle), "--provider", "spark")
            self.assertEqual(build_proc.returncode, 0, build_proc.stderr)
            integrity_path = bundle / "bundle-integrity.json"
            integrity = json.loads(integrity_path.read_text(encoding="utf-8"))
            integrity["network_egress_policy"]["provider_endpoint_hosts"] = ["*"]
            integrity_path.write_text(json.dumps(integrity, indent=2, sort_keys=True), encoding="utf-8")
            proc = run_script(SCRIPT, "--bundle-dir", str(bundle))
            summary = json.loads(proc.stdout)

        self.assertNotEqual(proc.returncode, 0)
        self.assertFalse(summary["gates"]["network_egress_policy_attested"])
        codes = {error["code"] for error in summary["errors"]}
        self.assertIn("network_egress_policy_failed", codes)

    def test_rejects_skip_git_policy_mismatch(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            project = root / "project"
            project.mkdir()
            (project / ".git").mkdir()
            manifest = write_manifest(root)
            bundle = project / "bundle"
            build_proc = run_script(BUILDER, "--manifest", str(manifest), "--output-dir", str(bundle), "--provider", "spark")
            self.assertEqual(build_proc.returncode, 0, build_proc.stderr)
            command_path = bundle / "command.json"
            command = json.loads(command_path.read_text(encoding="utf-8"))
            command["command"].append("--skip-git-repo-check")
            command["skip_git_repo_check"] = True
            command_path.write_text(json.dumps(command, indent=2, sort_keys=True), encoding="utf-8")
            proc = run_script(SCRIPT, "--bundle-dir", str(bundle))
            summary = json.loads(proc.stdout)

        self.assertNotEqual(proc.returncode, 0)
        self.assertFalse(summary["gates"]["skip_git_repo_check_policy_valid"])
        codes = {error["code"] for error in summary["errors"]}
        self.assertIn("skip_git_policy_invalid", codes)


if __name__ == "__main__":
    unittest.main()
