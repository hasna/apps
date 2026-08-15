#!/usr/bin/env python3
"""Offline tests for extraction worker image verification."""

from __future__ import annotations

import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path


SCRIPT_DIR = Path(__file__).resolve().parents[1] / "scripts"
SCRIPT = SCRIPT_DIR / "verify_extraction_worker_image.py"


def load_module():
    if str(SCRIPT_DIR) not in sys.path:
        sys.path.insert(0, str(SCRIPT_DIR))
    spec = importlib.util.spec_from_file_location("verify_extraction_worker_image", SCRIPT)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"failed to load {SCRIPT}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def write_context(root: Path, dockerfile_text: str | None = None, smoke_text: str | None = None) -> tuple[Path, Path]:
    (root / "scripts").mkdir(parents=True)
    (root / "worker-image").mkdir(parents=True)
    (root / "scripts" / "archive_inventory.py").write_text("# archive\n", encoding="utf-8")
    (root / "scripts" / "extraction_tool_inventory.py").write_text("# tools\n", encoding="utf-8")
    dockerfile = root / "worker-image" / "Dockerfile"
    dockerfile.write_text(
        dockerfile_text
        or """FROM ubuntu:24.04
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates file libarchive-tools p7zip-full python3 unzip
COPY scripts/archive_inventory.py /opt/open-files/scripts/archive_inventory.py
COPY scripts/extraction_tool_inventory.py /opt/open-files/scripts/extraction_tool_inventory.py
COPY worker-image/smoke-archive-tools.sh /usr/local/bin/open-files-archive-tools-smoke
USER extractor
ENTRYPOINT [\"python3\"]
""",
        encoding="utf-8",
    )
    smoke = root / "worker-image" / "smoke-archive-tools.sh"
    smoke.write_text(
        smoke_text
        or """#!/usr/bin/env bash
7z a -bd -y /tmp/a.7z /tmp/a >/dev/null
python3 - <<'PY'
print("sha256_redacted")
print("leaked a member name")
print('"7z_inventory"')
print('"rar_inventory"')
PY
""",
        encoding="utf-8",
    )
    smoke.chmod(0o755)
    return dockerfile, smoke


class VerifyExtractionWorkerImageTests(unittest.TestCase):
    def test_static_checks_accept_archive_worker_context(self) -> None:
        verifier = load_module()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            dockerfile, smoke = write_context(root)

            result = verifier.static_checks(dockerfile, smoke, root)

        self.assertEqual(result["status"], "ok")
        self.assertTrue(result["redaction_checks"]["smoke_does_not_use_include_names"])
        self.assertTrue(result["redaction_checks"]["smoke_checks_hashed_names"])
        self.assertTrue(result["smoke_script"]["executable"])
        self.assertEqual(result["worker_runtime_policy"]["network_mode"], "none")
        self.assertTrue(result["worker_runtime_policy"]["network_disabled"])
        self.assertFalse(result["worker_runtime_policy"]["s3_object_access_allowed"])

    def test_static_checks_reject_private_name_smoke_and_missing_tools(self) -> None:
        verifier = load_module()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            dockerfile, smoke = write_context(
                root,
                dockerfile_text="FROM ubuntu:24.04\nUSER root\n",
                smoke_text="#!/usr/bin/env bash\narchive_inventory.py --include-names\n",
            )

            result = verifier.static_checks(dockerfile, smoke, root)

        self.assertEqual(result["status"], "failed")
        self.assertIn("smoke_allows_private_archive_names", result["errors"])
        self.assertIn("missing_package:p7zip-full", result["errors"])
        self.assertIn("missing_non_root_user", result["errors"])

    def test_parse_worker_inventory_requires_ready_archive_without_7z_rar_missing_blocks(self) -> None:
        verifier = load_module()

        ready = verifier.parse_worker_inventory(json.dumps({
            "lanes": {
                "needs_archive_inventory": {
                    "status": "ready",
                    "missing_blocks": [],
                }
            }
        }))
        missing = verifier.parse_worker_inventory(json.dumps({
            "lanes": {
                "needs_archive_inventory": {
                    "status": "ready",
                    "missing_blocks": ["7z_inventory"],
                }
            }
        }))

        self.assertEqual(ready["status"], "ok")
        self.assertTrue(ready["clears_7z_rar_missing_blocks"])
        self.assertEqual(missing["status"], "failed")
        self.assertFalse(missing["clears_7z_rar_missing_blocks"])

    def test_docker_run_command_disables_network_and_egress_surface(self) -> None:
        verifier = load_module()

        command = verifier.docker_run_command(
            "/usr/bin/docker",
            "open-files-extraction-worker:archive-tools",
            ["/opt/open-files/scripts/extraction_tool_inventory.py"],
        )
        policy = verifier.docker_worker_runtime_policy()

        self.assertIn("--network", command)
        self.assertIn("none", command)
        self.assertIn("--read-only", command)
        self.assertIn("--cap-drop", command)
        self.assertIn("ALL", command)
        self.assertIn("no-new-privileges", command)
        self.assertTrue(policy["network_disabled"])
        self.assertFalse(policy["provider_egress_allowed"])
        self.assertFalse(policy["s3_object_access_allowed"])
        self.assertFalse(policy["db_access_allowed"])
        self.assertTrue(policy["command_logs_hashed_only"])

    def test_verify_static_mode_does_not_require_docker_build(self) -> None:
        verifier = load_module()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            dockerfile, smoke = write_context(root)

            result = verifier.verify(
                dockerfile=dockerfile,
                context_dir=root,
                smoke_script=smoke,
                tag="test:worker",
                build=False,
                timeout=1,
                worker_inventory_output=None,
            )

        self.assertEqual(result["status"], "ok")
        self.assertIsNone(result["runtime"])
        self.assertIn("rerun_with_build_and_capture_worker_inventory", result["next_actions"])
        self.assertTrue(result["gates"]["worker_runtime_policy_attested"])
        self.assertTrue(result["gates"]["worker_runtime_network_disabled"])
        self.assertEqual(result["worker_runtime_policy"]["network_mode"], "none")
        self.assertNotIn("file_id", json.dumps(result))


if __name__ == "__main__":
    unittest.main()
