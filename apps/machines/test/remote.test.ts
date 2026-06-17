import { describe, expect, test } from "bun:test";
import { describeMachineCommandFailure, requireMachineCommandSuccess, resolveMachineCommand } from "../src/remote.js";

describe("machine command routing", () => {
  test("treats local aliases as local commands", () => {
    expect(resolveMachineCommand("local", "echo ok", "demo-node-02")).toEqual({
      source: "local",
      shellCommand: "echo ok",
    });
    expect(resolveMachineCommand("localhost", "echo ok", "demo-node-02").source).toBe("local");
    expect(resolveMachineCommand("demo-node-02", "echo ok", "demo-node-02").source).toBe("local");
  });

  test("falls back to direct SSH alias when a machine is not manifest-managed", () => {
    expect(resolveMachineCommand("unmanaged-fixture", "knowledge --version", "demo-node-02")).toEqual({
      source: "ssh",
      shellCommand: "ssh 'unmanaged-fixture' 'knowledge --version'",
    });
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
});
