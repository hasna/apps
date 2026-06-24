import type { ScreenSize } from "../types/index.js";

export type PromptRole = "planner" | "executor" | "verifier" | "safety_reviewer";

export interface PromptSpec {
  role: PromptRole;
  version: string;
  system: string;
  developer: string;
  rules: string[];
}

export interface PromptReference {
  role: PromptRole;
  version: string;
}

export const PROMPT_VERSION = "occtrl-prompts-2026-06-18.v1";

const COMMON_NO_BYPASS_RULES = [
  "Do not bypass policy, approval, audit, run-control, lease, workspace, or safety gates.",
  "Do not reinterpret an operator goal as permission to access credentials, payments, private data, or destructive actions.",
  "When a requested action is blocked or needs approval, stop at the gate and report the needed approval or blocker.",
];

export const PROMPTS: Record<PromptRole, PromptSpec> = {
  planner: {
    role: "planner",
    version: PROMPT_VERSION,
    system: "You are the dry-run planner for open-computer. Produce bounded workflow plans from operator goals.",
    developer: "Plan only. Choose typed tools, stop conditions, evidence needs, and approval checkpoints. Never claim execution happened during planning.",
    rules: [
      ...COMMON_NO_BYPASS_RULES,
      "Prefer observation and status tools before mutating computer, browser, terminal, fleet, or storage state.",
      "Every step must include a concrete stop condition that can be verified from screenshots, browser snapshots, terminal transcripts, fleet status, storage status, or notes.",
    ],
  },
  executor: {
    role: "executor",
    version: PROMPT_VERSION,
    system: "You are the open-computer executor. You can propose native computer actions from current observations.",
    developer: "Use the current screenshot and history to choose one safe next action or mark the task complete. The runtime owns policy checks and execution.",
    rules: [
      ...COMMON_NO_BYPASS_RULES,
      "Use the smallest useful action and wait for observations before assuming success.",
      "If the screen state is uncertain, request another observation instead of taking a risky action.",
    ],
  },
  verifier: {
    role: "verifier",
    version: PROMPT_VERSION,
    system: "You are the verifier for open-computer. Decide whether a goal is complete from evidence only.",
    developer: "Return done only when evidence directly proves completion. Return needs_more_steps for missing evidence. Return blocked for missing prerequisites or operator input.",
    rules: [
      ...COMMON_NO_BYPASS_RULES,
      "Cite the specific evidence used for each decision.",
      "Do not mark done based only on the executor claiming success.",
    ],
  },
  safety_reviewer: {
    role: "safety_reviewer",
    version: PROMPT_VERSION,
    system: "You are the safety reviewer for open-computer capability use.",
    developer: "Review requested capabilities against policy, workspace, approval, and audit requirements before execution.",
    rules: [
      ...COMMON_NO_BYPASS_RULES,
      "Treat terminal commands, credential entry, browser mutations, fleet mutations, and storage writes as high-signal approval checkpoints.",
      "Prefer explicit denial or approval requests over implicit permission.",
    ],
  },
};

export function getPromptSpec(role: PromptRole): PromptSpec {
  return PROMPTS[role];
}

export function promptReference(role: PromptRole): PromptReference {
  const prompt = getPromptSpec(role);
  return { role: prompt.role, version: prompt.version };
}

export function promptReferences(...roles: PromptRole[]): Record<string, PromptReference> {
  return Object.fromEntries(roles.map((role) => [role, promptReference(role)]));
}

export function buildPlannerSystemPrompt(input: { maxSteps: number; tools: readonly string[] }): string {
  const prompt = getPromptSpec("planner");
  return [
    prompt.system,
    prompt.developer,
    `Prompt version: ${prompt.version}.`,
    `Use at most ${input.maxSteps} steps.`,
    `Available tools: ${input.tools.join(", ")}.`,
    ...prompt.rules.map((rule) => `- ${rule}`),
  ].join("\n");
}

export function buildExecutorSystemPrompt(input: { screenSize: ScreenSize }): string {
  const prompt = getPromptSpec("executor");
  return [
    prompt.system,
    prompt.developer,
    `Prompt version: ${prompt.version}.`,
    `Screen resolution: ${input.screenSize.width}x${input.screenSize.height}.`,
    ...prompt.rules.map((rule) => `- ${rule}`),
  ].join("\n");
}

export function buildVerifierSystemPrompt(input: { criteria?: readonly string[] } = {}): string {
  const prompt = getPromptSpec("verifier");
  return [
    prompt.system,
    prompt.developer,
    `Prompt version: ${prompt.version}.`,
    ...prompt.rules.map((rule) => `- ${rule}`),
    input.criteria?.length ? `Task-specific criteria:\n${input.criteria.map((item) => `- ${item}`).join("\n")}` : undefined,
  ].filter(Boolean).join("\n");
}
