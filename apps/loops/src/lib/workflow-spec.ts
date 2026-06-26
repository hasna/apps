import type { CreateWorkflowInput, ExecutableTarget, GoalSpec, WorkflowSpec, WorkflowStep } from "../types.js";
import { GOAL_OBJECTIVE_MAX_CHARS } from "./goal/types.js";

export type WorkflowSpecBody = Pick<WorkflowSpec, "name" | "description" | "version" | "steps">;

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

function validateTarget(value: unknown, label: string): ExecutableTarget {
  assertObject(value, label);
  if (value.type === "command") {
    assertString(value.command, `${label}.command`);
    if (value.shell !== true && /\s/.test(value.command.trim())) {
      throw new Error(`${label}.command must be an executable without spaces when shell is false; put flags in args or set shell true`);
    }
    return value as unknown as ExecutableTarget;
  }
  if (value.type === "agent") {
    assertString(value.provider, `${label}.provider`);
    assertString(value.prompt, `${label}.prompt`);
    const providers = ["claude", "cursor", "codewith", "aicopilot", "opencode", "codex"];
    if (!providers.includes(value.provider)) throw new Error(`${label}.provider must be one of ${providers.join(", ")}`);
    if (value.authProfile !== undefined) {
      assertString(value.authProfile, `${label}.authProfile`);
      if (value.provider !== "codewith") throw new Error(`${label}.authProfile is currently supported only for provider codewith`);
    }
    if (value.variant !== undefined) assertString(value.variant, `${label}.variant`);
    if (value.permissionMode !== undefined) {
      assertString(value.permissionMode, `${label}.permissionMode`);
      const permissionModes = ["default", "plan", "auto", "bypass"];
      if (!permissionModes.includes(value.permissionMode)) {
        throw new Error(`${label}.permissionMode must be one of ${permissionModes.join(", ")}`);
      }
      if (value.permissionMode === "plan" && !["claude", "cursor"].includes(value.provider)) {
        throw new Error(`${label}.permissionMode plan is currently supported only for provider claude or cursor`);
      }
      if (value.permissionMode === "auto" && value.provider !== "claude") {
        throw new Error(`${label}.permissionMode auto is currently supported only for provider claude`);
      }
    }
    if (value.sandbox !== undefined) {
      assertString(value.sandbox, `${label}.sandbox`);
      const codexLike = ["read-only", "workspace-write", "danger-full-access"];
      const cursorLike = ["enabled", "disabled"];
      if (["codewith", "codex"].includes(value.provider)) {
        if (!codexLike.includes(value.sandbox)) throw new Error(`${label}.sandbox must be one of ${codexLike.join(", ")}`);
      } else if (value.provider === "cursor") {
        if (!cursorLike.includes(value.sandbox)) throw new Error(`${label}.sandbox must be one of ${cursorLike.join(", ")}`);
      } else {
        throw new Error(`${label}.sandbox is currently supported only for provider codewith, codex, or cursor`);
      }
    }
    return value as unknown as ExecutableTarget;
  }
  throw new Error(`${label}.type must be command or agent`);
}

export function normalizeCreateWorkflowInput(input: CreateWorkflowInput): CreateWorkflowInput {
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
      target: validateTarget(step.target, `workflow.steps[${index}].target`),
      dependsOn: step.dependsOn ?? [],
      continueOnFailure: step.continueOnFailure ?? false,
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

export function workflowBodyFromJson(value: unknown, fallbackName?: string): CreateWorkflowInput {
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
  });
}
