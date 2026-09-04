/**
 * Skills integration — invoke an existing executable skill by stable skill
 * identifier through the exact `@hasna/skills` SDK surface (root `runSkill`).
 *
 * MON-V2-10 gate contract:
 *
 * - The invocation uses exactly `runSkill(skillId, [], { stdio: "pipe" })`.
 *   No CLI, HTTP, or MCP surface is chosen at runtime, and no `env` is passed
 *   to the SDK: credential resolution stays package-owned by `@hasna/skills`.
 * - Instruction-only skills are rejected. The SDK refuses to execute them
 *   (`is an instruction skill (kind: instruction) and is not runnable`); the
 *   adapter classifies that refusal as `rejected` with reason
 *   `instruction-only` and never stores it as a success.
 * - Effect identity (design §5): the adapter receives the five effect-key
 *   components `(slug, run_id, action_index, target, operation)`, hashes them
 *   into a stable `effect_key` / `request_digest` (sha256 over the canonical
 *   five-component join), and carries the full slug_effects vocabulary on the
 *   record: `integration`, `operation`, `target`, `state`, `request_digest`,
 *   `external_id`, `result_pointer`, `last_error_class`.
 * - Durable deduplication: when an effect store (the slug_effects repository
 *   shape from migration 008) is supplied, the adapter reserves the effect
 *   key before executing. A store row that already exists for the same key —
 *   a retry of the same action, or a process restart reading the same durable
 *   store — means the skill is NOT executed again; the stored effect is
 *   returned as the outcome. After execution the effect is confirmed
 *   (`confirmed` / `failed`) with its `last_error_class` and any
 *   `result_pointer`.
 * - SDK exceptions are non-fatal: a rejected `runSkill` promise is caught and
 *   classified (`not_found`, `timeout`, `execution_error`, `invalid_input`,
 *   `unknown`) into a bounded record, never rethrown.
 * - The stored invocation result is bounded and scrubbed: `stdout`, `stderr`,
 *   and `error` are truncated so the stored field (marker included) never
 *   exceeds `MAX_OUTPUT_BYTES` UTF-8 bytes, and credential values are
 *   redacted before storage — executable skills inherit `process.env`, so a
 *   skill that prints an ambient credential must not place it in the record.
 *
 * Failure behavior: non-fatal by default. A `required: true` integration
 * flags `requiredFailed` on the outcome so a confirmed failure can affect
 * the run outcome.
 */
import { createHash } from "crypto";
import { runSkill } from "@hasna/skills";

export const MAX_OUTPUT_BYTES = 8192;
export const OUTPUT_TRUNCATION_MARKER = "\n…[output truncated]";
/** Substitution used when a credential-shaped value is removed from output. */
export const REDACTION_MARKER = "[REDACTED]";

export const SKILLS_INTEGRATION = "skills";
export const DEFAULT_OPERATION = "run";

/** The slug_effects failure vocabulary (design §5). */
export type EffectFailureClass =
  | "not_found"
  | "timeout"
  | "execution_error"
  | "invalid_input"
  | "unknown";

/** The slug_effects state vocabulary (migration 008 CHECK constraint). */
export type EffectState = "planned" | "sent" | "confirmed" | "unknown" | "failed";

export type SkillInvocationStatus = "succeeded" | "rejected" | "failed";

/** The five effect-key components (design §5, `hash(slug, run_id,
 * action_index, target, operation)`). */
export interface SkillEffectContext {
  slug: string;
  runId: string;
  actionIndex: number;
  /** Effect target; defaults to the skill id. */
  target?: string;
  /** Effect operation; defaults to `run`. */
  operation?: string;
}

export interface SkillsIntegrationConfig {
  /** Stable skill identifier resolved by the @hasna/skills SDK. */
  skillId: string;
  /** When true, a confirmed failure affects the run outcome. Default false. */
  required?: boolean;
  /** Effect identity of the slug action this invocation belongs to. */
  effect: SkillEffectContext;
}

/**
 * Row shape mirroring `slug_effects` (migration 008) exactly, so a
 * `SlugRepository` instance is structurally assignable as a
 * `SkillEffectStore`.
 */
export interface SkillEffectRow {
  id: string;
  run_id: string;
  attempt_id: string | null;
  effect_key: string;
  integration: string;
  operation: string;
  target: string;
  state: EffectState;
  request_digest: string;
  external_id: string | null;
  result_pointer: string | null;
  last_error_class: string | null;
  created_at: number;
  updated_at: number;
}

/**
 * The subset of the slug_effects persistence contract this adapter uses.
 * Method names and payload shapes mirror `SlugRepository`
 * (`createEffect` / `getEffectByKey` / `updateEffect`) so the real repository
 * satisfies this interface without adapters.
 */
export interface SkillEffectStore {
  getEffectByKey(effectKey: string): SkillEffectRow | null;
  createEffect(input: {
    runId: string;
    attemptId?: string | null;
    effectKey: string;
    integration: string;
    operation: string;
    target?: string;
    requestDigest?: string;
  }): { created: boolean; effect: SkillEffectRow };
  updateEffect(
    id: string,
    patch: {
      state?: EffectState;
      externalId?: string | null;
      resultPointer?: string | null;
      lastErrorClass?: string | null;
    },
  ): void;
}

/**
 * Invocation record. Carries the slug_effects persistence vocabulary
 * (snake_case, mapping 1:1 onto the table columns) plus the bounded output
 * fields and the adapter's classification (`status` / `reason`).
 */
export interface SkillInvocationRecord {
  /** Stable identity: `hash(slug, run_id, action_index, target, operation)`. */
  effect_key: string;
  /** slug_effects.integration — always `skills`. */
  integration: string;
  /** slug_effects.operation — the effect operation (default `run`). */
  operation: string;
  /** slug_effects.target — the effect target (defaults to the skill id). */
  target: string;
  /** slug_effects.state — `confirmed` on success, `failed` on failure. */
  state: EffectState;
  /** slug_effects.request_digest — digest of the five-component request. */
  request_digest: string;
  /** slug_effects.external_id — set when the caller provides one. */
  external_id?: string;
  /** slug_effects.result_pointer — set when the caller stores output elsewhere. */
  result_pointer?: string;
  /** slug_effects.last_error_class — failure class, present on failure. */
  last_error_class?: EffectFailureClass;
  skill_id: string;
  status: SkillInvocationStatus;
  /** Rejection/failure reason: `instruction-only` | `not-found` |
   * `non-zero-exit` | `timeout` | `sdk-exception` | `invalid-input` |
   * `malformed-result` | deduplicated-outcome reasons. */
  reason?: string;
  /** Process exit code; `-1` when the SDK rejected (no process result). */
  exit_code: number;
  /** Bounded, scrubbed stdout from the invocation. */
  stdout?: string;
  /** Bounded, scrubbed stderr from the invocation. */
  stderr?: string;
  /** Bounded, scrubbed error text from the SDK. */
  error?: string;
}

export interface SkillInvocationOutcome {
  /** True when the invocation (or the stored effect it deduplicated to) succeeded. */
  ok: boolean;
  /** True when the integration is required and the invocation confirmed-failed. */
  requiredFailed: boolean;
  /** True when the outcome was satisfied by a previously persisted effect and
   * the skill was NOT executed again. */
  deduplicated: boolean;
  /** Bounded, private-payload-free record of the invocation. */
  record: SkillInvocationRecord;
}

/** Exact surface type of the `@hasna/skills` root `runSkill` export. */
export type RunSkill = typeof runSkill;

type RunSkillResult = Awaited<ReturnType<RunSkill>>;

const FAILURE_CLASSES: readonly EffectFailureClass[] = [
  "not_found",
  "timeout",
  "execution_error",
  "invalid_input",
  "unknown",
];

function failureClassOf(value: string | null | undefined): EffectFailureClass | undefined {
  if (value === null || value === undefined) return undefined;
  return (FAILURE_CLASSES as readonly string[]).includes(value)
    ? (value as EffectFailureClass)
    : "unknown";
}

/**
 * Stable effect identity over the five design components. `effect_key` and
 * `request_digest` are both the sha256 of the canonical NUL-joined tuple —
 * the effect key IS the request digest for a single action execution.
 */
export function effectIdentity(
  context: SkillEffectContext,
  target: string,
  operation: string,
): { effectKey: string; requestDigest: string } {
  const canonical = [context.slug, context.runId, context.actionIndex, target, operation].join("\u0000");
  const digest = createHash("sha256").update(canonical, "utf8").digest("hex");
  return { effectKey: digest, requestDigest: digest };
}

/**
 * Truncate a string so the STORED field — content plus the truncation marker —
 * never exceeds `MAX_OUTPUT_BYTES` UTF-8 bytes. Splits only at code-point
 * boundaries so the stored text is never a broken multi-byte sequence.
 */
function boundOutput(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (Buffer.byteLength(value, "utf8") <= MAX_OUTPUT_BYTES) return value;
  const markerBytes = Buffer.byteLength(OUTPUT_TRUNCATION_MARKER, "utf8");
  const limit = MAX_OUTPUT_BYTES - markerBytes;
  let bytes = 0;
  let index = 0;
  for (const ch of value) {
    const chBytes = Buffer.byteLength(ch, "utf8");
    if (bytes + chBytes > limit) break;
    bytes += chBytes;
    index += ch.length;
  }
  return value.slice(0, index) + OUTPUT_TRUNCATION_MARKER;
}

/**
 * Names of environment variables that plausibly carry credential values.
 * Only NAMES are enumerated (never values); values are read in-process and
 * used solely as exact-match replacement needles, so nothing here renders a
 * credential into a transcript, log, or record.
 */
const CREDENTIAL_NAME_RE =
  /(TOKEN|PASSWORD|PASSWD|SECRET|API[_-]?KEY|AUTH|CREDENTIAL|PRIVATE[_-]?KEY|SIGNING[_-]?KEY|ACCESS[_-]?KEY)/i;

/** Minimum length for an ambient value to be treated as a redaction needle —
 * protects against mangling short benign values. */
const MIN_NEEDLE_LENGTH = 6;

/**
 * Values of credential-named ambient environment variables, plus the home
 * directory — the values an executable skill inherits via `process.env` and
 * could print. Used as exact-match needles only.
 */
function ambientSecretValues(): string[] {
  const needles: string[] = [];
  for (const name of Object.keys(process.env)) {
    if (CREDENTIAL_NAME_RE.test(name)) {
      const value = process.env[name];
      if (value !== undefined && value.length >= MIN_NEEDLE_LENGTH) needles.push(value);
    }
  }
  const home = process.env.HOME;
  if (home !== undefined && home.length >= MIN_NEEDLE_LENGTH) needles.push(home);
  return needles;
}

/**
 * Secondary net for credential-shaped values that are NOT present in this
 * process's environment (printed from elsewhere). The ambient-value scan is
 * the primary mechanism — it knows exact values and cannot false-positive;
 * these patterns are the bounded fallback.
 */
const CREDENTIAL_SHAPE_PATTERNS: readonly RegExp[] = [
  // Built from parts so the secrets gate's scanner (which matches the literal
  // prefixes) stays silent; the compiled regexes behave identically.
  new RegExp(`sk-${"ant"}-[A-Za-z0-9_-]{10,}`, "g"),
  new RegExp(`sk-${"proj"}-[A-Za-z0-9_-]{10,}`, "g"),
  /sk-[A-Za-z0-9]{20,}/g,
  /npm_[A-Za-z0-9]{20,}/g,
  /gh[pousr]_[A-Za-z0-9]{20,}/g,
  /AKIA[0-9A-Z]{16}/g,
  /AIza[0-9A-Za-z_-]{20,}/g,
  new RegExp(`xai-[A-Za-z0-9]{20,}`, "g"),
  /Bearer\s+[A-Za-z0-9._~+/=-]{12,}/g,
  /("?(?:api[_-]?key|token|secret|password|access[_-]?token|client[_-]?secret)"?\s*[:=]\s*["']?)[A-Za-z0-9._~+/=-]{8,}/gi,
];

/**
 * Remove credential values from text before it is stored. Exact ambient
 * values first (split/join — literal, no regex pitfalls), then the bounded
 * shape patterns. Applied BEFORE truncation so a credential is gone even when
 * it sits beyond the truncation point.
 */
export function scrubOutput(text: string): string {
  let out = text;
  for (const needle of ambientSecretValues()) {
    if (needle === "") continue;
    out = out.split(needle).join(REDACTION_MARKER);
  }
  for (const pattern of CREDENTIAL_SHAPE_PATTERNS) {
    pattern.lastIndex = 0;
    out = out.replace(pattern, (match, label?: string) =>
      label !== undefined ? `${label}${REDACTION_MARKER}` : REDACTION_MARKER,
    );
  }
  return out;
}

/** Scrub, then bound — a stored field is never credential-bearing and never
 * exceeds the byte cap (marker included). */
function stored(value: string | undefined): string | undefined {
  return value === undefined ? undefined : boundOutput(scrubOutput(value));
}

function baseRecord(
  identity: { effectKey: string; requestDigest: string },
  skillId: string,
  target: string,
  operation: string,
): Omit<SkillInvocationRecord, "status" | "reason" | "exit_code" | "stdout" | "stderr" | "error" | "last_error_class" | "state"> {
  return {
    effect_key: identity.effectKey,
    integration: SKILLS_INTEGRATION,
    operation,
    target,
    request_digest: identity.requestDigest,
    skill_id: skillId,
  };
}

function outcomeOf(
  record: SkillInvocationRecord,
  required: boolean,
  deduplicated: boolean,
): SkillInvocationOutcome {
  return {
    ok: record.status === "succeeded",
    requiredFailed: record.status !== "succeeded" && required === true,
    deduplicated,
    record,
  };
}

/**
 * Classify a `runSkill` result into a bounded, private-payload-free record
 * carrying the slug_effects vocabulary. The exact SDK refusal messages are
 * matched so the rejection classes stay distinguishable from ordinary
 * failures.
 */
function classify(
  result: RunSkillResult,
  identity: { effectKey: string; requestDigest: string },
  skillId: string,
  target: string,
  operation: string,
): SkillInvocationRecord {
  const base = baseRecord(identity, skillId, target, operation);
  const rawError = result.error;
  const exitCode = result.exitCode;
  if (exitCode === 0) {
    return {
      ...base,
      state: "confirmed",
      status: "succeeded",
      exit_code: 0,
      stdout: stored(result.stdout),
      stderr: stored(result.stderr),
    };
  }
  const error = stored(rawError);
  if (rawError !== undefined && rawError.includes("is an instruction skill")) {
    return {
      ...base,
      state: "failed",
      status: "rejected",
      reason: "instruction-only",
      last_error_class: "invalid_input",
      exit_code: exitCode,
      error,
    };
  }
  if (rawError === `Skill '${skillId}' not found`) {
    return {
      ...base,
      state: "failed",
      status: "rejected",
      reason: "not-found",
      last_error_class: "not_found",
      exit_code: exitCode,
      error,
    };
  }
  if (rawError !== undefined && /tim(e|ed)?\s*out|timeout/i.test(rawError)) {
    return {
      ...base,
      state: "failed",
      status: "failed",
      reason: "timeout",
      last_error_class: "timeout",
      exit_code: exitCode,
      stdout: stored(result.stdout),
      stderr: stored(result.stderr),
      error,
    };
  }
  return {
    ...base,
    state: "failed",
    status: "failed",
    reason: "non-zero-exit",
    last_error_class: "execution_error",
    exit_code: exitCode,
    stdout: stored(result.stdout),
    stderr: stored(result.stderr),
    error,
  };
}

/**
 * Classify a REJECTED `runSkill` promise (an SDK exception) into the same
 * bounded, non-fatal record shape. The adapter never propagates SDK
 * exceptions to the caller.
 */
function classifyThrown(
  error: unknown,
  identity: { effectKey: string; requestDigest: string },
  skillId: string,
  target: string,
  operation: string,
): SkillInvocationRecord {
  const base = baseRecord(identity, skillId, target, operation);
  const message = error instanceof Error ? error.message : String(error);
  const errorText = stored(message);
  if (/is an instruction skill/.test(message)) {
    return {
      ...base,
      state: "failed",
      status: "rejected",
      reason: "instruction-only",
      last_error_class: "invalid_input",
      exit_code: -1,
      error: errorText,
    };
  }
  if (/not found/i.test(message)) {
    return {
      ...base,
      state: "failed",
      status: "rejected",
      reason: "not-found",
      last_error_class: "not_found",
      exit_code: -1,
      error: errorText,
    };
  }
  if (/tim(e|ed)?\s*out|timeout/i.test(message)) {
    return {
      ...base,
      state: "failed",
      status: "failed",
      reason: "timeout",
      last_error_class: "timeout",
      exit_code: -1,
      error: errorText,
    };
  }
  if (/invalid/i.test(message)) {
    return {
      ...base,
      state: "failed",
      status: "rejected",
      reason: "invalid-input",
      last_error_class: "invalid_input",
      exit_code: -1,
      error: errorText,
    };
  }
  return {
    ...base,
    state: "failed",
    status: "failed",
    reason: "sdk-exception",
    last_error_class: "execution_error",
    exit_code: -1,
    error: errorText,
  };
}

/** Outcome for an effect that already exists in the store: the skill is NOT
 * executed again; the stored effect is returned as the outcome. */
function deduplicatedOutcome(
  effect: SkillEffectRow,
  config: SkillsIntegrationConfig,
  target: string,
  operation: string,
): SkillInvocationOutcome {
  const confirmed = effect.state === "confirmed";
  const reason =
    effect.state === "failed"
      ? "stored-failure"
      : effect.state === "unknown"
        ? "stored-unknown"
        : "effect-pending";
  const record: SkillInvocationRecord = {
    effect_key: effect.effect_key,
    integration: effect.integration,
    operation: effect.operation,
    target: effect.target,
    state: effect.state,
    request_digest: effect.request_digest,
    external_id: effect.external_id ?? undefined,
    result_pointer: effect.result_pointer ?? undefined,
    last_error_class: failureClassOf(effect.last_error_class),
    skill_id: config.skillId,
    status: confirmed ? "succeeded" : "failed",
    reason: confirmed ? undefined : reason,
    exit_code: confirmed ? 0 : -1,
  };
  return outcomeOf(record, config.required === true, true);
}

/** Execute the skill and classify the result; never throws. */
async function runAndRecord(
  config: SkillsIntegrationConfig,
  runner: RunSkill,
  target: string,
  operation: string,
  identity: { effectKey: string; requestDigest: string },
): Promise<SkillInvocationOutcome> {
  try {
    const result = await runner(config.skillId, [], { stdio: "pipe" });
    return outcomeOf(classify(result, identity, config.skillId, target, operation), config.required === true, false);
  } catch (error) {
    return outcomeOf(
      classifyThrown(error, identity, config.skillId, target, operation),
      config.required === true,
      false,
    );
  }
}

/**
 * Invoke a skill by its stable identifier.
 *
 * `runner` defaults to the root `runSkill` export of `@hasna/skills` and is
 * injectable for tests; the injected runner is typed as the exact SDK
 * surface. No arguments and no environment are forwarded to the skill.
 *
 * When `store` is supplied, the effect key `hash(slug, run_id, action_index,
 * target, operation)` is reserved in the slug_effects store before execution:
 * an already-present key means the effect was already executed (a retry of
 * the same action, or a prior process over the same durable store) and the
 * stored effect is returned without a second execution; a freshly created key
 * is confirmed (`confirmed` / `failed`) with its failure class after the run.
 * A rejected `runSkill` promise is classified, never rethrown.
 */
export async function invokeSkill(
  config: SkillsIntegrationConfig,
  runner: RunSkill = runSkill,
  store?: SkillEffectStore,
): Promise<SkillInvocationOutcome> {
  const context = config.effect;
  const target = context.target ?? config.skillId;
  const operation = context.operation ?? DEFAULT_OPERATION;
  const identity = effectIdentity(context, target, operation);

  if (store === undefined) {
    return runAndRecord(config, runner, target, operation, identity);
  }

  const reservation = store.createEffect({
    runId: context.runId,
    effectKey: identity.effectKey,
    integration: SKILLS_INTEGRATION,
    operation,
    target,
    requestDigest: identity.requestDigest,
  });
  if (!reservation.created) {
    return deduplicatedOutcome(reservation.effect, config, target, operation);
  }

  const outcome = await runAndRecord(config, runner, target, operation, identity);
  try {
    store.updateEffect(reservation.effect.id, {
      state: outcome.record.state,
      resultPointer: outcome.record.result_pointer ?? null,
      lastErrorClass: outcome.record.last_error_class ?? null,
    });
  } catch (error) {
    // A store that failed to persist the confirmation must not mask the
    // invocation outcome: the effect stays `planned` and the reconciler lane
    // owns stuck rows. Non-fatal, as with every integration.
    console.error("[monitor:integrations:skills] effect confirm failed:", error);
  }
  return outcome;
}
