import { describe, expect, test } from "bun:test";
import { checkMachineCompatibility, type CompatibilityCommandRunner } from "../src/compatibility.js";

function fakeRunner(overrides: Record<string, string>): CompatibilityCommandRunner {
  return (machineId, command) => {
    const key = Object.keys(overrides).find((entry) => command.includes(entry));
    return {
      machineId,
      source: machineId === "spark02" ? "local" : "tailscale",
      stdout: key ? overrides[key] : "",
      stderr: key ? "" : `unexpected command: ${command}`,
      exitCode: key ? 0 : 1,
    };
  };
}

describe("machine compatibility checks", () => {
  test("checks command, package, and workspace compatibility", () => {
    const report = checkMachineCompatibility({
      machineId: "spark01",
      now: new Date("2026-06-09T00:00:00.000Z"),
      runner: fakeRunner({
        "cmd='bun'": "path=/usr/bin/bun\nversion=1.3.13\n",
        "cmd='knowledge'": "path=/home/hasna/.bun/bin/knowledge\nversion=@hasna/knowledge 0.2.29\n",
        "path='/repo/open-knowledge'": "exists=yes\npackage_json=yes\npackage_name=@hasna/knowledge\nversion=0.2.29\n",
      }),
      commands: [{ command: "bun", expectedVersion: "1.3.13" }],
      packages: [{ name: "@hasna/knowledge", command: "knowledge", expectedVersion: "0.2.29" }],
      workspaces: [{
        label: "open-knowledge",
        path: "/repo/open-knowledge",
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
    expect(report.checks.map((check) => check.id)).toContain("workspace:open-knowledge:package-name");
  });

  test("fails required version mismatches and missing workspaces", () => {
    const report = checkMachineCompatibility({
      machineId: "spark01",
      runner: fakeRunner({
        "cmd='knowledge'": "path=/home/hasna/.bun/bin/knowledge\nversion=@hasna/knowledge 0.2.28\n",
        "path='/repo/open-knowledge'": "exists=no\npackage_json=no\n",
      }),
      commands: [],
      packages: [{ name: "@hasna/knowledge", command: "knowledge", expectedVersion: "0.2.29" }],
      workspaces: [{ label: "open-knowledge", path: "/repo/open-knowledge" }],
    });

    expect(report.ok).toBe(false);
    expect(report.summary.fail).toBe(2);
    expect(report.checks.find((check) => check.id === "package:@hasna/knowledge:version")?.actual).toBe("0.2.28");
    expect(report.checks.find((check) => check.id === "workspace:open-knowledge:path")?.status).toBe("fail");
  });
});
