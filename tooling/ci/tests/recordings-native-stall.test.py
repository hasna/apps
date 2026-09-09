"""Pure process-table/clock/pipe fixtures. Never starts or samples Recordings."""
import importlib.util
import os
from pathlib import Path
import stat
import struct
import subprocess
import sys
import tempfile
import threading
import unittest

SPEC = importlib.util.spec_from_file_location("stall", Path(__file__).resolve().parents[1] / "watch-recordings-native-stall.py")
stall = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = stall
SPEC.loader.exec_module(stall)

HELPER = "/fixture/toolchain/swiftpm-testing-helper"
BUNDLE = "/fixture/build/RecordingsPackageTests.xctest/Contents/MacOS/RecordingsPackageTests"
PACKAGE = "src/native/Recordings"
ROOT = stall.Identity(100, 10, 501, 1000, 123, "/bin/bash")
DRIVER = stall.Identity(200, 100, 501, 1001, 124, "/fixture/toolchain/swift-test")
TARGET = stall.Identity(300, 200, 501, 1002, 125, HELPER)
ARGV = (HELPER, "--test-bundle-path", BUNDLE, "--package-path", PACKAGE, BUNDLE, "--testing-library", "swift-testing")


class Table:
    def __init__(self):
        self.rows = {i.pid: i for i in (ROOT, DRIVER, TARGET)}
        self.arguments = {TARGET.pid: ARGV}
        self.argv_reads = []

    def identity(self, pid):
        return self.rows.get(pid)

    def children(self, pid):
        return [row.pid for row in self.rows.values() if row.ppid == pid]

    def argv(self, pid):
        self.argv_reads.append(pid)
        return self.arguments[pid]


class Clock:
    def __init__(self):
        self.now = 0
        self.on_sleep = lambda: None

    def __call__(self):
        return self.now

    def sleep(self, seconds):
        self.now += seconds
        self.on_sleep()


class WatcherContract(unittest.TestCase):
    def setUp(self):
        self.table = Table()
        self.clock = Clock()
        self.samples = []
        self.stamp = (1, 2, 100, 5)

    def sample(self, chain):
        self.samples.append((self.clock(), chain))
        return "sampled", b"fictional stack\n"

    def watch(self, stop=lambda: False, read=None, sample=None):
        return stall.watch(ROOT, self.table, HELPER, BUNDLE, PACKAGE,
                           read or (lambda: self.stamp), stop, sample or self.sample,
                           self.clock, self.clock.sleep)

    def select(self):
        return stall.select_target(self.table, ROOT, HELPER, BUNDLE, PACKAGE)

    def test_exact_owned_chain_and_arguments_only(self):
        self.assertEqual(self.select(), (ROOT, DRIVER, TARGET))
        self.assertEqual(self.table.argv_reads, [300])
        for wrong in [ARGV + ("--filter", "one"), ARGV[:-1], ARGV[:3] + ("test",) + ARGV[3:],
                      tuple("/foreign/test" if x == BUNDLE else x for x in ARGV),
                      tuple("foreign/package" if x == PACKAGE else x for x in ARGV)]:
            self.table.arguments[300] = wrong
            with self.assertRaisesRegex(stall.Refusal, "helper_arguments_mismatch"):
                self.select()

    def test_foreign_process_and_similar_executable_never_selected(self):
        foreign = stall.Identity(301, 1, 501, 1002, 126, HELPER)
        self.table.rows = {100: ROOT, 301: foreign}
        self.assertIsNone(self.select())
        self.assertEqual(self.table.argv_reads, [])
        self.table.rows[300] = stall.Identity(300, 100, 501, 1002, 126, HELPER + "-other")
        self.assertIsNone(self.select())
        self.assertEqual(self.table.argv_reads, [])

    def test_ambiguous_helpers_refused(self):
        self.table.rows[301] = stall.Identity(301, 200, 501, 1002, 126, HELPER)
        self.table.arguments[301] = ARGV
        with self.assertRaisesRegex(stall.Refusal, "ambiguous_helper"):
            self.select()

    def test_parent_birth_uid_and_ancestor_revalidation(self):
        for changed in [stall.Identity(100, 10, 501, 1000, 999, "/bin/bash"),
                        stall.Identity(200, 100, 502, 1001, 124, DRIVER.executable)]:
            with self.subTest(changed=changed.pid):
                self.table = Table()
                self.table.rows[changed.pid] = changed
                with self.assertRaises(stall.Refusal):
                    self.select()
        self.table = Table()
        original = self.table.argv
        def replaced_ancestor(pid):
            result = original(pid)
            self.table.rows[200] = stall.Identity(200, 100, 501, 1001, 999, DRIVER.executable)
            return result
        self.table.argv = replaced_ancestor
        with self.assertRaisesRegex(stall.Refusal, "ancestor_identity_changed"):
            self.select()

    def test_one_sample_only_after_ninety_seconds(self):
        result = self.watch()
        self.assertEqual(result["status"], "sampled")
        self.assertEqual([when for when, _ in self.samples], [90])
        self.assertEqual(result["ancestorPIDs"], [100, 200])
        self.assertEqual(result["targetStart"], [1002, 125])
        self.assertNotIn("executable", result)

    def test_log_progress_resets_stall_clock(self):
        def update():
            if self.clock.now == 89:
                self.stamp = (1, 2, 101, 6)
        self.clock.on_sleep = update
        self.watch()
        self.assertEqual(self.samples[0][0], 179)

    def test_late_helper_gets_full_idle_window(self):
        del self.table.rows[300]
        def start():
            if self.clock.now == 40:
                self.table.rows[300] = TARGET
        self.clock.on_sleep = start
        self.watch()
        self.assertEqual(self.samples[0][0], 130)

    def test_normal_exit_and_pid_reuse_never_sample(self):
        for replacement in [None, stall.Identity(300, 200, 501, 1002, 999, HELPER)]:
            self.setUp()
            def finish():
                if self.clock.now == 89:
                    if replacement is None:
                        self.table.rows.pop(300)
                    else:
                        self.table.rows[300] = replacement
            self.clock.on_sleep = finish
            self.assertEqual(self.watch()["status"], "target_exited_or_changed")
            self.assertEqual(self.samples, [])

    def test_stop_and_missing_log_end_without_sample(self):
        self.assertEqual(self.watch(stop=lambda: self.clock.now >= 10)["status"], "stopped_without_sample")
        self.assertEqual(self.samples, [])
        self.setUp()
        self.assertEqual(self.watch(read=lambda: None)["status"], "watch_deadline_without_sample")
        self.assertEqual(self.samples, [])
        self.assertEqual(self.clock.now, stall.WATCH_SECONDS)

    def test_change_at_sampling_boundary_resets_observation(self):
        reads = 0
        def read():
            nonlocal reads
            reads += 1
            if reads == 92:  # Initial observation plus90ticks, then immediate recheck.
                self.stamp = (1, 2, 200, 8)
            return self.stamp
        self.watch(read=read)
        self.assertEqual(self.samples[0][0], 180)

    def test_darwin_child_wrapper_returns_count_not_bytes(self):
        class FakeLib:
            def proc_listchildpids(self, pid, buffer, size):
                buffer[0], buffer[1] = 201, 202
                return 2
        inspector = object.__new__(stall.DarwinInspector)
        inspector.lib = FakeLib()
        self.assertEqual(inspector.children(100), [201, 202])

    def test_argv_decoder_discards_environment_and_rejects_truncation(self):
        data = struct.pack("=i", len(ARGV)) + HELPER.encode() + b"\0\0\0" + b"\0".join(x.encode() for x in ARGV) + b"\0PRIVATE_SENTINEL=not-an-argument\0"
        self.assertEqual(stall.parse_argv(data), ARGV)
        self.assertNotIn("PRIVATE_SENTINEL", repr(stall.parse_argv(data)))
        for invalid in [b"", struct.pack("=i", 100), data[:30]]:
            with self.assertRaises(stall.Refusal):
                stall.parse_argv(invalid)

    def test_owned_output_and_log_refuse_symlinks_fifo_and_overwrite(self):
        with tempfile.TemporaryDirectory(prefix="recordings-stall-unit-") as temp:
            root = Path(temp).resolve()
            root.chmod(0o700)
            self.assertEqual(stall.checked_directory(str(root)), root)
            path = root / "status.json"
            stall.write_new(path, b"{}")
            self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)
            with self.assertRaises(FileExistsError):
                stall.write_new(path, b"new")
            alias = root / "alias"
            alias.symlink_to(path)
            with self.assertRaises(OSError):
                stall.log_stamp(alias)
            fifo = root / "fifo"
            os.mkfifo(fifo)
            with self.assertRaisesRegex(stall.Refusal, "bounded_regular"):
                stall.log_stamp(fifo)
            self.assertEqual(stall.log_stamp(path)[2], 2)
            root.chmod(0o755)
            with self.assertRaisesRegex(stall.Refusal, "output_not_private"):
                stall.checked_directory(str(root))


class PipeChild:
    """An owned OS pipe and optional writer thread, not an executable or a PID."""
    def __init__(self, payload=None):
        read, self.writer = os.pipe()
        self.stdout = os.fdopen(read, "rb", buffering=0)
        self.returncode = None
        self.kills = 0
        self.waits = 0
        self.thread = None
        if payload is not None:
            def write():
                try:
                    with os.fdopen(self.writer, "wb", buffering=0) as output:
                        output.write(payload)
                except BrokenPipeError:
                    pass
                self.writer = None
                self.returncode = 0
            self.thread = threading.Thread(target=write)
            self.thread.start()

    def poll(self):
        return self.returncode

    def kill(self):
        self.kills += 1
        self.returncode = -9
        if self.writer is not None and self.thread is None:
            os.close(self.writer)
            self.writer = None

    def wait(self, timeout=None):
        self.waits += 1
        if self.thread:
            self.thread.join(timeout or 1)
        return self.returncode


class SampleLifecycle(unittest.TestCase):
    def collect(self, child, **options):
        def popen(argv, **kwargs):
            self.assertEqual(argv, ["/usr/bin/sample", "300", "3", "10", "-file", "/dev/stdout"])
            self.assertEqual(kwargs["env"], stall.ENV)
            self.assertEqual(kwargs["stdin"], subprocess.DEVNULL)
            return child
        return stall.collect_sample(300, options.pop("stop", lambda: False), popen=popen, **options)

    def test_success_preserves_stack_and_never_kills_completed_sample(self):
        child = PipeChild(b"fictional stack\n")
        self.assertEqual(self.collect(child), ("sampled", b"fictional stack\n"))
        self.assertEqual(child.kills, 0)
        self.assertGreater(child.waits, 0)

    def test_stop_cancels_only_owned_sampler_and_reaps(self):
        child = PipeChild()
        self.assertEqual(self.collect(child, stop=lambda: True), ("sample_cancelled", b""))
        self.assertEqual(child.kills, 1)
        self.assertEqual(child.waits, 1)

    def test_deadline_and_output_bound(self):
        child = PipeChild()
        clock = iter([0, 11]).__next__
        self.assertEqual(self.collect(child, clock=clock), ("sample_timeout", b""))
        self.assertEqual(child.kills, 1)
        self.assertEqual(child.waits, 1)
        child = PipeChild(b"x" * (stall.MAX_SAMPLE_BYTES + 1))
        status, data = self.collect(child)
        self.assertEqual(status, "sample_output_limit")
        self.assertEqual(len(data), stall.MAX_SAMPLE_BYTES)
        self.assertGreater(child.waits, 0)


class WorkflowLifecycle(unittest.TestCase):
    def test_pipeline_status_is_preserved_and_watcher_stops_on_both_paths(self):
        workflow = Path(__file__).resolve().parents[3] / ".github/workflows/recordings-macos.yml"
        text = workflow.read_text()
        selected = text.split("        id: native_tests\n", 1)[1]
        block = selected.split("        run: |\n", 1)[1].split("\n      - name:", 1)[0]
        block = "\n".join(line[10:] for line in block.splitlines())
        pipeline = "STDBUF1=L swift test --package-path src/native/Recordings 2>&1 | tee swift-test.log"
        self.assertEqual(block.count(pipeline), 1)
        for code in (0, 7):
            with self.subTest(exit_code=code), tempfile.TemporaryDirectory(prefix="recordings-stall-shell-") as temp:
                root = Path(temp).resolve()
                root.chmod(0o700)
                fake = root / "fictional-watcher.py"
                fake.write_text("""import pathlib,sys,time
out=pathlib.Path(sys.argv[sys.argv.index('--output')+1])
deadline=time.monotonic()+3
while not (out/'stop').exists() and time.monotonic()<deadline: time.sleep(.01)
(out/'fixture-status').write_text('stopped' if (out/'stop').exists() else 'deadline')
""")
                command = block.replace("../../tooling/ci/watch-recordings-native-stall.py", str(fake))
                command = command.replace(pipeline, f"/bin/sh -c 'printf fictional; exit {code}' | /usr/bin/tee swift-test.log")
                self.assertNotIn("swift test", command)
                result = subprocess.run(["/bin/bash", "--noprofile", "--norc", "-eo", "pipefail", "-c", command],
                    cwd=root, env={**stall.ENV, "HOME": str(root), "TMPDIR": str(root),
                                   "RUNNER_TEMP": str(root), "GITHUB_OUTPUT": str(root/'outputs')},
                    stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=5)
                self.assertEqual(result.returncode, code, result.stdout.decode())
                self.assertEqual((root/'swift-test.log').read_text(), 'fictional')
                outputs=(root/'outputs').read_text().strip()
                self.assertTrue(outputs.startswith('diagnostics='))
                diagnostics=Path(outputs.removeprefix('diagnostics='))
                self.assertEqual((diagnostics/'fixture-status').read_text(), 'stopped')


if __name__ == "__main__":
    unittest.main()
