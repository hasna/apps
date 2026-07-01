#!/usr/bin/env bun
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod/v3";
import { runDoctor } from "../lib/doctor.js";
import {
  publicLoop,
  publicRun,
  publicWorkflow,
  publicWorkflowEvent,
  publicWorkflowRun,
  publicWorkflowStepRun,
} from "../lib/format.js";
import { nowIso } from "../lib/ids.js";
import { dataDir } from "../lib/paths.js";
import { Store } from "../lib/store.js";
import { packageVersion } from "../lib/version.js";
import { preflightWorkflow } from "../lib/workflow-runner.js";
import { workflowBodyFromJson } from "../lib/workflow-spec.js";
import type {
  CatchUpPolicy,
  CreateLoopInput,
  LoopStatus,
  LoopTarget,
  OverlapPolicy,
  RunStatus,
  ScheduleSpec,
  TimeoutMs,
  WorkflowSpec,
} from "../types.js";

const LOOP_STATUSES = ["active", "paused", "stopped", "expired"] as const;
const LOOP_STATUS_FILTERS = [...LOOP_STATUSES, "all"] as const;
const RUN_STATUSES = ["running", "succeeded", "failed", "timed_out", "abandoned", "skipped"] as const;
const WORKFLOW_STATUSES = ["active", "archived"] as const;
const WORKFLOW_STATUS_FILTERS = [...WORKFLOW_STATUSES, "all"] as const;
const CATCH_UP_POLICIES = ["none", "latest", "all"] as const;
const OVERLAP_POLICIES = ["skip", "allow"] as const;
const INTERVAL_ANCHORS = ["fixed_rate", "fixed_delay"] as const;

const MAX_LIMIT = 500;

export interface LoopsMcpToolMetadata {
  name: string;
  description: string;
  readOnly: boolean;
  guarded?: boolean;
  requiresEnv?: string;
}

const MUTATION_ENV = "LOOPS_MCP_ALLOW_MUTATIONS";

export const LOOPS_MCP_TOOLS: LoopsMcpToolMetadata[] = [
  { name: "loops_list", description: "List local OpenLoops loops.", readOnly: true },
  { name: "loops_show", description: "Show a loop by id or name, optionally including its latest run.", readOnly: true },
  { name: "loop_runs", description: "List loop runs with optional loop/status filtering.", readOnly: true },
  { name: "loops_doctor", description: "Run OpenLoops runtime diagnostics.", readOnly: true },
  { name: "workflows_list", description: "List stored OpenLoops workflow specs.", readOnly: true },
  { name: "workflow_read", description: "Read a workflow, optionally including recent runs, steps, and events.", readOnly: true },
  { name: "workflow_validate", description: "Validate a workflow body with the same parser used by the CLI.", readOnly: true },
  { name: "loop_pause", description: "Pause a loop after explicit confirmation.", readOnly: false, guarded: true, requiresEnv: `${MUTATION_ENV}=true` },
  { name: "loop_resume", description: "Resume a loop after explicit confirmation.", readOnly: false, guarded: true, requiresEnv: `${MUTATION_ENV}=true` },
  { name: "loop_run_now", description: "Schedule a loop for immediate daemon pickup after explicit confirmation.", readOnly: false, guarded: true, requiresEnv: `${MUTATION_ENV}=true` },
  { name: "loop_create_command", description: "Create a deterministic command loop after explicit confirmation.", readOnly: false, guarded: true, requiresEnv: `${MUTATION_ENV}=true` },
  { name: "loop_create_workflow", description: "Create a loop for an existing workflow after explicit confirmation.", readOnly: false, guarded: true, requiresEnv: `${MUTATION_ENV}=true` },
];

const limitSchema = z.number().int().min(1).max(MAX_LIMIT).optional();
const optionalTimeoutSchema = z.number().int().positive().nullable().optional();
const catchUpSchema = z.enum(CATCH_UP_POLICIES).optional();
const overlapSchema = z.enum(OVERLAP_POLICIES).optional();
const scheduleSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("once"),
    at: z.string().describe("Absolute date/time parseable by JavaScript Date."),
  }),
  z.object({
    type: z.literal("interval"),
    everyMs: z.number().int().positive(),
    anchor: z.enum(INTERVAL_ANCHORS).optional(),
  }),
  z.object({
    type: z.literal("cron"),
    expression: z.string().min(1),
  }),
  z.object({
    type: z.literal("dynamic"),
    minIntervalMs: z.number().int().positive().optional(),
  }),
]);

function jsonResult(value: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(value, null, 2),
      },
    ],
  };
}

async function withStore<T>(fn: (store: Store) => T | Promise<T>): Promise<T> {
  const store = new Store();
  try {
    return await fn(store);
  } finally {
    store.close();
  }
}

function confirmed(actual: string | undefined, expected: string): void {
  if (actual !== expected) throw new Error(`confirm must be exactly '${expected}'`);
}

function requireMutationsEnabled(): void {
  const value = String(process.env[MUTATION_ENV] ?? "").trim().toLowerCase();
  if (!["1", "true", "yes", "on"].includes(value)) {
    throw new Error(`MCP mutation tools require ${MUTATION_ENV}=true`);
  }
}

function nonEmpty(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${label} must be non-empty`);
  return trimmed;
}

function normalizeDate(value: string, label: string): string {
  const time = new Date(value);
  if (Number.isNaN(time.getTime())) throw new Error(`${label} must be a valid date/time`);
  return time.toISOString();
}

function normalizeSchedule(input: z.infer<typeof scheduleSchema>): ScheduleSpec {
  if (input.type === "once") return { type: "once", at: normalizeDate(input.at, "schedule.at") };
  if (input.type === "interval") return { type: "interval", everyMs: input.everyMs, anchor: input.anchor ?? "fixed_rate" };
  if (input.type === "cron") return { type: "cron", expression: nonEmpty(input.expression, "schedule.expression") };
  return { type: "dynamic", minIntervalMs: input.minIntervalMs };
}

function durationLabel(ms: number | undefined): string {
  if (!ms || !Number.isFinite(ms)) return "";
  const units: Array<[number, string]> = [
    [7 * 24 * 60 * 60 * 1000, "w"],
    [24 * 60 * 60 * 1000, "d"],
    [60 * 60 * 1000, "h"],
    [60 * 1000, "m"],
    [1_000, "s"],
  ];
  for (const [unitMs, label] of units) {
    if (ms % unitMs === 0) return `${ms / unitMs}${label}`;
  }
  return `${ms}ms`;
}

function scheduleLabel(schedule: ScheduleSpec): string {
  if (schedule.type === "once") return `once:${schedule.at}`;
  if (schedule.type === "interval") return `every:${durationLabel(schedule.everyMs) || `${schedule.everyMs}ms`}`;
  if (schedule.type === "cron") return `cron:${schedule.expression}`;
  return schedule.minIntervalMs ? `dynamic:min-${durationLabel(schedule.minIntervalMs) || `${schedule.minIntervalMs}ms`}` : "dynamic";
}

function targetLabel(target: LoopTarget): string {
  if (target.type === "command") return `runs command ${target.command}`;
  if (target.type === "agent") return `runs ${target.provider} agent${target.cwd ? ` in ${target.cwd}` : ""}`;
  return `runs workflow ${target.workflowId}`;
}

function defaultLoopDescription(name: string, schedule: ScheduleSpec, target: LoopTarget): string {
  return [
    `Why: keep ${name} running as an OpenLoops scheduled automation.`,
    `How: ${targetLabel(target)} on cadence ${scheduleLabel(schedule)}.`,
    "Outcome: record each run, status, retries, and evidence in OpenLoops for operator review.",
  ].join(" ");
}

function commonCreateInput(input: {
  name: string;
  description?: string;
  schedule: z.infer<typeof scheduleSchema>;
  target: LoopTarget;
  catchUp?: (typeof CATCH_UP_POLICIES)[number];
  catchUpLimit?: number;
  overlap?: (typeof OVERLAP_POLICIES)[number];
  maxAttempts?: number;
  retryDelayMs?: number;
  leaseMs?: number;
  expiresAt?: string;
}): CreateLoopInput {
  const name = nonEmpty(input.name, "name");
  const schedule = normalizeSchedule(input.schedule);
  return {
    name,
    description: input.description?.trim() || defaultLoopDescription(name, schedule, input.target),
    schedule,
    target: input.target,
    catchUp: input.catchUp as CatchUpPolicy | undefined,
    catchUpLimit: input.catchUpLimit,
    overlap: input.overlap as OverlapPolicy | undefined,
    maxAttempts: input.maxAttempts,
    retryDelayMs: input.retryDelayMs,
    leaseMs: input.leaseMs,
    expiresAt: input.expiresAt ? normalizeDate(input.expiresAt, "expiresAt") : undefined,
  };
}

function filteredLoopStatus(status: (typeof LOOP_STATUS_FILTERS)[number] | undefined): LoopStatus | undefined {
  return status && status !== "all" ? status : undefined;
}

function filteredWorkflowStatus(status: (typeof WORKFLOW_STATUS_FILTERS)[number] | undefined): WorkflowSpec["status"] | undefined {
  return status && status !== "all" ? status : undefined;
}

function validationWorkflow(input: ReturnType<typeof workflowBodyFromJson>): WorkflowSpec {
  const now = nowIso();
  return {
    id: "mcp-validation",
    name: input.name,
    description: input.description,
    version: input.version ?? 1,
    status: "active",
    goal: input.goal,
    steps: input.steps,
    createdAt: now,
    updatedAt: now,
  };
}

function parseWorkflowInput(input: { workflow?: Record<string, unknown>; workflowJson?: string; name?: string }) {
  if (input.workflowJson && input.workflow) throw new Error("use workflow or workflowJson, not both");
  if (!input.workflowJson && !input.workflow) throw new Error("workflow or workflowJson is required");
  const body = input.workflowJson ? JSON.parse(input.workflowJson) : input.workflow;
  return workflowBodyFromJson(body, input.name, { baseDir: process.cwd() });
}

function registerTool(
  server: McpServer,
  name: string,
  config: { description: string; inputSchema: Record<string, unknown>; annotations?: Record<string, unknown> },
  cb: (input: any) => unknown,
): void {
  (server as { registerTool: (...args: unknown[]) => unknown }).registerTool(name, config, cb);
}

export function createLoopsMcpServer(): McpServer {
  const server = new McpServer({
    name: "open-loops",
    version: packageVersion(),
  });

  server.registerResource(
    "open-loops-runtime",
    "loops://runtime",
    {
      title: "OpenLoops Runtime",
      description: "Current OpenLoops package version and data directory.",
      mimeType: "application/json",
    },
    async () => ({
      contents: [
        {
          uri: "loops://runtime",
          mimeType: "application/json",
          text: JSON.stringify({ packageVersion: packageVersion(), dataDir: dataDir() }, null, 2),
        },
      ],
    }),
  );

  server.registerResource(
    "open-loops-tools",
    "loops://tools",
    {
      title: "OpenLoops MCP Tools",
      description: "Static metadata for the OpenLoops MCP tool surface.",
      mimeType: "application/json",
    },
    async () => ({
      contents: [
        {
          uri: "loops://tools",
          mimeType: "application/json",
          text: JSON.stringify(LOOPS_MCP_TOOLS, null, 2),
        },
      ],
    }),
  );

  registerTool(
    server,
    "loops_list",
    {
      description: "List local OpenLoops loops.",
      inputSchema: {
        status: z.enum(LOOP_STATUS_FILTERS).optional(),
        limit: limitSchema,
        includeArchived: z.boolean().optional(),
        archivedOnly: z.boolean().optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ status, limit, includeArchived, archivedOnly }) =>
      jsonResult(
        await withStore((store) => ({
          loops: store
            .listLoops({
              status: filteredLoopStatus(status),
              limit,
              includeArchived: includeArchived ?? false,
              archived: archivedOnly ?? false,
            })
            .map(publicLoop),
        })),
      ),
  );

  registerTool(
    server,
    "loops_show",
    {
      description: "Show a loop by id or name, optionally including its latest run.",
      inputSchema: {
        idOrName: z.string().min(1),
        includeLatestRun: z.boolean().optional(),
        showOutput: z.boolean().optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ idOrName, includeLatestRun, showOutput }) =>
      jsonResult(
        await withStore((store) => {
          const loop = store.requireLoop(idOrName);
          const latestRun = includeLatestRun ? store.listRuns({ loopId: loop.id, limit: 1 })[0] : undefined;
          return {
            loop: publicLoop(loop),
            latestRun: latestRun ? publicRun(latestRun, showOutput ?? false) : undefined,
          };
        }),
      ),
  );

  registerTool(
    server,
    "loop_runs",
    {
      description: "List loop runs with optional loop/status filtering.",
      inputSchema: {
        idOrName: z.string().min(1).optional(),
        status: z.enum(RUN_STATUSES).optional(),
        limit: limitSchema,
        showOutput: z.boolean().optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ idOrName, status, limit, showOutput }) =>
      jsonResult(
        await withStore((store) => {
          const loop = idOrName ? store.requireLoop(idOrName) : undefined;
          const runs = store
            .listRuns({
              loopId: loop?.id,
              status: status as RunStatus | undefined,
              limit,
            })
            .map((run) => publicRun(run, showOutput ?? false));
          return { loop: loop ? publicLoop(loop) : undefined, runs };
        }),
      ),
  );

  registerTool(
    server,
    "loops_doctor",
    {
      description: "Run OpenLoops runtime diagnostics.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => jsonResult(await withStore((store) => runDoctor(store))),
  );

  registerTool(
    server,
    "workflows_list",
    {
      description: "List stored OpenLoops workflow specs.",
      inputSchema: {
        status: z.enum(WORKFLOW_STATUS_FILTERS).optional(),
        limit: limitSchema,
        offset: z.number().int().min(0).optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ status, limit, offset }) =>
      jsonResult(
        await withStore((store) => ({
          workflows: store
            .listWorkflows({
              status: filteredWorkflowStatus(status),
              limit,
              offset,
            })
            .map(publicWorkflow),
        })),
      ),
  );

  registerTool(
    server,
    "workflow_read",
    {
      description: "Read a workflow, optionally including recent runs, steps, and events.",
      inputSchema: {
        idOrName: z.string().min(1),
        includeRuns: z.boolean().optional(),
        includeEvents: z.boolean().optional(),
        runLimit: limitSchema,
        showOutput: z.boolean().optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ idOrName, includeRuns, includeEvents, runLimit, showOutput }) =>
      jsonResult(
        await withStore((store) => {
          const workflow = store.requireWorkflow(idOrName);
          const runs = includeRuns ? store.listWorkflowRuns({ workflowId: workflow.id, limit: runLimit ?? 20 }) : [];
          return {
            workflow: publicWorkflow(workflow),
            runs: runs.map((run) => ({
              ...publicWorkflowRun(run),
              steps: store.listWorkflowStepRuns(run.id).map((step) => publicWorkflowStepRun(step, showOutput ?? false)),
              events: includeEvents ? store.listWorkflowEvents(run.id).map(publicWorkflowEvent) : undefined,
            })),
          };
        }),
      ),
  );

  registerTool(
    server,
    "workflow_validate",
    {
      description: "Validate a workflow body with the same parser used by the CLI.",
      inputSchema: {
        workflow: z.record(z.string(), z.unknown()).optional(),
        workflowJson: z.string().optional(),
        name: z.string().min(1).optional(),
        preflight: z.boolean().optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (input) =>
      jsonResult({
        valid: true,
        workflow: publicWorkflow(validationWorkflow(parseWorkflowInput(input))),
        preflight: input.preflight ? preflightWorkflow(validationWorkflow(parseWorkflowInput(input))) : undefined,
      }),
  );

  registerTool(
    server,
    "loop_pause",
    {
      description: "Pause a loop after explicit confirmation.",
      inputSchema: {
        idOrName: z.string().min(1),
        confirm: z.literal("pause-loop"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ idOrName, confirm }) => {
      requireMutationsEnabled();
      confirmed(confirm, "pause-loop");
      return jsonResult(await withStore((store) => ({ loop: publicLoop(store.updateLoop(store.requireLoop(idOrName).id, { status: "paused" })) })));
    },
  );

  registerTool(
    server,
    "loop_resume",
    {
      description: "Resume a loop after explicit confirmation.",
      inputSchema: {
        idOrName: z.string().min(1),
        confirm: z.literal("resume-loop"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ idOrName, confirm }) => {
      requireMutationsEnabled();
      confirmed(confirm, "resume-loop");
      return jsonResult(await withStore((store) => ({ loop: publicLoop(store.updateLoop(store.requireLoop(idOrName).id, { status: "active" })) })));
    },
  );

  registerTool(
    server,
    "loop_run_now",
    {
      description: "Schedule a loop for immediate daemon pickup after explicit confirmation. Inline execution remains CLI-only.",
      inputSchema: {
        idOrName: z.string().min(1),
        confirm: z.literal("run-now"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ idOrName, confirm }) => {
      requireMutationsEnabled();
      confirmed(confirm, "run-now");
      return jsonResult(
        await withStore((store) => {
          const loop = store.requireLoop(idOrName);
          if (loop.archivedAt) throw new Error(`loop is archived; unarchive it before running: ${idOrName}`);
          const scheduledFor = nowIso();
          const updated = store.updateLoop(loop.id, { status: "active", nextRunAt: scheduledFor });
          return { scheduledFor, loop: publicLoop(updated) };
        }),
      );
    },
  );

  registerTool(
    server,
    "loop_create_command",
    {
      description: "Create a deterministic command loop after explicit confirmation.",
      inputSchema: {
        name: z.string().min(1),
        description: z.string().optional(),
        command: z.string().min(1),
        args: z.array(z.string()).optional(),
        cwd: z.string().optional(),
        shell: z.boolean().optional(),
        timeoutMs: optionalTimeoutSchema,
        schedule: scheduleSchema,
        catchUp: catchUpSchema,
        catchUpLimit: z.number().int().positive().optional(),
        overlap: overlapSchema,
        maxAttempts: z.number().int().positive().optional(),
        retryDelayMs: z.number().int().positive().optional(),
        leaseMs: z.number().int().positive().optional(),
        expiresAt: z.string().optional(),
        confirm: z.literal("create-command-loop"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async (input) => {
      requireMutationsEnabled();
      confirmed(input.confirm, "create-command-loop");
      return jsonResult(
        await withStore((store) => {
          const timeoutMs = input.timeoutMs as TimeoutMs | undefined;
          const loop = store.createLoop(
            commonCreateInput({
              ...input,
              target: {
                type: "command",
                command: nonEmpty(input.command, "command"),
                args: input.args,
                cwd: input.cwd,
                shell: input.shell ?? false,
                timeoutMs,
              },
            }),
          );
          return { loop: publicLoop(loop) };
        }),
      );
    },
  );

  registerTool(
    server,
    "loop_create_workflow",
    {
      description: "Create a loop for an existing workflow after explicit confirmation.",
      inputSchema: {
        name: z.string().min(1),
        description: z.string().optional(),
        workflow: z.string().min(1),
        workflowInput: z.record(z.string(), z.string()).optional(),
        timeoutMs: optionalTimeoutSchema,
        schedule: scheduleSchema,
        catchUp: catchUpSchema,
        catchUpLimit: z.number().int().positive().optional(),
        overlap: overlapSchema,
        maxAttempts: z.number().int().positive().optional(),
        retryDelayMs: z.number().int().positive().optional(),
        leaseMs: z.number().int().positive().optional(),
        expiresAt: z.string().optional(),
        confirm: z.literal("create-workflow-loop"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async (input) => {
      requireMutationsEnabled();
      confirmed(input.confirm, "create-workflow-loop");
      return jsonResult(
        await withStore((store) => {
          const workflow = store.requireWorkflow(input.workflow);
          const timeoutMs = input.timeoutMs as TimeoutMs | undefined;
          const loop = store.createLoop(
            commonCreateInput({
              ...input,
              target: {
                type: "workflow",
                workflowId: workflow.id,
                input: input.workflowInput,
                timeoutMs,
              },
            }),
          );
          return { workflow: publicWorkflow(workflow), loop: publicLoop(loop) };
        }),
      );
    },
  );

  return server;
}

export function listToolsForCli(): LoopsMcpToolMetadata[] {
  return LOOPS_MCP_TOOLS;
}

async function main(): Promise<void> {
  if (process.argv[2] === "list-tools") {
    console.log(JSON.stringify(listToolsForCli(), null, 2));
    return;
  }
  const server = createLoopsMcpServer();
  await server.connect(new StdioServerTransport());
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
