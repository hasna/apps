"""Owned temporary files only: never reads a real release run or credentials."""
import importlib.util
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("collector", Path(__file__).resolve().parents[1] / "collect-recordings-diagnostics.py")
collector = importlib.util.module_from_spec(spec)
spec.loader.exec_module(collector)


class DiagnosticBoundary(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="recordings-diagnostic-test-")
        self.root = Path(self.temporary.name).resolve()
        self.source = self.root / "source"
        self.source.mkdir(mode=0o700)
        self.run = self.source / "recordings-release-gate-fixture"
        self.run.mkdir(mode=0o700)
        self.output = self.root / "output"

    def tearDown(self):
        self.temporary.cleanup()

    def test_copies_only_top_level_logs_and_xml_without_changing_bytes(self):
        (self.run / "ordinary.log").write_bytes(b"fictional failure\n")
        (self.run / "ordinary.xml").write_bytes(b"<testsuites/>\n")
        (self.run / "suite.log").write_bytes(b"fixture summary\n")
        (self.run / "credentials").write_text("fictional fixture; must not be retained")
        (self.run / "ordinary-environment").mkdir()
        (self.run / "ordinary-environment" / "private.log").write_text("nested fixture; must not be retained")
        count, size = collector.collect(self.source, self.output)
        self.assertEqual(count, 3)
        self.assertEqual(size, sum((self.run / name).stat().st_size for name in ["ordinary.log", "ordinary.xml", "suite.log"]))
        actual = sorted(path.relative_to(self.output).as_posix() for path in self.output.rglob("*") if path.is_file())
        self.assertEqual(actual, [self.run.name + "/" + name for name in ["ordinary.log", "ordinary.xml", "suite.log"]])
        for name in ["ordinary.log", "ordinary.xml", "suite.log"]:
            target = self.output / self.run.name / name
            self.assertEqual(target.read_bytes(), (self.run / name).read_bytes())
            self.assertEqual(target.stat().st_mode & 0o777, 0o600)

    def test_empty_run_keeps_an_empty_diagnostics_directory(self):
        self.assertEqual(collector.collect(self.source, self.output), (0, 0))
        self.assertEqual(list(self.output.iterdir()), [])

    def test_rejects_linked_roots_reports_and_files_without_creating_output(self):
        link = self.root / "source-link"
        link.symlink_to(self.source, target_is_directory=True)
        with self.assertRaises(ValueError):
            collector.collect(link, self.output)
        for kind in ["symlink", "hardlink", "fifo"]:
            target = self.run / "ordinary.log"
            fixture = self.root / (kind + "-fixture")
            fixture.write_text("fictional outside fixture")
            if kind == "symlink": target.symlink_to(fixture)
            elif kind == "hardlink": os.link(fixture, target)
            else: os.mkfifo(target)
            with self.subTest(kind=kind), self.assertRaises(ValueError):
                collector.collect(self.source, self.output)
            self.assertFalse(self.output.exists())
            target.unlink()
        self.run.rmdir()
        self.run.symlink_to(self.root, target_is_directory=True)
        with self.assertRaises(ValueError):
            collector.collect(self.source, self.output)
        self.assertFalse(self.output.exists())

    def test_refuses_insecure_roots_and_existing_destinations(self):
        self.source.chmod(0o755)
        with self.assertRaises(ValueError): collector.collect(self.source, self.output)
        self.source.chmod(0o700)
        self.output.mkdir()
        (self.output / "preserve").write_text("existing fixture")
        with self.assertRaises(FileExistsError): collector.collect(self.source, self.output)
        self.assertEqual((self.output / "preserve").read_text(), "existing fixture")

    def test_file_total_and_entry_limits_fail_before_any_copy(self):
        (self.run / "ordinary.log").write_bytes(b"12345")
        (self.run / "suite.log").write_bytes(b"12345")
        for setting, limit in [("MAX_FILE_BYTES", 4), ("MAX_TOTAL_BYTES", 9), ("MAX_FILES", 1), ("MAX_DIRECTORY_ENTRIES", 1)]:
            with self.subTest(setting=setting), patch.object(collector, setting, limit), self.assertRaises(ValueError):
                collector.collect(self.source, self.output)
            self.assertFalse(self.output.exists())


if __name__ == "__main__": unittest.main()
