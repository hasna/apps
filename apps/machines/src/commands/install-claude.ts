import { detectCurrentMachineManifest, getManifestMachine } from "../manifests.js";
import type { MachineManifest, SetupResult, SetupStep } from "../types.js";

const AI_CLI_PACKAGES = {
  claude: "@anthropic-ai/claude-code",
  codex: "@openai/codex",
  gemini: "@google/gemini-cli",
} as const;

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

export function buildClaudeInstallPlan(machineId?: string, tools?: string[]): SetupResult {
  const machine = (machineId ? getManifestMachine(machineId) : null) || detectCurrentMachineManifest();
  return {
    machineId: machine.id,
    mode: "plan",
    steps: buildInstallSteps(machine, tools),
    executed: 0,
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
