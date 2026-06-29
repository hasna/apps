import { createHash } from "node:crypto";
import dns from "node:dns/promises";
import { runMonitorCheck, type HostedDnsResolver, type HostedHttpRequestLike } from "./checks.js";
import { probeResultPayloadHash } from "./probes.js";
import { assertHostedResolvedAddressesAllowed, assertHostedTargetAllowed, normalizeHostedHost, type HostedResolvedAddress } from "./target-policy.js";
import {
  sanitizePostgresRuntimeError,
  type CountDuePostgresCheckJobsOptions,
  type CountPostgresSchedulerBacklogOptions,
  type CountPostgresStaleCheckJobLeasesOptions,
  type CreatePostgresCheckJobInput,
  type PostgresCheckJobRecord,
  type PostgresMonitorSnapshot,
  type PostgresMonitorRecord,
  type PostgresRuntime,
  type SubmitPostgresProbeCheckResult,
} from "./postgres-runtime.js";
import {
  publicProbeWorkerRuntimeMetrics,
  schedulerWorkerRuntimeMetrics,
  type WorkerRuntimeMetric,
  type WorkerRuntimeRole,
} from "./worker-metrics.js";
import type { CheckAttemptResult, CheckEvidence, CheckResult, Monitor, MonitorKind, ProbePolicy } from "./types.js";

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
  listDueCheckJobs(options?: { workspaceId?: string; now?: string; limit?: number; probeClass?: "public" | "private"; probeId?: string }): Promise<PostgresCheckJobRecord[]>;
  countDueCheckJobs?(options?: CountDuePostgresCheckJobsOptions): Promise<number>;
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
  metricSink?: WorkerRuntimeMetricSink;
}

export interface PostgresSchedulerRuntime {
  listSchedulerMonitors(options?: { workspaceId?: string; now?: string; limit?: number; cursor?: { sortAt: string; id: string }; probePolicy?: ProbePolicy }): Promise<PostgresMonitorRecord[]>;
  countSchedulerBacklog?(options?: CountPostgresSchedulerBacklogOptions): Promise<number>;
  countStaleCheckJobLeases?(options?: CountPostgresStaleCheckJobLeasesOptions): Promise<number>;
  createCheckJob(input: CreatePostgresCheckJobInput): Promise<PostgresCheckJobRecord>;
  deferSchedulerMonitor?(input: {
    workspaceId?: string;
    monitorId: string;
    monitorRevision: number;
    deferredAt?: string;
    reason?: string | null;
    actor?: string | null;
    origin?: string | null;
    idempotencyKey?: string | null;
  }): Promise<PostgresMonitorRecord | null>;
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

export interface PostgresSchedulerWorkerOptions {
  runtime: PostgresSchedulerRuntime | PostgresRuntime;
  workspaceId?: string;
  now?: () => Date;
  limit?: number;
  maxMonitors?: number;
  maxJobs?: number;
  maxSlotsPerMonitor?: number;
  catchupWindowMs?: number;
  probePolicy?: ProbePolicy;
  supportedKinds?: MonitorKind[];
  hostedResolveHost?: HostedDnsResolver;
  metricSink?: WorkerRuntimeMetricSink;
}

export interface WorkerRuntimeMetricSinkEvent {
  role: WorkerRuntimeRole;
  metrics: WorkerRuntimeMetric[];
  emittedAt: string;
}

export type WorkerRuntimeMetricSink = (event: WorkerRuntimeMetricSinkEvent) => void | Promise<void>;

export interface PostgresSchedulerWorkerMonitorResult {
  monitorId: string;
  monitorRevision: number | null;
  action: "scheduled" | "skipped" | "failed";
  scheduled: number;
  jobIds: string[];
  scheduleSlots: string[];
  reason: string | null;
}

export interface PostgresSchedulerWorkerSummary {
  kind: "open-uptime.postgres-scheduler-worker";
  status: "completed" | "partial";
  workspaceId: string | null;
  discovered: number;
  backlog: number;
  staleLeases: number;
  scheduled: number;
  skipped: number;
  failed: number;
  startedAt: string;
  finishedAt: string;
  metrics: WorkerRuntimeMetric[];
  results: PostgresSchedulerWorkerMonitorResult[];
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
  backlog: number;
  claimed: number;
  submitted: number;
  submissionFailures: number;
  skipped: number;
  failed: number;
  startedAt: string;
  finishedAt: string;
  metrics: WorkerRuntimeMetric[];
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

export async function runPostgresSchedulerWorker(options: PostgresSchedulerWorkerOptions): Promise<PostgresSchedulerWorkerSummary> {
  const limit = normalizePositiveInteger(options.limit ?? options.maxMonitors ?? 50, "limit");
  const maxMonitors = normalizePositiveInteger(options.maxMonitors ?? limit, "maxMonitors");
  const maxJobs = normalizePositiveInteger(options.maxJobs ?? 100, "maxJobs");
  const maxSlotsPerMonitor = normalizePositiveInteger(options.maxSlotsPerMonitor ?? 1, "maxSlotsPerMonitor");
  const catchupWindowMs = normalizePositiveInteger(options.catchupWindowMs ?? 300_000, "catchupWindowMs");
  const clock = options.now ?? (() => new Date());
  const startedAt = clock().toISOString();
  const workspaceId = normalizeOptionalText(options.workspaceId);
  const probePolicy = normalizeSchedulerProbePolicy(options.probePolicy);
  const supportedKinds = new Set(options.supportedKinds ?? ["http", "tcp"]);
  const resolveHost = options.hostedResolveHost ?? resolveSchedulerHostedHost;
  const results: PostgresSchedulerWorkerMonitorResult[] = [];
  let discoveredCount = 0;
  let processedMonitors = 0;
  let scheduledCount = 0;
  let skippedCount = 0;
  let failedCount = 0;
  let cursor: { sortAt: string; id: string } | undefined;

  while (scheduledCount < maxJobs && processedMonitors < maxMonitors) {
    const monitors = await options.runtime.listSchedulerMonitors({
      workspaceId,
      now: startedAt,
      limit,
      cursor,
      probePolicy,
    });
    discoveredCount += monitors.length;
    if (monitors.length === 0) break;

    for (const monitor of monitors) {
      if (scheduledCount >= maxJobs) break;
      if (processedMonitors >= maxMonitors) break;
      cursor = schedulerMonitorCursor(monitor);
      if (workspaceId && monitor.workspaceId !== workspaceId) {
        processedMonitors += 1;
        skippedCount += 1;
        results.push({
          monitorId: monitor.id,
          monitorRevision: monitor.revision,
          action: "skipped",
          scheduled: 0,
          jobIds: [],
          scheduleSlots: [],
          reason: "workspace_mismatch",
        });
        continue;
      }
      if (!supportedKinds.has(monitor.kind)) {
        processedMonitors += 1;
        skippedCount += 1;
        results.push({
          monitorId: monitor.id,
          monitorRevision: monitor.revision,
          action: "skipped",
          scheduled: 0,
          jobIds: [],
          scheduleSlots: [],
          reason: "unsupported_monitor_kind",
        });
        continue;
      }
      try {
        await assertSchedulerPublicTargetAllowed(monitor, resolveHost);
      } catch (error) {
        const reason = `target_policy_blocked: ${sanitizeWorkerError(error)}`;
        try {
          await options.runtime.deferSchedulerMonitor?.({
            workspaceId: monitor.workspaceId,
            monitorId: monitor.id,
            monitorRevision: monitor.revision,
            deferredAt: startedAt,
            reason,
            actor: "postgres-scheduler-worker",
            origin: "open-uptime.cloud.postgres-scheduler",
            idempotencyKey: `scheduler-defer:${monitor.id}:${monitor.revision}:${startedAt}`,
          });
        } catch (deferError) {
          processedMonitors += 1;
          failedCount += 1;
          results.push({
            monitorId: monitor.id,
            monitorRevision: monitor.revision,
            action: "failed",
            scheduled: 0,
            jobIds: [],
            scheduleSlots: [],
            reason: `target_policy_defer_failed: ${sanitizeWorkerError(deferError)}`,
          });
          continue;
        }
        processedMonitors += 1;
        skippedCount += 1;
        results.push({
          monitorId: monitor.id,
          monitorRevision: monitor.revision,
          action: "skipped",
          scheduled: 0,
          jobIds: [],
          scheduleSlots: [],
          reason,
        });
        continue;
      }
      try {
        const slots = dueScheduleSlotsForMonitor(monitor, new Date(startedAt), { maxSlotsPerMonitor, catchupWindowMs })
          .slice(0, Math.max(0, maxJobs - scheduledCount));
        if (slots.length === 0) {
          processedMonitors += 1;
          skippedCount += 1;
          results.push({
            monitorId: monitor.id,
            monitorRevision: monitor.revision,
            action: "skipped",
            scheduled: 0,
            jobIds: [],
            scheduleSlots: [],
            reason: "not_due",
          });
          continue;
        }
        const jobIds: string[] = [];
        const scheduleSlots: string[] = [];
        for (const scheduleSlot of slots) {
          const job = await options.runtime.createCheckJob({
            workspaceId: monitor.workspaceId,
            monitorId: monitor.id,
            monitorRevision: monitor.revision,
            scheduleSlot,
            dueAt: scheduleSlot,
            probePolicy,
            actor: "postgres-scheduler-worker",
            origin: "open-uptime.cloud.postgres-scheduler",
            idempotencyKey: `scheduler:${monitor.id}:${monitor.revision}:${scheduleSlot}`,
          });
          jobIds.push(job.id);
          scheduleSlots.push(job.scheduleSlot);
          scheduledCount += 1;
        }
        results.push({
          monitorId: monitor.id,
          monitorRevision: monitor.revision,
          action: "scheduled",
          scheduled: slots.length,
          jobIds,
          scheduleSlots,
          reason: null,
        });
        processedMonitors += 1;
        await options.runtime.recordAuditEvent?.({
          workspaceId: monitor.workspaceId,
          action: "scheduler.check_jobs.created",
          resourceType: "monitor",
          resourceId: monitor.id,
          message: `Scheduled ${slots.length} check job(s) for monitor ${monitor.id}`,
          metadata: {
            monitorRevision: monitor.revision,
            scheduleSlots,
            probePolicy,
            bounded: true,
          },
          actor: "postgres-scheduler-worker",
          origin: "open-uptime.cloud.postgres-scheduler",
          idempotencyKey: `scheduler-audit:${monitor.id}:${monitor.revision}:${scheduleSlots.join(",")}`,
        });
      } catch (error) {
        processedMonitors += 1;
        failedCount += 1;
        results.push({
          monitorId: monitor.id,
          monitorRevision: monitor.revision,
          action: "failed",
          scheduled: 0,
          jobIds: [],
          scheduleSlots: [],
          reason: sanitizeWorkerError(error),
        });
      }
    }

    if (monitors.length < limit) break;
  }

  const finishedAt = clock().toISOString();
  const backlog = await countSchedulerBacklog(options.runtime, {
    workspaceId,
    now: finishedAt,
    probePolicy,
    fallback: Math.max(0, discoveredCount - results.length),
  });
  const staleLeases = await countStaleCheckJobLeases(options.runtime, {
    workspaceId,
    now: finishedAt,
    probeClass: probePolicy.probeClass,
    fallback: 0,
  });
  const metrics = schedulerWorkerRuntimeMetrics({
    discovered: discoveredCount,
    scheduled: scheduledCount,
    skipped: skippedCount,
    failed: failedCount,
    backlog,
    staleLeases,
    results,
  });
  const summary = {
    kind: "open-uptime.postgres-scheduler-worker",
    status: failedCount > 0 ? "partial" : "completed",
    workspaceId: workspaceId ?? null,
    discovered: discoveredCount,
    backlog,
    staleLeases,
    scheduled: scheduledCount,
    skipped: skippedCount,
    failed: failedCount,
    startedAt,
    finishedAt,
    metrics,
    results,
  } satisfies PostgresSchedulerWorkerSummary;
  await options.metricSink?.({ role: "scheduler", metrics, emittedAt: finishedAt });
  return summary;
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
    probeClass: "public",
    probeId,
  });
  const results: PostgresPublicProbeWorkerJobResult[] = [];
  let claimedCount = 0;
  let submittedCount = 0;
  let submissionFailureCount = 0;
  let skippedCount = 0;
  let failedCount = 0;

  for (const candidate of due.slice(0, maxJobs)) {
    try {
      if (workspaceId && candidate.workspaceId !== workspaceId) {
        skippedCount += 1;
        results.push({ jobId: candidate.id, monitorId: candidate.monitorId, action: "skipped", status: null, checkResultId: null, reason: "workspace_mismatch" });
        continue;
      }
      if (candidate.probePolicy.probeClass !== "public") {
        skippedCount += 1;
        results.push({ jobId: candidate.id, monitorId: candidate.monitorId, action: "skipped", status: null, checkResultId: null, reason: "non_public_probe_policy" });
        continue;
      }
      const claimed = await options.runtime.claimCheckJob({
        workspaceId: workspaceId ?? candidate.workspaceId,
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
      if (workspaceId && claimed.workspaceId !== workspaceId) {
        failedCount += 1;
        results.push({ jobId: candidate.id, monitorId: candidate.monitorId, action: "failed", status: null, checkResultId: null, reason: "workspace_mismatch" });
        continue;
      }
      if (claimed.probePolicy.probeClass !== "public") {
        const cancelled = await cancelClaimedJob(options.runtime, claimed, probeId, "non_public_probe_policy");
        if (!cancelled) throw new Error("failed to cancel non_public_probe_policy job");
        skippedCount += 1;
        results.push({ jobId: claimed.id, monitorId: claimed.monitorId, action: "skipped", status: null, checkResultId: null, reason: "non_public_probe_policy" });
        continue;
      }
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
      const submitted = await submitProbeResultForWorker(options.runtime, {
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
      }).catch((error) => {
        submissionFailureCount += 1;
        throw error;
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

  const finishedAt = clock().toISOString();
  const backlog = await countDueCheckJobs(options.runtime, {
    workspaceId,
    now: finishedAt,
    probeClass: "public",
    probeId,
    fallback: Math.max(0, due.length - claimedCount),
  });
  const metrics = publicProbeWorkerRuntimeMetrics({
    discovered: due.length,
    backlog,
    claimed: claimedCount,
    submitted: submittedCount,
    skipped: skippedCount,
    failed: failedCount,
    submissionFailures: submissionFailureCount,
  });
  const summary = {
    kind: "open-uptime.postgres-public-probe-worker",
    status: failedCount > 0 ? "partial" : "completed",
    workspaceId: workspaceId ?? null,
    probeId,
    discovered: due.length,
    backlog,
    claimed: claimedCount,
    submitted: submittedCount,
    submissionFailures: submissionFailureCount,
    skipped: skippedCount,
    failed: failedCount,
    startedAt,
    finishedAt,
    metrics,
    results,
  } satisfies PostgresPublicProbeWorkerSummary;
  await options.metricSink?.({ role: "public-probe", metrics, emittedAt: finishedAt });
  return summary;
}

async function countSchedulerBacklog(
  runtime: PostgresSchedulerRuntime | PostgresRuntime,
  options: CountPostgresSchedulerBacklogOptions & { fallback: number },
): Promise<number> {
  if (!runtime.countSchedulerBacklog) return options.fallback;
  return runtime.countSchedulerBacklog({
    workspaceId: options.workspaceId,
    now: options.now,
    probePolicy: options.probePolicy,
  });
}

async function countStaleCheckJobLeases(
  runtime: PostgresSchedulerRuntime | PostgresRuntime,
  options: CountPostgresStaleCheckJobLeasesOptions & { fallback: number },
): Promise<number> {
  if (!runtime.countStaleCheckJobLeases) return options.fallback;
  return runtime.countStaleCheckJobLeases({
    workspaceId: options.workspaceId,
    now: options.now,
    probeClass: options.probeClass,
    probeId: options.probeId,
  });
}

async function countDueCheckJobs(
  runtime: PostgresPublicProbeRuntime | PostgresRuntime,
  options: CountDuePostgresCheckJobsOptions & { fallback: number },
): Promise<number> {
  if (!runtime.countDueCheckJobs) return options.fallback;
  return runtime.countDueCheckJobs({
    workspaceId: options.workspaceId,
    now: options.now,
    probeClass: options.probeClass,
    probeId: options.probeId,
  });
}

async function submitProbeResultForWorker(
  runtime: PostgresPublicProbeRuntime | PostgresRuntime,
  input: Parameters<PostgresPublicProbeRuntime["submitProbeCheckResult"]>[0],
): Promise<SubmitPostgresProbeCheckResult> {
  return runtime.submitProbeCheckResult(input);
}

function normalizePositiveInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
  return value;
}

function normalizeSchedulerProbePolicy(policy: ProbePolicy | undefined): ProbePolicy {
  const probeClass = policy?.probeClass ?? "public";
  if (probeClass !== "public" && probeClass !== "private") throw new Error("probePolicy.probeClass must be public or private");
  if (probeClass !== "public") throw new Error("postgres scheduler worker currently supports only public probe policy");
  const locations = Array.from(new Set((policy?.locations ?? []).map((location) => {
    const trimmed = location.trim();
    if (!trimmed) throw new Error("probePolicy.locations must not contain empty values");
    if (/[\x00-\x1f\x7f-\x9f]/.test(trimmed)) throw new Error("probePolicy.locations must not contain control characters");
    return trimmed;
  }))).sort((left, right) => left.localeCompare(right));
  return { probeClass, locations };
}

async function assertSchedulerPublicTargetAllowed(monitor: PostgresMonitorRecord, resolver: HostedDnsResolver): Promise<void> {
  assertHostedTargetAllowed(monitor);
  const host = monitor.kind === "http" && monitor.url
    ? normalizeHostedHost(new URL(monitor.url).hostname)
    : monitor.kind === "tcp" && monitor.host
      ? normalizeHostedHost(monitor.host)
      : null;
  if (!host) throw new Error("monitor target host is required");
  const addresses = await resolver(host);
  assertHostedResolvedAddressesAllowed(host, addresses, "scheduler resolved address");
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

function schedulerMonitorCursor(monitor: PostgresMonitorRecord): { sortAt: string; id: string } {
  return {
    sortAt: monitor.lastCheckedAt ?? monitor.createdAt,
    id: monitor.id,
  };
}

async function resolveSchedulerHostedHost(hostname: string): Promise<HostedResolvedAddress[]> {
  const records = await dns.lookup(normalizeHostedHost(hostname), { all: true });
  return records
    .filter((record): record is { address: string; family: 4 | 6 } => record.family === 4 || record.family === 6)
    .map((record) => ({ address: record.address, family: record.family }));
}

function dueScheduleSlotsForMonitor(
  monitor: Pick<PostgresMonitorRecord, "intervalSeconds" | "lastCheckedAt">,
  now: Date,
  options: { maxSlotsPerMonitor: number; catchupWindowMs: number },
): string[] {
  const intervalMs = monitor.intervalSeconds * 1000;
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) throw new Error("monitor intervalSeconds must be positive");
  const nowMs = now.getTime();
  if (!Number.isFinite(nowMs)) throw new Error("scheduler now must be valid");
  const latestSlotMs = floorToInterval(nowMs, intervalMs);
  const lastCheckedMs = monitor.lastCheckedAt ? Date.parse(monitor.lastCheckedAt) : Number.NaN;
  const firstDueMs = Number.isFinite(lastCheckedMs)
    ? floorToInterval(lastCheckedMs + intervalMs, intervalMs)
    : latestSlotMs;
  const boundedEarliestMs = Math.max(
    firstDueMs,
    latestSlotMs - ((options.maxSlotsPerMonitor - 1) * intervalMs),
    nowMs - options.catchupWindowMs,
  );
  const firstSlotMs = ceilToInterval(boundedEarliestMs, intervalMs);
  const slots: string[] = [];
  for (let slotMs = firstSlotMs; slotMs <= latestSlotMs && slots.length < options.maxSlotsPerMonitor; slotMs += intervalMs) {
    slots.push(new Date(slotMs).toISOString());
  }
  return slots;
}

function floorToInterval(value: number, interval: number): number {
  return Math.floor(value / interval) * interval;
}

function ceilToInterval(value: number, interval: number): number {
  return Math.ceil(value / interval) * interval;
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
