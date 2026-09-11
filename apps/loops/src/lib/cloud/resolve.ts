// App-level cloud storage resolver — the ONE place the loops client decides
// whether it talks to the hosted `/v1` API or to the explicitly selected
// on-box SQLite file.
//
// Everything here delegates to the shared client seam in `@hasna/contracts/client`
// (owner ruling 2026-09-04, hasna/apps#1720). This package owns no second copy
// of the credential ladder and no alias env names of its own: the shared
// resolver reads `HASNA_LOOPS_API_URL` / `HASNA_LOOPS_API_KEY` (and the
// documented unprefixed aliases one rung below), then the macOS Keychain items
// `hasna.credentials.loops.api-key` / `.api-url` (account `HASNA_STATION`, else
// `hostname -s`, else `USER`), then the credential file
// `~/.hasna/loops/config/credentials` (`HASNA_HOME` / `HASNA_CONFIG_HOME`
// relocate it; XDG is never consulted), and defaults to the fleet gateway
// `https://api.hasna.com/loops` once a credential has resolved from any tier.
//
// FAIL-CLOSED DEFAULT (owner rulings 2026-09-04 and 2026-09-07): the client
// data path NEVER silently falls back to the on-box SQLite file when no
// credential resolves. A process with no credential and no explicit selection
// throws an actionable error instead of serving ~/.hasna/loops/loops.db at
// exit 0. The local store remains available ONLY through the standard boolean
// opt-in:
//   HASNA_LOOPS_LOCAL=1   (alias LOOPS_LOCAL=1)
// answered from the environment BEFORE any Keychain or disk read, honoured
// only when the environment configures no loops authority (a configured
// environment outranks the flag), and announced once on stderr
// ("loops: LOCAL mode") so an unconfigured run that someone expected to be
// hosted is visible, not silent.
//
// The former value-based selector `HASNA_LOOPS_CONNECTION` (`=file`, and the
// earlier-retired `=api`) is RETIRED: it is read only to refuse it loudly with
// the migration hint (see ../local-opt-in.ts) and never selects a store.

import {
  clientTransportEnvKeys,
  createClientTransport,
} from "@hasna/contracts/client";
import { createHasnaStorageClient } from "@hasna/contracts/client/storage";
import {
  assertNoRetiredLoopsConnectionSwitch,
  hasLoopsEnvAuthorityIntent,
  loopsAuthorityEnvKeys,
  loopsLocalModeNotice,
  loopsNoConnectionRefusal,
  selectsLoopsLocalStore,
} from "../local-opt-in.js";

// The opt-in preamble is owned by ../local-opt-in.ts; re-exported here so the
// surfaces that already import the routing helpers from the resolver keep one
// import path.
export {
  LOOPS_LOCAL_OPT_IN_ENV_KEYS,
  RETIRED_LOOPS_CONNECTION_ENV_KEY,
  assertNoRetiredLoopsConnectionSwitch,
  hasLoopsEnvAuthorityIntent,
  hasRetiredLoopsConnectionSwitch,
  isLoopsLocalOptIn,
  loopsAuthorityEnvKeys,
  selectsLoopsLocalStore,
} from "../local-opt-in.js";

// TYPE BOUNDARY (hasna/apps#1782): the published .d.ts must never import
// @hasna/contracts, so every contracts type that crosses this module's own
// exported signatures is spelled structurally below. The shapes are the shared
// seam's own, in both directions: `LoopsCredentialChainOptions` is accepted
// where `CredentialChainOptions` is (the real resolver), and
// `createHasnaStorageClient`'s result satisfies `LoopsStorageClient`.

/** One `/usr/bin/security` invocation result; the Keychain runner's return shape. */
export interface LoopsKeychainCommandResult {
  /** Exit status; null when the tool could not be started or was killed. */
  status: number | null;
  stdout: string;
  stderr: string;
}

/** Tier-1 credential inputs and Keychain-tier controls (an injected runner in tests). */
export interface LoopsKeychainTierOptions {
  /** Whether the Keychain tier runs for a caller-built env (default: ambient only). */
  enabled?: boolean;
  /** Defaults to `process.platform`; the tier exists only on `"darwin"`. */
  platform?: string;
  /** The machine's host name, used as the account when `HASNA_STATION` is unset. */
  hostname?: () => string;
  /** The `security` runner; defaults to spawning `/usr/bin/security` by argv. */
  run?: (argv: readonly string[]) => LoopsKeychainCommandResult;
}

/** The credential-chain options the shared resolver applies, spelled locally. */
export interface LoopsCredentialChainOptions {
  /** Tier 1: an explicit key, e.g. from `--api-key`. */
  apiKey?: string;
  /** Tier 1: an explicit profile name, e.g. from `--profile`. Beats `HASNA_PROFILE`. */
  profile?: string;
  /** Tier 3: Keychain controls — an injected runner in tests. */
  keychain?: LoopsKeychainTierOptions;
}

/** The shared storage client's surface, spelled structurally for the published boundary. */
export interface LoopsStorageClient {
  readonly baseUrl: string;
  readonly transport: {
    readonly baseUrl: string;
    get<T = unknown>(path: string, options?: Record<string, unknown>): Promise<T>;
    post<T = unknown>(path: string, body?: unknown, options?: Record<string, unknown>): Promise<T>;
    patch<T = unknown>(path: string, body?: unknown, options?: Record<string, unknown>): Promise<T>;
    put<T = unknown>(path: string, body?: unknown, options?: Record<string, unknown>): Promise<T>;
    request<T = unknown>(method: string, path: string, body?: unknown, options?: Record<string, unknown>): Promise<T>;
  };
}

export type CloudStorageResolution =
  | { transport: "file"; client: null }
  | { transport: "api"; client: LoopsStorageClient; baseUrl: string };

export type Env = Record<string, string | undefined>;

export interface CloudStorageOptions {
  /** Tier-1 credential inputs and Keychain-tier controls (an injected runner in tests). */
  credentials?: LoopsCredentialChainOptions;
}

const APP = "loops";

/**
 * @hasna/contracts marks the LIVE process environment with this symbol so its
 * ambient tiers — the macOS Keychain items, which belong to the machine rather
 * than to any env object — know they were handed the real environment and not
 * a caller-built one (hasna/apps#1788).
 */
const CONTRACTS_AMBIENT_ENVIRONMENT = Symbol.for("hasna:contracts:ambientClientEnvironment");

/** The same ambient test @hasna/contracts performs, run BEFORE any normalisation. */
export function isAmbientLoopsEnv(env: Env): boolean {
  if (typeof process !== "undefined" && (env as unknown) === (process.env as unknown)) return true;
  return (env as unknown as Record<symbol, unknown>)[CONTRACTS_AMBIENT_ENVIRONMENT] === true;
}

/**
 * The environment as the resolver should see it: every authority/credential
 * variable that is DECLARED BUT BLANK removed.
 *
 * A blank has always been this package's spelling for "not configured" — it is
 * how the CLI test harnesses and fail-closed fixtures scrub an inherited
 * environment. @hasna/contracts takes the opposite and, for its purposes,
 * correct view: a declared-but-blank credential is a misconfiguration it
 * refuses loudly rather than resolving around. Both are right at their own
 * layer. Normalising here keeps "blank means unset" true at the loops seam
 * while leaving the resolver's stricter rule intact for everything it does
 * receive: a value that is present is still policed, and two aliases that
 * actually disagree still refuse.
 */
export function loopsResolverEnv<T extends Env>(env: T): T {
  const blanks = loopsAuthorityEnvKeys().filter((key) => key in env && (env[key] ?? "").trim() === "");
  if (blanks.length === 0) return env;
  const next = { ...env } as T;
  for (const key of blanks) delete next[key];
  return next;
}

/** The env object and credential options a loops surface hands @hasna/contracts. */
export interface LoopsResolverInputs<T extends Env> {
  /** The environment with every declared-but-blank authority variable removed. */
  env: T;
  /** The chain options, with the Keychain tier's ambient gate already decided. */
  credentials: LoopsCredentialChainOptions;
}

/**
 * Build the resolver's inputs: the normalised environment AND the credential
 * options that keep the machine's Keychain tier reachable across it.
 *
 * WHY THIS IS NOT JUST {@link loopsResolverEnv}: blanking a variable and
 * deleting it are not the same operation to @hasna/contracts, because dropping
 * a key forces us to hand the resolver a COPY, and the resolver gates its
 * ambient tiers on OBJECT IDENTITY (`env === process.env`, or the registry
 * symbol its own snapshot carries). A copy is, by that test, a caller-built
 * world — the hermetic seam — so the Keychain is outside it and the tier turns
 * itself off. Silently. On a station whose Keychain holds
 * `hasna.credentials.loops.api-key`, ONE declared-but-blank authority variable
 * would drop the run from the Keychain identity to whatever came next. The
 * gate is therefore decided HERE, on the original env, and carried across the
 * copy as the documented `keychain.enabled` control rather than being left to
 * an identity test the copy cannot pass. An explicit `enabled` from the caller
 * still wins, and an injected `run` is left alone.
 */
export function loopsResolverInputs<T extends Env>(env: T, credentials: LoopsCredentialChainOptions = {}): LoopsResolverInputs<T> {
  const normalised = loopsResolverEnv(env);
  if (normalised === env) return { env: normalised, credentials };
  const keychain = { ...credentials.keychain };
  if (keychain.enabled === undefined && keychain.run === undefined) {
    keychain.enabled = isAmbientLoopsEnv(env);
  }
  return { env: normalised, credentials: { ...credentials, keychain } };
}

/**
 * Translate a `@hasna/contracts` resolution refusal into this package's
 * fail-closed diagnostic. The no-credential refusal keeps the classic message
 * (actionable, names the tiers consulted and the explicit local opt-in, never a
 * credential value); every other refusal keeps the resolver's own message,
 * which already names the tier it consulted. A Keychain read ERROR (as opposed
 * to an absent item) is such a refusal: it is terminal, never "absent".
 */
function translateResolverFailure(error: unknown): never {
  const message = error instanceof Error ? error.message : String(error);
  const keys = clientTransportEnvKeys(APP);
  const urlKey = keys.apiUrlKeys[0];
  const keyKey = keys.apiKeyKeys[0];
  if (/no API key could be resolved/.test(message)) {
    if (/is not set and no API key could be resolved/.test(message)) {
      throw new Error(loopsNoConnectionRefusal(message), { cause: error });
    }
    throw new Error(
      `${urlKey} is set but no API key could be resolved for '${APP}': an API connection requires both ${urlKey} and ${keyKey} ` +
        `(or a Keychain item / credential file). ${message}`,
      { cause: error },
    );
  }
  throw new Error(message, { cause: error });
}

let localNoticePrinted = false;

/**
 * Say — once per process, on stderr — that this install is running against the
 * on-box SQLite store.
 *
 * Local mode is legitimate for loops (a persistent local loop runner), but it
 * is still announced: "no credential resolved" and "deliberately offline"
 * look identical in the output otherwise, and the first one is usually a
 * misconfiguration the operator wants to hear about.
 */
export function noticeLocalLoopsMode(write: (line: string) => void = (line) => console.error(line)): void {
  if (localNoticePrinted) return;
  localNoticePrinted = true;
  write(loopsLocalModeNotice());
}

/** Test seam: forget that the local-mode line was printed. */
export function resetLocalLoopsModeNotice(): void {
  localNoticePrinted = false;
}

/**
 * Resolve whether `name`'s data lives behind the hosted `/v1` API or in the
 * explicitly selected local store for the current environment.
 *
 * The hosted decision comes from `@hasna/contracts` 1.0.2's shared resolver,
 * fresh on every call: the CLI, the MCP server and the SDK all go through
 * here, so a key rotation on a machine heals without a restart, and a station
 * needs no inline env prefix at all. Never returns partially-built remote
 * state and never exposes the API key. Throws when hosted is implied but no
 * credential resolves — the client never falls back to the on-box file.
 */
export function resolveCloudStorage(name: string, env: Env = process.env, options: CloudStorageOptions = {}): CloudStorageResolution {
  assertNoRetiredLoopsConnectionSwitch(env);
  if (selectsLoopsLocalStore(env)) {
    if (env === process.env) noticeLocalLoopsMode();
    return { transport: "file", client: null };
  }
  const inputs = loopsResolverInputs(env, options.credentials);
  try {
    const wired = createClientTransport(name, inputs.env, { credentials: inputs.credentials });
    return {
      transport: "api",
      client: createHasnaStorageClient(name, wired.client),
      baseUrl: wired.resolution.baseUrl,
    };
  } catch (error) {
    translateResolverFailure(error);
  }
}

/**
 * Throw when the client connection for `name` is not explicitly configured:
 * neither a hosted credential nor the explicit local opt-in. Used by the
 * surfaces that must not silently report a file connection no data command
 * would use.
 */
export function requireConfiguredConnection(name: string, env: Env = process.env, options: CloudStorageOptions = {}): void {
  resolveCloudStorage(name, env, options);
}
