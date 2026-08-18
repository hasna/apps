/**
 * receipts.ts — MON-V2-03.
 *
 * Terminal receipts for the monitor v2 daemon.
 *
 * Every admitted run reaches exactly one terminal outcome and produces
 * exactly one terminal receipt linked to the run, attempt, lease and lease
 * generation. The terminal transition is a single BEGIN IMMEDIATE
 * transaction: a worker-side write is fence-checked first (stale workers
 * cannot write a receipt), the receipt row is inserted, and the run is
 * marked terminal in the same transaction. A second terminal transition for
 * the same run is refused with `already_terminal` and never creates a second
 * receipt (`UNIQUE(run_id)` backs it).
 *
 * `applyTerminalTransition` is the transaction body; it is exported so the
 * control plane can run a system-side transition (e.g. cancel-before-claim)
 * inside its own transaction without nesting.
 */

import { randomUUID } from "node:crypto";
import type { DbAdapter } from "../db/adapter.js";
import {
  checkLeaseFence,
  withImmediateTransaction,
} from "./lease-registry.js";

export type TerminalState =
  | "succeeded"
  | "failed"
  | "timed_out"
  | "cancelled"
  | "cancelled_before_claim"
  | "skipped_overlap"
  | "retry_exhausted"
  | "unknown_reconciled";

export type AttemptTerminalState =
  | "succeeded"
  | "failed"
  | "unknown"
  | "cancelled"
  | "expired";

export interface ReceiptRow {
  id: string;
  run_id: string;
  attempt_id: string | null;
  lease_id: string | null;
  lease_generation: number;
  state: string;
  reason: string | null;
  durable_effect_pointer: string | null;
  evidence_pointer: string | null;
  result_digest: string | null;
  created_at: number;
}

export interface TerminalTransitionInput {
  runId: string;
  /** Null for system-side transitions that never claimed (cancel-before-claim). */
  attemptId: string | null;
  leaseId: string | null;
  generation: number;
  /** Required when leaseId is set; null for system-side transitions. */
  fencingToken: string | null;
  state: TerminalState;
  /**
   * Optional run outcome override. The run's `outcome` column records the
   * high-level outcome while the receipt keeps the precise terminal state —
   * e.g. cancel-before-claim: run outcome `cancelled`, receipt state
   * `cancelled_before_claim`.
   */
  outcome?: string;
  reason?: string;
  durableEffectPointer?: string;
  evidencePointer?: string;
  resultDigest?: string;
  exitCode?: number;
  now: number;
}

export type TerminalTransitionResult =
  | { ok: true; receiptId: string; created: true }
  | { ok: false; code: "stale_fence"; reason: string }
  | { ok: false; code: "already_terminal"; receiptId?: string };

/** Maps a terminal run state to the attempt's terminal state. */
export function attemptStateFor(state: TerminalState): AttemptTerminalState | null {
  switch (state) {
    case "succeeded":
      return "succeeded";
    case "failed":
      return "failed";
    case "timed_out":
      return "expired";
    case "cancelled":
      return "cancelled";
    case "retry_exhausted":
      return "failed";
    case "unknown_reconciled":
      return "unknown";
    case "cancelled_before_claim":
    case "skipped_overlap":
      return null; // no attempt was ever claimed
  }
}

/**
 * Worker-side terminal transition: fence-checked, then applied atomically.
 * System-side transitions (leaseId null) skip the fence — they are
 * control-plane authority.
 */
export function transitionToTerminal(
  db: DbAdapter,
  input: TerminalTransitionInput,
): TerminalTransitionResult {
  return withImmediateTransaction(db, () => {
    if (input.leaseId !== null) {
      if (input.fencingToken === null || input.attemptId === null) {
        return { ok: false, code: "stale_fence", reason: "missing_lease_binding" } as const;
      }
      const fence = checkLeaseFence(db, {
        runId: input.runId,
        attemptId: input.attemptId,
        leaseId: input.leaseId,
        generation: input.generation,
        fencingToken: input.fencingToken,
        now: input.now,
      });
      if (!fence.ok) {
        return { ok: false, code: "stale_fence", reason: fence.reason } as const;
      }
    }
    return applyTerminalTransition(db, input);
  });
}

/**
 * Transaction body for a terminal transition. Must run inside a BEGIN
 * IMMEDIATE transaction (callers: transitionToTerminal, cancelQueuedRun).
 * Inserting the receipt and marking the run terminal are one atomic step.
 */
export function applyTerminalTransition(
  db: DbAdapter,
  input: TerminalTransitionInput,
):
  | { ok: true; receiptId: string; created: true }
  | { ok: false; code: "already_terminal"; receiptId?: string } {
  const run = db.get<{ terminal_receipt_id: string | null }>(
    "SELECT terminal_receipt_id FROM slug_runs WHERE id = ?",
    [input.runId],
  );
  if (!run) {
    throw new Error(`terminal transition for unknown run: ${input.runId}`);
  }
  if (run.terminal_receipt_id !== null) {
    return { ok: false, code: "already_terminal", receiptId: run.terminal_receipt_id };
  }

  const receiptId = randomUUID();
  db.run(
    `INSERT INTO receipts
       (id, run_id, attempt_id, lease_id, lease_generation, state, reason,
        durable_effect_pointer, evidence_pointer, result_digest, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      receiptId,
      input.runId,
      input.attemptId,
      input.leaseId,
      input.generation,
      input.state,
      input.reason ?? null,
      input.durableEffectPointer ?? null,
      input.evidencePointer ?? null,
      input.resultDigest ?? null,
      input.now,
    ],
  );

  db.run(
    `UPDATE slug_runs SET state = 'terminal', outcome = ?, finished_at = ?, terminal_receipt_id = ?
     WHERE id = ? AND terminal_receipt_id IS NULL`,
    [input.outcome ?? input.state, input.now, receiptId, input.runId],
  );

  if (input.attemptId !== null) {
    const attemptState = attemptStateFor(input.state);
    if (attemptState !== null) {
      db.run(
        `UPDATE slug_attempts SET state = ?, finished_at = ?, exit_code = ?, outcome = ?, result_digest = ?
         WHERE id = ?`,
        [
          attemptState,
          input.now,
          input.exitCode ?? null,
          input.state,
          input.resultDigest ?? null,
          input.attemptId,
        ],
      );
    }
  }

  return { ok: true, receiptId, created: true };
}

/** Read the single terminal receipt for a run (null when none exists yet). */
export function getReceiptForRun(db: DbAdapter, runId: string): ReceiptRow | null {
  return db.get<ReceiptRow>("SELECT * FROM receipts WHERE run_id = ?", [runId]);
}
