import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Loop, LoopRun, LoopStatus, RunStatus } from "../types.js";
import type { DaemonStatus } from "../daemon/control.js";
import type { DoctorCheck, DoctorReport } from "./doctor.js";
import { redact } from "./format.js";
import { dataDir } from "./paths.js";
import type { Store } from "./store.js";

/**
 * The entire read surface the loop-health classifier needs: loops, and the
 * runs belonging to a loop. The local sqlite {@link Store} satisfies it
 * structurally, and so can an in-memory snapshot pre-fetched from the hosted
 * `/v1` API — which is what lets `loops health` answer against the hosted
 * control plane instead of refusing (task e3b6f1d4).
 *
 * Deliberately narrow: widening it re-couples the classifier to sqlite and
 * silently un-implements the hosted path.
 */
export interface HealthSource {
  listLoops(opts?: { status?: LoopStatus; includeArchived?: boolean; limit?: number }): Loop[];
  listRuns(opts?: { loopId?: string; status?: RunStatus; limit?: number }): LoopRun[];
}

/**
 * Grace period before an active loop whose scheduled slot has passed counts as
 * unclaimed. Matches the floor already used for stale-running detection.
 */
export const DEFAULT_OVERDUE_GRACE_MS = 10 * 60_000;

/**
 * A scheduled slot that came and went without the scheduler claiming it.
 *
 * This is the one signal that separates "the scheduler is alive" from "the
 * scheduler stopped claiming": every other check in this file classifies the
 * *outcome of the last run*, so a dead scheduler reports as uniformly healthy —
 * the last run of every loop succeeded, because it ran before the scheduler
 * died. That is exactly what an operator saw during the 2026-07-31 incident.
 *
 * Passing state: the loop is not active, has no nextRunAt, its nextRunAt is
 * still ahead of `now` (or within `graceMs` of it), or a run for that exact
 * slot is still in flight. Failing state: an active loop whose nextRunAt is
 * more than `graceMs` in the past with no run in flight for that slot. Both are
 * reachable from the same input by moving `nextRunAt` across `now - graceMs`,
 * or by flipping `latestRun` between running-at-slot and terminal.
 *
 * `latestRun` is load-bearing, not a refinement. `nextRunAt` is advanced only
 * AFTER a run finishes (`advanceLoop` in src/daemon/daemon.ts), so a loop whose
 * run is legitimately executing has its slot sitting in the past for the entire
 * run. Without this, a healthy 20-minute run reports as an unclaimed slot —
 * measured on this fleet, where 20 of 200 recent runs exceed 10 minutes. The
 * check would then manufacture the incident it exists to detect.
 *
 * The slot must match. A run wedged on an OLDER slot is not evidence the
 * scheduler is alive — the current slot still went unclaimed — so suppressing
 * on any running run would silence the dead-scheduler case instead.
 */
export function scheduleOverdue(
  loop: Loop,
  now: Date,
  graceMs: number = DEFAULT_OVERDUE_GRACE_MS,
  latestRun?: Pick<LoopRun, "status" | "scheduledFor">,
): { nextRunAt: string; byMs: number } | undefined {
  if (loop.status !== "active") return undefined;
  const nextRunAt = loop.nextRunAt;
  if (!nextRunAt) return undefined;
  const due = Date.parse(nextRunAt);
  if (!Number.isFinite(due)) return undefined;
  const byMs = now.getTime() - due;
  if (byMs <= graceMs) return undefined;
  if (latestRun?.status === "running" && latestRun.scheduledFor === nextRunAt) return undefined;
  return { nextRunAt, byMs };
}

export type RunFailureClassification =
  | "rate_limit"
  | "auth"
  | "provider_capacity"
  | "provider_unavailable"
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
    summary?: string;
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
  loop: Pick<Loop, "id" | "name" | "status" | "nextRunAt" | "retryScheduledFor">;
  ok: boolean;
  check: {
    id: "latest-run-succeeded" | "route-functional-health";
    status: "pass" | "fail" | "warn";
    message: string;
  };
  latestRun?: LoopRun;
  failure?: RunFailureSignal;
  /**
   * Set when the loop's scheduled slot passed without being claimed. Additive
   * and independent of `check`/`ok`, so restoring this signal cannot change an
   * existing verdict or exit code — see {@link scheduleOverdue}.
   */
  overdue?: { nextRunAt: string; byMs: number };
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
    /** Active loops whose scheduled slot passed unclaimed. */
    overdue: number;
  };
  classifications: Record<RunFailureClassification, number>;
  expectations: LoopExpectationResult[];
}

export type HealthScanStatus = "ok" | "degraded" | "critical";
export type HealthScanFindingKind = "daemon" | "doctor" | "preflight" | "latest-run" | "stale-running";
export type HealthScanFindingSeverity = "critical" | "high" | "medium" | "low";

export interface HealthScanSelfHealAction {
  kind: "daemon-start";
  attempted: boolean;
  ok?: boolean;
  reason: string;
  result?: Record<string, unknown>;
}

export interface HealthScanFinding {
  kind: HealthScanFindingKind;
  severity: HealthScanFindingSeverity;
  fingerprint: string;
  title: string;
  message: string;
  loop?: Pick<Loop, "id" | "name" | "status" | "nextRunAt"> & { leaseMs?: number };
  run?: LoopRun;
  route?: LoopExpectationResult["route"];
  ageMs?: number;
  staleThresholdMs?: number;
  classification?: RunFailureClassification;
  doctorCheck?: DoctorCheck;
  recommendedTask?: RecommendedTaskUpsert;
}

export interface LoopsHealthScan {
  ok: boolean;
  status: HealthScanStatus;
  generatedAt: string;
  includedStatuses: LoopStatus[];
  counts: {
    loops: number;
    active: number;
    paused: number;
    stopped: number;
    expired: number;
    latestRunFindings: number;
    staleRunning: number;
    daemonFindings: number;
    doctorFindings: number;
    preflightFindings: number;
    findings: number;
    reportedFindings: number;
    truncatedFindings: number;
  };
  daemon?: Pick<DaemonStatus, "running" | "stale" | "pid" | "host" | "loops" | "runs" | "logPath">;
  doctor?: DoctorReport;
  health: LoopsHealthReport;
  selfHeals: HealthScanSelfHealAction[];
  findings: HealthScanFinding[];
  reports?: {
    dir: string;
    json: string;
    markdown: string;
  };
  todos?: Record<string, unknown>;
}

export interface BuildHealthScanOptions {
  includeStatuses?: LoopStatus[];
  includeArchived?: boolean;
  limit?: number;
  latestRun?: boolean;
  doctor?: DoctorReport;
  daemon?: DaemonStatus;
  selfHeals?: HealthScanSelfHealAction[];
  maxFindings?: number;
  staleRunningMs?: number;
  now?: Date;
}

export interface WriteHealthScanReportsOptions {
  reportDir?: string;
}

const EVIDENCE_CHARS = 2_000;
const FINGERPRINT_EVIDENCE_CHARS = 120;
const DEFAULT_SCAN_LIMIT = 200;
const DEFAULT_SCAN_STATUSES: LoopStatus[] = ["active", "paused"];
const DEFAULT_MAX_FINDINGS = 100;
const MIN_STALE_RUNNING_MS = 10 * 60_000;
const CLASSIFICATIONS: RunFailureClassification[] = [
  "rate_limit",
  "auth",
  "provider_capacity",
  "provider_unavailable",
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
  return [run.error, run.stderr, run.stdout].filter(Boolean).join("\n");
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

function stableScanFingerprint(parts: string[]): string {
  return `openloops:health-scan:${stableFingerprint(parts)}`;
}

function safeHost(value: string | undefined): string | undefined {
  if (!value) return undefined;
  let host = value.trim().replace(/^[a-z]+:\/\//i, "").split(/[/:?#\s)"'\\]+/)[0] ?? "";
  host = host.replace(/^\[|\]$/g, "");
  return /^[a-z0-9.-]+$/i.test(host) ? host.toLowerCase() : undefined;
}

const HOST_AND_PORT_PATTERN = /^[a-z0-9.-]+(?::[0-9]+)?$/i;
const HOST_LABEL_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

function isValidDnsHost(host: string): boolean {
  return host.length <= 253 && host.split(".").every((label) => HOST_LABEL_PATTERN.test(label));
}

function isCursorHost(host: string | undefined): boolean {
  if (!host || !isValidDnsHost(host)) return false;
  return host === "cursor.sh" || host.endsWith(".cursor.sh");
}

function hostFromReferenceToken(rawToken: string): string | undefined {
  const token = rawToken
    .replace(/^[([{<"'`]+/, "")
    .replace(/[)\]}>,"'`;]+$/, "");
  if (!token) return undefined;

  if (/^https?:\/\//i.test(token)) {
    if (token.includes("\\")) return undefined;
    const authority = token.slice(token.indexOf("//") + 2).split(/[/?#]/, 1)[0] ?? "";
    if (!HOST_AND_PORT_PATTERN.test(authority)) return undefined;
    try {
      return safeHost(new URL(token).hostname);
    } catch {
      return undefined;
    }
  }

  return HOST_AND_PORT_PATTERN.test(token) ? safeHost(token) : undefined;
}

function cursorHostFromText(rawText: string): string | undefined {
  for (const token of rawText.split(/\s+/)) {
    const host = hostFromReferenceToken(token);
    if (isCursorHost(host)) return host;
  }
  return undefined;
}

function providerUnavailableSummary(rawText: string): string | undefined {
  const dns = /\bgetaddrinfo\s+(EAI_AGAIN|ENOTFOUND)\s+([a-z0-9.-]+)/i.exec(rawText);
  if (dns) {
    const host = safeHost(dns[2]);
    if (isCursorHost(host)) return `provider DNS lookup failed: ${dns[1]} ${host}`;
  }
  return undefined;
}

function providerCapacitySummary(rawText: string): string | undefined {
  if (!/\bresource[_-]exhausted\b/i.test(rawText)) return undefined;
  const host = cursorHostFromText(rawText);
  if (!host) return undefined;
  return `provider capacity exhausted: resource_exhausted ${host}`;
}

function failureSummary(run: LoopRun, classification: RunFailureClassification, summary?: string): string | undefined {
  if (summary) return summary;
  const text = searchableText(run);
  if (classification === "provider_capacity") return providerCapacitySummary(text);
  if (classification === "provider_unavailable") return providerUnavailableSummary(text);
  return undefined;
}

function stableFailureFingerprint(run: LoopRun, classification: RunFailureClassification, summary?: string): string {
  const evidence = failureSummary(run, classification, summary) ?? run.error ?? run.stderr ?? run.stdout ?? "";
  return stableFingerprint([
    run.loopId,
    classification,
    String(run.status),
    String(run.exitCode ?? ""),
    evidence.replace(/\d{4}-\d{2}-\d{2}T\S+/g, "<timestamp>").slice(0, FINGERPRINT_EVIDENCE_CHARS),
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

function compactText(value: string | undefined, limit = 500): string | undefined {
  const text = redact(bounded(value, limit));
  return text?.replace(/\s+/g, " ").trim();
}

function publicDoctorCheck(check: DoctorCheck): DoctorCheck {
  return {
    id: check.id,
    status: check.status,
    message: redact(bounded(check.message, 500)) ?? "",
    detail: redact(bounded(check.detail, 800)),
  };
}

function publicDoctorReport(report: DoctorReport): DoctorReport {
  return {
    ok: report.ok,
    checks: report.checks.map(publicDoctorCheck),
  };
}

function includedStatusSet(statuses: LoopStatus[] | undefined): Set<LoopStatus> {
  const values = statuses?.length ? statuses : DEFAULT_SCAN_STATUSES;
  return new Set(values);
}

function statusCounts(loops: Loop[]): Pick<LoopsHealthScan["counts"], "loops" | "active" | "paused" | "stopped" | "expired"> {
  return {
    loops: loops.length,
    active: loops.filter((loop) => loop.status === "active").length,
    paused: loops.filter((loop) => loop.status === "paused").length,
    stopped: loops.filter((loop) => loop.status === "stopped").length,
    expired: loops.filter((loop) => loop.status === "expired").length,
  };
}

function compareLoopsForScan(left: Loop, right: Loop): number {
  const statusOrder = left.status.localeCompare(right.status);
  if (statusOrder !== 0) return statusOrder;
  return (left.nextRunAt ?? "").localeCompare(right.nextRunAt ?? "");
}

function scanLoops(store: HealthSource, statuses: LoopStatus[], opts: Pick<BuildHealthScanOptions, "includeArchived" | "limit">): Loop[] {
  const limit = opts.limit ?? DEFAULT_SCAN_LIMIT;
  return statuses
    .flatMap((status) => store.listLoops({ includeArchived: opts.includeArchived, status, limit }))
    .sort(compareLoopsForScan)
    .slice(0, limit);
}

function healthReportForLoops(
  store: HealthSource,
  loops: Loop[],
  generatedAt: string,
  opts: ExpectationOptions = {},
): LoopsHealthReport {
  const expectations = loops.map((loop) => expectationForLoop(store, loop, { now: new Date(generatedAt), ...opts }));
  const classifications = Object.fromEntries(CLASSIFICATIONS.map((key) => [key, 0])) as Record<RunFailureClassification, number>;
  for (const expectation of expectations) {
    if (expectation.failure) classifications[expectation.failure.classification] += 1;
  }
  const unhealthy = expectations.filter((expectation) => !expectation.ok).length;
  const warnings = expectations.filter((expectation) => expectation.check.status === "warn").length;
  const overdue = expectations.filter((expectation) => expectation.overdue).length;
  return {
    ok: unhealthy === 0,
    generatedAt,
    summary: {
      loops: expectations.length,
      healthy: expectations.length - unhealthy,
      unhealthy,
      warnings,
      overdue,
    },
    classifications,
    expectations,
  };
}

function ageMs(run: LoopRun, now: Date): number {
  const stamp = run.startedAt ?? run.createdAt ?? run.scheduledFor;
  const time = Date.parse(stamp);
  return Number.isFinite(time) ? Math.max(0, now.getTime() - time) : 0;
}

function shortLoop(loop: Loop): HealthScanFinding["loop"] {
  return {
    id: loop.id,
    name: loop.name,
    status: loop.status,
    nextRunAt: loop.nextRunAt,
    leaseMs: loop.leaseMs,
  };
}

function priorityForSeverity(severity: HealthScanFindingSeverity): RecommendedTaskUpsert["priority"] {
  if (severity === "critical") return "critical";
  if (severity === "high") return "high";
  if (severity === "low") return "low";
  return "medium";
}

function recommendedFindingTask(finding: Omit<HealthScanFinding, "recommendedTask">, route: LoopExpectationResult["route"] | undefined): RecommendedTaskUpsert {
  const tags = ["bug", "openloops", "loops", "loop-health", finding.kind];
  if (finding.classification) tags.push(finding.classification);
  const description = [
    `Loops health scan found a ${finding.kind} issue.`,
    finding.loop ? `Loop: ${finding.loop.name} (${finding.loop.id})` : undefined,
    finding.run ? `Run: ${finding.run.id}` : undefined,
    finding.classification ? `Classification: ${finding.classification}` : undefined,
    finding.ageMs !== undefined ? `AgeMs: ${finding.ageMs}` : undefined,
    finding.staleThresholdMs !== undefined ? `StaleThresholdMs: ${finding.staleThresholdMs}` : undefined,
    `Fingerprint: ${finding.fingerprint}`,
    `Severity: ${finding.severity}`,
    `No-tmux routing: Do not dispatch or paste prompts into tmux panes; use task-triggered headless worker/verifier workflows only.`,
    route?.cwd ? `Route cwd: ${route.cwd}` : undefined,
    route?.provider ? `Provider: ${route.provider}` : undefined,
    "",
    finding.message,
    finding.run?.error ? `Error:\n${finding.run.error}` : undefined,
    finding.run?.stderr ? `Stderr:\n${finding.run.stderr}` : undefined,
  ].filter(Boolean).join("\n\n");
  return {
    title: finding.title,
    description,
    priority: priorityForSeverity(finding.severity),
    tags,
    dedupeKey: finding.fingerprint,
    search: { query: finding.fingerprint },
    compatibilityFallback: {
      search: ["todos", "search", finding.fingerprint, "--json"],
      add: ["todos", "add", finding.title, "--description", description, "--tag", tags.join(","), "--priority", priorityForSeverity(finding.severity)],
      comment: ["todos", "comment", "<task-id>", description],
    },
    futureNativeUpsert: {
      command: "todos task upsert",
      fields: {
        title: finding.title,
        description,
        priority: priorityForSeverity(finding.severity),
        tags,
        dedupeKey: finding.fingerprint,
        routeSource: route?.source ?? "openloops",
        routeKind: route?.kind ?? "health_scan",
        routeLoopId: finding.loop?.id ?? "",
        routeLoopName: finding.loop?.name ?? "",
      },
    },
  };
}

function daemonFinding(daemon: DaemonStatus): HealthScanFinding | undefined {
  if (daemon.running && !daemon.stale) return undefined;
  const reason = daemon.stale ? "daemon pid file is stale" : "daemon is not running";
  const severity: HealthScanFindingSeverity = "critical";
  const finding: Omit<HealthScanFinding, "recommendedTask"> = {
    kind: "daemon",
    severity,
    fingerprint: `openloops:health-scan:daemon:${daemon.stale ? "stale" : "not-running"}`,
    title: "Loops daemon health issue",
    message: reason,
  };
  return {
    ...finding,
    recommendedTask: recommendedFindingTask(finding, undefined),
  };
}

function doctorSeverity(check: DoctorCheck): HealthScanFindingSeverity {
  if (check.status === "fail" && check.id === "data-dir") return "critical";
  if (check.status === "fail") return "high";
  return "medium";
}

function doctorFinding(check: DoctorCheck, loop: Loop | undefined, route: LoopExpectationResult["route"] | undefined): HealthScanFinding | undefined {
  if (check.status === "ok" || check.id === "loop-runs") return undefined;
  const kind: HealthScanFindingKind = check.id.startsWith("loop:") && check.id.endsWith(":preflight") ? "preflight" : "doctor";
  const severity = kind === "preflight" && check.status === "fail" ? "high" : doctorSeverity(check);
  const fingerprint = stableScanFingerprint(["doctor", check.id, check.status, check.message, check.detail ?? ""]);
  const finding: Omit<HealthScanFinding, "recommendedTask"> = {
    kind,
    severity,
    fingerprint,
    title: kind === "preflight" && loop ? `Loops preflight issue - ${loop.name}` : `Loops doctor issue - ${check.id}`,
    message: [check.status, check.message, check.detail].filter(Boolean).join(" "),
    loop: loop ? shortLoop(loop) : undefined,
    route,
    doctorCheck: publicDoctorCheck(check),
  };
  return {
    ...finding,
    recommendedTask: recommendedFindingTask(finding, route),
  };
}

function latestRunFinding(expectation: LoopExpectationResult): HealthScanFinding | undefined {
  if (expectation.ok || !expectation.latestRun || expectation.latestRun.status === "running") return undefined;
  const failure = expectation.failure;
  if (!failure) return undefined;
  const severity: HealthScanFindingSeverity = expectation.loop.status === "active" ? "high" : "medium";
  return {
    kind: "latest-run",
    severity,
    fingerprint: expectation.recommendedTask?.dedupeKey ?? `openloops:${expectation.loop.id}:${failure.fingerprint}`,
    title: expectation.recommendedTask?.title ?? `Loops latest run failed - ${expectation.loop.name}`,
    message: expectation.check.message,
    loop: expectation.loop,
    run: expectation.latestRun,
    route: expectation.route,
    classification: failure.classification,
    doctorCheck: undefined,
    recommendedTask: expectation.recommendedTask,
  };
}

function staleRunningFinding(loop: Loop, expectation: LoopExpectationResult, now: Date, staleRunningMs: number): HealthScanFinding | undefined {
  const run = expectation.latestRun;
  if (loop.status !== "active" || run?.status !== "running") return undefined;
  const threshold = Math.max(loop.leaseMs, staleRunningMs, MIN_STALE_RUNNING_MS);
  const age = ageMs(run, now);
  if (age <= threshold) return undefined;
  const fingerprint = `openloops:health-scan:stale-running:${loop.id}:${run.id}`;
  const message = `active loop latest run is still running after ${age}ms (threshold ${threshold}ms)`;
  const finding: Omit<HealthScanFinding, "recommendedTask"> = {
    kind: "stale-running",
    severity: "critical",
    fingerprint,
    title: `Loops stale running run - ${loop.name}`,
    message,
    loop: shortLoop(loop),
    run,
    route: expectation.route,
    ageMs: age,
    staleThresholdMs: threshold,
  };
  return {
    ...finding,
    recommendedTask: recommendedFindingTask(finding, expectation.route),
  };
}

function scanStatus(findings: HealthScanFinding[]): HealthScanStatus {
  if (findings.some((finding) => finding.severity === "critical")) return "critical";
  if (findings.length > 0) return "degraded";
  return "ok";
}

function timestampDir(root: string, generatedAt: string): string {
  const stamp = generatedAt.replace(/[-:]/g, "").replace(/\./g, "");
  return join(root, stamp);
}

function healthScanMarkdown(scan: LoopsHealthScan): string {
  return [
    "# Loops Health Scan",
    "",
    `- status: ${scan.status}`,
    `- generated_at: ${scan.generatedAt}`,
    `- included_statuses: ${scan.includedStatuses.join(",")}`,
    `- loops: total=${scan.counts.loops} active=${scan.counts.active} paused=${scan.counts.paused} stopped=${scan.counts.stopped} expired=${scan.counts.expired}`,
    `- findings: total=${scan.counts.findings} reported=${scan.counts.reportedFindings} truncated=${scan.counts.truncatedFindings} latest_run=${scan.counts.latestRunFindings} stale_running=${scan.counts.staleRunning} daemon=${scan.counts.daemonFindings} doctor=${scan.counts.doctorFindings} preflight=${scan.counts.preflightFindings}`,
    scan.daemon ? `- daemon: running=${scan.daemon.running} stale=${scan.daemon.stale} pid=${scan.daemon.pid ?? "none"}` : "- daemon: not checked",
    scan.doctor ? `- doctor_ok: ${scan.doctor.ok}` : "- doctor: not checked",
    scan.selfHeals.length ? `- self_heals: ${scan.selfHeals.map((action) => `${action.kind}:${action.attempted ? action.ok ? "ok" : "failed" : "skipped"}`).join(",")}` : "- self_heals: none",
    "",
    "## Findings",
    scan.findings.length
      ? scan.findings.map((finding) => `- ${finding.severity} ${finding.kind} ${finding.fingerprint} ${finding.loop ? `${finding.loop.name}: ` : ""}${compactText(finding.message, 240) ?? ""}`).join("\n")
      : "None.",
  ].join("\n");
}

export function classifyRunFailure(run: LoopRun): RunFailureSignal | undefined {
  if (run.status === "succeeded" || run.status === "running") return undefined;
  const rawText = searchableText(run);
  const text = rawText.toLowerCase();
  let classification: RunFailureClassification = "unknown";
  let summary: string | undefined;
  if (run.status === "timed_out") classification = "timeout";
  else if (run.status === "skipped" && run.error?.startsWith(RESTART_INTERRUPTED_RUN_PREFIX)) classification = "restart_interrupted";
  else if (run.status === "skipped" && /circuit breaker open/.test(text)) classification = "circuit_breaker";
  else if (run.status === "skipped" && /previous run still active/.test(text)) classification = "skipped_previous_active";
  else if (/runtime preflight failed|preflight failed|executable not found in path|none of required executables found|auth profile preflight failed|profile not found/.test(text)) classification = "preflight";
  else if (/rate limit|too many requests|429\b|quota exceeded/.test(text)) classification = "rate_limit";
  else if (
    /unauthorized|authentication|auth\b|api key|invalid token|permission denied|401\b|403\b|not logged in|please run \/login|login required|not authenticated|failed to authenticate/.test(
      text,
    )
  ) classification = "auth";
  else if ((summary = providerCapacitySummary(rawText))) classification = "provider_capacity";
  else if ((summary = providerUnavailableSummary(rawText))) classification = "provider_unavailable";
  else if (/model .*not found|model_not_found|unknown model|invalid model|404.*model/.test(text)) classification = "model_not_found";
  else if (/context length|context_length|context window|maximum context|token limit|too many tokens/.test(text)) classification = "context_length";
  else if (/response_format|json schema|schema validation|invalid schema|structured output/.test(text)) classification = "schema_response_format";
  else if (/cannot find module|module not found|node:internal|bun: command not found|node: command not found|npm err!|err_module_not_found/.test(text)) classification = "node_init";
  else if (/sigsegv|segmentation fault|signal 11/.test(text)) classification = "sigsegv";

  return {
    classification,
    fingerprint: stableFailureFingerprint(run, classification, summary),
    evidence: {
      summary,
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

function detectRouteFunctionalFailure(store: HealthSource, loop: Loop, run: LoopRun): RunFailureSignal | undefined {
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

function expectationLoop(loop: Loop): LoopExpectationResult["loop"] {
  return { id: loop.id, name: loop.name, status: loop.status, nextRunAt: loop.nextRunAt, retryScheduledFor: loop.retryScheduledFor };
}

function hasPendingRetry(loop: Loop, run: LoopRun): boolean {
  return loop.status === "active" && loop.retryScheduledFor === run.scheduledFor && run.attempt < loop.maxAttempts;
}

function isHighPriorityFailure(classification: RunFailureClassification): boolean {
  return classification === "auth" || classification === "rate_limit" || classification === "provider_capacity" || classification === "provider_unavailable";
}

function isRetryPendingProviderFailure(classification: RunFailureClassification): boolean {
  return classification === "provider_capacity" || classification === "provider_unavailable";
}

function providerRetryMessage(classification: RunFailureClassification): string {
  if (classification === "provider_capacity") return "provider capacity/resource exhaustion; retry is scheduled";
  return "provider unavailable/network failure; retry is scheduled";
}

function recommendedTask(loop: Loop, run: LoopRun, failure: RunFailureSignal, route: LoopExpectationResult["route"]): RecommendedTaskUpsert {
  const title = `BUG: Loops loop failure - ${loop.name}`;
  const description = [
    `Loops expectation failed for loop ${loop.name} (${loop.id}).`,
    `Run: ${run.id}`,
    `Status: ${run.status}`,
    `Classification: ${failure.classification}`,
    `Fingerprint: ${failure.fingerprint}`,
    `No-tmux routing: Do not dispatch or paste prompts into tmux panes; use task-triggered headless worker/verifier workflows only.`,
    route.cwd ? `Route cwd: ${route.cwd}` : undefined,
    route.provider ? `Provider: ${route.provider}` : undefined,
    failure.evidence.summary ? `Summary: ${failure.evidence.summary}` : undefined,
    failure.evidence.error ? `Error:\n${failure.evidence.error}` : undefined,
    failure.evidence.stderr ? `Stderr:\n${failure.evidence.stderr}` : undefined,
  ].filter(Boolean).join("\n\n");
  const dedupeKey = `openloops:${loop.id}:${failure.fingerprint}`;
  // "loops" is the tag control-room consumers query on; without it the
  // auto-filed failure tasks had no consumer. Keep the legacy tags too.
  const tags = ["bug", "openloops", "loops", "loop-health", failure.classification];
  const priority = isHighPriorityFailure(failure.classification) ? "high" : "medium";
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

export interface ExpectationOptions {
  now?: Date;
  overdueGraceMs?: number;
}

/**
 * Classify a loop, then attach the unclaimed-slot observation. The two are kept
 * separate on purpose: `classifyExpectation` decides `ok`/`check` exactly as it
 * always has, and `overdue` rides alongside without touching either.
 *
 * `result.latestRun` is the run `classifyExpectation` already fetched, so
 * feeding it to `scheduleOverdue` costs no extra round trip — this matters on
 * the hosted path, where each loop's latest run is one HTTP request.
 */
export function expectationForLoop(
  store: HealthSource,
  loop: Loop,
  opts: ExpectationOptions = {},
): LoopExpectationResult {
  const result = classifyExpectation(store, loop);
  const overdue = scheduleOverdue(loop, opts.now ?? new Date(), opts.overdueGraceMs, result.latestRun);
  return overdue ? { ...result, overdue } : result;
}

function classifyExpectation(store: HealthSource, loop: Loop): LoopExpectationResult {
  const latestRun = store.listRuns({ loopId: loop.id, limit: 1 })[0];
  const route = targetRoute(loop);
  if (!latestRun) {
    return {
      loop: expectationLoop(loop),
      ok: true,
      check: { id: "latest-run-succeeded", status: "warn", message: "loop has no recorded runs yet" },
      route,
    };
  }
  const routeFailure = detectRouteFunctionalFailure(store, loop, latestRun);
  if (routeFailure) {
    return {
      loop: expectationLoop(loop),
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
      loop: expectationLoop(loop),
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
        loop: expectationLoop(loop),
        ok: true,
        check: { id: "latest-run-succeeded", status: "warn", message: "circuit breaker cleared by resume; awaiting next run" },
        latestRun: healthRun(latestRun),
        route,
      };
    }
    return {
      loop: expectationLoop(loop),
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
      loop: expectationLoop(loop),
      ok: true,
      check: { id: "latest-run-succeeded", status: "warn", message: latestRun.error ?? "daemon restart interrupted latest run" },
      latestRun: healthRun(latestRun),
      failure,
      route,
    };
  }
  if (failure && isRetryPendingProviderFailure(failure.classification) && hasPendingRetry(loop, latestRun)) {
    const message = [
      providerRetryMessage(failure.classification),
      loop.nextRunAt ? `next attempt at ${loop.nextRunAt}` : undefined,
      failure.evidence.summary,
    ].filter(Boolean).join("; ");
    return {
      loop: expectationLoop(loop),
      ok: true,
      check: { id: "latest-run-succeeded", status: "warn", message },
      latestRun: healthRun(latestRun),
      failure,
      route,
    };
  }
  return {
    loop: expectationLoop(loop),
    ok: false,
    check: { id: "latest-run-succeeded", status: "fail", message: `latest run is ${latestRun.status}` },
    latestRun: healthRun(latestRun),
    failure,
    route,
    recommendedTask: failure ? recommendedTask(loop, latestRun, failure, route) : undefined,
  };
}

export function buildHealthReport(
  store: HealthSource,
  opts: { includeArchived?: boolean; includeInactive?: boolean; limit?: number } & ExpectationOptions = {},
): LoopsHealthReport {
  const now = opts.now ?? new Date();
  const loops = store
    .listLoops({ includeArchived: opts.includeArchived, limit: opts.limit ?? 200 })
    .filter((loop) => opts.includeInactive || loop.status === "active" || loop.status === "paused");
  const expectations = loops.map((loop) => expectationForLoop(store, loop, { now, overdueGraceMs: opts.overdueGraceMs }));
  const classifications = Object.fromEntries(CLASSIFICATIONS.map((key) => [key, 0])) as Record<RunFailureClassification, number>;
  for (const expectation of expectations) {
    if (expectation.failure) classifications[expectation.failure.classification] += 1;
  }
  const unhealthy = expectations.filter((expectation) => !expectation.ok).length;
  const warnings = expectations.filter((expectation) => expectation.check.status === "warn").length;
  const overdue = expectations.filter((expectation) => expectation.overdue).length;
  return {
    ok: unhealthy === 0,
    generatedAt: now.toISOString(),
    summary: {
      loops: expectations.length,
      healthy: expectations.length - unhealthy,
      unhealthy,
      warnings,
      overdue,
    },
    classifications,
    expectations,
  };
}

export function buildHealthScan(store: Store, opts: BuildHealthScanOptions = {}): LoopsHealthScan {
  const generatedAt = (opts.now ?? new Date()).toISOString();
  const now = opts.now ?? new Date(generatedAt);
  const includeStatuses = [...includedStatusSet(opts.includeStatuses)];
  const loops = scanLoops(store, includeStatuses, opts);
  const health = healthReportForLoops(store, loops, generatedAt);
  const expectationsByLoopId = new Map(health.expectations.map((expectation) => [expectation.loop.id, expectation]));
  const loopsById = new Map(loops.map((loop) => [loop.id, loop]));
  const maxFindings = Math.max(0, opts.maxFindings ?? DEFAULT_MAX_FINDINGS);
  const allFindings: HealthScanFinding[] = [];
  const pushFinding = (finding: HealthScanFinding | undefined): void => {
    if (!finding) return;
    allFindings.push(finding);
  };

  if (opts.daemon) pushFinding(daemonFinding(opts.daemon));

  if (opts.latestRun !== false) {
    for (const loop of loops) {
      const expectation = expectationsByLoopId.get(loop.id);
      if (!expectation) continue;
      pushFinding(staleRunningFinding(loop, expectation, now, opts.staleRunningMs ?? MIN_STALE_RUNNING_MS));
      pushFinding(latestRunFinding(expectation));
    }
  }

  const doctor = opts.doctor ? publicDoctorReport(opts.doctor) : undefined;
  if (doctor) {
    for (const check of doctor.checks) {
      const preflightLoopId = check.id.startsWith("loop:") && check.id.endsWith(":preflight")
        ? check.id.slice("loop:".length, -":preflight".length)
        : undefined;
      const loop = preflightLoopId ? loopsById.get(preflightLoopId) : undefined;
      const route = preflightLoopId ? expectationsByLoopId.get(preflightLoopId)?.route : undefined;
      pushFinding(doctorFinding(check, loop, route));
    }
  }

  const findings = allFindings.slice(0, maxFindings);
  const status = scanStatus(allFindings);
  const baseCounts = statusCounts(loops);
  return {
    ok: status === "ok",
    status,
    generatedAt,
    includedStatuses: includeStatuses,
    counts: {
      ...baseCounts,
      latestRunFindings: allFindings.filter((finding) => finding.kind === "latest-run").length,
      staleRunning: allFindings.filter((finding) => finding.kind === "stale-running").length,
      daemonFindings: allFindings.filter((finding) => finding.kind === "daemon").length,
      doctorFindings: allFindings.filter((finding) => finding.kind === "doctor").length,
      preflightFindings: allFindings.filter((finding) => finding.kind === "preflight").length,
      findings: allFindings.length,
      reportedFindings: findings.length,
      truncatedFindings: Math.max(0, allFindings.length - findings.length),
    },
    daemon: opts.daemon
      ? {
          running: opts.daemon.running,
          stale: opts.daemon.stale,
          pid: opts.daemon.pid,
          host: opts.daemon.host,
          loops: opts.daemon.loops,
          runs: opts.daemon.runs,
          logPath: opts.daemon.logPath,
        }
      : undefined,
    doctor,
    health,
    selfHeals: opts.selfHeals ?? [],
    findings,
  };
}

export function writeHealthScanReports(scan: LoopsHealthScan, opts: WriteHealthScanReportsOptions = {}): LoopsHealthScan {
  const root = opts.reportDir ?? join(dataDir(), "reports", "health-scan");
  const dir = timestampDir(root, scan.generatedAt);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const json = join(dir, "summary.json");
  const markdown = join(dir, "report.md");
  const withReports: LoopsHealthScan = {
    ...scan,
    reports: { dir, json, markdown },
  };
  writeFileSync(json, JSON.stringify(withReports, null, 2), { mode: 0o600 });
  writeFileSync(markdown, healthScanMarkdown(withReports), { mode: 0o600 });
  return withReports;
}
