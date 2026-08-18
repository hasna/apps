/**
 * Hooks native adapter (design §4, MON-V2-11).
 *
 * Uses exactly one package-owned surface: the root `runHook` export of
 * `@hasna/hooks`. No event bus, no HTTP path, no MCP path — the adapter
 * invokes the named hook through the SDK and nothing else.
 *
 * Outcome classification (measured from the SDK source):
 * - zero exit                       -> confirmed
 * - non-zero exit                   -> failed / execution_error
 * - "Hook 'x' not found" / script
 *   not found                       -> failed / not_found
 * - trust-check rejection           -> failed / invalid_input
 * - HookTimeoutError (name signal)  -> unknown / timeout (ambiguous; reconcile
 *                                      before retry per design §6)
 * - any other throw                 -> unknown / unknown
 *
 * Every invocation persists one effect record (event receipt + failure
 * classification) under the stable effect key.
 */
import { runHook, type HookInput, type RunHookOptions, type RunHookResult } from "@hasna/hooks";
import type { EffectOutcome, EffectRecord, EffectRequest, IntegrationName } from "./adapter.js";
import { digestOf, effectKey, type EffectStore } from "./effects.js";

/** The exact SDK function signature, also the injected-runner contract. */
export type RunHookFn = typeof runHook;

/** Slug-level integration configuration (design §4). */
export interface HooksAdapterConfig {
  hookId: string;
}

export interface HooksAdapterOptions {
  /** Effect store the adapter persists receipts and classifications into. */
  store: EffectStore;
  /** Injectable runner; defaults to the real SDK runHook. */
  runner?: RunHookFn;
  /** Timeout in ms forwarded to runHook; non-positive values are ignored. */
  timeoutMs?: number;
}

const MAX_ERROR_DETAIL = 500; // mirrors the SDK's own recordHookRun bound

export function classifyHookResult(result: RunHookResult): EffectOutcome {
  if (result.exitCode !== 0) {
    return {
      state: "failed",
      lastErrorClass: "execution_error",
      errorDetail: (result.stderr || `hook exited with code ${result.exitCode}`).slice(0, MAX_ERROR_DETAIL),
      resultPointer: digestOf(result),
    };
  }
  return { state: "confirmed", externalId: null, resultPointer: digestOf(result), lastErrorClass: null };
}

export function classifyHookError(err: unknown): EffectOutcome {
  const message = err instanceof Error ? err.message : String(err);
  const isTimeout = err instanceof Error && err.name === "HookTimeoutError";
  if (isTimeout) {
    return { state: "unknown", lastErrorClass: "timeout", errorDetail: message.slice(0, MAX_ERROR_DETAIL) };
  }
  if (/Hook '[^']+' not found|Hook script not found/.test(message)) {
    return { state: "failed", lastErrorClass: "not_found", errorDetail: message.slice(0, MAX_ERROR_DETAIL) };
  }
  if (/script changed since it was trusted/.test(message)) {
    return { state: "failed", lastErrorClass: "invalid_input", errorDetail: message.slice(0, MAX_ERROR_DETAIL) };
  }
  return { state: "unknown", lastErrorClass: "unknown", errorDetail: message.slice(0, MAX_ERROR_DETAIL) };
}

export class HooksAdapter {
  readonly name: IntegrationName = "hooks";
  private readonly runner: RunHookFn;
  private readonly timeoutMs?: number;

  constructor(private readonly options: HooksAdapterOptions) {
    this.runner = options.runner ?? runHook;
    this.timeoutMs = options.timeoutMs;
  }

  /**
   * Invoke a named hook through the exact runHook SDK surface and persist the
   * event receipt and failure classification under the stable effect key.
   */
  async invoke(req: EffectRequest, config: HooksAdapterConfig, payload: Record<string, unknown>): Promise<EffectOutcome> {
    const input: HookInput = { ...payload };
    const runOptions: RunHookOptions =
      this.timeoutMs !== undefined && this.timeoutMs > 0 ? { timeout: this.timeoutMs } : {};
    const requestDigest = digestOf({ hookId: config.hookId, input, options: runOptions });

    let outcome: EffectOutcome;
    try {
      outcome = classifyHookResult(await this.runner(config.hookId, input, runOptions));
    } catch (err) {
      outcome = classifyHookError(err);
    }

    const now = new Date().toISOString();
    const record: EffectRecord = {
      effectKey: effectKey(req),
      integration: this.name,
      operation: req.operation,
      target: req.target,
      state: outcome.state,
      requestDigest,
      externalId: outcome.externalId ?? null,
      resultPointer: outcome.resultPointer ?? null,
      lastErrorClass: outcome.lastErrorClass ?? null,
      createdAt: now,
      updatedAt: now,
    };
    await this.options.store.record(record);
    return outcome;
  }
}

export function createHooksAdapter(options: HooksAdapterOptions): HooksAdapter {
  return new HooksAdapter(options);
}
