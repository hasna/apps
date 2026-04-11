import { detectCurrentMachineManifest, getManifestMachine } from "../manifests.js";
import { runMachineCommand } from "../remote.js";
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
  return (machineId ? getManifestMachine(machineId) : null) || detectCurrentMachineManifest();
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
  return {
    machineId: machine.id,
    mode: "plan",
    steps: buildInstallSteps(machine, tools),
    executed: 0,
  };
}

export function getClaudeCliStatus(machineId?: string, tools?: string[]): ClaudeCliStatusResult {
  const machine = resolveMachine(machineId);
  const normalizedTools = normalizeTools(tools);
  const route = runMachineCommand(machine.id, "true").source;
  return {
    machineId: machine.id,
    source: route,
    tools: normalizedTools.map((tool) => parseProbe(tool, runMachineCommand(machine.id, buildProbeCommand(tool)).stdout)),
  };
}

export function diffClaudeCli(machineId?: string, tools?: string[]): ClaudeCliDiffResult {
  const status = getClaudeCliStatus(machineId, tools);
  return {
    ...status,
    missing: status.tools.filter((tool) => !tool.installed).map((tool) => tool.tool),
    installed: status.tools.filter((tool) => tool.installed).map((tool) => tool.tool),
  };
}

export function runClaudeInstall(
  machineId?: string,
  tools?: string[],
  options: { apply?: boolean; yes?: boolean } = {}
): SetupResult {
  const plan = buildClaudeInstallPlan(machineId, tools);
  if (!options.apply) return plan;
  if (!options.yes) {
    throw new Error("Claude CLI installation requires --yes.");
  }

  let executed = 0;
  for (const step of plan.steps) {
    const result = Bun.spawnSync(["bash", "-lc", step.command], {
      stdout: "pipe",
      stderr: "pipe",
      env: process.env,
    });
    if (result.exitCode !== 0) {
      throw new Error(`AI CLI install failed (${step.id}): ${result.stderr.toString().trim()}`);
    }
    executed += 1;
  }

  return {
    machineId: plan.machineId,
    mode: "apply",
    steps: plan.steps,
    executed,
  };
}
