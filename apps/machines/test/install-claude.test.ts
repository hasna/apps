import { afterEach, describe, expect, test } from "bun:test";
import { buildClaudeInstallPlan, diffClaudeCli, getClaudeCliStatus } from "../src/commands/install-claude.js";

describe("install-claude", () => {
  afterEach(() => {
    delete process.env["HASNA_MACHINES_CLAUDE_BINARY"];
    delete process.env["HASNA_MACHINES_CODEX_BINARY"];
    delete process.env["HASNA_MACHINES_GEMINI_BINARY"];
    delete process.env["HASNA_MACHINES_MACHINE_ID"];
  });

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

  test("reports CLI status and diff using runtime binary overrides", () => {
    process.env["HASNA_MACHINES_MACHINE_ID"] = "spark01";
    process.env["HASNA_MACHINES_CLAUDE_BINARY"] = "sh";
    process.env["HASNA_MACHINES_CODEX_BINARY"] = "__missing_codex__";
    process.env["HASNA_MACHINES_GEMINI_BINARY"] = "__missing_gemini__";

    const status = getClaudeCliStatus("spark01");
    expect(status.tools).toHaveLength(3);
    expect(status.tools.find((tool) => tool.tool === "claude")?.installed).toBe(true);
    const diff = diffClaudeCli("spark01");
    expect(diff.installed).toContain("claude");
    expect(diff.missing).toContain("codex");
    expect(diff.missing).toContain("gemini");
  });
});
