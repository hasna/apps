import { describe, expect, test } from "bun:test";
import {
  DEFAULT_MACHINE_EXEC_MAX_OUTPUT_CHARS,
  resolveMachineExecCommand,
  runMachineExec,
  type MachineExecInput,
} from "../src/commands/exec.js";
import type { MachineCommandResult, MachineCommandRunner } from "../src/remote.js";

function mockRunner(results: Record<string, MachineCommandResult>): MachineCommandRunner {
  return (machineId, command, options) => {
    const key = `${machineId}:${command}:${options?.timeoutMs ?? ""}`;
    const result = results[key];
    if (!result) {
      throw new Error(`unexpected runner call: ${key}`);
    }
    return result;
  };
}

describe("machines exec command", () => {
  test("requires machine, timeout, and argv or script", () => {
    expect(() => resolveMachineExecCommand({ machineId: "", timeoutMs: 1000, argv: ["true"] }))
      .toThrow("exec requires --machine <id>");
    expect(() => resolveMachineExecCommand({ machineId: "spark02", timeoutMs: 0, argv: ["true"] }))
      .toThrow("exec requires --timeout-ms <positive-ms>");
    expect(() => resolveMachineExecCommand({ machineId: "spark02", timeoutMs: 1000 }))
      .toThrow("exec requires command argv or --script stdin input");
    expect(() => resolveMachineExecCommand({
      machineId: "spark02",
      timeoutMs: 1000,
      argv: ["echo", "ok"],
      script: "echo ok",
    })).toThrow("exec accepts either argv or --script stdin input, not both");
  });

  test("builds argv commands with shell quoting", () => {
    expect(resolveMachineExecCommand({
      machineId: "spark02",
      timeoutMs: 1000,
      argv: ["git", "status"],
    })).toBe("'git' 'status'");
    expect(resolveMachineExecCommand({
      machineId: "spark02",
      timeoutMs: 1000,
      script: "echo hello",
    })).toBe("bash -c 'echo hello'");
  });

  test("known-success and known-failure paths produce distinct exit and streams", () => {
    const successCommand = "'true'";
    const failureCommand = "'false'";
    const runner = mockRunner({
      [`spark02:${successCommand}:5000`]: {
        machineId: "spark02",
        source: "ssh",
        stdout: "ok\n",
        stderr: "",
        exitCode: 0,
      },
      [`spark02:${failureCommand}:5000`]: {
        machineId: "spark02",
        source: "ssh",
        stdout: "",
        stderr: "boom\n",
        exitCode: 7,
      },
    });

    const success = runMachineExec({
      machineId: "spark02",
      timeoutMs: 5000,
      argv: ["true"],
    }, runner);
    const failure = runMachineExec({
      machineId: "spark02",
      timeoutMs: 5000,
      argv: ["false"],
    }, runner);

    expect(success.exit_code).toBe(0);
    expect(success.stdout.text).toBe("ok\n");
    expect(success.stderr.text).toBe("");
    expect(failure.exit_code).toBe(7);
    expect(failure.stdout.text).toBe("");
    expect(failure.stderr.text).toBe("boom\n");
    expect(success.exit_code).not.toBe(failure.exit_code);
  });

  test("caps stdout and stderr independently", () => {
    const runner: MachineCommandRunner = () => ({
      machineId: "local",
      source: "local",
      stdout: "a".repeat(40),
      stderr: "b".repeat(40),
      exitCode: 0,
    });

    const result = runMachineExec({
      machineId: "local",
      timeoutMs: 1000,
      argv: ["echo", "x"],
      maxOutputChars: 10,
    }, runner);

    expect(result.stdout.text).toContain("...[truncated");
    expect(result.stderr.text).toContain("...[truncated");
    expect(result.stdout.truncated).toBe(true);
    expect(result.stderr.truncated).toBe(true);
  });

  test("default output cap matches package constant", () => {
    expect(DEFAULT_MACHINE_EXEC_MAX_OUTPUT_CHARS).toBe(131_072);
  });
});
