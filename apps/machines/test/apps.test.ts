import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { buildAppsPlan, diffApps, getAppsStatus, listApps, runAppsInstall, runAppsPlan, validateAppsCandidate } from "../src/commands/apps.js";
import { manifestAdd, manifestInit } from "../src/commands/manifest.js";
import type { MachineCommandRunner } from "../src/remote.js";
import { exactBunCandidate, exactBunFixtureSource, exactBunTargetFixtures, writeExactBunCandidate } from "./fixtures/exact-bun.js";

const probeFixtureDirs: string[] = [];

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function createExactBunPackageFixture(expectedVersion: string) {
  const dir = mkdtempSync(join(tmpdir(), "machines-apps-package-exact-"));
  probeFixtureDirs.push(dir);
  const manifestPath = join(dir, "machines.json");
  process.env["HASNA_MACHINES_MANIFEST_PATH"] = manifestPath;
  writeFileSync(manifestPath, `${JSON.stringify({
    version: 1,
    packages: [{
      name: "@hasna/machines",
      manager: "bun",
      version: expectedVersion,
      bin: "machines",
    }],
    machines: [{
      id: "remote-linux",
      platform: "linux",
      workspacePath: "/home/operator/workspace",
    }],
  }, null, 2)}\n`);

  const plan = buildAppsPlan("remote-linux");
  const step = plan.steps[0];
  if (!step?.probeCommand || !step.command) throw new Error("expected one exact Bun package step");
  return { plan, probeCommand: step.probeCommand, installCommand: step.command };
}

function runProbeCommand(probeCommand: string, binaryOutput: string) {
  const dir = mkdtempSync(join(tmpdir(), "machines-apps-probe-bin-"));
  probeFixtureDirs.push(dir);
  const binDir = join(dir, "bin");
  mkdirSync(binDir);
  const binaryPath = join(binDir, "machines");
  const bunPath = join(binDir, "bun");
  writeFileSync(bunPath, `#!/bin/sh\nprintf '%s\\n' ${shellQuote(binDir)}\n`);
  writeFileSync(binaryPath, `#!/bin/sh\nprintf '%s\\n' ${shellQuote(binaryOutput)}\n`);
  chmodSync(bunPath, 0o755);
  chmodSync(binaryPath, 0o755);
  return spawnSync("sh", ["-c", probeCommand], {
    env: { ...process.env, PATH: `${binDir}:${process.env.PATH ?? ""}` },
    encoding: "utf8",
  });
}

describe("apps", () => {
  afterEach(() => {
    delete process.env["HASNA_MACHINES_MANIFEST_PATH"];
    delete process.env["HASNA_MACHINES_MACHINE_ID"];
    while (probeFixtureDirs.length > 0) {
      rmSync(probeFixtureDirs.pop()!, { force: true, recursive: true });
    }
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

  test("fails closed when the exact Bun version banner does not match", () => {
    const { probeCommand } = createExactBunPackageFixture("0.2.21");
    const result = runProbeCommand(probeCommand, "machines v0.2.20 (build 2026.08.13)");
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("installed=1\nversion=0.2.20\n");
    expect(result.stderr).toBe("");

    const runner: MachineCommandRunner = (machineId, command) => ({
      machineId,
      source: "ssh",
      stdout: command === "true" ? "" : result.stdout,
      stderr: "",
      exitCode: 0,
    });
    expect(getAppsStatus("remote-linux", runner).apps[0]).toEqual({
      name: "@hasna/machines",
      packageName: "@hasna/machines",
      manager: "bun",
      installed: false,
      version: "0.2.20",
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

  test("installs exact Bun package specs through apps and verifies the declared executable version", () => {
    const { plan } = createExactBunPackageFixture("0.2.21");
    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0]).toMatchObject({
      id: "package-hasna-machines",
      title: "Install @hasna/machines@0.2.21 on remote-linux",
      command: "bun install -g '@hasna/machines@0.2.21'",
      manager: "bun",
      privileged: false,
      expectedVersion: "0.2.21",
    });
    expect(plan.steps[0]?.probeCommand).toContain("managerPath");
    expect(plan.steps[0]?.probeCommand).toContain("--version");
    expect(plan.steps[0]?.probeCommand).not.toContain("@hasna/machines@0.2.21");
    expect(JSON.stringify(plan)).not.toContain("publish-token");
    expect(JSON.stringify(plan)).not.toContain("NODE_AUTH_TOKEN");

    const calls: Array<{ command: string; redactOutput: boolean }> = [];
    const runner: MachineCommandRunner = (machineId, command, options) => {
      calls.push({ command, redactOutput: options?.redactOutput === true });
      if (command === "true") return { machineId, source: "ssh", stdout: "", stderr: "", exitCode: 0 };
      if (command.includes("managerPath") && command.includes("--version")) {
        return { machineId, source: "ssh", stdout: "installed=1\nversion=0.2.21\n", stderr: "", exitCode: 0 };
      }
      if (command === "bun install -g '@hasna/machines@0.2.21'") {
        return { machineId, source: "ssh", stdout: "", stderr: "", exitCode: 0 };
      }
      throw new Error(`unexpected command: ${command}`);
    };

    expect(getAppsStatus("remote-linux", runner).apps).toEqual([{
      name: "@hasna/machines",
      packageName: "@hasna/machines",
      manager: "bun",
      installed: true,
      version: "0.2.21",
    }]);
    const applied = runAppsInstall(
      "remote-linux",
      { apply: true, yes: true, expectedPlanDigest: plan.planDigest },
      runner,
    );
    expect(applied.executed).toBe(1);
    expect(calls).toEqual([
      { command: "true", redactOutput: false },
      { command: plan.steps[0]?.probeCommand, redactOutput: true },
      { command: "bun install -g '@hasna/machines@0.2.21'", redactOutput: true },
      { command: plan.steps[0]?.probeCommand, redactOutput: true },
    ]);
  });

  test("reports a Bun owner/PATH collision instead of trusting a shadowed executable", () => {
    const dir = mkdtempSync(join(tmpdir(), "machines-apps-bun-owner-collision-"));
    probeFixtureDirs.push(dir);
    const manifestPath = join(dir, "machines.json");
    process.env["HASNA_MACHINES_MANIFEST_PATH"] = manifestPath;
    writeFileSync(manifestPath, `${JSON.stringify({
      version: 1,
      packages: [{
        name: "@hasna/codewith",
        manager: "bun",
        version: "0.1.92",
        bin: "codewith",
      }],
      machines: [{
        id: "remote-linux",
        platform: "linux",
        workspacePath: "/home/operator/workspace",
      }],
    }, null, 2)}\n`);

    const plan = buildAppsPlan("remote-linux");
    if (!("steps" in plan) || !plan.steps[0]?.probeCommand) throw new Error("expected one Bun package step");
    const fakeBinDir = join(dir, "fake-bin");
    const managerBinDir = join(dir, "bun-bin");
    const shadowBinDir = join(dir, "shadow-bin");
    mkdirSync(fakeBinDir);
    mkdirSync(managerBinDir);
    mkdirSync(shadowBinDir);
    writeFileSync(join(fakeBinDir, "bun"), `#!/bin/sh\nprintf '%s\\n' ${shellQuote(managerBinDir)}\n`);
    writeFileSync(join(managerBinDir, "codewith"), "#!/bin/sh\nprintf 'codewith 0.1.92\\n'\n");
    writeFileSync(join(shadowBinDir, "codewith"), "#!/bin/sh\nprintf 'codewith 0.1.90\\n'\n");
    chmodSync(join(fakeBinDir, "bun"), 0o755);
    chmodSync(join(managerBinDir, "codewith"), 0o755);
    chmodSync(join(shadowBinDir, "codewith"), 0o755);

    const runner: MachineCommandRunner = (machineId, command) => {
      if (command === "bun install -g '@hasna/codewith@0.1.92'") {
        return { machineId, source: "ssh", stdout: "", stderr: "", exitCode: 0 };
      }
      const result = spawnSync("sh", ["-c", command], {
        env: { ...process.env, PATH: `${shadowBinDir}:${fakeBinDir}:${process.env.PATH ?? ""}` },
        encoding: "utf8",
      });
      return {
        machineId,
        source: "ssh",
        stdout: result.stdout ?? "",
        stderr: result.stderr ?? "",
        exitCode: result.status ?? 1,
      };
    };

    expect(() => runAppsInstall(
      "remote-linux",
      { apply: true, yes: true, expectedPlanDigest: plan.planDigest },
      runner,
    )).toThrow(new RegExp(`owner/PATH collision:.*${managerBinDir}.*${shadowBinDir}`));
  });

  test("extracts the version token from a banner with trailing build metadata", () => {
    const { probeCommand } = createExactBunPackageFixture("0.2.21");
    const result = runProbeCommand(probeCommand, "machines v0.2.21 (build 2026.08.13)");
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("installed=1\nversion=0.2.21\n");
    expect(result.stderr).toBe("");
  });

  test("extracts the version token from a banner with adjacent node metadata", () => {
    const { probeCommand } = createExactBunPackageFixture("1.2.3");
    const result = runProbeCommand(probeCommand, "version 1.2.3 (node 20.11.1)");
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("installed=1\nversion=1.2.3\n");
    expect(result.stderr).toBe("");
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

  test("validates, plans, and carries an exact candidate source only through runner stdin", () => {
    const dir = mkdtempSync(join(tmpdir(), "machines-apps-exact-candidate-"));
    const manifestPath = join(dir, "candidate.json");
    process.env["HASNA_MACHINES_MANIFEST_PATH"] = manifestPath;
    writeExactBunCandidate(manifestPath);

    expect(validateAppsCandidate("station-exact", { manifestPath })).toMatchObject({
      schema: "machines.apps.validation.v1",
      valid: true,
      machineId: "station-exact",
      platform: "linux",
      packageCount: 2,
      errors: [],
    });
    const plan = buildAppsPlan("station-exact", { manifestPath });
    expect("schema" in plan && plan.schema).toBe("machines.apps.plan.v2");
    if (!("schema" in plan)) throw new Error("expected exact plan");
    expect(plan.steps.map((step) => step.package.selector)).toEqual([
      "@hasnaxyz/infinity@1.0.12",
      "@hasnaxyz/factory@0.6.9",
    ]);
    const planJson = JSON.stringify(plan);
    expect(planJson).not.toContain("private-user");
    expect(planJson).not.toContain("/private/home");
    expect(planJson).not.toContain("must-not-escape");
    expect(planJson).not.toContain('"command"');
    expect(planJson).not.toContain("publish-token");

    let sourceLoads = 0;
    let stdin: string | Buffer | undefined;
    let command = "";
    const probes = plan.steps.map((step) => ({
      schema: "machines.bun_package_probe.v1",
      package: step.package.name,
      expectedVersion: step.package.version,
      observedVersion: step.package.version,
      installed: true,
      checks: {
        packageJson: { ok: true, version: step.package.version },
        registryProvenance: { ok: true, integrity: step.package.registryIntegrity, lockSource: "registry" },
        sdkImport: { ok: true },
        cliHelp: { ok: true, bin: step.package.bin, exitCode: 0 },
      },
      status: "pass",
      reasonCodes: [],
    }));
    const runner: MachineCommandRunner = (machineId, value, options) => {
      command = value;
      stdin = options?.stdin;
      return {
        machineId,
        source: "ssh",
        stdout: JSON.stringify({
          schema: "machines.exact_bun_transaction_result.v1",
          machineId,
          platform: "linux",
          state: "COMMITTED",
          executed: 2,
          probes,
          reasonCodes: [],
        }),
        stderr: "",
        exitCode: 0,
      };
    };
    const applied = runAppsPlan(plan, {
      apply: true,
      yes: true,
      manifestPath,
      expectedPlanDigest: plan.planDigest,
      sourceLoader: () => { sourceLoads += 1; return exactBunFixtureSource; },
      bootstrapSourceLoader: () => Buffer.from("// reviewed bootstrap fixture\n"),
    }, runner);
    expect("state" in applied && applied.state).toBe("COMMITTED");
    expect(sourceLoads).toBe(1);
    expect(stdin).toBeInstanceOf(Buffer);
    expect(String(stdin)).toContain(exactBunFixtureSource.toString("base64"));
    expect(String(stdin)).toContain("reviewed bootstrap fixture");
    expect(command).toEndWith("/bin/bun' run -");
    expect(command).not.toContain("apps exact-bun-");
    expect(command).not.toContain(exactBunFixtureSource.toString("base64"));
    expect(JSON.stringify(applied)).not.toContain("/private/home");
  });

  test("live-revalidates installed state before a zero-step no-op", () => {
    const dir = mkdtempSync(join(tmpdir(), "machines-apps-exact-installed-state-"));
    const manifestPath = join(dir, "candidate.json");
    process.env["HASNA_MACHINES_MANIFEST_PATH"] = manifestPath;
    writeExactBunCandidate(manifestPath);

    const initial = buildAppsPlan("station-exact", { manifestPath });
    if (!("schema" in initial)) throw new Error("expected exact plan");
    const installedState = {
      schema: "machines.apps.status.v2" as const,
      machineId: initial.machineId,
      platform: initial.platform,
      source: "ssh" as const,
      packages: initial.steps.map((step) => ({
        schema: "machines.bun_package_probe.v1" as const,
        package: step.package.name,
        expectedVersion: step.package.version,
        observedVersion: step.package.version,
        installed: true as const,
        checks: {
          packageJson: { ok: true as const, version: step.package.version },
          registryProvenance: { ok: true as const, integrity: step.package.registryIntegrity, lockSource: "registry" as const },
          sdkImport: { ok: true as const },
          cliHelp: { ok: true as const, bin: step.package.bin, exitCode: 0 as const },
        },
        status: "pass" as const,
        reasonCodes: [] as [],
      })),
      status: "pass" as const,
      reasonCodes: [],
    };

    const noOp = buildAppsPlan("station-exact", { manifestPath, installedState });
    if (!("schema" in noOp)) throw new Error("expected exact plan");
    expect(noOp.steps).toEqual([]);
    expect(noOp.probes).toHaveLength(2);

    let sourceLoads = 0;
    let targetCalls = 0;
    const applied = runAppsPlan(noOp, {
      apply: true,
      yes: true,
      manifestPath,
      installedState,
      expectedPlanDigest: noOp.planDigest,
      sourceLoader: () => { sourceLoads += 1; return exactBunFixtureSource; },
      bootstrapSourceLoader: () => Buffer.from("// reviewed bootstrap fixture\n"),
    }, (machineId) => {
      targetCalls += 1;
      return {
        machineId,
        source: "ssh",
        stdout: JSON.stringify({
          schema: "machines.exact_bun_transaction_result.v1",
          machineId,
          platform: initial.platform,
          state: "COMMITTED",
          executed: 2,
          probes: installedState.packages,
          reasonCodes: [],
        }),
        stderr: "",
        exitCode: 0,
      };
    });
    expect("state" in applied && applied.state).toBe("COMMITTED");
    expect(applied.executed).toBe(0);
    expect(sourceLoads).toBe(0);
    expect(targetCalls).toBe(1);

    const staleProbes = structuredClone(installedState.packages);
    staleProbes[1]!.observedVersion = "0.6.8";
    staleProbes[1]!.checks.packageJson = { ok: false, version: "0.6.8" };
    staleProbes[1]!.status = "fail";
    staleProbes[1]!.reasonCodes = ["installed_version_mismatch"];
    let staleTargetCalls = 0;
    expect(() => runAppsPlan(noOp, {
      apply: true,
      yes: true,
      manifestPath,
      installedState,
      expectedPlanDigest: noOp.planDigest,
      sourceLoader: () => { sourceLoads += 1; return exactBunFixtureSource; },
      bootstrapSourceLoader: () => Buffer.from("// reviewed bootstrap fixture\n"),
    }, (machineId) => {
      staleTargetCalls += 1;
      return {
        machineId,
        source: "ssh",
        stdout: JSON.stringify({
          schema: "machines.exact_bun_transaction_result.v1",
          machineId,
          platform: initial.platform,
          state: "COMMITTED",
          executed: 2,
          probes: staleProbes,
          reasonCodes: [],
        }),
        stderr: "",
        exitCode: 0,
      };
    })).toThrow("installed_state_stale");
    expect(staleTargetCalls).toBe(1);
    expect(sourceLoads).toBe(0);
  });

  test("derives and applies one exact Factory step on Linux 0.2.18 and macOS 0.2.17 fixtures", () => {
    let bootstrapTransactions = 0;
    let bootstrapStatusReads = 0;
    for (const fixture of exactBunTargetFixtures) {
      const dir = mkdtempSync(join(tmpdir(), `machines-apps-exact-${fixture.id}-`));
      const manifestPath = join(dir, "candidate.json");
      writeExactBunCandidate(manifestPath, fixture.id, { platform: fixture.platform, bunPath: fixture.bunPath });
      const initial = buildAppsPlan(fixture.id, { manifestPath });
      if (!("schema" in initial)) throw new Error("expected exact plan");
      let fullSourceLoads = 0;
      let fullTransactionCalls = 0;
      const fullApply = runAppsPlan(initial, {
        apply: true,
        yes: true,
        manifestPath,
        expectedPlanDigest: initial.planDigest,
        sourceLoader: () => { fullSourceLoads += 1; return exactBunFixtureSource; },
        bootstrapSourceLoader: () => Buffer.from("// reviewed bootstrap fixture\n"),
      }, (machineId, command) => {
        fullTransactionCalls += 1;
        expect(command).not.toContain("apps exact-bun-");
        return {
          machineId,
          source: "ssh",
          stdout: JSON.stringify({
            schema: "machines.exact_bun_transaction_result.v1",
            machineId,
            platform: fixture.platform,
            state: "COMMITTED",
            executed: 2,
            probes: initial.steps.map((step) => ({
              schema: "machines.bun_package_probe.v1",
              package: step.package.name,
              expectedVersion: step.package.version,
              observedVersion: step.package.version,
              installed: true,
              checks: {
                packageJson: { ok: true, version: step.package.version },
                registryProvenance: { ok: true, integrity: step.package.registryIntegrity, lockSource: "registry" },
                sdkImport: { ok: true },
                cliHelp: { ok: true, bin: step.package.bin, exitCode: 0 },
              },
              status: "pass",
              reasonCodes: [],
            })),
            reasonCodes: [],
          }),
          stderr: "",
          exitCode: 0,
        };
      });
      expect(fullApply.executed).toBe(2);
      expect(fullSourceLoads).toBe(1);
      expect(fullTransactionCalls).toBe(1);
      bootstrapTransactions += fullTransactionCalls;
      const probes = initial.steps.map((step, index) => ({
        schema: "machines.bun_package_probe.v1" as const,
        package: step.package.name,
        expectedVersion: step.package.version,
        observedVersion: index === 0 ? step.package.version : fixture.outdatedFactoryVersion,
        installed: true,
        checks: {
          packageJson: { ok: index === 0, version: index === 0 ? step.package.version : fixture.outdatedFactoryVersion },
          registryProvenance: {
            ok: index === 0,
            integrity: index === 0 ? step.package.registryIntegrity : "",
            lockSource: "registry" as const,
          },
          sdkImport: { ok: true },
          cliHelp: { ok: true, bin: step.package.bin, exitCode: 0 },
        },
        status: index === 0 ? "pass" as const : "fail" as const,
        reasonCodes: index === 0 ? [] : ["installed_version_mismatch", "registry_lock_mismatch"],
      }));
      let statusCalls = 0;
      const installedState = getAppsStatus(fixture.id, (machineId, command) => {
        statusCalls += 1;
        expect(command).not.toContain("apps exact-bun-");
        return {
          machineId,
          source: "ssh",
          stdout: JSON.stringify({
            schema: "machines.exact_bun_transaction_result.v1",
            machineId,
            platform: fixture.platform,
            state: "COMMITTED",
            executed: 2,
            probes,
            reasonCodes: [],
          }),
          stderr: "",
          exitCode: 0,
        };
      }, {
        manifestPath,
        bootstrapSourceLoader: () => Buffer.from("// reviewed bootstrap fixture\n"),
      });
      if (!("packages" in installedState)) throw new Error("expected exact status");
      expect(installedState.status).toBe("unmanaged");
      expect(statusCalls).toBe(1);
      bootstrapStatusReads += statusCalls;
      const oneStep = buildAppsPlan(fixture.id, { manifestPath, installedState });
      if (!("schema" in oneStep)) throw new Error("expected exact plan");
      expect(oneStep.steps).toEqual([initial.steps[1]]);

      let sourceLoads = 0;
      let applyStatusCalls = 0;
      let transactionCalls = 0;
      const applied = runAppsPlan(oneStep, {
        apply: true,
        yes: true,
        manifestPath,
        installedState,
        expectedPlanDigest: oneStep.planDigest,
        sourceLoader: () => { sourceLoads += 1; return exactBunFixtureSource; },
        bootstrapSourceLoader: () => Buffer.from("// reviewed bootstrap fixture\n"),
      }, (machineId, command) => {
        expect(command).not.toContain("apps exact-bun-");
        if (applyStatusCalls === 0) {
          applyStatusCalls += 1;
          return {
            machineId,
            source: "ssh",
            stdout: JSON.stringify({
              schema: "machines.exact_bun_transaction_result.v1",
              machineId,
              platform: fixture.platform,
              state: "COMMITTED",
              executed: 2,
              probes,
              reasonCodes: [],
            }),
            stderr: "",
            exitCode: 0,
          };
        }
        transactionCalls += 1;
        const step = oneStep.steps[0]!;
        return {
          machineId,
          source: "ssh",
          stdout: JSON.stringify({
            schema: "machines.exact_bun_transaction_result.v1",
            machineId,
            platform: fixture.platform,
            state: "COMMITTED",
            executed: 1,
            probes: [{
              schema: "machines.bun_package_probe.v1",
              package: step.package.name,
              expectedVersion: step.package.version,
              observedVersion: step.package.version,
              installed: true,
              checks: {
                packageJson: { ok: true, version: step.package.version },
                registryProvenance: { ok: true, integrity: step.package.registryIntegrity, lockSource: "registry" },
                sdkImport: { ok: true },
                cliHelp: { ok: true, bin: step.package.bin, exitCode: 0 },
              },
              status: "pass",
              reasonCodes: [],
            }],
            reasonCodes: [],
          }),
          stderr: "",
          exitCode: 0,
        };
      });
      expect(applied.executed).toBe(1);
      expect(sourceLoads).toBe(1);
      expect(applyStatusCalls).toBe(1);
      expect(transactionCalls).toBe(1);

      const satisfiedState = structuredClone(installedState);
      satisfiedState.status = "pass";
      satisfiedState.packages[1] = (applied.probes ?? [])[0]!;
      const noOp = buildAppsPlan(fixture.id, { manifestPath, installedState: satisfiedState });
      expect(noOp.steps).toEqual([]);
      expect(noOp.planDigest).not.toBe(oneStep.planDigest);
      rmSync(dir, { recursive: true, force: true });
    }
    console.info(`TARGET_BOOTSTRAP_CONTROL station01=0.2.18/linux station03=0.2.17/macos target_exact_bun_commands=0 bootstrap_transactions=${bootstrapTransactions} bootstrap_status_reads=${bootstrapStatusReads}`);
  });

  test("rejects a non-target-only exact candidate before planning or applying", () => {
    const dir = mkdtempSync(join(tmpdir(), "machines-apps-exact-multi-target-"));
    const manifestPath = join(dir, "candidate.json");
    const candidate = exactBunCandidate();
    (candidate.machines as Array<Record<string, unknown>>).push({
      id: "unrelated-target",
      platform: "linux",
      workspacePath: "/unrelated/private/path",
      apps: [],
    });
    writeFileSync(manifestPath, `${JSON.stringify(candidate, null, 2)}\n`);

    expect(validateAppsCandidate("station-exact", { manifestPath })).toMatchObject({
      valid: false,
      errors: ["candidate_manifest_not_target_only"],
    });
    expect(() => buildAppsPlan("station-exact", { manifestPath })).toThrow("exactly one target machine");

    let calls = 0;
    const runner: MachineCommandRunner = (machineId) => {
      calls += 1;
      return { machineId, source: "ssh", stdout: "", stderr: "", exitCode: 0 };
    };
    expect(() => runAppsInstall("station-exact", {
      apply: true,
      yes: true,
      manifestPath,
      expectedPlanDigest: "0".repeat(64),
    }, runner)).toThrow("exactly one target machine");
    expect(calls).toBe(0);
  });

  test("fails closed when explicit and environment manifest authorities differ", () => {
    const dir = mkdtempSync(join(tmpdir(), "machines-apps-manifest-authority-"));
    const explicit = join(dir, "candidate.json");
    const configured = join(dir, "other.json");
    writeExactBunCandidate(explicit);
    writeExactBunCandidate(configured);
    process.env["HASNA_MACHINES_MANIFEST_PATH"] = configured;
    expect(validateAppsCandidate("station-exact", { manifestPath: explicit })).toMatchObject({
      valid: false,
      errors: ["manifest_authority_conflict"],
    });
    expect(() => buildAppsPlan("station-exact", { manifestPath: explicit })).toThrow("resolve to different files");
  });
});
