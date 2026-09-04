import type {
  ExecutorResult,
  Goal,
  GoalRun,
  Loop,
  LoopRun,
  RunReceipt,
  PublicWorkflowEvent,
  StoredWorkflowEvent,
  WorkflowInvocation,
  WorkflowRun,
  WorkflowSpec,
  WorkflowStepRun,
  WorkflowWorkItem,
} from "../types.js";
import { isRedactionPlaceholder, scrubSecrets } from "./redact.js";
import { publicWorkflowEvent as validatedWorkflowEvent } from "./workflow-events.js";
import { loopOperationTemplateId, operationTemplateId } from "./operation-contract.js";
import { commandTargetDigest, publicCommandDescriptor } from "./command-target.js";

const TEXT_OUTPUT_LIMIT = 32 * 1024;
const SENSITIVE_PAYLOAD_KEYS = new Set(["env", "error", "prompt", "reason", "stderr", "stdout"]);

/**
 * Replace `value` with a placeholder recording how long it was.
 *
 * Idempotent: redacting an already-redacted value returns it unchanged rather
 * than reporting the placeholder's own length. A control-plane client reads
 * loops through an API that has already redacted them, then formats them for
 * display — without this, a 137-character prompt printed as "[redacted 20
 * chars]" (the length of "[redacted 137 chars]"), which silently destroyed the
 * only signal an operator had for checking the stored prompt was intact.
 */
export function redact(value: string | undefined, visible = 0): string | undefined {
  if (!value) return value;
  if (isRedactionPlaceholder(value)) return value;
  const scrubbed = scrubSecrets(value);
  if (scrubbed.length <= visible) return scrubbed;
  if (visible <= 0) return `[redacted ${scrubbed.length} chars]`;
  return `${scrubbed.slice(0, visible)}... [redacted ${scrubbed.length - visible} chars]`;
}

function truncateTextOutput(value: string): string {
  const scrubbed = scrubSecrets(value);
  if (scrubbed.length <= TEXT_OUTPUT_LIMIT) return scrubbed;
  return `${scrubbed.slice(0, TEXT_OUTPUT_LIMIT)}\n[truncated ${scrubbed.length - TEXT_OUTPUT_LIMIT} chars]`;
}

function scrubOptional(value: string | undefined): string | undefined {
  return value === undefined ? undefined : scrubSecrets(value);
}

function redactSensitivePayload(value: unknown, key?: string): unknown {
  if (typeof value === "string") {
    const scrubbed = scrubSecrets(value);
    return key && SENSITIVE_PAYLOAD_KEYS.has(key) ? redact(scrubbed) : scrubbed;
  }
  if (key && SENSITIVE_PAYLOAD_KEYS.has(key)) {
    if (value === undefined || value === null) return value;
    return "[redacted]";
  }
  if (Array.isArray(value)) return value.map((item) => redactSensitivePayload(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([entryKey, entryValue]) => [entryKey, redactSensitivePayload(entryValue, entryKey)]));
  }
  return value;
}

function existingOperationTemplateId(target: unknown): string | undefined {
  if (!target || typeof target !== "object") return undefined;
  const value = (target as Record<string, unknown>).operationTemplateId;
  return typeof value === "string" && value.startsWith("op-template:sha256:") ? value : undefined;
}

function publicTarget(
  target: Loop["target"],
  operationTemplateId: string,
): Record<string, unknown> {
  const stableTemplateId = existingOperationTemplateId(target) ?? operationTemplateId;
  if (target.type === "command") {
    // The surface shows the REAL resolved command line the executor will run
    // (secret-scrubbed and bounded for shell targets), never the placeholder
    // literal 'shell'. `commandDigest` binds the exact stored bytes — the
    // executor's own resolved line — so a control-plane reader can prove the
    // stored target matches an intended candidate, and a one-byte mutation
    // changes the digest. `commandResolvedFrom` records the provenance: the
    // command+args of the loop's own stored target.
    return {
      type: "command",
      command: publicCommandDescriptor(target),
      commandDigest: commandTargetDigest(target),
      commandResolvedFrom: "stored-target",
      shell: target.shell,
      timeoutMs: target.timeoutMs,
      idleTimeoutMs: target.idleTimeoutMs,
      preflight: target.preflight,
      operationTemplateId: stableTemplateId,
    };
  }
  if (target.type === "workflow") {
    return {
      type: "workflow",
      workflowId: target.workflowId,
      timeoutMs: target.timeoutMs,
      preflight: target.preflight,
      operationTemplateId: stableTemplateId,
    };
  }
  return {
    type: "agent",
    provider: target.provider,
    model: target.model,
    variant: target.variant,
    timeoutMs: target.timeoutMs,
    idleTimeoutMs: target.idleTimeoutMs,
    configIsolation: target.configIsolation,
    permissionMode: target.permissionMode,
    sandbox: target.sandbox,
    manualBreakGlass: target.manualBreakGlass,
    allowlist: target.allowlist
      ? {
          tools: target.allowlist.tools,
          commands: target.allowlist.commands,
          enforcement: target.allowlist.enforcement,
        }
      : undefined,
    worktree: target.worktree
      ? {
          mode: target.worktree.mode,
          enabled: target.worktree.enabled,
          reason: target.worktree.reason,
        }
      : undefined,
    routing: target.routing?.role ? { role: target.routing.role } : undefined,
    preflight: target.preflight,
    operationTemplateId: stableTemplateId,
  };
}

function publicOperationReference(
  target: Loop["target"],
  stableTemplateId: string,
): Record<string, unknown> {
  return {
    type: target.type,
    operationTemplateId: existingOperationTemplateId(target) ?? stableTemplateId,
  };
}

export function textOutputBlocks(
  value: Pick<LoopRun | WorkflowStepRun, "stdout" | "stderr">,
  opts: { indent?: string } = {},
): string[] {
  const indent = opts.indent ?? "";
  const nested = `${indent}  `;
  const blocks: string[] = [];
  for (const [label, output] of [
    ["stdout", value.stdout],
    ["stderr", value.stderr],
  ] as const) {
    if (!output) continue;
    blocks.push(`${indent}${label}:`);
    for (const line of truncateTextOutput(output).replace(/\s+$/, "").split(/\r?\n/)) {
      blocks.push(`${nested}${line}`);
    }
  }
  return blocks;
}

export function publicLoop(loop: Loop): Record<string, unknown> {
  const {
    target: _target,
    goal: _goal,
    machine: _machine,
    ...safe
  } = loop;
  return {
    ...safe,
    target: publicTarget(loop.target, loopOperationTemplateId(loop)),
    machine: loop.machine
      ? {
          id: loop.machine.id,
          route: loop.machine.route,
          local: loop.machine.local,
          confidence: loop.machine.confidence,
          packageVersion: loop.machine.packageVersion,
          warnings: loop.machine.warnings,
        }
      : undefined,
  };
}

export function publicRun(run: LoopRun, showOutput = false, opts: { redactError?: boolean } = {}): Record<string, unknown> {
  return {
    ...run,
    stdout: showOutput ? scrubOptional(run.stdout) : run.stdout ? `[redacted ${run.stdout.length} chars]` : undefined,
    stderr: showOutput ? scrubOptional(run.stderr) : run.stderr ? `[redacted ${run.stderr.length} chars]` : undefined,
    error: opts.redactError ? redact(run.error) : scrubOptional(run.error),
  };
}

export function publicRunReceipt(receipt: RunReceipt): Record<string, unknown> {
  return {
    loop_id: receipt.loop_id,
    run_id: receipt.run_id,
    repo: receipt.repo,
    task_ids: receipt.task_ids,
    knowledge_ids: receipt.knowledge_ids,
    digest_id: receipt.digest_id,
    started_at: receipt.started_at,
    finished_at: receipt.finished_at,
    status: receipt.status,
    exit_code: receipt.exit_code,
    summary: {
      stdout_bytes: receipt.summary.stdout_bytes,
      stderr_bytes: receipt.summary.stderr_bytes,
      duration_ms: receipt.summary.duration_ms,
    },
    bundle: receipt.bundle,
    result_ref: receipt.digest_id,
    created_at: receipt.created_at,
    updated_at: receipt.updated_at,
  };
}

export function publicExecutorResult(result: ExecutorResult, showOutput = false): Record<string, unknown> {
  return {
    ...result,
    stdout: showOutput ? scrubOptional(result.stdout) : result.stdout ? `[redacted ${result.stdout.length} chars]` : undefined,
    stderr: showOutput ? scrubOptional(result.stderr) : result.stderr ? `[redacted ${result.stderr.length} chars]` : undefined,
    error: redact(result.error),
  };
}

export function publicWorkflow(workflow: WorkflowSpec): Record<string, unknown> {
  return {
    id: workflow.id,
    name: workflow.name,
    description: workflow.description,
    version: workflow.version,
    status: workflow.status,
    steps: workflow.steps.map((step) => ({
      id: step.id,
      name: step.name,
      description: step.description,
      dependsOn: step.dependsOn,
      continueOnFailure: step.continueOnFailure,
      timeoutMs: step.timeoutMs,
      target: publicOperationReference(step.target, operationTemplateId(workflow, step)),
    })),
    createdAt: workflow.createdAt,
    updatedAt: workflow.updatedAt,
  };
}

export function publicWorkflowRun(run: WorkflowRun): Record<string, unknown> {
  const { manifestPath: _manifestPath, idempotencyKey: _idempotencyKey, ...safe } = run;
  return { ...safe, error: redact(run.error) };
}

export function publicWorkflowInvocation(invocation: WorkflowInvocation): Record<string, unknown> {
  const publicRef = (ref: WorkflowInvocation["sourceRef"]) => ({
    kind: ref.kind,
    id: ref.id,
    dedupeKey: ref.dedupeKey,
  });
  return {
    id: invocation.id,
    workflowId: invocation.workflowId,
    templateId: invocation.templateId,
    sourceRef: publicRef(invocation.sourceRef),
    subjectRef: publicRef(invocation.subjectRef),
    intent: invocation.intent,
    scope: invocation.scope
      ? {
          projectGroup: invocation.scope.projectGroup,
          worktreePolicy: invocation.scope.worktreePolicy,
          permissions: invocation.scope.permissions,
          concurrencyGroup: invocation.scope.concurrencyGroup,
        }
      : undefined,
    outputPolicy: invocation.outputPolicy,
    createdAt: invocation.createdAt,
    updatedAt: invocation.updatedAt,
  };
}

export function publicWorkflowWorkItem(item: WorkflowWorkItem): Record<string, unknown> {
  return {
    id: item.id,
    routeKey: item.routeKey,
    idempotencyKey: item.idempotencyKey,
    invocationId: item.invocationId,
    sourceType: item.sourceType,
    projectGroup: item.projectGroup,
    machineId: item.machineId,
    routeScope: item.routeScope,
    priority: item.priority,
    status: item.status,
    attempts: item.attempts,
    gateDeaths: item.gateDeaths,
    nextAttemptAt: item.nextAttemptAt,
    leaseExpiresAt: item.leaseExpiresAt,
    workflowId: item.workflowId,
    loopId: item.loopId,
    workflowRunId: item.workflowRunId,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

export function publicWorkflowStepRun(run: WorkflowStepRun, showOutput = false): Record<string, unknown> {
  const {
    accountProfile: _accountProfile,
    accountTool: _accountTool,
    ...safe
  } = run;
  return {
    ...safe,
    stdout: showOutput ? scrubOptional(run.stdout) : run.stdout ? `[redacted ${run.stdout.length} chars]` : undefined,
    stderr: showOutput ? scrubOptional(run.stderr) : run.stderr ? `[redacted ${run.stderr.length} chars]` : undefined,
    error: redact(run.error),
  };
}

export function publicWorkflowEvent(event: StoredWorkflowEvent | PublicWorkflowEvent): Record<string, unknown> {
  const validated = validatedWorkflowEvent(event);
  if ("eventKind" in validated && validated.eventKind === "custom") return { ...validated };
  return { ...validated, payload: redactSensitivePayload(validated.payload) };
}

export function publicGoal(goal: Goal): Record<string, unknown> {
  return {
    ...goal,
    objective: redact(goal.objective, 120),
  };
}

export function publicGoalRun(run: GoalRun): Record<string, unknown> {
  return {
    ...run,
    evidence: redactSensitivePayload(run.evidence),
    rawResponse: redactSensitivePayload(run.rawResponse),
  };
}
