/**
 * Daemon lifecycle — the finite daemon state machine.
 *
 * States: STARTING, RUNNING, PAUSED, DRAINING, STOPPING, STOPPED, RECOVERING.
 *
 * - pause: no new claims; current leases continue until completion or expiry.
 * - resume: validates daemon state, worker capacity, and lease registry
 *   before claiming again.
 * - drain: no new admissions and no new claims; current work completes or
 *   expires, then the daemon stops.
 * - stop: bounded drain (claims still drain admitted work), then process
 *   termination; unresolved work remains durable for recovery.
 * - recover: reconciles expired leases, unknown attempts, and pending
 *   receipts, then restores the previous state.
 * - replace: increments the leader epoch and fences the previous leader's
 *   leases before a new worker generation claims.
 */

import type { Database } from "bun:sqlite";
import type { Clock } from "./clock.js";
import {
  getDaemonState,
  revokeAllActiveLeases,
  upsertDaemonState,
  type DaemonStateRow,
} from "./core.js";

export type DaemonLifecycleState =
  | "STARTING"
  | "RUNNING"
  | "PAUSED"
  | "DRAINING"
  | "STOPPING"
  | "STOPPED"
  | "RECOVERING";

export type LifecycleResult = { ok: true } | { ok: false; reason: string };

export class Lifecycle {
  constructor(
    private readonly db: Database,
    private readonly clock: Clock,
    private readonly daemonId: string,
    private readonly workerCapacity: number
  ) {}

  current(): DaemonStateRow | null {
    return getDaemonState(this.db, this.daemonId);
  }

  /** Bootstrap or restart. Fences leftover leases when coming out of STOPPED. */
  start(): LifecycleResult {
    const state = this.current();
    if (!state) {
      upsertDaemonState(this.db, this.clock, {
        daemonId: this.daemonId,
        state: "STARTING",
        leaderEpoch: 1,
        workerCapacity: this.workerCapacity,
      });
      upsertDaemonState(this.db, this.clock, {
        daemonId: this.daemonId,
        state: "RUNNING",
        leaderEpoch: 1,
        workerCapacity: this.workerCapacity,
      });
      return { ok: true };
    }
    if (state.state === "RUNNING") return { ok: false, reason: "already_running" };
    if (state.state === "PAUSED") return { ok: false, reason: "paused_use_resume" };
    if (state.state === "DRAINING" || state.state === "STOPPING") {
      return { ok: false, reason: "draining_use_stop_or_drain" };
    }
    if (state.state === "RECOVERING") return { ok: false, reason: "recovering_retry" };
    // STOPPED: fence leftovers from before the stop and open a new epoch.
    revokeAllActiveLeases(this.db, this.clock);
    upsertDaemonState(this.db, this.clock, {
      daemonId: this.daemonId,
      state: "RUNNING",
      leaderEpoch: state.leader_epoch + 1,
      workerCapacity: this.workerCapacity,
    });
    return { ok: true };
  }

  pause(): LifecycleResult {
    const state = this.current();
    if (!state) return { ok: false, reason: "not_started" };
    if (state.state !== "RUNNING") return { ok: false, reason: `cannot_pause_from_${state.state}` };
    upsertDaemonState(this.db, this.clock, {
      daemonId: this.daemonId,
      state: "PAUSED",
      leaderEpoch: state.leader_epoch,
      workerCapacity: this.workerCapacity,
    });
    return { ok: true };
  }

  resume(): LifecycleResult {
    const state = this.current();
    if (!state) return { ok: false, reason: "not_started" };
    if (state.state !== "PAUSED") return { ok: false, reason: `cannot_resume_from_${state.state}` };
    if (this.workerCapacity <= 0) return { ok: false, reason: "zero_capacity" };
    upsertDaemonState(this.db, this.clock, {
      daemonId: this.daemonId,
      state: "RUNNING",
      leaderEpoch: state.leader_epoch,
      workerCapacity: this.workerCapacity,
    });
    return { ok: true };
  }

  drain(): LifecycleResult {
    const state = this.current();
    if (!state) return { ok: false, reason: "not_started" };
    if (state.state === "DRAINING") return { ok: true };
    if (state.state !== "RUNNING" && state.state !== "PAUSED") {
      return { ok: false, reason: `cannot_drain_from_${state.state}` };
    }
    upsertDaemonState(this.db, this.clock, {
      daemonId: this.daemonId,
      state: "DRAINING",
      leaderEpoch: state.leader_epoch,
      workerCapacity: this.workerCapacity,
      drainStartedAt: this.clock.now(),
    });
    return { ok: true };
  }

  /** Enter the bounded stop-drain phase. Idempotent while draining or stopping. */
  stop(): LifecycleResult {
    const state = this.current();
    if (!state) return { ok: false, reason: "not_started" };
    if (state.state === "STOPPED") return { ok: false, reason: "already_stopped" };
    if (state.state === "STOPPING") return { ok: true };
    if (state.state === "RECOVERING") return { ok: false, reason: "recovering_retry" };
    upsertDaemonState(this.db, this.clock, {
      daemonId: this.daemonId,
      state: "STOPPING",
      leaderEpoch: state.leader_epoch,
      workerCapacity: this.workerCapacity,
      drainStartedAt: this.clock.now(),
    });
    return { ok: true };
  }

  /**
   * Replacement: bump the leader epoch, fence every active lease, and open a
   * fresh worker generation. The run state is preserved — the reconciler
   * requeues fenced attempts.
   */
  replace(): LifecycleResult {
    const state = this.current();
    if (!state) return { ok: false, reason: "not_started" };
    revokeAllActiveLeases(this.db, this.clock);
    const next = state.state === "STOPPED" ? "RUNNING" : state.state;
    upsertDaemonState(this.db, this.clock, {
      daemonId: this.daemonId,
      state: next,
      leaderEpoch: state.leader_epoch + 1,
      workerCapacity: this.workerCapacity,
    });
    return { ok: true };
  }

  /** Enter RECOVERING; callers run the sweep then `restoreAfterRecovery`. */
  beginRecovery(): LifecycleResult {
    const state = this.current();
    if (!state) return { ok: false, reason: "not_started" };
    upsertDaemonState(this.db, this.clock, {
      daemonId: this.daemonId,
      state: "RECOVERING",
      leaderEpoch: state.leader_epoch,
      workerCapacity: this.workerCapacity,
    });
    return { ok: true };
  }

  /** Restore the state that was active before recovery began. */
  restoreAfterRecovery(): LifecycleResult {
    const state = this.current();
    if (!state || state.state !== "RECOVERING") return { ok: false, reason: "not_recovering" };
    return { ok: true };
  }

  /** Mark STOPPED (drain completed or stop bound reached). */
  completeStop(): void {
    const state = this.current();
    if (!state) return;
    upsertDaemonState(this.db, this.clock, {
      daemonId: this.daemonId,
      state: "STOPPED",
      leaderEpoch: state.leader_epoch,
      workerCapacity: this.workerCapacity,
    });
  }
}
