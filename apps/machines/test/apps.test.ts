import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildAppsPlan, diffApps, getAppsStatus, listApps, runAppsInstall } from "../src/commands/apps.js";
import { manifestAdd, manifestInit } from "../src/commands/manifest.js";
import type { MachineCommandRunner } from "../src/remote.js";

describe("apps", () => {
  afterEach(() => {
    delete process.env["HASNA_MACHINES_MANIFEST_PATH"];
    delete process.env["HASNA_MACHINES_MACHINE_ID"];
  });

  test("lists apps from manifest", () => {
    const dir = mkdtempSync(join(tmpdir(), "machines-apps-"));
    process.env["HASNA_MACHINES_MACHINE_ID"] = "demo-controller-03";
    process.env["HASNA_MACHINES_MANIFEST_PATH"] = join(dir, "machines.json");
    manifestInit();
    manifestAdd({
      id: "demo-controller-03",
      platform: "macos",
      workspacePath: "/Users/operator/Workspace",
      apps: [{ name: "ghostty", manager: "cask" }],
    });

    const result = listApps("demo-controller-03");
    expect(result.apps).toHaveLength(1);
    expect(result.apps[0]?.name).toBe("ghostty");
  });

  test("builds app install commands by platform", () => {
    const dir = mkdtempSync(join(tmpdir(), "machines-apps-"));
    process.env["HASNA_MACHINES_MACHINE_ID"] = "demo-controller-03";
    process.env["HASNA_MACHINES_MANIFEST_PATH"] = join(dir, "machines.json");
    manifestInit();
    manifestAdd({
      id: "demo-controller-03",
      platform: "macos",
      workspacePath: "/Users/operator/Workspace",
      apps: [{ name: "ghostty", manager: "cask" }],
    });

    const plan = buildAppsPlan("demo-controller-03");
    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0]?.command).toContain("brew install --cask 'ghostty'");
  });

  test("computes app status and diff", () => {
    const dir = mkdtempSync(join(tmpdir(), "machines-apps-status-"));
    process.env["HASNA_MACHINES_MACHINE_ID"] = "demo-node-01";
    process.env["HASNA_MACHINES_MANIFEST_PATH"] = join(dir, "machines.json");
    manifestInit();
    manifestAdd({
      id: "demo-node-01",
      platform: "linux",
      workspacePath: "/home/operator/workspace",
      apps: [
        { name: "shell", manager: "custom", packageName: "sh" },
        { name: "missing", manager: "custom", packageName: "__missing_app__" },
      ],
    });

    const status = getAppsStatus("demo-node-01");
    expect(status.apps).toHaveLength(2);
    expect(status.apps.some((app) => app.name === "shell" && app.installed)).toBe(true);
    const diff = diffApps("demo-node-01");
    expect(diff.installed).toContain("shell");
    expect(diff.missing).toContain("missing");
  });

  test("surfaces remote readiness failures for app status", () => {
    const dir = mkdtempSync(join(tmpdir(), "machines-apps-remote-fail-"));
    process.env["HASNA_MACHINES_MACHINE_ID"] = "remote-mac";
    process.env["HASNA_MACHINES_MANIFEST_PATH"] = join(dir, "machines.json");
    manifestInit();
    manifestAdd({
      id: "remote-mac",
      platform: "macos",
      workspacePath: "/Users/operator/Workspace",
      apps: [],
    });

    const runner: MachineCommandRunner = (machineId) => ({
      machineId,
      source: "ssh",
      stdout: "",
      stderr: "Permission denied",
      exitCode: 255,
    });

    expect(() => getAppsStatus("remote-mac", runner)).toThrow("Apps status readiness check failed");
  });

  test("checks readiness for an explicit unmanaged machine id instead of falling back to local", () => {
    const dir = mkdtempSync(join(tmpdir(), "machines-apps-unmanaged-"));
    process.env["HASNA_MACHINES_MACHINE_ID"] = "local-fixture";
    process.env["HASNA_MACHINES_MANIFEST_PATH"] = join(dir, "machines.json");
    manifestInit();

    const calls: string[] = [];
    const runner: MachineCommandRunner = (machineId, command) => {
      calls.push(`${machineId}:${command}`);
      return { machineId, source: "tailscale", stdout: "", stderr: "", exitCode: 0 };
    };

    const status = getAppsStatus("unmanaged-fixture", runner);
    expect(status.machineId).toBe("unmanaged-fixture");
    expect(status.source).toBe("tailscale");
    expect(status.apps).toEqual([]);
    expect(calls).toEqual(["unmanaged-fixture:true"]);
  });

  test("runs app install steps on the selected machine", () => {
    const dir = mkdtempSync(join(tmpdir(), "machines-apps-runner-"));
    process.env["HASNA_MACHINES_MACHINE_ID"] = "local-fixture";
    process.env["HASNA_MACHINES_MANIFEST_PATH"] = join(dir, "machines.json");
    manifestInit();
    manifestAdd({
      id: "remote-mac",
      platform: "macos",
      workspacePath: "/Users/operator/Workspace",
      apps: [{ name: "ghostty", manager: "cask" }],
    });

    const calls: string[] = [];
    const runner: MachineCommandRunner = (machineId, command) => {
      calls.push(`${machineId}:${command}`);
      return { machineId, source: "ssh", stdout: "", stderr: "", exitCode: 0 };
    };

    const result = runAppsInstall("remote-mac", { apply: true, yes: true }, runner);
    expect(result.executed).toBe(1);
    expect(calls).toEqual(["remote-mac:brew install --cask 'ghostty'"]);
  });
});
