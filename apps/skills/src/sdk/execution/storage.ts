/**
 * Execution storage adapter: where runs, attempts, transitions, and receipts
 * live. The interface is the contract; the memory backend ships here and the
 * durable SQLite twin is server code (`src/server/sqlite-run-execution-store.ts`)
 * so the published `./sdk` surface opens no SQLite. Every state change a dispatcher or state machine
 * makes is recorded here — nothing is held only in a process.
 */

import { createHash, randomBytes } from "node:crypto";
import type {
  AttemptReceipt,
  AttemptRecord,
  ClaimResult,
  ExecutionRunRow,
  ExecutionRunStatus,
  FrozenAdmission,
  RunTransitionRecord,
  TerminalRunStatus,
} from "./types.js";
import { isTerminalStatus } from "./types.js";

export type { AttemptReceipt, AttemptRecord, ClaimResult, ExecutionRunRow, ExecutionRunStatus, FrozenAdmission, RunTransitionRecord };

export interface CreateAttemptInput {
  runId: string;
  attemptNumber: number;
}

export interface ClaimAttemptInput {
  runId: string;
  attemptId: string;
  workerId: string;
  /** The generation the claimant believes is current. */
  expectedLeaseGeneration: number;
}

/** Result of persisting an attempt launch intent. */
export type LaunchIntentResult =
  | { ok: true; attempt: AttemptRecord }
  | { ok: false; reason: "NO_SUCH_ATTEMPT" | "ATTEMPT_TERMINAL" | "RUN_TERMINAL" | "RUN_CANCELLED" };

export interface RunExecutionStore {
  readonly durable: boolean;
  admit(admission: FrozenAdmission): Promise<ExecutionRunRow>;
  getRun(runId: string): Promise<ExecutionRunRow | null>;
  getRunByKey(tenantId: string, idempotencyKey: string): Promise<ExecutionRunRow | null>;
  getRunByDigests(input: {
    tenantId: string;
    skillId: string;
    skillVersion: string;
    bundleDigest: string;
    inputDigest: string;
  }): Promise<ExecutionRunRow | null>;
  listAttempts(runId: string): Promise<AttemptRecord[]>;
  createAttempt(input: CreateAttemptInput): Promise<AttemptRecord>;
  claimAttempt(input: ClaimAttemptInput): Promise<ClaimResult>;
  recordLaunchIntent(input: {
    runId: string;
    attemptId: string;
    clientToken: string;
    requestDigest: string;
    startedBy: string;
  }): Promise<LaunchIntentResult>;
  recordLaunchState(input: {
    runId: string;
    attemptId: string;
    launchState: AttemptRecord["launchState"];
    taskId?: string | null;
  }): Promise<AttemptRecord | null>;
  recordTransition(transition: RunTransitionRecord): Promise<void>;
  markAttemptTerminal(runId: string, attemptId: string): Promise<AttemptRecord | null>;
  writeReceipt(receipt: AttemptReceipt): Promise<AttemptReceipt>;
  getReceipt(runId: string, attemptId: string): Promise<AttemptReceipt | null>;
  finalizeRun(runId: string, status: TerminalRunStatus, receiptId: string): Promise<ExecutionRunRow | null>;
  setRunStatus(runId: string, status: ExecutionRunStatus): Promise<ExecutionRunRow | null>;
  close?(): Promise<void>;
}

function newRunId(): string {
  return `run_${Date.now().toString(36)}_${randomBytes(5).toString("hex")}`;
}

export { newRunId };

/**
 * In-memory implementation. Single-process only: the read-then-write claim
 * path is atomic only because the event loop cannot interleave two synchronous
 * turns. The SQLite backend is the durable twin; this one exists for tests and
 * for embedders that deliberately keep the queue in-process.
 */
export class MemoryRunExecutionStore implements RunExecutionStore {
  readonly durable = false;
  private runs = new Map<string, ExecutionRunRow>();
  private byKey = new Map<string, string>();
  private byDigests = new Map<string, string>();
  private attempts = new Map<string, AttemptRecord>();
  private transitions: RunTransitionRecord[] = [];
  private receipts = new Map<string, AttemptReceipt>();

  async admit(admission: FrozenAdmission): Promise<ExecutionRunRow> {
    const existing = this.runs.get(admission.runId);
    if (existing) return existing;
    const row: ExecutionRunRow = {
      admission,
      status: "admitted",
      currentAttemptId: null,
      terminalReceiptId: null,
      updatedAt: admission.createdAt,
    };
    this.runs.set(admission.runId, row);
    this.byKey.set(admission.tenantId + "\u0000" + admission.idempotencyKey, admission.runId);
    this.byDigests.set(
      digestKey({
        tenantId: admission.tenantId,
        skillId: admission.skillId,
        skillVersion: admission.skillVersion,
        bundleDigest: admission.bundleDigest,
        inputDigest: admission.inputDigest,
      }),
      admission.runId,
    );
    return row;
  }

  async getRun(runId: string): Promise<ExecutionRunRow | null> {
    return this.runs.get(runId) ?? null;
  }

  async getRunByKey(tenantId: string, idempotencyKey: string): Promise<ExecutionRunRow | null> {
    const runId = this.byKey.get(tenantId + "\u0000" + idempotencyKey);
    return runId ? (this.runs.get(runId) ?? null) : null;
  }

  async getRunByDigests(input: {
    tenantId: string;
    skillId: string;
    skillVersion: string;
    bundleDigest: string;
    inputDigest: string;
  }): Promise<ExecutionRunRow | null> {
    const runId = this.byDigests.get(digestKey(input));
    return runId ? (this.runs.get(runId) ?? null) : null;
  }

  async listAttempts(runId: string): Promise<AttemptRecord[]> {
    return Array.from(this.attempts.values())
      .filter((attempt) => attempt.runId === runId)
      .sort((a, b) => a.attemptNumber - b.attemptNumber);
  }

  async createAttempt(input: CreateAttemptInput): Promise<AttemptRecord> {
    const attemptId = `${input.runId}/attempt/${input.attemptNumber}`;
    const attempt: AttemptRecord = {
      runId: input.runId,
      attemptId,
      attemptNumber: input.attemptNumber,
      leaseGeneration: 0,
      workerId: null,
      claimedAt: null,
      status: "pending",
      clientToken: null,
      requestDigest: null,
      taskId: null,
      launchState: "unlaunched",
      startedBy: null,
    };
    this.attempts.set(attemptId, attempt);
    return attempt;
  }

  async claimAttempt(input: ClaimAttemptInput): Promise<ClaimResult> {
    const run = this.runs.get(input.runId);
    if (!run || isMemoryTerminal(run.status)) {
      return { ok: false, reason: run?.status === "cancelled" ? "RUN_CANCELLED" : "RUN_TERMINAL" };
    }
    const attempt = this.attempts.get(input.attemptId);
    if (!attempt) return { ok: false, reason: "NO_SUCH_ATTEMPT" };
    if (attempt.status === "terminal") return { ok: false, reason: "ATTEMPT_TERMINAL" };
    if (attempt.leaseGeneration !== input.expectedLeaseGeneration) {
      return { ok: false, reason: "STALE_GENERATION" };
    }
    const next: AttemptRecord = {
      ...attempt,
      leaseGeneration: attempt.leaseGeneration + 1,
      workerId: input.workerId,
      claimedAt: new Date().toISOString(),
      status: "leased",
    };
    this.attempts.set(attempt.attemptId, next);
    return { ok: true, attempt: next, leaseGeneration: next.leaseGeneration };
  }

  async recordLaunchIntent(input: {
    runId: string;
    attemptId: string;
    clientToken: string;
    requestDigest: string;
    startedBy: string;
  }): Promise<LaunchIntentResult> {
    const run = this.runs.get(input.runId);
    if (!run || isMemoryTerminal(run.status)) {
      return { ok: false, reason: run?.status === "cancelled" ? "RUN_CANCELLED" : "RUN_TERMINAL" };
    }
    const attempt = this.attempts.get(input.attemptId);
    if (!attempt) return { ok: false, reason: "NO_SUCH_ATTEMPT" };
    if (attempt.status === "terminal") return { ok: false, reason: "ATTEMPT_TERMINAL" };
    const next: AttemptRecord = {
      ...attempt,
      clientToken: input.clientToken,
      requestDigest: input.requestDigest,
      startedBy: input.startedBy,
      launchState: "launching",
    };
    this.attempts.set(attempt.attemptId, next);
    this.runs.set(input.runId, { ...run, currentAttemptId: attempt.attemptId, updatedAt: new Date().toISOString() });
    return { ok: true, attempt: next };
  }

  async recordLaunchState(input: {
    runId: string;
    attemptId: string;
    launchState: AttemptRecord["launchState"];
    taskId?: string | null;
  }): Promise<AttemptRecord | null> {
    const attempt = this.attempts.get(input.attemptId);
    if (!attempt) return null;
    const next: AttemptRecord = {
      ...attempt,
      launchState: input.launchState,
      ...(input.taskId === undefined ? {} : { taskId: input.taskId }),
    };
    this.attempts.set(attempt.attemptId, next);
    return next;
  }

  async recordTransition(transition: RunTransitionRecord): Promise<void> {
    this.transitions.push(transition);
  }

  async markAttemptTerminal(runId: string, attemptId: string): Promise<AttemptRecord | null> {
    const attempt = this.attempts.get(attemptId);
    if (!attempt) return null;
    const next: AttemptRecord = { ...attempt, status: "terminal" };
    this.attempts.set(attemptId, next);
    return next;
  }

  async writeReceipt(receipt: AttemptReceipt): Promise<AttemptReceipt> {
    this.receipts.set(receipt.runId + "\u0000" + receipt.attemptId, receipt);
    return receipt;
  }

  async getReceipt(runId: string, attemptId: string): Promise<AttemptReceipt | null> {
    return this.receipts.get(runId + "\u0000" + attemptId) ?? null;
  }

  async finalizeRun(runId: string, status: TerminalRunStatus, receiptId: string): Promise<ExecutionRunRow | null> {
    const run = this.runs.get(runId);
    if (!run) return null;
    for (const [attemptId, attempt] of this.attempts) {
      if (attempt.runId === runId && attempt.status !== "terminal") {
        this.attempts.set(attemptId, { ...attempt, status: "terminal" });
      }
    }
    const next: ExecutionRunRow = {
      ...run,
      status,
      terminalReceiptId: receiptId,
      updatedAt: new Date().toISOString(),
    };
    this.runs.set(runId, next);
    return next;
  }

  async setRunStatus(runId: string, status: ExecutionRunStatus): Promise<ExecutionRunRow | null> {
    const run = this.runs.get(runId);
    if (!run) return null;
    const next: ExecutionRunRow = { ...run, status, updatedAt: new Date().toISOString() };
    this.runs.set(runId, next);
    return next;
  }
}

function isMemoryTerminal(status: ExecutionRunStatus): boolean {
  return status === "succeeded" || status === "failed" || status === "cancelled";
}

function digestKey(input: {
  tenantId: string;
  skillId: string;
  skillVersion: string;
  bundleDigest: string;
  inputDigest: string;
}): string {
  return [input.tenantId, input.skillId, input.skillVersion, input.bundleDigest, input.inputDigest].join("\u0000");
}
