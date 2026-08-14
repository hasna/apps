#!/usr/bin/env python3
"""Offline tests for archive inventory adapters."""

from __future__ import annotations

import json
import os
import subprocess
import tempfile
import unittest
import zipfile
from pathlib import Path


SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "archive_inventory.py"


def run_script(*args: str, env: dict[str, str] | None = None) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["python3", str(SCRIPT), *args],
        check=False,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        env=env,
    )


def write_executable(path: Path, text: str) -> None:
    path.write_text(text, encoding="utf-8")
    path.chmod(0o755)


class ArchiveInventoryTests(unittest.TestCase):
    def test_zip_inventory_redacts_member_names_by_default(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            archive = root / "sample.zip"
            output = root / "inventory.json"
            with zipfile.ZipFile(archive, "w") as handle:
                handle.writestr("private-folder/private-name.txt", "secret")

            proc = run_script(str(archive), "--output", str(output))

            self.assertEqual(proc.returncode, 0, proc.stderr)
            public = json.loads(proc.stdout)
            full = json.loads(output.read_text(encoding="utf-8"))

        self.assertEqual(public["status"], "ready")
        self.assertEqual(full["entry_count"], 1)
        self.assertEqual(full["entry_names"], "sha256_redacted")
        generated = proc.stdout + json.dumps(full)
        self.assertNotIn("private-folder", generated)
        self.assertNotIn("private-name", generated)
        self.assertIn("name_sha256", generated)

    def test_7z_inventory_uses_first_available_compatible_tool(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            bin_dir = root / "bin"
            bin_dir.mkdir()
            write_executable(
                bin_dir / "7za",
                """#!/usr/bin/env sh
cat <<'EOF'
Path = archive.7z

Path = nested/private-file.txt
Size = 12
Attributes = A

EOF
""",
            )
            archive = root / "archive.7z"
            archive.write_bytes(b"fake")
            output = root / "inventory.json"
            env = {**os.environ, "PATH": f"{bin_dir}:{os.environ.get('PATH', '')}"}

            proc = run_script(str(archive), "--output", str(output), env=env)
            full = json.loads(output.read_text(encoding="utf-8"))

        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertEqual(full["status"], "ready")
        self.assertEqual(full["archive_kind"], "7z")
        self.assertEqual(full["selected_tool"], "7za")
        self.assertEqual(full["entry_count"], 1)
        self.assertNotIn("private-file", proc.stdout + json.dumps(full))

    def test_rar_inventory_uses_unrar_when_available(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            bin_dir = root / "bin"
            bin_dir.mkdir()
            write_executable(
                bin_dir / "unrar",
                """#!/usr/bin/env sh
printf '%s\n' 'hidden/private-a.pdf' 'hidden/private-b.pdf'
""",
            )
            archive = root / "archive.rar"
            archive.write_bytes(b"fake")
            output = root / "inventory.json"
            env = {**os.environ, "PATH": f"{bin_dir}:{os.environ.get('PATH', '')}"}

            proc = run_script(str(archive), "--output", str(output), env=env)
            full = json.loads(output.read_text(encoding="utf-8"))

        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertEqual(full["status"], "ready")
        self.assertEqual(full["archive_kind"], "rar")
        self.assertEqual(full["selected_tool"], "unrar")
        self.assertEqual(full["entry_count"], 2)
        self.assertNotIn("private-a", proc.stdout + json.dumps(full))

    def test_missing_7z_tool_reports_candidate_tools_without_traceback(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            archive = root / "archive.7z"
            archive.write_bytes(b"fake")
            output = root / "inventory.json"
            env = {**os.environ, "PATH": "/usr/bin:/bin"}
            proc = run_script(str(archive), "--output", str(output), env=env)
            full = json.loads(output.read_text(encoding="utf-8"))

        if full["status"] == "ready":
            self.skipTest("7z-compatible tool is available on this machine")
        self.assertEqual(proc.returncode, 1)
        self.assertEqual(full["status"], "tool_required")
        self.assertEqual(full["required_tool"], "7z-compatible-list-tool")
        self.assertIn("7za", full["required_tool_candidates"])
        self.assertNotIn("Traceback", proc.stderr)


if __name__ == "__main__":
    unittest.main()
