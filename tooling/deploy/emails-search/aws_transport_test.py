"""Local subprocess/descriptor controls; AWS skeletons never contact a service."""
import errno
import fcntl
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("promotion", Path(__file__).with_name("promotion.py"))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


@unittest.skipUnless(hasattr(os, "memfd_create"), "Linux memfd runner required")
class TransportControls(unittest.TestCase):
    def setUp(self):
        clean = patch.dict(os.environ, {"PATH": os.environ.get("PATH", ""), "AWS_EC2_METADATA_DISABLED": "true"}, clear=True)
        clean.start()
        self.addCleanup(clean.stop)
        self.body = {"fixture": "quoted \" value\nUnicode café", "nested": [1, {"x": True}]}
        self.fds = []

    def capture(self, command, **kwargs):
        self.assertNotIn("input", kwargs)
        self.assertEqual(kwargs["stdin"], subprocess.DEVNULL)
        self.assertEqual(kwargs["env"]["AWS_MAX_ATTEMPTS"], "1")
        self.assertEqual(len(kwargs["pass_fds"]), 1)
        fd = kwargs["pass_fds"][0]
        self.fds.append(fd)
        self.assertEqual(command[-2:], ["--cli-input-json", f"file:///proc/self/fd/{fd}"])
        self.assertNotIn(self.body["fixture"], " ".join(command))
        self.assertEqual(os.fstat(fd).st_mode & 0o777, 0o600)
        self.assertFalse(os.get_inheritable(fd))
        self.assertEqual(os.lseek(fd, 0, os.SEEK_CUR), 0)
        self.assertEqual(os.read(fd, 10000), m.encode(self.body))
        seals = fcntl.F_SEAL_WRITE | fcntl.F_SEAL_GROW | fcntl.F_SEAL_SHRINK | fcntl.F_SEAL_SEAL
        self.assertEqual(fcntl.fcntl(fd, fcntl.F_GET_SEALS), seals)
        for attempt in (lambda: os.write(fd, b"x"), lambda: os.ftruncate(fd, 0)):
            with self.assertRaises(OSError) as caught:
                attempt()
            self.assertEqual(caught.exception.errno, errno.EPERM)
        return subprocess.CompletedProcess(command, 0, b'{"accepted":true}', b"")

    def closed(self):
        for fd in self.fds:
            with self.assertRaises(OSError) as caught:
                os.fstat(fd)
            self.assertEqual(caught.exception.errno, errno.EBADF)

    def test_sealed_exact_body_no_argv_stdin_or_named_file(self):
        with patch.object(m.subprocess, "run", side_effect=self.capture) as run:
            self.assertEqual(m.aws("ecr", "put-image", body=self.body), {"accepted": True})
            self.assertEqual(run.call_count, 1)
        self.closed()

    def test_short_writes_are_completed_before_sealing(self):
        original = os.write
        with patch.object(m.os, "write", side_effect=lambda fd, data: original(fd, data[:3])):
            with patch.object(m.subprocess, "run", side_effect=self.capture):
                m.aws("ecr", "put-image", body=self.body)
        self.closed()

    def test_actual_child_reopens_only_explicit_descriptor(self):
        original = subprocess.run
        def child(command, **kwargs):
            fd = kwargs["pass_fds"][0]
            self.fds.append(fd)
            script = "import json,sys; p=sys.argv[1].removeprefix('file://'); value=json.load(open(p)); print(json.dumps({'exact':value==json.loads(sys.stdin.read())}))"
            child_args = {k: v for k, v in kwargs.items() if k != "stdin"}
            return original([sys.executable, "-I", "-B", "-c", script, command[-1]], input=m.encode(self.body), **child_args)
        with patch.object(m.subprocess, "run", side_effect=child):
            self.assertEqual(m.aws("ecr", "put-image", body=self.body), {"exact": True})
        self.closed()

    def test_actual_child_cannot_open_unpassed_descriptor(self):
        original = subprocess.run
        def child(command, **kwargs):
            fd = kwargs["pass_fds"][0]
            self.fds.append(fd)
            script = "import json,sys; p=sys.argv[1].removeprefix('file://');\ntry: open(p); result=False\nexcept OSError: result=True\nprint(json.dumps({'refused':result}))"
            return original([sys.executable, "-I", "-B", "-c", script, command[-1]], **{**kwargs, "pass_fds": ()})
        with patch.object(m.subprocess, "run", side_effect=child):
            self.assertEqual(m.aws("ecr", "put-image", body=self.body), {"refused": True})
        self.closed()

    def test_refusal_closes_and_never_retries_or_echoes_body(self):
        def refusal(command, **kwargs):
            self.capture(command, **kwargs)
            return subprocess.CompletedProcess(command, 252, b"", m.encode(self.body))
        with patch.object(m.subprocess, "run", side_effect=refusal) as run:
            with self.assertRaisesRegex(ValueError, "^AWS_OPERATION_REFUSED_OR_UNCERTAIN:ecr/put-image$"):
                m.aws("ecr", "put-image", body=self.body)
            self.assertEqual(run.call_count, 1)
        self.closed()

    def test_timeout_closes_and_never_retries(self):
        def timeout(command, **kwargs):
            self.capture(command, **kwargs)
            raise subprocess.TimeoutExpired(command, 1)
        with patch.object(m.subprocess, "run", side_effect=timeout) as run:
            with self.assertRaises(subprocess.TimeoutExpired):
                m.aws("ecr", "put-image", body=self.body, timeout=1)
            self.assertEqual(run.call_count, 1)
        self.closed()

    def test_spawn_failure_closes(self):
        def failure(command, **kwargs):
            self.capture(command, **kwargs)
            raise FileNotFoundError("fixture")
        with patch.object(m.subprocess, "run", side_effect=failure):
            with self.assertRaises(FileNotFoundError):
                m.aws("ecr", "put-image", body=self.body)
        self.closed()

    def test_invalid_response_closes(self):
        def invalid(command, **kwargs):
            self.capture(command, **kwargs)
            return subprocess.CompletedProcess(command, 0, b"invalid", b"")
        with patch.object(m.subprocess, "run", side_effect=invalid):
            with self.assertRaises(ValueError):
                m.aws("ecr", "put-image", body=self.body)
        self.closed()

    def test_failed_seal_or_zero_write_refuses_before_child_and_closes(self):
        create = os.memfd_create
        def remember(*args, **kwargs):
            fd = create(*args, **kwargs)
            self.fds.append(fd)
            return fd
        for method, failure in [("seal", OSError("fixture")), ("write", None)]:
            with self.subTest(method=method), patch.object(m.os, "memfd_create", side_effect=remember), patch.object(m.subprocess, "run") as run:
                target = patch.object(m.fcntl, "fcntl", side_effect=failure) if method == "seal" else patch.object(m.os, "write", return_value=0)
                with target, self.assertRaises((OSError, ValueError)):
                    m.aws("ecr", "put-image", body=self.body)
                run.assert_not_called()
                self.closed()

    def test_size_bound_refuses_before_descriptor_or_child(self):
        with patch.object(m.os, "memfd_create") as create, patch.object(m.subprocess, "run") as run:
            with self.assertRaisesRegex(ValueError, "^AWS_REQUEST_LIMIT$"):
                m.aws("ecr", "put-image", body={"large": "x" * (8 * 1024 * 1024)})
            create.assert_not_called()
            run.assert_not_called()

    def test_unsupported_platform_refuses_body_without_disk_fallback(self):
        with patch.object(m.os, "memfd_create", None), patch.object(m.subprocess, "run") as run:
            with self.assertRaisesRegex(ValueError, "^AWS_MEMFD_REQUIRED$"):
                m.aws("ecr", "put-image", body=self.body)
            run.assert_not_called()

    def test_no_body_needs_no_descriptor(self):
        with patch.object(m.os, "memfd_create", side_effect=AssertionError("NO_MEMFD")), patch.object(m.subprocess, "run", return_value=subprocess.CompletedProcess([], 0, b"{}", b"")) as run:
            self.assertEqual(m.aws("sts", "get-caller-identity"), {})
            self.assertEqual(run.call_args.kwargs.get("pass_fds", ()), ())
            self.assertNotIn("--cli-input-json", run.call_args.args[0])

    @unittest.skipUnless(shutil.which("aws"), "AWS CLI unavailable; descriptor controls still run")
    def test_actual_aws_skeleton_accepts_read_and_write_shapes_without_network(self):
        with tempfile.TemporaryDirectory() as home:
            env = {"PATH": os.environ.get("PATH", ""), "HOME": home, "AWS_EC2_METADATA_DISABLED": "true", "AWS_CONFIG_FILE": "/dev/null", "AWS_SHARED_CREDENTIALS_FILE": "/dev/null", "LANG": "C.UTF-8"}
            cases = [("ecr", "batch-get-image", {"repositoryName": "fixture", "imageIds": [{"imageTag": "fixture"}]}, "images"), ("ecr", "put-image", {"repositoryName": "fixture", "imageManifest": '{"schemaVersion":2}', "imageTag": "fixture"}, "image"), ("ecs", "register-task-definition", {"family": "fixture", "containerDefinitions": [{"name": "fixture", "image": "fixture:example"}]}, "taskDefinition")]
            with patch.dict(os.environ, env, clear=True):
                for service, operation, body, key in cases:
                    with self.subTest(operation=operation):
                        result = m.aws(service, operation, "--generate-cli-skeleton", "output", "--no-sign-request", "--endpoint-url", "http://127.0.0.1:9", body=body)
                        self.assertIn(key, result)
                with self.assertRaisesRegex(ValueError, "AWS_OPERATION_REFUSED_OR_UNCERTAIN"):
                    m.aws("ecr", "put-image", "--generate-cli-skeleton", "output", "--no-sign-request", "--endpoint-url", "http://127.0.0.1:9", body={"unexpected": True})


if __name__ == "__main__":
    unittest.main()
