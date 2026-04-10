import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { buildAppsPlan, listApps } from "../src/commands/apps.js";
import { join } from "node:path";
import { tmpdir } from "node:os";
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
});
