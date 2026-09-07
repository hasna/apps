#!/usr/bin/env python3
"""Run only installer/publication fixture groups under a single macOS OS sandbox.

Build the real descriptor-guard prebuild first. No nested sandbox, live install,
publication, host state mutation, network, or outside-process signals are allowed.
"""
import argparse
import json
import os
from pathlib import Path
import signal
import stat
import subprocess
import sys
import tempfile


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bun", required=True, type=Path)
    parser.add_argument("--report-outfile", type=Path,
        help="export the fixture JUnit receipt to a new file in an owned canonical 0700 directory")
    args = parser.parse_args()
    report_destination = args.report_outfile
    if report_destination is not None:
        directory = report_destination.parent
        info = directory.lstat()
        if (not report_destination.is_absolute() or directory.resolve(strict=True) != directory
                or not directory.is_dir() or directory.is_symlink() or info.st_uid != os.getuid()
                or info.st_mode & 0o777 != 0o700 or report_destination.exists() or report_destination.is_symlink()):
            parser.error("report destination must be a new file in an owned canonical 0700 directory")
    if sys.platform != "darwin":
        parser.error("this confinement runner requires macOS sandbox-exec")
    bun = args.bun.resolve(strict=True)
    if subprocess.check_output([str(bun), "--version"], text=True).strip() != "1.3.14":
        parser.error("Bun 1.3.14 is required")
    package = Path(__file__).resolve().parents[3]
    addon = package / "scripts/native/prebuilds/darwin-universal/recordings_fs_guard.node"
    if not addon.is_file():
        parser.error("build the descriptor guard with scripts/build_native_fs_guard.sh first")
    with tempfile.TemporaryDirectory(prefix="recordings-fixture-parent-") as temporary:
        parent = Path(temporary).resolve()
        root, outside = parent / "fixture", parent / "outside"
        root.mkdir(mode=0o700)
        outside.mkdir(mode=0o700)
        (root / "tmp").mkdir(mode=0o700)
        # Deliberately reproduce macOS symlinked TMPDIR spelling. Each fixture
        # must canonicalize its own trusted root; trust checks remain unchanged.
        (root / "tmp-alias").symlink_to(root / "tmp", target_is_directory=True)
        (root / "home").mkdir(mode=0o700)
        executables = [str(bun), "/bin/bash", "/bin/sh", "/usr/bin/env", "/usr/bin/uname",
            "/usr/bin/dirname", "/bin/pwd", "/usr/bin/awk", "/usr/bin/basename", "/bin/cat",
            "/bin/chmod", "/bin/cp", "/usr/bin/head", "/bin/mkdir", "/usr/bin/mktemp",
            "/bin/mv", "/bin/ln", "/bin/rmdir", "/bin/rm", "/usr/bin/sed", "/usr/bin/tr",
            "/usr/bin/grep", "/bin/ls", "/usr/bin/id", "/usr/bin/stat", "/usr/bin/shasum",
            "/bin/date", "/bin/dd", "/usr/bin/diff", "/usr/bin/du", "/usr/bin/sqlite3", "/bin/df",
            "/usr/bin/perl", "/usr/bin/tar", "/bin/sleep", "/usr/bin/realpath", "/usr/bin/tail"]
        profile = '''(version 1)
(allow default)
(deny network*)
(deny mach-lookup)
(deny signal)
(allow signal (target same-sandbox))
(deny process-exec (require-not (require-any TOOLS (subpath ROOT))))
(deny file-write* (require-all (regex #"^/") (require-not (require-any (subpath ROOT) (literal "/dev/null")))))
(deny file-read* (subpath "/Applications") (subpath "/Library/Keychains")
  (subpath "/Library/Application Support/com.apple.TCC")
  (regex #"^/Users/[^/]+/Applications(/|$)")
  (regex #"^/Users/[^/]+/Library/(Keychains|Preferences|Application Support/com.apple.TCC)(/|$)")
  (regex #"^/Users/[^/]+/[.]hasna/recordings(/|$)"))'''
        profile = profile.replace("TOOLS", " ".join("(literal " + json.dumps(path) + ")" for path in executables))
        profile = profile.replace("ROOT", json.dumps(str(root)))
        env = {"HOME": str(root / "home"), "PATH": "/usr/bin:/bin:/usr/sbin:/sbin",
            "TMPDIR": str(root / "tmp-alias") + "/", "BUN_RUNTIME_TRANSPILER_CACHE_PATH": str(root / "cache"),
            "RECORDINGS_TEST_CONFINED_ROOT": str(root), "FIXTURE_OUTSIDE": str(outside),
            "FIXTURE_PARENT": str(os.getpid()), "RECORDINGS_TEST_TIMEOUT_MS": "120000"}
        prefix = ["/usr/bin/sandbox-exec", "-p", profile, str(bun)]
        control = subprocess.run(prefix + ["-e", 'import {requirePublicationFixtureConfinement as verify} from "./src/__tests__/helpers/publication-fixture-confinement.ts"; verify();'],
            cwd=package, env=env, timeout=20)
        if control.returncode:
            return control.returncode
        print("OS controls passed: fixture write/self signal allowed; outside write, host tool and outside signal denied.", flush=True)
        command = prefix + ["test", "--no-orphans", "--timeout", "120000", "src/__tests__/macos-app-lifecycle.test.ts",
            "src/__tests__/release-output-publication-contract.test.ts", "--test-name-pattern",
            r"^(?:macOS finalized artifact installer|release output publication contract)(?:\s|$)",
            "--reporter=junit", "--reporter-outfile", str(root / "publication.xml")]
        child = subprocess.Popen(command, cwd=package, env=env, start_new_session=True)
        try:
            status = child.wait(timeout=300)
        except subprocess.TimeoutExpired:
            # Only this newly created fixture process group belongs to this runner.
            os.killpg(child.pid, signal.SIGKILL)
            child.wait()
            status = 124
        if report_destination is not None and (root / "publication.xml").is_file():
            # The confined process can only write its owned fixture directory.
            # Only the outside supervisor exports the fixed report, never a caller
            # path passed through the sandbox or a pre-existing destination.
            source_fd = os.open(root / "publication.xml", os.O_RDONLY | os.O_NOFOLLOW)
            with os.fdopen(source_fd, "rb") as source:
                info = os.fstat(source.fileno())
                if not stat.S_ISREG(info.st_mode) or info.st_size > 32 * 1024 * 1024:
                    raise ValueError("fixture JUnit report must be a bounded regular file")
                receipt = source.read(32 * 1024 * 1024 + 1)
                if len(receipt) > 32 * 1024 * 1024:
                    raise ValueError("fixture JUnit report exceeds the bounded report size")
            fd = os.open(report_destination, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
            with os.fdopen(fd, "wb") as output:
                output.write(receipt)
        return status


if __name__ == "__main__":
    raise SystemExit(main())
