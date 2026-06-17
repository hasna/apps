import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { manifestAdd, manifestInit } from "../src/commands/manifest.js";
import { buildSetupPlan, runSetup } from "../src/commands/setup.js";
import type { MachineCommandRunner } from "../src/remote.js";

describe("setup planning", () => {
  test("builds a provisioning plan from manifest packages", () => {
    const dir = mkdtempSync(join(tmpdir(), "machines-setup-"));
    process.env["HASNA_MACHINES_MANIFEST_PATH"] = join(dir, "machines.json");
    process.env["HASNA_MACHINES_MACHINE_ID"] = "spark01";
    manifestInit();
    manifestAdd({
      id: "spark01",
      platform: "linux",
      workspacePath: "/home/hasna/workspace",
      packages: [{ name: "ripgrep", manager: "apt" }, { name: "@hasna/takumi", manager: "bun" }],
    });

    const plan = buildSetupPlan("spark01");
    expect(plan.mode).toBe("plan");
    expect(plan.steps.length).toBeGreaterThanOrEqual(4);
    expect(plan.steps.some((step) => step.command.includes("apt-get install -y 'ripgrep'"))).toBe(true);
    expect(plan.steps.some((step) => step.command.includes("bun install -g '@hasna/takumi'"))).toBe(true);
  });

  test("requires explicit confirmation to execute", () => {
    const dir = mkdtempSync(join(tmpdir(), "machines-setup-guard-"));
    process.env["HASNA_MACHINES_MANIFEST_PATH"] = join(dir, "machines.json");
    manifestInit();

    expect(() => runSetup(undefined, { apply: true, yes: false })).toThrow("Setup execution requires --yes.");
  });

  test("does not fallback to the local machine for an explicit missing manifest id", () => {
    const dir = mkdtempSync(join(tmpdir(), "machines-setup-missing-"));
    process.env["HASNA_MACHINES_MANIFEST_PATH"] = join(dir, "machines.json");
    process.env["HASNA_MACHINES_MACHINE_ID"] = "local-fixture";
    manifestInit();

    expect(() => buildSetupPlan("unmanaged-fixture")).toThrow("Machine not found in manifest: unmanaged-fixture");
  });

  test("runs setup steps on the selected machine", () => {
    const dir = mkdtempSync(join(tmpdir(), "machines-setup-runner-"));
    process.env["HASNA_MACHINES_MANIFEST_PATH"] = join(dir, "machines.json");
    process.env["HASNA_MACHINES_MACHINE_ID"] = "local-fixture";
    manifestInit();
    manifestAdd({
      id: "remote-mac",
      platform: "macos",
      workspacePath: "/Users/hasna/Workspace",
    });

    const calls: string[] = [];
    const runner: MachineCommandRunner = (machineId, command) => {
      calls.push(`${machineId}:${command}`);
      return { machineId, source: "ssh", stdout: "", stderr: "", exitCode: 0 };
    };

    const result = runSetup("remote-mac", { apply: true, yes: true }, runner);
    expect(result.executed).toBe(result.steps.length);
    expect(calls.every((call) => call.startsWith("remote-mac:"))).toBe(true);
    expect(calls.some((call) => call.includes("mkdir -p '/Users/hasna/Workspace'"))).toBe(true);
  });
});
