/**
 * Daemon — composes the control, execution, and observation planes.
 *
 * Control: start/pause/resume/drain/stop/recover/replace (finite states).
 * Execution: scheduler admission -> bounded worker pool with leased,
 *   fenced, heartbeated runs -> terminal receipts; a bounded safety sweep
 *   is recovery only.
 * Observation: status() reports control and execution state independently.
 */

import type { Database } from "bun:sqlite";
import type { Clock } from "./clock.js";
import { Lifecycle, type DaemonLifecycleState, type LifecycleResult } from "./lifecycle.js";
import { Scheduler } from "./scheduler.js";
import { WorkerPool, type CheckExecutor } from "./worker.js";
import { Reconciler } from "./reconciler.js";
import { upsertDaemonState } from "./core.js";

export interface DaemonOptions {
  daemonId: string;
  workerCapacity: number;
  leaseTtlMs: number;
  heartbeatMs: number;
  sweepIntervalMs: number;
  stopBoundMs: number;
  executor: CheckExecutor;
}

export interface DaemonStatus {
  state: DaemonLifecycleState;
  leaderEpoch: number;
  workerCapacity: number;
  queueDepth: number;
  admittedCount: number;
  leasedCount: number;
  runningCount: number;
  retryWaitCount: number;
  expiredLeaseCount: number;
  terminalCount: number;
}

export class Daemon {
  private readonly lifecycle: Lifecycle;
  private readonly scheduler: Scheduler;
  private readonly pool: WorkerPool;
  private readonly reconciler: Reconciler;
  /** Cadence base per running slug: { epoch, base } — see Scheduler.admitDue. */
  private readonly cadenceBases = new Map<string, { epoch: number; base: number }>();
  private lastSweepAt = 0;

  constructor(
    private readonly db: Database,
    private readonly clock: Clock,
    private readonly opts: DaemonOptions
  ) {
    this.lifecycle = new Lifecycle(db, clock, opts.daemonId, opts.workerCapacity);
    this.scheduler = new Scheduler(db, clock);
    this.reconciler = new Reconciler(db, clock);
    this.pool = new WorkerPool(db, clock, {
      capacity: opts.workerCapacity,
      leaseTtlMs: opts.leaseTtlMs,
      executor: opts.executor,
      canClaim: () => this.claimsAllowed(),
    });
  }

  // ── Control plane ───────────────────────────────────────────────────────────

  async start(): Promise<LifecycleResult> {
    const result = this.lifecycle.start();
    if (result.ok) {
      // Fence any in-flight workers from a previous generation and seed the
      // cadence base for slugs that entered this running epoch.
      this.pool.clear();
      this.cadenceBases.clear();
      this.refreshCadenceBases();
      this.lastSweepAt = this.clock.now();
    }
    return result;
  }

  pause(): LifecycleResult {
    return this.lifecycle.pause();
  }

  resume(): LifecycleResult {
    return this.lifecycle.resume();
  }

  drain(): LifecycleResult {
    return this.lifecycle.drain();
  }

  stop(): LifecycleResult {
    return this.lifecycle.stop();
  }

  /** Recovery: run one full sweep, then restore the prior state. */
  recover(): LifecycleResult {
    const before = this.lifecycle.current()?.state ?? "STOPPED";
    const entered = this.lifecycle.beginRecovery();
    if (!entered.ok) return entered;
    this.reconciler.safetySweep(this.clock.now());
    if (before !== "RECOVERING") {
      this.lifecycle.restoreAfterRecovery();
      if (
        before === "RUNNING" ||
        before === "PAUSED" ||
        before === "STOPPING" ||
        before === "STOPPED" ||
        before === "DRAINING"
      ) {
        // Restore the exact prior state (a cleanly stopped daemon comes back
        // STOPPED — leaving it RECOVERING would wedge restart).
        const st = this.lifecycle.current();
        if (st) {
          upsertDaemonState(this.db, this.clock, {
            daemonId: this.opts.daemonId,
            state: before,
            leaderEpoch: st.leader_epoch,
            workerCapacity: this.opts.workerCapacity,
            drainStartedAt: st.drain_started_at,
          });
        }
      }
    }
    return { ok: true };
  }

  /** Replacement: fence every active lease and open a new worker generation. */
  replace(): LifecycleResult {
    const result = this.lifecycle.replace();
    if (result.ok) {
      this.pool.clear();
    }
    return result;
  }

  // ── Execution plane ─────────────────────────────────────────────────────────

  /** One daemon cycle: admission, heartbeat, sweep, backfill, state checks. */
  async tick(): Promise<void> {
    const state = this.lifecycle.current();
    if (!state) return;
    const now = this.clock.now();

    // Heartbeat the daemon's own observation record.
    upsertDaemonState(this.db, this.clock, {
      daemonId: this.opts.daemonId,
      state: state.state as DaemonLifecycleState,
      leaderEpoch: state.leader_epoch,
      workerCapacity: this.opts.workerCapacity,
      heartbeatAt: now,
    });

    if (state.state === "RUNNING" || state.state === "PAUSED") {
      // Seed the cadence base before admission so a fresh slug's first
      // occurrence is measured from when it entered the running epoch.
      this.refreshCadenceBases();
      this.scheduler.admitDue(now, {
        cadenceBases: this.cadenceBaseMap(),
        skipOverlap: state.state === "RUNNING",
      });
    }

    // Bounded safety sweep — recovery only, on an interval, never a backfill.
    if (state.state !== "STOPPED" && now - this.lastSweepAt >= this.opts.sweepIntervalMs) {
      this.reconciler.safetySweep(now);
      this.lastSweepAt = now;
    }

    await this.pool.tick();

    if (state.state === "RUNNING" || state.state === "STOPPING") {
      await this.pool.backfill();
    }

    if (state.state === "DRAINING" && !this.hasActiveWork()) {
      this.lifecycle.completeStop();
      return;
    }
    if (state.state === "STOPPING") {
      const started = state.drain_started_at ?? now;
      const boundReached = started + this.opts.stopBoundMs <= now;
      if (boundReached || !this.hasNonTerminalWork()) {
        this.lifecycle.completeStop();
      }
    }
  }

  private claimsAllowed(): boolean {
    const state = this.lifecycle.current();
    return !!state && (state.state === "RUNNING" || state.state === "STOPPING");
  }

  private hasActiveWork(): boolean {
    const row = this.db
      .query<{ n: number }, []>(
        "SELECT COUNT(*) AS n FROM slug_runs WHERE state IN ('leased','running')"
      )
      .get()!;
    return row.n > 0 || this.pool.activeCount > 0;
  }

  private hasNonTerminalWork(): boolean {
    const row = this.db
      .query<{ n: number }, []>(
        "SELECT COUNT(*) AS n FROM slug_runs WHERE state <> 'terminal'"
      )
      .get()!;
    return row.n > 0;
  }

  private cadenceBaseMap(): ReadonlyMap<string, number> {
    const map = new Map<string, number>();
    for (const [slugId, entry] of this.cadenceBases) {
      map.set(slugId, entry.base);
    }
    return map;
  }

  /** Seed/refresh cadence bases for running slugs with no runs yet. */
  private refreshCadenceBases(): void {
    const now = this.clock.now();
    const slugs = this.db
      .query<{ id: string; execution_epoch: number }, [string]>(
        "SELECT id, execution_epoch FROM slugs WHERE desired_state = 'running'"
      )
      .all("running");
    for (const slug of slugs) {
      const hasRuns = this.db
        .query<{ n: number }, [string]>(
          "SELECT COUNT(*) AS n FROM slug_runs WHERE slug_id = ?"
        )
        .get(slug.id)!.n;
      if (hasRuns > 0) {
        this.cadenceBases.delete(slug.id);
        continue;
      }
      const existing = this.cadenceBases.get(slug.id);
      if (!existing || existing.epoch !== slug.execution_epoch) {
        this.cadenceBases.set(slug.id, { epoch: slug.execution_epoch, base: now });
      }
    }
  }

  // ── Observation plane ───────────────────────────────────────────────────────

  status(): DaemonStatus {
    const state = this.lifecycle.current();
    const count = (where: string): number =>
      this.db
        .query<{ n: number }, []>(`SELECT COUNT(*) AS n FROM slug_runs WHERE ${where}`)
        .get()!.n;
    const leaseCounts = this.db
      .query<{ n: number }, [number]>(
        "SELECT COUNT(*) AS n FROM leases WHERE revoked_at IS NULL AND expires_at > ?"
      )
      .get(this.clock.now())!.n;
    const expiredLeases = this.db
      .query<{ n: number }, [number]>(
        "SELECT COUNT(*) AS n FROM leases WHERE revoked_at IS NULL AND expires_at <= ?"
      )
      .get(this.clock.now())!.n;

    const admittedCount = count("state = 'admitted'");
    const retryWaitCount = count("state = 'retry_wait'");
    return {
      state: (state?.state as DaemonLifecycleState) ?? "STOPPED",
      leaderEpoch: state?.leader_epoch ?? 0,
      workerCapacity: this.opts.workerCapacity,
      queueDepth: admittedCount + retryWaitCount,
      admittedCount,
      leasedCount: leaseCounts,
      runningCount: count("state IN ('leased','running')"),
      retryWaitCount,
      expiredLeaseCount: expiredLeases,
      terminalCount: count("state = 'terminal'"),
    };
  }
}
