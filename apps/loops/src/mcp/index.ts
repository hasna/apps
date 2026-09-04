#!/usr/bin/env bun
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { isStdioMode, resolveMcpHttpPort, startMcpHttpServer } from "./http.js";
import { z } from "zod/v3";
import { daemonStatus } from "../daemon/control.js";
import { runDoctor } from "../lib/doctor.js";
import { CodedError, LoopArchivedError } from "../lib/errors.js";
import {
  publicLoop,
  publicRun,
  publicRunReceipt,
  publicWorkflow,
  publicWorkflowEvent,
  publicWorkflowRun,
  publicWorkflowStepRun,
} from "../lib/format.js";
import { publicCommandDescriptor } from "../lib/command-target.js";
import { buildHealthReport, buildHealthScan, classifyRunFailure, expectationForLoop } from "../lib/health.js";
import { nowIso } from "../lib/ids.js";
import { LOOP_LABEL_MAX_COUNT, mergeLoopLabels, normalizeLoopLabels, removeLoopLabels } from "../lib/labels.js";
import { resolveLoopMachine } from "../lib/machines.js";
import { dataDir } from "../lib/paths.js";
import { initialNextRun } from "../lib/recurrence.js";
import { runLoopNow } from "../lib/scheduler.js";
import { Store } from "../lib/store.js";
import { LocalStore, getStore, isCloudStore, type LoopStore } from "../lib/store/index.js";
import { packageVersion } from "../lib/version.js";
import { preflightWorkflow } from "../lib/workflow-runner.js";
import { workflowBodyFromJson } from "../lib/workflow-spec.js";
import type {
  CatchUpPolicy,
  CreateLoopInput,
  LoopRun,
  LoopStatus,
  LoopTarget,
  OverlapPolicy,
  RunStatus,
  ScheduleSpec,
  TimeoutMs,
  WorkflowSpec,
  WriteRunReceiptInput,
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
const MAX_OUTPUT_RUN_LIMIT = 25;
const MAX_OUTPUT_CHARS = 32_000;
const MAX_RESPONSE_CHARS = 128_000;

const MUTATION_ENV = "LOOPS_MCP_ALLOW_MUTATIONS";

const loopIdOrNameSchema = z
  .string()
  .min(1)
  .describe("Loop id or exact loop name. Names resolve on exact match only; ambiguous names require the id.");
const workflowIdOrNameSchema = z.string().min(1).describe("Workflow id or exact workflow name.");
const showOutputSchema = z
  .boolean()
  .optional()
  .describe("Include scrubbed, bounded stdout/stderr (default false: only redacted lengths are returned).");
const limitSchema = z.number().int().min(1).max(MAX_LIMIT).optional().describe(`Maximum entries to return (1-${MAX_LIMIT}).`);
const labelSchema = z.string().min(1).max(64);
const labelsSchema = z.array(labelSchema).max(LOOP_LABEL_MAX_COUNT);
const maxOutputCharsSchema = z
  .number()
  .int()
  .min(1)
  .max(MAX_OUTPUT_CHARS)
  .optional()
  .describe(`Maximum characters returned for each stdout/stderr field (1-${MAX_OUTPUT_CHARS}).`);
const runReceiptSummarySchema = z.object({
  text: z.string().optional().describe("Short human summary. It is scrubbed and bounded before storage."),
  stdout_bytes: z.number().int().min(0).optional().describe("Original stdout byte count."),
  stderr_bytes: z.number().int().min(0).optional().describe("Original stderr byte count."),
  stdout_excerpt: z.string().optional().describe("Bounded stdout excerpt. Raw unbounded stdout is never required."),
  stderr_excerpt: z.string().optional().describe("Bounded stderr excerpt. Raw unbounded stderr is never required."),
  error: z.string().optional().describe("Bounded error excerpt."),
  duration_ms: z.number().int().min(0).optional().describe("Run duration in milliseconds."),
});
const runReceiptInputSchema = {
  loop_id: z.string().min(1).optional().describe("Loops loop id. Optional when run_id references an existing loop run."),
  run_id: z.string().min(1).describe("Scheduler-neutral run id. Existing values are updated idempotently."),
  machine: z.union([z.string().min(1), z.record(z.string(), z.unknown())]).optional().describe("Machine id/name or machine metadata object."),
  repo: z.string().min(1).optional().describe("Repository path or owner/repo string. Defaults from the loop target cwd when possible."),
  task_ids: z.array(z.string().min(1)).optional().describe("Task ids associated with this run."),
  knowledge_ids: z.array(z.string().min(1)).optional().describe("Knowledge record ids associated with this run."),
  digest_id: z.string().min(1).optional().describe("Stable digest id. Computed from normalized receipt content when omitted."),
  started_at: z.string().nullable().optional().describe("Run start timestamp."),
  finished_at: z.string().nullable().optional().describe("Run finish timestamp."),
  status: z.string().min(1).optional().describe("Run status."),
  exit_code: z.number().int().nullable().optional().describe("Process exit code."),
  summary: z.union([z.string(), runReceiptSummarySchema]).nullable().optional().describe("Bounded structured summary; may be a string shorthand."),
  evidence_paths: z.array(z.string().min(1)).optional().describe("Bounded paths to durable evidence artifacts."),
  stdout: z.string().optional().describe("Optional raw stdout to summarize and bound before storage."),
  stderr: z.string().optional().describe("Optional raw stderr to summarize and bound before storage."),
  error: z.string().optional().describe("Optional raw error text to summarize and bound before storage."),
  duration_ms: z.number().int().min(0).optional().describe("Run duration in milliseconds."),
};
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
  labels: labelsSchema.optional().describe("Persisted loop labels; normalized lowercase and deduplicated."),
  schedule: scheduleSchema,
  timeoutMs: optionalTimeoutSchema,
  catchUp: catchUpSchema,
  catchUpLimit: z.number().int().positive().optional().describe("Maximum missed slots replayed when catching up."),
  overlap: overlapSchema,
  maxAttempts: z.number().int().positive().optional().describe("Attempts per slot before a failed run is final (default 1)."),
  retryDelayMs: z.number().int().positive().optional().describe("Base retry delay in milliseconds (exponential backoff with jitter)."),
  leaseMs: z.number().int().positive().optional().describe("Run lease in milliseconds before an unresponsive runner is considered dead."),
  expiresAt: z.string().optional().describe("Date/time after which the loop expires and stops scheduling."),
  expiresAfterRuns: z.number().int().positive().optional().describe("Expire the loop after this many consecutive successful runs. Independent of expiresAt; a failed run resets the streak, skipped runs are neutral."),
  machine: z.string().min(1).optional().describe("OpenMachines machine id to pin this loop to. Resolved through the local machines topology; an unresolvable machine fails the create instead of persisting an unbound loop."),
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

function boundedJsonText(value: unknown): string {
  const json = JSON.stringify(value, null, 2);
  if (json.length <= MAX_RESPONSE_CHARS) return json;

  let previewLength = Math.max(0, MAX_RESPONSE_CHARS - 1_024);
  let bounded = "";
  while (previewLength >= 0) {
    bounded = JSON.stringify(
      {
        truncated: true,
        maxResponseChars: MAX_RESPONSE_CHARS,
        originalChars: json.length,
        message: "MCP response exceeded the aggregate response cap; narrow filters or disable showOutput.",
        preview: json.slice(0, previewLength),
      },
      null,
      2,
    );
    if (bounded.length <= MAX_RESPONSE_CHARS) return bounded;
    previewLength -= Math.max(256, bounded.length - MAX_RESPONSE_CHARS);
  }
  return JSON.stringify({ truncated: true, maxResponseChars: MAX_RESPONSE_CHARS, originalChars: json.length });
}

function jsonResult(value: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: boundedJsonText(value),
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

/**
 * Resolve the client store (local sqlite OR the hosted `/v1` API) from the
 * client-flip env and run `fn` against it, always closing afterwards. EVERY MCP
 * data tool goes through here so there is no per-tool `if (cloud) … else local`
 * branch and no way to silently touch the on-box island while the process is
 * flipped to the hosted API. Mirrors the CLI's `withStore`.
 */
async function withStore<T>(fn: (store: LoopStore) => T | Promise<T>): Promise<T> {
  const store = getStore();
  try {
    return await fn(store);
  } finally {
    await store.close();
  }
}

/**
 * Guard for the on-box diagnostic/runtime tools (doctor, health, daemon status,
 * per-loop diagnose, run-now scheduling). These read this machine's daemon and
 * sqlite runtime and are meaningless — and would silently hit the local island —
 * when the process is flipped to the hosted API. Fail loudly instead, then run
 * against a scoped local {@link Store} (opened and closed here). Mirrors the
 * CLI's `assertLocalOnlyCommand` + `new Store()` pattern.
 */
async function withLocalStore<T>(operation: string, fn: (store: Store) => T | Promise<T>): Promise<T> {
  if (isCloudStore()) {
    throw new Error(
      `'${operation}' inspects this machine's local Loops runtime and is not available while flipped to the hosted Loops API. ` +
        `Set HASNA_LOOPS_CONNECTION=file to explicitly select the local file store and run it here.`,
    );
  }
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

function truncateOutput(value: string | undefined, maxChars: number): string | undefined {
  if (!value || value.length <= maxChars) return value;
  const marker = `\n[truncated ${value.length - maxChars} chars]`;
  if (marker.length >= maxChars) return marker.slice(0, maxChars);
  return `${value.slice(0, maxChars - marker.length)}${marker}`;
}

function publicMcpRun(run: LoopRun, showOutput: boolean, maxOutputChars = MAX_OUTPUT_CHARS): Record<string, unknown> {
  const value = publicRun(run, showOutput);
  if (!showOutput) return value;
  return {
    ...value,
    stdout: truncateOutput(value.stdout as string | undefined, maxOutputChars),
    stderr: truncateOutput(value.stderr as string | undefined, maxOutputChars),
  };
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
  // Command targets use the secret-safe descriptor (bounded + scrubbed for
  // shell targets) so the default loop description never embeds raw command
  // text or credential values into the durable store.
  if (target.type === "command") return `runs command ${publicCommandDescriptor(target)}`;
  if (target.type === "agent") return `runs ${target.provider} agent${target.cwd ? ` in ${target.cwd}` : ""}`;
  return `runs workflow ${target.workflowId}`;
}

function defaultLoopDescription(name: string, schedule: ScheduleSpec, target: LoopTarget): string {
  return [
    `Why: keep ${name} running as a Loops scheduled automation.`,
    `How: ${targetLabel(target)} on cadence ${scheduleLabel(schedule)}.`,
    "Outcome: record each run, status, retries, and evidence in Loops for operator review.",
  ].join(" ");
}

function commonCreateInput(input: {
  name: string;
  description?: string;
  labels?: string[];
  schedule: z.infer<typeof scheduleSchema>;
  target: LoopTarget;
  catchUp?: (typeof CATCH_UP_POLICIES)[number];
  catchUpLimit?: number;
  overlap?: (typeof OVERLAP_POLICIES)[number];
  maxAttempts?: number;
  retryDelayMs?: number;
  leaseMs?: number;
  expiresAt?: string;
  expiresAfterRuns?: number;
  machine?: string;
}): CreateLoopInput {
  const name = nonEmpty(input.name, "name");
  const schedule = normalizeSchedule(input.schedule);
  return {
    name,
    description: input.description?.trim() || defaultLoopDescription(name, schedule, input.target),
    schedule,
    target: input.target,
    labels: normalizeLoopLabels(input.labels),
    catchUp: input.catchUp as CatchUpPolicy | undefined,
    catchUpLimit: input.catchUpLimit,
    overlap: input.overlap as OverlapPolicy | undefined,
    maxAttempts: input.maxAttempts,
    retryDelayMs: input.retryDelayMs,
    leaseMs: input.leaseMs,
    expiresAt: input.expiresAt ? normalizeDate(input.expiresAt, "expiresAt") : undefined,
    expiresAfterRuns: input.expiresAfterRuns,
    // Fail closed, mirroring the CLI: a requested machine must resolve through
    // the machines topology, or the create throws instead of persisting a
    // machine-less loop that any fleet runner could claim.
    machine: input.machine !== undefined ? resolveLoopMachine(input.machine) : undefined,
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
    description: "List local Loops loops.",
    readOnly: true,
    annotations: READ_ONLY_ANNOTATIONS,
    inputSchema: {
      status: z.enum(LOOP_STATUS_FILTERS).optional().describe("Filter by loop status; 'all' disables the filter."),
      labels: labelsSchema.optional().describe("Require all listed labels."),
      limit: limitSchema,
      includeArchived: z.boolean().optional().describe("Include archived loops alongside live ones (default false)."),
      archivedOnly: z.boolean().optional().describe("Return only archived loops (default false)."),
    },
    handler: ({ status, labels, limit, includeArchived, archivedOnly }) =>
      withStore(async (store) => ({
        loops: (
          await store.listLoops({
            status: filteredLoopStatus(status),
            labels: normalizeLoopLabels(labels),
            limit,
            includeArchived: includeArchived ?? false,
            archived: archivedOnly ?? false,
          })
        ).map(publicLoop),
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
      maxOutputChars: maxOutputCharsSchema,
    },
    handler: ({ idOrName, includeLatestRun, showOutput, maxOutputChars }) =>
      withStore(async (store) => {
        const loop = await store.requireLoop(idOrName);
        const latestRun = includeLatestRun ? (await store.listRuns({ loopId: loop.id, limit: 1 }))[0] : undefined;
        return {
          loop: publicLoop(loop),
          // publicRun redacts stdout/stderr client-side unless showOutput; the
          // ApiStore returns raw output so this redaction stays identical to local.
          latestRun: latestRun
            ? publicMcpRun(latestRun, showOutput ?? false, maxOutputChars ?? MAX_OUTPUT_CHARS)
            : undefined,
        };
      }),
  },
  {
    name: "loops_runs",
    aliases: ["loop_runs"],
    description: "List loop runs with optional loop/status/current-label filtering and bounded output.",
    readOnly: true,
    annotations: READ_ONLY_ANNOTATIONS,
    inputSchema: {
      idOrName: loopIdOrNameSchema.optional(),
      status: z.enum(RUN_STATUSES).optional().describe("Filter by run status."),
      labels: labelsSchema.optional().describe("Require all current labels on the run's loop."),
      limit: limitSchema,
      showOutput: showOutputSchema,
      maxOutputChars: maxOutputCharsSchema,
    },
    handler: ({ idOrName, status, labels, limit, showOutput, maxOutputChars }) =>
      withStore(async (store) => {
        const loop = idOrName ? await store.requireLoop(idOrName) : undefined;
        const effectiveLimit = showOutput
          ? Math.min(limit ?? MAX_OUTPUT_RUN_LIMIT, MAX_OUTPUT_RUN_LIMIT)
          : limit;
        const runs = (
          await store.listRuns({
            loopId: loop?.id,
            status: status as RunStatus | undefined,
            labels: normalizeLoopLabels(labels),
            limit: effectiveLimit,
          })
        ).map((run) => publicMcpRun(run, showOutput ?? false, maxOutputChars ?? MAX_OUTPUT_CHARS));
        return {
          loop: loop ? publicLoop(loop) : undefined,
          runs,
          outputLimitApplied: showOutput && (limit ?? MAX_OUTPUT_RUN_LIMIT) > MAX_OUTPUT_RUN_LIMIT
            ? { requested: limit, returnedAtMost: MAX_OUTPUT_RUN_LIMIT }
            : undefined,
        };
      }),
  },
  {
    name: "loops_receipts_list",
    description: "List scheduler-neutral run receipts with bounded summaries and evidence paths.",
    readOnly: true,
    annotations: READ_ONLY_ANNOTATIONS,
    inputSchema: {
      loop_id: z.string().min(1).optional().describe("Filter by loop_id."),
      repo: z.string().min(1).optional().describe("Filter by repo."),
      task_id: z.string().min(1).optional().describe("Filter by task id."),
      knowledge_id: z.string().min(1).optional().describe("Filter by knowledge id."),
      status: z.string().min(1).optional().describe("Filter by receipt status."),
      limit: limitSchema,
    },
    handler: ({ loop_id, repo, task_id, knowledge_id, status, limit }) =>
      withStore(async (store) => ({
        receipts: (
          await store.listRunReceipts({ loopId: loop_id, repo, taskId: task_id, knowledgeId: knowledge_id, status, limit })
        ).map(publicRunReceipt),
      })),
  },
  {
    name: "loops_receipt_read",
    description: "Read one scheduler-neutral run receipt by run id.",
    readOnly: true,
    annotations: READ_ONLY_ANNOTATIONS,
    inputSchema: {
      run_id: z.string().min(1).describe("Run id."),
    },
    handler: ({ run_id }) =>
      withStore(async (store) => {
        const receipt = await store.getRunReceipt(run_id);
        if (!receipt) throw new Error(`run receipt not found: ${run_id}`);
        return { receipt: publicRunReceipt(receipt) };
      }),
  },
  {
    name: "loops_receipt_write",
    description: `Write a scheduler-neutral run receipt. Requires ${MUTATION_ENV}=true on the MCP server process.`,
    readOnly: false,
    guarded: true,
    annotations: mutationAnnotations({ idempotent: true }),
    inputSchema: runReceiptInputSchema,
    handler: (input) => {
      requireMutationsEnabled();
      return withStore(async (store) => ({ receipt: publicRunReceipt(await store.writeRunReceipt(input as WriteRunReceiptInput)) }));
    },
  },
  {
    name: "loops_doctor",
    description: "Run Loops runtime diagnostics.",
    readOnly: true,
    annotations: READ_ONLY_ANNOTATIONS,
    inputSchema: {},
    handler: () => withLocalStore("loops_doctor", (store) => runDoctor(store)),
  },
  {
    name: "loops_health",
    description: "Build the Loops health report: per-loop expectations, failure classifications, and recommended follow-up tasks.",
    readOnly: true,
    annotations: READ_ONLY_ANNOTATIONS,
    inputSchema: {
      includeArchived: z.boolean().optional().describe("Include archived loops in the report (default false)."),
      includeInactive: z.boolean().optional().describe("Include stopped/expired loops (default false: active and paused only)."),
      limit: limitSchema,
    },
    handler: ({ includeArchived, includeInactive, limit }) =>
      withLocalStore("loops_health", (store) => buildHealthReport(store, { includeArchived, includeInactive, limit })),
  },
  {
    name: "loops_health_scan",
    description: "Build a read-only Loops health scan with bounded daemon, doctor/preflight, latest-run, and stale-running findings.",
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
      withLocalStore("loops_health_scan", (store) => buildHealthScan(store, {
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
      withLocalStore("loops_diagnose", (store) => {
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
    handler: () => withLocalStore("loops_daemon_status", (store) => daemonStatus(store)),
  },
  {
    name: "loops_workflows_list",
    aliases: ["workflows_list"],
    description: "List stored Loops workflow specs.",
    readOnly: true,
    annotations: READ_ONLY_ANNOTATIONS,
    inputSchema: {
      status: z.enum(WORKFLOW_STATUS_FILTERS).optional().describe("Filter by workflow status; 'all' disables the filter."),
      limit: limitSchema,
      offset: z.number().int().min(0).optional().describe("Entries to skip before returning results (pagination)."),
    },
    handler: ({ status, limit, offset }) =>
      withStore(async (store) => ({
        workflows: (
          await store.listWorkflows({
            status: filteredWorkflowStatus(status),
            limit,
            offset,
          })
        ).map(publicWorkflow),
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
      withStore(async (store) => {
        const workflow = await store.requireWorkflow(idOrName);
        const runs = includeRuns ? await store.listWorkflowRuns({ workflowId: workflow.id, limit: runLimit ?? 20 }) : [];
        return {
          workflow: publicWorkflow(workflow),
          runs: await Promise.all(
            runs.map(async (run) => ({
              ...publicWorkflowRun(run),
              steps: (await store.listWorkflowStepRuns(run.id)).map((step) => publicWorkflowStepRun(step, showOutput ?? false)),
              events: includeEvents ? (await store.listWorkflowEvents(run.id)).map(publicWorkflowEvent) : undefined,
            })),
          ),
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
      withStore(async (store) => {
        const run = await store.getWorkflowRun(runId);
        if (!run) throw new Error(`workflow run not found: ${runId}`);
        return {
          run: publicWorkflowRun(run),
          steps: (await store.listWorkflowStepRuns(run.id)).map((step) => publicWorkflowStepRun(step, showOutput ?? false)),
          events: (includeEvents ?? true) ? (await store.listWorkflowEvents(run.id)).map(publicWorkflowEvent) : undefined,
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
      withStore(async (store) => {
        const loop = await store.requireUniqueLoop(idOrName);
        if (loop.archivedAt) throw new LoopArchivedError(idOrName);
        return { loop: publicLoop(await store.updateLoop(loop.id, { status: "paused" })) };
      }),
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
      withStore(async (store) => {
        const loop = await store.requireUniqueLoop(idOrName);
        if (loop.archivedAt) throw new LoopArchivedError(idOrName);
        // A stopped loop has next_run_at NULL; dueLoops requires it IS NOT NULL,
        // so resuming without recomputing leaves the loop active but permanently
        // dormant. Recompute the next slot from now when it is missing.
        // initialNextRun (not computeNextAfter) so schedule.type "once" binds
        // schedule.at instead of undefined, converging with the CLI and contract
        // mutateLoop resume paths.
        let nextRunAt = loop.nextRunAt;
        if (!nextRunAt) {
          nextRunAt = initialNextRun(loop.schedule, new Date());
        }
        return { loop: publicLoop(await store.updateLoop(loop.id, { status: "active", nextRunAt })) };
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
      withStore(async (store) => {
        const loop = await store.requireUniqueLoop(idOrName);
        if (loop.archivedAt) throw new LoopArchivedError(idOrName);
        return { loop: publicLoop(await store.updateLoop(loop.id, { status: "stopped", nextRunAt: undefined })) };
      }),
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
      withStore<{
        scheduledFor: string;
        loop: ReturnType<typeof publicLoop>;
        daemon: { running: boolean; stale: boolean; pid: number | undefined } | undefined;
        warning: string | undefined;
      }>(async (store) => {
        if (store.transport === "api") {
          // Flipped to the hosted API: marking due is a schedule mutation on the
          // hosted loop record (set next_run_at=now) via the ApiStore; a runner
          // against the hosted control plane picks it up. There is no local
          // daemon to report.
          const loop = await store.requireUniqueLoop(idOrName);
          if (loop.archivedAt) throw new LoopArchivedError(idOrName);
          const now = new Date().toISOString();
          const updated = await store.updateLoop(loop.id, { status: "active", nextRunAt: now });
          return {
            scheduledFor: now,
            loop: publicLoop(updated),
            daemon: undefined,
            warning:
              "loops is flipped to the hosted API: the loop is marked due on the hosted control plane; a runner must execute it.",
          };
        }
        // Local: schedule via the shared runLoopNow (schedule mode) against this
        // machine's on-box store and report daemon liveness so the operator knows
        // whether anything will pick the run up. requireUniqueLoop so an ambiguous
        // name errors instead of scheduling the newest same-named loop.
        const raw = (store as LocalStore).raw;
        const daemon = daemonStatus(raw);
        const result = await runLoopNow({ store: raw, idOrName: raw.requireUniqueLoop(idOrName).id, runnerId: `mcp:${process.pid}`, mode: "schedule" });
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
    name: "loops_labels_update",
    aliases: ["loop_update_labels"],
    description: "Set, add, remove, or clear persisted labels on a loop.",
    readOnly: false,
    guarded: true,
    annotations: mutationAnnotations({ idempotent: true }),
    inputSchema: {
      idOrName: loopIdOrNameSchema,
      mode: z.enum(["set", "add", "remove", "clear"]),
      labels: labelsSchema.optional(),
    },
    handler: ({ idOrName, mode, labels }) =>
      withStore(async (store) => {
        const loop = await store.requireUniqueLoop(idOrName);
        const normalized = normalizeLoopLabels(labels);
        if (mode !== "clear" && normalized.length === 0) {
          throw new Error("labels are required unless mode is clear");
        }
        const nextLabels =
          mode === "clear"
            ? []
            : mode === "set"
              ? normalized
              : mode === "add"
                ? mergeLoopLabels(loop.labels, normalized)
                : removeLoopLabels(loop.labels, normalized);
        return { loop: publicLoop(await store.updateLoop(loop.id, { labels: nextLabels })) };
      }),
  },
  {
    name: "loops_archive",
    description: "Archive a loop without deleting its history; archived loops are frozen until unarchived.",
    readOnly: false,
    guarded: true,
    annotations: mutationAnnotations({ idempotent: true }),
    inputSchema: { idOrName: loopIdOrNameSchema },
    handler: ({ idOrName }) =>
      withStore(async (store) => ({ loop: publicLoop(await store.archiveLoop(idOrName)) })),
  },
  {
    name: "loops_unarchive",
    description: "Restore an archived loop to its pre-archive status.",
    readOnly: false,
    guarded: true,
    annotations: mutationAnnotations({ idempotent: true }),
    inputSchema: { idOrName: loopIdOrNameSchema },
    handler: ({ idOrName }) =>
      withStore(async (store) => ({ loop: publicLoop(await store.unarchiveLoop(idOrName)) })),
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
    handler: (input) => {
      const timeoutMs = input.timeoutMs as TimeoutMs | undefined;
      const createInput = commonCreateInput({
        ...input,
        target: {
          type: "command",
          command: nonEmpty(input.command, "command"),
          args: input.args,
          cwd: input.cwd,
          shell: false,
          timeoutMs,
        },
      });
      return withStore(async (store) => ({ loop: publicLoop(await store.createLoop(createInput)) }));
    },
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
    handler: (input) => {
      // Resolve the workflow spec and create the loop against the SAME resolved
      // store: both live on whichever backend is active (local sqlite OR the
      // hosted API), so a cloud-flipped process never reads the spec from the
      // on-box island while writing the loop to the cloud.
      const timeoutMs = input.timeoutMs as TimeoutMs | undefined;
      return withStore(async (store) => {
        const wf = await store.requireWorkflow(input.workflow);
        const createInput = commonCreateInput({
          ...input,
          target: { type: "workflow", workflowId: wf.id, input: input.workflowInput, timeoutMs },
        });
        return { workflow: publicWorkflow(wf), loop: publicLoop(await store.createLoop(createInput)) };
      });
    },
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
      title: "Loops Runtime",
      description: "Current Loops package version and data directory.",
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
      title: "Loops MCP Tools",
      description: "Static metadata for the Loops MCP tool surface.",
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
  // Binds-before-version class (todos row 7e5f8f3d): --version/--help must
  // answer BEFORE any transport resolution or bind. They previously fell
  // through and started the shared HTTP server (:8890) with no output.
  const argv = process.argv.slice(2);
  if (argv.includes("--version") || argv.includes("-V")) {
    console.log(packageVersion());
    return;
  }
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(`Usage: loops-mcp [options]

MCP server for @hasna/loops (Streamable HTTP by default; --stdio to select stdio).

Options:
  -V, --version  output the version number
  -h, --help     display help for command
  list-tools     print the tool metadata as JSON
  --http         explicitly select Streamable HTTP transport
  --stdio        explicitly select stdio transport
  --port <n>     HTTP port (default: 8890)`);
    return;
  }
  if (process.argv[2] === "list-tools") {
    console.log(JSON.stringify(listToolsForCli(), null, 2));
    return;
  }

  // Explicit stdio opt-out (--stdio / MCP_STDIO=1) keeps the legacy
  // one-process-per-agent transport for callers that need it.
  if (isStdioMode()) {
    const server = createLoopsMcpServer();
    await server.connect(new StdioServerTransport());
    return;
  }

  // Default: shared Streamable HTTP server (one process, many agents).
  // Env (e.g. HASNA_LOOPS_API_URL/API_KEY) is baked into this long-lived
  // daemon, so every agent that connects routes deterministically —
  // independent of the caller's own shell environment.
  const handle = await startMcpHttpServer(() => createLoopsMcpServer(), {
    port: resolveMcpHttpPort(),
  });
  process.on("SIGINT", () => {
    void handle.close().finally(() => process.exit(0));
  });
  process.on("SIGTERM", () => {
    void handle.close().finally(() => process.exit(0));
  });
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
