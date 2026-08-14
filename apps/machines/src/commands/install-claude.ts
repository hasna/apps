import { detectCurrentMachineManifest, getManifestMachine } from "../manifests.js";
import { assertMutationPlanDigest, attachMutationPlanDigest } from "./mutation-approval.js";
import { requireMachineCommandSuccess, runMachineCommand, type MachineCommandRunner } from "../remote.js";
import type { ClaudeCliDiffResult, ClaudeCliStatusResult, CliToolStatus, MachineManifest, SetupResult, SetupStep } from "../types.js";

const AI_CLI_PACKAGES = {
  claude: "@anthropic-ai/claude-code",
  codex: "@openai/codex",
  gemini: "@google/gemini-cli",
} as const;

function getToolBinary(tool: AiCliTool): string {
  if (tool === "claude") return process.env["HASNA_MACHINES_CLAUDE_BINARY"] || "claude";
  if (tool === "codex") return process.env["HASNA_MACHINES_CODEX_BINARY"] || "codex";
  return process.env["HASNA_MACHINES_GEMINI_BINARY"] || "gemini";
}

export type AiCliTool = keyof typeof AI_CLI_PACKAGES;

function normalizeTools(tools?: string[]): AiCliTool[] {
  if (!tools || tools.length === 0) {
    return ["claude", "codex", "gemini"];
  }

  return [...new Set(tools)].map((tool) => {
    if (!(tool in AI_CLI_PACKAGES)) {
      throw new Error(`Unsupported AI CLI tool: ${tool}`);
    }
    return tool as AiCliTool;
  });
}

function buildInstallSteps(machine: MachineManifest, tools?: string[]): SetupStep[] {
  return normalizeTools(tools).map((tool) => ({
    id: `install-${tool}`,
    title: `Install or update ${tool} CLI on ${machine.id}`,
    command: `bun install -g ${AI_CLI_PACKAGES[tool]}`,
    manager: "bun",
  }));
}

function resolveMachine(machineId?: string): MachineManifest {
  if (!machineId) return detectCurrentMachineManifest();
  return getManifestMachine(machineId) || {
    id: machineId,
    platform: "linux",
    workspacePath: "",
  };
}

function buildProbeCommand(tool: AiCliTool): string {
  const binary = getToolBinary(tool);
  return `if command -v ${binary} >/dev/null 2>&1; then printf 'installed=1\\nversion='; ${binary} --version 2>/dev/null | head -n 1; printf '\\n'; else printf 'installed=0\\n'; fi`;
}

function parseProbe(tool: AiCliTool, stdout: string): CliToolStatus {
  const lines = stdout.trim().split("\n").filter(Boolean);
  const installedLine = lines.find((line) => line.startsWith("installed="));
  const versionLine = lines.find((line) => line.startsWith("version="));
  return {
    tool,
    packageName: AI_CLI_PACKAGES[tool],
    installed: installedLine === "installed=1",
    version: versionLine?.slice("version=".length) || undefined,
  };
}

export function buildClaudeInstallPlan(machineId?: string, tools?: string[]): SetupResult {
  const machine = resolveMachine(machineId);
  return attachMutationPlanDigest({
    machineId: machine.id,
    mode: "plan",
    steps: buildInstallSteps(machine, tools),
    executed: 0,
  });
}

export function getClaudeCliStatus(
  machineId?: string,
  tools?: string[],
  runner: MachineCommandRunner = runMachineCommand
): ClaudeCliStatusResult {
  const machine = resolveMachine(machineId);
  const normalizedTools = normalizeTools(tools);
  const route = requireMachineCommandSuccess("AI CLI status readiness check", runner(machine.id, "true")).source;
  return {
    machineId: machine.id,
    source: route,
    tools: normalizedTools.map((tool) => {
      const result = requireMachineCommandSuccess(`AI CLI probe ${tool}`, runner(machine.id, buildProbeCommand(tool)));
      return parseProbe(tool, result.stdout);
    }),
  };
}

export function diffClaudeCli(
  machineId?: string,
  tools?: string[],
  runner: MachineCommandRunner = runMachineCommand
): ClaudeCliDiffResult {
  const status = getClaudeCliStatus(machineId, tools, runner);
  return {
    ...status,
    missing: status.tools.filter((tool) => !tool.installed).map((tool) => tool.tool),
    installed: status.tools.filter((tool) => tool.installed).map((tool) => tool.tool),
  };
}

export interface RunClaudeInstallOptions {
  apply?: boolean;
  yes?: boolean;
  expectedPlanDigest?: string;
}

export function runClaudeInstall(
  machineId?: string,
  tools?: string[],
  options: RunClaudeInstallOptions = {},
  runner: MachineCommandRunner = runMachineCommand
): SetupResult {
  const plan = buildClaudeInstallPlan(machineId, tools);
  return runClaudeInstallPlan(plan, options, runner);
}

export function runClaudeInstallPlan(
  plan: SetupResult,
  options: RunClaudeInstallOptions = {},
  runner: MachineCommandRunner = runMachineCommand
): SetupResult {
  assertMutationPlanDigest(plan, options.expectedPlanDigest);
  if (!options.apply) return attachMutationPlanDigest({ ...plan, mode: "plan", executed: 0 });
  if (!options.yes) {
    throw new Error("Claude CLI installation requires --yes.");
  }

  let executed = 0;
  for (const step of plan.steps) {
    requireMachineCommandSuccess(`AI CLI install ${step.id}`, runner(plan.machineId, step.command));
    executed += 1;
  }

  return attachMutationPlanDigest({
    machineId: plan.machineId,
    mode: "apply",
    steps: plan.steps,
    executed,
  });
}
