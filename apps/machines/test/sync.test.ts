import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { manifestAdd, manifestInit } from "../src/commands/manifest.js";
import { buildSyncPlan, runSync } from "../src/commands/sync.js";

describe("sync planning", () => {
  test("detects file drift and missing packages", () => {
    const dir = mkdtempSync(join(tmpdir(), "machines-sync-"));
    const source = join(dir, "source.txt");
    const target = join(dir, "target.txt");
    writeFileSync(source, "source", "utf8");
    writeFileSync(target, "target", "utf8");

    process.env["HASNA_MACHINES_MANIFEST_PATH"] = join(dir, "machines.json");
    process.env["HASNA_MACHINES_MACHINE_ID"] = "spark01";
    manifestInit();
    manifestAdd({
      id: "spark01",
      platform: "linux",
      workspacePath: "/home/hasna/workspace",
      packages: [{ name: "__missing_pkg__", manager: "custom" }],
      files: [{ source, target, mode: "copy" }],
    });

    const plan = buildSyncPlan("spark01");
    expect(plan.actions.some((action) => action.kind === "package" && action.status === "missing")).toBe(true);
    expect(plan.actions.some((action) => action.kind === "file" && action.status === "drifted")).toBe(true);
  });

  test("applies copy-based file sync with confirmation", () => {
    const dir = mkdtempSync(join(tmpdir(), "machines-sync-apply-"));
    const source = join(dir, "source.txt");
    const nestedDir = join(dir, "nested");
    const target = join(nestedDir, "target.txt");
    mkdirSync(nestedDir, { recursive: true });
    writeFileSync(source, "aligned", "utf8");
    writeFileSync(target, "drifted", "utf8");

    process.env["HASNA_MACHINES_MANIFEST_PATH"] = join(dir, "machines.json");
    process.env["HASNA_MACHINES_MACHINE_ID"] = "spark01";
    manifestInit();
    manifestAdd({
      id: "spark01",
      platform: "linux",
      workspacePath: "/home/hasna/workspace",
      files: [{ source, target, mode: "copy" }],
    });

    expect(() => runSync("spark01", { apply: true, yes: false })).toThrow("Sync execution requires --yes.");

    const result = runSync("spark01", { apply: true, yes: true });
    expect(result.executed).toBe(1);
    expect(readFileSync(target, "utf8")).toBe("aligned");
  });
});
