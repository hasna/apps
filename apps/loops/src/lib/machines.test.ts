import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { listOpenMachines, refreshLoopMachine, resolveLoopMachine, resolveMachineCommand } from "./machines.js";

const LOCAL_ID = "openloops-test-local-a71";
const REMOTE_ID = "openloops-test-remote-b82";
const REMOTE_HOSTNAME = "openloops-test-remote-host";

const MACHINES_DELETED =
  "@hasna/machines has been deleted (2026-09-03); machine-assigned loops are no longer supported. Remove the machine pin and run the loop locally.";

describe("machines", () => {
  let root: string;
  let home: string;
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "loops-machines-"));
    home = mkdtempSync(join(tmpdir(), "loops-machines-home-"));
    for (const key of ["HASNA_MACHINES_DIR", "HASNA_MACHINES_MACHINE_ID"]) savedEnv[key] = process.env[key];
    process.env.HASNA_MACHINES_DIR = root;
    process.env.HASNA_MACHINES_MACHINE_ID = LOCAL_ID;
    writeFileSync(
      join(root, "machines.json"),
      JSON.stringify({
        version: 1,
        machines: [
          { id: LOCAL_ID, platform: "linux", workspacePath: "/workspace/local", connection: "local" },
          {
            id: REMOTE_ID,
            hostname: REMOTE_HOSTNAME,
            platform: "linux",
            workspacePath: "/workspace/remote",
            sshAddress: "tester@openloops-remote.example",
            tags: ["test"],
          },
        ],
      }),
    );
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    // Isolation guard: nothing may leak into a home-level .hasna directory.
    expect(existsSync(join(home, ".hasna"))).toBe(false);
    rmSync(root, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  });

  test("every machine entry point fails loudly with the deleted-package error", () => {
    // `@hasna/machines` was deleted from the public registry and from the tree
    // (2026-09-03). Machine-assigned loops are no longer supported: each entry
    // point must throw the same unavailable error, never silently fall back.
    expect(() => listOpenMachines()).toThrow(MACHINES_DELETED);
    expect(() => resolveLoopMachine(LOCAL_ID)).toThrow(MACHINES_DELETED);
    expect(() => resolveLoopMachine(REMOTE_ID)).toThrow(MACHINES_DELETED);
    expect(() => resolveLoopMachine(REMOTE_HOSTNAME)).toThrow(MACHINES_DELETED);
    expect(() => resolveLoopMachine("openloops-test-missing-zz9")).toThrow(MACHINES_DELETED);
    expect(() => refreshLoopMachine({ id: LOCAL_ID } as never)).toThrow(MACHINES_DELETED);
    expect(() => resolveMachineCommand(LOCAL_ID, "echo hi")).toThrow(MACHINES_DELETED);
    expect(() => resolveMachineCommand(REMOTE_ID, "bash -s")).toThrow(MACHINES_DELETED);
    expect(() => resolveMachineCommand("openloops-test-missing-zz9", "bash -s")).toThrow(MACHINES_DELETED);
  });
});