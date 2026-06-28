import { runMonitorCheck } from "./checks.js";
import { randomUUID } from "node:crypto";
import { applyImport, previewImport, rollbackImport, type ImportApplyResult, type ImportPreview, type ImportRequest, type ImportRollbackResult } from "./imports.js";
import { StaleCheckResultError, UptimeStore, type MonitorProvenance, type SaveImportBatchInput, type StoredImportBatch, type UpsertMonitorProvenanceInput, type UptimeBackup, type UptimeBackupCheck, type UptimeStoreOptions } from "./store.js";
import { buildUptimeReport, sendUptimeReport, type BuildUptimeReportOptions, type SendUptimeReportOptions, type UptimeReport, type UptimeReportDelivery } from "./report.js";
import type {
  CheckAttemptResult,
  CheckResult,
  CreateMonitorInput,
  Incident,
  ImportedMonitorInput,
  ImportedUpdateMonitorInput,
  ListResultsOptions,
  Monitor,
  SchedulerHandle,
  UpdateMonitorInput,
  UptimeSummary,
} from "./types.js";

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
  runInTransaction?<T>(fn: () => T): T;
}

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
