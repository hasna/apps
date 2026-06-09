import { describe, expect, test } from "bun:test";
import { resolveMachineCommand } from "../src/remote.js";

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
});
