import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildAppsPlan, diffApps, getAppsStatus, listApps } from "../src/commands/apps.js";
import { manifestAdd, manifestInit } from "../src/commands/manifest.js";

describe("apps", () => {
  afterEach(() => {
    delete process.env["HASNA_MACHINES_MANIFEST_PATH"];
    delete process.env["HASNA_MACHINES_MACHINE_ID"];
  });

  test("lists apps from manifest", () => {
    const dir = mkdtempSync(join(tmpdir(), "machines-apps-"));
    process.env["HASNA_MACHINES_MACHINE_ID"] = "apple03";
    process.env["HASNA_MACHINES_MANIFEST_PATH"] = join(dir, "machines.json");
    manifestInit();
    manifestAdd({
      id: "apple03",
      platform: "macos",
      workspacePath: "/Users/hasna/Workspace",
      apps: [{ name: "ghostty", manager: "cask" }],
    });

    const result = listApps("apple03");
    expect(result.apps).toHaveLength(1);
    expect(result.apps[0]?.name).toBe("ghostty");
  });

  test("builds app install commands by platform", () => {
    const dir = mkdtempSync(join(tmpdir(), "machines-apps-"));
    process.env["HASNA_MACHINES_MACHINE_ID"] = "apple03";
    process.env["HASNA_MACHINES_MANIFEST_PATH"] = join(dir, "machines.json");
    manifestInit();
    manifestAdd({
      id: "apple03",
      platform: "macos",
      workspacePath: "/Users/hasna/Workspace",
      apps: [{ name: "ghostty", manager: "cask" }],
    });

    const plan = buildAppsPlan("apple03");
    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0]?.command).toContain("brew install --cask ghostty");
  });

  test("computes app status and diff", () => {
    const dir = mkdtempSync(join(tmpdir(), "machines-apps-status-"));
    process.env["HASNA_MACHINES_MACHINE_ID"] = "spark01";
    process.env["HASNA_MACHINES_MANIFEST_PATH"] = join(dir, "machines.json");
    manifestInit();
    manifestAdd({
      id: "spark01",
      platform: "linux",
      workspacePath: "/home/hasna/workspace",
      apps: [
        { name: "shell", manager: "custom", packageName: "sh" },
        { name: "missing", manager: "custom", packageName: "__missing_app__" },
      ],
    });

    const status = getAppsStatus("spark01");
    expect(status.apps).toHaveLength(2);
    expect(status.apps.some((app) => app.name === "shell" && app.installed)).toBe(true);
    const diff = diffApps("spark01");
    expect(diff.installed).toContain("shell");
    expect(diff.missing).toContain("missing");
  });
});
