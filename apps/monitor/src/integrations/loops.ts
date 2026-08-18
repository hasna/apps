/**
 * Loops native adapter for monitor-v2 (MON-V2-12).
 *
 * Registers a recurring loop through the package-owned SDK surface
 * `@hasna/loops` — `LoopsClient.create`. Credential and store resolution stay
 * package-owned: the client resolves its own store (on-box sqlite or the
 * hosted /v1 API) exactly as `LoopsClientOptions` defines; this adapter
 * chooses no surface at runtime.
 *
 * Contract: this adapter implements the shared effect contracts (design §4
 * "Shared contracts", §5 slug_effects). The stable effect key is
 * sha256(slug \0 run_id \0 action_index \0 target \0 operation) where
 * operation is the adapter operation "create" — the FROZEN contract vector
 * shared by `effectKey`, so callers using the shared key resolve the adapter's
 * persisted label. Every invocation persists one effect record (receipt +
 * failure classification) in the injected effect store under that key.
 *
 * Request-change detection: the persisted record carries
 * request_digest = digest(definition) over the pinned behavior-defining
 * subset (description, schedule, target, goal, machine, expiresAt,
 * expiresAfterRuns, and the catch-up/overlap/attempts/retry/lease policies
 * with the loops store's own defaults filled in — the same field set the
 * loops store round-trips verbatim). Re-registering the same effect with a
 * different definition is detected; the adapter never silently confirms the
 * stale loop. The stale loop is replaced only AFTER the fresh loop carrying
 * the new definition is proven to exist (create first, then archive), so a
 * failed or timed-out replacement never leaves the monitor with no active
 * loop.
 *
 * Idempotency: an unchanged effect resolves the recorded loop (or, when the
 * record is missing or ambiguous, a live loop carrying the effect label whose
 * stored definition matches the request) and records its pointer instead of
 * creating a second loop. Identity is persisted in the loops store (the
 * label) and in the effect store (the record), never in adapter memory.
 *
 * Ambiguous outcomes (design §6): a timeout is persisted as unknown with no
 * external id — the create may or may not have committed. A retry therefore
 * reconciles by the effect label FIRST and adopts a committed loop whose
 * stored definition matches the request; only when no such loop exists does
 * it create. A loop carrying the label but a DIFFERENT definition is never
 * adopted (that would silently confirm stale cadence/command data) — it is
 * retired only after the replacement loop is proven.
 *
 * Concurrency: one adapter's concurrent registrations share an in-flight
 * create per (effect key, request digest) pair, so concurrent identical
 * requests through one adapter cannot both call `LoopsClient.create` and
 * concurrent DIFFERENT requests are never coalesced. Across adapters,
 * processes and machines, the adapter holds an exclusive expiring claim on
 * the effect key (EffectStore.claim) for the whole reconcile-then-create
 * sequence, so two monitors cannot both observe "no effect" and both create.
 * A contender waits briefly and fails closed with a classified result; it
 * never races the holder. The claim is released in all paths. (The in-flight
 * map is per adapter instance on purpose: instance state cannot leak across
 * callers, and cross-instance serialization belongs to the claim, not to a
 * process-global map.) Where two machines cannot share a claim file (interim
 * per-machine effect stores), a post-create label sweep converges any
 * race-residual duplicate to exactly one live loop per effect label.
 *
 * Failures are non-fatal: the adapter classifies and returns the result; it
 * never throws. A `required: true` config marks the result so the caller
 * decides whether a confirmed failure affects the run outcome.
 */

import { LoopsClient, type CreateLoopInput, type Loop } from "@hasna/loops";
import type { EffectOutcome, EffectRecord, FailureClass, IntegrationName } from "./adapter.js";
import { digestOf, effectKey, type EffectClaim, type EffectStore } from "./effects.js";

export interface LoopsIntegrationConfig {
  /** Owner scope used to derive the loop identity, e.g. "station01". */
  ownerScope: string;
  /** When true, a confirmed failure affects the run outcome (caller policy). */
  required?: boolean;
  /** Effect store the adapter persists receipts and classifications into. */
  store: EffectStore;
}

export interface LoopsEffectContext {
  /** The monitor slug whose action is being executed. */
  slug: string;
  /** The monitor run id the action belongs to. */
  runId: string;
  /** The action index within the slug definition. */
  actionIndex: number;
  /** The effect target — the loop's stable purpose string. */
  target: string;
}

export interface LoopPointer {
  kind: "loop";
  /** The loops-store id of the created (or resolved) loop. */
  id: string;
  /** The loop's identity name as registered in the loops store. */
  name: string;
}

/**
 * Classified result of one loops-create effect. Mirrors the shared
 * vocabulary (adapter.ts EffectOutcome/EffectRecord): the persisted fields
 * target, request_digest, external_id, result_pointer and last_error_class
 * are all carried, and `state` uses the shared EffectState vocabulary.
 */
export interface LoopsEffectResult {
  integration: IntegrationName;
  operation: "create";
  /** Stable effect key — sha256(slug \0 run_id \0 action_index \0 target \0 operation). */
  effectKey: string;
  /** The effect target (loop's stable purpose string). */
  target: string;
  state: "confirmed" | "failed" | "unknown";
  /** Digest of the requested definition — detects a changed request. */
  requestDigest: string;
  /** The loops-store id of the created (or resolved) loop; absent on failure. */
  externalId: string | null;
  /** Bounded digest of the loop pointer; absent on failure. */
  resultPointer: string | null;
  /** Failure classification per the shared vocabulary; null when confirmed. */
  lastErrorClass: FailureClass | null;
  /** Bounded error detail for failed/unknown states. */
  errorDetail?: string;
  /** True when an existing loop satisfied this effect (no duplicate created). */
  deduplicated: boolean;
  required: boolean;
  /** The created (or resolved) loop pointer; absent only on failure. */
  pointer?: LoopPointer;
}

const OPERATION = "create";
const EFFECT_LABEL_PREFIX = "monitor.effect.";
/** Loop labels are capped at 64 characters; the full 64-hex key cannot fit. */
const EFFECT_LABEL_KEY_BYTES = 32;
const MAX_ERROR_DETAIL = 500;

/**
 * Claim lifetime for the cross-process effect fence. Long enough that a
 * hosted-API reconcile+create sequence cannot outlive it mid-flight; short
 * enough that a crashed holder's claim is breakable within minutes.
 */
const CLAIM_TTL_MS = 120_000;
/** Bounded wait for a claim held by another process, then fail closed. */
const CLAIM_RETRY_ATTEMPTS = 6;
const CLAIM_RETRY_BASE_MS = 20;

/**
 * In-flight map keyed by (effect key, request digest): concurrent
 * registrations of one effect+definition through ONE adapter share a single
 * create; concurrent registrations with DIFFERENT definitions are never
 * coalesced. Per adapter instance (see the concurrency note above).
 */
type InFlight = Map<string, Promise<LoopsEffectResult>>;

/** Stable effect key for a loops-create effect — the shared five-component key. */
export function loopsEffectKey(ctx: LoopsEffectContext): string {
  return effectKey({
    slug: ctx.slug,
    runId: ctx.runId,
    actionIndex: ctx.actionIndex,
    target: ctx.target,
    operation: OPERATION,
  });
}

/** Stable loop identity derived from the owner scope and the effect target. */
export function loopIdentity(config: LoopsIntegrationConfig, ctx: LoopsEffectContext): string {
  return `monitor-${config.ownerScope}-${ctx.slug}-${ctx.target}`;
}

/** Loop label carrying the effect identity (lowercase; fits the label pattern). */
export function effectLabel(effectKey: string): string {
  return `${EFFECT_LABEL_PREFIX}${effectKey.slice(0, EFFECT_LABEL_KEY_BYTES)}`;
}

/**
 * The behavior-defining definition fields the loops store round-trips
 * verbatim (no normalization, no injected defaults). The request digest is
 * pinned to exactly this subset so a stored loop's digest can be compared
 * with the request: a loop is adopted only when the two match. `labels` and
 * `name` are excluded by design (labels are advisory metadata and the effect
 * label is appended at create).
 */
const REQUEST_DIGEST_FIELDS = [
  "description",
  "schedule",
  "target",
  "goal",
  "machine",
  "expiresAt",
  "expiresAfterRuns",
  "catchUp",
  "catchUpLimit",
  "overlap",
  "maxAttempts",
  "retryDelayMs",
  "leaseMs",
] as const;

/** The loops store's own create-time defaults, pinned at @hasna/loops 0.5.1. */
const STORE_DEFAULTS = {
  catchUp: "latest" as const,
  catchUpLimit: 50,
  overlap: "skip" as const,
  maxAttempts: 1,
  retryDelayMs: 60_000,
  leaseMs: 30 * 60_000,
};

/** Digest of the requested loop definition — the request digest of the effect. */
export function loopRequestDigest(definition: Omit<CreateLoopInput, "name">): string {
  return digestOf({
    description: definition.description,
    schedule: definition.schedule,
    target: definition.target,
    goal: definition.goal,
    machine: definition.machine,
    expiresAt: definition.expiresAt,
    expiresAfterRuns: definition.expiresAfterRuns,
    catchUp: definition.catchUp ?? STORE_DEFAULTS.catchUp,
    catchUpLimit: definition.catchUpLimit ?? STORE_DEFAULTS.catchUpLimit,
    overlap: definition.overlap ?? STORE_DEFAULTS.overlap,
    maxAttempts: definition.maxAttempts ?? STORE_DEFAULTS.maxAttempts,
    retryDelayMs: definition.retryDelayMs ?? STORE_DEFAULTS.retryDelayMs,
    leaseMs: definition.leaseMs ?? STORE_DEFAULTS.leaseMs,
  });
}

/**
 * Digest of a stored loop over the SAME pinned field subset as
 * `loopRequestDigest`. Equal digests prove the loop carries the requested
 * definition (command targets round-trip verbatim through the loops store;
 * agent targets may be normalized at create, in which case adoption correctly
 * falls back to create).
 */
export function loopStoreRequestDigest(loop: Loop): string {
  return digestOf({
    description: loop.description,
    schedule: loop.schedule,
    target: loop.target,
    goal: loop.goal,
    machine: loop.machine,
    expiresAt: loop.expiresAt,
    expiresAfterRuns: loop.expiresAfterRuns,
    catchUp: loop.catchUp,
    catchUpLimit: loop.catchUpLimit,
    overlap: loop.overlap,
    maxAttempts: loop.maxAttempts,
    retryDelayMs: loop.retryDelayMs,
    leaseMs: loop.leaseMs,
  });
}

/**
 * Classify a thrown value into the shared failure vocabulary:
 * timeout / not_found / invalid_input / execution_error / unknown.
 */
export function classifyLoopsError(err: unknown): EffectOutcome {
  const message = err instanceof Error ? err.message : String(err);
  const name = err instanceof Error ? err.name : "";
  if (name === "TimeoutError" || name === "AbortError" || /timed?\s*out|timeout/i.test(message)) {
    // Ambiguous outcome: the effect may or may not have landed (design §6).
    return { state: "unknown", lastErrorClass: "timeout", errorDetail: message.slice(0, MAX_ERROR_DETAIL) };
  }
  if (name === "LoopNotFoundError" || name === "LoopArchivedError" || /not found|no loop/i.test(message)) {
    return { state: "failed", lastErrorClass: "not_found", errorDetail: message.slice(0, MAX_ERROR_DETAIL) };
  }
  if (name === "ValidationError" || /invalid|validation/i.test(message)) {
    return { state: "failed", lastErrorClass: "invalid_input", errorDetail: message.slice(0, MAX_ERROR_DETAIL) };
  }
  if (err instanceof Error) {
    return { state: "failed", lastErrorClass: "execution_error", errorDetail: message.slice(0, MAX_ERROR_DETAIL) };
  }
  return { state: "unknown", lastErrorClass: "unknown", errorDetail: message.slice(0, MAX_ERROR_DETAIL) };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class LoopsIntegration {
  private readonly inFlight: InFlight = new Map();

  constructor(
    private readonly client: LoopsClient,
    private readonly config: LoopsIntegrationConfig,
  ) {}

  /**
   * Register a recurring loop for the effect context. Idempotent by effect
   * identity: an unchanged repeated effect resolves the existing loop and
   * records its pointer; a changed definition is detected by request digest
   * and replaces the stale loop only after the replacement is proven. An
   * ambiguous prior (timeout) is reconciled by label before any create. Never
   * throws — failures are classified for the caller.
   */
  async register(ctx: LoopsEffectContext, definition: Omit<CreateLoopInput, "name">): Promise<LoopsEffectResult> {
    const key = loopsEffectKey(ctx);
    // The digest gates the in-flight slot: identical requests share one
    // create; different definitions under one context never coalesce.
    const requestDigest = loopRequestDigest(definition);
    const slot = `${key}\0${requestDigest}`;
    const pending = this.inFlight.get(slot);
    if (pending) return pending;

    const run = this.registerOnce(ctx, definition, key, requestDigest);
    this.inFlight.set(slot, run);
    try {
      return await run;
    } finally {
      this.inFlight.delete(slot);
    }
  }

  private async registerOnce(
    ctx: LoopsEffectContext,
    definition: Omit<CreateLoopInput, "name">,
    key: string,
    requestDigest: string,
  ): Promise<LoopsEffectResult> {
    const label = effectLabel(key);
    const required = this.config.required ?? false;

    // Cross-process fence: the whole reconcile-then-create sequence runs
    // under the exclusive claim on the effect key. A contender waits briefly
    // and fails closed; it never races the holder. Released in all paths.
    const claim = await this.acquireClaim(key);
    if (!claim) {
      return {
        integration: "loops",
        operation: OPERATION,
        effectKey: key,
        target: ctx.target,
        state: "failed",
        requestDigest,
        externalId: null,
        resultPointer: null,
        lastErrorClass: "execution_error",
        errorDetail: "effect fence held by another process; retry",
        deduplicated: false,
        required,
      };
    }

    try {
      const prior = await this.config.store.get(key);

      // 1. Unchanged confirmed effect — resolve the recorded loop.
      if (prior && prior.requestDigest === requestDigest && prior.externalId) {
        try {
          const loop = await this.client.get(prior.externalId);
          if (!loop.archivedAt) {
            return this.success(ctx, key, requestDigest, required, loop.id, loop.name, true);
          }
        } catch {
          // The recorded loop no longer exists (deleted externally) — reconcile below.
        }
      }

      // 2. Reconcile by the effect label before creating anything. This covers
      //    an absent record, an ambiguous prior (a create that timed out after
      //    committing), and a recorded loop that was archived or deleted
      //    externally. A loop is adopted ONLY when its stored definition
      //    matches the request — never a loop carrying stale cadence or
      //    command data. Any other active loop carrying the label is a
      //    duplicate of an unconfirmed create and is retired once the
      //    matching loop is proven live.
      const labeled = await this.client.list({ labels: [label], limit: 10 });
      const activeLabeled = labeled.filter((loop) => !loop.archivedAt);
      const matching = activeLabeled.find((loop) => loopStoreRequestDigest(loop) === requestDigest);
      if (matching) {
        for (const dup of activeLabeled) {
          if (dup.id === matching.id) continue;
          try {
            await this.client.archive(dup.id);
          } catch {
            // Best effort — already archived or deleted.
          }
        }
        const result = this.success(ctx, key, requestDigest, required, matching.id, matching.name, true);
        await this.persist(key, ctx.target, result);
        return result;
      }

      // 3. No live loop satisfies the request. PROVE BEFORE REPLACE: the
      //    fresh loop is created first; stale loops carrying the label (and
      //    the recorded loop, when it differs) are archived only after the
      //    replacement exists. A failed create therefore leaves the current
      //    loop running — never a state with no active loop.
      const created = await this.client.create({
        ...definition,
        name: loopIdentity(this.config, ctx),
        labels: [...(definition.labels ?? []), label],
      });
      for (const stale of activeLabeled) {
        try {
          await this.client.archive(stale.id);
        } catch {
          // Best effort — already archived or deleted.
        }
      }
      // Post-create sweep: a concurrent creator on ANOTHER machine (no shared
      // claim file) may have created a duplicate between our list and create.
      // Re-read the label set and retire every active duplicate except the
      // loop we just proved, so exactly one live loop ever carries the label.
      try {
        const after = await this.client.list({ labels: [label], limit: 10 });
        for (const dup of after) {
          if (dup.id === created.id || dup.archivedAt) continue;
          try {
            await this.client.archive(dup.id);
          } catch {
            // Best effort — already archived or deleted.
          }
        }
      } catch {
        // The sweep is best effort; the next registration reconciles again.
      }
      if (prior?.externalId && prior.externalId !== created.id) {
        try {
          await this.client.archive(prior.externalId);
        } catch {
          // Best effort — already archived or deleted.
        }
      }
      const result = this.success(ctx, key, requestDigest, required, created.id, created.name, false);
      await this.persist(key, ctx.target, result);
      return result;
    } catch (err) {
      const outcome = classifyLoopsError(err);
      const result: LoopsEffectResult = {
        integration: "loops",
        operation: OPERATION,
        effectKey: key,
        target: ctx.target,
        state: outcome.state === "unknown" ? "unknown" : "failed",
        requestDigest,
        externalId: null,
        resultPointer: null,
        lastErrorClass: outcome.lastErrorClass ?? null,
        errorDetail: outcome.errorDetail,
        deduplicated: false,
        required,
      };
      try {
        await this.persist(key, ctx.target, result);
      } catch {
        // A persistence failure must not mask the classified adapter result.
      }
      return result;
    } finally {
      await this.config.store.release(key, claim.token);
    }
  }

  private async acquireClaim(key: string): Promise<EffectClaim | null> {
    for (let attempt = 0; attempt < CLAIM_RETRY_ATTEMPTS; attempt++) {
      const claim = await this.config.store.claim(key, CLAIM_TTL_MS);
      if (claim) return claim;
      await sleep(CLAIM_RETRY_BASE_MS * (attempt + 1));
    }
    return null;
  }

  private success(
    ctx: LoopsEffectContext,
    key: string,
    requestDigest: string,
    required: boolean,
    id: string,
    name: string,
    deduplicated: boolean,
  ): LoopsEffectResult {
    const pointer: LoopPointer = { kind: "loop", id, name };
    return {
      integration: "loops",
      operation: OPERATION,
      effectKey: key,
      target: ctx.target,
      state: "confirmed",
      requestDigest,
      externalId: id,
      resultPointer: digestOf(pointer),
      lastErrorClass: null,
      deduplicated,
      required,
      pointer,
    };
  }

  private async persist(
    key: string,
    target: string,
    result: LoopsEffectResult,
  ): Promise<void> {
    const prior = await this.config.store.get(key);
    const now = new Date().toISOString();
    const record: EffectRecord = {
      effectKey: key,
      integration: "loops",
      operation: OPERATION,
      target,
      state: result.state,
      requestDigest: result.requestDigest,
      externalId: result.externalId ?? null,
      resultPointer: result.resultPointer ?? null,
      lastErrorClass: result.lastErrorClass ?? null,
      createdAt: prior?.createdAt ?? now,
      updatedAt: now,
    };
    await this.config.store.record(record);
  }
}
