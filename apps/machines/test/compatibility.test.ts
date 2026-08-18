import { describe, expect, test } from "bun:test";
import { checkMachineCompatibility, type CompatibilityCommandRunner } from "../src/compatibility.js";

function fakeRunner(overrides: Record<string, string>): CompatibilityCommandRunner {
  return (machineId, command) => {
    const key = Object.keys(overrides).find((entry) => command.includes(entry));
    return {
      machineId,
      source: machineId === "demo-node-02" ? "local" : "tailscale",
      stdout: key ? overrides[key] : "",
      stderr: key ? "" : `unexpected command: ${command}`,
      exitCode: key ? 0 : 1,
    };
  };
}

describe("machine compatibility checks", () => {
  test("does not classify remote authentication failure as missing subjects", () => {
    const report = checkMachineCompatibility({
      machineId: "station01",
      runner: (machineId): ReturnType<CompatibilityCommandRunner> => ({
        machineId,
        source: "ssh",
        stdout: "",
        stderr: "Permission denied (publickey,password).",
        exitCode: 255,
      }),
      commands: [{ command: "bun", required: true }, { command: "machines", required: true }],
      packages: [{ name: "@hasnaxyz/factory", command: "factory", expectedVersion: "0.6.7", required: true }],
    });

    expect(report.ok).toBe(false);
    expect(report.checks).toHaveLength(4);
    expect(report.checks.every((check) => check.actual === "unavailable")).toBe(true);
    expect(report.checks.every((check) => check.detail.includes("Permission denied"))).toBe(true);
    expect(report.checks.map((check) => check.actual)).not.toContain("missing");
  });

  test("still classifies an authenticated missing command and package command as missing", () => {
    const report = checkMachineCompatibility({
      machineId: "station01",
      runner: (machineId): ReturnType<CompatibilityCommandRunner> => ({
        machineId,
        source: "ssh",
        stdout: "path=\n",
        stderr: "",
        exitCode: 0,
      }),
      commands: [{ command: "bun", required: true }, { command: "machines", required: true }],
      packages: [{ name: "@hasnaxyz/factory", command: "factory", expectedVersion: "0.6.7", required: true }],
    });

    expect(report.ok).toBe(false);
    expect(report.checks.filter((check) => check.actual === "missing")).toHaveLength(4);
    expect(report.checks.every((check) => check.detail !== "Permission denied (publickey,password).")).toBe(true);
  });

  test("preserves zsh PATH while probing command paths", () => {
    const probeScripts: string[] = [];
    const report = checkMachineCompatibility({
      machineId: "station03",
      runner: (machineId, command) => {
        probeScripts.push(command);
        const usesNeutralPathVariable = command.includes('resolved_path="$(command -v "$cmd"')
          && !command.includes('; path="$(command -v "$cmd"');
        return {
          machineId,
          source: "ssh",
          stdout: `path=/Users/hasna/.bun/bin/cli\nversion=${usesNeutralPathVariable ? "0.2.42" : ""}\n`,
          stderr: "",
          exitCode: 0,
        };
      },
      commands: [{ command: "accounts", expectedVersion: "0.2.42", required: true }],
      packages: [{ name: "@hasna/machines", command: "machines", expectedVersion: "0.2.42", required: true }],
    });

    expect(report.ok).toBe(true);
    expect(probeScripts).toHaveLength(2);
    expect(probeScripts.every((script) => script.includes('resolved_path="$(command -v "$cmd"'))).toBe(true);
    expect(report.checks.find((check) => check.id === "command:accounts:version")?.actual).toBe("0.2.42");
    expect(report.checks.find((check) => check.id === "package:@hasna/machines:version")?.actual).toBe("0.2.42");
  });

  test("checks command, package, and workspace compatibility", () => {
    const report = checkMachineCompatibility({
      machineId: "demo-node-01",
      now: new Date("2026-06-09T00:00:00.000Z"),
      runner: fakeRunner({
        "cmd='bun'": "path=/usr/bin/bun\nversion=1.3.13\n",
        "cmd='knowledge'": "path=/home/operator/.bun/bin/knowledge\nversion=@hasna/knowledge 0.2.29\n",
        "path='/repo/knowledge'": "exists=yes\npackage_json=yes\npackage_name=@hasna/knowledge\nversion=0.2.29\n",
      }),
      commands: [{ command: "bun", expectedVersion: "1.3.13" }],
      packages: [{ name: "@hasna/knowledge", command: "knowledge", expectedVersion: "0.2.29" }],
      workspaces: [{
        label: "knowledge",
        path: "/repo/knowledge",
        expectedPackageName: "@hasna/knowledge",
        expectedVersion: "0.2.29",
      }],
    });

    expect(report.ok).toBe(true);
    expect(report.schema_version).toBe(1);
    expect(report.package.name).toBe("@hasna/machines");
    expect(report.capabilities.cli_json_fallback).toBe(true);
    expect(report.capabilities.workspace_path_mapping).toBe(true);
    expect(report.source).toBe("tailscale");
    expect(report.summary.fail).toBe(0);
    expect(report.checks.map((check) => check.id)).toContain("package:@hasna/knowledge:version");
    expect(report.checks.map((check) => check.id)).toContain("workspace:knowledge:package-name");
  });

  test("fails required version mismatches and missing workspaces", () => {
    const report = checkMachineCompatibility({
      machineId: "demo-node-01",
      runner: fakeRunner({
        "cmd='knowledge'": "path=/home/operator/.bun/bin/knowledge\nversion=@hasna/knowledge 0.2.28\n",
        "path='/repo/knowledge'": "exists=no\npackage_json=no\n",
      }),
      commands: [],
      packages: [{ name: "@hasna/knowledge", command: "knowledge", expectedVersion: "0.2.29" }],
      workspaces: [{ label: "knowledge", path: "/repo/knowledge" }],
    });

    expect(report.ok).toBe(false);
    expect(report.summary.fail).toBe(2);
    expect(report.checks.find((check) => check.id === "package:@hasna/knowledge:version")?.actual).toBe("0.2.28");
    expect(report.checks.find((check) => check.id === "workspace:knowledge:path")?.status).toBe("fail");
  });
});
