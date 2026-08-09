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

  test("uses separate exact custom install and probe commands without collateral steps", () => {
    const dir = mkdtempSync(join(tmpdir(), "machines-apps-custom-contract-"));
    process.env["HASNA_MACHINES_MACHINE_ID"] = "local-fixture";
    process.env["HASNA_MACHINES_MANIFEST_PATH"] = join(dir, "machines.json");
    manifestInit();
    const installCommand = "bun install -g @hasna/skills@0.1.61";
    const probeCommand =
      "if version=$(skills --version 2>/dev/null); then printf 'installed=1\\nversion=%s\\n' \"$version\"; else printf 'installed=0\\n'; fi";
    manifestAdd({
      id: "remote-linux",
      platform: "linux",
      workspacePath: "/home/operator/workspace",
      apps: [{
        name: "skills",
        manager: "custom",
        packageName: "@hasna/skills",
        installCommand,
        probeCommand,
        expectedVersion: "0.1.61",
      }],
    });

    const plan = buildAppsPlan("remote-linux");
    expect(plan.steps).toEqual([{
      id: "app-skills",
      title: "Install skills on remote-linux",
      command: installCommand,
      manager: "custom",
      privileged: true,
      probeCommand,
      expectedVersion: "0.1.61",
    }]);
    expect(plan.planDigest).toMatch(/^[a-f0-9]{64}$/);

    const calls: string[] = [];
    const runner: MachineCommandRunner = (machineId, command) => {
      calls.push(`${machineId}:${command}`);
      if (command === "true") {
        return { machineId, source: "ssh", stdout: "", stderr: "", exitCode: 0 };
      }
      if (command === probeCommand) {
        return { machineId, source: "ssh", stdout: "installed=1\nversion=0.1.61\n", stderr: "", exitCode: 0 };
      }
      if (command === installCommand) {
        return { machineId, source: "ssh", stdout: "", stderr: "", exitCode: 0 };
      }
      throw new Error(`unexpected command: ${command}`);
    };

    expect(getAppsStatus("remote-linux", runner).apps).toEqual([{
      name: "skills",
      packageName: "@hasna/skills",
      manager: "custom",
      installed: true,
      version: "0.1.61",
    }]);
    const applied = runAppsInstall(
      "remote-linux",
      { apply: true, yes: true, expectedPlanDigest: plan.planDigest },
      runner,
    );
    expect(applied.executed).toBe(1);
    expect(calls).toEqual([
      "remote-linux:true",
      `remote-linux:${probeCommand}`,
      `remote-linux:${installCommand}`,
    ]);

    manifestAdd({
      id: "remote-linux",
      platform: "linux",
      workspacePath: "/home/operator/workspace",
      apps: [{
        name: "skills",
        manager: "custom",
        packageName: "@hasna/skills",
        installCommand,
        probeCommand: `${probeCommand}; :`,
        expectedVersion: "0.1.61",
      }],
    });
    const changedProbePlan = buildAppsPlan("remote-linux");
    expect(changedProbePlan.planDigest).not.toBe(plan.planDigest);

    manifestAdd({
      id: "remote-linux",
      platform: "linux",
      workspacePath: "/home/operator/workspace",
      apps: [{
        name: "skills",
        manager: "custom",
        packageName: "@hasna/skills",
        installCommand,
        probeCommand,
        expectedVersion: "0.1.60",
      }],
    });
    const changedExpectedVersionPlan = buildAppsPlan("remote-linux");
    expect(changedExpectedVersionPlan.planDigest).not.toBe(plan.planDigest);

    manifestAdd({
      id: "remote-linux",
      platform: "linux",
      workspacePath: "/home/operator/workspace",
      apps: [{
        name: "skills",
        manager: "custom",
        packageName: "@hasna/skills",
        installCommand: "bun install -g @hasna/skills@0.1.60",
        probeCommand,
        expectedVersion: "0.1.60",
      }],
    });
    const rollbackPlan = buildAppsPlan("remote-linux");
    expect(rollbackPlan.steps[0]?.command).toBe("bun install -g @hasna/skills@0.1.60");
    expect(rollbackPlan.planDigest).not.toBe(plan.planDigest);
  });

  test("rejects a custom install command without an exact probe command", () => {
    const dir = mkdtempSync(join(tmpdir(), "machines-apps-custom-missing-probe-"));
    process.env["HASNA_MACHINES_MANIFEST_PATH"] = join(dir, "machines.json");
    manifestInit();

    expect(() => manifestAdd({
      id: "remote-linux",
      platform: "linux",
      workspacePath: "/home/operator/workspace",
      apps: [{
        name: "skills",
        manager: "custom",
        packageName: "@hasna/skills",
        installCommand: "bun install -g @hasna/skills@0.1.61",
        expectedVersion: "0.1.61",
      }],
    })).toThrow("probeCommand");
  });

  test("fails closed when a custom probe emits malformed installed output", () => {
    const dir = mkdtempSync(join(tmpdir(), "machines-apps-custom-malformed-probe-"));
    process.env["HASNA_MACHINES_MANIFEST_PATH"] = join(dir, "machines.json");
    manifestInit();
    const probeCommand = "printf 'installed=1\\n'";
    manifestAdd({
      id: "remote-linux",
      platform: "linux",
      workspacePath: "/home/operator/workspace",
      apps: [{
        name: "skills",
        manager: "custom",
        packageName: "@hasna/skills",
        installCommand: "bun install -g @hasna/skills@0.1.61",
        probeCommand,
        expectedVersion: "0.1.61",
      }],
    });

    const runner: MachineCommandRunner = (machineId, command) => ({
      machineId,
      source: "ssh",
      stdout: command === "true" ? "" : "installed=1\n",
      stderr: "",
      exitCode: 0,
    });
    expect(() => getAppsStatus("remote-linux", runner)).toThrow("malformed");
  });

  test("fails closed when a custom probe reports a mismatched expected version", () => {
    const dir = mkdtempSync(join(tmpdir(), "machines-apps-custom-version-mismatch-"));
    process.env["HASNA_MACHINES_MANIFEST_PATH"] = join(dir, "machines.json");
    manifestInit();
    const probeCommand = "printf 'installed=1\\nversion=0.1.60\\n'";
    manifestAdd({
      id: "remote-linux",
      platform: "linux",
      workspacePath: "/home/operator/workspace",
      apps: [{
        name: "skills",
        manager: "custom",
        packageName: "@hasna/skills",
        installCommand: "bun install -g @hasna/skills@0.1.61",
        probeCommand,
        expectedVersion: "0.1.61",
      }],
    });

    const runner: MachineCommandRunner = (machineId, command) => ({
      machineId,
      source: "ssh",
      stdout: command === "true" ? "" : "installed=1\nversion=0.1.60\n",
      stderr: "",
      exitCode: 0,
    });
    expect(getAppsStatus("remote-linux", runner).apps[0]).toEqual({
      name: "skills",
      packageName: "@hasna/skills",
      manager: "custom",
      installed: false,
      version: "0.1.60",
    });
  });

  test("keeps legacy custom packageName install and command-v probe semantics", () => {
    const dir = mkdtempSync(join(tmpdir(), "machines-apps-custom-legacy-"));
    process.env["HASNA_MACHINES_MANIFEST_PATH"] = join(dir, "machines.json");
    manifestInit();
    manifestAdd({
      id: "remote-linux",
      platform: "linux",
      workspacePath: "/home/operator/workspace",
      apps: [{ name: "shell", manager: "custom", packageName: "sh" }],
    });

    expect(buildAppsPlan("remote-linux").steps[0]?.command).toBe("sh");
    const calls: string[] = [];
    const runner: MachineCommandRunner = (machineId, command) => {
      calls.push(command);
      return {
        machineId,
        source: "ssh",
        stdout: command === "true" ? "" : "installed=1\nversion=custom\n",
        stderr: "",
        exitCode: 0,
      };
    };
    expect(getAppsStatus("remote-linux", runner).apps[0]?.installed).toBe(true);
    expect(calls).toEqual([
      "true",
      "if command -v 'sh' >/dev/null 2>&1; then printf 'installed=1\\nversion=custom\\n'; else printf 'installed=0\\n'; fi",
    ]);
  });

  test("keeps apt, brew, and winget install command compatibility", () => {
    const dir = mkdtempSync(join(tmpdir(), "machines-apps-manager-compat-"));
    process.env["HASNA_MACHINES_MANIFEST_PATH"] = join(dir, "machines.json");
    manifestInit();
    manifestAdd({
      id: "linux-node",
      platform: "linux",
      workspacePath: "/home/operator/workspace",
      apps: [{ name: "curl", manager: "apt" }],
    });
    manifestAdd({
      id: "mac-node",
      platform: "macos",
      workspacePath: "/Users/operator/Workspace",
      apps: [{ name: "jq", manager: "brew" }],
    });
    manifestAdd({
      id: "windows-node",
      platform: "windows",
      workspacePath: "C:\\Users\\operator\\Workspace",
      apps: [{ name: "Git.Git", manager: "winget" }],
    });

    expect(buildAppsPlan("linux-node").steps[0]?.command).toBe("sudo apt-get install -y 'curl'");
    expect(buildAppsPlan("mac-node").steps[0]?.command).toBe("brew install 'jq'");
    expect(buildAppsPlan("windows-node").steps[0]?.command).toBe("winget install 'Git.Git'");

    const probes = new Map<string, string>();
    const runner: MachineCommandRunner = (machineId, command) => {
      if (command === "true") {
        return { machineId, source: "ssh", stdout: "", stderr: "", exitCode: 0 };
      }
      probes.set(machineId, command);
      const stdout = machineId === "windows-node"
        ? "installed=1\r\nversion=installed\r\n"
        : `installed=1\nversion=${machineId === "linux-node" ? "8.10.1" : "1.7.1"}\n`;
      return { machineId, source: "ssh", stdout, stderr: "", exitCode: 0 };
    };
    expect(getAppsStatus("linux-node", runner).apps[0]?.installed).toBe(true);
    expect(getAppsStatus("mac-node", runner).apps[0]?.installed).toBe(true);
    expect(getAppsStatus("windows-node", runner).apps[0]?.installed).toBe(true);
    expect(probes).toEqual(new Map([
      [
        "linux-node",
        "if dpkg-query -W -f='${Version}' 'curl' >/tmp/machines-app-version 2>/dev/null; then printf 'installed=1\\nversion='; cat /tmp/machines-app-version; printf '\\n'; rm -f /tmp/machines-app-version; else printf 'installed=0\\n'; fi",
      ],
      [
        "mac-node",
        "if brew list --versions 'jq' >/dev/null 2>&1; then printf 'installed=1\\nversion='; brew list --versions 'jq' | awk '{print $2}'; printf '\\n'; else printf 'installed=0\\n'; fi",
      ],
      [
        "windows-node",
        "if winget list --id 'Git.Git' --exact >/dev/null 2>&1; then printf 'installed=1\\nversion=installed\\n'; else printf 'installed=0\\n'; fi",
      ],
    ]));
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

  test("rejects stale expected plan digests before running app install commands", () => {
    const dir = mkdtempSync(join(tmpdir(), "machines-apps-plan-digest-"));
    process.env["HASNA_MACHINES_MACHINE_ID"] = "local-fixture";
    process.env["HASNA_MACHINES_MANIFEST_PATH"] = join(dir, "machines.json");
    manifestInit();
    manifestAdd({
      id: "remote-mac",
      platform: "macos",
      workspacePath: "/Users/operator/Workspace",
      apps: [],
    });
    const approvedPlan = buildAppsPlan("remote-mac");
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

    expect(() => runAppsInstall("remote-mac", { apply: true, yes: true, expectedPlanDigest: approvedPlan.planDigest }, runner))
      .toThrow("Approved plan digest");
    expect(calls).toEqual([]);
  });
});
