import { describe, expect, it, mock, spyOn } from "bun:test";
import { Command } from "commander";

const fetchSpy = mock(async () => ({ ok: true, status: 200, json: async () => [] }));
(globalThis as { fetch: typeof fetch }).fetch = fetchSpy as typeof fetch;

const uploadSpy = mock(async () => ({ id: "synthetic-attachment" }));
mock.module("../../core/store", () => ({
  resolveStore: () => ({ uploadBuffer: uploadSpy, close: mock(() => undefined) }),
}));

const { registerSnapshotSession } = await import("./snapshot-session");

function buildProgram(): Command {
  const program = new Command();
  program.exitOverride();
  registerSnapshotSession(program);
  return program;
}

describe("snapshot-session safety gate", () => {
  it("fails closed before reading a Sessions endpoint", async () => {
    const error = spyOn(process.stderr, "write").mockImplementation(() => true);
    const exit = spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit called");
    });
    try {
      await expect(buildProgram().parseAsync(["snapshot-session", "synthetic-session"], { from: "user" }))
        .rejects.toThrow("process.exit called");
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(uploadSpy).not.toHaveBeenCalled();
      expect(error.mock.calls.flat().join(" ")).toContain("finite capture bounds");
    } finally {
      error.mockRestore();
      exit.mockRestore();
    }
  });

  it("fails closed before resolving a store or exposing attachment output", async () => {
    const error = spyOn(process.stderr, "write").mockImplementation(() => true);
    const exit = spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit called");
    });
    try {
      await expect(buildProgram().parseAsync([
        "snapshot-session",
        "synthetic-session",
        "--format",
        "html",
        "--expiry",
        "7d",
      ], { from: "user" })).rejects.toThrow("process.exit called");
      expect(uploadSpy).not.toHaveBeenCalled();
      expect(error.mock.calls.flat().join(" ")).not.toContain("synthetic-attachment");
    } finally {
      error.mockRestore();
      exit.mockRestore();
    }
  });
});
