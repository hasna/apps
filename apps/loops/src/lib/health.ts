import { createHash } from "node:crypto";
import type { Loop, LoopRun } from "../types.js";
import type { Store } from "./store.js";

export type RunFailureClassification =
  | "rate_limit"
  | "auth"
  | "model_not_found"
  | "context_length"
  | "schema_response_format"
  | "node_init"
  | "preflight"
  | "timeout"
  | "sigsegv"
  | "skipped_previous_active"
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
    id: "latest-run-succeeded";
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
  "timeout",
  "sigsegv",
  "skipped_previous_active",
  "unknown",
];

function bounded(value: string | undefined, limit = EVIDENCE_CHARS): string | undefined {
  if (!value) return undefined;
  if (value.length <= limit) return value;
  return `${value.slice(0, limit)}\n[truncated ${value.length - limit} chars]`;
}

function searchableText(run: LoopRun): string {
  return [run.error, run.stderr, run.stdout].filter(Boolean).join("\n").toLowerCase();
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

function healthRun(run: LoopRun): LoopRun {
  return {
    ...run,
    error: bounded(run.error),
    stdout: bounded(run.stdout),
    stderr: bounded(run.stderr),
  };
}

export function classifyRunFailure(run: LoopRun): RunFailureSignal | undefined {
  if (run.status === "succeeded" || run.status === "running") return undefined;
  const text = searchableText(run);
  let classification: RunFailureClassification = "unknown";
  if (run.status === "timed_out") classification = "timeout";
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
      error: bounded(run.error),
      stdout: bounded(run.stdout),
      stderr: bounded(run.stderr),
      exitCode: run.exitCode,
    },
  };
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
  const tags = ["bug", "openloops", "loop-health", failure.classification];
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
      command: "todos upsert",
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
