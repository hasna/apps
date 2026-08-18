/**
 * Bounded worker pool — the execution plane of the daemon.
 *
 * Workers claim due runs atomically, hold an exclusive renewable lease with a
 * fencing token, heartbeat while executing, and complete through a fenced
 * write that produces a terminal receipt. Capacity that becomes available is
 * backfilled event-driven after terminal receipts — never by the safety
 * sweep, which is recovery only.
 */

import { createHash } from "node:crypto";
import type { Database } from "bun:sqlite";
import type { Clock } from "./clock.js";
import {
  claimNext,
  completeAttempt,
  renewLease,
  type Claim,
  type ReceiptRow,
  type RunRow,
} from "./core.js";

export interface ExecResult {
  exitCode: number;
  stdout?: string;
  stderr?: string;
}

export interface ExecContext {
  runId: string;
  slugId: string;
  attemptNumber: number;
}

export interface CheckExecutor {
  execute(ctx: ExecContext): ExecResult | Promise<ExecResult>;
}

export interface WorkerPoolOptions {
  capacity: number;
  leaseTtlMs: number;
  executor: CheckExecutor;
  /** Set false while the daemon is paused or draining (no new claims). */
  canClaim?: () => boolean;
  onReceipt?: (receipt: ReceiptRow, run: RunRow) => void;
}

interface ActiveWorker {
  workerId: string;
  claim: Claim;
  promise: Promise<void>;
  settled: boolean;
}

function resultDigest(result: ExecResult): string {
  const payload = `${result.exitCode}|${result.stdout ?? ""}|${result.stderr ?? ""}`;
  return createHash("sha256").update(payload).digest("hex");
}

export class WorkerPool {
  private readonly workers = new Map<string, ActiveWorker>();
  private capacity: number;
  private readonly leaseTtlMs: number;
  private readonly executor: CheckExecutor;
  private readonly canClaim: () => boolean;
  private readonly onReceipt?: (receipt: ReceiptRow, run: RunRow) => void;

  constructor(
    private readonly db: Database,
    private readonly clock: Clock,
    opts: WorkerPoolOptions
  ) {
    this.capacity = opts.capacity;
    this.leaseTtlMs = opts.leaseTtlMs;
    this.executor = opts.executor;
    this.canClaim = opts.canClaim ?? (() => true);
    this.onReceipt = opts.onReceipt;
  }

  get activeCount(): number {
    return this.workers.size;
  }

  get activeWorkers(): ActiveWorker[] {
    return Array.from(this.workers.values());
  }

  setCapacity(n: number): void {
    this.capacity = Math.max(0, Math.floor(n));
  }

  /** Number of slots that could accept another claim right now. */
  availableSlots(): number {
    return Math.max(0, this.capacity - this.workers.size);
  }

  /**
   * Claim up to capacity of the due work and start execution. Synchronous
   * executors resolve in microtasks; `await tick()` flushes them.
   */
  async backfill(): Promise<void> {
    while (this.availableSlots() > 0 && this.canClaim()) {
      const claim = claimNext(this.db, this.clock, {
        workerId: this.nextWorkerId(),
        leaseTtlMs: this.leaseTtlMs,
        capacity: this.capacity,
        now: this.clock.now(),
      });
      if (!claim) break;
      this.start(claim);
    }
    await this.flush();
  }

  /**
   * Heartbeat renewal plus completion processing. Awaiting this flushes all
   * currently-resolved worker completions and their follow-up backfills.
   * A worker that can no longer renew its lease (expired or revoked) is
   * evicted so its capacity slot frees for the reconciler's requeue.
   */
  async tick(): Promise<void> {
    for (const worker of Array.from(this.workers.values())) {
      const renewed = renewLease(this.db, this.clock, {
        leaseId: worker.claim.lease.id,
        workerId: worker.claim.lease.worker_id,
        token: worker.claim.token,
        ttlMs: this.leaseTtlMs,
      });
      if (!renewed.ok) {
        // Fenced out: the reconciler owns this run now. Free the slot.
        worker.settled = true;
        this.workers.delete(worker.workerId);
      }
    }
    await this.flush();
  }

  /** Drop every tracked worker (replacement, start-from-stopped). In-flight
   *  promises still resolve later; their fenced writes are rejected. */
  clear(): void {
    for (const worker of this.workers.values()) {
      worker.settled = true;
    }
    this.workers.clear();
  }

  private async flush(): Promise<void> {
    // Two microtask turns: execution resolution, then completion handling.
    await Promise.resolve();
    await Promise.resolve();
    // No-op: completions are handled by the per-worker promise chain, which
    // runs synchronously once the executor promise resolves.
  }

  private nextWorkerId(): string {
    let n = 0;
    let id = `worker-${this.clock.now()}-${n}`;
    while (this.workers.has(id)) {
      n += 1;
      id = `worker-${this.clock.now()}-${n}`;
    }
    return id;
  }

  private start(claim: Claim): void {
    const workerId = claim.lease.worker_id;
    const context: ExecContext = {
      runId: claim.run.id,
      slugId: claim.run.slug_id,
      attemptNumber: claim.attempt.attempt_number,
    };
    const worker: ActiveWorker = {
      workerId,
      claim,
      settled: false,
      promise: Promise.resolve(),
    };
    this.workers.set(workerId, worker);
    // The worker slot is freed BEFORE completion handling, so the
    // event-driven backfill after a terminal receipt can claim the freed
    // capacity in the same turn.
    worker.promise = Promise.resolve()
      .then(() => this.executor.execute(context))
      .then((result) => {
        worker.settled = true;
        this.workers.delete(workerId);
        this.finish(worker, result);
      })
      .catch((err) => {
        worker.settled = true;
        this.workers.delete(workerId);
        this.finish(worker, {
          exitCode: 1,
          stderr: err instanceof Error ? err.message : String(err),
        });
      });
  }

  private finish(worker: ActiveWorker, result: ExecResult): void {
    const claim = worker.claim;
    const completed = completeAttempt(this.db, this.clock, {
      runId: claim.run.id,
      attemptId: claim.attempt.id,
      leaseId: claim.lease.id,
      generation: claim.lease.generation,
      workerId: claim.lease.worker_id,
      token: worker.claim.token,
      outcome: result.exitCode === 0 ? "succeeded" : "failed",
      exitCode: result.exitCode,
      resultDigest: resultDigest(result),
    });

    if (!completed.ok) {
      // Fenced out (expired/revoked lease or stale generation): the
      // reconciler owns the run now. Nothing is overwritten.
      return;
    }
    if (completed.receipt) {
      this.onReceipt?.(completed.receipt, completed.run);
      // Event-driven backfill: capacity freed by a terminal receipt.
      void this.backfill();
    }
  }
}
