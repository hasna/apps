import { afterEach, describe, expect, test } from "bun:test";
import { buildClaudeInstallPlan, diffClaudeCli, getClaudeCliStatus, runClaudeInstall } from "../src/commands/install-claude.js";
import type { MachineCommandRunner } from "../src/remote.js";

describe("install-claude", () => {
  afterEach(() => {
    delete process.env["HASNA_MACHINES_CLAUDE_BINARY"];
    delete process.env["HASNA_MACHINES_CODEX_BINARY"];
    delete process.env["HASNA_MACHINES_GEMINI_BINARY"];
    delete process.env["HASNA_MACHINES_MACHINE_ID"];
  });

  test("builds default AI CLI install plan", () => {
    process.env["HASNA_MACHINES_MACHINE_ID"] = "demo-node-01";
    const plan = buildClaudeInstallPlan("demo-node-01");
    expect(plan.machineId).toBe("demo-node-01");
    expect(plan.steps.map((step) => step.id)).toEqual(["install-claude", "install-codex", "install-gemini"]);
    expect(plan.steps.every((step) => step.command.startsWith("bun install -g"))).toBe(true);
  });

  test("filters install plan to requested tools", () => {
    process.env["HASNA_MACHINES_MACHINE_ID"] = "demo-node-01";
    const plan = buildClaudeInstallPlan(undefined, ["claude"]);
    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0]?.id).toBe("install-claude");
  });

  test("reports CLI status and diff using runtime binary overrides", () => {
    process.env["HASNA_MACHINES_MACHINE_ID"] = "demo-node-01";
    process.env["HASNA_MACHINES_CLAUDE_BINARY"] = "sh";
    process.env["HASNA_MACHINES_CODEX_BINARY"] = "__missing_codex__";
    process.env["HASNA_MACHINES_GEMINI_BINARY"] = "__missing_gemini__";

    const status = getClaudeCliStatus("demo-node-01");
    expect(status.tools).toHaveLength(3);
    expect(status.tools.find((tool) => tool.tool === "claude")?.installed).toBe(true);
    const diff = diffClaudeCli("demo-node-01");
    expect(diff.installed).toContain("claude");
    expect(diff.missing).toContain("codex");
    expect(diff.missing).toContain("gemini");
  });

  test("surfaces remote command failures instead of reporting tools missing", () => {
    process.env["HASNA_MACHINES_MACHINE_ID"] = "remote-fixture";
    const runner: MachineCommandRunner = (machineId) => ({
      machineId,
      source: "ssh",
      stdout: "",
      stderr: "Permission denied (publickey,password,keyboard-interactive).",
      exitCode: 255,
    });

    expect(() => getClaudeCliStatus("remote-fixture", undefined, runner)).toThrow("AI CLI status readiness check failed");
  });

  test("probes an explicit unmanaged machine id instead of falling back to local", () => {
    process.env["HASNA_MACHINES_MACHINE_ID"] = "local-fixture";
    const calls: string[] = [];
    const runner: MachineCommandRunner = (machineId, command) => {
      calls.push(`${machineId}:${command}`);
      if (command === "true") {
        return { machineId, source: "tailscale", stdout: "", stderr: "", exitCode: 0 };
      }
      return { machineId, source: "tailscale", stdout: "installed=1\nversion=2.1.179\n", stderr: "", exitCode: 0 };
    };

    const status = getClaudeCliStatus("unmanaged-fixture", ["claude"], runner);
    expect(status.machineId).toBe("unmanaged-fixture");
    expect(status.source).toBe("tailscale");
    expect(status.tools[0]?.installed).toBe(true);
    expect(calls.every((call) => call.startsWith("unmanaged-fixture:"))).toBe(true);
  });

  test("runs AI CLI install steps on the selected machine", () => {
    process.env["HASNA_MACHINES_MACHINE_ID"] = "remote-fixture";
    const calls: string[] = [];
    const runner: MachineCommandRunner = (machineId, command) => {
      calls.push(`${machineId}:${command}`);
      return { machineId, source: "ssh", stdout: "", stderr: "", exitCode: 0 };
    };

    const result = runClaudeInstall("remote-fixture", ["claude"], { apply: true, yes: true }, runner);
    expect(result.executed).toBe(1);
    expect(calls).toEqual(["remote-fixture:bun install -g @anthropic-ai/claude-code"]);
  });
});
