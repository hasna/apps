import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { manifestAdd, manifestInit } from "../src/commands/manifest.js";
import { buildSyncPlan, runSync } from "../src/commands/sync.js";
import type { MachineCommandRunner } from "../src/remote.js";

describe("sync planning", () => {
  test("detects file drift and missing packages", () => {
    const dir = mkdtempSync(join(tmpdir(), "stations-sync-"));
    const source = join(dir, "source.txt");
    const target = join(dir, "target.txt");
    writeFileSync(source, "source", "utf8");
    writeFileSync(target, "target", "utf8");

    process.env["HASNA_STATIONS_MANIFEST_PATH"] = join(dir, "stations.json");
    process.env["HASNA_STATIONS_MACHINE_ID"] = "demo-node-01";
    manifestInit();
    manifestAdd({
      id: "demo-node-01",
      platform: "linux",
      workspacePath: "/home/operator/workspace",
      packages: [{ name: "__missing_pkg__", manager: "custom" }],
      files: [{ source, target, mode: "copy" }],
    });

    const plan = buildSyncPlan("demo-node-01");
    expect(plan.actions.some((action) => action.kind === "package" && action.status === "missing")).toBe(true);
    expect(plan.actions.some((action) => action.kind === "file" && action.status === "drifted")).toBe(true);
  });

  test("applies copy-based file sync with confirmation", () => {
    const dir = mkdtempSync(join(tmpdir(), "stations-sync-apply-"));
    const source = join(dir, "source.txt");
    const nestedDir = join(dir, "nested");
    const target = join(nestedDir, "target.txt");
    mkdirSync(nestedDir, { recursive: true });
    writeFileSync(source, "aligned", "utf8");
    writeFileSync(target, "drifted", "utf8");

    process.env["HASNA_STATIONS_MANIFEST_PATH"] = join(dir, "stations.json");
    process.env["HASNA_STATIONS_MACHINE_ID"] = "demo-node-01";
    manifestInit();
    manifestAdd({
      id: "demo-node-01",
      platform: "linux",
      workspacePath: "/home/operator/workspace",
      files: [{ source, target, mode: "copy" }],
    });

    expect(() => runSync("demo-node-01", { apply: true, yes: false })).toThrow("Sync execution requires --yes.");

    const result = runSync("demo-node-01", { apply: true, yes: true });
    expect(result.executed).toBe(1);
    expect(readFileSync(target, "utf8")).toBe("aligned");
  });

  test("does not fallback to the local machine for an explicit missing manifest id", () => {
    const dir = mkdtempSync(join(tmpdir(), "stations-sync-missing-"));
    process.env["HASNA_STATIONS_MANIFEST_PATH"] = join(dir, "stations.json");
    process.env["HASNA_STATIONS_MACHINE_ID"] = "local-fixture";
    manifestInit();

    expect(() => buildSyncPlan("unmanaged-fixture")).toThrow("Machine not found in manifest: unmanaged-fixture");
  });

  test("checks and installs packages through the selected machine runner", () => {
    const dir = mkdtempSync(join(tmpdir(), "stations-sync-runner-"));
    process.env["HASNA_STATIONS_MANIFEST_PATH"] = join(dir, "stations.json");
    process.env["HASNA_STATIONS_MACHINE_ID"] = "local-fixture";
    manifestInit();
    manifestAdd({
      id: "remote-mac",
      platform: "macos",
      workspacePath: "/Users/operator/Workspace",
      packages: [{ name: "ripgrep", manager: "brew" }],
    });

    const calls: string[] = [];
    const runner: MachineCommandRunner = (machineId, command) => {
      calls.push(`${machineId}:${command}`);
      if (command.includes("brew list --versions")) {
        return { machineId, source: "ssh", stdout: "installed=0\n", stderr: "", exitCode: 0 };
      }
      return { machineId, source: "ssh", stdout: "", stderr: "", exitCode: 0 };
    };

    const plan = buildSyncPlan("remote-mac", runner);
    expect(plan.actions[0]?.status).toBe("missing");
    const result = runSync("remote-mac", { apply: true, yes: true }, runner);
    expect(result.executed).toBe(1);
    expect(calls.every((call) => call.startsWith("remote-mac:"))).toBe(true);
    expect(calls.some((call) => call.includes("brew install 'ripgrep'"))).toBe(true);
  });

  test("rejects stale expected plan digests before applying file sync actions", () => {
    const dir = mkdtempSync(join(tmpdir(), "stations-sync-plan-digest-"));
    const source = join(dir, "source.txt");
    const target = join(dir, "target.txt");
    writeFileSync(source, "approved", "utf8");
    writeFileSync(target, "approved", "utf8");
    process.env["HASNA_STATIONS_MANIFEST_PATH"] = join(dir, "stations.json");
    process.env["HASNA_STATIONS_MACHINE_ID"] = "local-fixture";
    manifestInit();
    manifestAdd({
      id: "local-fixture",
      platform: "linux",
      workspacePath: "/home/operator/workspace",
      files: [{ source, target, mode: "copy" }],
    });
    const approvedPlan = buildSyncPlan("local-fixture");

    writeFileSync(target, "drifted", "utf8");
    expect(() => runSync("local-fixture", { apply: true, yes: true, expectedPlanDigest: approvedPlan.planDigest }))
      .toThrow("Approved plan digest");
    expect(readFileSync(target, "utf8")).toBe("drifted");
  });
});
