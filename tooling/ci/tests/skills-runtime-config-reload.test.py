"""Offline provenance and image reuse fixtures: no GitHub, AWS or Docker calls."""
import copy
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
import zipfile

spec = importlib.util.spec_from_file_location("reload", Path(__file__).resolve().parents[1] / "skills-runtime-config-reload.py")
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
SOURCE, CONTROLLER, RUN = "a" * 40, "b" * 40, 123
MANIFEST = json.dumps({"schemaVersion": 2, "mediaType": "application/vnd.oci.image.manifest.v1+json", "config": {"digest": "sha256:" + "c" * 64}, "layers": []})
DIGEST = m.sha(MANIFEST.encode())
RUNTIME = "sha256:" + "d" * 64


class ProvenanceTests(unittest.TestCase):
    def setUp(self):
        self.run = {"id": RUN, "path": m.WORKFLOW, "event": "workflow_run", "head_branch": "main", "head_sha": SOURCE, "status": "completed", "conclusion": "success", "run_attempt": 1}
        self.steps = [{"name": name, "number": index + 1, "status": "completed", "conclusion": "success", "started_at": "2026-09-13T00:00:10Z", "completed_at": "2026-09-13T00:00:20Z"} for index, name in enumerate(m.API_STEPS)]
        self.jobs = [{"id": index + 1, "name": name, "status": "completed", "conclusion": "success", "steps": self.steps if name == m.API_JOB else []} for index, name in enumerate([m.GATE_JOB, m.API_JOB, m.RUNTIME_JOB])]
        self.gate_log = f"2026-09-13T00:00:01.1234567Z   RUN_HEAD_SHA: {SOURCE}\n".encode()
        self.log = (f"2026-09-13T00:00:01.0Z #2 FROM base@sha256:{'e' * 64}\n"
                    '2026-09-13T00:00:10.1Z \x1b[36;1mIMAGE="${ECR_URL}:${SOURCE_SHA}"\x1b[0m\n'
                    '2026-09-13T00:00:10.2Z docker tag "${LOCAL_IMAGE}:${SOURCE_SHA}" "${IMAGE}"\n'
                    '2026-09-13T00:00:10.3Z docker push "${IMAGE}"\n'
                    f"2026-09-13T00:00:20.3968754Z {SOURCE}: digest: {DIGEST} size: 3454\n").encode()
        self.runtime = {"sourceSha": SOURCE, "architecture": "ARM64", "imageDigest": RUNTIME, "critical": 0, "high": 0}
        self.artifact = {"id": 4, "name": "skills-runtime-image-" + SOURCE, "expired": False, "workflow_run": {"id": RUN, "head_sha": SOURCE}}
        self.repack()
        self.changed = "\0".join(sorted(m.CONTROLLER_FILES)) + "\0"
        self.calls = []
    def repack(self):
        data = io.BytesIO()
        with zipfile.ZipFile(data, "w") as archive:
            archive.writestr(zipfile.ZipInfo("runtime-image-receipt.json", date_time=(2026, 9, 13, 0, 0, 0)), json.dumps(self.runtime))
        self.archive = data.getvalue()
        self.artifact["digest"] = m.sha(self.archive)
    def git(self, *args):
        if args == ("rev-parse", "HEAD"):
            return CONTROLLER.encode()
        if args == ("merge-base", "--is-ancestor", SOURCE, CONTROLLER):
            return b""
        if args == ("diff", "--no-renames", "--name-only", "-z", SOURCE, CONTROLLER):
            return self.changed.encode()
        raise AssertionError("unreviewed git command")
    def fetch(self, path, binary=False):
        self.calls.append(path)
        base = f"repos/hasna/apps/actions/runs/{RUN}"
        if path == base:
            return copy.deepcopy(self.run)
        if path == base + "/attempts/1/jobs?per_page=100":
            return {"total_count": len(self.jobs), "jobs": copy.deepcopy(self.jobs)}
        if path == "repos/hasna/apps/actions/jobs/1/logs":
            return self.gate_log
        if path == "repos/hasna/apps/actions/jobs/2/logs":
            return self.log
        if path == base + "/artifacts?per_page=100":
            return {"total_count": 1, "artifacts": [copy.deepcopy(self.artifact)]}
        if path == "repos/hasna/apps/actions/artifacts/4/zip":
            return self.archive
        raise AssertionError("unexpected remote read")
    def verify(self):
        return m.verify_provenance(CONTROLLER, SOURCE, RUN, DIGEST, self.fetch, self.git)
    def test_completed_publication_binds_exact_push_and_runtime_digests(self):
        proof = self.verify()
        self.assertEqual(proof["apiImageDigest"], DIGEST)
        self.assertEqual(proof["runtimeImageDigest"], RUNTIME)
        self.assertTrue(proof["buildInputsIdentical"])
        self.assertEqual(proof["priorApiLogSha256"], m.sha(self.log))
    def test_package_lock_or_unreviewed_controller_changes_refuse_before_github(self):
        for name in ["apps/skills/Dockerfile", "apps/skills/src/server/index.ts", "bun.lock", "package.json", "turbo.json", "tooling/ci/other.py", "AGENTS.md"]:
            self.changed = name + "\0"
            with self.subTest(name=name), self.assertRaisesRegex(m.Refusal, "RELEASE_BUILD_INPUTS_CHANGED"):
                self.verify()
        self.assertEqual(self.calls, [])
    def test_wrong_checkout_or_nonancestor_refuses_before_github(self):
        with self.assertRaisesRegex(m.Refusal, "CONTROLLER_CHECKOUT_MISMATCH"):
            m.verify_provenance(CONTROLLER, SOURCE, RUN, DIGEST, self.fetch, lambda *args: b"c" * 40)
        def unrelated(*args):
            if args[0] == "merge-base":
                raise m.Refusal("NOT_ANCESTOR")
            return self.git(*args)
        with self.assertRaisesRegex(m.Refusal, "NOT_ANCESTOR"):
            m.verify_provenance(CONTROLLER, SOURCE, RUN, DIGEST, self.fetch, unrelated)
        self.assertEqual(self.calls, [])
    def test_manual_prior_run_other_source_or_wrong_workflow_refused(self):
        for field, value in [("event", "workflow_dispatch"), ("head_sha", "c" * 40), ("path", ".github/workflows/other.yml"), ("head_branch", "branch")]:
            original = self.run[field]
            self.run[field] = value
            with self.subTest(field=field), self.assertRaisesRegex(m.Refusal, "PRIOR_AUTOMATIC_RELEASE_MISMATCH"):
                self.verify()
            self.run[field] = original
    def test_incomplete_or_failed_full_run_refused(self):
        for field, value in [("status", "in_progress"), ("conclusion", "failure")]:
            original = self.run[field]
            self.run[field] = value
            with self.assertRaisesRegex(m.Refusal, "PRIOR_RUN_NOT_SUCCESSFUL"):
                self.verify()
            self.run[field] = original
    def test_skipped_runtime_job_or_missing_scan_step_refused(self):
        self.jobs[2]["conclusion"] = "skipped"
        with self.assertRaisesRegex(m.Refusal, "PRIOR_JOB_NOT_SUCCESSFUL"):
            self.verify()
        self.jobs[2]["conclusion"] = "success"
        self.steps[3]["conclusion"] = "skipped"
        with self.assertRaisesRegex(m.Refusal, "PRIOR_STEP_NOT_SUCCESSFUL"):
            self.verify()
    def test_credentials_before_scan_or_duplicate_step_refused(self):
        self.steps[3]["number"], self.steps[4]["number"] = self.steps[4]["number"], self.steps[3]["number"]
        with self.assertRaisesRegex(m.Refusal, "PRIOR_SCAN_DEPLOY_ORDER_INVALID"):
            self.verify()
        self.steps.append(copy.deepcopy(self.steps[0]))
        with self.assertRaisesRegex(m.Refusal, "PRIOR_STEP_NOT_SUCCESSFUL"):
            self.verify()
    def test_prior_ci_gate_must_bind_the_release(self):
        self.gate_log = self.gate_log.replace(SOURCE.encode(), b"e" * 40)
        with self.assertRaisesRegex(m.Refusal, "PRIOR_CI_GATE_SOURCE_MISMATCH"):
            self.verify()
    def test_tag_without_push_digest_or_unrelated_digest_is_insufficient(self):
        self.log = self.log.replace(f"{SOURCE}: digest:".encode(), b"base: digest:")
        with self.assertRaisesRegex(m.Refusal, "UNIQUE_PUSHED_DIGEST_REQUIRED"):
            self.verify()
    def test_digest_outside_successful_push_step_refused(self):
        self.log = self.log.replace(b"00:00:20.3968754Z", b"00:01:20.3968754Z")
        with self.assertRaisesRegex(m.Refusal, "DIGEST_OUTSIDE_PUSH_STEP"):
            self.verify()
    def test_duplicate_push_digest_or_wrong_expected_digest_refused(self):
        original = self.log
        self.log += self.log.splitlines(keepends=True)[-1]
        with self.assertRaisesRegex(m.Refusal, "UNIQUE_PUSHED_DIGEST_REQUIRED"):
            self.verify()
        self.log = original
        with self.assertRaisesRegex(m.Refusal, "PRIOR_PUSHED_DIGEST_MISMATCH"):
            m.verify_provenance(CONTROLLER, SOURCE, RUN, RUNTIME, self.fetch, self.git)
    def test_push_commands_cannot_be_replaced_by_an_echoed_digest(self):
        self.log = self.log.replace(b'docker push "${IMAGE}"', b'echo pretend-push')
        with self.assertRaisesRegex(m.Refusal, "PUSH_COMMAND_BINDING_MISSING"):
            self.verify()
    def test_expired_cross_run_or_modified_runtime_artifact_refused(self):
        self.artifact["expired"] = True
        with self.assertRaisesRegex(m.Refusal, "PRIOR_RUNTIME_ARTIFACT_MISSING"):
            self.verify()
        self.artifact["expired"] = False
        self.artifact["workflow_run"]["id"] = 999
        with self.assertRaisesRegex(m.Refusal, "PRIOR_RUNTIME_ARTIFACT_RUN_MISMATCH"):
            self.verify()
        self.artifact["workflow_run"]["id"] = RUN
        self.artifact["digest"] = RUNTIME
        with self.assertRaisesRegex(m.Refusal, "RUNTIME_ARTIFACT_DIGEST_MISMATCH"):
            self.verify()
    def test_runtime_source_architecture_and_actual_integer_scan_gate(self):
        for field, value in [("sourceSha", "e" * 40), ("architecture", "X86_64"), ("critical", 1), ("high", False)]:
            original = self.runtime[field]
            self.runtime[field] = value
            self.repack()
            with self.subTest(field=field), self.assertRaises(m.Refusal):
                self.verify()
            self.runtime[field] = original


class ImageTests(unittest.TestCase):
    def setUp(self):
        self.repository = "123456789012.dkr.ecr.us-east-1.amazonaws.com/example"
        self.environment = {"HASNA_SKILLS_RUNTIME_CONFIG": json.dumps({"imageDigest": RUNTIME, "taskDefinition": "reviewed-revision", "reviewedBundles": [{"slug": "fixture"}]})}
        self.image = {"registryId": "123456789012", "repositoryName": "example", "imageId": {"imageTag": SOURCE, "imageDigest": DIGEST}, "imageManifest": MANIFEST}
        self.calls = []
        self.env = patch.dict(os.environ, {"AWS_REGION": "us-east-1"})
        self.env.start()
    def tearDown(self):
        self.env.stop()
    def aws(self, args):
        self.calls.append(args)
        if args[:2] == ["sts", "get-caller-identity"]:
            return "123456789012"
        if args[:2] == ["ecr", "batch-get-image"]:
            return {"images": [copy.deepcopy(self.image)]}
        raise AssertionError("AWS mutation or unrelated read refused")
    def resolve(self):
        return m.resolve_image(self.repository, SOURCE, DIGEST, RUNTIME, self.environment, self.aws)
    def test_exact_published_manifest_reused_by_digest_with_reads_only(self):
        self.assertEqual(self.resolve(), self.repository + "@" + DIGEST)
        self.assertEqual([args[:2] for args in self.calls], [["sts", "get-caller-identity"], ["ecr", "batch-get-image"]])
    def test_runtime_config_must_use_the_prior_published_runtime(self):
        self.environment = {"HASNA_SKILLS_RUNTIME_CONFIG": json.dumps({"imageDigest": DIGEST})}
        with self.assertRaisesRegex(m.Refusal, "ACTIVATED_RUNTIME_IMAGE_MISMATCH"):
            self.resolve()
        self.assertEqual(len(self.calls), 1)
    def test_changed_tag_mapping_or_manifest_bytes_refused(self):
        self.image["imageId"]["imageDigest"] = RUNTIME
        with self.assertRaisesRegex(m.Refusal, "PUBLISHED_API_IMAGE_IDENTITY_MISMATCH"):
            self.resolve()
        self.image["imageId"]["imageDigest"] = DIGEST
        self.image["imageManifest"] += " "
        with self.assertRaisesRegex(m.Refusal, "PUBLISHED_API_MANIFEST_DIGEST_MISMATCH"):
            self.resolve()
    def test_account_or_repository_authority_mismatch_refused(self):
        with self.assertRaisesRegex(m.Refusal, "RELOAD_ACCOUNT_MISMATCH"):
            m.resolve_image(self.repository, SOURCE, DIGEST, RUNTIME, self.environment, lambda args: "999999999999")
        self.repository = "https://unrelated.example/image"
        with self.assertRaisesRegex(m.Refusal, "RELOAD_IMAGE_REFERENCE_INVALID"):
            self.resolve()
        self.assertEqual(self.calls, [])


class ModeTests(unittest.TestCase):
    def invoke(self, environment):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / "output"
            with patch.dict(os.environ, {"GITHUB_OUTPUT": str(target), **environment}, clear=True), patch.object(sys, "argv", ["controller", "gate"]), patch.object(m, "command", side_effect=AssertionError("EXTERNAL_ACCESS_FORBIDDEN")):
                m.main()
            return target.read_text()
    def test_normal_deployment_requires_no_prior_release_or_extra_reads(self):
        self.assertEqual(self.invoke({"GITHUB_EVENT_NAME": "workflow_run"}), "reload_runtime_config=false\n")
    def test_runtime_reuse_without_explicit_reload_refuses_before_credentials(self):
        with self.assertRaisesRegex(m.Refusal, "RUNTIME_REUSE_REQUIRES_RELOAD_MODE"):
            self.invoke({"GITHUB_EVENT_NAME": "workflow_dispatch", "PUBLISH_RUNTIME_IMAGE": "false"})
    def test_inputs_without_mode_refused(self):
        with self.assertRaisesRegex(m.Refusal, "RELOAD_INPUTS_REQUIRE_MODE"):
            self.invoke({"RELOAD_SOURCE_SHA": SOURCE})
    def test_reload_requires_manual_main_and_runtime_publication_disabled(self):
        env = {"RELOAD_RUNTIME_CONFIG": "true", "GITHUB_EVENT_NAME": "workflow_dispatch", "GITHUB_REF": "refs/heads/main", "GITHUB_REPOSITORY": "hasna/apps", "PUBLISH_RUNTIME_IMAGE": "true"}
        with self.assertRaisesRegex(m.Refusal, "RELOAD_MUST_REUSE_RUNTIME_IMAGE"):
            self.invoke(env)
        env.update(PUBLISH_RUNTIME_IMAGE="false", GITHUB_REF="refs/heads/branch")
        with self.assertRaisesRegex(m.Refusal, "RELOAD_REQUIRES_MANUAL_MAIN"):
            self.invoke(env)


if __name__ == "__main__":
    unittest.main(verbosity=2)
