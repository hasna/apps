import { createHash } from "node:crypto";
import type { Database } from "bun:sqlite";
import CronExpressionParser from "cron-parser";
import {
  SLUG_NAME_PATTERN,
  canonicalJson,
  definitionDigest,
  slugDefinitionSchema,
  validateDefinition,
  type SlugDefinition,
  type ValidateResult,
} from "./service/definition.js";
import {
  MonitorStore,
  type PagedResult,
  type RunRow,
  type ReceiptRow,
  type SlugRow,
} from "./service/store.js";

/**
 * monitor v2 — domain service (design §2, §6 control plane).
 *
 * All CLI, MCP, SDK, and daemon entry points call this service. It writes
 * durable control-plane state but never executes checks itself.
 *
 * Control acknowledgments always carry `execution_proven: false` unless an
 * observation read (a terminal receipt) independently confirms a worker and
 * run transition.
 */

export type ErrorResult = {
  accepted: false;
  code: "error";
  slug: string;
  revision: number;
  state: string;
  run_id: null;
  execution_proven: false;
  error: string;
};

export type ControlResult = {
  accepted: boolean;
  code:
    | "started"
    | "already_running"
    | "idempotent_replay"
    | "draining"
    | "drained"
    | "drain_pending"
    | "already_stopped"
    | "cancelled"
    | "restarted";
  slug: string;
  revision: number;
  state: string;
  run_id: string | null;
  execution_proven: boolean;
  pending_runs?: number;
};

export type DefineResult = {
  accepted: true;
  code: "defined" | "unchanged" | "updated";
  slug: string;
  revision: number;
  changed: boolean;
  digest: string;
  execution_proven: false;
};

export type DescribeResult = {
  slug: string;
  revision: number;
  desired_state: string;
  execution_epoch: number;
  definition: SlugDefinition | null;
  cadence: unknown;
  checks: unknown[];
  created_at: number;
  updated_at: number;
};

export type SlugStatus = {
  slug: string;
  desired_state: string;
  observed_state: string;
  active_revision: number | null;
  next_due_at: number | null;
  queue_depth: number;
  admitted_count: number;
  leased_count: number;
  running_count: number;
  retry_wait_count: number;
  expired_lease_count: number;
  terminal_count: number;
  execution_epoch: number;
  last_receipt: ReceiptRow | null;
  execution_proven: boolean;
};

export type LogEntry = {
  run_id: string;
  run_state: string;
  scheduled_at: number | null;
  admitted_at: number | null;
  started_at: number | null;
  finished_at: number | null;
  outcome: string | null;
  attempt_number: number | null;
  attempt_state: string | null;
  exit_code: number | null;
  result_digest: string | null;
};

const DEFAULT_PAGE_LIMIT = 100;
const MAX_PAGE_LIMIT = 1000;
const DEFAULT_WAIT_TIMEOUT_MS = 30_000;
const MAX_WAIT_TIMEOUT_MS = 10 * 60_000;

export class MonitorService {
  private readonly store: MonitorStore;

  constructor(db: Database) {
    this.store = new MonitorStore(db);
  }

  // ── Definition verbs ─────────────────────────────────────────────────────

  validate(value: unknown): ValidateResult {
    return validateDefinition(value);
  }

  define(
    slugName: string,
    definition: unknown,
    opts: { createdBy?: string; ifRevision?: number; createOnly?: boolean } = {}
  ): DefineResult | ErrorResult {
    if (!SLUG_NAME_PATTERN.test(slugName)) {
      return this.error(
        slugName,
        `invalid slug name: ${slugName} (must match ^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$)`
      );
    }

    const parsed = slugDefinitionSchema.safeParse(definition);
    if (!parsed.success) {
      const errors = parsed.error.issues.map((issue) => {
        const path = issue.path.length > 0 ? issue.path.join(".") : "(root)";
        return `${path}: ${issue.message}`;
      });
      return this.error(slugName, `invalid definition: ${errors.join("; ")}`);
    }

    // The slug identity is the definition's identity: a definition named
    // `other-slug` can never be stored under `this-slug`.
    const def = parsed.data;
    if (def.name !== slugName) {
      return this.error(
        slugName,
        `definition name '${def.name}' does not match slug '${slugName}'`
      );
    }

    const digest = definitionDigest(def);
    const existing = this.store.getSlugByName(slugName);

    if (existing && opts.createOnly) {
      return this.error(slugName, `slug already exists: ${slugName}`);
    }

    if (!existing) {
      if (opts.ifRevision !== undefined && opts.ifRevision !== 1) {
        return this.error(
          slugName,
          `revision mismatch: slug does not exist (expected revision ${opts.ifRevision})`
        );
      }
      const slug = this.store.insertSlug(slugName, def.description ?? "");
      const revision = this.store.insertRevision(
        slug.id,
        1,
        def,
        digest,
        opts.createdBy ?? ""
      );
      this.store.setSlugActiveRevision(slug.id, revision.id);
      return {
        accepted: true,
        code: "defined",
        slug: slugName,
        revision: 1,
        changed: true,
        digest,
        execution_proven: false,
      };
    }

    const active = this.store.getActiveRevision(existing.id);
    if (active && active.definition_digest === digest) {
      return {
        accepted: true,
        code: "unchanged",
        slug: slugName,
        revision: active.revision,
        changed: false,
        digest,
        execution_proven: false,
      };
    }

    if (opts.ifRevision !== undefined && active && active.revision !== opts.ifRevision) {
      return this.error(
        slugName,
        `revision mismatch: active revision is ${active.revision}, expected ${opts.ifRevision}`
      );
    }

    const nextRevision = this.store.getLatestRevisionNumber(existing.id) + 1;
    const revision = this.store.insertRevision(
      existing.id,
      nextRevision,
      def,
      digest,
      opts.createdBy ?? ""
    );
    this.store.setSlugActiveRevision(existing.id, revision.id);
    return {
      accepted: true,
      code: "updated",
      slug: slugName,
      revision: nextRevision,
      changed: true,
      digest,
      execution_proven: false,
    };
  }

  describe(slugName: string): DescribeResult | null {
    const slug = this.store.getSlugByName(slugName);
    if (!slug) return null;
    const active = this.store.getActiveRevision(slug.id);
    const def = active
      ? (JSON.parse(active.definition_json) as SlugDefinition)
      : null;
    return {
      slug: slug.name,
      revision: active?.revision ?? 0,
      desired_state: slug.desired_state,
      execution_epoch: slug.execution_epoch,
      definition: def ?? null,
      cadence: def?.cadence ?? null,
      checks: def?.checks ?? [],
      created_at: slug.created_at,
      updated_at: slug.updated_at,
    };
  }

  list(): SlugRow[] {
    return this.store.listSlugs();
  }

  rollback(
    slugName: string,
    revisionNumber: number,
    opts: { createdBy?: string } = {}
  ): DefineResult | ErrorResult {
    const slug = this.store.getSlugByName(slugName);
    if (!slug) {
      return this.error(slugName, `slug not found: ${slugName}`);
    }
    const target = this.store.getRevision(slug.id, revisionNumber);
    if (!target) {
      return this.error(slugName, `revision not found: ${revisionNumber}`);
    }
    const nextRevision = this.store.getLatestRevisionNumber(slug.id) + 1;
    const revision = this.store.insertRevision(
      slug.id,
      nextRevision,
      JSON.parse(target.definition_json),
      target.definition_digest,
      opts.createdBy ?? ""
    );
    this.store.setSlugActiveRevision(slug.id, revision.id);
    return {
      accepted: true,
      code: "updated",
      slug: slugName,
      revision: nextRevision,
      changed: true,
      digest: target.definition_digest,
      execution_proven: false,
    };
  }

  // ── Runtime verbs ────────────────────────────────────────────────────────

  start(
    slugName: string,
    opts: {
      idempotencyKey?: string;
      nextCadence?: boolean;
      createdBy?: string;
    } = {}
  ): ControlResult | ErrorResult {
    const slug = this.store.getSlugByName(slugName);
    if (!slug) {
      return this.error(slugName, `slug not found: ${slugName}`);
    }

    const normalizedStart = { nextCadence: !!opts.nextCadence };
    if (opts.idempotencyKey) {
      const replayed = this.replayOrConflict(
        slug.id,
        slugName,
        opts.idempotencyKey,
        "start",
        normalizedStart
      );
      if (replayed) return replayed;
    }

    const active = this.store.getActiveRevision(slug.id);
    if (!active) {
      return this.error(slugName, `slug has no active revision: ${slugName}`);
    }
    const revision = active.revision;

    let result: ControlResult;
    if (slug.desired_state === "running") {
      if (opts.nextCadence) {
        const nowSec = Math.floor(Date.now() / 1000);
        const epoch = this.store.getSlugById(slug.id)?.execution_epoch ?? 0;
        const admissionKey = `immediate:${slug.id}:${epoch}:${revision}`;
        this.store.insertRun(slug.id, active.id, admissionKey, epoch, nowSec);
      }
      result = {
        accepted: true,
        code: "already_running",
        slug: slugName,
        revision,
        state: "running",
        run_id: null,
        execution_proven: false,
      };
    } else {
      this.store.setSlugState(slug.id, "running");
      this.store.incrementExecutionEpoch(slug.id);
      if (opts.nextCadence) {
        const nowSec = Math.floor(Date.now() / 1000);
        const epoch = this.store.getSlugById(slug.id)?.execution_epoch ?? 0;
        const admissionKey = `immediate:${slug.id}:${epoch}:${revision}`;
        this.store.insertRun(slug.id, active.id, admissionKey, epoch, nowSec);
      }
      result = {
        accepted: true,
        code: "started",
        slug: slugName,
        revision,
        state: "running",
        run_id: null,
        execution_proven: false,
      };
    }

    if (opts.idempotencyKey) {
      this.store.insertControlRequest(
        slug.id,
        opts.idempotencyKey,
        "start",
        this.requestDigest("start", normalizedStart),
        JSON.stringify(result)
      );
    }
    return result;
  }

  stop(
    slugName: string,
    opts: {
      cancel?: boolean;
      wait?: boolean;
      timeoutMs?: number;
      idempotencyKey?: string;
      createdBy?: string;
    } = {}
  ): ControlResult | ErrorResult {
    const slug = this.store.getSlugByName(slugName);
    if (!slug) {
      return this.error(slugName, `slug not found: ${slugName}`);
    }

    const normalizedStop = {
      cancel: !!opts.cancel,
      wait: !!opts.wait,
      timeoutMs: opts.timeoutMs ?? null,
    };
    if (opts.idempotencyKey) {
      const replayed = this.replayOrConflict(
        slug.id,
        slugName,
        opts.idempotencyKey,
        "stop",
        normalizedStop
      );
      if (replayed) return replayed;
    }

    const active = this.store.getActiveRevision(slug.id);
    const revision = active?.revision ?? 0;

    let result: ControlResult;

    if (opts.cancel) {
      this.store.setSlugState(slug.id, "stopped");
      this.store.incrementExecutionEpoch(slug.id);
      const cancelled = this.cancelQueuedRuns(slug.id);
      this.store.revokeActiveLeasesForSlug(slug.id);
      result = {
        accepted: true,
        code: "cancelled",
        slug: slugName,
        revision,
        state: "stopped",
        run_id: null,
        execution_proven: false,
        pending_runs: cancelled,
      };
    } else if (slug.desired_state === "running") {
      this.store.setSlugState(slug.id, "draining");
      const pending = this.store.countNonTerminalRuns(slug.id);
      if (opts.wait) {
        result = this.waitForDrain(slug.id, slugName, revision, opts.timeoutMs);
      } else {
        result = {
          accepted: true,
          code: "draining",
          slug: slugName,
          revision,
          state: "draining",
          run_id: null,
          execution_proven: false,
          pending_runs: pending,
        };
      }
    } else if (slug.desired_state === "draining") {
      const pending = this.store.countNonTerminalRuns(slug.id);
      if (opts.wait) {
        result = this.waitForDrain(slug.id, slugName, revision, opts.timeoutMs);
      } else {
        result = {
          accepted: true,
          code: "already_stopped",
          slug: slugName,
          revision,
          state: "draining",
          run_id: null,
          execution_proven: false,
          pending_runs: pending,
        };
      }
    } else {
      result = {
        accepted: true,
        code: "already_stopped",
        slug: slugName,
        revision,
        state: slug.desired_state,
        run_id: null,
        execution_proven: false,
        pending_runs: 0,
      };
    }

    if (opts.idempotencyKey) {
      this.store.insertControlRequest(
        slug.id,
        opts.idempotencyKey,
        "stop",
        this.requestDigest("stop", normalizedStop),
        JSON.stringify(result)
      );
    }
    return result;
  }

  restart(
    slugName: string,
    opts: {
      cancel?: boolean;
      wait?: boolean;
      timeoutMs?: number;
      idempotencyKey?: string;
      createdBy?: string;
    } = {}
  ): ControlResult | ErrorResult {
    const slug = this.store.getSlugByName(slugName);
    if (!slug) {
      return this.error(slugName, `slug not found: ${slugName}`);
    }

    const normalizedRestart = {
      cancel: !!opts.cancel,
      wait: !!opts.wait,
      timeoutMs: opts.timeoutMs ?? null,
    };
    if (opts.idempotencyKey) {
      const replayed = this.replayOrConflict(
        slug.id,
        slugName,
        opts.idempotencyKey,
        "restart",
        normalizedRestart
      );
      if (replayed) return replayed;
    }

    const active = this.store.getActiveRevision(slug.id);
    if (!active) {
      return this.error(slugName, `slug has no active revision: ${slugName}`);
    }
    const revision = active.revision;

    // --cancel: cancel queued work and revoke active leases before the new
    // epoch starts. This runs on the running path too — a restart is never a
    // no-op.
    if (opts.cancel) {
      this.store.setSlugState(slug.id, "stopped");
      this.store.incrementExecutionEpoch(slug.id);
      this.cancelQueuedRuns(slug.id);
      this.store.revokeActiveLeasesForSlug(slug.id);
    }

    // --wait: settle in-flight work before claiming a restart. If the drain
    // does not finish inside the timeout, report drain_pending honestly and
    // do not claim a restart.
    if (opts.wait) {
      const drained = this.waitForDrain(slug.id, slugName, revision, opts.timeoutMs);
      if (drained.code === "drain_pending") {
        if (opts.idempotencyKey) {
          this.store.insertControlRequest(
            slug.id,
            opts.idempotencyKey,
            "restart",
            this.requestDigest("restart", normalizedRestart),
            JSON.stringify(drained)
          );
        }
        return drained;
      }
    }

    // Fence the previous execution epoch regardless of the previous desired
    // state: in-flight work under an older epoch is stale by construction.
    this.store.incrementExecutionEpoch(slug.id);
    this.store.setSlugState(slug.id, "running");

    const result: ControlResult = {
      accepted: true,
      code: "restarted",
      slug: slugName,
      revision,
      state: "running",
      run_id: null,
      execution_proven: false,
    };

    if (opts.idempotencyKey) {
      this.store.insertControlRequest(
        slug.id,
        opts.idempotencyKey,
        "restart",
        this.requestDigest("restart", normalizedRestart),
        JSON.stringify(result)
      );
    }
    return result;
  }

  status(slugName?: string): SlugStatus | null {
    if (slugName) {
      const slug = this.store.getSlugByName(slugName);
      if (!slug) return null;
      return this.statusFor(slug);
    }
    const first = this.store.listSlugs()[0];
    if (!first) return null;
    return this.statusFor(first);
  }

  logs(slugName: string, opts: { runId?: string } = {}): LogEntry[] {
    const slug = this.store.getSlugByName(slugName);
    if (!slug) return [];
    const runs = this.store
      .listRuns(slug.id, { cursor: null, limit: MAX_PAGE_LIMIT })
      .entries.filter((run) => !opts.runId || run.id === opts.runId);
    const attempts = this.store.listAttemptsForRuns(runs.map((run) => run.id));
    const attemptsByRun = new Map<string, typeof attempts>();
    for (const attempt of attempts) {
      const bucket = attemptsByRun.get(attempt.run_id) ?? [];
      bucket.push(attempt);
      attemptsByRun.set(attempt.run_id, bucket);
    }
    const entries: LogEntry[] = [];
    for (const run of runs) {
      const runAttempts = attemptsByRun.get(run.id) ?? [];
      if (runAttempts.length === 0) {
        entries.push(this.toLogEntry(run, null));
      }
      for (const attempt of runAttempts) {
        entries.push(this.toLogEntry(run, attempt));
      }
    }
    return entries;
  }

  runs(
    slugName: string,
    opts: { state?: string; cursor?: string; limit?: number } = {}
  ): PagedResult<RunRow> {
    const slug = this.store.getSlugByName(slugName);
    if (!slug) return { entries: [], next_cursor: null, has_more: false };
    const limit = Math.min(opts.limit ?? DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT);
    return this.store.listRuns(slug.id, {
      state: opts.state,
      cursor: opts.cursor ?? null,
      limit,
    });
  }

  receipts(
    slugName: string,
    opts: { runId?: string; cursor?: string; limit?: number } = {}
  ): PagedResult<ReceiptRow> {
    const slug = this.store.getSlugByName(slugName);
    if (!slug) return { entries: [], next_cursor: null, has_more: false };
    const limit = Math.min(opts.limit ?? DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT);
    return this.store.listReceipts(slug.id, {
      runId: opts.runId,
      cursor: opts.cursor ?? null,
      limit,
    });
  }

  // ── Internals ────────────────────────────────────────────────────────────

  private error(slugName: string, message: string): ErrorResult {
    return {
      accepted: false,
      code: "error",
      slug: slugName,
      revision: 0,
      state: "error",
      run_id: null,
      execution_proven: false,
      error: message,
    };
  }

  /**
   * Operation-scoped idempotency: an idempotency key replays only the exact
   * stored request (same operation, same normalized request digest). Reusing
   * a key for a different request is a conflict, not a replay — otherwise a
   * key captured by `start` would silently replay that start's result for a
   * later `stop`.
   */
  private replayOrConflict(
    slugId: string,
    slugName: string,
    key: string,
    operation: "start" | "stop" | "restart",
    normalized: Record<string, unknown>
  ): ControlResult | ErrorResult | null {
    const digest = this.requestDigest(operation, normalized);
    const stored = this.store.getControlRequest(slugId, key, operation);
    if (!stored) return null;
    if (stored.request_digest !== digest) {
      return this.error(
        slugName,
        `idempotency key '${key}' was already used for a different ${operation} request`
      );
    }
    const parsed = JSON.parse(stored.result_json) as ControlResult;
    return { ...parsed, code: "idempotent_replay" };
  }

  private requestDigest(
    operation: string,
    normalized: Record<string, unknown>
  ): string {
    return createHash("sha256")
      .update(canonicalJson({ operation, ...normalized }))
      .digest("hex");
  }

  private cancelQueuedRuns(slugId: string): number {
    let cancelled = 0;
    let cursor: string | null = null;
    // Follow the cursor to exhaustion: a single page at MAX_PAGE_LIMIT would
    // leave every queued run beyond the first 1,000 non-terminal while the
    // slug is reported stopped.
    do {
      const page = this.store.listRuns(slugId, { cursor, limit: MAX_PAGE_LIMIT });
      const queued = page.entries.filter((run) =>
        ["admitted", "retry_wait"].includes(run.state)
      );
      for (const run of queued) {
        const receipt = this.store.insertReceipt(
          run.id,
          "cancelled",
          "cancelled_before_claim"
        );
        this.store.setRunTerminal(run.id, "cancelled", receipt.id);
      }
      cancelled += queued.length;
      cursor = page.next_cursor;
    } while (cursor);
    return cancelled;
  }

  private waitForDrain(
    slugId: string,
    slugName: string,
    revision: number,
    timeoutMs?: number
  ): ControlResult {
    const budget = Math.min(
      timeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS,
      MAX_WAIT_TIMEOUT_MS
    );
    const deadline = Date.now() + budget;
    let pending = this.store.countNonTerminalRuns(slugId);
    while (pending > 0 && Date.now() < deadline) {
      Bun.sleepSync(50);
      pending = this.store.countNonTerminalRuns(slugId);
    }
    if (pending === 0) {
      return {
        accepted: true,
        code: "drained",
        slug: slugName,
        revision,
        state: "draining",
        run_id: null,
        // Zero pending runs is not execution proof: a slug that never ran
        // would claim a proven worker transition on this branch alone.
        // Proven only when a terminal receipt independently confirms an
        // observed worker and run transition.
        execution_proven: this.store.hasReceiptForSlug(slugId),
        pending_runs: 0,
      };
    }
    return {
      accepted: true,
      code: "drain_pending",
      slug: slugName,
      revision,
      state: "draining",
      run_id: null,
      execution_proven: false,
      pending_runs: pending,
    };
  }

  private statusFor(slug: SlugRow): SlugStatus {
    const active = this.store.getActiveRevision(slug.id);
    const def = active
      ? (JSON.parse(active.definition_json) as SlugDefinition)
      : null;
    const nowSec = Math.floor(Date.now() / 1000);
    const admitted = this.store.countRunsByState(slug.id, "admitted");
    const leased = this.store.countRunsByState(slug.id, "leased");
    const running = this.store.countRunsByState(slug.id, "running");
    const retryWait = this.store.countRunsByState(slug.id, "retry_wait");
    const terminal = this.store.countRunsByState(slug.id, "terminal");
    const activeLeases = this.store.countActiveLeases(slug.id);
    const lastReceipt = this.store.getLatestReceipt(slug.id);
    // observed_state is read from the execution plane (runs and leases),
    // never from the desired control state: right after start, with no
    // worker having claimed anything, the slug is observed idle even though
    // its desired state is running.
    const executing = running + leased + activeLeases;
    const observed_state =
      executing > 0 ? "running" : admitted + retryWait > 0 ? "queued" : "idle";
    return {
      slug: slug.name,
      desired_state: slug.desired_state,
      observed_state,
      active_revision: active?.revision ?? null,
      next_due_at: def ? this.nextDueAt(def, nowSec) : null,
      queue_depth: admitted,
      admitted_count: admitted,
      leased_count: leased,
      running_count: running,
      retry_wait_count: retryWait,
      expired_lease_count: this.store.countExpiredLeases(slug.id, nowSec),
      terminal_count: terminal,
      execution_epoch: slug.execution_epoch,
      last_receipt: lastReceipt,
      execution_proven: this.store.hasReceiptForSlug(slug.id),
    };
  }

  private nextDueAt(def: SlugDefinition, nowSec: number): number | null {
    const cadence = def.cadence;
    if (cadence.type === "interval") {
      return nowSec + cadence.seconds;
    }
    try {
      const interval = CronExpressionParser.parse(cadence.expression, {
        tz: cadence.timezone,
        currentDate: new Date(nowSec * 1000),
      });
      const next = interval.next();
      return Math.floor(next.getTime() / 1000);
    } catch {
      return null;
    }
  }

  private toLogEntry(
    run: RunRow,
    attempt: {
      attempt_number: number;
      state: string;
      exit_code: number | null;
      result_digest: string | null;
    } | null
  ): LogEntry {
    return {
      run_id: run.id,
      run_state: run.state,
      scheduled_at: run.scheduled_at,
      admitted_at: run.admitted_at,
      started_at: run.started_at,
      finished_at: run.finished_at,
      outcome: run.outcome,
      attempt_number: attempt?.attempt_number ?? null,
      attempt_state: attempt?.state ?? null,
      exit_code: attempt?.exit_code ?? null,
      result_digest: attempt?.result_digest ?? null,
    };
  }
}
