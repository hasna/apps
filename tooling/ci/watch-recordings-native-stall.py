#!/usr/bin/python3
"""One CI-only stack sample; never changes or signals the native test process."""
import argparse
import ctypes
from dataclasses import dataclass
import hashlib
import json
import os
from pathlib import Path
import selectors
import stat
import struct
import subprocess
import sys
import time

IDLE_SECONDS = 90
WATCH_SECONDS = 660
SAMPLE_SECONDS = 3
SAMPLE_TIMEOUT = 10
MAX_SAMPLE_BYTES = 2 * 1024 * 1024
MAX_LOG_BYTES = 32 * 1024 * 1024
ENV = {"PATH": "/usr/bin:/bin:/usr/sbin:/sbin", "LANG": "C", "LC_ALL": "C"}


class Refusal(Exception):
    """Only constant, nonsecret reason codes are emitted."""


@dataclass(frozen=True)
class Identity:
    pid: int
    ppid: int
    uid: int
    start_seconds: int
    start_microseconds: int
    executable: str


class BSDInfo(ctypes.Structure):
    # Darwin sys/proc_info.h: PROC_PIDTBSDINFO, including microsecond birth time.
    _fields_ = [(name, ctypes.c_uint32) for name in (
        "flags", "status", "xstatus", "pid", "ppid", "uid", "gid", "ruid", "rgid",
        "svuid", "svgid", "reserved",
    )] + [("comm", ctypes.c_char * 16), ("name", ctypes.c_char * 32)] + [
        (name, ctypes.c_uint32) for name in ("nfiles", "pgid", "jobc", "tdev", "tpgid")
    ] + [("nice", ctypes.c_int32), ("start_seconds", ctypes.c_uint64),
         ("start_microseconds", ctypes.c_uint64)]


def parse_argv(data):
    """KERN_PROCARGS2: parse exactly argc arguments; never retain environment."""
    if len(data) < 5:
        raise Refusal("argv_unavailable")
    argc = struct.unpack_from("=i", data)[0]
    if not 1 <= argc <= 32:
        raise Refusal("argv_count")
    end = data.find(b"\0", 4)
    if end < 0:
        raise Refusal("argv_unavailable")
    offset = end + 1
    while offset < len(data) and data[offset] == 0:
        offset += 1
    result = []
    for _ in range(argc):
        end = data.find(b"\0", offset)
        if end < 0:
            raise Refusal("argv_unavailable")
        result.append(os.fsdecode(data[offset:end]))
        offset = end + 1
    return tuple(result)


class DarwinInspector:
    def __init__(self):
        self.lib = ctypes.CDLL("/usr/lib/libproc.dylib", use_errno=True)
        self.lib.proc_pidinfo.argtypes = [ctypes.c_int, ctypes.c_int, ctypes.c_uint64, ctypes.c_void_p, ctypes.c_int]
        self.lib.proc_pidpath.argtypes = [ctypes.c_int, ctypes.c_void_p, ctypes.c_uint32]
        self.lib.proc_listchildpids.argtypes = [ctypes.c_int, ctypes.c_void_p, ctypes.c_int]
        self.sys = ctypes.CDLL("/usr/lib/libSystem.B.dylib", use_errno=True)
        self.sys.sysctl.argtypes = [ctypes.POINTER(ctypes.c_int), ctypes.c_uint, ctypes.c_void_p,
                                   ctypes.POINTER(ctypes.c_size_t), ctypes.c_void_p, ctypes.c_size_t]

    def identity(self, pid):
        info = BSDInfo()
        if self.lib.proc_pidinfo(pid, 3, 0, ctypes.byref(info), ctypes.sizeof(info)) != ctypes.sizeof(info):
            return None
        path = ctypes.create_string_buffer(4096)
        if self.lib.proc_pidpath(pid, path, len(path)) <= 0 or info.pid != pid:
            return None
        return Identity(pid, info.ppid, info.uid, info.start_seconds, info.start_microseconds,
                        os.fsdecode(path.value))

    def children(self, pid):
        result = (ctypes.c_int * 256)()
        ctypes.set_errno(0)
        count = self.lib.proc_listchildpids(pid, result, ctypes.sizeof(result))
        # Unlike proc_listpids, this wrapper returns a PID count, not byte count.
        if count < 0 or count >= len(result) or (count == 0 and ctypes.get_errno()):
            raise Refusal("process_inventory_unavailable")
        return [value for value in result[:count] if value > 0]

    def argv(self, pid):
        mib = (ctypes.c_int * 3)(1, 49, pid)  # CTL_KERN / KERN_PROCARGS2
        data = ctypes.create_string_buffer(1024 * 1024)
        size = ctypes.c_size_t(len(data))
        if self.sys.sysctl(mib, 3, data, ctypes.byref(size), None, 0) != 0:
            raise Refusal("argv_unavailable")
        return parse_argv(data.raw[:size.value])


def allowed_argv(helper, bundle, package_argument):
    # SwiftPM 6.3.3 TestRunner.args forwards its CLI arguments and repeats binaryPath.
    # Only the workflow's exact command is admitted; no filters/extra options.
    prefix = (helper, "--test-bundle-path", bundle)
    tail = ("--package-path", package_argument, bundle, "--testing-library", "swift-testing")
    return {prefix + tail}


def select_target(inspector, root, helper, bundle, package_argument):
    if inspector.identity(root.pid) != root:
        raise Refusal("parent_identity_changed")
    pending = [(root,)]
    seen = {root.pid}
    matches = []
    while pending:
        chain = pending.pop()
        if len(chain) > 12:
            raise Refusal("process_inventory_limit")
        for pid in inspector.children(chain[-1].pid):
            if pid in seen or len(seen) >= 256:
                raise Refusal("process_inventory_limit")
            seen.add(pid)
            child = inspector.identity(pid)
            if child is None:
                continue  # An unrelated, already-exited build child is not a target.
            if child.ppid != chain[-1].pid or child.uid != root.uid:
                raise Refusal("descendant_identity_changed")
            next_chain = chain + (child,)
            if child.executable == helper:
                if inspector.argv(pid) not in allowed_argv(helper, bundle, package_argument):
                    raise Refusal("helper_arguments_mismatch")
                if inspector.identity(pid) != child:
                    raise Refusal("helper_identity_changed")
                matches.append(next_chain)
            else:
                pending.append(next_chain)
    if len(matches) > 1:
        raise Refusal("ambiguous_helper")
    if not matches:
        return None
    chain = matches[0]
    if any(inspector.identity(item.pid) != item for item in chain):
        raise Refusal("ancestor_identity_changed")
    return chain


def watch(root, inspector, helper, bundle, package_argument, read_log, stopped,
          sampler, clock=time.monotonic, sleep=time.sleep):
    start = clock()
    changed = start
    previous_stamp = None
    bound_chain = None
    while clock() - start < WATCH_SECONDS:
        if stopped():
            return {"status": "stopped_without_sample"}
        stamp = read_log()
        now = clock()
        if stamp != previous_stamp:
            changed = now
            previous_stamp = stamp
        chain = select_target(inspector, root, helper, bundle, package_argument)
        if bound_chain is not None and chain != bound_chain:
            return {"status": "target_exited_or_changed"}
        if chain is not None and bound_chain is None:
            bound_chain = chain
            changed = now  # Require a full 90 seconds with this exact helper alive.
        if chain is not None and stamp is not None and now - changed >= IDLE_SECONDS:
            # Repeat the entire ownership/argv chain and log check at the admission boundary.
            if stopped() or read_log() != stamp:
                continue
            if select_target(inspector, root, helper, bundle, package_argument) != chain:
                raise Refusal("sample_identity_changed")
            result = sampler(chain)
            return {"status": result[0], "sampleBytes": len(result[1]),
                    "sampleSHA256": hashlib.sha256(result[1]).hexdigest(),
                    "idleSeconds": round(now - changed, 3),
                    "targetPID": chain[-1].pid,
                    "targetStart": [chain[-1].start_seconds, chain[-1].start_microseconds],
                    "ancestorPIDs": [item.pid for item in chain[:-1]]}
        sleep(1)
    return {"status": "watch_deadline_without_sample"}


def collect_sample(pid, stopped, *, popen=subprocess.Popen, clock=time.monotonic):
    # Only the owned sample subprocess can be terminated. Never signal the sampled PID.
    child = popen(["/usr/bin/sample", str(pid), str(SAMPLE_SECONDS), "10", "-file", "/dev/stdout"],
                  stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, env=ENV)
    output = bytearray()
    reason = "sampled"
    deadline = clock() + SAMPLE_TIMEOUT - 1  # Reserve one second to reap our sampler.
    selector = selectors.DefaultSelector()
    selector.register(child.stdout, selectors.EVENT_READ)
    try:
        while selector.get_map():
            if stopped():
                reason = "sample_cancelled"
                break
            if clock() >= deadline:
                reason = "sample_timeout"
                break
            for key, _ in selector.select(min(0.1, max(0, deadline - clock()))):
                data = os.read(key.fileobj.fileno(), min(65536, MAX_SAMPLE_BYTES + 1 - len(output)))
                if not data:
                    selector.unregister(key.fileobj)
                    continue
                output.extend(data)
                if len(output) > MAX_SAMPLE_BYTES:
                    reason = "sample_output_limit"
                    break
            if reason != "sampled":
                break
        if reason == "sampled":
            try:
                if child.wait(timeout=max(0.001, deadline - clock())) != 0:
                    reason = "sample_failed"
            except subprocess.TimeoutExpired:
                reason = "sample_timeout"
    finally:
        selector.close()
        child.stdout.close()
        if child.poll() is None:
            child.kill()  # Our Popen handle only; no PID lookup or test-process kill.
        try:
            child.wait(timeout=1)
        except subprocess.TimeoutExpired:
            reason = "sample_reap_unconfirmed"
    return reason, bytes(output[:MAX_SAMPLE_BYTES])


def checked_directory(value):
    path = Path(value)
    if not path.is_absolute() or path.resolve() != path:
        raise Refusal("output_not_canonical")
    mode = path.lstat()
    if not stat.S_ISDIR(mode.st_mode) or mode.st_uid != os.getuid() or stat.S_IMODE(mode.st_mode) != 0o700:
        raise Refusal("output_not_private")
    return path


def write_new(path, data):
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(descriptor, "wb") as output:
        output.write(data)


def log_stamp(path):
    try:
        descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    except FileNotFoundError:
        return None
    try:
        info = os.fstat(descriptor)
        if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_size > MAX_LOG_BYTES:
            raise Refusal("log_not_bounded_regular")
        return info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns
    finally:
        os.close(descriptor)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--shell-pid", required=True, type=int)
    parser.add_argument("--package-path", required=True)
    parser.add_argument("--log", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    destination = None
    try:
        if sys.platform != "darwin" or os.environ.get("GITHUB_ACTIONS") != "true" or os.environ.get("RUNNER_OS") != "macOS":
            raise Refusal("ci_only")
        if args.shell_pid != os.getppid():
            raise Refusal("not_direct_child_of_test_shell")
        destination = checked_directory(args.output)
        inspector = DarwinInspector()
        root = inspector.identity(args.shell_pid)
        if root is None or root.uid != os.getuid() or Path(root.executable).name != "bash":
            raise Refusal("test_shell_unavailable")
        package = Path(args.package_path).resolve(strict=True)
        bundle = (package / ".build/debug/RecordingsPackageTests.xctest/Contents/MacOS/RecordingsPackageTests").resolve(strict=True)
        if not bundle.is_file() or not bundle.is_relative_to(package / ".build"):
            raise Refusal("test_bundle_unavailable")
        swift = Path(subprocess.check_output(["/usr/bin/xcrun", "--find", "swift"], env=ENV, timeout=5, text=True).strip())
        helper = (swift.parent.parent / "libexec/swift/pm/swiftpm-testing-helper").resolve(strict=True)
        if not helper.is_file():
            raise Refusal("helper_unavailable")
        stop = lambda: (destination / "stop").exists()
        def sample(chain):
            # Last check immediately before spawning sample; no synthetic argv fallback.
            if stop() or select_target(inspector, root, str(helper), str(bundle), args.package_path) != chain:
                raise Refusal("sample_identity_changed")
            result = collect_sample(chain[-1].pid, stop)
            # A PID-only sampling tool has no atomic birth-identity attachment. Discard
            # its output if the exact binding cannot also be verified after sampling.
            try:
                unchanged = select_target(inspector, root, str(helper), str(bundle), args.package_path) == chain
            except Refusal:
                unchanged = False
            if not unchanged:
                result = ("sample_discarded_identity_changed", b"")
            write_new(destination / "sample.txt", result[1])
            return result
        result = watch(root, inspector, str(helper), str(bundle), args.package_path,
                       lambda: log_stamp(Path(args.log)), stop, sample)
        result.update({"schemaVersion": 1, "diagnosticOnly": True,
                       "sampleSeconds": SAMPLE_SECONDS, "sampleDeadlineSeconds": SAMPLE_TIMEOUT,
                       "helperSHA256": hashlib.sha256(helper.read_bytes()).hexdigest(),
                       "testBinarySHA256": hashlib.sha256(bundle.read_bytes()).hexdigest()})
    except Refusal as error:
        result = {"schemaVersion": 1, "status": "refused", "reason": str(error)}
    except Exception:
        # Never emit environment, subprocess output, paths, or unreviewed exception text.
        result = {"schemaVersion": 1, "status": "unavailable"}
    if destination is not None:
        write_new(destination / "status.json", (json.dumps(result, indent=2) + "\n").encode())
    print("Native stall diagnostic: " + result["status"])
    return 0  # Observability cannot turn a test failure into a success (or vice versa).


if __name__ == "__main__":
    sys.exit(main())
