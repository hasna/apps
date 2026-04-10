import { describe, expect, test } from "bun:test";
import { buildAppsPlan, listApps } from "../src/commands/apps.js";
import { manifestAdd, manifestInit } from "../src/commands/manifest.js";

describe("apps", () => {
  test("lists apps from manifest", () => {
    process.env["HASNA_MACHINES_MACHINE_ID"] = "apple03";
    process.env["HASNA_MACHINES_MANIFEST_PATH"] = ":memory:";
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
    process.env["HASNA_MACHINES_MACHINE_ID"] = "apple03";
    process.env["HASNA_MACHINES_MANIFEST_PATH"] = ":memory:";
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
