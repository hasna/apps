import { createHash } from "node:crypto";
import { runMonitorCheck, type HostedDnsResolver, type HostedHttpRequestLike } from "./checks.js";
import { probeResultPayloadHash } from "./probes.js";
import {
  sanitizePostgresRuntimeError,
  type PostgresCheckJobRecord,
  type PostgresMonitorSnapshot,
  type PostgresRuntime,
  type SubmitPostgresProbeCheckResult,
} from "./postgres-runtime.js";
import type { CheckAttemptResult, CheckEvidence, CheckResult, Monitor } from "./types.js";

export interface HostedPublicCheckRunner {
  runDueHostedPublicChecks(now?: Date, options?: { workspaceId?: string }): Promise<CheckResult[]>;
}

export interface HostedPublicChecksWorkerOptions {
  runner: HostedPublicCheckRunner;
  workspaceId?: string;
  intervalMs?: number;
  maxRuntimeMs?: number;
  maxIterations?: number;
  signal?: AbortSignal;
  now?: () => Date;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  onIteration?: (iteration: HostedPublicChecksWorkerIteration) => void;
}

export interface HostedPublicChecksWorkerIteration {
  iteration: number;
  checked: number;
  startedAt: string;
  finishedAt: string;
}

export interface HostedPublicChecksWorkerSummary {
  kind: "open-uptime.hosted-public-checks-worker";
  status: "completed" | "stopped";
  workspaceId: string | null;
  iterations: number;
  checked: number;
  startedAt: string;
  finishedAt: string;
}

export interface PostgresPublicProbeRuntime {
  listDueCheckJobs(options?: { workspaceId?: string; now?: string; limit?: number }): Promise<PostgresCheckJobRecord[]>;
  claimCheckJob(input: { workspaceId?: string; jobId: string; probeId: string; leaseTtlMs?: number }): Promise<PostgresCheckJobRecord | null>;
  getMonitor(input: { workspaceId?: string; id: string }): Promise<PostgresMonitorSnapshot | null>;
  cancelClaimedCheckJob(input: {
    workspaceId?: string;
    jobId: string;
    probeId: string;
    fencingToken: string;
    reason?: string | null;
    actor?: string | null;
    origin?: string | null;
    idempotencyKey?: string | null;
  }): Promise<PostgresCheckJobRecord | null>;
  submitProbeCheckResult(input: {
    workspaceId?: string;
    jobId: string;
    probeId: string;
    fencingToken: string;
    nonce: string;
    checkedAt: string;
    status: "up" | "down";
    latencyMs?: number | null;
    statusCode?: number | null;
    error?: string | null;
    attemptCount?: number;
    evidence?: CheckEvidence | null;
    payloadHash: string;
    actor?: string | null;
    origin?: string | null;
    idempotencyKey?: string | null;
  }): Promise<SubmitPostgresProbeCheckResult>;
  recordAuditEvent?(input: {
    workspaceId?: string;
    action: string;
    resourceType?: string | null;
    resourceId?: string | null;
    message?: string | null;
    metadata?: Record<string, unknown>;
    actor?: string | null;
    origin?: string | null;
    idempotencyKey?: string | null;
  }): Promise<unknown>;
}

export interface PostgresPublicProbeWorkerOptions {
  runtime: PostgresPublicProbeRuntime | PostgresRuntime;
  probeId: string;
  workspaceId?: string;
  now?: () => Date;
  limit?: number;
  maxJobs?: number;
  leaseTtlMs?: number;
  hostedResolveHost?: HostedDnsResolver;
  hostedHttpRequest?: HostedHttpRequestLike;
  hostedMaxRedirects?: number;
}

export interface PostgresPublicProbeWorkerJobResult {
  jobId: string;
  monitorId: string | null;
  action: "submitted" | "skipped" | "failed";
  status: "up" | "down" | null;
  checkResultId: string | null;
  reason: string | null;
}

export interface PostgresPublicProbeWorkerSummary {
  kind: "open-uptime.postgres-public-probe-worker";
  status: "completed" | "partial";
  workspaceId: string | null;
  probeId: string;
  discovered: number;
  claimed: number;
  submitted: number;
  skipped: number;
  failed: number;
  startedAt: string;
  finishedAt: string;
  results: PostgresPublicProbeWorkerJobResult[];
}

const DEFAULT_INTERVAL_MS = 30_000;

export async function runHostedPublicChecksWorker(options: HostedPublicChecksWorkerOptions): Promise<HostedPublicChecksWorkerSummary> {
  const intervalMs = normalizePositiveInteger(options.intervalMs ?? DEFAULT_INTERVAL_MS, "intervalMs");
  const maxRuntimeMs = options.maxRuntimeMs === undefined ? undefined : normalizePositiveInteger(options.maxRuntimeMs, "maxRuntimeMs");
  const maxIterations = options.maxIterations === undefined ? undefined : normalizePositiveInteger(options.maxIterations, "maxIterations");
  const clock = options.now ?? (() => new Date());
  const sleep = options.sleep ?? abortableSleep;
  const startedAtDate = clock();
  const startedAt = startedAtDate.toISOString();
  const deadline = maxRuntimeMs === undefined ? undefined : startedAtDate.getTime() + maxRuntimeMs;
  let iterations = 0;
  let checked = 0;

  while (!options.signal?.aborted) {
    if (maxIterations !== undefined && iterations >= maxIterations) break;
    const now = clock();
    if (deadline !== undefined && now.getTime() >= deadline) break;

    const iteration = iterations + 1;
    const iterationStartedAt = now.toISOString();
    const results = await options.runner.runDueHostedPublicChecks(now, { workspaceId: options.workspaceId });
    const finishedAt = clock().toISOString();
    iterations = iteration;
    checked += results.length;
    options.onIteration?.({
      iteration,
      checked: results.length,
      startedAt: iterationStartedAt,
      finishedAt,
    });

    if (maxIterations !== undefined && iterations >= maxIterations) break;
    if (deadline !== undefined && clock().getTime() >= deadline) break;
    await sleep(intervalMs, options.signal);
  }

  return {
    kind: "open-uptime.hosted-public-checks-worker",
    status: options.signal?.aborted ? "stopped" : "completed",
    workspaceId: options.workspaceId?.trim() || null,
    iterations,
    checked,
    startedAt,
    finishedAt: clock().toISOString(),
  };
}

export async function runPostgresPublicProbeWorker(options: PostgresPublicProbeWorkerOptions): Promise<PostgresPublicProbeWorkerSummary> {
  const probeId = normalizeRequiredText(options.probeId, "probeId");
  const limit = normalizePositiveInteger(options.limit ?? options.maxJobs ?? 10, "limit");
  const maxJobs = normalizePositiveInteger(options.maxJobs ?? limit, "maxJobs");
  const leaseTtlMs = normalizePositiveInteger(options.leaseTtlMs ?? 120_000, "leaseTtlMs");
  const clock = options.now ?? (() => new Date());
  const startedAt = clock().toISOString();
  const workspaceId = normalizeOptionalText(options.workspaceId);
  const due = await options.runtime.listDueCheckJobs({
    workspaceId,
    now: startedAt,
    limit,
  });
  const results: PostgresPublicProbeWorkerJobResult[] = [];
  let claimedCount = 0;
  let submittedCount = 0;
  let skippedCount = 0;
  let failedCount = 0;

  for (const candidate of due.slice(0, maxJobs)) {
    try {
      const claimed = await options.runtime.claimCheckJob({
        workspaceId: candidate.workspaceId,
        jobId: candidate.id,
        probeId,
        leaseTtlMs,
      });
      if (!claimed?.fencingToken) {
        skippedCount += 1;
        results.push({ jobId: candidate.id, monitorId: candidate.monitorId, action: "skipped", status: null, checkResultId: null, reason: "not_claimed" });
        continue;
      }
      claimedCount += 1;
      if (claimed.monitorSnapshot.kind !== "http" && claimed.monitorSnapshot.kind !== "tcp") {
        const cancelled = await cancelClaimedJob(options.runtime, claimed, probeId, "unsupported_monitor_kind");
        if (!cancelled) throw new Error("failed to cancel unsupported_monitor_kind job");
        skippedCount += 1;
        results.push({ jobId: claimed.id, monitorId: claimed.monitorId, action: "skipped", status: null, checkResultId: null, reason: "unsupported_monitor_kind" });
        continue;
      }
      if (!claimed.monitorSnapshot.enabled) {
        const cancelled = await cancelClaimedJob(options.runtime, claimed, probeId, "snapshot_monitor_disabled");
        if (!cancelled) throw new Error("failed to cancel snapshot_monitor_disabled job");
        skippedCount += 1;
        results.push({ jobId: claimed.id, monitorId: claimed.monitorId, action: "skipped", status: null, checkResultId: null, reason: "snapshot_monitor_disabled" });
        continue;
      }
      const monitorRecord = await options.runtime.getMonitor({ workspaceId: claimed.workspaceId, id: claimed.monitorId });
      if (!monitorRecord) {
        const cancelled = await cancelClaimedJob(options.runtime, claimed, probeId, "monitor_missing");
        if (!cancelled) throw new Error("failed to cancel monitor_missing job");
        skippedCount += 1;
        results.push({ jobId: claimed.id, monitorId: claimed.monitorId, action: "skipped", status: null, checkResultId: null, reason: "monitor_missing" });
        continue;
      }
      if (!monitorRecord.enabled) {
        const cancelled = await cancelClaimedJob(options.runtime, claimed, probeId, "monitor_disabled");
        if (!cancelled) throw new Error("failed to cancel monitor_disabled job");
        skippedCount += 1;
        results.push({ jobId: claimed.id, monitorId: monitorRecord.id, action: "skipped", status: null, checkResultId: null, reason: "monitor_disabled" });
        continue;
      }
      if (monitorRecord.revision !== claimed.monitorRevision) {
        const cancelled = await cancelClaimedJob(options.runtime, claimed, probeId, "monitor_revision_changed");
        if (!cancelled) throw new Error("failed to cancel monitor_revision_changed job");
        skippedCount += 1;
        results.push({ jobId: claimed.id, monitorId: monitorRecord.id, action: "skipped", status: null, checkResultId: null, reason: "monitor_revision_changed" });
        continue;
      }
      const monitor = postgresMonitorSnapshotToMonitor(claimed.monitorSnapshot);
      const checkedAt = clock().toISOString();
      const attempt = await runPostgresPublicProbeAttempt(monitor, options);
      const nonce = deterministicProbeNonce({
        workspaceId: claimed.workspaceId,
        jobId: claimed.id,
        probeId,
        fencingToken: claimed.fencingToken,
      });
      const payload = {
        probeId,
        jobId: claimed.id,
        scheduleSlot: claimed.scheduleSlot,
        fencingToken: claimed.fencingToken,
        monitorId: monitor.id,
        nonce,
        checkedAt,
        status: attempt.status,
        latencyMs: attempt.latencyMs,
        statusCode: attempt.statusCode ?? null,
        error: attempt.error ?? null,
        attemptCount: attempt.attemptCount,
        monitorRevision: claimed.monitorRevision,
        evidence: attempt.evidence ?? null,
      };
      const submitted = await options.runtime.submitProbeCheckResult({
        workspaceId: claimed.workspaceId,
        jobId: claimed.id,
        probeId,
        fencingToken: claimed.fencingToken,
        nonce,
        checkedAt,
        status: attempt.status,
        latencyMs: attempt.latencyMs,
        statusCode: attempt.statusCode ?? null,
        error: attempt.error ?? null,
        attemptCount: attempt.attemptCount,
        evidence: attempt.evidence ?? null,
        payloadHash: probeResultPayloadHash(payload),
        actor: "postgres-public-probe-worker",
        origin: "open-uptime.worker.postgres-public-probe",
        idempotencyKey: nonce,
      });
      submittedCount += 1;
      results.push({
        jobId: claimed.id,
        monitorId: monitor.id,
        action: "submitted",
        status: submitted.result.status,
        checkResultId: submitted.result.id,
        reason: null,
      });
    } catch (error) {
      failedCount += 1;
      results.push({
        jobId: candidate.id,
        monitorId: candidate.monitorId,
        action: "failed",
        status: null,
        checkResultId: null,
        reason: sanitizeWorkerError(error),
      });
      await options.runtime.recordAuditEvent?.({
        workspaceId: candidate.workspaceId,
        action: "postgres_public_probe_worker.error",
        resourceType: "check_job",
        resourceId: candidate.id,
        message: "Postgres public probe worker failed to process a job",
        metadata: { reason: sanitizeWorkerError(error) },
        actor: "postgres-public-probe-worker",
        origin: "open-uptime.worker.postgres-public-probe",
      });
    }
  }

  return {
    kind: "open-uptime.postgres-public-probe-worker",
    status: failedCount > 0 ? "partial" : "completed",
    workspaceId: workspaceId ?? null,
    probeId,
    discovered: due.length,
    claimed: claimedCount,
    submitted: submittedCount,
    skipped: skippedCount,
    failed: failedCount,
    startedAt,
    finishedAt: clock().toISOString(),
    results,
  };
}

function normalizePositiveInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
  return value;
}

async function runPostgresPublicProbeAttempt(
  monitor: Monitor,
  options: Pick<PostgresPublicProbeWorkerOptions, "hostedResolveHost" | "hostedHttpRequest" | "hostedMaxRedirects">,
): Promise<CheckAttemptResult & { attemptCount: number }> {
  const maxAttempts = Math.max(1, monitor.retryCount + 1);
  let last: CheckAttemptResult | null = null;
  for (let attemptCount = 1; attemptCount <= maxAttempts; attemptCount += 1) {
    if (monitor.kind !== "http" && monitor.kind !== "tcp") {
      throw new Error("public probe workers support only HTTP and TCP monitors");
    }
    last = await runMonitorCheck(monitor, {
      hostedTargetPolicy: true,
      resolveHost: options.hostedResolveHost,
      hostedHttpRequest: options.hostedHttpRequest,
      maxRedirects: options.hostedMaxRedirects,
    });
    if (last.status === "up") return { ...last, attemptCount };
  }
  return { ...last!, attemptCount: maxAttempts };
}

async function cancelClaimedJob(runtime: PostgresPublicProbeRuntime | PostgresRuntime, job: PostgresCheckJobRecord, probeId: string, reason: string): Promise<boolean> {
  if (!job.fencingToken) return false;
  const cancelled = await runtime.cancelClaimedCheckJob({
    workspaceId: job.workspaceId,
    jobId: job.id,
    probeId,
    fencingToken: job.fencingToken,
    reason,
    actor: "postgres-public-probe-worker",
    origin: "open-uptime.worker.postgres-public-probe",
    idempotencyKey: deterministicProbeNonce({
      workspaceId: job.workspaceId,
      jobId: job.id,
      probeId,
      fencingToken: job.fencingToken,
    }),
  });
  return Boolean(cancelled);
}

function postgresMonitorSnapshotToMonitor(record: PostgresMonitorSnapshot): Monitor {
  return {
    id: record.id,
    workspaceId: record.workspaceId,
    name: record.name,
    kind: record.kind,
    url: record.url,
    host: record.host,
    port: record.port,
    method: record.method,
    expectedStatus: record.expectedStatus,
    intervalSeconds: record.intervalSeconds,
    timeoutMs: record.timeoutMs,
    retryCount: record.retryCount,
    enabled: record.enabled,
    status: record.status,
    lastCheckedAt: record.lastCheckedAt,
    revision: record.revision,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function deterministicProbeNonce(input: { workspaceId: string; jobId: string; probeId: string; fencingToken: string }): string {
  const digest = createHash("sha256")
    .update(`${input.workspaceId}\0${input.jobId}\0${input.probeId}\0${input.fencingToken}`)
    .digest("hex");
  return `nonce_${digest.slice(0, 48)}`;
}

function normalizeRequiredText(value: string, name: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${name} is required`);
  if (/[\x00-\x1f\x7f-\x9f]/.test(normalized)) throw new Error(`${name} must not contain control characters`);
  return normalized;
}

function normalizeOptionalText(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized || undefined;
}

function sanitizeWorkerError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return sanitizePostgresRuntimeError(message)
    .replace(/\/(?:home|Users)\/[^\s"'<>]+/g, "[local-path]")
    .slice(0, 1000);
}

function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    function done(): void {
      signal?.removeEventListener("abort", done);
      clearTimeout(timer);
      resolve();
    }
    signal?.addEventListener("abort", done, { once: true });
  });
}
