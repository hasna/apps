import { describe, expect, test } from "bun:test";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CommandExecutionError,
  executableIdentity,
  resolveTrustedExecutable,
  runPinnedCommand,
} from "../scripts/stage-a-process.js";

describe("Stage A evidence creator process boundary", () => {
  test("ignores ambient PATH shadowing and executes the trusted binary", async () => {
    const root = mkdtempSync(join(tmpdir(), "todos-stage-a-path-shadow-"));
    const marker = join(root, "shadow-executed");
    const shadow = join(root, "true");
    const originalPath = process.env.PATH;
    try {
      writeFileSync(shadow, `#!/bin/sh\nprintf shadow > ${JSON.stringify(marker)}\nexit 91\n`);
      chmodSync(shadow, 0o755);
      process.env.PATH = `${root}:${originalPath ?? ""}`;
      const trusted = resolveTrustedExecutable("true");
      expect(trusted.path).not.toBe(shadow);
      const result = await runPinnedCommand({ executable: trusted, args: [], deadlineMs: 2_000 });
      expect(result.exitCode).toBe(0);
      expect(existsSync(marker)).toBe(false);
    } finally {
      process.env.PATH = originalPath;
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("pins child-command PATH bindings for creator shell pipelines", async () => {
    const root = mkdtempSync(join(tmpdir(), "todos-stage-a-child-path-shadow-"));
    const marker = join(root, "shadow-child-executed");
    const shadow = join(root, "true");
    try {
      writeFileSync(shadow, `#!/bin/sh\nprintf shadow > ${JSON.stringify(marker)}\nexit 92\n`);
      chmodSync(shadow, 0o755);
      const result = await runPinnedCommand({
        executable: resolveTrustedExecutable("bash"),
        args: ["-c", "true"],
        env: { LANG: "C.UTF-8", LC_ALL: "C", PATH: root },
        pathBindings: { true: resolveTrustedExecutable("true") },
        deadlineMs: 2_000,
      });
      expect(result.exitCode).toBe(0);
      expect(existsSync(marker)).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("executes verified bytes across replace-execute-restore path attacks", async () => {
    const root = mkdtempSync(join(tmpdir(), "todos-stage-a-replace-exec-"));
    const launcher = join(root, "launcher");
    const replacement = join(root, "replacement");
    const marker = join(root, "replacement-executed");
    try {
      copyFileSync("/bin/true", launcher);
      chmodSync(launcher, 0o755);
      writeFileSync(replacement, `#!/bin/sh\nprintf replacement > ${JSON.stringify(marker)}\nexit 97\n`);
      chmodSync(replacement, 0o755);
      const identity = executableIdentity(launcher);
      const result = await runPinnedCommand({
        executable: identity,
        args: [],
        deadlineMs: 2_000,
        onExecutablePinnedForTest: () => renameSync(replacement, launcher),
      });
      expect(result.exitCode).toBe(0);
      expect(existsSync(marker)).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("executes pinned child-command bytes across replace-execute-restore attacks", async () => {
    const root = mkdtempSync(join(tmpdir(), "todos-stage-a-child-replace-exec-"));
    const child = join(root, "child-command");
    const replacement = join(root, "replacement");
    const marker = join(root, "replacement-executed");
    try {
      copyFileSync("/bin/true", child);
      chmodSync(child, 0o755);
      writeFileSync(replacement, `#!/bin/sh\nprintf replacement > ${JSON.stringify(marker)}\nexit 98\n`);
      chmodSync(replacement, 0o755);
      const result = await runPinnedCommand({
        executable: resolveTrustedExecutable("bash"),
        args: ["-c", "child-command"],
        pathBindings: { "child-command": executableIdentity(child) },
        deadlineMs: 2_000,
        onExecutablePinnedForTest: () => renameSync(replacement, child),
      });
      expect(result.exitCode).toBe(0);
      expect(existsSync(marker)).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("regular-file capture leaves no inherited stdout or stderr sockets", async () => {
    const expression = [
      'import { readlinkSync, readdirSync } from "node:fs";',
      'let sockets=0;',
      'for(const fd of readdirSync("/proc/self/fd")){try{if(readlinkSync(`/proc/self/fd/${fd}`).startsWith("socket:["))sockets+=1;}catch{}}',
      'console.log(sockets);',
    ].join("");
    const result = await runPinnedCommand({
      executable: resolveTrustedExecutable("bun"),
      args: ["-e", expression],
      deadlineMs: 2_000,
      outputLimitBytes: 4_096,
      outputCapture: "files",
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString("utf8").trim()).toBe("0");
    expect(result.stderr.byteLength).toBe(0);
  });

  test("times out a hanging process group deterministically and cleans temporary paths", async () => {
    const root = mkdtempSync(join(tmpdir(), "todos-stage-a-timeout-test-"));
    const tempRoot = join(root, "runner-temp");
    const bash = resolveTrustedExecutable("bash");
    const sleep = resolveTrustedExecutable("sleep");
    try {
      let timeoutError: CommandExecutionError | undefined;
      try {
        await runPinnedCommand({
          executable: bash,
          args: ["-c", 'sleep 60 & child=$!; printf "child=%s\\n" "$child"; wait'],
          pathBindings: { sleep },
          deadlineMs: 100,
          outputLimitBytes: 4_096,
          outputCapture: "files",
          temporaryRoot: tempRoot,
        });
      } catch (error) {
        expect(error).toBeInstanceOf(CommandExecutionError);
        timeoutError = error as CommandExecutionError;
      }
      expect(timeoutError).toMatchObject({
        code: "COMMAND_TIMEOUT",
        result: { timedOut: true, termination: "timeout" },
      });
      const childPid = Number.parseInt(timeoutError!.result.stdout.toString("utf8").match(/child=(\d+)/)?.[1] ?? "", 10);
      expect(Number.isSafeInteger(childPid)).toBe(true);
      let childExists = true;
      for (let attempt = 0; attempt < 20 && childExists; attempt += 1) {
        try {
          process.kill(childPid, 0);
          await Bun.sleep(10);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
          childExists = false;
        }
      }
      expect(childExists).toBe(false);
      expect(readdirSync(tempRoot)).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("normal exit reaps a same-group background child before cleanup and success", async () => {
    const root = mkdtempSync(join(tmpdir(), "todos-stage-a-normal-background-"));
    const tempRoot = join(root, "runner-temp");
    let childPid = 0;
    try {
      const result = await runPinnedCommand({
        executable: resolveTrustedExecutable("bash"),
        args: ["-c", 'sleep 60 </dev/null >/dev/null 2>&1 & printf "child=%s\\n" "$!"; exit 0'],
        pathBindings: { sleep: resolveTrustedExecutable("sleep") },
        deadlineMs: 2_000,
        outputLimitBytes: 4_096,
        temporaryRoot: tempRoot,
      });
      expect(result.exitCode).toBe(0);
      childPid = Number.parseInt(result.stdout.toString("utf8").match(/child=(\d+)/)?.[1] ?? "", 10);
      expect(Number.isSafeInteger(childPid)).toBe(true);
      let childExists = true;
      try {
        process.kill(childPid, 0);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
        childExists = false;
      }
      expect(childExists).toBe(false);
      expect(readdirSync(tempRoot)).toEqual([]);
    } finally {
      if (childPid > 1) {
        try {
          process.kill(childPid, "SIGKILL");
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
        }
      }
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("terminates output floods at the configured byte ceiling", async () => {
    const bash = resolveTrustedExecutable("bash");
    let childPid = 0;
    try {
      await runPinnedCommand({
        executable: bash,
        args: ["-c", 'sleep 60 </dev/null >/dev/null 2>&1 & printf "child=%s\\n" "$!"; while :; do printf "0123456789abcdef"; printf "fedcba9876543210" >&2; done'],
        pathBindings: { sleep: resolveTrustedExecutable("sleep") },
        deadlineMs: 2_000,
        outputLimitBytes: 1_024,
      });
      throw new Error("output flood unexpectedly succeeded");
    } catch (error) {
      expect(error).toBeInstanceOf(CommandExecutionError);
      expect(error).toMatchObject({
        code: "COMMAND_OUTPUT_LIMIT",
        result: { outputLimited: true, termination: "output-limit" },
      });
      const result = (error as CommandExecutionError).result;
      expect(result.stdout.byteLength + result.stderr.byteLength).toBeLessThanOrEqual(1_024);
      childPid = Number.parseInt(result.stdout.toString("utf8").match(/child=(\d+)/)?.[1] ?? "", 10);
      expect(Number.isSafeInteger(childPid)).toBe(true);
      let childExists = true;
      try {
        process.kill(childPid, 0);
      } catch (killError) {
        if ((killError as NodeJS.ErrnoException).code !== "ESRCH") throw killError;
        childExists = false;
      }
      expect(childExists).toBe(false);
    } finally {
      if (childPid > 1) {
        try {
          process.kill(childPid, "SIGKILL");
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
        }
      }
    }
  });

  test("regular-file capture enforces the same combined output ceiling and cleanup", async () => {
    const root = mkdtempSync(join(tmpdir(), "todos-stage-a-file-output-limit-"));
    const tempRoot = join(root, "runner-temp");
    try {
      await expect(runPinnedCommand({
        executable: resolveTrustedExecutable("bash"),
        args: ["-c", 'while :; do printf "0123456789abcdef"; printf "fedcba9876543210" >&2; done'],
        deadlineMs: 2_000,
        outputLimitBytes: 1_024,
        outputCapture: "files",
        temporaryRoot: tempRoot,
      })).rejects.toMatchObject({
        code: "COMMAND_OUTPUT_LIMIT",
        result: { outputLimited: true, termination: "output-limit" },
      });
      expect(readdirSync(tempRoot)).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
