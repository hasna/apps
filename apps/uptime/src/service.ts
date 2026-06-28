import { runMonitorCheck } from "./checks.js";
import { createPublicKey, randomUUID } from "node:crypto";
import { applyImport, previewImport, rollbackImport, type ImportApplyResult, type ImportPreview, type ImportRequest, type ImportRollbackResult } from "./imports.js";
import { generateProbeKeyPair, probePublicKeyFingerprint, verifyProbeResultSignature } from "./probes.js";
import { StaleCheckResultError, UptimeStore, type MonitorProvenance, type SaveImportBatchInput, type StoredImportBatch, type UpsertMonitorProvenanceInput, type UptimeBackup, type UptimeBackupCheck, type UptimeStoreOptions } from "./store.js";
import { buildUptimeReport, sendUptimeReport, type BuildUptimeReportOptions, type SendUptimeReportOptions, type UptimeReport, type UptimeReportDelivery } from "./report.js";
import type {
  CheckAttemptResult,
  CheckResult,
  CreateProbeInput,
  CreateProbeResult,
  CreateMonitorInput,
  Incident,
  ImportedMonitorInput,
  ImportedUpdateMonitorInput,
  ListResultsOptions,
  Monitor,
  ProbeCheckJob,
  ProbeIdentity,
  ProbeResultSubmission,
  ProbeSubmissionReceipt,
  SchedulerHandle,
  UpdateMonitorInput,
  UptimeSummary,
} from "./types.js";

const MAX_PROBE_RESULT_AGE_MS = 15 * 60_000;
const MAX_PROBE_RESULT_FUTURE_MS = 5 * 60_000;

export interface UptimeServiceOptions extends UptimeStoreOptions {
  store?: UptimeStoreLike;
  checkRunner?: (monitor: Monitor) => Promise<CheckAttemptResult>;
}

export interface UptimeStoreLike {
  readonly dbPath: string;
  readonly mode: "local" | "hosted";
  readonly dataMode: "local-sqlite" | "hosted-local-sqlite";
  close(): void;
  createMonitor(input: ImportedMonitorInput, options?: { allowBrowserPage?: boolean }): Monitor;
  updateMonitor(idOrName: string, input: ImportedUpdateMonitorInput, options?: { allowBrowserPage?: boolean }): Monitor;
  deleteMonitor(idOrName: string): boolean;
  listMonitors(options?: { includeDisabled?: boolean }): Monitor[];
  getMonitor(idOrName: string): Monitor | null;
  getCheckResult?(id: string): CheckResult | null;
  listResults(options?: ListResultsOptions): CheckResult[];
  listIncidents(options?: { status?: "open" | "closed"; monitorId?: string; limit?: number }): Incident[];
  summary(): UptimeSummary;
  backup(destinationPath?: string): UptimeBackup;
  verifyBackup(backupPath: string): UptimeBackupCheck;
  acquireCheckLease(monitorId: string, owner: string, ttlMs: number): boolean;
  releaseCheckLease(monitorId: string, owner: string): void;
  recordCheckResult(input: Omit<CheckResult, "id" | "checkedAt"> & { checkedAt?: string; expectedMonitorRevision?: number }): CheckResult;
  getProvenance(source: string, sourceId: string): MonitorProvenance | null;
  upsertMonitorProvenance(input: UpsertMonitorProvenanceInput): MonitorProvenance;
  saveImportBatch(input: SaveImportBatchInput): StoredImportBatch;
  getImportBatch(batchId: string): StoredImportBatch | null;
  markImportBatchRolledBack(batchId: string): StoredImportBatch;
  createProbeIdentity?(input: { name: string; publicKeyPem: string; publicKeyFingerprint: string; enabled?: boolean }): ProbeIdentity;
  listProbeIdentities?(options?: { includeDisabled?: boolean }): ProbeIdentity[];
  getProbeIdentity?(idOrName: string): ProbeIdentity | null;
  updateProbeIdentity?(idOrName: string, input: { enabled?: boolean; name?: string }): ProbeIdentity;
  touchProbeIdentity?(idOrName: string, seenAt?: string): void;
  createProbeCheckJob?(input: { monitorId: string; scheduleSlot: string; dueAt?: string }): ProbeCheckJob;
  getProbeCheckJob?(id: string): ProbeCheckJob | null;
  claimProbeCheckJob?(input: { jobId: string; probeId: string; leaseTtlMs?: number }): ProbeCheckJob;
  completeProbeCheckJob?(input: { jobId: string; probeId: string; fencingToken: string; checkResultId: string; submittedAt?: string }): ProbeCheckJob;
  getProbeSubmission?(probeId: string, nonce: string): ProbeSubmissionReceipt | null;
  recordProbeSubmission?(input: Omit<ProbeSubmissionReceipt, "id" | "submittedAt"> & { submittedAt?: string }): ProbeSubmissionReceipt;
  runInTransaction?<T>(fn: () => T): T;
}

type ProbeStoreLike = UptimeStoreLike & {
  createProbeIdentity(input: { name: string; publicKeyPem: string; publicKeyFingerprint: string; enabled?: boolean }): ProbeIdentity;
  listProbeIdentities(options?: { includeDisabled?: boolean }): ProbeIdentity[];
  getProbeIdentity(idOrName: string): ProbeIdentity | null;
  updateProbeIdentity(idOrName: string, input: { enabled?: boolean; name?: string }): ProbeIdentity;
  touchProbeIdentity(idOrName: string, seenAt?: string): void;
  createProbeCheckJob(input: { monitorId: string; scheduleSlot: string; dueAt?: string }): ProbeCheckJob;
  getProbeCheckJob(id: string): ProbeCheckJob | null;
  claimProbeCheckJob(input: { jobId: string; probeId: string; leaseTtlMs?: number }): ProbeCheckJob;
  completeProbeCheckJob(input: { jobId: string; probeId: string; fencingToken: string; checkResultId: string; submittedAt?: string }): ProbeCheckJob;
  getProbeSubmission(probeId: string, nonce: string): ProbeSubmissionReceipt | null;
  recordProbeSubmission(input: Omit<ProbeSubmissionReceipt, "id" | "submittedAt"> & { submittedAt?: string }): ProbeSubmissionReceipt;
};

export class UptimeService {
  readonly store: UptimeStoreLike;
  private readonly checkRunner: (monitor: Monitor) => Promise<CheckAttemptResult>;
  private readonly leaseOwner = `svc_${randomUUID().replace(/-/g, "").slice(0, 18)}`;
  private readonly inFlightChecks = new Set<string>();

  constructor(options: UptimeServiceOptions = {}) {
    this.store = options.store ?? new UptimeStore({ mode: "local", ...options });
    this.checkRunner = options.checkRunner ?? runMonitorCheck;
  }

  close(): void {
    this.store.close();
  }

  createMonitor(input: CreateMonitorInput): Monitor {
    return this.store.createMonitor(input);
  }

  updateMonitor(idOrName: string, input: UpdateMonitorInput): Monitor {
    return this.store.updateMonitor(idOrName, input);
  }

  deleteMonitor(idOrName: string): boolean {
    return this.store.deleteMonitor(idOrName);
  }

  listMonitors(options: { includeDisabled?: boolean } = {}): Monitor[] {
    return this.store.listMonitors(options);
  }

  getMonitor(idOrName: string): Monitor | null {
    return this.store.getMonitor(idOrName);
  }

  listResults(options: ListResultsOptions = {}): CheckResult[] {
    return this.store.listResults(options);
  }

  listIncidents(options: { status?: "open" | "closed"; monitorId?: string; limit?: number } = {}): Incident[] {
    return this.store.listIncidents(options);
  }

  summary(): UptimeSummary {
    return this.store.summary();
  }

  createProbe(input: CreateProbeInput): CreateProbeResult {
    const store = this.probeStore();
    const publicKeyPem = input.publicKeyPem ? normalizeProbePublicKeyPem(input.publicKeyPem) : undefined;
    const keyPair = publicKeyPem
      ? {
        publicKeyPem,
        privateKeyPem: undefined,
        publicKeyFingerprint: probePublicKeyFingerprint(publicKeyPem),
      }
      : generateProbeKeyPair();
    const probe = store.createProbeIdentity({
      name: input.name,
      publicKeyPem: keyPair.publicKeyPem,
      publicKeyFingerprint: keyPair.publicKeyFingerprint,
      enabled: input.enabled,
    });
    return { ...probe, privateKeyPem: keyPair.privateKeyPem };
  }

  listProbes(options: { includeDisabled?: boolean } = {}): ProbeIdentity[] {
    return this.probeStore().listProbeIdentities(options);
  }

  getProbe(idOrName: string): ProbeIdentity | null {
    return this.probeStore().getProbeIdentity(idOrName);
  }

  updateProbe(idOrName: string, input: { enabled?: boolean; name?: string }): ProbeIdentity {
    return this.probeStore().updateProbeIdentity(idOrName, input);
  }

  createProbeCheckJob(input: { monitorId: string; scheduleSlot: string; dueAt?: string }): ProbeCheckJob {
    return this.probeStore().createProbeCheckJob(input);
  }

  getProbeCheckJob(id: string): ProbeCheckJob | null {
    return this.probeStore().getProbeCheckJob(id);
  }

  claimProbeCheckJob(input: { jobId: string; probeId: string; leaseTtlMs?: number }): ProbeCheckJob {
    return this.probeStore().claimProbeCheckJob(input);
  }

  submitProbeResult(input: ProbeResultSubmission): { result: CheckResult; receipt: ProbeSubmissionReceipt } {
    const execute = () => this.submitProbeResultInTransaction(input);
    return this.store.runInTransaction ? this.store.runInTransaction(execute) : execute();
  }

  previewImport(request: ImportRequest): ImportPreview {
    return previewImport(this.store, request);
  }

  applyImport(request: ImportRequest): ImportApplyResult {
    return applyImport(this.store, request);
  }

  rollbackImport(batchId: string): ImportRollbackResult {
    return rollbackImport(this.store, batchId);
  }

  backup(destinationPath?: string): UptimeBackup {
    return this.store.backup(destinationPath);
  }

  verifyBackup(backupPath: string): UptimeBackupCheck {
    return this.store.verifyBackup(backupPath);
  }

  buildReport(options: BuildUptimeReportOptions = {}): UptimeReport {
    return buildUptimeReport(this.summary(), options);
  }

  async sendReport(options: SendUptimeReportOptions = {}): Promise<UptimeReportDelivery[]> {
    if (this.store.mode === "hosted" && (options.email || options.sms || options.logs)) {
      throw new Error("hosted report delivery requires configured channel refs");
    }
    return sendUptimeReport(this.summary(), options);
  }

  async checkMonitor(idOrName: string): Promise<CheckResult> {
    if (this.store.mode === "hosted") throw new Error("hosted checks require check_jobs and probes");
    const monitor = this.store.getMonitor(idOrName);
    if (!monitor) throw new Error(`Monitor not found: ${idOrName}`);
    if (!monitor.enabled) throw new Error(`Monitor is disabled: ${monitor.name}`);
    if (this.inFlightChecks.has(monitor.id)) throw new Error(`Monitor check already in progress: ${monitor.name}`);
    const leaseTtlMs = Math.max(60_000, (monitor.retryCount + 1) * monitor.timeoutMs + 10_000);
    if (!this.store.acquireCheckLease(monitor.id, this.leaseOwner, leaseTtlMs)) {
      throw new MonitorCheckBusyError(`Monitor check already in progress: ${monitor.name}`);
    }
    this.inFlightChecks.add(monitor.id);
    try {
      let attemptCount = 0;
      let last: CheckAttemptResult | null = null;
      const maxAttempts = Math.max(1, monitor.retryCount + 1);
      while (attemptCount < maxAttempts) {
        attemptCount += 1;
        last = await this.checkRunner(monitor);
        if (last.status === "up") break;
      }
      return this.store.recordCheckResult({
        monitorId: monitor.id,
        status: last!.status,
        latencyMs: last!.latencyMs,
        statusCode: last!.statusCode ?? null,
        error: last!.error ?? null,
        evidence: last!.evidence ?? null,
        attemptCount,
        expectedMonitorRevision: monitor.revision,
      });
    } finally {
      this.inFlightChecks.delete(monitor.id);
      this.store.releaseCheckLease(monitor.id, this.leaseOwner);
    }
  }

  async checkAll(): Promise<CheckResult[]> {
    if (this.store.mode === "hosted") throw new Error("hosted checks require check_jobs and probes");
    const monitors = this.store.listMonitors();
    const results: CheckResult[] = [];
    for (const monitor of monitors) {
      results.push(await this.checkMonitor(monitor.id));
    }
    return results;
  }

  startScheduler(options: { tickMs?: number } = {}): SchedulerHandle {
    if (this.store.mode === "hosted") throw new Error("hosted scheduler requires check_jobs and probes");
    const tickMs = options.tickMs ?? 1000;
    const timer = setInterval(() => {
      void this.runDueChecks().catch((error) => {
        console.error(error instanceof Error ? error.message : String(error));
      });
    }, tickMs);
    return {
      stop: () => clearInterval(timer),
    };
  }

  async runDueChecks(now: Date = new Date()): Promise<CheckResult[]> {
    if (this.store.mode === "hosted") throw new Error("hosted checks require check_jobs and probes");
    const due = this.store.listMonitors().filter((monitor) => this.isDue(monitor, now));
    const results: CheckResult[] = [];
    for (const monitor of due) {
      const current = this.store.getMonitor(monitor.id);
      if (!current || !this.isDue(current, now)) continue;
      try {
        results.push(await this.checkMonitor(current.id));
      } catch (error) {
        if (error instanceof MonitorCheckBusyError || error instanceof StaleCheckResultError) continue;
        throw error;
      }
    }
    return results;
  }

  private isDue(monitor: Monitor, now: Date): boolean {
    if (!monitor.enabled) return false;
    if (this.inFlightChecks.has(monitor.id)) return false;
    if (!monitor.lastCheckedAt) return true;
    const last = new Date(monitor.lastCheckedAt).getTime();
    return now.getTime() - last >= monitor.intervalSeconds * 1000;
  }

  private probeStore(): ProbeStoreLike {
    if (this.store.mode === "hosted") {
      throw new Error("hosted probe APIs require cloud check_jobs, workspace stores, and audit logging");
    }
    const store = this.store as UptimeStoreLike;
    const required: Array<keyof ProbeStoreLike> = [
      "createProbeIdentity",
      "listProbeIdentities",
      "getProbeIdentity",
      "updateProbeIdentity",
      "touchProbeIdentity",
      "createProbeCheckJob",
      "getProbeCheckJob",
      "claimProbeCheckJob",
      "completeProbeCheckJob",
      "getProbeSubmission",
      "recordProbeSubmission",
    ];
    for (const method of required) {
      if (typeof store[method] !== "function") {
        throw new Error("probe support requires a probe-capable store");
      }
    }
    return store as ProbeStoreLike;
  }

  private submitProbeResultInTransaction(input: ProbeResultSubmission): { result: CheckResult; receipt: ProbeSubmissionReceipt } {
    const store = this.probeStore();
    const probe = store.getProbeIdentity(input.probeId);
    if (!probe) throw new Error(`Probe not found: ${input.probeId}`);
    if (!probe.enabled) throw new Error(`Probe is disabled: ${probe.name}`);
    const monitor = this.store.getMonitor(input.monitorId);
    if (!monitor) throw new Error(`Monitor not found: ${input.monitorId}`);
    if (!monitor.enabled) throw new Error(`Monitor is disabled: ${monitor.name}`);
    if (probe.id !== input.probeId) throw new Error("Probe result must use canonical probe id");
    if (monitor.id !== input.monitorId) throw new Error("Probe result must use canonical monitor id");
    validateProbeSubmission(input);
    const job = store.getProbeCheckJob(input.jobId);
    if (!job) throw new Error(`Probe job not found: ${input.jobId}`);
    if (job.monitorId !== monitor.id) throw new Error("Probe job does not match monitor");
    if (job.scheduleSlot !== input.scheduleSlot) throw new Error("Probe job scheduleSlot does not match submission");
    if (!verifyProbeResultSignature({ ...input, probeId: probe.id, monitorId: monitor.id }, probe.publicKeyPem)) {
      throw new Error("Probe result signature is invalid");
    }
    const existingReceipt = store.getProbeSubmission(probe.id, input.nonce);
    if (existingReceipt) {
      if (existingReceipt.jobId !== input.jobId || existingReceipt.monitorId !== monitor.id || existingReceipt.checkedAt !== input.checkedAt) {
        throw new Error("Probe nonce already submitted");
      }
      const existingResult = this.store.getCheckResult?.(existingReceipt.checkResultId);
      if (!existingResult) throw new Error("Probe nonce already submitted");
      return { result: existingResult, receipt: existingReceipt };
    }
    if (job.monitorRevision !== input.monitorRevision) throw new Error("Probe job monitorRevision does not match submission");
    if (job.monitorRevision !== monitor.revision) throw new StaleCheckResultError(`Monitor changed since probe job was created: ${monitor.name}`);
    if (job.status === "submitted") throw new Error("Probe job already submitted");
    if (job.status === "cancelled") throw new Error("Probe job is cancelled");
    if (job.status !== "claimed") throw new Error(`Probe job is not claimable for submission: ${job.status}`);
    if (job.claimedByProbeId !== probe.id) throw new Error("Probe job was claimed by another probe");
    if (job.fencingToken !== input.fencingToken) throw new Error("Probe job fencing token is invalid");
    if (!job.leaseExpiresAt || job.leaseExpiresAt <= new Date().toISOString()) throw new Error("Probe job lease expired");
    const result = this.store.recordCheckResult({
      monitorId: monitor.id,
      checkedAt: input.checkedAt,
      status: input.status,
      latencyMs: input.latencyMs,
      statusCode: input.statusCode ?? null,
      error: input.error ?? null,
      evidence: input.evidence ?? null,
      attemptCount: input.attemptCount ?? 1,
      expectedMonitorRevision: input.monitorRevision,
    });
    const receipt = store.recordProbeSubmission({
      probeId: probe.id,
      jobId: job.id,
      monitorId: monitor.id,
      checkResultId: result.id,
      nonce: input.nonce,
      checkedAt: input.checkedAt,
    });
    store.completeProbeCheckJob({
      jobId: job.id,
      probeId: probe.id,
      fencingToken: input.fencingToken,
      checkResultId: result.id,
      submittedAt: receipt.submittedAt,
    });
    store.touchProbeIdentity(probe.id, receipt.submittedAt);
    return { result, receipt };
  }
}

export function createUptimeClient(options: UptimeServiceOptions = {}): UptimeService {
  return new UptimeService({ mode: "local", ...options });
}

export class MonitorCheckBusyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MonitorCheckBusyError";
  }
}

function validateProbeSubmission(input: ProbeResultSubmission): void {
  if (!input.jobId.trim()) throw new Error("Probe submission jobId is required");
  if (!input.scheduleSlot.trim()) throw new Error("Probe submission scheduleSlot is required");
  if (!input.fencingToken.trim()) throw new Error("Probe submission fencingToken is required");
  if (!input.nonce.trim()) throw new Error("Probe submission nonce is required");
  if (input.nonce.length > 128) throw new Error("Probe submission nonce is too long");
  if (/[\x00-\x1f\x7f-\x9f]/.test(input.nonce)) throw new Error("Probe submission nonce must not contain control characters");
  if (input.status !== "up" && input.status !== "down") throw new Error("Probe result status must be up or down");
  if (input.latencyMs !== null && (!Number.isFinite(input.latencyMs) || input.latencyMs < 0)) {
    throw new Error("Probe result latencyMs must be null or a non-negative number");
  }
  if (input.statusCode !== undefined && input.statusCode !== null && (!Number.isInteger(input.statusCode) || input.statusCode < 100 || input.statusCode > 599)) {
    throw new Error("Probe result statusCode must be an HTTP status from 100 to 599");
  }
  if (input.attemptCount !== undefined && (!Number.isInteger(input.attemptCount) || input.attemptCount < 1 || input.attemptCount > 20)) {
    throw new Error("Probe result attemptCount must be an integer from 1 to 20");
  }
  const monitorRevision = input.monitorRevision;
  if (!Number.isInteger(monitorRevision) || monitorRevision < 1) {
    throw new Error("Probe result monitorRevision is required");
  }
  const checkedAtMs = Date.parse(input.checkedAt);
  if (!Number.isFinite(checkedAtMs)) throw new Error("Probe result checkedAt must be an ISO timestamp");
  const now = Date.now();
  if (checkedAtMs > now + MAX_PROBE_RESULT_FUTURE_MS) throw new Error("Probe result checkedAt is too far in the future");
  if (checkedAtMs < now - MAX_PROBE_RESULT_AGE_MS) throw new Error("Probe result checkedAt is too old");
  if (!input.signature.trim()) throw new Error("Probe result signature is required");
}

function normalizeProbePublicKeyPem(publicKeyPem: string): string {
  try {
    const key = createPublicKey(publicKeyPem);
    if (key.asymmetricKeyType !== "ed25519") {
      throw new Error("Probe public key must be an Ed25519 public key");
    }
    return key.export({ format: "pem", type: "spki" }).toString();
  } catch (error) {
    if (error instanceof Error && error.message.includes("Ed25519")) throw error;
    throw new Error("Probe public key must be a valid PEM Ed25519 public key");
  }
}
