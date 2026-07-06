#!/usr/bin/env bun
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod/v3";
import { daemonStatus } from "../daemon/control.js";
import { runDoctor } from "../lib/doctor.js";
import { CodedError } from "../lib/errors.js";
import {
  publicLoop,
  publicRun,
  publicWorkflow,
  publicWorkflowEvent,
  publicWorkflowRun,
  publicWorkflowStepRun,
} from "../lib/format.js";
import { buildHealthReport, buildHealthScan, classifyRunFailure, expectationForLoop } from "../lib/health.js";
import { nowIso } from "../lib/ids.js";
import { dataDir } from "../lib/paths.js";
import { computeNextAfter } from "../lib/recurrence.js";
import { runLoopNow } from "../lib/scheduler.js";
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

const MUTATION_ENV = "LOOPS_MCP_ALLOW_MUTATIONS";

const loopIdOrNameSchema = z
  .string()
  .min(1)
  .describe("Loop id or exact loop name. Names resolve on exact match only; ambiguous names require the id.");
const workflowIdOrNameSchema = z.string().min(1).describe("Workflow id or exact workflow name.");
const showOutputSchema = z
  .boolean()
  .optional()
  .describe("Include scrubbed stdout/stderr (default false: only redacted lengths are returned).");
const limitSchema = z.number().int().min(1).max(MAX_LIMIT).optional().describe(`Maximum entries to return (1-${MAX_LIMIT}).`);
const optionalTimeoutSchema = z
  .number()
  .int()
  .positive()
  .nullable()
  .optional()
  .describe("Per-run timeout in milliseconds; null disables the timeout.");
const catchUpSchema = z
  .enum(CATCH_UP_POLICIES)
  .optional()
  .describe("Missed-slot policy after downtime: none skips them, latest replays the newest slot, all replays every slot.");
const overlapSchema = z
  .enum(OVERLAP_POLICIES)
  .optional()
  .describe("Behavior when a slot comes due while a previous run is active: skip records a skipped run, allow runs concurrently.");
const scheduleSchema = z
  .discriminatedUnion("type", [
    z.object({
      type: z.literal("once"),
      at: z.string().describe("Absolute date/time parseable by JavaScript Date (ISO 8601 recommended)."),
    }),
    z.object({
      type: z.literal("interval"),
      everyMs: z.number().int().positive().describe("Interval between runs in milliseconds."),
      anchor: z
        .enum(INTERVAL_ANCHORS)
        .optional()
        .describe("fixed_rate anchors slots to the original cadence; fixed_delay measures from the previous finish."),
    }),
    z.object({
      type: z.literal("cron"),
      expression: z.string().min(1).describe("5-field cron expression evaluated in local time."),
    }),
    z.object({
      type: z.literal("dynamic"),
      minIntervalMs: z.number().int().positive().optional().describe("Minimum spacing between runs in milliseconds."),
    }),
  ])
  .describe("When the loop runs.");

const createLoopCommonSchema = {
  name: z.string().min(1).describe("Unique loop name."),
  description: z.string().optional().describe("Why/how/outcome description; a default is generated when omitted."),
  schedule: scheduleSchema,
  timeoutMs: optionalTimeoutSchema,
  catchUp: catchUpSchema,
  catchUpLimit: z.number().int().positive().optional().describe("Maximum missed slots replayed when catching up."),
  overlap: overlapSchema,
  maxAttempts: z.number().int().positive().optional().describe("Attempts per slot before a failed run is final (default 1)."),
  retryDelayMs: z.number().int().positive().optional().describe("Base retry delay in milliseconds (exponential backoff with jitter)."),
  leaseMs: z.number().int().positive().optional().describe("Run lease in milliseconds before an unresponsive runner is considered dead."),
  expiresAt: z.string().optional().describe("Date/time after which the loop expires and stops scheduling."),
};

export interface LoopsMcpToolMetadata {
  name: string;
  /** legacy tool names kept as deprecated alias registrations */
  aliases?: string[];
  description: string;
  readOnly: boolean;
  guarded?: boolean;
  requiresEnv?: string;
}

interface LoopsMcpToolRegistration {
  /** canonical loops_* tool name */
  name: string;
  /** legacy names, registered as deprecated aliases of the canonical tool */
  aliases?: string[];
  description: string;
  readOnly: boolean;
  /** mutation tools additionally require LOOPS_MCP_ALLOW_MUTATIONS=true on the server process */
  guarded?: boolean;
  annotations: Record<string, unknown>;
  inputSchema: Record<string, unknown>;
  handler: (input: any) => unknown;
}

const READ_ONLY_ANNOTATIONS = { readOnlyHint: true, openWorldHint: false } as const;

/** Preflight spawns one or more subprocesses per step synchronously; bound the fan-out. */
const MAX_PREFLIGHT_STEPS = 25;

function mutationAnnotations(opts: { destructive?: boolean; idempotent?: boolean } = {}): Record<string, unknown> {
  return {
    readOnlyHint: false,
    destructiveHint: opts.destructive ?? false,
    idempotentHint: opts.idempotent ?? false,
    openWorldHint: false,
  };
}

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

function errorResult(error: unknown) {
  // Surface coded store errors (LOOP_NOT_FOUND, LOOP_ARCHIVED, ...) as
  // structured payloads so MCP clients can branch without parsing prose.
  const message = error instanceof Error ? error.message : String(error);
  const code = error instanceof CodedError ? error.code : "ERROR";
  return {
    isError: true as const,
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({ error: { code, message } }, null, 2),
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

// Mutation gate: the old confirm:z.literal("...") parameters were removed on
// purpose. Zod validated the literal before the handler ran and LLM clients
// auto-fill required literal params, so they confirmed nothing. The real
// control is this server-side env opt-in plus honest tool annotations.
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

/**
 * Single source of truth for the MCP tool surface: registrations, the
 * loops://tools resource, the loops-mcp bin's `list-tools` argv, and the golden
 * schema test all derive from this array, so metadata cannot drift from behavior.
 */
const TOOL_REGISTRATIONS: LoopsMcpToolRegistration[] = [
  {
    name: "loops_list",
    description: "List local OpenLoops loops.",
    readOnly: true,
    annotations: READ_ONLY_ANNOTATIONS,
    inputSchema: {
      status: z.enum(LOOP_STATUS_FILTERS).optional().describe("Filter by loop status; 'all' disables the filter."),
      limit: limitSchema,
      includeArchived: z.boolean().optional().describe("Include archived loops alongside live ones (default false)."),
      archivedOnly: z.boolean().optional().describe("Return only archived loops (default false)."),
    },
    handler: ({ status, limit, includeArchived, archivedOnly }) =>
      withStore((store) => ({
        loops: store
          .listLoops({
            status: filteredLoopStatus(status),
            limit,
            includeArchived: includeArchived ?? false,
            archived: archivedOnly ?? false,
          })
          .map(publicLoop),
      })),
  },
  {
    name: "loops_show",
    description: "Show a loop by id or name, optionally including its latest run.",
    readOnly: true,
    annotations: READ_ONLY_ANNOTATIONS,
    inputSchema: {
      idOrName: loopIdOrNameSchema,
      includeLatestRun: z.boolean().optional().describe("Include the most recent run record (default false)."),
      showOutput: showOutputSchema,
    },
    handler: ({ idOrName, includeLatestRun, showOutput }) =>
      withStore((store) => {
        const loop = store.requireLoop(idOrName);
        const latestRun = includeLatestRun ? store.listRuns({ loopId: loop.id, limit: 1 })[0] : undefined;
        return {
          loop: publicLoop(loop),
          latestRun: latestRun ? publicRun(latestRun, showOutput ?? false) : undefined,
        };
      }),
  },
  {
    name: "loops_runs",
    aliases: ["loop_runs"],
    description: "List loop runs with optional loop/status filtering.",
    readOnly: true,
    annotations: READ_ONLY_ANNOTATIONS,
    inputSchema: {
      idOrName: loopIdOrNameSchema.optional(),
      status: z.enum(RUN_STATUSES).optional().describe("Filter by run status."),
      limit: limitSchema,
      showOutput: showOutputSchema,
    },
    handler: ({ idOrName, status, limit, showOutput }) =>
      withStore((store) => {
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
  },
  {
    name: "loops_doctor",
    description: "Run OpenLoops runtime diagnostics.",
    readOnly: true,
    annotations: READ_ONLY_ANNOTATIONS,
    inputSchema: {},
    handler: () => withStore((store) => runDoctor(store)),
  },
  {
    name: "loops_health",
    description: "Build the OpenLoops health report: per-loop expectations, failure classifications, and recommended follow-up tasks.",
    readOnly: true,
    annotations: READ_ONLY_ANNOTATIONS,
    inputSchema: {
      includeArchived: z.boolean().optional().describe("Include archived loops in the report (default false)."),
      includeInactive: z.boolean().optional().describe("Include stopped/expired loops (default false: active and paused only)."),
      limit: limitSchema,
    },
    handler: ({ includeArchived, includeInactive, limit }) =>
      withStore((store) => buildHealthReport(store, { includeArchived, includeInactive, limit })),
  },
  {
    name: "loops_health_scan",
    description: "Build a read-only OpenLoops health scan with bounded daemon, doctor/preflight, latest-run, and stale-running findings.",
    readOnly: true,
    annotations: READ_ONLY_ANNOTATIONS,
    inputSchema: {
      includeStatuses: z.array(z.enum(LOOP_STATUSES)).optional().describe("Loop statuses to inventory (default active and paused)."),
      includeArchived: z.boolean().optional().describe("Include archived loops in the scan (default false)."),
      latestRun: z.boolean().optional().describe("Include latest-run and stale-running checks (default true)."),
      doctor: z.boolean().optional().describe("Include doctor/preflight checks (default false)."),
      daemon: z.boolean().optional().describe("Include daemon status checks (default false)."),
      staleRunningMs: z.number().int().positive().optional().describe("Minimum age before a running latest run is stale; loop lease and 10m still apply."),
      maxFindings: z.number().int().min(0).max(MAX_LIMIT).optional().describe(`Maximum findings to return (0-${MAX_LIMIT}, default 100).`),
      limit: limitSchema,
    },
    handler: ({ includeStatuses, includeArchived, latestRun, doctor, daemon, staleRunningMs, maxFindings, limit }) =>
      withStore((store) => buildHealthScan(store, {
        includeStatuses: includeStatuses as LoopStatus[] | undefined,
        includeArchived,
        latestRun,
        doctor: doctor ? runDoctor(store) : undefined,
        daemon: daemon ? daemonStatus(store) : undefined,
        staleRunningMs,
        maxFindings,
        limit,
      })),
  },
  {
    name: "loops_diagnose",
    aliases: ["loop_diagnose"],
    description: "Diagnose one loop: health expectation plus recent runs with classified failure evidence (rate_limit, auth, timeout, ...).",
    readOnly: true,
    annotations: READ_ONLY_ANNOTATIONS,
    inputSchema: {
      idOrName: loopIdOrNameSchema,
      runLimit: z.number().int().min(1).max(50).optional().describe("How many recent runs to classify (1-50, default 5)."),
      showOutput: showOutputSchema,
    },
    handler: ({ idOrName, runLimit, showOutput }) =>
      withStore((store) => {
        const loop = store.requireLoop(idOrName);
        const runs = store.listRuns({ loopId: loop.id, limit: runLimit ?? 5 });
        return {
          loop: publicLoop(loop),
          expectation: expectationForLoop(store, loop),
          recentRuns: runs.map((run) => ({
            run: publicRun(run, showOutput ?? false),
            failure: classifyRunFailure(run),
          })),
        };
      }),
  },
  {
    name: "loops_daemon_status",
    aliases: ["daemon_status"],
    description: "Report loops daemon liveness (pidfile + lease) and loop/run counters. Read-only.",
    readOnly: true,
    annotations: READ_ONLY_ANNOTATIONS,
    inputSchema: {},
    handler: () => withStore((store) => daemonStatus(store)),
  },
  {
    name: "loops_workflows_list",
    aliases: ["workflows_list"],
    description: "List stored OpenLoops workflow specs.",
    readOnly: true,
    annotations: READ_ONLY_ANNOTATIONS,
    inputSchema: {
      status: z.enum(WORKFLOW_STATUS_FILTERS).optional().describe("Filter by workflow status; 'all' disables the filter."),
      limit: limitSchema,
      offset: z.number().int().min(0).optional().describe("Entries to skip before returning results (pagination)."),
    },
    handler: ({ status, limit, offset }) =>
      withStore((store) => ({
        workflows: store
          .listWorkflows({
            status: filteredWorkflowStatus(status),
            limit,
            offset,
          })
          .map(publicWorkflow),
      })),
  },
  {
    name: "loops_workflow_read",
    aliases: ["workflow_read"],
    description: "Read a workflow, optionally including recent runs, steps, and events.",
    readOnly: true,
    annotations: READ_ONLY_ANNOTATIONS,
    inputSchema: {
      idOrName: workflowIdOrNameSchema,
      includeRuns: z.boolean().optional().describe("Include recent workflow runs with their step runs (default false)."),
      includeEvents: z.boolean().optional().describe("Include the event log for each returned run (default false)."),
      runLimit: limitSchema,
      showOutput: showOutputSchema,
    },
    handler: ({ idOrName, includeRuns, includeEvents, runLimit, showOutput }) =>
      withStore((store) => {
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
  },
  {
    name: "loops_workflow_validate",
    aliases: ["workflow_validate"],
    description:
      "Validate a workflow body with the same parser used by the CLI. preflight:true additionally spawns local preflight subprocesses and therefore requires LOOPS_MCP_ALLOW_MUTATIONS=true.",
    readOnly: true,
    annotations: READ_ONLY_ANNOTATIONS,
    inputSchema: {
      workflow: z.record(z.string(), z.unknown()).optional().describe("Workflow body as a JSON object (mutually exclusive with workflowJson)."),
      workflowJson: z.string().optional().describe("Workflow body as a JSON string (mutually exclusive with workflow)."),
      name: z.string().min(1).optional().describe("Workflow name override when the body omits one."),
      preflight: z
        .boolean()
        .optional()
        .describe(
          "Also run executable/agent preflight checks for each step (default false). Requires LOOPS_MCP_ALLOW_MUTATIONS=true because preflight resolves account/auth profiles via local subprocesses.",
        ),
    },
    handler: (input) => {
      // Parsing/validation is genuinely read-only, but preflight drives real
      // subprocess execution (accounts env <profile>, codewith profile list)
      // from fully model-controlled workflow input. Gate it behind the same
      // server-side opt-in as mutation tools so a client auto-approving
      // read-only tools cannot trigger credential-resolution spawns.
      if (input.preflight) {
        requireMutationsEnabled();
      }
      const workflow = validationWorkflow(parseWorkflowInput(input));
      if (input.preflight && workflow.steps.length > MAX_PREFLIGHT_STEPS) {
        throw new Error(`preflight supports at most ${MAX_PREFLIGHT_STEPS} steps; got ${workflow.steps.length}`);
      }
      return {
        valid: true,
        workflow: publicWorkflow(workflow),
        preflight: input.preflight ? preflightWorkflow(workflow) : undefined,
      };
    },
  },
  {
    name: "loops_workflow_run_inspect",
    aliases: ["workflow_run_inspect"],
    description: "Inspect one workflow run by id: run record, step runs, and event log.",
    readOnly: true,
    annotations: READ_ONLY_ANNOTATIONS,
    inputSchema: {
      runId: z.string().min(1).describe("Workflow run id (from loops_workflow_read runs or loop run records)."),
      includeEvents: z.boolean().optional().describe("Include the workflow event log (default true)."),
      showOutput: showOutputSchema,
    },
    handler: ({ runId, includeEvents, showOutput }) =>
      withStore((store) => {
        const run = store.getWorkflowRun(runId);
        if (!run) throw new Error(`workflow run not found: ${runId}`);
        return {
          run: publicWorkflowRun(run),
          steps: store.listWorkflowStepRuns(run.id).map((step) => publicWorkflowStepRun(step, showOutput ?? false)),
          events: (includeEvents ?? true) ? store.listWorkflowEvents(run.id).map(publicWorkflowEvent) : undefined,
        };
      }),
  },
  {
    name: "loops_pause",
    aliases: ["loop_pause"],
    description: "Pause a loop. Archived loops are rejected with a coded LOOP_ARCHIVED error.",
    readOnly: false,
    guarded: true,
    annotations: mutationAnnotations({ idempotent: true }),
    inputSchema: { idOrName: loopIdOrNameSchema },
    handler: ({ idOrName }) =>
      withStore((store) => ({ loop: publicLoop(store.updateLoop(store.requireUniqueLoop(idOrName).id, { status: "paused" })) })),
  },
  {
    name: "loops_resume",
    aliases: ["loop_resume"],
    description: "Resume a paused loop. Archived loops are rejected with a coded LOOP_ARCHIVED error.",
    readOnly: false,
    guarded: true,
    annotations: mutationAnnotations({ idempotent: true }),
    inputSchema: { idOrName: loopIdOrNameSchema },
    handler: ({ idOrName }) =>
      withStore((store) => {
        const loop = store.requireUniqueLoop(idOrName);
        // A stopped loop has next_run_at NULL; dueLoops requires it IS NOT NULL,
        // so resuming without recomputing leaves the loop active but permanently
        // dormant. Recompute the next slot from now when it is missing.
        let nextRunAt = loop.nextRunAt;
        if (!nextRunAt) {
          const now = new Date();
          nextRunAt = computeNextAfter(loop.schedule, now, now);
        }
        return { loop: publicLoop(store.updateLoop(loop.id, { status: "active", nextRunAt })) };
      }),
  },
  {
    name: "loops_stop",
    aliases: ["loop_stop"],
    description: "Stop a loop and clear its next scheduled run. Archived loops are rejected with a coded LOOP_ARCHIVED error.",
    readOnly: false,
    guarded: true,
    annotations: mutationAnnotations({ idempotent: true }),
    inputSchema: { idOrName: loopIdOrNameSchema },
    handler: ({ idOrName }) =>
      withStore((store) => ({
        loop: publicLoop(store.updateLoop(store.requireUniqueLoop(idOrName).id, { status: "stopped", nextRunAt: undefined })),
      })),
  },
  {
    name: "loops_run_now",
    aliases: ["loop_run_now"],
    description:
      "Mark a loop due immediately for daemon pickup (schedule-only: this server never executes the run inline; inline execution stays in the CLI/SDK). The result includes a warning when no daemon is running to pick the run up.",
    readOnly: false,
    guarded: true,
    annotations: mutationAnnotations(),
    inputSchema: { idOrName: loopIdOrNameSchema },
    handler: ({ idOrName }) =>
      withStore(async (store) => {
        const daemon = daemonStatus(store);
        // requireUniqueLoop so an ambiguous name errors instead of scheduling the
        // newest same-named loop.
        const result = await runLoopNow({ store, idOrName: store.requireUniqueLoop(idOrName).id, runnerId: `mcp:${process.pid}`, mode: "schedule" });
        return {
          scheduledFor: result.scheduledFor,
          loop: publicLoop(result.loop),
          daemon: { running: daemon.running, stale: daemon.stale, pid: daemon.pid },
          warning: daemon.running
            ? undefined
            : "loops daemon is not running: the loop is marked due, but nothing will execute it until the daemon starts ('loops daemon start').",
        };
      }),
  },
  {
    name: "loops_archive",
    description: "Archive a loop without deleting its history; archived loops are frozen until unarchived.",
    readOnly: false,
    guarded: true,
    annotations: mutationAnnotations({ idempotent: true }),
    inputSchema: { idOrName: loopIdOrNameSchema },
    handler: ({ idOrName }) => withStore((store) => ({ loop: publicLoop(store.archiveLoop(idOrName)) })),
  },
  {
    name: "loops_unarchive",
    description: "Restore an archived loop to its pre-archive status.",
    readOnly: false,
    guarded: true,
    annotations: mutationAnnotations({ idempotent: true }),
    inputSchema: { idOrName: loopIdOrNameSchema },
    handler: ({ idOrName }) => withStore((store) => ({ loop: publicLoop(store.unarchiveLoop(idOrName)) })),
  },
  {
    name: "loops_create_command",
    aliases: ["loop_create_command"],
    description: "Create a deterministic command loop (argv-style command + args; shell execution is not available over MCP).",
    readOnly: false,
    guarded: true,
    annotations: mutationAnnotations(),
    inputSchema: {
      ...createLoopCommonSchema,
      command: z.string().min(1).describe("Executable to run (resolved via PATH); not a shell string."),
      args: z.array(z.string()).optional().describe("Argv-style arguments passed to the command."),
      cwd: z.string().optional().describe("Working directory for the command."),
      // Shell targets are forbidden over MCP by design: a shell string turns a
      // structured argv into free-form composition (pipes, subshells,
      // redirection), which defeats auditability and invites injection through
      // model-generated text. z.never() rejects any explicit request instead
      // of silently stripping it; shell loops remain a human decision via the
      // CLI or SDK.
      shell: z.never().optional().describe("Not supported over MCP: shell execution is rejected. Use 'command' plus 'args' instead."),
    },
    handler: (input) =>
      withStore((store) => {
        const timeoutMs = input.timeoutMs as TimeoutMs | undefined;
        const loop = store.createLoop(
          commonCreateInput({
            ...input,
            target: {
              type: "command",
              command: nonEmpty(input.command, "command"),
              args: input.args,
              cwd: input.cwd,
              shell: false,
              timeoutMs,
            },
          }),
        );
        return { loop: publicLoop(loop) };
      }),
  },
  {
    name: "loops_create_workflow",
    aliases: ["loop_create_workflow"],
    description: "Create a loop that runs an existing stored workflow.",
    readOnly: false,
    guarded: true,
    annotations: mutationAnnotations(),
    inputSchema: {
      ...createLoopCommonSchema,
      workflow: workflowIdOrNameSchema,
      workflowInput: z.record(z.string(), z.string()).optional().describe("String key/value input passed to the workflow on each run."),
    },
    handler: (input) =>
      withStore((store) => {
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
  },
];

function toolDescription(tool: LoopsMcpToolRegistration): string {
  return tool.guarded ? `${tool.description} Requires ${MUTATION_ENV}=true on the MCP server process.` : tool.description;
}

/** Tool metadata derived from TOOL_REGISTRATIONS; served via loops://tools and the loops-mcp bin's `list-tools` argv. */
export const LOOPS_MCP_TOOLS: LoopsMcpToolMetadata[] = TOOL_REGISTRATIONS.map((tool) => ({
  name: tool.name,
  aliases: tool.aliases?.length ? [...tool.aliases] : undefined,
  description: toolDescription(tool),
  readOnly: tool.readOnly,
  guarded: tool.guarded || undefined,
  requiresEnv: tool.guarded ? `${MUTATION_ENV}=true` : undefined,
}));

function registerTool(
  server: McpServer,
  name: string,
  config: { description: string; inputSchema: Record<string, unknown>; annotations?: Record<string, unknown> },
  cb: (input: any) => unknown,
): void {
  (server as { registerTool: (...args: unknown[]) => unknown }).registerTool(name, config, cb);
}

function toolCallback(tool: LoopsMcpToolRegistration) {
  return async (input: any) => {
    try {
      if (tool.guarded) requireMutationsEnabled();
      return jsonResult(await tool.handler(input));
    } catch (error) {
      return errorResult(error);
    }
  };
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

  for (const tool of TOOL_REGISTRATIONS) {
    const callback = toolCallback(tool);
    const description = toolDescription(tool);
    registerTool(server, tool.name, { description, inputSchema: tool.inputSchema, annotations: tool.annotations }, callback);
    for (const alias of tool.aliases ?? []) {
      registerTool(
        server,
        alias,
        { description: `Deprecated alias of ${tool.name}. ${description}`, inputSchema: tool.inputSchema, annotations: tool.annotations },
        callback,
      );
    }
  }

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
