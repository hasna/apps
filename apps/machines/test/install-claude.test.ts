import { describe, expect, test } from "bun:test";
import { buildClaudeInstallPlan } from "../src/commands/install-claude.js";

describe("install-claude", () => {
  test("builds default AI CLI install plan", () => {
    process.env["HASNA_MACHINES_MACHINE_ID"] = "spark01";
    const plan = buildClaudeInstallPlan("spark01");
    expect(plan.machineId).toBe("spark01");
    expect(plan.steps.map((step) => step.id)).toEqual(["install-claude", "install-codex", "install-gemini"]);
    expect(plan.steps.every((step) => step.command.startsWith("bun install -g"))).toBe(true);
  });

  test("filters install plan to requested tools", () => {
    process.env["HASNA_MACHINES_MACHINE_ID"] = "spark01";
    const plan = buildClaudeInstallPlan(undefined, ["claude"]);
    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0]?.id).toBe("install-claude");
  });
});
