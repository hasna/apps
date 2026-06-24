import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod/v4";
import type { CreateLoopInput, GoalSpec, LoopRun, LoopStatus, RunStatus, WorkflowRunStatus, WorkflowSpec } from "../types.js";
import { daemonStatus } from "../daemon/control.js";
import { runDoctor } from "../lib/doctor.js";
import {
  compactGoal,
  compactGoalPlanNode,
  compactGoalRun,
  compactLoop,
  compactRun,
  compactWorkflow,
  compactWorkflowEvent,
  compactWorkflowRun,
  compactWorkflowStepRun,
  publicExecutorResult,
  publicGoal,
  publicGoalRun,
  publicLoop,
  publicRun,
  publicWorkflow,
  publicWorkflowEvent,
  publicWorkflowRun,
  publicWorkflowStepRun,
} from "../lib/format.js";
import { normalizeLoopLabels } from "../lib/labels.js";
import { listOpenMachines, resolveLoopMachine } from "../lib/machines.js";
import { packageVersion } from "../lib/version.js";
import { executeWorkflow, preflightWorkflow } from "../lib/workflow-runner.js";
import { normalizeGoalSpec, workflowBodyFromJson } from "../lib/workflow-spec.js";
import { LoopsClient } from "../sdk/index.js";
import { Store } from "../lib/store.js";
import { tick } from "../lib/scheduler.js";

const DEFAULT_OUTPUT_CHARS = 8_000;
const MAX_OUTPUT_CHARS = 32_000;
const MAX_RESPONSE_CHARS = 128_000;
const DEFAULT_RECENT_LIMIT = 10;
const DEFAULT_CHILD_LIMIT = 50;
const MAX_LIMIT = 200;
const MAX_OUTPUT_RUN_LIMIT = 25;

const labelSchema = z.string().min(1).max(64).regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/);
const labelsSchema = z.array(labelSchema).max(32);
const positiveIntSchema = z.number().int().positive();
const nonNegativeIntSchema = z.number().int().nonnegative();

const accountSchema = z
  .object({
    profile: z.string().min(1),
    tool: z.string().min(1).optional(),
  })
  .strict();

const goalSchema = z
  .object({
    objective: z.string().min(1),
    tokenBudget: positiveIntSchema.optional(),
    maxTurns: positiveIntSchema.optional(),
    maxTokens: positiveIntSchema.optional(),
    model: z.string().min(1).optional(),
    autoExecute: z.enum(["off", "readyOnly", "aiDirected"]).optional(),
  })
  .strict();

const scheduleSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("once"), at: z.string().min(1) }).strict(),
  z.object({ type: z.literal("interval"), everyMs: positiveIntSchema, anchor: z.enum(["fixed_rate", "fixed_delay"]).optional() }).strict(),
  z.object({ type: z.literal("cron"), expression: z.string().min(1) }).strict(),
  z.object({ type: z.literal("dynamic"), minIntervalMs: positiveIntSchema.optional() }).strict(),
]);

const commandTargetSchema = z
  .object({
    type: z.literal("command"),
    command: z.string().min(1),
    args: z.array(z.string()).optional(),
    cwd: z.string().min(1).optional(),
    shell: z.boolean().optional(),
    env: z.record(z.string(), z.string()).optional(),
    timeoutMs: positiveIntSchema.optional(),
    account: accountSchema.optional(),
  })
  .strict();

const agentTargetSchema = z
  .object({
    type: z.literal("agent"),
    provider: z.enum(["claude", "cursor", "codewith", "aicopilot", "opencode", "codex"]),
    prompt: z.string().min(1),
    cwd: z.string().min(1).optional(),
    model: z.string().min(1).optional(),
    agent: z.string().min(1).optional(),
    authProfile: z.string().min(1).optional(),
    extraArgs: z.array(z.string()).optional(),
    timeoutMs: positiveIntSchema.optional(),
    configIsolation: z.enum(["safe", "none"]).optional(),
    sandbox: z.enum(["read-only", "workspace-write", "danger-full-access"]).optional(),
    account: accountSchema.optional(),
  })
  .strict();

const workflowTargetSchema = z
  .object({
    type: z.literal("workflow"),
    workflowId: z.string().min(1),
    input: z.record(z.string(), z.string()).optional(),
    timeoutMs: positiveIntSchema.optional(),
  })
  .strict();

const executableTargetSchema = z.discriminatedUnion("type", [commandTargetSchema, agentTargetSchema]);
const loopTargetSchema = z.discriminatedUnion("type", [commandTargetSchema, agentTargetSchema, workflowTargetSchema]);

const workflowStepSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1).optional(),
    description: z.string().min(1).optional(),
    target: executableTargetSchema,
    goal: goalSchema.optional(),
    dependsOn: z.array(z.string().min(1)).optional(),
    continueOnFailure: z.boolean().optional(),
    timeoutMs: positiveIntSchema.optional(),
    account: accountSchema.optional(),
  })
  .strict();

const workflowSpecSchema = z
  .object({
    name: z.string().min(1),
    description: z.string().min(1).optional(),
    version: positiveIntSchema.optional(),
    goal: goalSchema.optional(),
    steps: z.array(workflowStepSchema).min(1),
  })
  .strict();

function boundedLimit(value: number | undefined, fallback: number): number {
  return Math.max(1, Math.min(value ?? fallback, MAX_LIMIT));
}

function boundedCursor(value: number | undefined): number {
  return Math.max(0, value ?? 0);
}

function boundedOutputLimit(value: number | undefined, fallback: number): number {
  return Math.max(1, Math.min(value ?? fallback, MAX_OUTPUT_RUN_LIMIT));
}

function boundedOutputChars(value: number | undefined): number {
  return Math.max(1, Math.min(value ?? DEFAULT_OUTPUT_CHARS, MAX_OUTPUT_CHARS));
}

function truncateText(value: unknown, limit: number): unknown {
  if (typeof value !== "string") return value;
  if (value.length <= limit) return value;
  return `${value.slice(0, limit)}\n[truncated ${value.length - limit} chars]`;
}

function pageItems<T>(items: T[], cursor: number, limit: number): {
  page: T[];
  nextCursor?: number;
  hasMore: boolean;
} {
  const page = items.slice(cursor, cursor + limit);
  const nextCursor = items.length > cursor + limit ? cursor + limit : undefined;
  return { page, nextCursor, hasMore: nextCursor !== undefined };
}

function boundRun(run: LoopRun, showOutput: boolean | undefined, maxOutputChars: number | undefined): Record<string, unknown> {
  const value = publicRun(run, Boolean(showOutput));
  if (showOutput) {
    const limit = boundedOutputChars(maxOutputChars);
    value.stdout = truncateText(value.stdout, limit);
    value.stderr = truncateText(value.stderr, limit);
  }
  return value;
}

function boundWorkflowStepRun(run: Parameters<typeof publicWorkflowStepRun>[0], showOutput: boolean | undefined, maxOutputChars: number | undefined): Record<string, unknown> {
  const value = publicWorkflowStepRun(run, Boolean(showOutput));
  if (showOutput) {
    const limit = boundedOutputChars(maxOutputChars);
    value.stdout = truncateText(value.stdout, limit);
    value.stderr = truncateText(value.stderr, limit);
  }
  return value;
}

function compactSummary(value: Record<string, unknown>): Record<string, unknown> {
  const summary: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (Array.isArray(entry)) {
      summary[key] = { count: entry.length };
    } else if (entry && typeof entry === "object") {
      const object = entry as Record<string, unknown>;
      summary[key] = {
        id: object.id ?? object.goalId ?? object.runId,
        name: object.name ?? object.loopName ?? object.workflowName,
        status: object.status,
        keys: Object.keys(object),
      };
    } else {
      summary[key] = entry;
    }
  }
  return summary;
}

function jsonResult(value: Record<string, unknown>): CallToolResult {
  const json = JSON.stringify(value);
  if (json.length > MAX_RESPONSE_CHARS) {
    const truncated = {
      truncated: true,
      maxResponseChars: MAX_RESPONSE_CHARS,
      actualChars: json.length,
      summary: compactSummary(value),
    };
    return {
      structuredContent: truncated,
      content: [{ type: "text", text: JSON.stringify(truncated, null, 2) }],
    };
  }
  const text = {
    ok: true,
    summary: compactSummary(value),
  };
  return {
    structuredContent: value,
    content: [{ type: "text", text: JSON.stringify(text, null, 2) }],
  };
}

function loopStatus(value: string | undefined): LoopStatus | undefined {
  if (value === undefined) return undefined;
  if (!["active", "paused", "stopped", "expired"].includes(value)) throw new Error("status must be active, paused, stopped, or expired");
  return value as LoopStatus;
}

function runStatus(value: string | undefined): RunStatus | undefined {
  if (value === undefined) return undefined;
  if (!["running", "succeeded", "failed", "timed_out", "abandoned", "skipped"].includes(value)) {
    throw new Error("status must be running, succeeded, failed, timed_out, abandoned, or skipped");
  }
  return value as RunStatus;
}

function workflowRunStatus(value: string | undefined): WorkflowRunStatus | undefined {
  if (value === undefined) return undefined;
  if (!["running", "succeeded", "failed", "timed_out", "cancelled"].includes(value)) {
    throw new Error("status must be running, succeeded, failed, timed_out, or cancelled");
  }
  return value as WorkflowRunStatus;
}

function normalizeLoopTarget(store: Store, target: CreateLoopInput["target"]): CreateLoopInput["target"] {
  if (target.type === "agent" && target.authProfile && target.provider !== "codewith") {
    throw new Error("target.authProfile is currently supported only for provider codewith");
  }
  if (target.type !== "workflow") return target;
  const workflow = store.requireWorkflow(target.workflowId);
  return { ...target, workflowId: workflow.id };
}

export interface OpenLoopsMcpServerOptions {
  store?: Store;
  runnerId?: string;
}

interface ToolConfig {
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  };
}

type ToolHandler<T> = (input: T) => CallToolResult | Promise<CallToolResult>;

function registerTool<T>(server: McpServer, name: string, config: ToolConfig, handler: ToolHandler<T>): void {
  server.registerTool(name, config as Parameters<McpServer["registerTool"]>[1], handler as Parameters<McpServer["registerTool"]>[2]);
}

interface CreateLoopArgs {
  name: string;
  description?: string;
  labels?: string[];
  schedule: CreateLoopInput["schedule"];
  target: CreateLoopInput["target"];
  goal?: GoalSpec;
  machineId?: string;
  catchUp?: CreateLoopInput["catchUp"];
  catchUpLimit?: number;
  overlap?: CreateLoopInput["overlap"];
  maxAttempts?: number;
  retryDelayMs?: number;
  leaseMs?: number;
  expiresAt?: string;
}

interface ListLoopsArgs {
  status?: LoopStatus;
  labels?: string[];
  limit?: number;
  cursor?: number;
  verbose?: boolean;
}

interface GetLoopArgs {
  idOrName: string;
  includeRecentRuns?: boolean;
  runsLimit?: number;
  showOutput?: boolean;
  maxOutputChars?: number;
  verbose?: boolean;
}

interface IdArgs {
  idOrName: string;
}

interface RunNowArgs extends IdArgs {
  showOutput?: boolean;
  maxOutputChars?: number;
}

interface UpdateLabelsArgs extends IdArgs {
  mode: "set" | "add" | "remove" | "clear";
  labels?: string[];
}

interface ListRunsArgs {
  idOrName?: string;
  showOutput?: boolean;
  maxOutputChars?: number;
  status?: RunStatus;
  labels?: string[];
  limit?: number;
  cursor?: number;
  verbose?: boolean;
}

interface ValidateWorkflowArgs {
  workflow: unknown;
  name?: string;
  preflight?: boolean;
}

interface WorkflowSpecArgs {
  workflow: unknown;
  name?: string;
}

interface ListWorkflowsArgs {
  status?: WorkflowSpec["status"];
  limit?: number;
  cursor?: number;
  verbose?: boolean;
}

interface WorkflowIdArgs {
  idOrName: string;
}

interface RunWorkflowArgs extends WorkflowIdArgs {
  showOutput?: boolean;
  maxOutputChars?: number;
  verbose?: boolean;
}

interface ListWorkflowRunsArgs {
  idOrName?: string;
  showOutput?: boolean;
  maxOutputChars?: number;
  loopRunId?: string;
  status?: WorkflowRunStatus;
  limit?: number;
  cursor?: number;
  verbose?: boolean;
}

interface InspectWorkflowRunArgs {
  runId: string;
  showOutput?: boolean;
  maxOutputChars?: number;
  stepsLimit?: number;
  eventsLimit?: number;
  verbose?: boolean;
}

interface WorkflowRunIdArgs {
  runId: string;
}

interface WorkflowEventsArgs extends WorkflowRunIdArgs {
  limit?: number;
  cursor?: number;
  verbose?: boolean;
}

interface WorkflowReasonArgs extends WorkflowRunIdArgs {
  reason?: string;
}

interface GoalArgs {
  idOrName: string;
  limit?: number;
  nodesLimit?: number;
  verbose?: boolean;
}

interface GoalStatusArgs {
  runId: string;
  limit?: number;
  nodesLimit?: number;
  verbose?: boolean;
}

interface MachineIdArgs {
  id: string;
}

interface ListMachinesArgs {
  limit?: number;
  cursor?: number;
  verbose?: boolean;
}

export function createOpenLoopsMcpServer(opts: OpenLoopsMcpServerOptions = {}): McpServer {
  const store = opts.store ?? new Store();
  const client = new LoopsClient({ store, runnerId: opts.runnerId ?? `mcp:${process.pid}` });
  const server = new McpServer({
    name: "@hasna/loops",
    title: "OpenLoops",
    version: packageVersion(),
  });

  registerTool<CreateLoopArgs>(
    server,
    "openloops_create_loop",
    {
      title: "Create OpenLoops Loop",
      description: "Create a persisted command, agent, or workflow loop in OpenLoops. Created loops can execute later via daemon, tick, or run-now.",
      inputSchema: {
        name: z.string().min(1),
        description: z.string().min(1).optional(),
        labels: labelsSchema.optional(),
        schedule: scheduleSchema,
        target: loopTargetSchema,
        goal: goalSchema.optional(),
        machineId: z.string().min(1).optional(),
        catchUp: z.enum(["none", "latest", "all"]).optional(),
        catchUpLimit: positiveIntSchema.optional(),
        overlap: z.enum(["skip", "allow"]).optional(),
        maxAttempts: positiveIntSchema.optional(),
        retryDelayMs: positiveIntSchema.optional(),
        leaseMs: positiveIntSchema.optional(),
        expiresAt: z.string().min(1).optional(),
      },
      annotations: { destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    async (input) => {
      const createInput: CreateLoopInput = {
        name: input.name,
        description: input.description,
        labels: normalizeLoopLabels(input.labels),
        schedule: input.schedule,
        target: normalizeLoopTarget(store, input.target),
        goal: input.goal ? normalizeGoalSpec(input.goal) : undefined,
        machine: input.machineId ? resolveLoopMachine(input.machineId) : undefined,
        catchUp: input.catchUp,
        catchUpLimit: input.catchUpLimit,
        overlap: input.overlap,
        maxAttempts: input.maxAttempts,
        retryDelayMs: input.retryDelayMs,
        leaseMs: input.leaseMs,
        expiresAt: input.expiresAt ? new Date(input.expiresAt).toISOString() : undefined,
      };
      return jsonResult({ loop: publicLoop(client.create(createInput)) });
    },
  );

  registerTool<ListLoopsArgs>(
    server,
    "openloops_list_loops",
    {
      title: "List OpenLoops Loops",
      description: "List persisted OpenLoops loops, optionally filtered by status and labels.",
      inputSchema: {
        status: z.enum(["active", "paused", "stopped", "expired"]).optional(),
        labels: labelsSchema.optional(),
        limit: positiveIntSchema.optional(),
        cursor: nonNegativeIntSchema.optional(),
        verbose: z.boolean().optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ status, labels, limit, cursor, verbose }) => {
      const resolvedLimit = boundedLimit(limit, MAX_LIMIT);
      const resolvedCursor = boundedCursor(cursor);
      const loops = store.listLoops({
        status: loopStatus(status),
        labels: normalizeLoopLabels(labels),
        limit: resolvedCursor + resolvedLimit + 1,
      });
      const { page, nextCursor, hasMore } = pageItems(loops, resolvedCursor, resolvedLimit);
      return jsonResult({
        loops: page.map((loop) => (verbose ? publicLoop(loop) : compactLoop(loop))),
        nextCursor,
        hasMore,
      });
    },
  );

  registerTool<GetLoopArgs>(
    server,
    "openloops_get_loop",
    {
      title: "Get OpenLoops Loop",
      description: "Read one loop by id or name, with optional recent runs.",
      inputSchema: {
        idOrName: z.string().min(1),
        includeRecentRuns: z.boolean().optional(),
        runsLimit: positiveIntSchema.optional(),
        showOutput: z.boolean().optional(),
        maxOutputChars: positiveIntSchema.optional(),
        verbose: z.boolean().optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ idOrName, includeRecentRuns, runsLimit, showOutput, maxOutputChars, verbose }) => {
      const loop = store.requireLoop(idOrName);
      const recentRuns =
        includeRecentRuns !== true
          ? undefined
          : store
              .listRuns({ loopId: loop.id, limit: showOutput ? boundedOutputLimit(runsLimit, DEFAULT_RECENT_LIMIT) : boundedLimit(runsLimit, DEFAULT_RECENT_LIMIT) })
              .map((run) => (showOutput || verbose ? boundRun(run, showOutput, maxOutputChars) : compactRun(run)));
      return jsonResult({ loop: verbose ? publicLoop(loop) : compactLoop(loop), recentRuns });
    },
  );

  registerTool<RunNowArgs>(
    server,
    "openloops_run_now",
    {
      title: "Run OpenLoops Loop Now",
      description: "Manually run a loop now using OpenLoops scheduling and execution semantics.",
      inputSchema: {
        idOrName: z.string().min(1),
        showOutput: z.boolean().optional(),
        maxOutputChars: positiveIntSchema.optional(),
      },
      annotations: { destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    async ({ idOrName, showOutput, maxOutputChars }) => jsonResult({ run: boundRun(await client.runNow(idOrName), showOutput, maxOutputChars) }),
  );

  for (const [name, title, action] of [
    ["openloops_pause_loop", "Pause OpenLoops Loop", (idOrName: string) => client.pause(idOrName)],
    ["openloops_resume_loop", "Resume OpenLoops Loop", (idOrName: string) => client.resume(idOrName)],
    ["openloops_stop_loop", "Stop OpenLoops Loop", (idOrName: string) => client.stop(idOrName)],
  ] as const) {
    registerTool<IdArgs>(
      server,
      name,
      {
        title,
        description: `${title} by id or name.`,
        inputSchema: { idOrName: z.string().min(1) },
        annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: false },
      },
      async ({ idOrName }) => jsonResult({ loop: publicLoop(action(idOrName)) }),
    );
  }

  registerTool<IdArgs>(
    server,
    "openloops_delete_loop",
    {
      title: "Delete OpenLoops Loop",
      description: "Delete a persisted loop by id or name.",
      inputSchema: { idOrName: z.string().min(1) },
      annotations: { destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    async ({ idOrName }) => jsonResult({ removed: client.delete(idOrName) }),
  );

  registerTool<UpdateLabelsArgs>(
    server,
    "openloops_update_labels",
    {
      title: "Update OpenLoops Labels",
      description: "Set, add, remove, or clear labels on a loop.",
      inputSchema: {
        idOrName: z.string().min(1),
        mode: z.enum(["set", "add", "remove", "clear"]),
        labels: labelsSchema.optional(),
      },
      annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ idOrName, mode, labels }) => {
      const nextLabels = labels ?? [];
      if (mode !== "clear" && nextLabels.length === 0) throw new Error("labels are required unless mode is clear");
      const loop =
        mode === "set"
          ? client.setLabels(idOrName, nextLabels)
          : mode === "add"
            ? client.addLabels(idOrName, nextLabels)
            : mode === "remove"
              ? client.removeLabels(idOrName, nextLabels)
              : client.setLabels(idOrName, []);
      return jsonResult({ loop: publicLoop(loop) });
    },
  );

  registerTool<ListRunsArgs>(
    server,
    "openloops_list_runs",
    {
      title: "List OpenLoops Runs",
      description: "Inspect recent loop runs, optionally filtered by loop, status, labels, and bounded output.",
      inputSchema: {
        idOrName: z.string().min(1).optional(),
        status: z.enum(["running", "succeeded", "failed", "timed_out", "abandoned", "skipped"]).optional(),
        labels: labelsSchema.optional(),
        limit: positiveIntSchema.optional(),
        cursor: nonNegativeIntSchema.optional(),
        showOutput: z.boolean().optional(),
        maxOutputChars: positiveIntSchema.optional(),
        verbose: z.boolean().optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ idOrName, status, labels, limit, cursor, showOutput, maxOutputChars, verbose }) => {
      const loop = idOrName ? store.requireLoop(idOrName) : undefined;
      const resolvedLimit = showOutput ? boundedOutputLimit(limit, 10) : boundedLimit(limit, 50);
      const resolvedCursor = boundedCursor(cursor);
      const runs = store.listRuns({
        loopId: loop?.id,
        status: runStatus(status),
        labels: normalizeLoopLabels(labels),
        limit: resolvedCursor + resolvedLimit + 1,
      });
      const { page, nextCursor, hasMore } = pageItems(runs, resolvedCursor, resolvedLimit);
      return jsonResult({
        runs: page.map((run) => (showOutput || verbose ? boundRun(run, showOutput, maxOutputChars) : compactRun(run))),
        nextCursor,
        hasMore,
      });
    },
  );

  registerTool<ValidateWorkflowArgs>(
    server,
    "openloops_validate_workflow",
    {
      title: "Validate OpenLoops Workflow",
      description: "Validate an OpenLoops workflow spec object, optionally including executable preflight checks.",
      inputSchema: {
        workflow: workflowSpecSchema,
        name: z.string().min(1).optional(),
        preflight: z.boolean().optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ workflow, name, preflight }) => {
      const body = workflowBodyFromJson(workflow, name);
      const now = new Date().toISOString();
      const spec: WorkflowSpec = {
        id: "validation",
        name: body.name,
        description: body.description,
        version: body.version ?? 1,
        status: "active",
        goal: body.goal,
        steps: body.steps,
        createdAt: now,
        updatedAt: now,
      };
      return jsonResult({ valid: true, workflow: publicWorkflow(spec), preflight: preflight ? preflightWorkflow(spec) : undefined });
    },
  );

  registerTool<WorkflowSpecArgs>(
    server,
    "openloops_create_workflow",
    {
      title: "Create OpenLoops Workflow",
      description: "Validate and persist a workflow spec object.",
      inputSchema: {
        workflow: workflowSpecSchema,
        name: z.string().min(1).optional(),
      },
      annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ workflow, name }) => {
      const body = workflowBodyFromJson(workflow, name);
      return jsonResult({ workflow: publicWorkflow(store.createWorkflow(body)) });
    },
  );

  registerTool<ListWorkflowsArgs>(
    server,
    "openloops_list_workflows",
    {
      title: "List OpenLoops Workflows",
      description: "List stored workflow specs.",
      inputSchema: {
        status: z.enum(["active", "archived"]).optional(),
        limit: positiveIntSchema.optional(),
        cursor: nonNegativeIntSchema.optional(),
        verbose: z.boolean().optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ status, limit, cursor, verbose }) => {
      const resolvedLimit = boundedLimit(limit, 50);
      const resolvedCursor = boundedCursor(cursor);
      const workflows = store.listWorkflows({ status, limit: resolvedCursor + resolvedLimit + 1 });
      const { page, nextCursor, hasMore } = pageItems(workflows, resolvedCursor, resolvedLimit);
      return jsonResult({
        workflows: page.map((workflow) => (verbose ? publicWorkflow(workflow) : compactWorkflow(workflow))),
        nextCursor,
        hasMore,
      });
    },
  );

  registerTool<WorkflowIdArgs>(
    server,
    "openloops_get_workflow",
    {
      title: "Get OpenLoops Workflow",
      description: "Read a workflow spec by id or active name.",
      inputSchema: { idOrName: z.string().min(1) },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ idOrName }) => jsonResult({ workflow: publicWorkflow(store.requireWorkflow(idOrName)) }),
  );

  registerTool<RunWorkflowArgs>(
    server,
    "openloops_run_workflow",
    {
      title: "Run OpenLoops Workflow",
      description: "Run a stored workflow immediately.",
      inputSchema: {
        idOrName: z.string().min(1),
        showOutput: z.boolean().optional(),
        maxOutputChars: positiveIntSchema.optional(),
        verbose: z.boolean().optional(),
      },
      annotations: { destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    async ({ idOrName, showOutput, maxOutputChars, verbose }) => {
      const workflow = store.requireWorkflow(idOrName);
      const result = await executeWorkflow(store, workflow);
      const run = store.listWorkflowRuns({ workflowId: workflow.id, limit: 1 })[0];
      const steps = run ? store.listWorkflowStepRuns(run.id) : [];
      const publicResult = publicExecutorResult(result, Boolean(showOutput));
      if (showOutput) {
        const outputLimit = boundedOutputChars(maxOutputChars);
        publicResult.stdout = truncateText(publicResult.stdout, outputLimit);
        publicResult.stderr = truncateText(publicResult.stderr, outputLimit);
      }
      return jsonResult({
        result: publicResult,
        workflowRun: run ? (verbose ? publicWorkflowRun(run) : compactWorkflowRun(run)) : undefined,
        steps: steps.map((step) => (showOutput || verbose ? boundWorkflowStepRun(step, showOutput, maxOutputChars) : compactWorkflowStepRun(step))),
      });
    },
  );

  registerTool<ListWorkflowRunsArgs>(
    server,
    "openloops_list_workflow_runs",
    {
      title: "List OpenLoops Workflow Runs",
      description: "List workflow runs by workflow id/name, loop run id, status, and limit.",
      inputSchema: {
        idOrName: z.string().min(1).optional(),
        loopRunId: z.string().min(1).optional(),
        status: z.enum(["running", "succeeded", "failed", "timed_out", "cancelled"]).optional(),
        limit: positiveIntSchema.optional(),
        cursor: nonNegativeIntSchema.optional(),
        verbose: z.boolean().optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ idOrName, loopRunId, status, limit, cursor, verbose }) => {
      const workflow = idOrName ? store.requireWorkflow(idOrName) : undefined;
      const resolvedLimit = boundedLimit(limit, 50);
      const resolvedCursor = boundedCursor(cursor);
      const runs = store.listWorkflowRuns({
        workflowId: workflow?.id,
        loopRunId,
        status: workflowRunStatus(status),
        limit: resolvedCursor + resolvedLimit + 1,
      });
      const { page, nextCursor, hasMore } = pageItems(runs, resolvedCursor, resolvedLimit);
      return jsonResult({
        workflowRuns: page.map((run) => (verbose ? publicWorkflowRun(run) : compactWorkflowRun(run))),
        nextCursor,
        hasMore,
      });
    },
  );

  registerTool<InspectWorkflowRunArgs>(
    server,
    "openloops_inspect_workflow_run",
    {
      title: "Inspect OpenLoops Workflow Run",
      description: "Read a workflow run with step runs and events.",
      inputSchema: {
        runId: z.string().min(1),
        showOutput: z.boolean().optional(),
        maxOutputChars: positiveIntSchema.optional(),
        stepsLimit: positiveIntSchema.optional(),
        eventsLimit: positiveIntSchema.optional(),
        verbose: z.boolean().optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ runId, showOutput, maxOutputChars, stepsLimit, eventsLimit, verbose }) => {
      const run = store.requireWorkflowRun(runId);
      const allSteps = store.listWorkflowStepRuns(run.id);
      const limitedSteps = allSteps.slice(0, boundedLimit(stepsLimit, DEFAULT_CHILD_LIMIT));
      return jsonResult({
        workflowRun: verbose ? publicWorkflowRun(run) : compactWorkflowRun(run),
        steps: limitedSteps.map((step) => (showOutput || verbose ? boundWorkflowStepRun(step, showOutput, maxOutputChars) : compactWorkflowStepRun(step))),
        stepsTotal: allSteps.length,
        stepsTruncated: allSteps.length > limitedSteps.length,
        events: store.listWorkflowEvents(run.id, boundedLimit(eventsLimit, DEFAULT_RECENT_LIMIT)).map((event) => (verbose ? publicWorkflowEvent(event) : compactWorkflowEvent(event))),
      });
    },
  );

  registerTool<WorkflowEventsArgs>(
    server,
    "openloops_list_workflow_events",
    {
      title: "List OpenLoops Workflow Events",
      description: "List bounded workflow events for a workflow run.",
      inputSchema: {
        runId: z.string().min(1),
        limit: positiveIntSchema.optional(),
        cursor: nonNegativeIntSchema.optional(),
        verbose: z.boolean().optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ runId, limit, cursor, verbose }) => {
      const resolvedLimit = boundedLimit(limit, 100);
      const resolvedCursor = boundedCursor(cursor);
      const events = store.listWorkflowEvents(runId, resolvedCursor + resolvedLimit + 1);
      const { page, nextCursor, hasMore } = pageItems(events, resolvedCursor, resolvedLimit);
      return jsonResult({
        events: page.map((event) => (verbose ? publicWorkflowEvent(event) : compactWorkflowEvent(event))),
        nextCursor,
        hasMore,
      });
    },
  );

  registerTool<WorkflowReasonArgs>(
    server,
    "openloops_cancel_workflow_run",
    {
      title: "Cancel OpenLoops Workflow Run",
      description: "Cancel a running workflow run and pending/running steps.",
      inputSchema: {
        runId: z.string().min(1),
        reason: z.string().min(1).optional(),
      },
      annotations: { destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ runId, reason }) => jsonResult({ workflowRun: publicWorkflowRun(store.cancelWorkflowRun(runId, reason ?? "cancelled by MCP")) }),
  );

  registerTool<WorkflowReasonArgs>(
    server,
    "openloops_recover_workflow_run",
    {
      title: "Recover OpenLoops Workflow Run",
      description: "Reset interrupted running workflow steps to pending when their processes are not alive.",
      inputSchema: {
        runId: z.string().min(1),
        reason: z.string().min(1).optional(),
      },
      annotations: { destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    async ({ runId, reason }) => {
      const result = store.recoverWorkflowRun(runId, reason ?? "manual MCP recovery");
      return jsonResult({
        workflowRun: publicWorkflowRun(result.run),
        recoveredSteps: result.recoveredSteps.map((step) => boundWorkflowStepRun(step, false, undefined)),
      });
    },
  );

  registerTool<WorkflowIdArgs>(
    server,
    "openloops_archive_workflow",
    {
      title: "Archive OpenLoops Workflow",
      description: "Archive an active workflow spec by id or name.",
      inputSchema: { idOrName: z.string().min(1) },
      annotations: { destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ idOrName }) => jsonResult({ workflow: publicWorkflow(store.archiveWorkflow(idOrName)) }),
  );

  registerTool<GoalArgs>(
    server,
    "openloops_get_goal",
    {
      title: "Get OpenLoops Goal",
      description: "Read runtime goal state by goal id, loop id/name, workflow goal config, or loop goal config.",
      inputSchema: {
        idOrName: z.string().min(1),
        limit: positiveIntSchema.optional(),
        nodesLimit: positiveIntSchema.optional(),
        verbose: z.boolean().optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ idOrName, limit, nodesLimit, verbose }) => {
      const runtimeGoal = store.getGoal(idOrName) ?? store.findGoalByLoop(idOrName);
      if (runtimeGoal) {
        const runs = store.listGoalRuns({ goalId: runtimeGoal.goalId, limit: boundedLimit(limit, 50) });
        const nodes = store.listGoalPlanNodes(runtimeGoal.goalId);
        const limitedNodes = nodes.slice(0, boundedLimit(nodesLimit, DEFAULT_CHILD_LIMIT));
        return jsonResult({
          goal: verbose ? publicGoal(runtimeGoal) : compactGoal(runtimeGoal),
          nodes: limitedNodes.map((node) => (verbose ? node : compactGoalPlanNode(node))),
          nodesTotal: nodes.length,
          nodesTruncated: nodes.length > limitedNodes.length,
          runs: runs.map((run) => (verbose ? publicGoalRun(run) : compactGoalRun(run))),
        });
      }
      const loop = store.getLoop(idOrName) ?? store.findLoopByName(idOrName);
      if (loop?.goal) return jsonResult({ config: loop.goal, loop: publicLoop(loop) });
      const workflow = store.getWorkflow(idOrName) ?? store.findWorkflowByName(idOrName);
      if (workflow?.goal) return jsonResult({ config: workflow.goal, workflow: publicWorkflow(workflow) });
      throw new Error(`goal not found: ${idOrName}`);
    },
  );

  registerTool<GoalStatusArgs>(
    server,
    "openloops_get_goal_status",
    {
      title: "Get OpenLoops Goal Status",
      description: "Read goal status by goal run id, loop run id, workflow run id, workflow step id, or goal id.",
      inputSchema: {
        runId: z.string().min(1),
        limit: positiveIntSchema.optional(),
        nodesLimit: positiveIntSchema.optional(),
        verbose: z.boolean().optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ runId, limit, nodesLimit, verbose }) => {
      const runtimeGoal = store.findGoalByRunId(runId);
      if (!runtimeGoal) throw new Error(`goal run not found: ${runId}`);
      const runs = store.listGoalRuns({ goalId: runtimeGoal.goalId, limit: boundedLimit(limit, 50) });
      const nodes = store.listGoalPlanNodes(runtimeGoal.goalId);
      const limitedNodes = nodes.slice(0, boundedLimit(nodesLimit, DEFAULT_CHILD_LIMIT));
      return jsonResult({
        goal: verbose ? publicGoal(runtimeGoal) : compactGoal(runtimeGoal),
        nodes: limitedNodes.map((node) => (verbose ? node : compactGoalPlanNode(node))),
        nodesTotal: nodes.length,
        nodesTruncated: nodes.length > limitedNodes.length,
        runs: runs.map((run) => (verbose ? publicGoalRun(run) : compactGoalRun(run))),
      });
    },
  );

  registerTool<ListMachinesArgs>(
    server,
    "openloops_list_machines",
    {
      title: "List OpenLoops Machines",
      description: "List known OpenMachines topology entries for loop assignment.",
      inputSchema: {
        limit: positiveIntSchema.optional(),
        cursor: nonNegativeIntSchema.optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ limit, cursor }) => {
      const resolvedLimit = boundedLimit(limit, 50);
      const resolvedCursor = boundedCursor(cursor);
      const { page, nextCursor, hasMore } = pageItems(listOpenMachines(), resolvedCursor, resolvedLimit);
      return jsonResult({ machines: page, nextCursor, hasMore });
    },
  );

  registerTool<MachineIdArgs>(
    server,
    "openloops_resolve_machine",
    {
      title: "Resolve OpenLoops Machine",
      description: "Resolve an OpenMachines id or alias into a loop machine assignment reference.",
      inputSchema: { id: z.string().min(1) },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ id }) => jsonResult({ machine: resolveLoopMachine(id) }),
  );

  registerTool<Record<string, never>>(
    server,
    "openloops_tick",
    {
      title: "Run OpenLoops Scheduler Tick",
      description: "Run one scheduler tick, claiming and executing due loops.",
      inputSchema: {},
      annotations: { destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    async () => {
      const result = await tick({ store, runnerId: opts.runnerId ?? `mcp-tick:${process.pid}` });
      return jsonResult({
        claimed: result.claimed.map(compactRun),
        completed: result.completed.map(compactRun),
        skipped: result.skipped.map(compactRun),
        recovered: result.recovered.map(compactRun),
        expired: result.expired.map(compactLoop),
      });
    },
  );

  registerTool<Record<string, never>>(
    server,
    "openloops_daemon_status",
    {
      title: "OpenLoops Daemon Status",
      description: "Read local OpenLoops daemon process, lease, loop, and run counts.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => jsonResult({ status: daemonStatus(store) }),
  );

  registerTool<Record<string, never>>(
    server,
    "openloops_doctor",
    {
      title: "OpenLoops Doctor",
      description: "Run OpenLoops health checks for local dependencies, daemon state, and active loop preflight.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async () => jsonResult({ report: runDoctor(store) }),
  );

  return server;
}
