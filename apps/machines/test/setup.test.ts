import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { manifestAdd, manifestInit } from "../src/commands/manifest.js";
import { buildSetupPlan, runSetup } from "../src/commands/setup.js";

describe("setup planning", () => {
  test("builds a provisioning plan from manifest packages", () => {
    const dir = mkdtempSync(join(tmpdir(), "machines-setup-"));
    process.env["HASNA_MACHINES_MANIFEST_PATH"] = join(dir, "machines.json");
    process.env["HASNA_MACHINES_MACHINE_ID"] = "spark01";
    manifestInit();
    manifestAdd({
      id: "spark01",
      platform: "linux",
      workspacePath: "/home/hasna/workspace",
      packages: [{ name: "ripgrep", manager: "apt" }, { name: "@hasna/takumi", manager: "bun" }],
    });

    const plan = buildSetupPlan("spark01");
    expect(plan.mode).toBe("plan");
    expect(plan.steps.length).toBeGreaterThanOrEqual(4);
    expect(plan.steps.some((step) => step.command.includes("apt-get install -y ripgrep"))).toBe(true);
    expect(plan.steps.some((step) => step.command.includes("bun install -g @hasna/takumi"))).toBe(true);
  });

  test("requires explicit confirmation to execute", () => {
    const dir = mkdtempSync(join(tmpdir(), "machines-setup-guard-"));
    process.env["HASNA_MACHINES_MANIFEST_PATH"] = join(dir, "machines.json");
    manifestInit();

    expect(() => runSetup(undefined, { apply: true, yes: false })).toThrow("Setup execution requires --yes.");
  });
});
