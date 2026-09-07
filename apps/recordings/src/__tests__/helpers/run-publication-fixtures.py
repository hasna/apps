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
import subprocess
import sys
import tempfile


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bun", required=True, type=Path)
    args = parser.parse_args()
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
        command = prefix + ["test", "--timeout", "120000", "src/__tests__/macos-app-lifecycle.test.ts",
            "src/__tests__/release-output-publication-contract.test.ts", "--test-name-pattern",
            "macOS finalized artifact installer|release output publication contract"]
        child = subprocess.Popen(command, cwd=package, env=env, start_new_session=True)
        try:
            return child.wait(timeout=300)
        except subprocess.TimeoutExpired:
            # Only this newly created fixture process group belongs to this runner.
            os.killpg(child.pid, signal.SIGKILL)
            child.wait()
            return 124


if __name__ == "__main__":
    raise SystemExit(main())
