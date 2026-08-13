import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describeMachineCommandFailure, requireMachineCommandSuccess, resolveMachineCommand, runMachineCommand } from "../src/remote.js";

const roots: string[] = [];

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function useEmptyManifest(): void {
  const root = mkdtempSync(join(tmpdir(), "machines-remote-manifest-"));
  roots.push(root);
  const manifestPath = join(root, "machines.json");
  writeFileSync(manifestPath, `${JSON.stringify({ version: 1, machines: [] })}\n`);
  process.env["HASNA_MACHINES_MANIFEST_PATH"] = manifestPath;
}

describe("machine command routing", () => {
  afterEach(() => {
    delete process.env["HASNA_MACHINES_MANIFEST_PATH"];
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  test("treats local aliases as local commands", () => {
    expect(resolveMachineCommand("local", "echo ok", "demo-node-02")).toEqual({
      source: "local",
      command: "bash",
      args: ["-c", "echo ok"],
      shellCommand: "echo ok",
      usesShell: true,
    });
    expect(resolveMachineCommand("localhost", "echo ok", "demo-node-02").source).toBe("local");
    expect(resolveMachineCommand("demo-node-02", "echo ok", "demo-node-02").source).toBe("local");
  });

  test("falls back to direct SSH alias when a machine is not manifest-managed", () => {
    useEmptyManifest();
    expect(resolveMachineCommand("unmanaged-fixture", "knowledge --version", "demo-node-02")).toEqual({
      source: "ssh",
      command: "ssh",
      args: ["unmanaged-fixture", "knowledge --version"],
      shellCommand: "ssh 'unmanaged-fixture' 'knowledge --version'",
      usesShell: false,
    });
  });

  test("rejects unmanaged SSH aliases that would be parsed as SSH options", () => {
    useEmptyManifest();
    expect(() => resolveMachineCommand("-oProxyCommand=touch/tmp/pwned", "true", "demo-node-02"))
      .toThrow("Unsafe SSH target");
  });

  test("formats and throws machine command failures with source and exit code", () => {
    const result = {
      machineId: "demo-mac-001",
      source: "ssh" as const,
      stdout: "",
      stderr: "Permission denied",
      exitCode: 255,
    };

    expect(describeMachineCommandFailure("Probe", result)).toContain("Probe failed on demo-mac-001 via ssh (exit 255)");
    expect(() => requireMachineCommandSuccess("Probe", result)).toThrow("Permission denied");
  });

  test("marks timed out machine commands with exit 124", () => {
    const result = runMachineCommand("local", "sleep 1", { timeoutMs: 20, killGraceMs: 20 });

    expect(result.source).toBe("local");
    expect(result.exitCode).toBe(124);
    expect(result.timedOut).toBe(true);
    expect(result.stderr).toContain("Command timed out after 20ms.");
  });

  test("captures large command output before helper exit", () => {
    const result = runMachineCommand("local", "head -c 200000 /dev/zero | tr '\\0' x", { timeoutMs: 2_000, killGraceMs: 20 });

    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBe(false);
    expect(result.stdout.length).toBe(200_000);
    expect(result.stdout.endsWith("x")).toBe(true);
  });

  test("redacts direct command output when requested without needing the timeout helper", () => {
    const result = runMachineCommand(
      "local",
      "printf '%s\\n' 'token=fixture-value'; printf '%s\\n' 'Bearer fixturevalue' >&2",
      { redactOutput: true },
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("token=[redacted]");
    expect(result.stdout).not.toContain("fixture-value");
    expect(result.stderr).toContain("[redacted]");
    expect(result.stderr).not.toContain("fixturevalue");
    expect(result.stdoutRedacted).toBe(true);
    expect(result.stderrRedacted).toBe(true);
  });

  test("bounds each stream while the timeout helper collects output", () => {
    const result = runMachineCommand(
      "local",
      "head -c 200000 /dev/zero | tr '\\0' x; head -c 200000 /dev/zero | tr '\\0' y >&2",
      { timeoutMs: 2_000, killGraceMs: 20, maxOutputChars: 64 },
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout.length).toBe(64);
    expect(result.stderr.length).toBe(64);
    expect(result.stdoutTruncated).toBe(true);
    expect(result.stderrTruncated).toBe(true);
    expect(result.stdoutChars).toBe(200_000);
    expect(result.stderrChars).toBe(200_000);
  });

  test("forwards bounded opaque stdin in direct and timeout-helper paths", () => {
    const payload = Buffer.from("opaque-source-bytes\u0000with-binary", "utf8");
    const direct = runMachineCommand("local", "cat", { stdin: payload, maxInputBytes: payload.byteLength });
    expect(direct.exitCode).toBe(0);
    expect(Buffer.from(direct.stdout, "utf8")).toEqual(payload);

    const timed = runMachineCommand("local", "cat", {
      stdin: payload,
      maxInputBytes: payload.byteLength,
      timeoutMs: 2_000,
      killGraceMs: 20,
    });
    expect(timed.exitCode).toBe(0);
    expect(Buffer.from(timed.stdout, "utf8")).toEqual(payload);
    expect(() => runMachineCommand("local", "cat", { stdin: payload, maxInputBytes: payload.byteLength - 1 }))
      .toThrow("stdin exceeds");
  });

  test("kills TERM-ignoring descendant processes on timeout", () => {
    const dir = mkdtempSync(join(tmpdir(), "machines-timeout-"));
    const marker = join(dir, "alive.log");
    const pidFile = join(dir, "child.pid");
    try {
      const stubbornLoop = [
        "trap '' TERM",
        `echo $$ > ${shellQuote(pidFile)}`,
        `while true; do printf x >> ${shellQuote(marker)}; sleep 0.02; done`,
      ].join("; ");
      const waitForStarted = [
        `bash -c ${shellQuote(stubbornLoop)} &`,
        `for i in $(seq 1 100); do [ -s ${shellQuote(pidFile)} ] && [ -s ${shellQuote(marker)} ] && break; sleep 0.01; done;`,
        `[ -s ${shellQuote(pidFile)} ] && [ -s ${shellQuote(marker)} ] || exit 42;`,
        "wait",
      ].join(" ");
      const result = runMachineCommand("local", waitForStarted, { timeoutMs: 200, killGraceMs: 80 });
      const bytesAfterReturn = existsSync(marker) ? readFileSync(marker).length : 0;
      const childPid = existsSync(pidFile) ? readFileSync(pidFile, "utf8").trim() : "";
      spawnSync("bash", ["-lc", "sleep 0.2"], { encoding: "utf8" });
      const bytesAfterDelay = existsSync(marker) ? readFileSync(marker).length : 0;
      const childStillExists = childPid
        ? spawnSync("bash", ["-lc", `kill -0 ${shellQuote(childPid)} 2>/dev/null`], { encoding: "utf8" }).status === 0
        : false;

      if (childPid) spawnSync("bash", ["-lc", `kill -KILL ${shellQuote(childPid)} 2>/dev/null || true`], { encoding: "utf8" });
      expect(result.exitCode).toBe(124);
      expect(result.timedOut).toBe(true);
      expect(childPid).not.toBe("");
      expect(bytesAfterReturn).toBeGreaterThan(0);
      expect(bytesAfterDelay).toBe(bytesAfterReturn);
      expect(childStillExists).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
