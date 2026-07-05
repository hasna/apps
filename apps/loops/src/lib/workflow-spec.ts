import { readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import type { AgentAllowlistSpec, AgentPromptSource, AgentProvider, AgentSandbox, AgentTarget, CreateWorkflowInput, ExecutableTarget, GoalSpec, WorkflowSpec, WorkflowStep } from "../types.js";
import { AGENT_PROVIDERS, providerAdapter } from "./agent-adapter.js";
import { GOAL_OBJECTIVE_MAX_CHARS } from "./goal/types.js";

export type WorkflowSpecBody = Pick<WorkflowSpec, "name" | "description" | "version" | "steps">;
export type NormalizedCreateWorkflowInput = Omit<CreateWorkflowInput, "steps"> & { steps: WorkflowStep[] };

export interface WorkflowNormalizeOptions {
  baseDir?: string;
}

function assertObject(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
}

function assertString(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${label} must be a non-empty string`);
}

function optionalPositiveInteger(value: unknown, label: string): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || (value as number) <= 0) throw new Error(`${label} must be a positive integer`);
  return value as number;
}

function optionalTimeoutMs(value: unknown, label: string): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (!Number.isInteger(value) || (value as number) <= 0) throw new Error(`${label} must be a positive integer or null for unlimited`);
  return value as number;
}

function optionalBoolean(value: unknown, label: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") throw new Error(`${label} must be a boolean`);
  return value;
}

function optionalStringArray(value: unknown, label: string): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  const values = value
    .map((entry, index) => {
      assertString(entry, `${label}[${index}]`);
      return entry.trim();
    })
    .filter(Boolean);
  return values.length ? values : undefined;
}

function optionalTrimmedString(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined;
  assertString(value, label);
  return value.trim();
}

function safetyReasonRequirement(provider: AgentProvider, sandbox: AgentSandbox | undefined): string | undefined {
  if (provider === "cursor" && sandbox === "disabled") return "cursor sandbox disabled";
  if ((provider === "codewith" || provider === "codex") && sandbox === "danger-full-access") return `${provider} danger-full-access`;
  return undefined;
}

function normalizeAllowlistSpec(
  value: unknown,
  label: string,
  context: { provider: AgentProvider; sandbox?: AgentSandbox },
): AgentAllowlistSpec | undefined {
  const requiredReason = safetyReasonRequirement(context.provider, context.sandbox);
  if (value === undefined) {
    if (requiredReason) throw new Error(`${label}.safetyReason is required when ${requiredReason} is used`);
    return undefined;
  }
  assertObject(value, label);
  const tools = optionalStringArray(value.tools, `${label}.tools`);
  const commands = optionalStringArray(value.commands, `${label}.commands`);
  const safetyReason = optionalTrimmedString(value.safetyReason, `${label}.safetyReason`);
  if (value.enforcement !== undefined && value.enforcement !== "metadata_only") {
    throw new Error(`${label}.enforcement must be metadata_only`);
  }
  if (requiredReason && !safetyReason) throw new Error(`${label}.safetyReason is required when ${requiredReason} is used`);
  if (!tools?.length && !commands?.length && !safetyReason) return undefined;
  return {
    tools,
    commands,
    enforcement: "metadata_only",
    safetyReason,
  };
}

function optionalAccountRef(value: unknown, label: string) {
  if (value === undefined) return undefined;
  assertObject(value, label);
  assertString(value.profile, `${label}.profile`);
  if (value.tool !== undefined) assertString(value.tool, `${label}.tool`);
  return {
    profile: value.profile.trim(),
    tool: typeof value.tool === "string" ? value.tool.trim() : undefined,
  };
}

function promptFilePath(rawPath: string, opts: WorkflowNormalizeOptions): string {
  return isAbsolute(rawPath) ? resolve(rawPath) : resolve(opts.baseDir ?? process.cwd(), rawPath);
}

function readPromptFile(rawPath: unknown, label: string, opts: WorkflowNormalizeOptions): { prompt: string; promptSource: AgentPromptSource } {
  assertString(rawPath, `${label}.promptFile`);
  const path = promptFilePath(rawPath.trim(), opts);
  let prompt: string;
  try {
    prompt = readFileSync(path, "utf8");
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String((error as { code?: unknown }).code) : undefined;
    throw new Error(`${label}.promptFile could not be read${code ? `: ${code}` : ""}`);
  }
  if (prompt.trim() === "") throw new Error(`${label}.promptFile must contain a non-empty prompt`);
  return { prompt, promptSource: { type: "file", path } };
}

function matchingPromptSource(value: unknown, prompt: string, opts: WorkflowNormalizeOptions): AgentPromptSource | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  if ((value as Record<string, unknown>).type !== "file") return undefined;
  const rawPath = (value as Record<string, unknown>).path;
  if (typeof rawPath !== "string" || rawPath.trim() === "") return undefined;
  const path = promptFilePath(rawPath.trim(), opts);
  try {
    return readFileSync(path, "utf8") === prompt ? { type: "file", path } : undefined;
  } catch {
    return undefined;
  }
}

export function normalizeGoalSpec(value: unknown, label = "goal"): GoalSpec | undefined {
  if (value === undefined) return undefined;
  assertObject(value, label);
  assertString(value.objective, `${label}.objective`);
  const objective = value.objective.trim();
  if (objective.length > GOAL_OBJECTIVE_MAX_CHARS) {
    throw new Error(`${label}.objective must be ${GOAL_OBJECTIVE_MAX_CHARS} characters or fewer`);
  }
  const autoExecute = value.autoExecute === undefined ? undefined : String(value.autoExecute);
  if (autoExecute !== undefined && !["off", "readyOnly", "aiDirected"].includes(autoExecute)) {
    throw new Error(`${label}.autoExecute must be off, readyOnly, or aiDirected`);
  }
  return {
    objective,
    tokenBudget: optionalPositiveInteger(value.tokenBudget, `${label}.tokenBudget`),
    maxTurns: optionalPositiveInteger(value.maxTurns, `${label}.maxTurns`),
    maxTokens: optionalPositiveInteger(value.maxTokens, `${label}.maxTokens`),
    model: typeof value.model === "string" && value.model.trim() ? value.model.trim() : undefined,
    autoExecute: autoExecute as GoalSpec["autoExecute"],
  };
}

function validateTarget(value: unknown, label: string, opts: WorkflowNormalizeOptions): ExecutableTarget {
  assertObject(value, label);
  if (value.type === "command") {
    assertString(value.command, `${label}.command`);
    optionalTimeoutMs(value.timeoutMs, `${label}.timeoutMs`);
    optionalPositiveInteger(value.idleTimeoutMs, `${label}.idleTimeoutMs`);
    if (value.shell !== true && /\s/.test(value.command.trim())) {
      throw new Error(`${label}.command must be an executable without spaces when shell is false; put flags in args or set shell true`);
    }
    return value as unknown as ExecutableTarget;
  }
  if (value.type === "agent") {
    assertString(value.provider, `${label}.provider`);
    const provider = value.provider as AgentProvider;
    const hasPrompt = typeof value.prompt === "string" && value.prompt.trim() !== "";
    const hasPromptFile = typeof value.promptFile === "string" && value.promptFile.trim() !== "";
    if (hasPrompt && hasPromptFile) throw new Error(`${label} must use either prompt or promptFile, not both`);
    if (!hasPrompt && !hasPromptFile) throw new Error(`${label}.prompt must be a non-empty string or ${label}.promptFile must be set`);
    const promptFields = hasPrompt
      ? { prompt: value.prompt as string, promptSource: matchingPromptSource(value.promptSource, value.prompt as string, opts) }
      : readPromptFile(value.promptFile, label, opts);
    if (!AGENT_PROVIDERS.includes(value.provider as AgentTarget["provider"])) {
      throw new Error(`${label}.provider must be one of ${AGENT_PROVIDERS.join(", ")}`);
    }
    optionalTimeoutMs(value.timeoutMs, `${label}.timeoutMs`);
    optionalPositiveInteger(value.idleTimeoutMs, `${label}.idleTimeoutMs`);
    const extraArgs = optionalStringArray(value.extraArgs, `${label}.extraArgs`);
    optionalStringArray(value.addDirs, `${label}.addDirs`);
    // Provider-specific option rules live in the shared provider adapters so the
    // creation-time and execution-time error strings cannot drift apart.
    providerAdapter(value.provider as AgentTarget["provider"]).validate(
      { ...value, extraArgs, ...promptFields } as unknown as AgentTarget,
      label,
    );
    const allowlist = normalizeAllowlistSpec(value.allowlist, `${label}.allowlist`, {
      provider,
      sandbox: value.sandbox as AgentSandbox | undefined,
    });
    if (value.worktree !== undefined) {
      assertObject(value.worktree, `${label}.worktree`);
      assertString(value.worktree.mode, `${label}.worktree.mode`);
      const modes = ["auto", "required", "off", "main"];
      if (!modes.includes(value.worktree.mode)) throw new Error(`${label}.worktree.mode must be one of ${modes.join(", ")}`);
      if (typeof value.worktree.enabled !== "boolean") throw new Error(`${label}.worktree.enabled must be a boolean`);
      assertString(value.worktree.originalCwd, `${label}.worktree.originalCwd`);
      assertString(value.worktree.cwd, `${label}.worktree.cwd`);
      if (value.worktree.repoRoot !== undefined) assertString(value.worktree.repoRoot, `${label}.worktree.repoRoot`);
      if (value.worktree.root !== undefined) assertString(value.worktree.root, `${label}.worktree.root`);
      if (value.worktree.path !== undefined) assertString(value.worktree.path, `${label}.worktree.path`);
      if (value.worktree.branch !== undefined) assertString(value.worktree.branch, `${label}.worktree.branch`);
      if (value.worktree.reason !== undefined) assertString(value.worktree.reason, `${label}.worktree.reason`);
    }
    if (value.routing !== undefined) {
      assertObject(value.routing, `${label}.routing`);
      if (value.routing.projectPath !== undefined) assertString(value.routing.projectPath, `${label}.routing.projectPath`);
      if (value.routing.projectGroup !== undefined) assertString(value.routing.projectGroup, `${label}.routing.projectGroup`);
      if (value.routing.taskId !== undefined) assertString(value.routing.taskId, `${label}.routing.taskId`);
      if (value.routing.eventId !== undefined) assertString(value.routing.eventId, `${label}.routing.eventId`);
      if (value.routing.eventType !== undefined) assertString(value.routing.eventType, `${label}.routing.eventType`);
      if (value.routing.eventSource !== undefined) assertString(value.routing.eventSource, `${label}.routing.eventSource`);
    }
    const target: Record<string, unknown> = { ...value, extraArgs, allowlist };
    if (!extraArgs) delete target.extraArgs;
    if (!allowlist) delete target.allowlist;
    delete target.promptFile;
    delete target.promptSource;
    return { ...target, ...promptFields } as unknown as ExecutableTarget;
  }
  throw new Error(`${label}.type must be command or agent`);
}

export function normalizeCreateWorkflowInput(input: CreateWorkflowInput, opts: WorkflowNormalizeOptions = {}): NormalizedCreateWorkflowInput {
  assertString(input.name, "workflow.name");
  const goal = normalizeGoalSpec(input.goal, "goal");
  if (!Array.isArray(input.steps) || input.steps.length === 0) throw new Error("workflow.steps must contain at least one step");
  const seen = new Set<string>();
  const steps: WorkflowStep[] = input.steps.map((step, index) => {
    assertObject(step, `workflow.steps[${index}]`);
    assertString(step.id, `workflow.steps[${index}].id`);
    if (seen.has(step.id)) throw new Error(`duplicate workflow step id: ${step.id}`);
    seen.add(step.id);
    return {
      ...step,
      id: step.id,
      goal: normalizeGoalSpec(step.goal, `workflow.steps[${index}].goal`),
      target: validateTarget(step.target, `workflow.steps[${index}].target`, opts),
      dependsOn: optionalStringArray(step.dependsOn, `workflow.steps[${index}].dependsOn`) ?? [],
      continueOnFailure: optionalBoolean(step.continueOnFailure, `workflow.steps[${index}].continueOnFailure`) ?? false,
      timeoutMs: optionalTimeoutMs(step.timeoutMs, `workflow.steps[${index}].timeoutMs`),
      account: optionalAccountRef(step.account, `workflow.steps[${index}].account`),
    };
  });
  for (const step of steps) {
    for (const dependency of step.dependsOn ?? []) {
      if (!seen.has(dependency)) throw new Error(`step ${step.id} depends on missing step ${dependency}`);
      if (dependency === step.id) throw new Error(`step ${step.id} cannot depend on itself`);
    }
  }
  workflowExecutionOrder({ steps });
  return { ...input, name: input.name.trim(), goal, version: input.version ?? 1, steps };
}

export function workflowExecutionOrder(workflow: Pick<WorkflowSpec, "steps">): WorkflowStep[] {
  const byId = new Map(workflow.steps.map((step) => [step.id, step]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const order: WorkflowStep[] = [];

  function visit(step: WorkflowStep): void {
    if (visited.has(step.id)) return;
    if (visiting.has(step.id)) throw new Error(`workflow dependency cycle includes step ${step.id}`);
    visiting.add(step.id);
    for (const dependencyId of step.dependsOn ?? []) {
      const dependency = byId.get(dependencyId);
      if (!dependency) throw new Error(`step ${step.id} depends on missing step ${dependencyId}`);
      visit(dependency);
    }
    visiting.delete(step.id);
    visited.add(step.id);
    order.push(step);
  }

  for (const step of workflow.steps) visit(step);
  return order;
}

export function workflowBodyFromJson(value: unknown, fallbackName?: string, opts: WorkflowNormalizeOptions = {}): NormalizedCreateWorkflowInput {
  assertObject(value, "workflow file");
  const rawName = fallbackName ?? value.name;
  assertString(rawName, "workflow.name");
  if (!Array.isArray(value.steps)) throw new Error("workflow.steps must be an array");
  return normalizeCreateWorkflowInput({
    name: rawName,
    description: typeof value.description === "string" ? value.description : undefined,
    goal: normalizeGoalSpec(value.goal, "goal"),
    version: typeof value.version === "number" ? value.version : undefined,
    steps: value.steps as WorkflowStep[],
  }, opts);
}
