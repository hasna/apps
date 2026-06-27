import { runMonitorCheck } from "./checks.js";
import { UptimeStore, type UptimeStoreOptions } from "./store.js";
import type {
  CheckAttemptResult,
  CheckResult,
  CreateMonitorInput,
  Incident,
  ListResultsOptions,
  Monitor,
  SchedulerHandle,
  UpdateMonitorInput,
  UptimeSummary,
} from "./types.js";

export interface UptimeServiceOptions extends UptimeStoreOptions {
  store?: UptimeStore;
  checkRunner?: (monitor: Monitor) => Promise<CheckAttemptResult>;
}

export class UptimeService {
  readonly store: UptimeStore;
  private readonly checkRunner: (monitor: Monitor) => Promise<CheckAttemptResult>;
  private readonly inFlightChecks = new Set<string>();

  constructor(options: UptimeServiceOptions = {}) {
    this.store = options.store ?? new UptimeStore(options);
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

  async checkMonitor(idOrName: string): Promise<CheckResult> {
    const monitor = this.store.getMonitor(idOrName);
    if (!monitor) throw new Error(`Monitor not found: ${idOrName}`);
    if (!monitor.enabled) throw new Error(`Monitor is disabled: ${monitor.name}`);
    if (this.inFlightChecks.has(monitor.id)) throw new Error(`Monitor check already in progress: ${monitor.name}`);
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
        attemptCount,
      });
    } finally {
      this.inFlightChecks.delete(monitor.id);
    }
  }

  async checkAll(): Promise<CheckResult[]> {
    const monitors = this.store.listMonitors();
    const results: CheckResult[] = [];
    for (const monitor of monitors) {
      results.push(await this.checkMonitor(monitor.id));
    }
    return results;
  }

  startScheduler(options: { tickMs?: number } = {}): SchedulerHandle {
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
    const due = this.store.listMonitors().filter((monitor) => this.isDue(monitor, now));
    const results: CheckResult[] = [];
    for (const monitor of due) {
      const current = this.store.getMonitor(monitor.id);
      if (!current || !this.isDue(current, now)) continue;
      results.push(await this.checkMonitor(current.id));
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
  return new UptimeService(options);
}
