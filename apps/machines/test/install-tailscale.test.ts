import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { manifestAdd, manifestInit } from "../src/commands/manifest.js";
import { buildTailscaleInstallPlan, runTailscaleInstall } from "../src/commands/install-tailscale.js";

describe("tailscale install", () => {
  test("builds platform-specific install steps", () => {
    const dir = mkdtempSync(join(tmpdir(), "machines-tailscale-"));
    process.env["HASNA_MACHINES_MANIFEST_PATH"] = join(dir, "machines.json");
    manifestInit();
    manifestAdd({
      id: "apple03",
      platform: "macos",
      workspacePath: "/Users/hasna/Workspace",
    });

    const plan = buildTailscaleInstallPlan("apple03");
    expect(plan.steps[0]?.command).toContain("brew install --cask tailscale");
  });

  test("requires confirmation to execute", () => {
    expect(() => runTailscaleInstall(undefined, { apply: true, yes: false })).toThrow("Tailscale install requires --yes.");
  });
});
