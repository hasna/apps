import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { listOpenMachines, refreshLoopMachine, resolveLoopMachine, resolveMachineCommand } from "./machines.js";

const LOCAL_ID = "openloops-test-local-a71";
const REMOTE_ID = "openloops-test-remote-b82";
const REMOTE_HOSTNAME = "openloops-test-remote-host";

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

  test("listOpenMachines maps topology entries with local and route metadata", () => {
    const machines = listOpenMachines();
    const local = machines.find((machine) => machine.id === LOCAL_ID);
    const remote = machines.find((machine) => machine.id === REMOTE_ID);
    expect(local).toBeDefined();
    expect(local?.local).toBe(true);
    expect(local?.workspacePath).toBe("/workspace/local");
    expect(remote).toBeDefined();
    expect(remote?.local).toBe(false);
    expect(remote?.route).toBe("ssh");
    expect(remote?.hostname).toBe(REMOTE_HOSTNAME);
    expect(remote?.workspacePath).toBe("/workspace/remote");
    expect(remote?.tags).toEqual(["test"]);
  });

  test("resolveLoopMachine returns an ssh route ref for manifest-declared remotes", () => {
    const ref = resolveLoopMachine(REMOTE_ID);
    expect(ref.id).toBe(REMOTE_ID);
    expect(ref.requestedId).toBeUndefined();
    expect(ref.local).toBe(false);
    expect(ref.route).toBe("ssh");
    expect(ref.workspacePath).toBe("/workspace/remote");
    expect(ref.packageVersion).toBeDefined();
    expect(Number.isNaN(new Date(ref.resolvedAt!).getTime())).toBe(false);
  });

  test("resolveLoopMachine records the requested alias when resolving by hostname", () => {
    const ref = resolveLoopMachine(REMOTE_HOSTNAME);
    expect(ref.id).toBe(REMOTE_ID);
    expect(ref.requestedId).toBe(REMOTE_HOSTNAME);
    expect(ref.route).toBe("ssh");
  });

  test("resolveLoopMachine throws a routable error for unknown machines", () => {
    expect(() => resolveLoopMachine("openloops-test-missing-zz9")).toThrow(
      "OpenMachines route not found for machine: openloops-test-missing-zz9",
    );
  });

  test("refreshLoopMachine re-resolves the ref by machine id", () => {
    const original = resolveLoopMachine(REMOTE_ID);
    const refreshed = refreshLoopMachine(original);
    expect(refreshed.id).toBe(REMOTE_ID);
    expect(refreshed.route).toBe("ssh");
    expect(refreshed.workspacePath).toBe("/workspace/remote");
  });

  test("resolveMachineCommand fails closed instead of degrading to raw ssh for unknown machines", () => {
    // Regression: preflight must resolve the target machine through the
    // package-owned Machines canonical route. An id the topology cannot
    // resolve must fail with a route error, never silently become
    // `ssh <machine-id>` (which fails DNS on canonical machine names such as
    // the apple03 -> station03 alias in the original defect).
    expect(() => resolveMachineCommand("openloops-test-missing-zz9", "bash -s")).toThrow(
      "OpenMachines route not found for machine: openloops-test-missing-zz9",
    );
  });

  test("resolveMachineCommand targets the canonical route for manifest remotes", () => {
    const plan = resolveMachineCommand(REMOTE_ID, "bash -s");
    expect(plan.command).toBe("ssh");
    expect(plan.args[0]).toBe("tester@openloops-remote.example");
    expect(plan.args[1]).toBe("bash -s");
    expect(plan.source).toBe("ssh");
  });

  test("resolveMachineCommand keeps local machine plans local", () => {
    const plan = resolveMachineCommand(LOCAL_ID, "echo hi");
    expect(plan.command).toBe("bash");
    expect(plan.args).toEqual(["-c", "echo hi"]);
    expect(plan.source).toBe("local");
  });
});
