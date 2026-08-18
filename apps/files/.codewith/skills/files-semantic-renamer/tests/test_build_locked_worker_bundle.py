#!/usr/bin/env python3
"""Offline tests for locked semantic-review worker bundles."""

from __future__ import annotations

import json
import runpy
import subprocess
import tempfile
import unittest
from pathlib import Path


SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "build_locked_worker_bundle.py"


def run_builder(*args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["python3", str(SCRIPT), *args],
        check=False,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )


def write_manifest(root: Path, review_payload: dict | None = None, extra_row_fields: dict | None = None) -> Path:
    review = root / "private-review.json"
    review.write_text(
        json.dumps(review_payload or {"redaction": "bounded", "review": {"status": "ready"}}),
        encoding="utf-8",
    )
    row = {
        "file_id": "f_private_bundle",
        "owner": "finance",
        "expected_ext": "pdf",
        "mime": "application/pdf",
        "size": 12345,
        "extractor_lane": "pdf",
        "content_ready": True,
        "artifact_ready": True,
        "review_artifact": str(review),
    }
    if extra_row_fields:
        row.update(extra_row_fields)
    manifest = root / "jobs.jsonl"
    manifest.write_text(json.dumps(row, sort_keys=True) + "\n", encoding="utf-8")
    return manifest


class LockedWorkerBundleTests(unittest.TestCase):
    def test_rejects_disallowed_manifest_fields_without_leaking_stdout(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            manifest = write_manifest(
                root,
                extra_row_fields={
                    "private_metadata": {"file_name": "private-name.pdf"},
                    "source_ref": "s3://private/object",
                },
            )
            bundle = root / "bundle"
            proc = run_builder("--manifest", str(manifest), "--output-dir", str(bundle), "--provider", "spark")

        self.assertEqual(proc.returncode, 0, proc.stderr)
        summary = json.loads(proc.stdout)
        self.assertEqual(summary["status"], "empty")
        self.assertEqual(summary["jobs_requested"], 1)
        self.assertEqual(summary["jobs_bundled"], 0)
        self.assertEqual(summary["by_collector_status"], {"invalid_manifest_row": 1})
        self.assertNotIn("f_private_bundle", proc.stdout)
        self.assertNotIn("private-name.pdf", proc.stdout)
        self.assertNotIn("s3://private/object", proc.stdout)

    def test_ready_bundle_contains_only_sanitized_manifest_and_command_plan(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            manifest = write_manifest(root)
            bundle = root / "bundle"
            proc = run_builder("--manifest", str(manifest), "--output-dir", str(bundle), "--provider", "mimo")
            self.assertEqual(proc.returncode, 0, proc.stderr)
            summary = json.loads(proc.stdout)
            manifest_rows = [
                json.loads(line)
                for line in (bundle / "input" / "manifest.jsonl").read_text(encoding="utf-8").splitlines()
                if line.strip()
            ]
            command = json.loads((bundle / "command.json").read_text(encoding="utf-8"))
            environment = json.loads((bundle / "environment-policy.json").read_text(encoding="utf-8"))
            integrity = json.loads((bundle / "bundle-integrity.json").read_text(encoding="utf-8"))
            runner_script = bundle / "run-worker.sh"
            runner_script_text = runner_script.read_text(encoding="utf-8")
            runner_script_exists = runner_script.exists()
            sandbox_home_exists = (bundle / "sandbox-home").exists()
            tmp_exists = (bundle / "tmp").exists()
            copied_review = bundle / "input" / manifest_rows[0]["review_artifact"]
            copied_review_exists = copied_review.exists()

        self.assertEqual(summary["status"], "ready")
        self.assertEqual(summary["kind"], "locked_worker_bundle_summary")
        self.assertTrue(summary["sanitized"])
        self.assertEqual(summary["jobs_bundled"], 1)
        self.assertEqual(summary["validation"]["status"], "ok")
        self.assertEqual(summary["validation"]["integrity"]["status"], "ok")
        self.assertEqual(summary["integrity"]["status"], "ok")
        self.assertEqual(manifest_rows[0]["file_id"], "f_private_bundle")
        self.assertEqual(manifest_rows[0]["review_artifact"], "review-artifacts/job-000001.review.json")
        self.assertTrue(copied_review_exists)
        self.assertFalse(Path(manifest_rows[0]["review_artifact"]).is_absolute())
        self.assertNotIn("private_metadata", manifest_rows[0])
        self.assertNotIn("source_ref", manifest_rows[0])
        self.assertIn("--sandbox", command["command"])
        self.assertIn("workspace-write", command["command"])
        self.assertIn("--skip-git-repo-check", command["command"])
        self.assertTrue(command["skip_git_repo_check"])
        self.assertFalse(command["git_ancestor_present"])
        self.assertFalse(command["execution_surface"]["repo_checkout_access"])
        self.assertFalse(command["execution_surface"]["database_access"])
        self.assertFalse(command["execution_surface"]["raw_download_access"])
        self.assertFalse(command["execution_surface"]["s3_object_access"])
        self.assertEqual(command["network_egress_policy"]["mode"], "provider-egress-allowlist")
        self.assertTrue(command["network_egress_policy"]["deny_by_default"])
        self.assertEqual(command["network_egress_policy"]["provider_endpoint_hosts"], ["openrouter.ai"])
        self.assertFalse(command["network_egress_policy"]["s3_object_access_allowed"])
        self.assertEqual(command["network_egress_policy"], integrity["network_egress_policy"])
        self.assertFalse(command["home_policy"]["host_home_inherited"])
        self.assertEqual(environment["home_policy"], "controlled-bundle-home")
        self.assertFalse(environment["host_home_inherited"])
        self.assertEqual(integrity["status"], "ok")
        self.assertTrue(integrity["skip_git_repo_check"])
        self.assertFalse(integrity["git_ancestor_present"])
        self.assertFalse(integrity["execution_surface"]["repo_checkout_access"])
        self.assertFalse(integrity["host_home_inherited"])
        self.assertTrue(all(not entry["path"].startswith("/") for entry in integrity["files"]))
        self.assertIn("--profile", command["command"])
        self.assertTrue(runner_script_exists)
        self.assertTrue(sandbox_home_exists)
        self.assertTrue(tmp_exists)
        self.assertIn("env -i", runner_script_text)
        self.assertIn("CODEWITH_HOME", runner_script_text)
        self.assertIn('HOME="$SANDBOX_HOME"', runner_script_text)
        self.assertIn("HOST_HOME", runner_script_text)
        self.assertNotIn('\n  HOME="${HOME:-}"', runner_script_text)
        self.assertIn("minimal_env_wrapper", command)
        self.assertNotIn("f_private_bundle", proc.stdout)

    def test_bundle_inside_git_worktree_keeps_repo_check_enabled(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            project = root / "project"
            project.mkdir()
            (project / ".git").mkdir()
            manifest = write_manifest(root)
            bundle = project / "bundle"
            proc = run_builder("--manifest", str(manifest), "--output-dir", str(bundle), "--provider", "spark")
            self.assertEqual(proc.returncode, 0, proc.stderr)
            command = json.loads((bundle / "command.json").read_text(encoding="utf-8"))
            integrity = json.loads((bundle / "bundle-integrity.json").read_text(encoding="utf-8"))

        self.assertNotIn("--skip-git-repo-check", command["command"])
        self.assertFalse(command["skip_git_repo_check"])
        self.assertTrue(command["git_ancestor_present"])
        self.assertIn("normal repository check remains enabled", command["skip_git_repo_check_justification"])
        self.assertFalse(integrity["skip_git_repo_check"])
        self.assertTrue(integrity["git_ancestor_present"])

    def test_integrity_validation_detects_tampering(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            manifest = write_manifest(root)
            bundle = root / "bundle"
            proc = run_builder("--manifest", str(manifest), "--output-dir", str(bundle), "--provider", "spark")
            self.assertEqual(proc.returncode, 0, proc.stderr)
            script_module = runpy.run_path(str(SCRIPT), run_name="bundle_module")
            (bundle / "prompt.md").write_text("tampered", encoding="utf-8")
            validation = script_module["validate_bundle"](bundle, [])  # type: ignore[index]

        self.assertEqual(validation["status"], "error")
        codes = {error["code"] for error in validation["errors"]}
        self.assertIn("integrity_validation_failed", codes)

    def test_review_artifact_with_object_marker_fails_validation_without_leaking_marker(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            manifest = write_manifest(root, review_payload={"review": {"note": "objects/sha256/private"}})
            bundle = root / "bundle"
            proc = run_builder("--manifest", str(manifest), "--output-dir", str(bundle))

        self.assertNotEqual(proc.returncode, 0)
        summary = json.loads(proc.stdout)
        self.assertEqual(summary["status"], "error")
        self.assertEqual(summary["validation"]["errors"][0]["code"], "sensitive_marker_hits")
        self.assertNotIn("objects/sha256/private", proc.stdout)

    def test_refuses_existing_output_dir_without_overwrite(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            manifest = write_manifest(root)
            bundle = root / "bundle"
            bundle.mkdir()
            (bundle / "existing.txt").write_text("x", encoding="utf-8")
            proc = run_builder("--manifest", str(manifest), "--output-dir", str(bundle))

        self.assertNotEqual(proc.returncode, 0)
        self.assertIn("--overwrite", proc.stderr)


if __name__ == "__main__":
    unittest.main()
