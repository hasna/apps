import { describe, expect, test } from "bun:test";
import {
  DEFAULT_MACHINE_EXEC_MAX_OUTPUT_CHARS,
  DEFAULT_MACHINE_EXEC_MAX_SCRIPT_CHARS,
  readBoundedMachineExecScript,
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

describe("stations exec command", () => {
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
      stdout: "a".repeat(120),
      stderr: "b".repeat(120),
      exitCode: 0,
    });
    const maxOutputChars = 50;

    const result = runMachineExec({
      machineId: "local",
      timeoutMs: 1000,
      argv: ["echo", "x"],
      maxOutputChars,
    }, runner);

    expect(result.stdout.text).toContain("...[truncated");
    expect(result.stderr.text).toContain("...[truncated");
    expect(result.stdout.text.length).toBeLessThanOrEqual(maxOutputChars);
    expect(result.stderr.text.length).toBeLessThanOrEqual(maxOutputChars);
    expect(result.stdout.truncated).toBe(true);
    expect(result.stderr.truncated).toBe(true);
  });

  test("returned stdout and stderr including truncation suffix obey maxOutputChars", () => {
    const longOutput = "x".repeat(500);
    const runner: MachineCommandRunner = () => ({
      machineId: "local",
      source: "local",
      stdout: longOutput,
      stderr: longOutput,
      exitCode: 0,
    });
    const maxOutputChars = 64;

    const result = runMachineExec({
      machineId: "local",
      timeoutMs: 1000,
      argv: ["echo", "x"],
      maxOutputChars,
    }, runner);

    expect(result.stdout.text.length).toBeLessThanOrEqual(maxOutputChars);
    expect(result.stderr.text.length).toBeLessThanOrEqual(maxOutputChars);
    expect(result.stdout.truncated).toBe(true);
    expect(result.stderr.truncated).toBe(true);
  });

  test("redacts credentials split at the visible output boundary", () => {
    const credential = `AK${"IA"}${"A".repeat(16)}`;
    const output = `${credential}\n`;
    const maxOutputChars = credential.length - 1;
    const childScript = `process.stdout.write(${JSON.stringify(output)});`;

    const result = runMachineExec({
      machineId: "local",
      timeoutMs: 1000,
      argv: [process.execPath, "--eval", childScript],
      maxOutputChars,
    });

    expect(result.stdout.text).toContain("[redacted]");
    expect(result.stdout.text).not.toContain(credential.slice(0, -1));
    expect(result.stdout.text.length).toBeLessThanOrEqual(maxOutputChars);
  });

  test("fails closed when a runner returns raw truncated output before redaction", () => {
    const assignmentKey = ["AWS", "SECRET", "ACCESS", "KEY"].join("_");
    const leadingSecret = `${assignmentKey}=${"s".repeat(600)}\n`;
    const credential = `AK${"IA"}${"A".repeat(16)}`;
    const maxOutputChars = 200;
    const collectionLimit = maxOutputChars + 512;
    const filler = `${"x".repeat(collectionLimit - leadingSecret.length - 9)} `;
    const output = `${leadingSecret}${filler}${credential}\n`;
    const runner: MachineCommandRunner = (machineId) => ({
      machineId,
      source: "local",
      stdout: output.slice(0, collectionLimit),
      stderr: "",
      exitCode: 0,
      stdoutTruncated: true,
      stdoutChars: output.length,
      stdoutRedacted: false,
    });

    const result = runMachineExec({
      machineId: "local",
      timeoutMs: 1000,
      argv: ["true"],
      maxOutputChars,
    }, runner);

    expect(result.stdout.text).toContain("...[truncated");
    expect(result.stdout.text).not.toContain(`${assignmentKey}=`);
    expect(result.stdout.text).not.toContain(credential.slice(0, 8));
    expect(result.stdout.text.length).toBeLessThanOrEqual(maxOutputChars);
  });

  test("redacts credentials split across process output chunks before collection truncates", () => {
    const assignmentKey = ["AWS", "SECRET", "ACCESS", "KEY"].join("_");
    const credentialPrefix = ["AK", "IA"].join("");
    const maxOutputChars = 200;
    const collectionLimit = maxOutputChars + 512;
    const leadingSecret = `${assignmentKey}=${"s".repeat(600)}\n`;
    const filler = `${"x".repeat(collectionLimit - leadingSecret.length - 9)} `;
    const firstChunk = `${leadingSecret}${filler}${credentialPrefix}${"A".repeat(4)}`;
    const secondChunk = `${"A".repeat(12)}\n`;
    const childScript = [
      `process.stdout.write(${JSON.stringify(firstChunk)});`,
      `process.stderr.write(${JSON.stringify(firstChunk)});`,
      "setTimeout(() => {",
      `process.stdout.write(${JSON.stringify(secondChunk)});`,
      `process.stderr.write(${JSON.stringify(secondChunk)});`,
      "}, 20);",
    ].join("");

    const result = runMachineExec({
      machineId: "local",
      timeoutMs: 2000,
      argv: [process.execPath, "--eval", childScript],
      maxOutputChars,
    });

    expect(result.exit_code).toBe(0);
    expect(result.stdout.text).toContain(`${assignmentKey}=[redacted]`);
    expect(result.stdout.text).not.toContain(`${credentialPrefix}${"A".repeat(4)}`);
    expect(result.stdout.text.length).toBeLessThanOrEqual(maxOutputChars);
    expect(result.stderr.text).toContain(`${assignmentKey}=[redacted]`);
    expect(result.stderr.text).not.toContain(`${credentialPrefix}${"A".repeat(4)}`);
    expect(result.stderr.text.length).toBeLessThanOrEqual(maxOutputChars);
  });

  test("rejects scripts longer than 65536 characters before execution", () => {
    let called = false;
    const runner: MachineCommandRunner = () => {
      called = true;
      return {
        machineId: "local",
        source: "local",
        stdout: "",
        stderr: "",
        exitCode: 0,
      };
    };

    expect(() => resolveMachineExecCommand({
      machineId: "local",
      timeoutMs: 1000,
      script: "x".repeat(DEFAULT_MACHINE_EXEC_MAX_SCRIPT_CHARS + 1),
    })).toThrow(`Script exceeds ${DEFAULT_MACHINE_EXEC_MAX_SCRIPT_CHARS} characters`);
    expect(() => runMachineExec({
      machineId: "local",
      timeoutMs: 1000,
      script: "x".repeat(DEFAULT_MACHINE_EXEC_MAX_SCRIPT_CHARS + 1),
    }, runner)).toThrow(`Script exceeds ${DEFAULT_MACHINE_EXEC_MAX_SCRIPT_CHARS} characters`);
    expect(called).toBe(false);
  });

  test("accepts scripts at the 65536 character pre-materialization bound", () => {
    const script = "x".repeat(DEFAULT_MACHINE_EXEC_MAX_SCRIPT_CHARS);
    expect(resolveMachineExecCommand({
      machineId: "local",
      timeoutMs: 1000,
      script,
    })).toBe(`bash -c '${"x".repeat(DEFAULT_MACHINE_EXEC_MAX_SCRIPT_CHARS)}'`);
  });

  test("rejects raw scripts over the limit before trimming", () => {
    const script = `${"x".repeat(DEFAULT_MACHINE_EXEC_MAX_SCRIPT_CHARS)}\n`;
    expect(() => resolveMachineExecCommand({
      machineId: "local",
      timeoutMs: 1000,
      script,
    })).toThrow(`Script exceeds ${DEFAULT_MACHINE_EXEC_MAX_SCRIPT_CHARS} characters`);
  });

  test("stops reading script stdin as soon as the character limit is exceeded", () => {
    const chunks = Array.from({ length: 10 }, () => Buffer.alloc(8_192, "x"));
    let reads = 0;
    const readChunk = (buffer: Buffer): number => {
      const chunk = chunks[reads++];
      if (!chunk) return 0;
      chunk.copy(buffer);
      return chunk.length;
    };

    expect(() => readBoundedMachineExecScript(readChunk))
      .toThrow(`Script exceeds ${DEFAULT_MACHINE_EXEC_MAX_SCRIPT_CHARS} characters`);
    expect(reads).toBe(9);
  });

  test("accepts scripts at the exact stdin character limit", () => {
    const chunks = Array.from({ length: 8 }, () => Buffer.alloc(8_192, "x"));
    let reads = 0;
    const script = readBoundedMachineExecScript((buffer) => {
      const chunk = chunks[reads++];
      if (!chunk) return 0;
      chunk.copy(buffer);
      return chunk.length;
    });

    expect(script.length).toBe(DEFAULT_MACHINE_EXEC_MAX_SCRIPT_CHARS);
    expect(() => resolveMachineExecCommand({
      machineId: "local",
      timeoutMs: 1000,
      script,
    })).not.toThrow();
  });

  test("default output cap matches package constant", () => {
    expect(DEFAULT_MACHINE_EXEC_MAX_OUTPUT_CHARS).toBe(131_072);
  });
});
