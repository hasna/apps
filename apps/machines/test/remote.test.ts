import { describe, expect, test } from "bun:test";
import { describeMachineCommandFailure, requireMachineCommandSuccess, resolveMachineCommand } from "../src/remote.js";

describe("machine command routing", () => {
  test("treats local aliases as local commands", () => {
    expect(resolveMachineCommand("local", "echo ok", "spark02")).toEqual({
      source: "local",
      shellCommand: "echo ok",
    });
    expect(resolveMachineCommand("localhost", "echo ok", "spark02").source).toBe("local");
    expect(resolveMachineCommand("spark02", "echo ok", "spark02").source).toBe("local");
  });

  test("falls back to direct SSH alias when a machine is not manifest-managed", () => {
    expect(resolveMachineCommand("unmanaged-fixture", "knowledge --version", "spark02")).toEqual({
      source: "ssh",
      shellCommand: "ssh 'unmanaged-fixture' 'knowledge --version'",
    });
  });

  test("formats and throws machine command failures with source and exit code", () => {
    const result = {
      machineId: "machine001",
      source: "ssh" as const,
      stdout: "",
      stderr: "Permission denied",
      exitCode: 255,
    };

    expect(describeMachineCommandFailure("Probe", result)).toContain("Probe failed on machine001 via ssh (exit 255)");
    expect(() => requireMachineCommandSuccess("Probe", result)).toThrow("Permission denied");
  });
});
