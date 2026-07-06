import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import type { Loop, LoopRun } from "../types.js";
import { redact } from "./format.js";
import type { Store } from "./store.js";

export type RunFailureClassification =
  | "rate_limit"
  | "auth"
  | "model_not_found"
  | "context_length"
  | "schema_response_format"
  | "node_init"
  | "preflight"
  | "route_functional"
  | "timeout"
  | "sigsegv"
  | "restart_interrupted"
  | "skipped_previous_active"
  | "circuit_breaker"
  | "unknown";

export interface RunFailureSignal {
  classification: RunFailureClassification;
  fingerprint: string;
  evidence: {
    error?: string;
    stdout?: string;
    stderr?: string;
    exitCode?: number;
  };
}

export interface RecommendedTaskUpsert {
  title: string;
  description: string;
  priority: "critical" | "high" | "medium" | "low";
  tags: string[];
  dedupeKey: string;
  search: { query: string };
  compatibilityFallback: {
    search: string[];
    add: string[];
    comment: string[];
  };
  futureNativeUpsert: {
    command: string;
    fields: Record<string, string | string[]>;
  };
}

export interface LoopExpectationResult {
  loop: Pick<Loop, "id" | "name" | "status" | "nextRunAt">;
  ok: boolean;
  check: {
    id: "latest-run-succeeded" | "route-functional-health";
    status: "pass" | "fail" | "warn";
    message: string;
  };
  latestRun?: LoopRun;
  failure?: RunFailureSignal;
  route: {
    source: "openloops";
    kind: "loop_expectation";
    loopId: string;
    loopName: string;
    cwd?: string;
    provider?: string;
  };
  recommendedTask?: RecommendedTaskUpsert;
}

export interface LoopsHealthReport {
  ok: boolean;
  generatedAt: string;
  summary: {
    loops: number;
    healthy: number;
    unhealthy: number;
    warnings: number;
  };
  classifications: Record<RunFailureClassification, number>;
  expectations: LoopExpectationResult[];
}

const EVIDENCE_CHARS = 2_000;
const FINGERPRINT_EVIDENCE_CHARS = 120;
const CLASSIFICATIONS: RunFailureClassification[] = [
  "rate_limit",
  "auth",
  "model_not_found",
  "context_length",
  "schema_response_format",
  "node_init",
  "preflight",
  "route_functional",
  "timeout",
  "sigsegv",
  "restart_interrupted",
  "skipped_previous_active",
  "circuit_breaker",
  "unknown",
];

export const RESTART_INTERRUPTED_RUN_PREFIX = "daemon restart interrupted active run";

function bounded(value: string | undefined, limit = EVIDENCE_CHARS): string | undefined {
  if (!value) return undefined;
  if (value.length <= limit) return value;
  return `${value.slice(0, limit)}\n[truncated ${value.length - limit} chars]`;
}

function redactedEvidence(value: string | undefined): string | undefined {
  return redact(bounded(value));
}

function searchableText(run: LoopRun): string {
  return [run.error, run.stderr, run.stdout].filter(Boolean).join("\n").toLowerCase();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function objectField(value: Record<string, unknown> | undefined, key: string): Record<string, unknown> | undefined {
  if (!value) return undefined;
  const field = value[key];
  return isRecord(field) ? field : undefined;
}

function tagsFromValue(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((entry) => String(entry).trim()).filter(Boolean);
  if (typeof value === "string") return value.split(",").map((entry) => entry.trim()).filter(Boolean);
  return [];
}

function stableFingerprint(parts: string[]): string {
  return createHash("sha256").update(parts.join("\n")).digest("hex").slice(0, 16);
}

function stableFailureFingerprint(run: LoopRun, classification: RunFailureClassification): string {
  return stableFingerprint([
    run.loopId,
    classification,
    String(run.status),
    String(run.exitCode ?? ""),
    (run.error ?? run.stderr ?? run.stdout ?? "").replace(/\d{4}-\d{2}-\d{2}T\S+/g, "<timestamp>").slice(0, FINGERPRINT_EVIDENCE_CHARS),
  ]);
}

function stableRouteFunctionalFingerprint(loop: Loop, reason: string): string {
  return stableFingerprint([
    loop.id,
    "route_functional",
    reason.replace(/\d{4}-\d{2}-\d{2}T\S+/g, "<timestamp>").slice(0, FINGERPRINT_EVIDENCE_CHARS),
  ]);
}

function healthRun(run: LoopRun): LoopRun {
  return {
    ...run,
    error: redactedEvidence(run.error),
    stdout: redactedEvidence(run.stdout),
    stderr: redactedEvidence(run.stderr),
  };
}

export function classifyRunFailure(run: LoopRun): RunFailureSignal | undefined {
  if (run.status === "succeeded" || run.status === "running") return undefined;
  const text = searchableText(run);
  let classification: RunFailureClassification = "unknown";
  if (run.status === "timed_out") classification = "timeout";
  else if (run.status === "skipped" && run.error?.startsWith(RESTART_INTERRUPTED_RUN_PREFIX)) classification = "restart_interrupted";
  else if (run.status === "skipped" && /circuit breaker open/.test(text)) classification = "circuit_breaker";
  else if (run.status === "skipped" && /previous run still active/.test(text)) classification = "skipped_previous_active";
  else if (/runtime preflight failed|preflight failed|executable not found in path|none of required executables found|auth profile preflight failed|profile not found/.test(text)) classification = "preflight";
  else if (/rate limit|too many requests|429\b|quota exceeded/.test(text)) classification = "rate_limit";
  else if (/unauthorized|authentication|auth\b|api key|invalid token|permission denied|401\b|403\b/.test(text)) classification = "auth";
  else if (/model .*not found|model_not_found|unknown model|invalid model|404.*model/.test(text)) classification = "model_not_found";
  else if (/context length|context_length|context window|maximum context|token limit|too many tokens/.test(text)) classification = "context_length";
  else if (/response_format|json schema|schema validation|invalid schema|structured output/.test(text)) classification = "schema_response_format";
  else if (/cannot find module|module not found|node:internal|bun: command not found|node: command not found|npm err!|err_module_not_found/.test(text)) classification = "node_init";
  else if (/sigsegv|segmentation fault|signal 11/.test(text)) classification = "sigsegv";

  return {
    classification,
    fingerprint: stableFailureFingerprint(run, classification),
    evidence: {
      error: redactedEvidence(run.error),
      stdout: redactedEvidence(run.stdout),
      stderr: redactedEvidence(run.stderr),
      exitCode: run.exitCode,
    },
  };
}

const ROUTE_FUNCTIONAL_DISALLOWED_TAGS = new Set([
  "no-auto",
  "manual",
  "manual-required",
  "approval-required",
  "blocked",
  "completed",
  "done",
  "cancelled",
  "canceled",
  "failed",
  "archived",
]);

const ROUTE_FUNCTIONAL_DISALLOWED_STATUSES = new Set([
  "blocked",
  "completed",
  "done",
  "cancelled",
  "canceled",
  "failed",
  "archived",
]);

function parseJsonObject(raw: string | undefined): Record<string, unknown> | undefined {
  if (!raw?.trim()) return undefined;
  try {
    const parsed = JSON.parse(raw);
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function routeEvidenceReport(run: LoopRun): Record<string, unknown> | undefined {
  const stdoutReport = parseJsonObject(run.stdout);
  const evidencePath = stringValue(stdoutReport?.evidencePath);
  if (evidencePath && existsSync(evidencePath)) {
    try {
      return parseJsonObject(readFileSync(evidencePath, "utf8")) ?? stdoutReport;
    } catch {
      return stdoutReport;
    }
  }
  return stdoutReport;
}

function commandName(command: string): string {
  return command.split(/[\\/]/).at(-1) ?? command;
}

function argsContainSequence(args: string[], sequence: string[]): boolean {
  for (let index = 0; index <= args.length - sequence.length; index += 1) {
    if (sequence.every((part, offset) => args[index + offset] === part)) return true;
  }
  return false;
}

function isRouteDrainLoop(loop: Loop): boolean {
  if (loop.target.type !== "command") return false;
  if (commandName(loop.target.command) !== "loops") return false;
  const args = loop.target.args ?? [];
  return (
    argsContainSequence(args, ["events", "drain", "todos-task"]) ||
    argsContainSequence(args, ["routes", "drain", "todos-task"]) ||
    argsContainSequence(args, ["route", "drain", "todos-task"])
  );
}

function routeResultTaskState(result: Record<string, unknown>): { taskId?: string; tags: string[]; status?: string } {
  const event = objectField(result, "event");
  const data = objectField(event, "data");
  const task = objectField(data, "task");
  const payload = objectField(data, "payload");
  const payloadTask = objectField(payload, "task");
  const metadata = objectField(data, "metadata");
  const records = [data, task, payload, payloadTask, metadata].filter(isRecord);
  const tags = new Set<string>();
  for (const record of records) {
    for (const tag of tagsFromValue(record.tags ?? record.task_tags ?? record.taskTags)) {
      tags.add(tag.toLowerCase());
    }
  }
  const status = records
    .map((record) => stringValue(record.status ?? record.task_status ?? record.taskStatus)?.toLowerCase())
    .find(Boolean);
  return {
    taskId: stringValue(event?.subject) ?? stringValue(data?.id) ?? stringValue(task?.id) ?? stringValue(payloadTask?.id),
    tags: [...tags],
    status,
  };
}

function detectRouteFunctionalFailure(store: Store, loop: Loop, run: LoopRun): RunFailureSignal | undefined {
  if (run.status !== "succeeded") return undefined;
  if (!isRouteDrainLoop(loop)) return undefined;
  const report = routeEvidenceReport(run);
  const rawResults = Array.isArray(report?.results) ? report.results.filter(isRecord) : [];
  for (const result of rawResults) {
    const kind = stringValue(result.kind);
    const task = routeResultTaskState(result);
    const disallowedTag = task.tags.find((tag) => ROUTE_FUNCTIONAL_DISALLOWED_TAGS.has(tag));
    if (kind && kind !== "skipped" && disallowedTag) {
      const reason = `route drain ${kind} task ${task.taskId ?? "unknown"} with disallowed tag ${disallowedTag}`;
      return {
        classification: "route_functional",
        fingerprint: stableRouteFunctionalFingerprint(loop, reason),
        evidence: { error: reason, stdout: redactedEvidence(run.stdout), exitCode: run.exitCode },
      };
    }
    if (kind && kind !== "skipped" && task.status && ROUTE_FUNCTIONAL_DISALLOWED_STATUSES.has(task.status)) {
      const reason = `route drain ${kind} task ${task.taskId ?? "unknown"} with non-routable status ${task.status}`;
      return {
        classification: "route_functional",
        fingerprint: stableRouteFunctionalFingerprint(loop, reason),
        evidence: { error: reason, stdout: redactedEvidence(run.stdout), exitCode: run.exitCode },
      };
    }
    const reason = stringValue(result.reason);
    if (kind === "skipped" && reason === "task metadata requires manual or approval-gated handling") {
      const message = `route drain skipped task ${task.taskId ?? "unknown"} with ambiguous manual-gate reason`;
      return {
        classification: "route_functional",
        fingerprint: stableRouteFunctionalFingerprint(loop, message),
        evidence: { error: message, stdout: redactedEvidence(run.stdout), exitCode: run.exitCode },
      };
    }
    const sourceTaskUpdate = objectField(result, "sourceTaskUpdate");
    if (kind === "skipped" && sourceTaskUpdate && sourceTaskUpdate.ok === false) {
      const updateError = stringValue(sourceTaskUpdate.error);
      const message = `route drain skipped task ${task.taskId ?? "unknown"} but failed to update source task${updateError ? `: ${updateError}` : ""}`;
      return {
        classification: "route_functional",
        fingerprint: stableRouteFunctionalFingerprint(loop, message),
        evidence: { error: message, stdout: redactedEvidence(run.stdout), exitCode: run.exitCode },
      };
    }
    const childLoopId = stringValue(objectField(result, "loop")?.id) ?? stringValue(result.loopId);
    const childRun = childLoopId ? store.listRuns({ loopId: childLoopId, limit: 1 })[0] : undefined;
    if (childRun && !["succeeded", "running"].includes(childRun.status)) {
      const message = `route drain ${kind ?? "handled"} task ${task.taskId ?? "unknown"} but child loop ${childLoopId} latest run is ${childRun.status}`;
      return {
        classification: "route_functional",
        fingerprint: stableRouteFunctionalFingerprint(loop, message),
        evidence: { error: message, stdout: redactedEvidence(run.stdout), stderr: redactedEvidence(childRun.stderr), exitCode: childRun.exitCode },
      };
    }
  }
  return undefined;
}

function targetRoute(loop: Loop): LoopExpectationResult["route"] {
  if (loop.target.type === "agent") {
    return {
      source: "openloops",
      kind: "loop_expectation",
      loopId: loop.id,
      loopName: loop.name,
      cwd: loop.target.cwd,
      provider: loop.target.provider,
    };
  }
  if (loop.target.type === "command") {
    return {
      source: "openloops",
      kind: "loop_expectation",
      loopId: loop.id,
      loopName: loop.name,
      cwd: loop.target.cwd,
    };
  }
  return {
    source: "openloops",
    kind: "loop_expectation",
    loopId: loop.id,
    loopName: loop.name,
  };
}

function recommendedTask(loop: Loop, run: LoopRun, failure: RunFailureSignal, route: LoopExpectationResult["route"]): RecommendedTaskUpsert {
  const title = `BUG: open-loops loop failure - ${loop.name}`;
  const description = [
    `OpenLoops expectation failed for loop ${loop.name} (${loop.id}).`,
    `Run: ${run.id}`,
    `Status: ${run.status}`,
    `Classification: ${failure.classification}`,
    `Fingerprint: ${failure.fingerprint}`,
    `No-tmux routing: Do not dispatch or paste prompts into tmux panes; use task-triggered headless worker/verifier workflows only.`,
    route.cwd ? `Route cwd: ${route.cwd}` : undefined,
    route.provider ? `Provider: ${route.provider}` : undefined,
    failure.evidence.error ? `Error:\n${failure.evidence.error}` : undefined,
    failure.evidence.stderr ? `Stderr:\n${failure.evidence.stderr}` : undefined,
  ].filter(Boolean).join("\n\n");
  const dedupeKey = `openloops:${loop.id}:${failure.fingerprint}`;
  // "loops" is the tag control-room consumers query on; without it the
  // auto-filed failure tasks had no consumer. Keep the legacy tags too.
  const tags = ["bug", "openloops", "loops", "loop-health", failure.classification];
  const priority = failure.classification === "auth" || failure.classification === "rate_limit" ? "high" : "medium";
  return {
    title,
    description,
    priority,
    tags,
    dedupeKey,
    search: { query: dedupeKey },
    compatibilityFallback: {
      search: ["todos", "search", dedupeKey, "--json"],
      add: ["todos", "add", title, "--description", description, "--tag", tags.join(","), "--priority", priority],
      comment: ["todos", "comment", "<task-id>", description],
    },
    futureNativeUpsert: {
      command: "todos task upsert",
      fields: {
        title,
        description,
        priority,
        tags,
        dedupeKey,
        routeSource: route.source,
        routeKind: route.kind,
        routeLoopId: route.loopId,
        routeLoopName: route.loopName,
      },
    },
  };
}

export function expectationForLoop(store: Store, loop: Loop): LoopExpectationResult {
  const latestRun = store.listRuns({ loopId: loop.id, limit: 1 })[0];
  const route = targetRoute(loop);
  if (!latestRun) {
    return {
      loop: { id: loop.id, name: loop.name, status: loop.status, nextRunAt: loop.nextRunAt },
      ok: true,
      check: { id: "latest-run-succeeded", status: "warn", message: "loop has no recorded runs yet" },
      route,
    };
  }
  const routeFailure = detectRouteFunctionalFailure(store, loop, latestRun);
  if (routeFailure) {
    return {
      loop: { id: loop.id, name: loop.name, status: loop.status, nextRunAt: loop.nextRunAt },
      ok: false,
      check: { id: "route-functional-health", status: "fail", message: routeFailure.evidence.error ?? "route functional blocker detected" },
      latestRun: healthRun(latestRun),
      failure: routeFailure,
      route,
      recommendedTask: recommendedTask(loop, latestRun, routeFailure, route),
    };
  }
  if (latestRun.status === "succeeded") {
    return {
      loop: { id: loop.id, name: loop.name, status: loop.status, nextRunAt: loop.nextRunAt },
      ok: true,
      check: { id: "latest-run-succeeded", status: "pass", message: "latest run succeeded" },
      latestRun: healthRun(latestRun),
      route,
    };
  }
  const failure = classifyRunFailure(latestRun);
  if (failure?.classification === "circuit_breaker") {
    // Scheduler circuit-breaker marker: surface it while the loop is paused;
    // a manual resume clears the pause, so the stale marker stops flagging.
    if (loop.status !== "paused") {
      return {
        loop: { id: loop.id, name: loop.name, status: loop.status, nextRunAt: loop.nextRunAt },
        ok: true,
        check: { id: "latest-run-succeeded", status: "warn", message: "circuit breaker cleared by resume; awaiting next run" },
        latestRun: healthRun(latestRun),
        route,
      };
    }
    return {
      loop: { id: loop.id, name: loop.name, status: loop.status, nextRunAt: loop.nextRunAt },
      ok: false,
      check: { id: "latest-run-succeeded", status: "fail", message: latestRun.error ?? "circuit breaker open; loop auto-paused" },
      latestRun: healthRun(latestRun),
      failure,
      route,
      recommendedTask: recommendedTask(loop, latestRun, failure, route),
    };
  }
  if (failure?.classification === "restart_interrupted") {
    return {
      loop: { id: loop.id, name: loop.name, status: loop.status, nextRunAt: loop.nextRunAt },
      ok: true,
      check: { id: "latest-run-succeeded", status: "warn", message: latestRun.error ?? "daemon restart interrupted latest run" },
      latestRun: healthRun(latestRun),
      failure,
      route,
    };
  }
  return {
    loop: { id: loop.id, name: loop.name, status: loop.status, nextRunAt: loop.nextRunAt },
    ok: false,
    check: { id: "latest-run-succeeded", status: "fail", message: `latest run is ${latestRun.status}` },
    latestRun: healthRun(latestRun),
    failure,
    route,
    recommendedTask: failure ? recommendedTask(loop, latestRun, failure, route) : undefined,
  };
}

export function buildHealthReport(store: Store, opts: { includeArchived?: boolean; includeInactive?: boolean; limit?: number } = {}): LoopsHealthReport {
  const loops = store
    .listLoops({ includeArchived: opts.includeArchived, limit: opts.limit ?? 200 })
    .filter((loop) => opts.includeInactive || loop.status === "active" || loop.status === "paused");
  const expectations = loops.map((loop) => expectationForLoop(store, loop));
  const classifications = Object.fromEntries(CLASSIFICATIONS.map((key) => [key, 0])) as Record<RunFailureClassification, number>;
  for (const expectation of expectations) {
    if (expectation.failure) classifications[expectation.failure.classification] += 1;
  }
  const unhealthy = expectations.filter((expectation) => !expectation.ok).length;
  const warnings = expectations.filter((expectation) => expectation.check.status === "warn").length;
  return {
    ok: unhealthy === 0,
    generatedAt: new Date().toISOString(),
    summary: {
      loops: expectations.length,
      healthy: expectations.length - unhealthy,
      unhealthy,
      warnings,
    },
    classifications,
    expectations,
  };
}
