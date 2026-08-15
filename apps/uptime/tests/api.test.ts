import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApiHandler, serveUptime, type HostedPostgresMonitorRuntime, type HostedPostgresProbeRuntime, type HostedPostgresReportRuntime } from "../src/api.js";
import { generateProbeKeyPair, probeResultPayloadHash, signProbeResult, type ProbeSigningInput } from "../src/probes.js";
import { UptimeService } from "../src/service.js";
import type { PostgresReportRunRecord, PostgresReportScheduleRecord } from "../src/postgres-report-runtime.js";
import type {
  PostgresAuditEventRecord,
  PostgresMonitorMutationAuditInput,
  PostgresMonitorMutationResult,
  PostgresMonitorTombstoneResult,
  PostgresMonitorRecord,
  PostgresCheckJobMutationResult,
  PostgresCheckJobRecord,
  PostgresCheckResultRecord,
  PostgresProbeIdentityRecord,
  PostgresProbeIdentityMutationResult,
  PostgresProbeMutationAuditInput,
  PostgresProbeSubmissionRecord,
  PostgresSyncTombstoneRecord,
  RecordPostgresAuditEventInput,
  SubmitPostgresProbeCheckResult,
  SubmitPostgresProbeCheckResultMutationResult,
  SubmitPostgresProbeCheckResultInput,
  TombstonePostgresResourceInput,
  UpsertPostgresProbeIdentityInput,
  UpsertPostgresMonitorInput,
} from "../src/postgres-runtime.js";
import type { AuditEvent, CheckEvidence, ProbePolicy, RecordAuditEventInput, ReportScheduleChannels } from "../src/types.js";

const cleanup: string[] = [];
const HOSTED_SECRET_TOKEN_JSON = JSON.stringify({
  tokens: [{ token: "secret", scopes: ["uptime:read", "uptime:write", "uptime:probe", "uptime:report"], workspaceId: "default" }],
});

afterEach(() => {
  while (cleanup.length > 0) rmSync(cleanup.pop()!, { recursive: true, force: true });
});

function tempDb(): string {
  const dir = mkdtempSync(join(tmpdir(), "open-uptime-api-"));
  cleanup.push(dir);
  return join(dir, "uptime.db");
}

function jsonRequest(url: string, method: string, body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(url, {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

class FakeHostedPostgresMonitorRuntime implements HostedPostgresMonitorRuntime {
  readonly monitors = new Map<string, PostgresMonitorRecord>();
  readonly audits: RecordPostgresAuditEventInput[] = [];
  readonly tombstones: TombstonePostgresResourceInput[] = [];
  readonly upserts: UpsertPostgresMonitorInput[] = [];
  readonly listCalls: Array<{ workspaceId?: string; includeDisabled?: boolean; limit?: number; offset?: number }> = [];
  failListError: Error | null = null;
  deleteBeforeNextExpectedRevisionUpsert = false;
  private sequence = 0;

  async upsertMonitor(input: UpsertPostgresMonitorInput): Promise<PostgresMonitorRecord> {
    const workspaceId = input.workspaceId ?? "default";
    const id = input.id ?? `mon_${++this.sequence}`;
    const key = `${workspaceId}:${id}`;
    let existing = this.monitors.get(key);
    if (this.deleteBeforeNextExpectedRevisionUpsert && input.expectedRevision != null && existing) {
      this.deleteBeforeNextExpectedRevisionUpsert = false;
      existing = {
        ...existing,
        enabled: false,
        deletedAt: new Date(0).toISOString(),
        revision: existing.revision + 1,
      };
      this.monitors.set(key, existing);
    }
    if (input.expectedRevision != null && (!existing || existing.deletedAt || existing.revision !== input.expectedRevision)) {
      throw new Error("monitor revision conflict");
    }
    if (existing?.deletedAt) {
      throw new Error(input.idempotencyKey ? "monitor idempotency conflict" : "monitor conflict");
    }
    if (existing?.idempotencyKey && input.idempotencyKey) {
      throw new Error("monitor idempotency conflict");
    }
    this.upserts.push(input);
    const now = new Date(0).toISOString();
    const enabled = input.enabled ?? existing?.enabled ?? true;
    const monitor: PostgresMonitorRecord = {
      workspaceId,
      id,
      name: input.name.trim(),
      kind: input.kind,
      url: input.url === undefined ? existing?.url ?? null : input.url == null || input.url === "" ? null : input.url.trim(),
      host: input.host === undefined ? existing?.host ?? null : input.host == null || input.host === "" ? null : input.host.trim(),
      port: input.port === undefined ? existing?.port ?? null : input.port,
      method: (input.method ?? existing?.method ?? "GET").trim().toUpperCase(),
      expectedStatus: input.expectedStatus === undefined ? existing?.expectedStatus ?? null : input.expectedStatus,
      intervalSeconds: input.intervalSeconds ?? existing?.intervalSeconds ?? 60,
      timeoutMs: input.timeoutMs ?? existing?.timeoutMs ?? 5000,
      retryCount: input.retryCount ?? existing?.retryCount ?? 0,
      enabled,
      status: input.status ?? (enabled ? existing?.status ?? "unknown" : "paused"),
      lastCheckedAt: input.lastCheckedAt === undefined ? existing?.lastCheckedAt ?? null : input.lastCheckedAt,
      revision: (existing?.revision ?? 0) + 1,
      actor: input.actor ?? null,
      origin: input.origin ?? null,
      idempotencyKey: input.idempotencyKey === undefined ? existing?.idempotencyKey ?? null : input.idempotencyKey,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      deletedAt: null,
    };
    this.monitors.set(key, monitor);
    return monitor;
  }

  async upsertMonitorWithAudit(input: UpsertPostgresMonitorInput, audit: PostgresMonitorMutationAuditInput): Promise<PostgresMonitorMutationResult> {
    if (audit.idempotencyKey && audit.resourceId) {
      const replayIndex = this.audits.findIndex((existing) =>
        existing.workspaceId === (input.workspaceId ?? audit.workspaceId)
        && existing.action === audit.action
        && existing.resourceType === "monitor"
        && existing.resourceId === audit.resourceId
        && existing.idempotencyKey === audit.idempotencyKey
      );
      if (replayIndex >= 0) {
        const replayedHash = this.audits[replayIndex]?.metadata?.requestHash;
        const requestedHash = audit.metadata?.requestHash;
        if (typeof requestedHash === "string" && typeof replayedHash === "string" && requestedHash !== replayedHash) {
          throw new Error("monitor idempotency conflict");
        }
        const monitor = await this.getMonitor({ workspaceId: input.workspaceId ?? audit.workspaceId, id: audit.resourceId });
        if (!monitor) throw new Error("monitor revision conflict");
        return { monitor, audit: this.auditRecord(this.audits[replayIndex]!, replayIndex + 1) };
      }
    }
    const monitor = await this.upsertMonitor(input);
    return {
      monitor,
      audit: await this.recordAuditEvent({
        ...audit,
        workspaceId: input.workspaceId ?? audit.workspaceId,
        resourceType: "monitor",
        resourceId: audit.resourceId ?? monitor.id,
        metadata: {
          ...(audit.metadata ?? {}),
          monitorName: monitor.name,
          monitorKind: monitor.kind,
          monitorEnabled: monitor.enabled,
          monitorRevision: monitor.revision,
          workspaceId: monitor.workspaceId,
        },
      }),
    };
  }

  async listMonitors(options: { workspaceId?: string; includeDisabled?: boolean; limit?: number; offset?: number } = {}): Promise<PostgresMonitorRecord[]> {
    if (this.failListError) throw this.failListError;
    this.listCalls.push(options);
    const limit = Math.min(options.limit ?? 250, 500);
    const offset = options.offset ?? 0;
    return [...this.monitors.values()]
      .filter((monitor) => monitor.workspaceId === (options.workspaceId ?? "default"))
      .filter((monitor) => !monitor.deletedAt)
      .filter((monitor) => options.includeDisabled === true || monitor.enabled)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id))
      .slice(offset, offset + limit);
  }

  async getMonitor(input: { workspaceId?: string; id: string }): Promise<PostgresMonitorRecord | null> {
    const monitor = this.monitors.get(`${input.workspaceId ?? "default"}:${input.id}`);
    return monitor && !monitor.deletedAt ? monitor : null;
  }

  async tombstoneResource(input: TombstonePostgresResourceInput & { resourceType: "monitor" }): Promise<PostgresSyncTombstoneRecord> {
    this.tombstones.push(input);
    const workspaceId = input.workspaceId ?? "default";
    const key = `${workspaceId}:${input.resourceId}`;
    const existing = this.monitors.get(key);
    const deletedAt = input.deletedAt ?? new Date(0).toISOString();
    if (existing) {
      this.monitors.set(key, {
        ...existing,
        enabled: false,
        deletedAt,
        revision: input.version ?? existing.revision + 1,
        idempotencyKey: input.idempotencyKey === undefined || input.idempotencyKey === null ? existing.idempotencyKey : input.idempotencyKey,
      });
    }
    return {
      workspaceId,
      resourceType: "monitor",
      resourceId: input.resourceId,
      deletedAt,
      version: input.version ?? 1,
      actor: input.actor ?? null,
      origin: input.origin ?? null,
      idempotencyKey: input.idempotencyKey ?? null,
      metadata: input.metadata ?? {},
    };
  }

  async tombstoneMonitorWithAudit(input: TombstonePostgresResourceInput & { resourceType: "monitor" }, audit: PostgresMonitorMutationAuditInput): Promise<PostgresMonitorTombstoneResult> {
    const tombstone = await this.tombstoneResource(input);
    return {
      tombstone,
      audit: await this.recordAuditEvent({
        ...audit,
        workspaceId: input.workspaceId ?? audit.workspaceId,
        action: "monitor.delete",
        resourceType: "monitor",
        resourceId: input.resourceId,
      }),
    };
  }

  async recordAuditEvent(input: RecordPostgresAuditEventInput): Promise<PostgresAuditEventRecord> {
    this.audits.push(input);
    return this.auditRecord(input, this.audits.length);
  }

  private auditRecord(input: RecordPostgresAuditEventInput, index: number): PostgresAuditEventRecord {
    return {
      workspaceId: input.workspaceId ?? "default",
      id: `aud_${index}`,
      action: input.action,
      resourceType: input.resourceType ?? null,
      resourceId: input.resourceId ?? null,
      message: input.message ?? null,
      metadata: input.metadata ?? {},
      actor: input.actor ?? null,
      origin: input.origin ?? null,
      idempotencyKey: input.idempotencyKey ?? null,
      createdAt: input.createdAt ?? new Date(0).toISOString(),
    };
  }
}

class FakeHostedPostgresProbeRuntime implements HostedPostgresProbeRuntime {
  readonly probes = new Map<string, PostgresProbeIdentityRecord>();
  readonly jobs = new Map<string, PostgresCheckJobRecord>();
  readonly audits: RecordPostgresAuditEventInput[] = [];
  readonly submissions: PostgresProbeSubmissionRecord[] = [];
  private sequence = 0;

  async upsertProbeIdentity(input: UpsertPostgresProbeIdentityInput): Promise<PostgresProbeIdentityRecord> {
    const workspaceId = input.workspaceId ?? "default";
    const id = input.id ?? `prb_${++this.sequence}`;
    const key = `${workspaceId}:${id}`;
    const existing = this.probes.get(key);
    const probe: PostgresProbeIdentityRecord = {
      workspaceId,
      id,
      name: input.name,
      probeClass: input.probeClass,
      probeLocation: input.probeLocation ?? "default",
      machineId: input.machineId ?? null,
      publicKeyPem: input.publicKeyPem,
      publicKeyFingerprint: input.publicKeyFingerprint,
      enabled: input.enabled ?? existing?.enabled ?? true,
      capabilities: input.capabilities ?? existing?.capabilities ?? {},
      lastSeenAt: input.lastSeenAt ?? existing?.lastSeenAt ?? null,
      version: (existing?.version ?? 0) + 1,
    };
    this.probes.set(key, probe);
    return probe;
  }

  async upsertProbeIdentityWithAudit(input: UpsertPostgresProbeIdentityInput, audit: PostgresProbeMutationAuditInput): Promise<PostgresProbeIdentityMutationResult> {
    const probe = await this.upsertProbeIdentity(input);
    const event = await this.recordAuditEvent({
      ...audit,
      resourceType: "probe_identity",
      resourceId: audit.resourceId ?? probe.id,
      metadata: {
        ...(audit.metadata ?? {}),
        probeId: probe.id,
        probeClass: probe.probeClass,
        probeLocation: probe.probeLocation,
      },
    });
    return { probe, audit: event };
  }

  async getProbeIdentity(input: { workspaceId?: string; id: string }): Promise<PostgresProbeIdentityRecord | null> {
    return this.probes.get(`${input.workspaceId ?? "default"}:${input.id}`) ?? null;
  }

  async claimCheckJob(input: { workspaceId?: string; jobId: string; probeId: string; leaseTtlMs?: number }): Promise<PostgresCheckJobRecord | null> {
    const workspaceId = input.workspaceId ?? "default";
    const job = this.jobs.get(`${workspaceId}:${input.jobId}`);
    const probe = this.probes.get(`${workspaceId}:${input.probeId}`);
    if (!job || !probe || !probe.enabled || job.status === "submitted" || job.submittedResultId) return null;
    if (probe.probeClass !== job.probePolicy.probeClass) return null;
    if (job.probePolicy.locations.length > 0 && !job.probePolicy.locations.includes(probe.probeLocation)) return null;
    const claimed: PostgresCheckJobRecord = {
      ...job,
      status: "claimed",
      claimedByProbeId: probe.id,
      fencingToken: job.claimedByProbeId === probe.id && job.fencingToken ? job.fencingToken : "fence_fake_1",
      claimedAt: "2026-01-01T00:00:01.000Z",
      leaseExpiresAt: "2026-01-01T00:05:01.000Z",
      version: job.version + 1,
      updatedAt: "2026-01-01T00:00:01.000Z",
    };
    this.jobs.set(`${workspaceId}:${input.jobId}`, claimed);
    return claimed;
  }

  async claimCheckJobWithAudit(input: { workspaceId?: string; jobId: string; probeId: string; leaseTtlMs?: number }, audit: PostgresProbeMutationAuditInput): Promise<PostgresCheckJobMutationResult | null> {
    const job = await this.claimCheckJob(input);
    if (!job) return null;
    const event = await this.recordAuditEvent({
      ...audit,
      resourceType: "check_job",
      resourceId: audit.resourceId ?? job.id,
      metadata: {
        ...(audit.metadata ?? {}),
        probeId: job.claimedByProbeId,
        monitorId: job.monitorId,
        monitorRevision: job.monitorRevision,
      },
    });
    return { job, audit: event };
  }

  async submitProbeCheckResult(input: SubmitPostgresProbeCheckResultInput): Promise<SubmitPostgresProbeCheckResult> {
    const workspaceId = input.workspaceId ?? "default";
    const job = this.jobs.get(`${workspaceId}:${input.jobId}`);
    const probe = this.probes.get(`${workspaceId}:${input.probeId}`);
    if (!job || !probe || job.status !== "claimed" || job.claimedByProbeId !== probe.id || job.fencingToken !== input.fencingToken) {
      throw new Error("probe check job completion conflict");
    }
    const expectedHash = probeResultPayloadHash({
      probeId: probe.id,
      jobId: job.id,
      scheduleSlot: job.scheduleSlot,
      fencingToken: input.fencingToken,
      monitorId: job.monitorId,
      nonce: input.nonce,
      checkedAt: input.checkedAt,
      status: input.status,
      latencyMs: input.latencyMs ?? null,
      statusCode: input.statusCode ?? null,
      error: input.error ?? null,
      attemptCount: input.attemptCount ?? 1,
      monitorRevision: job.monitorRevision,
      evidence: input.evidence ?? null,
    });
    if (input.payloadHash !== expectedHash) throw new Error("probe payload hash mismatch");
    const result: PostgresCheckResultRecord = {
      workspaceId,
      id: "chk_fake_1",
      monitorId: job.monitorId,
      jobId: job.id,
      probeId: probe.id,
      monitorRevision: job.monitorRevision,
      scheduleSlot: job.scheduleSlot,
      probeClass: probe.probeClass,
      probeLocation: probe.probeLocation,
      probePolicyHash: job.probePolicyHash,
      checkedAt: input.checkedAt,
      status: input.status,
      latencyMs: input.latencyMs ?? null,
      statusCode: input.statusCode ?? null,
      error: input.error ?? null,
      attemptCount: input.attemptCount ?? 1,
      evidence: input.evidence ?? null,
      actor: input.actor ?? null,
      origin: input.origin ?? null,
      idempotencyKey: input.idempotencyKey ?? null,
    };
    const submission: PostgresProbeSubmissionRecord = {
      workspaceId,
      id: "psb_fake_1",
      probeId: probe.id,
      jobId: job.id,
      monitorId: job.monitorId,
      monitorRevision: job.monitorRevision,
      scheduleSlot: job.scheduleSlot,
      probeClass: probe.probeClass,
      probeLocation: probe.probeLocation,
      probePolicyHash: job.probePolicyHash,
      payloadHash: input.payloadHash,
      checkResultId: result.id,
      nonce: input.nonce,
      checkedAt: input.checkedAt,
      submittedAt: "2026-01-01T00:00:02.000Z",
    };
    const completed = {
      ...job,
      status: "submitted" as const,
      fencingToken: null,
      leaseExpiresAt: null,
      submittedResultId: result.id,
      updatedAt: "2026-01-01T00:00:02.000Z",
      version: job.version + 1,
    };
    this.jobs.set(`${workspaceId}:${job.id}`, completed);
    this.submissions.push(submission);
    return { job: completed, result, submission };
  }

  async submitProbeCheckResultWithAudit(input: SubmitPostgresProbeCheckResultInput, audit: PostgresProbeMutationAuditInput): Promise<SubmitPostgresProbeCheckResultMutationResult> {
    const submitted = await this.submitProbeCheckResult(input);
    const event = await this.recordAuditEvent({
      ...audit,
      resourceType: "check_job",
      resourceId: audit.resourceId ?? submitted.job.id,
      metadata: {
        ...(audit.metadata ?? {}),
        probeId: submitted.submission.probeId,
        monitorId: submitted.submission.monitorId,
        monitorRevision: submitted.submission.monitorRevision,
        resultStatus: submitted.result.status,
      },
    });
    return { ...submitted, audit: event };
  }

  async recordAuditEvent(input: RecordPostgresAuditEventInput): Promise<PostgresAuditEventRecord> {
    this.audits.push(input);
    return {
      workspaceId: input.workspaceId ?? "default",
      id: `aud_probe_${this.audits.length}`,
      action: input.action,
      resourceType: input.resourceType ?? null,
      resourceId: input.resourceId ?? null,
      message: input.message ?? null,
      metadata: input.metadata ?? {},
      actor: input.actor ?? null,
      origin: input.origin ?? null,
      idempotencyKey: input.idempotencyKey ?? null,
      createdAt: input.createdAt ?? "2026-01-01T00:00:00.000Z",
    };
  }

  seedJob(job: Partial<PostgresCheckJobRecord> & { workspaceId: string; id: string; monitorId: string; monitorRevision: number; probePolicy: ProbePolicy }): PostgresCheckJobRecord {
    const now = "2026-01-01T00:00:00.000Z";
    const seeded: PostgresCheckJobRecord = {
      workspaceId: job.workspaceId,
      id: job.id,
      monitorId: job.monitorId,
      monitorRevision: job.monitorRevision,
      monitorSnapshot: job.monitorSnapshot ?? {
        workspaceId: job.workspaceId,
        id: job.monitorId,
        name: "Private HTTP",
        kind: "http",
        url: "https://private.example.invalid/health",
        host: null,
        port: null,
        method: "GET",
        expectedStatus: 200,
        intervalSeconds: 60,
        timeoutMs: 5000,
        retryCount: 0,
        enabled: true,
        status: "unknown",
        lastCheckedAt: null,
        revision: job.monitorRevision,
        createdAt: now,
        updatedAt: now,
      },
      scheduleSlot: job.scheduleSlot ?? "2026-01-01T00:00:00.000Z",
      probePolicy: job.probePolicy,
      probePolicyHash: job.probePolicyHash ?? "hash_private_operator_01",
      status: job.status ?? "pending",
      claimedByProbeId: job.claimedByProbeId ?? null,
      fencingToken: job.fencingToken ?? null,
      dueAt: job.dueAt ?? now,
      claimedAt: job.claimedAt ?? null,
      leaseExpiresAt: job.leaseExpiresAt ?? null,
      submittedResultId: job.submittedResultId ?? null,
      deployGeneration: job.deployGeneration ?? 1,
      version: job.version ?? 1,
      createdAt: job.createdAt ?? now,
      updatedAt: job.updatedAt ?? now,
    };
    this.jobs.set(`${seeded.workspaceId}:${seeded.id}`, seeded);
    return seeded;
  }
}

type FakeStoredAuditEvent = AuditEvent & { origin?: string | null; idempotencyKey?: string | null };

class FakeHostedPostgresReportRuntime implements HostedPostgresReportRuntime {
  readonly schedules = new Map<string, PostgresReportScheduleRecord>();
  readonly audits: FakeStoredAuditEvent[] = [];
  readonly runs: PostgresReportRunRecord[] = [];
  readonly listScheduleCalls: Array<{ workspaceId?: string; includeDisabled?: boolean; limit?: number; offset?: number }> = [];
  readonly listRunCalls: Array<{ workspaceId?: string; scheduleId?: string; limit?: number; offset?: number }> = [];
  readonly updateCalls: Array<{ idOrName: string; expectedRevision?: number | null }> = [];
  private sequence = 0;

  async createReportSchedule(input: Parameters<HostedPostgresReportRuntime["createReportSchedule"]>[0]): Promise<PostgresReportScheduleRecord> {
    const workspaceId = input.workspaceId ?? "default";
    const id = input.id ?? `rps_${++this.sequence}`;
    const existing = this.schedules.get(`${workspaceId}:${id}`);
    const channels = this.normalizeChannels(input.channels);
    if (existing?.idempotencyKey && input.idempotencyKey && existing.idempotencyKey !== input.idempotencyKey) {
      throw new Error("report schedule idempotency conflict");
    }
    const now = new Date(0).toISOString();
    const schedule: PostgresReportScheduleRecord = {
      workspaceId,
      id,
      name: input.name.trim(),
      enabled: input.enabled ?? true,
      intervalSeconds: input.intervalSeconds,
      nextRunAt: new Date(input.nextRunAt ?? now).toISOString(),
      lastRunAt: existing?.lastRunAt ?? null,
      subject: input.subject ?? null,
      channels,
      revision: existing?.revision ?? 1,
      actor: input.actor ?? null,
      origin: input.origin ?? null,
      idempotencyKey: input.idempotencyKey ?? null,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      deletedAt: null,
    };
    this.schedules.set(`${workspaceId}:${id}`, schedule);
    return schedule;
  }

  async createReportScheduleWithAudit(
    input: Parameters<HostedPostgresReportRuntime["createReportSchedule"]>[0],
    audit: Parameters<HostedPostgresReportRuntime["createReportScheduleWithAudit"]>[1],
  ): Promise<{ schedule: PostgresReportScheduleRecord; audit: AuditEvent }> {
    const replay = this.findAuditReplay(input.workspaceId ?? audit.workspaceId, audit.action, audit.resourceId, audit.idempotencyKey);
    if (replay) {
      this.assertReplayHashMatches(replay, audit);
      const schedule = [...this.schedules.values()].find((candidate) =>
        candidate.workspaceId === (input.workspaceId ?? audit.workspaceId ?? "default")
        && candidate.id === replay.resourceId
        && !candidate.deletedAt
      );
      if (!schedule) throw new Error("report schedule idempotency conflict");
      return { schedule, audit: replay };
    }
    const schedule = await this.createReportSchedule(input);
    const event = await this.recordAuditEvent({
      ...audit,
      workspaceId: schedule.workspaceId,
      resourceType: "report_schedule",
      resourceId: schedule.id,
      idempotencyKey: input.idempotencyKey ?? audit.idempotencyKey,
    });
    return { schedule, audit: event };
  }

  async listReportSchedules(options: { workspaceId?: string; includeDisabled?: boolean; limit?: number; offset?: number } = {}): Promise<PostgresReportScheduleRecord[]> {
    this.listScheduleCalls.push(options);
    const limit = options.limit ?? 250;
    const offset = options.offset ?? 0;
    return [...this.schedules.values()]
      .filter((schedule) => schedule.workspaceId === (options.workspaceId ?? "default"))
      .filter((schedule) => !schedule.deletedAt)
      .filter((schedule) => options.includeDisabled === true || schedule.enabled)
      .sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id))
      .slice(offset, offset + limit);
  }

  async getReportSchedule(input: { workspaceId?: string; idOrName: string }): Promise<PostgresReportScheduleRecord | null> {
    const workspaceId = input.workspaceId ?? "default";
    return [...this.schedules.values()].find((schedule) =>
      schedule.workspaceId === workspaceId && !schedule.deletedAt && (schedule.id === input.idOrName || schedule.name === input.idOrName)
    ) ?? null;
  }

  async updateReportSchedule(input: Parameters<HostedPostgresReportRuntime["updateReportSchedule"]>[0]): Promise<PostgresReportScheduleRecord> {
    this.updateCalls.push({ idOrName: input.idOrName, expectedRevision: input.expectedRevision });
    const before = await this.getReportSchedule({ workspaceId: input.workspaceId, idOrName: input.idOrName });
    if (!before) throw new Error("report schedule not found");
    if (input.expectedRevision != null && before.revision !== input.expectedRevision) {
      throw new Error("report schedule revision conflict");
    }
    const schedule: PostgresReportScheduleRecord = {
      ...before,
      name: input.name?.trim() ?? before.name,
      enabled: input.enabled ?? before.enabled,
      intervalSeconds: input.intervalSeconds ?? before.intervalSeconds,
      nextRunAt: input.nextRunAt ? new Date(input.nextRunAt).toISOString() : before.nextRunAt,
      subject: input.subject === undefined ? before.subject : input.subject,
      channels: input.channels ? this.normalizeChannels(input.channels) : before.channels,
      revision: before.revision + 1,
      actor: input.actor ?? null,
      origin: input.origin ?? null,
      idempotencyKey: input.idempotencyKey ?? null,
      updatedAt: new Date(1).toISOString(),
    };
    this.schedules.set(`${schedule.workspaceId}:${schedule.id}`, schedule);
    return schedule;
  }

  async updateReportScheduleWithAudit(
    input: Parameters<HostedPostgresReportRuntime["updateReportSchedule"]>[0],
    audit: Parameters<HostedPostgresReportRuntime["updateReportScheduleWithAudit"]>[1],
  ): Promise<{ schedule: PostgresReportScheduleRecord; audit: AuditEvent }> {
    const before = await this.getReportSchedule({ workspaceId: input.workspaceId, idOrName: input.idOrName });
    if (!before) throw new Error("report schedule not found");
    const replay = this.findAuditReplay(input.workspaceId ?? audit.workspaceId, audit.action, before.id, audit.idempotencyKey);
    if (replay) {
      this.assertReplayHashMatches(replay, audit);
      return { schedule: before, audit: replay };
    }
    const schedule = await this.updateReportSchedule({ ...input, idOrName: before.id });
    const event = await this.recordAuditEvent({
      ...audit,
      workspaceId: schedule.workspaceId,
      resourceType: "report_schedule",
      resourceId: schedule.id,
      idempotencyKey: input.idempotencyKey ?? audit.idempotencyKey,
    });
    return { schedule, audit: event };
  }

  async tombstoneReportSchedule(input: Parameters<HostedPostgresReportRuntime["tombstoneReportSchedule"]>[0]): Promise<PostgresReportScheduleRecord | null> {
    const before = await this.getReportSchedule({ workspaceId: input.workspaceId, idOrName: input.idOrName });
    if (!before) return null;
    if (input.expectedRevision != null && before.revision !== input.expectedRevision) {
      throw new Error("report schedule revision conflict");
    }
    const schedule: PostgresReportScheduleRecord = {
      ...before,
      enabled: false,
      deletedAt: input.deletedAt ?? new Date(2).toISOString(),
      revision: before.revision + 1,
      actor: input.actor ?? null,
      origin: input.origin ?? null,
      idempotencyKey: input.idempotencyKey ?? null,
      updatedAt: new Date(2).toISOString(),
    };
    this.schedules.set(`${schedule.workspaceId}:${schedule.id}`, schedule);
    return schedule;
  }

  async tombstoneReportScheduleWithAudit(
    input: Parameters<HostedPostgresReportRuntime["tombstoneReportSchedule"]>[0],
    audit: Parameters<HostedPostgresReportRuntime["tombstoneReportScheduleWithAudit"]>[1],
  ): Promise<{ schedule: PostgresReportScheduleRecord | null; audit: AuditEvent | null }> {
    const workspaceId = input.workspaceId ?? audit.workspaceId ?? "default";
    const before = [...this.schedules.values()].find((schedule) =>
      schedule.workspaceId === workspaceId && (schedule.id === input.idOrName || schedule.name === input.idOrName)
    ) ?? null;
    const resourceId = before?.id ?? audit.resourceId ?? null;
    const replay = this.findAuditReplay(workspaceId, audit.action, resourceId, audit.idempotencyKey);
    if (replay) {
      this.assertReplayHashMatches(replay, audit);
      return { schedule: before, audit: replay };
    }
    if (!before || before.deletedAt) return { schedule: null, audit: null };
    const schedule = await this.tombstoneReportSchedule({ ...input, idOrName: before.id, expectedRevision: before.revision });
    if (!schedule) return { schedule: null, audit: null };
    const event = await this.recordAuditEvent({
      ...audit,
      workspaceId: schedule.workspaceId,
      resourceType: "report_schedule",
      resourceId: schedule.id,
      idempotencyKey: input.idempotencyKey ?? audit.idempotencyKey,
    });
    return { schedule, audit: event };
  }

  async listReportRuns(options: Parameters<HostedPostgresReportRuntime["listReportRuns"]>[0] = {}): Promise<PostgresReportRunRecord[]> {
    this.listRunCalls.push(options ?? {});
    const limit = options?.limit ?? 50;
    const offset = options?.offset ?? 0;
    return this.runs
      .filter((run) => run.workspaceId === (options?.workspaceId ?? "default"))
      .filter((run) => !options?.scheduleId || run.scheduleId === options.scheduleId)
      .slice(offset, offset + limit);
  }

  async recordAuditEvent(input: RecordAuditEventInput): Promise<FakeStoredAuditEvent> {
    const audit: FakeStoredAuditEvent = {
      id: `aud_${this.audits.length + 1}`,
      workspaceId: input.workspaceId ?? "default",
      action: input.action,
      resourceType: input.resourceType ?? null,
      resourceId: input.resourceId ?? null,
      message: input.message ?? null,
      metadata: input.metadata ?? {},
      actor: input.actor ?? null,
      origin: input.origin ?? null,
      idempotencyKey: input.idempotencyKey ?? null,
      createdAt: input.createdAt ?? new Date(0).toISOString(),
    };
    this.audits.push(audit);
    return audit;
  }

  async listAuditEvents(options: Parameters<HostedPostgresReportRuntime["listAuditEvents"]>[0] = {}): Promise<AuditEvent[]> {
    const limit = options?.limit ?? 50;
    const offset = options?.offset ?? 0;
    return this.audits
      .filter((audit) => audit.workspaceId === (options?.workspaceId ?? "default"))
      .filter((audit) => !options?.resourceType || audit.resourceType === options.resourceType)
      .filter((audit) => !options?.resourceId || audit.resourceId === options.resourceId)
      .slice(offset, offset + limit);
  }

  private normalizeChannels(channels: ReportScheduleChannels): ReportScheduleChannels {
    const normalized: ReportScheduleChannels = {};
    for (const channel of ["email", "sms", "logs"] as const) {
      const value = channels[channel];
      if (value === undefined) continue;
      if (value === false) {
        normalized[channel] = false;
        continue;
      }
      if (value === true) throw new Error("hosted report schedules require explicit channelRefIds");
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error("hosted report schedule channels must use channelRefIds");
      }
      const keys = Object.keys(value);
      if (keys.some((key) => key !== "channelRefIds") || !Array.isArray((value as { channelRefIds?: unknown }).channelRefIds)) {
        throw new Error("hosted report schedules must not persist raw channel destinations or credentials");
      }
      const channelRefIds = (value as { channelRefIds: unknown[] }).channelRefIds.map((item, index) => {
        if (typeof item !== "string" || item.trim() === "") {
          throw new Error(`hosted report schedule ${channel} channelRefIds[${index}] must be a string`);
        }
        return item.trim();
      });
      if (channelRefIds.length === 0) throw new Error(`hosted report schedule ${channel} channelRefIds must not be empty`);
      normalized[channel] = { channelRefIds };
    }
    if (!normalized.email && !normalized.sms && !normalized.logs) {
      throw new Error("report schedule requires at least one channelRefId");
    }
    return normalized;
  }

  private findAuditReplay(workspaceId: string | null | undefined, action: string, resourceId: string | null | undefined, idempotencyKey: string | null | undefined): FakeStoredAuditEvent | null {
    if (!idempotencyKey) return null;
    const resolvedWorkspaceId = workspaceId ?? "default";
    return this.audits.find((audit) =>
      audit.workspaceId === resolvedWorkspaceId
      && audit.action === action
      && audit.idempotencyKey === idempotencyKey
      && (!resourceId || audit.resourceId === resourceId)
    ) ?? null;
  }

  private assertReplayHashMatches(existing: FakeStoredAuditEvent, audit: { metadata?: Record<string, unknown> }): void {
    const existingHash = existing.metadata?.requestHash;
    const nextHash = audit.metadata?.requestHash;
    if (existingHash && nextHash && existingHash !== nextHash) {
      throw new Error("report schedule idempotency conflict");
    }
  }
}

test("API creates monitors and returns summary", async () => {
  const service = new UptimeService({ dbPath: tempDb() });
  const handler = createApiHandler(service);

  const create = await handler(jsonRequest("http://127.0.0.1/api/monitors", "POST", { name: "api", kind: "http", url: "https://example.com" }));
  const created = await create.json();
  const summary = await handler(new Request("http://127.0.0.1/api/summary"));
  const body = await summary.json();

  expect(create.status).toBe(201);
  expect(created.name).toBe("api");
  expect(body.totals.monitors).toBe(1);
  service.close();
});

test("API accepts local signed probe jobs and submissions", async () => {
  const service = new UptimeService({ dbPath: tempDb() });
  const handler = createApiHandler(service);
  const createMonitor = await handler(jsonRequest("http://127.0.0.1/api/monitors", "POST", {
    name: "private-api",
    kind: "http",
    url: "https://example.com/health",
  }));
  const monitor = await createMonitor.json();
  const keyPair = generateProbeKeyPair();
  const missingKeyProbe = await handler(jsonRequest("http://127.0.0.1/api/probes", "POST", { name: "no-key" }));
  const createProbe = await handler(jsonRequest("http://127.0.0.1/api/probes", "POST", {
    name: "private-probe-01",
    publicKeyPem: keyPair.publicKeyPem,
  }));
  const probe = await createProbe.json();
  const createJob = await handler(jsonRequest("http://127.0.0.1/api/probes/jobs", "POST", {
    monitorId: monitor.id,
    scheduleSlot: "api-slot-1",
  }));
  const job = await createJob.json();
  const claimJob = await handler(jsonRequest(`http://127.0.0.1/api/probes/jobs/${job.id}/claim`, "POST", {
    probeId: probe.id,
  }));
  const claimed = await claimJob.json();
  const readJob = await handler(new Request(`http://127.0.0.1/api/probes/jobs/${job.id}`));
  const readableJob = await readJob.json();
  const unsigned: ProbeSigningInput = {
    probeId: probe.id,
    jobId: claimed.id,
    scheduleSlot: claimed.scheduleSlot,
    fencingToken: claimed.fencingToken,
    monitorId: monitor.id,
    nonce: "api-nonce-1",
    checkedAt: new Date().toISOString(),
    status: "up",
    latencyMs: 23,
    statusCode: 200,
    error: null,
    attemptCount: 1,
    monitorRevision: monitor.revision,
    evidence: null,
  };
  const submit = await handler(jsonRequest("http://127.0.0.1/api/probes/results", "POST", {
    ...unsigned,
    signature: signProbeResult(unsigned, keyPair.privateKeyPem),
  }));
  const body = await submit.json();

  expect(createProbe.status).toBe(201);
  expect(missingKeyProbe.status).toBe(400);
  expect(probe.privateKeyPem).toBeUndefined();
  expect(createJob.status).toBe(201);
  expect(claimJob.status).toBe(200);
  expect(readJob.status).toBe(200);
  expect(readableJob.fencingToken).toBeNull();
  expect(submit.status).toBe(201);
  expect(body.result.status).toBe("up");
  expect(body.receipt.jobId).toBe(claimed.id);
  expect(service.getProbeCheckJob(claimed.id)?.status).toBe("submitted");
  service.close();
});

test("hosted API routes probe enrollment, claims, and signed submissions through Postgres probe storage safely", async () => {
  const service = new UptimeService({ dbPath: tempDb(), mode: "hosted", allowHostedLocalStore: true });
  const probeRuntime = new FakeHostedPostgresProbeRuntime();
  const keyPair = generateProbeKeyPair();
  const idempotencyHeader = "idempotency-key";
  const handler = createApiHandler(service, {
    mode: "hosted",
    hostedPostgresProbeRuntime: probeRuntime,
    hostedTokens: [
      { token: "admin", scopes: ["uptime:admin", "uptime:read"], workspaceId: "ws_a", actor: "admin-a" },
      { token: "probe", scopes: ["uptime:probe"], workspaceId: "ws_a", actor: "probe-a", probeId: "prb_private_operator_01" },
      { token: "unbound-probe", scopes: ["uptime:probe"], workspaceId: "ws_a", actor: "probe-unbound" },
      { token: "wrong-probe", scopes: ["uptime:probe"], workspaceId: "ws_a", actor: "probe-wrong", probeId: "prb_private_operator_02" },
      { token: "other-probe", scopes: ["uptime:probe"], workspaceId: "ws_b", actor: "probe-b", probeId: "prb_private_operator_01" },
      { token: "read", scopes: ["uptime:read"], workspaceId: "ws_a", actor: "reader-a" },
    ],
  });

  const enrollmentBody = {
    id: "prb_private_operator_01",
    name: "Operator private probe",
    publicKeyPem: keyPair.publicKeyPem,
    probeClass: "private",
    probeLocation: "operator-01",
    machineId: "operator-01",
    capabilities: { http: true, tcp: true },
  };
  const probeTokenEnrollment = await handler(jsonRequest(
    "https://uptime.test/api/v1/probes",
    "POST",
    enrollmentBody,
    { origin: "https://uptime.test", authorization: "Bearer probe" },
  ));
  const enroll = await handler(jsonRequest(
    "https://uptime.test/api/v1/probes",
    "POST",
    enrollmentBody,
    { origin: "https://uptime.test", authorization: "Bearer admin", [idempotencyHeader]: "enroll-private-01" },
  ));
  const enrolled = await enroll.json();
  const readIdentity = await handler(new Request("https://uptime.test/api/v1/probes/prb_private_operator_01", {
    headers: { authorization: "Bearer read" },
  }));
  const readIdentityText = JSON.stringify(await readIdentity.json());
  const seeded = probeRuntime.seedJob({
    workspaceId: "ws_a",
    id: "job_private_1",
    monitorId: "mon_private_1",
    monitorRevision: 3,
    probePolicy: { probeClass: "private", locations: ["operator-01"] },
  });
  const workspaceMismatchClaim = await handler(jsonRequest(
    `https://uptime.test/api/v1/probes/jobs/${seeded.id}/claim`,
    "POST",
    { probeId: "prb_private_operator_01" },
    { origin: "https://uptime.test", authorization: "Bearer other-probe" },
  ));
  const unboundProbeClaim = await handler(jsonRequest(
    `https://uptime.test/api/v1/probes/jobs/${seeded.id}/claim`,
    "POST",
    { probeId: "prb_private_operator_01" },
    { origin: "https://uptime.test", authorization: "Bearer unbound-probe" },
  ));
  const wrongProbeClaim = await handler(jsonRequest(
    `https://uptime.test/api/v1/probes/jobs/${seeded.id}/claim`,
    "POST",
    { probeId: "prb_private_operator_01" },
    { origin: "https://uptime.test", authorization: "Bearer wrong-probe" },
  ));
  const adminProbeClaim = await handler(jsonRequest(
    `https://uptime.test/api/v1/probes/jobs/${seeded.id}/claim`,
    "POST",
    { probeId: "prb_private_operator_01" },
    { origin: "https://uptime.test", authorization: "Bearer admin" },
  ));
  const claim = await handler(jsonRequest(
    `https://uptime.test/api/v1/probes/jobs/${seeded.id}/claim`,
    "POST",
    { probeId: "prb_private_operator_01", leaseTtlMs: 120_000 },
    { origin: "https://uptime.test", authorization: "Bearer probe", [idempotencyHeader]: "claim-job-1" },
  ));
  const claimed = await claim.json();
  const unsigned: ProbeSigningInput = {
    probeId: "prb_private_operator_01",
    jobId: claimed.id,
    scheduleSlot: claimed.scheduleSlot,
    fencingToken: claimed.fencingToken,
    monitorId: claimed.monitorId,
    nonce: "nonce-hosted-1",
    checkedAt: "2026-01-01T00:00:30.000Z",
    status: "up",
    latencyMs: 42,
    statusCode: 200,
    error: null,
    attemptCount: 1,
    monitorRevision: claimed.monitorRevision,
    evidence: null,
  };
  const badSignature = await handler(jsonRequest(
    "https://uptime.test/api/v1/probes/results",
    "POST",
    { ...unsigned, signature: "not-valid" },
    { origin: "https://uptime.test", authorization: "Bearer probe" },
  ));
  const adminSubmit = await handler(jsonRequest(
    "https://uptime.test/api/v1/probes/results",
    "POST",
    { ...unsigned, signature: signProbeResult(unsigned, keyPair.privateKeyPem) },
    { origin: "https://uptime.test", authorization: "Bearer admin" },
  ));
  expect(badSignature.status).toBe(400);
  expect(adminSubmit.status).toBe(403);
  expect(probeRuntime.submissions).toHaveLength(0);
  const submit = await handler(jsonRequest(
    "https://uptime.test/api/v1/probes/results",
    "POST",
    { ...unsigned, signature: signProbeResult(unsigned, keyPair.privateKeyPem) },
    { origin: "https://uptime.test", authorization: "Bearer probe", [idempotencyHeader]: "submit-job-1" },
  ));
  const submitted = await submit.json();
  const list = await handler(new Request("https://uptime.test/api/v1/probes", {
    headers: { authorization: "Bearer read" },
  }));
  const serialized = JSON.stringify({ enrolled, claimed, submitted, readIdentityText });

  expect(probeTokenEnrollment.status).toBe(403);
  expect(enroll.status).toBe(201);
  expect(enrolled).toMatchObject({
    id: "prb_private_operator_01",
    probeClass: "private",
    probeLocation: "operator-01",
    machineId: "operator-01",
    capabilityKeys: ["http", "tcp"],
  });
  expect(serialized).not.toContain("BEGIN PUBLIC KEY");
  expect(enrolled.publicKeyPem).toBeUndefined();
  expect(readIdentity.status).toBe(200);
  expect(readIdentityText).not.toContain("BEGIN PUBLIC KEY");
  expect(workspaceMismatchClaim.status).toBe(404);
  expect(unboundProbeClaim.status).toBe(403);
  expect(wrongProbeClaim.status).toBe(403);
  expect(adminProbeClaim.status).toBe(403);
  expect(claim.status).toBe(200);
  expect(claimed.fencingToken).toBe("fence_fake_1");
  expect(claimed.monitorSnapshot).toMatchObject({ id: "mon_private_1", kind: "http" });
  expect(probeRuntime.submissions).toHaveLength(1);
  expect(submit.status).toBe(201);
  expect(submitted.result.status).toBe("up");
  expect(submitted.receipt.jobId).toBe("job_private_1");
  expect(probeRuntime.jobs.get("ws_a:job_private_1")?.status).toBe("submitted");
  expect(list.status).toBe(501);
  expect(probeRuntime.audits.map((audit) => audit.action)).toEqual([
    "probe_identity.upsert",
    "probe_job.claim",
    "probe_result.submit",
  ]);
  expect(probeRuntime.audits.every((audit) => audit.workspaceId === "ws_a")).toBe(true);
  service.close();
});

test("API rejects cross-origin state-changing requests", async () => {
  const service = new UptimeService({ dbPath: tempDb() });
  const handler = createApiHandler(service);

  const response = await handler(jsonRequest(
    "http://127.0.0.1:3899/api/monitors",
    "POST",
    { name: "csrf", kind: "http", url: "https://example.com" },
    { origin: "https://evil.example" },
  ));
  const summary = service.summary();

  expect(response.status).toBe(403);
  expect((await response.json()).error).toContain("cross-origin");
  expect(summary.totals.monitors).toBe(0);
  service.close();
});

test("API rejects non-loopback mutation hosts without a token", async () => {
  const service = new UptimeService({ dbPath: tempDb() });
  const handler = createApiHandler(service);

  const response = await handler(jsonRequest(
    "http://attacker.test:3899/api/monitors",
    "POST",
    { name: "dns-rebind", kind: "http", url: "https://example.com" },
    { origin: "http://attacker.test:3899" },
  ));

  expect(response.status).toBe(403);
  expect((await response.json()).error).toContain("non-loopback host rejected");
  expect(service.summary().totals.monitors).toBe(0);
  service.close();
});

test("API allows non-loopback mutation hosts with an API token", async () => {
  const service = new UptimeService({ dbPath: tempDb() });
  const handler = createApiHandler(service, { apiToken: "secret" });

  const response = await handler(jsonRequest(
    "http://internal.example:3899/api/monitors",
    "POST",
    { name: "token", kind: "http", url: "https://example.com" },
    { origin: "http://internal.example:3899", authorization: "Bearer secret" },
  ));

  expect(response.status).toBe(201);
  expect(service.summary().totals.monitors).toBe(1);
  service.close();
});

test("hosted API uses scoped /api/v1 auth and leaves legacy routes local-only", async () => {
  const service = new UptimeService({ dbPath: tempDb(), mode: "hosted", allowHostedLocalStore: true });
  const handler = createApiHandler(service, {
    mode: "hosted",
    hostedTokens: [
      { token: "read", scopes: ["uptime:read"], workspaceId: "ws_a" },
      { token: "write", scopes: ["uptime:write"], workspaceId: "ws_a" },
      { token: "read-b", scopes: ["uptime:read"], workspaceId: "ws_b" },
      { token: "write-b", scopes: ["uptime:write"], workspaceId: "ws_b" },
    ],
  });

  const health = await handler(new Request("https://uptime.test/health"));
  const dashboard = await handler(new Request("https://uptime.test/"));
  const authedDashboard = await handler(new Request("https://uptime.test/", {
    headers: { authorization: "Bearer read" },
  }));
  const summary = await handler(new Request("https://uptime.test/api/v1/summary"));
  const legacySummary = await handler(new Request("https://uptime.test/api/summary", {
    headers: { authorization: "Bearer read" },
  }));
  const authedSummary = await handler(new Request("https://uptime.test/api/v1/summary", {
    headers: { authorization: "Bearer read" },
  }));
  const readCreate = await handler(jsonRequest(
    "https://uptime.test/api/v1/monitors",
    "POST",
    { name: "read-only", kind: "http", url: "https://example.com" },
    { origin: "https://uptime.test", authorization: "Bearer read" },
  ));
  const create = await handler(jsonRequest(
    "https://uptime.test/api/v1/monitors",
    "POST",
    { name: "hosted", kind: "http", url: "https://example.com" },
    { origin: "https://uptime.test", authorization: "Bearer write" },
  ));
  const createOtherWorkspace = await handler(jsonRequest(
    "https://uptime.test/api/v1/monitors",
    "POST",
    { name: "hosted", kind: "http", url: "https://example.org" },
    { origin: "https://uptime.test", authorization: "Bearer write-b" },
  ));
  const otherWorkspaceSummary = await handler(new Request("https://uptime.test/api/v1/summary", {
    headers: { authorization: "Bearer read-b" },
  }));
  const otherWorkspaceMonitors = await handler(new Request("https://uptime.test/api/v1/monitors", {
    headers: { authorization: "Bearer read-b" },
  }));
  const crossWorkspaceGet = await handler(new Request(`https://uptime.test/api/v1/monitors/${(await create.clone().json()).id}`, {
    headers: { authorization: "Bearer read-b" },
  }));
  const workspaceMismatch = await handler(new Request("https://uptime.test/api/v1/summary", {
    headers: { authorization: "Bearer read", "x-uptime-workspace": "ws_b" },
  }));

  expect(health.status).toBe(200);
  expect(await health.json()).toMatchObject({ ok: true, mode: "hosted", dataMode: "hosted-local-sqlite" });
  expect(dashboard.status).toBe(401);
  expect(authedDashboard.status).toBe(501);
  expect(summary.status).toBe(401);
  expect(legacySummary.status).toBe(404);
  expect(authedSummary.status).toBe(200);
  expect(readCreate.status).toBe(403);
  expect(create.status).toBe(201);
  expect(createOtherWorkspace.status).toBe(201);
  expect((await otherWorkspaceSummary.json()).totals.monitors).toBe(1);
  expect(await otherWorkspaceMonitors.json()).toHaveLength(1);
  expect(crossWorkspaceGet.status).toBe(404);
  expect(workspaceMismatch.status).toBe(403);
  expect(service.summary({ workspaceId: "ws_a" }).totals.monitors + service.summary({ workspaceId: "ws_b" }).totals.monitors).toBe(2);
  service.close();
});

test("hosted readiness is authenticated and reports production data-mode gate without secrets", async () => {
  const service = new UptimeService({ dbPath: tempDb(), mode: "hosted", allowHostedLocalStore: true });
  const handler = createApiHandler(service, {
    mode: "hosted",
    hostedTokens: [
      { token: "read", scopes: ["uptime:read"], workspaceId: "ws_a", actor: "operator-a" },
    ],
  });

  const health = await handler(new Request("https://uptime.test/health"));
  const unauthReady = await handler(new Request("https://uptime.test/ready"));
  const ready = await handler(new Request("https://uptime.test/ready", {
    headers: { authorization: "Bearer read", "x-uptime-workspace": "ws_a" },
  }));
  const body = await ready.json();

  expect(health.status).toBe(200);
  expect(unauthReady.status).toBe(401);
  expect(ready.status).toBe(503);
  expect(body).toMatchObject({
    service: "uptime",
    ok: false,
    productionReady: false,
    mode: "hosted",
    dataMode: "hosted-local-sqlite",
    schemaVersion: "7",
    auth: { configured: true, checked: true },
  });
  expect(body.checks.map((check: { name: string }) => check.name)).toContain("hosted-data-mode");
  expect(JSON.stringify(body)).not.toContain("read");
  service.close();
});

test("hosted API audits monitor mutations with workspace and actor", async () => {
  const service = new UptimeService({ dbPath: tempDb(), mode: "hosted", allowHostedLocalStore: true });
  const handler = createApiHandler(service, {
    mode: "hosted",
    hostedTokens: [
      { token: "write", scopes: ["uptime:write"], workspaceId: "ws_a", actor: "operator-a" },
    ],
  });

  const create = await handler(jsonRequest(
    "https://uptime.test/api/v1/monitors",
    "POST",
    { name: "audited", kind: "http", url: "https://example.com" },
    { origin: "https://uptime.test", authorization: "Bearer write" },
  ));
  const monitor = await create.json();
  const update = await handler(jsonRequest(
    `https://uptime.test/api/v1/monitors/${monitor.id}`,
    "PATCH",
    { expectedStatus: 204 },
    { origin: "https://uptime.test", authorization: "Bearer write" },
  ));
  const remove = await handler(new Request(`https://uptime.test/api/v1/monitors/${monitor.id}`, {
    method: "DELETE",
    headers: { origin: "https://uptime.test", authorization: "Bearer write" },
  }));

  expect(create.status).toBe(201);
  expect(update.status).toBe(200);
  expect(remove.status).toBe(200);
  const events = service.listAuditEvents({ workspaceId: "ws_a", resourceType: "monitor", limit: 10 });
  expect(events.map((event) => event.action)).toEqual(["monitor.delete", "monitor.update", "monitor.create"]);
  expect(events.every((event) => event.workspaceId === "ws_a")).toBe(true);
  expect(events.every((event) => event.actor === "operator-a")).toBe(true);
  expect(service.listAuditEvents({ workspaceId: "ws_b" })).toHaveLength(0);
  service.close();
});

test("hosted API can route monitor control plane to Postgres without SQLite fallback", async () => {
  const service = new UptimeService({ dbPath: tempDb(), mode: "hosted", allowHostedLocalStore: true });
  const postgresRuntime = new FakeHostedPostgresMonitorRuntime();
  const handler = createApiHandler(service, {
    mode: "hosted",
    hostedPostgresRuntime: postgresRuntime,
    hostedTokens: [
      { token: "read-a", scopes: ["uptime:read"], workspaceId: "ws_a", actor: "reader-a" },
      { token: "write-a", scopes: ["uptime:write"], workspaceId: "ws_a", actor: "operator-a" },
      { token: "read-b", scopes: ["uptime:read"], workspaceId: "ws_b", actor: "reader-b" },
      { token: "write-b", scopes: ["uptime:write"], workspaceId: "ws_b", actor: "operator-b" },
    ],
  });

  const createA = await handler(jsonRequest(
    "https://uptime.test/api/v1/monitors",
    "POST",
    {
      workspaceId: "ws_body_should_be_ignored",
      name: "postgres-a",
      kind: "http",
      url: "https://a.example.com",
      status: "down",
      lastCheckedAt: "2026-01-01T00:00:00.000Z",
    },
    { origin: "https://uptime.test", authorization: "Bearer write-a", "idempotency-key": "create-a" },
  ));
  const monitorA = await createA.clone().json();
  const createB = await handler(jsonRequest(
    "https://uptime.test/api/v1/monitors",
    "POST",
    { name: "postgres-b", kind: "http", url: "https://b.example.com" },
    { origin: "https://uptime.test", authorization: "Bearer write-b" },
  ));
  const summaryA = await handler(new Request("https://uptime.test/api/v1/summary", {
    headers: { authorization: "Bearer read-a" },
  }));
  const monitorsA = await handler(new Request("https://uptime.test/api/v1/monitors", {
    headers: { authorization: "Bearer read-a" },
  }));
  const crossWorkspaceGet = await handler(new Request(`https://uptime.test/api/v1/monitors/${monitorA.id}`, {
    headers: { authorization: "Bearer read-b" },
  }));
  const updateA = await handler(jsonRequest(
    `https://uptime.test/api/v1/monitors/${monitorA.id}`,
    "PATCH",
    {
      workspaceId: "ws_body_should_be_ignored",
      expectedStatus: 204,
      status: "down",
      lastCheckedAt: "2026-01-01T00:00:00.000Z",
    },
    { origin: "https://uptime.test", authorization: "Bearer write-a", "idempotency-key": "update-a" },
  ));
  const updatedA = await updateA.json();
  const removeA = await handler(new Request(`https://uptime.test/api/v1/monitors/${monitorA.id}`, {
    method: "DELETE",
    headers: { origin: "https://uptime.test", authorization: "Bearer write-a", "idempotency-key": "delete-a" },
  }));
  const afterDelete = await handler(new Request("https://uptime.test/api/v1/monitors?includeDisabled=true", {
    headers: { authorization: "Bearer read-a" },
  }));

  expect(createA.status).toBe(201);
  expect(createB.status).toBe(201);
  expect((await summaryA.json()).totals.monitors).toBe(1);
  expect(await monitorsA.json()).toMatchObject([{ name: "postgres-a", workspaceId: "ws_a" }]);
  expect(crossWorkspaceGet.status).toBe(404);
  expect(updatedA).toMatchObject({ expectedStatus: 204, status: "unknown", lastCheckedAt: null });
  expect(await removeA.json()).toEqual({ deleted: true });
  expect(await afterDelete.json()).toEqual([]);
  expect(service.summary({ workspaceId: "ws_a" }).totals.monitors).toBe(0);
  expect(postgresRuntime.upserts[0]).toMatchObject({
    workspaceId: "ws_a",
    actor: "operator-a",
    origin: "hosted-api",
    idempotencyKey: "create-a",
  });
  expect(postgresRuntime.upserts[0]).not.toHaveProperty("status");
  expect(postgresRuntime.upserts[0]).not.toHaveProperty("lastCheckedAt");
  expect(postgresRuntime.upserts[1]).toMatchObject({
    workspaceId: "ws_b",
    actor: "operator-b",
    origin: "hosted-api",
  });
  expect(postgresRuntime.upserts[2]).toMatchObject({
    workspaceId: "ws_a",
    actor: "operator-a",
    origin: "hosted-api",
    status: "unknown",
    lastCheckedAt: null,
    expectedRevision: 1,
  });
  expect(postgresRuntime.upserts[2]).not.toHaveProperty("idempotencyKey");
  expect(postgresRuntime.audits.map((audit) => audit.action)).toEqual(["monitor.create", "monitor.create", "monitor.update", "monitor.delete"]);
  expect(postgresRuntime.audits.map((audit) => audit.idempotencyKey ?? null)).toEqual(["create-a", null, "update-a", "delete-a"]);
  expect(postgresRuntime.audits.every((audit) => audit.workspaceId === "ws_a" || audit.workspaceId === "ws_b")).toBe(true);
  expect(postgresRuntime.tombstones[0]).toMatchObject({
    workspaceId: "ws_a",
    resourceType: "monitor",
    resourceId: monitorA.id,
    actor: "operator-a",
    origin: "hosted-api",
    idempotencyKey: "delete-a",
  });
  service.close();
});

test("hosted Postgres monitor list forwards offset pagination", async () => {
  const service = new UptimeService({ dbPath: tempDb(), mode: "hosted", allowHostedLocalStore: true });
  const postgresRuntime = new FakeHostedPostgresMonitorRuntime();
  const handler = createApiHandler(service, {
    mode: "hosted",
    hostedPostgresRuntime: postgresRuntime,
    hostedTokens: [{ token: "read-a", scopes: ["uptime:read"], workspaceId: "ws_a" }],
  });

  for (const id of ["mon_001", "mon_002", "mon_003"]) {
    await postgresRuntime.upsertMonitor({
      workspaceId: "ws_a",
      id,
      name: id,
      kind: "http",
      url: `https://example.com/${id}`,
    });
  }

  const response = await handler(new Request("https://uptime.test/api/v1/monitors?includeDisabled=true&limit=1&offset=1", {
    headers: { authorization: "Bearer read-a" },
  }));
  const body = await response.json();

  expect(response.status).toBe(200);
  expect(body).toMatchObject([{ id: "mon_002", name: "mon_002" }]);
  expect(postgresRuntime.listCalls.at(-1)).toMatchObject({
    workspaceId: "ws_a",
    includeDisabled: true,
    limit: 1,
    offset: 1,
  });
  service.close();
});

test("hosted Postgres monitor create replays idempotency keys without mutating", async () => {
  const service = new UptimeService({ dbPath: tempDb(), mode: "hosted", allowHostedLocalStore: true });
  const postgresRuntime = new FakeHostedPostgresMonitorRuntime();
  const handler = createApiHandler(service, {
    mode: "hosted",
    hostedPostgresRuntime: postgresRuntime,
    hostedTokens: [{ token: "write-a", scopes: ["uptime:write"], workspaceId: "ws_a", actor: "operator-a" }],
  });
  const body = { name: " idempotent ", kind: "http", url: " https://example.com/health ", method: "get", enabled: true };

  const first = await handler(jsonRequest(
    "https://uptime.test/api/v1/monitors",
    "POST",
    body,
    { origin: "https://uptime.test", authorization: "Bearer write-a", "idempotency-key": "stable-create" },
  ));
  const firstBody = await first.clone().json();
  const replay = await handler(jsonRequest(
    "https://uptime.test/api/v1/monitors",
    "POST",
    body,
    { origin: "https://uptime.test", authorization: "Bearer write-a", "idempotency-key": "stable-create" },
  ));
  const replayBody = await replay.json();
  const patch = await handler(jsonRequest(
    `https://uptime.test/api/v1/monitors/${firstBody.id}`,
    "PATCH",
    { expectedStatus: 204 },
    { origin: "https://uptime.test", authorization: "Bearer write-a", "idempotency-key": "update-key" },
  ));
  const patchBody = await patch.clone().json();
  const patchReplay = await handler(jsonRequest(
    `https://uptime.test/api/v1/monitors/${firstBody.id}`,
    "PATCH",
    { expectedStatus: 204 },
    { origin: "https://uptime.test", authorization: "Bearer write-a", "idempotency-key": "update-key" },
  ));
  const patchReplayBody = await patchReplay.json();
  const patchReplayConflict = await handler(jsonRequest(
    `https://uptime.test/api/v1/monitors/${firstBody.id}`,
    "PATCH",
    { expectedStatus: 500 },
    { origin: "https://uptime.test", authorization: "Bearer write-a", "idempotency-key": "update-key" },
  ));
  const patchReplayConflictBody = await patchReplayConflict.json();
  const conflict = await handler(jsonRequest(
    "https://uptime.test/api/v1/monitors",
    "POST",
    { ...body, url: "https://example.com/other" },
    { origin: "https://uptime.test", authorization: "Bearer write-a", "idempotency-key": "stable-create" },
  ));
  const conflictBody = await conflict.json();

  expect(first.status).toBe(201);
  expect(replay.status).toBe(201);
  expect(replayBody).toEqual(firstBody);
  expect(patch.status).toBe(200);
  expect(patchReplay.status).toBe(200);
  expect(patchReplayBody).toEqual(patchBody);
  expect(patchReplayConflict.status).toBe(409);
  expect(patchReplayConflictBody.error).toBe("idempotency key conflict");
  expect(conflict.status).toBe(409);
  expect(conflictBody.error).toBe("idempotency key conflict");
  expect(postgresRuntime.upserts).toHaveLength(2);
  expect(postgresRuntime.audits).toHaveLength(2);
  expect(postgresRuntime.upserts[0]).toMatchObject({ idempotencyKey: "stable-create" });
  expect(postgresRuntime.upserts[1]).not.toHaveProperty("idempotencyKey");
  await expect(postgresRuntime.getMonitor({ workspaceId: "ws_a", id: firstBody.id })).resolves.toMatchObject({
    idempotencyKey: "stable-create",
    expectedStatus: 204,
  });
  service.close();
});

test("hosted Postgres create idempotency does not resurrect keyless deletes", async () => {
  const service = new UptimeService({ dbPath: tempDb(), mode: "hosted", allowHostedLocalStore: true });
  const postgresRuntime = new FakeHostedPostgresMonitorRuntime();
  const handler = createApiHandler(service, {
    mode: "hosted",
    hostedPostgresRuntime: postgresRuntime,
    hostedTokens: [{ token: "write-a", scopes: ["uptime:write"], workspaceId: "ws_a", actor: "operator-a" }],
  });
  const body = { name: "deleted-replay", kind: "http", url: "https://example.com/deleted" };

  const create = await handler(jsonRequest(
    "https://uptime.test/api/v1/monitors",
    "POST",
    body,
    { origin: "https://uptime.test", authorization: "Bearer write-a", "idempotency-key": "create-before-delete" },
  ));
  const monitor = await create.clone().json();
  const remove = await handler(new Request(`https://uptime.test/api/v1/monitors/${monitor.id}`, {
    method: "DELETE",
    headers: { origin: "https://uptime.test", authorization: "Bearer write-a" },
  }));
  const staleReplay = await handler(jsonRequest(
    "https://uptime.test/api/v1/monitors",
    "POST",
    body,
    { origin: "https://uptime.test", authorization: "Bearer write-a", "idempotency-key": "create-before-delete" },
  ));
  const staleReplayBody = await staleReplay.json();
  const stored = postgresRuntime.monitors.get(`ws_a:${monitor.id}`);

  expect(create.status).toBe(201);
  expect(remove.status).toBe(200);
  expect(staleReplay.status).toBe(409);
  expect(staleReplayBody.error).toBe("idempotency key conflict");
  expect(await postgresRuntime.getMonitor({ workspaceId: "ws_a", id: monitor.id })).toBeNull();
  expect(stored).toMatchObject({
    idempotencyKey: "create-before-delete",
    deletedAt: "1970-01-01T00:00:00.000Z",
  });
  expect(postgresRuntime.audits.map((audit) => audit.action)).toEqual(["monitor.create", "monitor.delete"]);
  service.close();
});

test("hosted Postgres PATCH refuses stale updates after a concurrent tombstone", async () => {
  const service = new UptimeService({ dbPath: tempDb(), mode: "hosted", allowHostedLocalStore: true });
  const postgresRuntime = new FakeHostedPostgresMonitorRuntime();
  const handler = createApiHandler(service, {
    mode: "hosted",
    hostedPostgresRuntime: postgresRuntime,
    hostedTokens: [{ token: "write-a", scopes: ["uptime:write"], workspaceId: "ws_a", actor: "operator-a" }],
  });

  const create = await handler(jsonRequest(
    "https://uptime.test/api/v1/monitors",
    "POST",
    { name: "race", kind: "http", url: "https://example.com/race" },
    { origin: "https://uptime.test", authorization: "Bearer write-a", "idempotency-key": "race-create" },
  ));
  const monitor = await create.clone().json();
  postgresRuntime.deleteBeforeNextExpectedRevisionUpsert = true;

  const stalePatch = await handler(jsonRequest(
    `https://uptime.test/api/v1/monitors/${monitor.id}`,
    "PATCH",
    { expectedStatus: 204 },
    { origin: "https://uptime.test", authorization: "Bearer write-a", "idempotency-key": "race-update" },
  ));
  const body = await stalePatch.json();
  const stored = postgresRuntime.monitors.get(`ws_a:${monitor.id}`);

  expect(create.status).toBe(201);
  expect(stalePatch.status).toBe(409);
  expect(body.error).toBe("monitor update conflict");
  expect(await postgresRuntime.getMonitor({ workspaceId: "ws_a", id: monitor.id })).toBeNull();
  expect(stored).toMatchObject({
    idempotencyKey: "race-create",
    deletedAt: "1970-01-01T00:00:00.000Z",
  });
  expect(postgresRuntime.upserts).toHaveLength(1);
  expect(postgresRuntime.audits.map((audit) => audit.action)).toEqual(["monitor.create"]);
  service.close();
});

test("hosted Postgres summary paginates past the monitor list safety clamp", async () => {
  const service = new UptimeService({ dbPath: tempDb(), mode: "hosted", allowHostedLocalStore: true });
  const postgresRuntime = new FakeHostedPostgresMonitorRuntime();
  const handler = createApiHandler(service, {
    mode: "hosted",
    hostedPostgresRuntime: postgresRuntime,
    hostedTokens: [{ token: "read-a", scopes: ["uptime:read"], workspaceId: "ws_a" }],
  });

  for (let index = 0; index < 501; index++) {
    await postgresRuntime.upsertMonitor({
      workspaceId: "ws_a",
      id: `mon_${String(index).padStart(4, "0")}`,
      name: `monitor-${index}`,
      kind: "http",
      url: `https://example.com/${index}`,
      enabled: index % 2 === 0,
    });
  }

  const response = await handler(new Request("https://uptime.test/api/v1/summary", {
    headers: { authorization: "Bearer read-a" },
  }));
  const body = await response.json();

  expect(response.status).toBe(200);
  expect(body.monitors).toHaveLength(501);
  expect(body.totals).toMatchObject({
    monitors: 501,
    enabled: 251,
    paused: 250,
    unknown: 251,
  });
  expect(postgresRuntime.listCalls).toHaveLength(2);
  expect(postgresRuntime.listCalls[0]).toMatchObject({ workspaceId: "ws_a", includeDisabled: true, limit: 500 });
  expect(postgresRuntime.listCalls[0]?.offset).toBe(0);
  expect(postgresRuntime.listCalls[1]).toMatchObject({ workspaceId: "ws_a", includeDisabled: true, limit: 500, offset: 500 });
  service.close();
});

test("hosted Postgres adapter blocks non-migrated reads and redacts runtime errors", async () => {
  const service = new UptimeService({ dbPath: tempDb(), mode: "hosted", allowHostedLocalStore: true });
  const postgresRuntime = new FakeHostedPostgresMonitorRuntime();
  const handler = createApiHandler(service, {
    mode: "hosted",
    hostedPostgresRuntime: postgresRuntime,
    hostedTokens: [
      { token: "read-a", scopes: ["uptime:read"], workspaceId: "ws_a" },
      { token: "write-a", scopes: ["uptime:write"], workspaceId: "ws_a" },
    ],
  });

  try {
    const report = await handler(new Request("https://uptime.test/api/v1/report", {
      headers: { authorization: "Bearer read-a" },
    }));
    const results = await handler(new Request("https://uptime.test/api/v1/results", {
      headers: { authorization: "Bearer read-a" },
    }));
    const incidents = await handler(new Request("https://uptime.test/api/v1/incidents", {
      headers: { authorization: "Bearer read-a" },
    }));
    const importPreview = await handler(jsonRequest(
      "https://uptime.test/api/v1/imports/preview",
      "POST",
      { source: "manual", records: [] },
      { origin: "https://uptime.test", authorization: "Bearer write-a" },
    ));

    expect(report.status).toBe(501);
    expect(results.status).toBe(501);
    expect(incidents.status).toBe(501);
    expect(importPreview.status).toBe(501);

    postgresRuntime.failListError = new Error(
      "SELECT * FROM private_table failed for postgres://svc:super-secret@db.example.invalid/uptime?sslmode=require&token=raw Authorization: Bearer raw-token arn:aws:iam::123456789012:role/private",
    );
    const failed = await handler(new Request("https://uptime.test/api/v1/monitors", {
      headers: { authorization: "Bearer read-a" },
    }));
    const body = await failed.json();

    expect(failed.status).toBe(400);
    expect(body.error).toBe("database operation failed");
    expect(JSON.stringify(body)).not.toContain("super-secret");
    expect(JSON.stringify(body)).not.toContain("raw-token");
    expect(JSON.stringify(body)).not.toContain("123456789012");
    expect(JSON.stringify(body)).not.toContain("private_table");

    postgresRuntime.failListError = new Error(
      "duplicate key value violates unique constraint \"monitors_workspace_id_id_key\" Detail: Key (workspace_id,id)=(ws_secret,mon_secret) already exists.",
    );
    const failedConstraint = await handler(new Request("https://uptime.test/api/v1/monitors", {
      headers: { authorization: "Bearer read-a" },
    }));
    const constraintBody = await failedConstraint.json();

    expect(failedConstraint.status).toBe(400);
    expect(constraintBody.error).toBe("database operation failed");
    expect(JSON.stringify(constraintBody)).not.toContain("monitors_workspace_id_id_key");
    expect(JSON.stringify(constraintBody)).not.toContain("ws_secret");
  } finally {
    service.close();
  }
});

test("hosted API import preview cannot observe monitors from another workspace", async () => {
  const service = new UptimeService({ dbPath: tempDb(), mode: "hosted", allowHostedLocalStore: true });
  const handler = createApiHandler(service, {
    mode: "hosted",
    hostedTokens: [
      { token: "write-a", scopes: ["uptime:write"], workspaceId: "ws_a" },
      { token: "write-b", scopes: ["uptime:write"], workspaceId: "ws_b" },
    ],
  });

  const create = await handler(jsonRequest(
    "https://uptime.test/api/v1/monitors",
    "POST",
    { name: "shared-name", kind: "http", url: "https://a.example.com" },
    { origin: "https://uptime.test", authorization: "Bearer write-a" },
  ));
  const preview = await handler(jsonRequest(
    "https://uptime.test/api/v1/imports/preview",
    "POST",
    {
      source: "manual",
      records: [{ sourceId: "manual:shared-name", monitor: { name: "shared-name", kind: "http", url: "https://b.example.com" } }],
    },
    { origin: "https://uptime.test", authorization: "Bearer write-b" },
  ));
  const body = await preview.json();

  expect(create.status).toBe(201);
  expect(preview.status).toBe(200);
  expect(body.items[0]).toMatchObject({ action: "create", monitor: null, provenance: null });
  expect(JSON.stringify(body)).not.toContain("ws_a");
  expect(JSON.stringify(body)).not.toContain("a.example.com");
  service.close();
});

test("hosted API fails closed when auth token is not configured", async () => {
  const service = new UptimeService({ dbPath: tempDb(), mode: "hosted", allowHostedLocalStore: true });
  const handler = createApiHandler(service, { mode: "hosted" });

  const health = await handler(new Request("https://uptime.test/health"));
  const summary = await handler(new Request("https://uptime.test/api/v1/summary"));

  expect(health.status).toBe(200);
  expect(summary.status).toBe(503);
  expect((await summary.json()).error).toContain("hosted auth token is not configured");
  service.close();
});

test("hosted API reads scoped token descriptors from environment JSON", async () => {
  const previousTokens = process.env.HASNA_UPTIME_HOSTED_TOKENS;
  const previousToken = process.env.HASNA_UPTIME_HOSTED_TOKEN;
  const previousWorkspace = process.env.HASNA_UPTIME_WORKSPACE_ID;
  process.env.HASNA_UPTIME_WORKSPACE_ID = "ws_env";
  process.env.HASNA_UPTIME_HOSTED_TOKEN = "legacy-broad-token";
  process.env.HASNA_UPTIME_HOSTED_TOKENS = JSON.stringify({
    tokens: [
      { token: "env-read", scopes: ["uptime:read"] },
      { token: "env-write", scopes: ["uptime:write"], workspaceId: "ws_env" },
    ],
  });
  const service = new UptimeService({ dbPath: tempDb(), mode: "hosted", allowHostedLocalStore: true });
  const handler = createApiHandler(service, { mode: "hosted" });

  try {
    const readSummary = await handler(new Request("https://uptime.test/api/v1/summary", {
      headers: { authorization: "Bearer env-read" },
    }));
    const readCreate = await handler(jsonRequest(
      "https://uptime.test/api/v1/monitors",
      "POST",
      { name: "read-only", kind: "http", url: "https://example.com" },
      { origin: "https://uptime.test", authorization: "Bearer env-read" },
    ));
    const writeCreate = await handler(jsonRequest(
      "https://uptime.test/api/v1/monitors",
      "POST",
      { name: "writer", kind: "http", url: "https://example.com" },
      { origin: "https://uptime.test", authorization: "Bearer env-write" },
    ));
    const legacyFallback = await handler(new Request("https://uptime.test/api/v1/summary", {
      headers: { authorization: "Bearer legacy-broad-token" },
    }));
    const workspaceMismatch = await handler(new Request("https://uptime.test/api/v1/summary?workspaceId=other", {
      headers: { authorization: "Bearer env-read" },
    }));

    expect(readSummary.status).toBe(200);
    expect(readCreate.status).toBe(403);
    expect(writeCreate.status).toBe(201);
    expect(legacyFallback.status).toBe(401);
    expect(workspaceMismatch.status).toBe(403);
    expect(service.summary({ workspaceId: "ws_env" }).totals.monitors).toBe(1);
  } finally {
    service.close();
    if (previousTokens === undefined) delete process.env.HASNA_UPTIME_HOSTED_TOKENS;
    else process.env.HASNA_UPTIME_HOSTED_TOKENS = previousTokens;
    if (previousToken === undefined) delete process.env.HASNA_UPTIME_HOSTED_TOKEN;
    else process.env.HASNA_UPTIME_HOSTED_TOKEN = previousToken;
    if (previousWorkspace === undefined) delete process.env.HASNA_UPTIME_WORKSPACE_ID;
    else process.env.HASNA_UPTIME_WORKSPACE_ID = previousWorkspace;
  }
});

test("hosted API accepts descriptor JSON from HASNA_UPTIME_HOSTED_TOKEN", async () => {
  const previousTokens = process.env.HASNA_UPTIME_HOSTED_TOKENS;
  const previousToken = process.env.HASNA_UPTIME_HOSTED_TOKEN;
  delete process.env.HASNA_UPTIME_HOSTED_TOKENS;
  process.env.HASNA_UPTIME_HOSTED_TOKEN = JSON.stringify({
    tokens: [
      { token: "json-read", scopes: ["uptime:read"], workspaceId: "ws_json" },
      { token: "json-write", scopes: ["uptime:write"], workspaceId: "ws_json" },
    ],
  });
  const service = new UptimeService({ dbPath: tempDb(), mode: "hosted", allowHostedLocalStore: true });
  const handler = createApiHandler(service, { mode: "hosted" });

  try {
    const summary = await handler(new Request("https://uptime.test/api/v1/summary", {
      headers: { authorization: "Bearer json-read" },
    }));
    const readCreate = await handler(jsonRequest(
      "https://uptime.test/api/v1/monitors",
      "POST",
      { name: "read-only", kind: "http", url: "https://example.com" },
      { origin: "https://uptime.test", authorization: "Bearer json-read" },
    ));
    const writeCreate = await handler(jsonRequest(
      "https://uptime.test/api/v1/monitors",
      "POST",
      { name: "writer", kind: "http", url: "https://example.com" },
      { origin: "https://uptime.test", authorization: "Bearer json-write" },
    ));

    expect(summary.status).toBe(200);
    expect(readCreate.status).toBe(403);
    expect(writeCreate.status).toBe(201);
  } finally {
    service.close();
    if (previousTokens === undefined) delete process.env.HASNA_UPTIME_HOSTED_TOKENS;
    else process.env.HASNA_UPTIME_HOSTED_TOKENS = previousTokens;
    if (previousToken === undefined) delete process.env.HASNA_UPTIME_HOSTED_TOKEN;
    else process.env.HASNA_UPTIME_HOSTED_TOKEN = previousToken;
  }
});

test("hosted API rejects invalid hosted token descriptors", async () => {
  const previousTokens = process.env.HASNA_UPTIME_HOSTED_TOKENS;
  process.env.HASNA_UPTIME_HOSTED_TOKENS = JSON.stringify({
    tokens: [{ token: "bad", scopes: ["uptime:root"] }],
  });
  const service = new UptimeService({ dbPath: tempDb(), mode: "hosted", allowHostedLocalStore: true });
  const handler = createApiHandler(service, { mode: "hosted" });

  try {
    const summary = await handler(new Request("https://uptime.test/api/v1/summary", {
      headers: { authorization: "Bearer bad" },
    }));
    expect(summary.status).toBe(500);
    expect((await summary.json()).error).toContain("invalid hosted scope");
  } finally {
    service.close();
    if (previousTokens === undefined) delete process.env.HASNA_UPTIME_HOSTED_TOKENS;
    else process.env.HASNA_UPTIME_HOSTED_TOKENS = previousTokens;
  }
});

test("hosted API rejects raw broad hosted token in production auth mode", async () => {
  const previousAuthMode = process.env.HASNA_UPTIME_HOSTED_AUTH_MODE;
  const previousToken = process.env.HASNA_UPTIME_HOSTED_TOKEN;
  process.env.HASNA_UPTIME_HOSTED_AUTH_MODE = "production";
  process.env.HASNA_UPTIME_HOSTED_TOKEN = "raw-broad";
  const service = new UptimeService({ dbPath: tempDb(), mode: "hosted", allowHostedLocalStore: true });
  const handler = createApiHandler(service, { mode: "hosted" });

  try {
    const summary = await handler(new Request("https://uptime.test/api/v1/summary", {
      headers: { authorization: "Bearer raw-broad" },
    }));
    expect(summary.status).toBe(500);
    expect((await summary.json()).error).toContain("scoped hosted token JSON");
  } finally {
    service.close();
    if (previousAuthMode === undefined) delete process.env.HASNA_UPTIME_HOSTED_AUTH_MODE;
    else process.env.HASNA_UPTIME_HOSTED_AUTH_MODE = previousAuthMode;
    if (previousToken === undefined) delete process.env.HASNA_UPTIME_HOSTED_TOKEN;
    else process.env.HASNA_UPTIME_HOSTED_TOKEN = previousToken;
  }
});

test("hosted API rejects raw broad hosted token by default", async () => {
  const previousAuthMode = process.env.HASNA_UPTIME_HOSTED_AUTH_MODE;
  const previousAllowLegacy = process.env.HASNA_UPTIME_ALLOW_LEGACY_HOSTED_TOKEN;
  const previousToken = process.env.HASNA_UPTIME_HOSTED_TOKEN;
  const previousTokens = process.env.HASNA_UPTIME_HOSTED_TOKENS;
  delete process.env.HASNA_UPTIME_HOSTED_AUTH_MODE;
  delete process.env.HASNA_UPTIME_ALLOW_LEGACY_HOSTED_TOKEN;
  delete process.env.HASNA_UPTIME_HOSTED_TOKENS;
  process.env.HASNA_UPTIME_HOSTED_TOKEN = "raw-broad";
  const service = new UptimeService({ dbPath: tempDb(), mode: "hosted", allowHostedLocalStore: true });
  const handler = createApiHandler(service, { mode: "hosted" });

  try {
    const summary = await handler(new Request("https://uptime.test/api/v1/summary", {
      headers: { authorization: "Bearer raw-broad" },
    }));
    expect(summary.status).toBe(500);
    expect((await summary.json()).error).toContain("scoped hosted token JSON");
  } finally {
    service.close();
    if (previousAuthMode === undefined) delete process.env.HASNA_UPTIME_HOSTED_AUTH_MODE;
    else process.env.HASNA_UPTIME_HOSTED_AUTH_MODE = previousAuthMode;
    if (previousAllowLegacy === undefined) delete process.env.HASNA_UPTIME_ALLOW_LEGACY_HOSTED_TOKEN;
    else process.env.HASNA_UPTIME_ALLOW_LEGACY_HOSTED_TOKEN = previousAllowLegacy;
    if (previousToken === undefined) delete process.env.HASNA_UPTIME_HOSTED_TOKEN;
    else process.env.HASNA_UPTIME_HOSTED_TOKEN = previousToken;
    if (previousTokens === undefined) delete process.env.HASNA_UPTIME_HOSTED_TOKENS;
    else process.env.HASNA_UPTIME_HOSTED_TOKENS = previousTokens;
  }
});

test("hosted API allows raw broad hosted token only with explicit local compatibility flag", async () => {
  const previousAllowLegacy = process.env.HASNA_UPTIME_ALLOW_LEGACY_HOSTED_TOKEN;
  const previousToken = process.env.HASNA_UPTIME_HOSTED_TOKEN;
  const previousTokens = process.env.HASNA_UPTIME_HOSTED_TOKENS;
  delete process.env.HASNA_UPTIME_HOSTED_TOKENS;
  process.env.HASNA_UPTIME_ALLOW_LEGACY_HOSTED_TOKEN = "1";
  process.env.HASNA_UPTIME_HOSTED_TOKEN = "raw-local";
  const service = new UptimeService({ dbPath: tempDb(), mode: "hosted", allowHostedLocalStore: true });
  const handler = createApiHandler(service, { mode: "hosted" });

  try {
    const summary = await handler(new Request("https://uptime.test/api/v1/summary", {
      headers: { authorization: "Bearer raw-local" },
    }));
    expect(summary.status).toBe(200);
  } finally {
    service.close();
    if (previousAllowLegacy === undefined) delete process.env.HASNA_UPTIME_ALLOW_LEGACY_HOSTED_TOKEN;
    else process.env.HASNA_UPTIME_ALLOW_LEGACY_HOSTED_TOKEN = previousAllowLegacy;
    if (previousToken === undefined) delete process.env.HASNA_UPTIME_HOSTED_TOKEN;
    else process.env.HASNA_UPTIME_HOSTED_TOKEN = previousToken;
    if (previousTokens === undefined) delete process.env.HASNA_UPTIME_HOSTED_TOKENS;
    else process.env.HASNA_UPTIME_HOSTED_TOKENS = previousTokens;
  }
});

test("hosted API rejects raw broad hosted token when NODE_ENV is production", async () => {
  const previousAuthMode = process.env.HASNA_UPTIME_HOSTED_AUTH_MODE;
  const previousNodeEnv = process.env.NODE_ENV;
  const previousToken = process.env.HASNA_UPTIME_HOSTED_TOKEN;
  const previousTokens = process.env.HASNA_UPTIME_HOSTED_TOKENS;
  delete process.env.HASNA_UPTIME_HOSTED_AUTH_MODE;
  delete process.env.HASNA_UPTIME_HOSTED_TOKENS;
  process.env.NODE_ENV = "production";
  process.env.HASNA_UPTIME_HOSTED_TOKEN = "raw-broad";
  const service = new UptimeService({ dbPath: tempDb(), mode: "hosted", allowHostedLocalStore: true });
  const handler = createApiHandler(service, { mode: "hosted" });

  try {
    const summary = await handler(new Request("https://uptime.test/api/v1/summary", {
      headers: { authorization: "Bearer raw-broad" },
    }));
    expect(summary.status).toBe(500);
    expect((await summary.json()).error).toContain("scoped hosted token JSON");
  } finally {
    service.close();
    if (previousAuthMode === undefined) delete process.env.HASNA_UPTIME_HOSTED_AUTH_MODE;
    else process.env.HASNA_UPTIME_HOSTED_AUTH_MODE = previousAuthMode;
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
    if (previousToken === undefined) delete process.env.HASNA_UPTIME_HOSTED_TOKEN;
    else process.env.HASNA_UPTIME_HOSTED_TOKEN = previousToken;
    if (previousTokens === undefined) delete process.env.HASNA_UPTIME_HOSTED_TOKENS;
    else process.env.HASNA_UPTIME_HOSTED_TOKENS = previousTokens;
  }
});

test("built API rejects raw broad hosted token when NODE_ENV is production", async () => {
  const previousAuthMode = process.env.HASNA_UPTIME_HOSTED_AUTH_MODE;
  const previousNodeEnv = process.env.NODE_ENV;
  const previousToken = process.env.HASNA_UPTIME_HOSTED_TOKEN;
  const previousTokens = process.env.HASNA_UPTIME_HOSTED_TOKENS;
  delete process.env.HASNA_UPTIME_HOSTED_AUTH_MODE;
  delete process.env.HASNA_UPTIME_HOSTED_TOKENS;
  process.env.NODE_ENV = "production";
  process.env.HASNA_UPTIME_HOSTED_TOKEN = "raw-broad";
  const distPath = "../dist/index.js";
  const dist = await import(distPath) as unknown as {
    UptimeService: typeof UptimeService;
    createApiHandler: (service: unknown, options: { mode: "hosted" }) => (request: Request) => Promise<Response>;
  };
  const service = new dist.UptimeService({ dbPath: tempDb(), mode: "hosted", allowHostedLocalStore: true });
  const handler = dist.createApiHandler(service, { mode: "hosted" });

  try {
    const summary = await handler(new Request("https://uptime.test/api/v1/summary", {
      headers: { authorization: "Bearer raw-broad" },
    }));
    expect(summary.status).toBe(500);
    expect((await summary.json()).error).toContain("scoped hosted token JSON");
  } finally {
    service.close();
    if (previousAuthMode === undefined) delete process.env.HASNA_UPTIME_HOSTED_AUTH_MODE;
    else process.env.HASNA_UPTIME_HOSTED_AUTH_MODE = previousAuthMode;
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
    if (previousToken === undefined) delete process.env.HASNA_UPTIME_HOSTED_TOKEN;
    else process.env.HASNA_UPTIME_HOSTED_TOKEN = previousToken;
    if (previousTokens === undefined) delete process.env.HASNA_UPTIME_HOSTED_TOKENS;
    else process.env.HASNA_UPTIME_HOSTED_TOKENS = previousTokens;
  }
});

test("hosted API still rejects cross-origin mutations with a valid token", async () => {
  const service = new UptimeService({ dbPath: tempDb(), mode: "hosted", allowHostedLocalStore: true });
  const handler = createApiHandler(service, { mode: "hosted", hostedToken: HOSTED_SECRET_TOKEN_JSON });

  const response = await handler(jsonRequest(
    "https://uptime.test/api/v1/monitors",
    "POST",
    { name: "hosted-csrf", kind: "http", url: "https://example.com" },
    { origin: "https://evil.test", authorization: "Bearer secret" },
  ));

  expect(response.status).toBe(403);
  expect((await response.json()).error).toContain("cross-origin");
  expect(service.summary({ workspaceId: "default" }).totals.monitors).toBe(0);
  service.close();
});

test("hosted API accepts configured public origin behind a CloudFront edge origin path", async () => {
  const previousAllowedOrigins = process.env.HASNA_UPTIME_ALLOWED_ORIGINS;
  process.env.HASNA_UPTIME_ALLOWED_ORIGINS = "https://d111111abcdef8.cloudfront.net";
  const service = new UptimeService({ dbPath: tempDb(), mode: "hosted", allowHostedLocalStore: true });
  const handler = createApiHandler(service, { mode: "hosted", hostedToken: HOSTED_SECRET_TOKEN_JSON });

  try {
    const create = await handler(jsonRequest(
      "http://internal-open-uptime-alb/api/v1/monitors",
      "POST",
      { name: "cloudfront", kind: "http", url: "https://example.com" },
      { origin: "https://d111111abcdef8.cloudfront.net", authorization: "Bearer secret" },
    ));
    const rejected = await handler(jsonRequest(
      "http://internal-open-uptime-alb/api/v1/monitors",
      "POST",
      { name: "wrong-origin", kind: "http", url: "https://example.com" },
      { origin: "https://other.example", authorization: "Bearer secret" },
    ));

    expect(create.status).toBe(201);
    expect(rejected.status).toBe(403);
    expect((await rejected.json()).error).toContain("cross-origin");
    expect(service.summary({ workspaceId: "default" }).totals.monitors).toBe(1);
  } finally {
    if (previousAllowedOrigins === undefined) delete process.env.HASNA_UPTIME_ALLOWED_ORIGINS;
    else process.env.HASNA_UPTIME_ALLOWED_ORIGINS = previousAllowedOrigins;
    service.close();
  }
});

test("hosted API blocks raw report delivery and inline checks", async () => {
  const service = new UptimeService({ dbPath: tempDb(), mode: "hosted", allowHostedLocalStore: true });
  service.createMonitor({ workspaceId: "default", name: "api", kind: "http", url: "https://example.com" });
  const handler = createApiHandler(service, {
    mode: "hosted",
    hostedTokens: [
      { token: "report", scopes: ["uptime:report"] },
      { token: "probe", scopes: ["uptime:probe"] },
    ],
  });

  const report = await handler(jsonRequest(
    "https://uptime.test/api/v1/report",
    "POST",
    { logs: { apiUrl: "https://logs.example", projectId: "open-uptime" } },
    { origin: "https://uptime.test", authorization: "Bearer report" },
  ));
  const checkAll = await handler(new Request("https://uptime.test/api/v1/check-all", {
    method: "POST",
    headers: { origin: "https://uptime.test", authorization: "Bearer probe" },
  }));

  expect(report.status).toBe(501);
  expect((await report.json()).error).toContain("channel refs");
  expect(checkAll.status).toBe(501);
  expect((await checkAll.json()).error).toContain("check_jobs");
  service.close();
});

test("hosted API fails closed for probe identities, jobs, and result ingest", async () => {
  const service = new UptimeService({ dbPath: tempDb(), mode: "hosted", allowHostedLocalStore: true });
  const handler = createApiHandler(service, {
    mode: "hosted",
    hostedTokens: [
      { token: "read", scopes: ["uptime:read"] },
      { token: "probe", scopes: ["uptime:probe"] },
      { token: "admin", scopes: ["uptime:admin"] },
    ],
  });

  const list = await handler(new Request("https://uptime.test/api/v1/probes", {
    headers: { authorization: "Bearer read" },
  }));
  const create = await handler(jsonRequest(
    "https://uptime.test/api/v1/probes",
    "POST",
    { name: "private-probe-01" },
    { origin: "https://uptime.test", authorization: "Bearer admin" },
  ));
  const job = await handler(jsonRequest(
    "https://uptime.test/api/v1/probes/jobs",
    "POST",
    { monitorId: "mon_missing", scheduleSlot: "slot-1" },
    { origin: "https://uptime.test", authorization: "Bearer probe" },
  ));
  const result = await handler(jsonRequest(
    "https://uptime.test/api/v1/probes/results",
    "POST",
    {},
    { origin: "https://uptime.test", authorization: "Bearer probe" },
  ));

  expect(list.status).toBe(501);
  expect(create.status).toBe(501);
  expect(job.status).toBe(501);
  expect(result.status).toBe(501);
  expect((await result.json()).error).toContain("cloud check_jobs");
  service.close();
});

test("hosted API enforces target policy at monitor creation", async () => {
  const service = new UptimeService({ dbPath: tempDb(), mode: "hosted", allowHostedLocalStore: true });
  const handler = createApiHandler(service, { mode: "hosted", hostedToken: HOSTED_SECRET_TOKEN_JSON });
  const cases = [
    { name: "loopback", kind: "http", url: "http://127.0.0.1:3000" },
    { name: "metadata", kind: "http", url: "http://169.254.169.254/latest/meta-data" },
    { name: "mapped-loopback", kind: "http", url: "http://[::ffff:7f00:1]/" },
    { name: "mapped-private", kind: "http", url: "http://[::ffff:a00:1]/" },
    { name: "mapped-metadata", kind: "http", url: "http://[::ffff:a9fe:a9fe]/" },
    { name: "mapped-private-2", kind: "http", url: "http://[::ffff:c0a8:1]/" },
    { name: "userinfo", kind: "http", url: "https://user:pass@example.com" },
    { name: "secret-query", kind: "http", url: "https://example.com/?api_key=secret" },
    { name: "private-tcp", kind: "tcp", host: "10.0.0.1", port: 5432 },
    { name: "mapped-private-tcp", kind: "tcp", host: "::ffff:a00:1", port: 5432 },
  ];

  for (const input of cases) {
    const response = await handler(jsonRequest(
      "https://uptime.test/api/v1/monitors",
      "POST",
      input,
      { origin: "https://uptime.test", authorization: "Bearer secret" },
    ));
    expect(response.status).toBe(400);
  }
  expect(service.summary({ workspaceId: "default" }).totals.monitors).toBe(0);
  service.close();
});

test("hosted API enforces target policy on monitor patch before mutation and audit", async () => {
  const service = new UptimeService({ dbPath: tempDb(), mode: "hosted", allowHostedLocalStore: true });
  const handler = createApiHandler(service, { mode: "hosted", hostedToken: HOSTED_SECRET_TOKEN_JSON });

  const create = await handler(jsonRequest(
    "https://uptime.test/api/v1/monitors",
    "POST",
    { name: "safe", kind: "http", url: "https://example.com/health" },
    { origin: "https://uptime.test", authorization: "Bearer secret" },
  ));
  const monitor = await create.json();
  const patch = await handler(jsonRequest(
    `https://uptime.test/api/v1/monitors/${monitor.id}`,
    "PATCH",
    { url: "http://169.254.169.254/latest/meta-data" },
    { origin: "https://uptime.test", authorization: "Bearer secret" },
  ));
  const body = await patch.json();
  const stored = service.getMonitor(monitor.id, { workspaceId: "default" });
  const audits = service.listAuditEvents({ workspaceId: "default", resourceType: "monitor", resourceId: monitor.id });

  expect(create.status).toBe(201);
  expect(patch.status).toBe(400);
  expect(body.error).toContain("private or reserved IPv4");
  expect(stored?.url).toBe("https://example.com/health");
  expect(stored?.revision).toBe(monitor.revision);
  expect(audits.map((event) => event.action)).toEqual(["monitor.create"]);
  service.close();
});

test("local API keeps local target behavior outside hosted mode", async () => {
  const service = new UptimeService({ dbPath: tempDb() });
  const handler = createApiHandler(service);

  const response = await handler(jsonRequest(
    "http://127.0.0.1:3899/api/monitors",
    "POST",
    { name: "local dev", kind: "http", url: "http://127.0.0.1:3000/health" },
  ));
  const monitor = await response.json();

  expect(response.status).toBe(201);
  expect(monitor.url).toBe("http://127.0.0.1:3000/health");
  expect(service.summary().totals.monitors).toBe(1);
  service.close();
});

test("API previews and applies import candidates", async () => {
  const service = new UptimeService({ dbPath: tempDb() });
  const handler = createApiHandler(service);
  const payload = {
    source: "manual",
    records: [{ sourceId: "api", monitor: { name: "api import", kind: "http", url: "https://example.com/health" } }],
  };

  const preview = await handler(jsonRequest("http://127.0.0.1/api/imports/preview", "POST", payload));
  const previewBody = await preview.json();
  const apply = await handler(jsonRequest("http://127.0.0.1/api/imports/apply", "POST", payload));
  const applyBody = await apply.json();

  expect(preview.status).toBe(200);
  expect(previewBody.totals.create).toBe(1);
  expect(service.summary().totals.monitors).toBe(1);
  expect(apply.status).toBe(201);
  expect(applyBody.batchId).toStartWith("imp_");
  expect(applyBody.totals.create).toBe(1);
  service.close();
});

test("hosted API import apply and rollback fail closed", async () => {
  const service = new UptimeService({ dbPath: tempDb(), mode: "hosted", allowHostedLocalStore: true });
  const handler = createApiHandler(service, { mode: "hosted", hostedToken: HOSTED_SECRET_TOKEN_JSON });

  const preview = await handler(jsonRequest(
    "https://uptime.test/api/v1/imports/preview",
    "POST",
    { source: "manual", records: [{ sourceId: "api", monitor: { name: "api", kind: "http", url: "https://example.com" } }] },
    { origin: "https://uptime.test", authorization: "Bearer secret" },
  ));
  const apply = await handler(jsonRequest(
    "https://uptime.test/api/v1/imports/apply",
    "POST",
    { source: "manual", records: [{ sourceId: "api", monitor: { name: "api", kind: "http", url: "https://example.com" } }] },
    { origin: "https://uptime.test", authorization: "Bearer secret" },
  ));
  const rollback = await handler(jsonRequest(
    "https://uptime.test/api/v1/imports/imp_missing/rollback",
    "POST",
    {},
    { origin: "https://uptime.test", authorization: "Bearer secret" },
  ));

  expect(preview.status).toBe(200);
  expect(apply.status).toBe(501);
  expect((await apply.json()).error).toContain("cloud import_batches");
  expect(rollback.status).toBe(501);
  service.close();
});

test("hosted handler rejects a local-mode service", () => {
  const service = new UptimeService({ dbPath: tempDb() });
  expect(() => createApiHandler(service, { mode: "hosted", hostedToken: HOSTED_SECRET_TOKEN_JSON }))
    .toThrow("API mode hosted does not match store mode local");
  service.close();
});

test("serve hosted mode requires an auth token before startup", () => {
  expect(() => serveUptime({
    mode: "hosted",
    allowHostedLocalStore: true,
    dbPath: tempDb(),
  })).toThrow("hosted mode requires HASNA_UPTIME_HOSTED_TOKEN or --hosted-token");
});

test("serve hosted mode rejects inline scheduler", () => {
  expect(() => serveUptime({
    mode: "hosted",
    allowHostedLocalStore: true,
    hostedToken: HOSTED_SECRET_TOKEN_JSON,
    check: true,
    dbPath: tempDb(),
  })).toThrow("hosted scheduler requires check_jobs and probes");
});

test("serve hosted mode allows explicit dev SQLite path only with fallback flag", async () => {
  const dir = mkdtempSync(join(tmpdir(), "open-uptime-hosted-serve-"));
  cleanup.push(dir);
  let runtime: ReturnType<typeof serveUptime> | undefined;
  try {
    runtime = serveUptime({
      mode: "hosted",
      hostedToken: HOSTED_SECRET_TOKEN_JSON,
      hostedSqliteDbPath: join(dir, "data", "uptime.db"),
      allowHostedLocalStore: true,
      port: 0,
    });
    const health = await fetch(`http://${runtime.server.hostname}:${runtime.server.port}/health`);
    expect(await health.json()).toMatchObject({
      ok: true,
      mode: "hosted",
      dataMode: "hosted-local-sqlite",
    });
  } finally {
    runtime?.server.stop(true);
  }
});

test("serve default stays local when hosted env vars are set", () => {
  const previousMode = process.env.HASNA_UPTIME_MODE;
  const previousToken = process.env.HASNA_UPTIME_HOSTED_TOKEN;
  process.env.HASNA_UPTIME_MODE = "hosted";
  delete process.env.HASNA_UPTIME_HOSTED_TOKEN;
  let runtime: ReturnType<typeof serveUptime> | undefined;
  try {
    runtime = serveUptime({ dbPath: tempDb(), port: 0 });
    expect(runtime.service.store.mode).toBe("local");
    expect(runtime.service.store.dataMode).toBe("local-sqlite");
  } finally {
    runtime?.server.stop(true);
    runtime?.service.close();
    if (previousMode === undefined) delete process.env.HASNA_UPTIME_MODE;
    else process.env.HASNA_UPTIME_MODE = previousMode;
    if (previousToken === undefined) delete process.env.HASNA_UPTIME_HOSTED_TOKEN;
    else process.env.HASNA_UPTIME_HOSTED_TOKEN = previousToken;
  }
});

test("API rejects tokenless mutations when served on a non-loopback bind even with loopback Host", async () => {
  const service = new UptimeService({ dbPath: tempDb() });
  const handler = createApiHandler(service, { trustedLoopback: false });

  const response = await handler(jsonRequest(
    "http://127.0.0.1:3899/api/monitors",
    "POST",
    { name: "forged-host", kind: "http", url: "https://example.com" },
  ));

  expect(response.status).toBe(403);
  expect(service.summary().totals.monitors).toBe(0);
  service.close();
});

test("API rejects non-JSON bodies for JSON mutations", async () => {
  const service = new UptimeService({ dbPath: tempDb() });
  const handler = createApiHandler(service);

  const response = await handler(new Request("http://127.0.0.1:3899/api/monitors", {
    method: "POST",
    headers: { "content-type": "text/plain" },
    body: JSON.stringify({ name: "plain", kind: "http", url: "https://example.com" }),
  }));

  expect(response.status).toBe(415);
  expect(service.summary().totals.monitors).toBe(0);
  service.close();
});

test("API rejects unbounded retry settings", async () => {
  const service = new UptimeService({ dbPath: tempDb() });
  const handler = createApiHandler(service);

  const response = await handler(jsonRequest("http://127.0.0.1:3899/api/monitors", "POST", {
    name: "dos",
    kind: "http",
    url: "https://example.com",
    retryCount: 10_000,
  }));
  const body = await response.json();

  expect(response.status).toBe(400);
  expect(body.error).toContain("retryCount must be an integer from 0 to 10");
  expect(service.summary().totals.monitors).toBe(0);
  service.close();
});

test("API rejects invalid enabled types", async () => {
  const service = new UptimeService({ dbPath: tempDb() });
  const handler = createApiHandler(service);

  const response = await handler(jsonRequest("http://127.0.0.1:3899/api/monitors", "POST", {
    name: "bad-enabled",
    kind: "http",
    url: "https://example.com",
    enabled: 0,
  }));
  const body = await response.json();

  expect(response.status).toBe(400);
  expect(body.error).toContain("enabled must be a boolean");
  expect(service.summary().totals.monitors).toBe(0);
  service.close();
});

test("API patches monitor configuration", async () => {
  const service = new UptimeService({ dbPath: tempDb() });
  const handler = createApiHandler(service);
  const create = await handler(jsonRequest("http://127.0.0.1/api/monitors", "POST", { name: "api", kind: "http", url: "https://example.com" }));
  const monitor = await create.json();

  const patch = await handler(jsonRequest(`http://127.0.0.1/api/monitors/${monitor.id}`, "PATCH", { method: "head", expectedStatus: 204, intervalSeconds: 30 }));
  const updated = await patch.json();

  expect(patch.status).toBe(200);
  expect(updated.method).toBe("HEAD");
  expect(updated.expectedStatus).toBe(204);
  expect(updated.intervalSeconds).toBe(30);
  service.close();
});

test("API ignores raw status changes without a check result", async () => {
  const service = new UptimeService({ dbPath: tempDb() });
  const handler = createApiHandler(service);
  const create = await handler(jsonRequest("http://127.0.0.1/api/monitors", "POST", { name: "api", kind: "http", url: "https://example.com" }));
  const monitor = await create.json();

  const patch = await handler(jsonRequest(`http://127.0.0.1/api/monitors/${monitor.id}`, "PATCH", { status: "down" }));
  const updated = await patch.json();
  const summary = await handler(new Request("http://127.0.0.1/api/summary"));
  const body = await summary.json();

  expect(patch.status).toBe(200);
  expect(updated.status).toBe("unknown");
  expect(body.totals.down).toBe(0);
  expect(body.totals.openIncidents).toBe(0);
  expect(body.monitors[0].totalChecks).toBe(0);
  service.close();
});

test("API target updates reset status and last check time", async () => {
  const service = new UptimeService({
    dbPath: tempDb(),
    checkRunner: async () => ({ status: "up", latencyMs: 1, statusCode: 200, error: null }),
  });
  const handler = createApiHandler(service);
  const create = await handler(jsonRequest("http://127.0.0.1/api/monitors", "POST", { name: "api", kind: "http", url: "https://old.example/health" }));
  const monitor = await create.json();
  await handler(new Request(`http://127.0.0.1/api/monitors/${monitor.id}/check`, { method: "POST" }));

  const patch = await handler(jsonRequest(`http://127.0.0.1/api/monitors/${monitor.id}`, "PATCH", { url: "https://new.example/health" }));
  const updated = await patch.json();

  expect(updated.status).toBe("unknown");
  expect(updated.lastCheckedAt).toBeNull();
  service.close();
});

test("API exposes check-all results, incidents, result history, and delete", async () => {
  let up = false;
  const service = new UptimeService({
    dbPath: tempDb(),
    checkRunner: async () => up
      ? { status: "up", latencyMs: 20, statusCode: 200, error: null }
      : { status: "down", latencyMs: 50, statusCode: 500, error: "down" },
  });
  const handler = createApiHandler(service);
  const create = await handler(jsonRequest("http://127.0.0.1/api/monitors", "POST", { name: "api", kind: "http", url: "https://example.com" }));
  const monitor = await create.json();

  const down = await handler(new Request("http://127.0.0.1/api/check-all", { method: "POST" }));
  up = true;
  const recovered = await handler(new Request(`http://127.0.0.1/api/monitors/${monitor.id}/check`, { method: "POST" }));
  const results = await handler(new Request("http://127.0.0.1/api/results?limit=5"));
  const incidents = await handler(new Request("http://127.0.0.1/api/incidents?limit=5"));
  const deleted = await handler(new Request(`http://127.0.0.1/api/monitors/${monitor.id}`, { method: "DELETE" }));

  expect((await down.json())[0].status).toBe("down");
  expect((await recovered.json()).status).toBe("up");
  expect(await results.json()).toHaveLength(2);
  expect((await incidents.json())[0].status).toBe("closed");
  expect((await deleted.json()).deleted).toBe(true);
  service.close();
});

test("API builds and sends reports with injected fetch", async () => {
  const calls: string[] = [];
  const service = new UptimeService({ dbPath: tempDb() });
  service.createMonitor({ name: "api", kind: "http", url: "https://example.com" });
  const handler = createApiHandler(service, {
    fetchImpl: (async (url: string | URL | Request) => {
      calls.push(String(url));
      return new Response(JSON.stringify({ id: "ok" }), { status: 201 });
    }) as typeof fetch,
  });

  const report = await handler(new Request("http://127.0.0.1:3899/api/report"));
  const send = await handler(jsonRequest("http://127.0.0.1:3899/api/report", "POST", {
    logs: { apiUrl: "http://logs.test", projectId: "uptime" },
  }));

  expect(report.status).toBe(200);
  expect((await report.json()).json.kind).toBe("open-uptime.report");
  expect(send.status).toBe(200);
  expect((await send.json())[0].ok).toBe(true);
  expect(calls).toEqual(["http://logs.test/api/logs/structured?format=json&source=structured&service=open-uptime&project_id=uptime&environment=test"]);
  service.close();
});

test("API manages scheduled reports, report runs, and audit events", async () => {
  const calls: string[] = [];
  const service = new UptimeService({ dbPath: tempDb() });
  service.createMonitor({ name: "api", kind: "http", url: "https://example.com" });
  const handler = createApiHandler(service, {
    fetchImpl: (async (url: string | URL | Request) => {
      calls.push(String(url));
      return new Response(JSON.stringify({ id: "ok" }), { status: 201 });
    }) as typeof fetch,
  });

  const create = await handler(jsonRequest("http://127.0.0.1:3899/api/report-schedules", "POST", {
    name: "ops",
    intervalSeconds: 60,
    nextRunAt: "2026-01-01T00:00:00.000Z",
    channels: { logs: { apiUrl: "http://logs.test", projectId: "uptime" } },
  }));
  const schedule = await create.json();
  const run = await handler(new Request(`http://127.0.0.1:3899/api/report-schedules/${schedule.id}/run`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  }));
  const runs = await handler(new Request(`http://127.0.0.1:3899/api/report-runs?scheduleId=${schedule.id}`));
  const audit = await handler(new Request(`http://127.0.0.1:3899/api/audit-events?resourceId=${schedule.id}`));
  const list = await handler(new Request("http://127.0.0.1:3899/api/report-schedules?includeDisabled=true"));

  expect(create.status).toBe(201);
  expect(run.status).toBe(200);
  expect((await run.json()).status).toBe("success");
  expect(await runs.json()).toHaveLength(1);
  expect((await audit.json()).map((event: any) => event.action)).toContain("report_schedule.run");
  expect(await list.json()).toHaveLength(1);
  expect(calls).toEqual(["http://logs.test/api/logs/structured?format=json&source=structured&service=open-uptime&project_id=uptime&environment=test"]);
  service.close();
});

test("hosted API fails closed for report schedules, runs, and audit events", async () => {
  const service = new UptimeService({ dbPath: tempDb(), mode: "hosted", allowHostedLocalStore: true });
  const handler = createApiHandler(service, {
    mode: "hosted",
    hostedTokens: [
      { token: "read", scopes: ["uptime:read"] },
      { token: "report", scopes: ["uptime:report"] },
    ],
  });

  const list = await handler(new Request("https://uptime.test/api/v1/report-schedules", {
    headers: { authorization: "Bearer read" },
  }));
  const createSchedule = await handler(jsonRequest(
    "https://uptime.test/api/v1/report-schedules",
    "POST",
    { name: "ops", intervalSeconds: 60, channels: { logs: true } },
    { origin: "https://uptime.test", authorization: "Bearer report" },
  ));
  const runs = await handler(new Request("https://uptime.test/api/v1/report-runs", {
    headers: { authorization: "Bearer read" },
  }));
  const audit = await handler(new Request("https://uptime.test/api/v1/audit-events", {
    headers: { authorization: "Bearer read" },
  }));

  expect(list.status).toBe(501);
  expect(createSchedule.status).toBe(501);
  expect(runs.status).toBe(501);
  expect(audit.status).toBe(501);
  expect((await createSchedule.json()).error).toContain("Postgres report storage");
  service.close();
});

test("hosted API routes report metadata through Postgres report storage safely", async () => {
  const service = new UptimeService({ dbPath: tempDb(), mode: "hosted", allowHostedLocalStore: true });
  const reportRuntime = new FakeHostedPostgresReportRuntime();
  const handler = createApiHandler(service, {
    mode: "hosted",
    hostedPostgresReportRuntime: reportRuntime,
    hostedTokens: [
      { token: "read", scopes: ["uptime:read"], workspaceId: "ws_a", actor: "reader-a" },
      { token: "report", scopes: ["uptime:report"], workspaceId: "ws_a", actor: "operator-a" },
    ],
  });

  const create = await handler(jsonRequest(
    "https://uptime.test/api/v1/report-schedules",
    "POST",
    {
      name: "ops",
      intervalSeconds: 300,
      nextRunAt: "2026-01-01T00:00:00.000Z",
      channels: { logs: { channelRefIds: ["logs-prod"] } },
    },
    { origin: "https://uptime.test", authorization: "Bearer report", "idempotency-key": "create-ops" },
  ));
  const schedule = await create.json();
  const replay = await handler(jsonRequest(
    "https://uptime.test/api/v1/report-schedules",
    "POST",
    {
      name: "ops",
      intervalSeconds: 300,
      nextRunAt: "2026-01-01T00:00:00.000Z",
      channels: { logs: { channelRefIds: ["logs-prod"] } },
    },
    { origin: "https://uptime.test", authorization: "Bearer report", "idempotency-key": "create-ops" },
  ));
  const conflict = await handler(jsonRequest(
    "https://uptime.test/api/v1/report-schedules",
    "POST",
    {
      name: "ops",
      intervalSeconds: 600,
      nextRunAt: "2026-01-01T00:00:00.000Z",
      channels: { logs: { channelRefIds: ["logs-prod"] } },
    },
    { origin: "https://uptime.test", authorization: "Bearer report", "idempotency-key": "create-ops" },
  ));
  const list = await handler(new Request("https://uptime.test/api/v1/report-schedules?includeDisabled=true&limit=10&offset=0", {
    headers: { authorization: "Bearer read" },
  }));
  const patch = await handler(jsonRequest(
    `https://uptime.test/api/v1/report-schedules/${schedule.id}`,
    "PATCH",
    { subject: "Daily uptime", channels: { logs: { channelRefIds: ["logs-prod", "logs-audit"] } } },
    { origin: "https://uptime.test", authorization: "Bearer report", "idempotency-key": "patch-ops" },
  ));
  const rawChannels = await handler(jsonRequest(
    `https://uptime.test/api/v1/report-schedules/${schedule.id}`,
    "PATCH",
    { channels: { logs: { apiUrl: "https://logs.internal/private", projectId: "uptime" } } },
    { origin: "https://uptime.test", authorization: "Bearer report", "idempotency-key": "patch-raw" },
  ));
  reportRuntime.runs.push({
    workspaceId: "ws_a",
    id: "rpr_1",
    scheduleId: schedule.id,
    status: "running",
    startedAt: "2026-01-01T00:00:01.000Z",
    finishedAt: null,
    deliveries: [],
    error: null,
    reportJson: null,
    artifactRef: "s3://private-bucket/ws_a/reports/rpr_1.json",
    actor: "reporter",
    origin: "hosted-worker",
    idempotencyKey: null,
    claimedByWorkerId: "worker-a",
    fencingToken: "fence-secret",
    leaseExpiresAt: "2026-01-01T00:05:00.000Z",
    version: 1,
  });
  await reportRuntime.recordAuditEvent({
    workspaceId: "ws_a",
    action: "report_schedule.audit_test",
    resourceType: "report_schedule",
    resourceId: schedule.id,
    message: "send alice@example.com to arn:aws:iam::123456789012:role/private",
    metadata: { email: "alice@example.com", path: "/home/hasna/.hasna/private", object: "s3://private-bucket/report.json" },
    actor: "operator-a",
  });
  const runs = await handler(new Request(`https://uptime.test/api/v1/report-runs?scheduleId=${schedule.id}`, {
    headers: { authorization: "Bearer read" },
  }));
  const audit = await handler(new Request(`https://uptime.test/api/v1/audit-events?resourceId=${schedule.id}`, {
    headers: { authorization: "Bearer read" },
  }));
  const run = await handler(new Request(`https://uptime.test/api/v1/report-schedules/${schedule.id}/run`, {
    method: "POST",
    headers: { authorization: "Bearer report", origin: "https://uptime.test", "content-type": "application/json" },
    body: "{}",
  }));
  const workspaceMismatch = await handler(new Request("https://uptime.test/api/v1/report-schedules?workspaceId=ws_b", {
    headers: { authorization: "Bearer read" },
  }));
  const remove = await handler(new Request(`https://uptime.test/api/v1/report-schedules/${schedule.id}`, {
    method: "DELETE",
    headers: { authorization: "Bearer report", origin: "https://uptime.test", "idempotency-key": "delete-ops" },
  }));
  const removeReplay = await handler(new Request(`https://uptime.test/api/v1/report-schedules/${schedule.id}`, {
    method: "DELETE",
    headers: { authorization: "Bearer report", origin: "https://uptime.test", "idempotency-key": "delete-ops" },
  }));

  expect(create.status).toBe(201);
  expect(schedule.channels.logs).toEqual({ channelRefIds: ["logs-prod"] });
  expect((await replay.json()).id).toBe(schedule.id);
  expect(conflict.status).toBe(409);
  expect((await list.json()).map((item: { id: string }) => item.id)).toEqual([schedule.id]);
  expect(reportRuntime.listScheduleCalls.at(-1)).toEqual({ workspaceId: "ws_a", includeDisabled: true, limit: 10, offset: 0 });
  expect(patch.status).toBe(200);
  expect(reportRuntime.updateCalls[0]).toEqual({ idOrName: schedule.id, expectedRevision: 1 });
  expect(rawChannels.status).toBe(400);
  expect(JSON.stringify(await rawChannels.json())).not.toContain("logs.internal");
  const runsBody = await runs.json();
  expect(runs.status).toBe(200);
  expect(runsBody[0].artifactRef).toBeUndefined();
  expect(runsBody[0].artifactRefHash).toStartWith("sha256:");
  expect(JSON.stringify(runsBody)).not.toContain("private-bucket");
  const auditText = JSON.stringify(await audit.json());
  expect(audit.status).toBe(200);
  expect(auditText).not.toContain("alice@example.com");
  expect(auditText).not.toContain("123456789012");
  expect(auditText).not.toContain("/home/hasna");
  expect(run.status).toBe(501);
  expect(workspaceMismatch.status).toBe(403);
  expect((await remove.json()).deleted).toBe(true);
  expect((await removeReplay.json()).deleted).toBe(true);
  expect(reportRuntime.audits.filter((event) => event.action === "report_schedule.create")).toHaveLength(1);
  expect(reportRuntime.audits.find((event) => event.action === "report_schedule.create")).toMatchObject({
    actor: "operator-a",
    origin: "hosted-api",
    idempotencyKey: "create-ops",
    resourceType: "report_schedule",
    resourceId: schedule.id,
  });
  service.close();
});

test("dashboard route returns HTML", async () => {
  const service = new UptimeService({ dbPath: tempDb() });
  const handler = createApiHandler(service);
  const response = await handler(new Request("http://127.0.0.1/"));
  const body = await response.text();

  expect(response.headers.get("content-type")).toContain("text/html");
  expect(body).toContain("Open Uptime");
  expect(body).toContain("monitor-form");
  expect(body).toContain("Recent Results");
  expect(body).toContain("textContent");
  expect(body).not.toContain("m.name +");
  service.close();
});
