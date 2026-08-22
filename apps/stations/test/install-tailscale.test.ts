import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { manifestAdd, manifestInit } from "../src/commands/manifest.js";
import { buildTailscaleInstallPlan, runTailscaleInstall } from "../src/commands/install-tailscale.js";
import type { MachineCommandRunner } from "../src/remote.js";

describe("tailscale install", () => {
  test("builds platform-specific install steps", () => {
    const dir = mkdtempSync(join(tmpdir(), "stations-tailscale-"));
    process.env["HASNA_STATIONS_MANIFEST_PATH"] = join(dir, "stations.json");
    manifestInit();
    manifestAdd({
      id: "demo-controller-03",
      platform: "macos",
      workspacePath: "/Users/operator/Workspace",
    });

    const plan = buildTailscaleInstallPlan("demo-controller-03");
    expect(plan.steps[0]?.command).toContain("brew install --cask tailscale");
  });

  test("requires confirmation to execute", () => {
    expect(() => runTailscaleInstall(undefined, { apply: true, yes: false })).toThrow("Tailscale install requires --yes.");
  });

  test("does not fallback to the local machine for an explicit missing manifest id", () => {
    const dir = mkdtempSync(join(tmpdir(), "stations-tailscale-missing-"));
    process.env["HASNA_STATIONS_MANIFEST_PATH"] = join(dir, "stations.json");
    process.env["HASNA_STATIONS_MACHINE_ID"] = "local-fixture";
    manifestInit();

    expect(() => buildTailscaleInstallPlan("unmanaged-fixture")).toThrow("Machine not found in manifest: unmanaged-fixture");
  });

  test("runs install steps on the selected machine", () => {
    const dir = mkdtempSync(join(tmpdir(), "stations-tailscale-runner-"));
    process.env["HASNA_STATIONS_MANIFEST_PATH"] = join(dir, "stations.json");
    process.env["HASNA_STATIONS_MACHINE_ID"] = "local-fixture";
    manifestInit();
    manifestAdd({
      id: "remote-mac",
      platform: "macos",
      workspacePath: "/Users/operator/Workspace",
    });

    const calls: string[] = [];
    const runner: MachineCommandRunner = (machineId, command) => {
      calls.push(`${machineId}:${command}`);
      return { machineId, source: "ssh", stdout: "", stderr: "", exitCode: 0 };
    };

    const result = runTailscaleInstall("remote-mac", { apply: true, yes: true }, runner);
    expect(result.executed).toBe(1);
    expect(calls).toEqual(["remote-mac:brew install --cask tailscale"]);
  });

  test("rejects stale expected plan digests before running install commands", () => {
    const dir = mkdtempSync(join(tmpdir(), "stations-tailscale-plan-digest-"));
    process.env["HASNA_STATIONS_MANIFEST_PATH"] = join(dir, "stations.json");
    process.env["HASNA_STATIONS_MACHINE_ID"] = "local-fixture";
    manifestInit();
    manifestAdd({
      id: "remote-node",
      platform: "macos",
      workspacePath: "/Users/operator/Workspace",
    });
    const approvedPlan = buildTailscaleInstallPlan("remote-node");
    manifestAdd({
      id: "remote-node",
      platform: "linux",
      workspacePath: "/home/operator/workspace",
    });

    const calls: string[] = [];
    const runner: MachineCommandRunner = (machineId, command) => {
      calls.push(`${machineId}:${command}`);
      return { machineId, source: "ssh", stdout: "", stderr: "", exitCode: 0 };
    };

    expect(() => runTailscaleInstall("remote-node", { apply: true, yes: true, expectedPlanDigest: approvedPlan.planDigest }, runner))
      .toThrow("Approved plan digest");
    expect(calls).toEqual([]);
  });
});
