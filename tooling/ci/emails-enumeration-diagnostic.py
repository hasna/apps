#!/usr/bin/env python3
"""One pinned fictional fixture; never retain child payloads or input config.

Prepared for review, not an automatic CI gate or a production workaround.
Must run as PID 1 in a new root-created network/PID namespace. Observations
modify only the disposable pinned fixture checkout, never the release source.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import re
import selectors
import signal
import stat
import subprocess
import sys
import time

SOURCE = "a82cbcad7f8c62b71f797416a52c51bde8321aa7"
NAME = "refuses before deleting when the mailbox exceeds the enumeration budget"
HASHES = {
    "src/db/inbound.test.ts": "eab7b614825ad082818a5fff748741b41276a75055f3b5513250db608508a08e",
    "src/db/self-hosted-store.ts": "e5053a9e96396abfd3e3aa3f531f558d5cbaacf2227a13c91f09ffdb2605fdfa",
    "src/db/self-hosted-page.ts": "a8e81f07883ed1c77b5b1c4bd291e3e01a7b3412fc432267a58308db6e9d5bda",
    "src/test-support/v1-stub.ts": "12410c3469ff58cfbd38a7425e1ee7b30cacd4f5e0e345f8cc10c5ca122ad389",
}


def digest(data):
    return hashlib.sha256(data).hexdigest()


def replace_once(text, before, after):
    if text.count(before) != 1:
        raise ValueError("patch_anchor")
    return text.replace(before, after, 1)


def instrument(package, reports):
    originals = {name: (package / name).read_text() for name in HASHES}
    for name, expected in HASHES.items():
        if digest((package / name).read_bytes()) != expected:
            raise ValueError("source_hash")
    capture_path = json.dumps(str(reports / "capture.jsonl"))
    response_path = json.dumps(str(reports / "response.jsonl"))
    mailbox_path = json.dumps(str(reports / "mailbox.jsonl"))
    capture = originals["src/db/self-hosted-store.ts"]
    capture = replace_once(capture, 'import { spawnSync } from "node:child_process";', '''import { spawnSync } from "node:child_process";
import { appendFileSync as diagnosticAppend } from "node:fs";
import { createHash as diagnosticHash } from "node:crypto";
let diagnosticOrdinal = 0;''')
    capture = replace_once(capture, '  const proc = spawnSync("curl",', '''  const diagnosticStarted = performance.now();
  const proc = spawnSync("curl",''')
    capture = replace_once(capture, "  if (proc.error) {", '''  // Numeric/hash observations only; no stdout, stderr, headers or config retained.
  {
    const output = proc.stdout ?? "";
    const newline = output.lastIndexOf("\\n");
    const trailer = newline >= 0 ? output.slice(newline + 1).trim() : output.trim();
    const parsed = Number.parseInt(trailer, 10);
    const query = new URLSearchParams(path.split("?")[1] ?? "");
    diagnosticAppend(CAPTURE_PATH, JSON.stringify({
      ordinal: ++diagnosticOrdinal, limit: Number(query.get("limit") ?? -1),
      offset: Number(query.get("offset") ?? -1),
      elapsed_ms: performance.now() - diagnosticStarted,
      status: proc.status ?? -1, pid: proc.pid ?? -1,
      signal: [null, "SIGTERM", "SIGKILL", "SIGPIPE"].indexOf(proc.signal),
      error: [undefined, "ENOBUFS", "ETIMEDOUT", "ENOENT", "EACCES"].indexOf((proc.error as NodeJS.ErrnoException | undefined)?.code),
      stdout_bytes: Buffer.byteLength(output), stderr_bytes: Buffer.byteLength(proc.stderr ?? ""),
      last_newline_char: newline, parsed_status: Number.isFinite(parsed) ? parsed : -1,
      stdout_sha256: diagnosticHash("sha256").update(output).digest("hex"),
    }) + "\\n", { mode: 0o600 });
  }
  if (proc.error) {'''.replace("CAPTURE_PATH", capture_path))

    stub = originals["src/test-support/v1-stub.ts"]
    stub = replace_once(stub, "const SERVER_SRC = String.raw`", '''const SERVER_SRC = String.raw`
import { appendFileSync as diagnosticAppend } from "node:fs";
import { createHash as diagnosticHash } from "node:crypto";
let diagnosticOrdinal = 0;
let diagnosticRequest = null;''')
    stub = replace_once(stub, '''function json(body, status) {
  return new Response(JSON.stringify(body), { status: status || 200, headers: { "content-type": "application/json" } });
}''', '''function json(body, status) {
  const serialized = JSON.stringify(body);
  const selectedStatus = status || 200;
  const response = new Response(serialized, { status: selectedStatus, headers: { "content-type": "application/json" } });
  if (diagnosticRequest !== null) {
    diagnosticAppend(RESPONSE_PATH, JSON.stringify({
      ...diagnosticRequest, status: selectedStatus, constructed: 1,
      body_bytes: Buffer.byteLength(serialized),
      body_sha256: diagnosticHash("sha256").update(serialized).digest("hex"),
      expected_stdout_sha256: diagnosticHash("sha256").update(serialized + "\\n" + selectedStatus).digest("hex"),
    }) + "\\n", { mode: 0o600 });
    diagnosticRequest = null;
  }
  return response;
}'''.replace("RESPONSE_PATH", response_path))
    stub = replace_once(stub, "      const page = listMessages(url.searchParams);", '''      diagnosticRequest = {
        ordinal: ++diagnosticOrdinal, offset: Number(url.searchParams.get("offset") ?? -1),
        limit: Number(url.searchParams.get("limit") ?? -1),
      };
      const page = listMessages(url.searchParams);''')

    fixture = originals["src/db/inbound.test.ts"]
    fixture = replace_once(fixture, 'import { startV1Stub, type V1Stub }', '''import { appendFileSync as diagnosticAppend } from "node:fs";
import { startV1Stub, type V1Stub }''')
    fixture = replace_once(fixture, '    expect(String(refusal)).toMatch(/enumeration budget ran out/);', '''    // This read is after the original timed operation, before its unchanged assertions.
    try {
      const remaining = await stub.list("messages");
      diagnosticAppend(MAILBOX_PATH, JSON.stringify({ seeded: scanBudget + 1, remaining: remaining.length, read_error: 0 }) + "\\n", { mode: 0o600 });
    } catch {
      diagnosticAppend(MAILBOX_PATH, JSON.stringify({ seeded: scanBudget + 1, remaining: -1, read_error: 1 }) + "\\n", { mode: 0o600 });
    }
    expect(String(refusal)).toMatch(/enumeration budget ran out/);'''.replace("MAILBOX_PATH", mailbox_path))
    # Preserve every existing expectation and explicit timeout line, byte-for-byte.
    protected = lambda text: [line for line in text.splitlines() if "expect(" in line or "240_000" in line]
    if protected(fixture) != protected(originals["src/db/inbound.test.ts"]):
        raise ValueError("assertion_change")
    changed = {"src/db/inbound.test.ts": fixture, "src/db/self-hosted-store.ts": capture,
               "src/test-support/v1-stub.ts": stub}
    for name, text in changed.items():
        (package / name).write_text(text)
    return {name: {"before": HASHES[name], "after": digest((package / name).read_bytes())} for name in HASHES}


def fixed_output(argv, cwd=None):
    return subprocess.check_output(argv, cwd=cwd, stderr=subprocess.DEVNULL, timeout=10)


def source_change_metadata(source, status):
    """Read-only dirty-tree detail. Only pinned tracked names and hashes leave here."""
    raw = fixed_output(["git", "diff", "--raw", "-z", "--no-abbrev", "--no-renames",
                        "--no-ext-diff", "HEAD", "--"], source)
    parts = raw.split(b"\0")
    if parts[-1] != b"" or len(parts) > 129 or (len(parts) - 1) % 2:
        raise ValueError("source_metadata_shape")
    rows = []
    for meta, name in zip(parts[0:-1:2], parts[1:-1:2]):
        match = re.fullmatch(rb":([0-7]{6}) ([0-7]{6}) ([a-f0-9]{40}) [a-f0-9]{40} ([AMDT])", meta)
        if match is None:
            raise ValueError("source_metadata_shape")
        path = name.decode("utf-8")
        if not re.fullmatch(r"[A-Za-z0-9_.@/+ -]+", path) or path.startswith("/") or ".." in Path(path).parts:
            raise ValueError("source_metadata_path")
        # A path can be printed only when this exact name exists at the pinned source.
        tree = fixed_output(["git", "ls-tree", "-z", SOURCE, "--", path], source)
        expected = match[1] + b" blob " + match[3] + b"\t" + name + b"\0"
        if tree != expected or match[1] not in (b"100644", b"100755"):
            raise ValueError("source_metadata_unlisted")
        oid = match[3].decode("ascii")
        if int(fixed_output(["git", "cat-file", "-s", oid], source)) > 16 * 1024 * 1024:
            raise ValueError("source_metadata_size")
        before = fixed_output(["git", "cat-file", "blob", oid], source)
        row = {"path": path, "change": match[4].decode("ascii"),
               "before_mode": int(match[1], 8), "after_git_mode": int(match[2], 8),
               "before_bytes": len(before), "before_sha256": digest(before)}
        target = source / path
        if target.parent.resolve(strict=True).is_relative_to(source):
            try:
                observed = target.lstat()
            except FileNotFoundError:
                observed = None
            if observed is not None:
                row["after_mode"] = observed.st_mode
                if stat.S_ISREG(observed.st_mode) and observed.st_size <= 16 * 1024 * 1024:
                    fd = os.open(target, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
                    with os.fdopen(fd, "rb") as handle:
                        after = handle.read(16 * 1024 * 1024 + 1)
                    if len(after) > 16 * 1024 * 1024:
                        raise ValueError("source_metadata_size")
                    row.update(after_bytes=len(after), after_sha256=digest(after))
        rows.append(row)
    return {"status_bytes": len(status), "status_sha256": digest(status), "changes": rows}


def identity(path, version_arg):
    real = Path(path).resolve(strict=True)
    return {"path": str(real), "sha256": digest(real.read_bytes()),
            "version": fixed_output([str(real), version_arg]).decode().splitlines()[0]}


def numeric_rows(path, keys):
    if not path.exists():
        return []
    if path.is_symlink() or path.stat().st_size > 128 * 1024:
        raise ValueError("metadata_size")
    rows = [json.loads(line) for line in path.read_text().splitlines()]
    if len(rows) > 42:
        raise ValueError("metadata_count")
    for row in rows:
        if set(row) != set(keys):
            raise ValueError("metadata_keys")
        for key, value in row.items():
            if key.endswith("sha256"):
                if not isinstance(value, str) or not re.fullmatch("[a-f0-9]{64}", value):
                    raise ValueError("metadata_hash")
            elif type(value) not in (int, float) or not (-1 <= value < 1e15):
                raise ValueError("metadata_number")
    return rows


def run_once(argv, cwd, env):
    proc = subprocess.Popen(argv, cwd=cwd, env=env, stdout=subprocess.PIPE,
                            stderr=subprocess.STDOUT, start_new_session=True)
    output = bytearray()
    selector = selectors.DefaultSelector()
    selector.register(proc.stdout, selectors.EVENT_READ)
    deadline = time.monotonic() + 300
    exceeded = 0
    try:
        while selector.get_map():
            if time.monotonic() >= deadline:
                exceeded = 1
                break
            for key, _ in selector.select(min(0.2, max(0, deadline - time.monotonic()))):
                block = os.read(key.fileobj.fileno(), 8192)
                if not block:
                    selector.unregister(key.fileobj)
                    continue
                output.extend(block)
                if len(output) > 2 * 1024 * 1024:
                    exceeded = 2
                    break
            if exceeded:
                break
    finally:
        selector.close()
        for sig in (signal.SIGTERM, signal.SIGKILL):
            try:
                os.killpg(proc.pid, sig)
            except ProcessLookupError:
                pass
            if sig == signal.SIGTERM:
                time.sleep(0.1)
        proc.wait(timeout=2)
        proc.stdout.close()
        # This process is PID 1 in its own namespace. Reap only its adopted children.
        reap_deadline = time.monotonic() + 2
        while time.monotonic() < reap_deadline:
            try:
                pid, _ = os.waitpid(-1, os.WNOHANG)
                if pid == 0:
                    time.sleep(0.02)
                    continue
            except ChildProcessError:
                break
    text = bytes(output).decode("utf-8", "replace")
    selected_pass = len(re.findall(r"^\(pass\).*" + re.escape(NAME), text, re.M))
    selected_fail = len(re.findall(r"^\(fail\).*" + re.escape(NAME), text, re.M))
    return {"exit": proc.returncode, "outer_limit": exceeded, "output_bytes": len(output),
            "output_sha256": digest(output), "selected_pass": selected_pass, "selected_fail": selected_fail}


def main():
    parser = argparse.ArgumentParser()
    for name in ("source", "reports", "bun", "curl", "image-version"):
        parser.add_argument("--" + name, required=True)
    for name in ("uid", "gid"):
        parser.add_argument("--" + name, type=int, required=True)
    args = parser.parse_args()
    if sys.platform != "linux" or os.getpid() != 1 or os.geteuid() != 0:
        raise ValueError("namespace_required")
    if args.uid <= 0 or args.gid <= 0:
        raise ValueError("runner_user_required")
    fixed_output(["/usr/sbin/ip", "link", "set", "lo", "up"])
    links = json.loads(fixed_output(["/usr/sbin/ip", "-j", "link", "show"]))
    if [link["ifname"] for link in links] != ["lo"]:
        raise ValueError("loopback_only_required")
    os.setgroups([])
    os.setgid(args.gid)
    os.setuid(args.uid)
    os.umask(0o077)
    source, reports = Path(args.source).resolve(strict=True), Path(args.reports).resolve(strict=True)
    if reports.stat().st_uid != args.uid or any(reports.iterdir()):
        raise ValueError("fresh_reports_required")
    result = {"schema": 1, "source": SOURCE, "image_version": args.image_version,
              "os": platform.freedesktop_os_release()["PRETTY_NAME"],
              "kernel": os.uname().release, "machine": os.uname().machine, "valid": 0}
    try:
        if fixed_output(["git", "rev-parse", "HEAD"], source).decode().strip() != SOURCE:
            raise ValueError("source_identity")
        status = fixed_output(["git", "status", "--porcelain", "--untracked-files=no"], source)
        if status:
            try:
                result["source_changes"] = source_change_metadata(source, status)
            except Exception as exc:
                # Detail collection must never replace or suppress the original refusal.
                result["source_metadata_error"] = type(exc).__name__
            raise ValueError("source_dirty")
        result["imported_artifacts"] = {
            name: digest((source / name).read_bytes()) for name in (
                "apps/contracts/dist/client/transport.js", "apps/contracts/dist/client/storage.js",
                "apps/events/dist/index.js")
        }
        result["bun"] = identity(args.bun, "--version")
        result["curl"] = identity(args.curl, "--version")
        if result["bun"]["version"] != "1.3.14":
            raise ValueError("bun_version")
        tools = reports / "tools"
        tools.mkdir()
        for name in ("bun", "curl"):
            (tools / name).symlink_to(result[name]["path"])
        result["files"] = instrument(source / "apps/emails", reports)
        env = {"PATH": str(tools) + ":/usr/bin:/bin", "HOME": str(reports), "TMPDIR": str(reports),
               "LANG": "C.UTF-8", "LC_ALL": "C.UTF-8", "NO_COLOR": "1", "FORCE_COLOR": "0"}
        result["test"] = run_once([str(tools / "bun"), "--no-env-file", "scripts/prepublish-local-test.mjs",
                                   "--max-concurrency", "1", "src/db/inbound.test.ts", "--test-name-pattern", NAME],
                                  source / "apps/emails", env)
        result["capture"] = numeric_rows(reports / "capture.jsonl", ["ordinal", "limit", "offset", "elapsed_ms", "status", "pid", "signal", "error", "stdout_bytes", "stderr_bytes", "last_newline_char", "parsed_status", "stdout_sha256"])
        result["response"] = numeric_rows(reports / "response.jsonl", ["ordinal", "offset", "limit", "status", "constructed", "body_bytes", "body_sha256", "expected_stdout_sha256"])
        result["mailbox"] = numeric_rows(reports / "mailbox.jsonl", ["seeded", "remaining", "read_error"])
        # Count remaining processes numerically; never inspect argv/environment.
        result["remaining_processes"] = len([p for p in Path("/proc").iterdir() if p.name.isdigit() and int(p.name) != os.getpid()])
        test = result["test"]
        result["valid"] = int(test["selected_pass"] + test["selected_fail"] == 1 and test["outer_limit"] == 0
                              and result["remaining_processes"] == 0 and len(result["mailbox"]) == 1)
    except Exception as exc:
        # No arbitrary exceptions or child output: fixed classification plus hashes only.
        allowed = {"patch_anchor", "source_hash", "assertion_change", "metadata_size", "metadata_count",
                   "metadata_keys", "metadata_hash", "metadata_number", "source_identity", "source_dirty", "bun_version"}
        code = str(exc)
        result["preparation_error"] = code if code in allowed else type(exc).__name__
    (reports / "result.json").write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps({"valid": result["valid"], "result_sha256": digest((reports / "result.json").read_bytes())}))
    return 0 if result["valid"] and result["test"]["exit"] == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
