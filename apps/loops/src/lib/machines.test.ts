import { describe, expect, test } from "bun:test";
import {
  listOpenMachines,
  refreshLoopMachine,
  resolveLoopMachine,
  resolveMachineCommand,
  validateLoopMachineRef,
} from "./machines.js";

const MACHINES_DELETED =
  "@hasna/machines has been deleted (2026-09-03); machine-assigned loops are no longer supported. Remove the machine pin and run the loop locally.";

describe("machines", () => {
  test("every machine-routing entry point fails loud with the deletion error", () => {
    expect(() => listOpenMachines()).toThrow(MACHINES_DELETED);
    expect(() => resolveLoopMachine("any-id")).toThrow(MACHINES_DELETED);
    expect(() => refreshLoopMachine({ id: "any-id" } as never)).toThrow(MACHINES_DELETED);
    expect(() => resolveMachineCommand("any-id", "bash -s")).toThrow(MACHINES_DELETED);
  });

  test("the deletion error names the remediation (unpin and run locally)", () => {
    try {
      resolveLoopMachine("any-id");
      throw new Error("expected resolveLoopMachine to throw");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      expect(message).toContain("deleted");
      expect(message).toContain("Remove the machine pin and run the loop locally");
    }
  });

  test("validateLoopMachineRef still accepts a well-formed machine ref", () => {
    const ref = { id: "openloops-test-formal-a71" };
    expect(() => validateLoopMachineRef(ref)).not.toThrow();
  });

  test("validateLoopMachineRef rejects malformed machine pins at create time", () => {
    expect(() => validateLoopMachineRef(undefined)).toThrow("must be an object");
    expect(() => validateLoopMachineRef(null)).toThrow("must be an object");
    expect(() => validateLoopMachineRef("spark02")).toThrow("must be an object");
    expect(() => validateLoopMachineRef({})).toThrow("id must be a non-empty string");
    expect(() => validateLoopMachineRef({ id: "" })).toThrow("id must be a non-empty string");
    expect(() => validateLoopMachineRef({ id: "  " })).toThrow("id must be a non-empty string");
  });
});