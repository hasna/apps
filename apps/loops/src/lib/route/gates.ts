import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { CreateWorkflowInput, LoopTarget, WorkflowSpec } from "../../types.js";
import { CodedError } from "../errors.js";
import { preflightTarget } from "../executor.js";
import { preflightWorkflow } from "../workflow-runner.js";
import { workflowBodyFromJson } from "../workflow-spec.js";

/**
 * Validation/preflight gates shared by CLI commands and route engines. Failures
 * throw a `GateError` carrying the gate kind and structured context so the CLI
 * error runner can render the stable `{ok:false, created:false, ...}` JSON shape.
 */
export class GateError extends CodedError {
  readonly gate: "validation" | "preflight";
  readonly context: Record<string, unknown>;

  constructor(gate: "validation" | "preflight", message: string, context: Record<string, unknown>) {
    super(gate === "validation" ? "VALIDATION_FAILED" : "PREFLIGHT_FAILED", message);
    this.gate = gate;
    this.context = context;
  }
}

function gateFailure(gate: "validation" | "preflight", error: unknown, context: Record<string, unknown>): never {
  const message = error instanceof Error ? error.message : String(error);
  throw new GateError(gate, message, context);
}

export function normalizeLoopTargetForStorage(
  target: unknown,
  context: Record<string, unknown>,
  opts: { baseDir?: string } = {},
): Exclude<LoopTarget, { type: "workflow" }> {
  try {
    const workflow = workflowBodyFromJson({
      name: "loop-target-validation",
      steps: [{ id: "target", target }],
    }, undefined, opts);
    return workflow.steps[0]!.target as Exclude<LoopTarget, { type: "workflow" }>;
  } catch (error) {
    gateFailure("validation", error, context);
  }
}

export function normalizeWorkflowForStorage(body: CreateWorkflowInput, context: Record<string, unknown>): CreateWorkflowInput {
  try {
    return workflowBodyFromJson(body);
  } catch (error) {
    gateFailure("validation", error, context);
  }
}

export function workflowBodyFromFile(file: string, fallbackName: string | undefined, context: Record<string, unknown>): CreateWorkflowInput {
  try {
    const resolved = resolve(file);
    return workflowBodyFromJson(JSON.parse(readFileSync(resolved, "utf8")), fallbackName, { baseDir: dirname(resolved) });
  } catch (error) {
    gateFailure("validation", error, context);
  }
}

export function preflightLoopTarget(
  target: Exclude<LoopTarget, { type: "workflow" }>,
  context: Record<string, unknown>,
  metadata: Parameters<typeof preflightTarget>[1],
  opts: Parameters<typeof preflightTarget>[2],
): ReturnType<typeof preflightTarget> {
  try {
    return preflightTarget(target, metadata, opts);
  } catch (error) {
    gateFailure("preflight", error, context);
  }
}

export function preflightStoredWorkflow(
  workflow: Parameters<typeof preflightWorkflow>[0],
  context: Record<string, unknown>,
  opts: Parameters<typeof preflightWorkflow>[1],
): ReturnType<typeof preflightWorkflow> {
  try {
    return preflightWorkflow(workflow, opts);
  } catch (error) {
    gateFailure("preflight", error, context);
  }
}

export function workflowSpecForPreflight(body: CreateWorkflowInput, id = "validation"): WorkflowSpec {
  const now = new Date().toISOString();
  return {
    id,
    name: body.name,
    description: body.description,
    version: body.version ?? 1,
    status: "active",
    goal: body.goal,
    steps: body.steps as WorkflowSpec["steps"],
    createdAt: now,
    updatedAt: now,
  };
}
