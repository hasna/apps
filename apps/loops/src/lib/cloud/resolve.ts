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
// FAIL-CLOSED DEFAULT (owner ruling 2026-09-04): the client data path NEVER
// silently falls back to the on-box SQLite file when no credential resolves.
// A process with no credential and no explicit selection throws an actionable
// error instead of serving ~/.hasna/loops/loops.db at exit 0. The local file
// connection remains available ONLY as an explicit opt-in:
//   HASNA_LOOPS_CONNECTION=file
// and it announces itself on stderr ("local mode") so an unconfigured run that
// someone expected to be hosted is visible, not silent.
//
// The old `HASNA_LOOPS_CONNECTION=api` value is retired: the hosted connection
// is selected by the shared resolver itself (env, Keychain, credential file),
// and any other value is a hard error naming the valid one.
//
// The connection-switch reading and the resolver's env inputs follow the
// todos pattern (local-opt-in.ts): the opt-in is answered WITHOUT consulting
// the resolver when the ENVIRONMENT configures nothing — so no Keychain item
// and no credential file is read — and a configured environment (any
// authority/credential intent in env) outranks the opt-in and goes through
// the resolver, failing loudly when it is half-configured.

import {
  CREDENTIAL_PROFILE_ENV_KEY,
  clientTransportEnvKeys,
  createClientTransport,
  credentialOverrideEnvKey,
  credentialPointerEnvKey,
} from "@hasna/contracts/client";
import { createHasnaStorageClient } from "@hasna/contracts/client/storage";

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

/** The explicit local opt-in env key; `=file` selects the on-box SQLite store. */
export const LOOPS_CONNECTION_ENV_KEY = "HASNA_LOOPS_CONNECTION";
const FILE_CONNECTION = "file";

export interface CloudStorageOptions {
  /** Tier-1 credential inputs and Keychain-tier controls (an injected runner in tests). */
  credentials?: LoopsCredentialChainOptions;
}

const APP = "loops";

/** Every env name that can configure a loops authority or credential, resolver-derived. */
export function loopsAuthorityEnvKeys(): string[] {
  const keys = clientTransportEnvKeys(APP);
  return [
    ...keys.apiUrlKeys,
    ...keys.apiKeyKeys,
    credentialOverrideEnvKey(APP),
    credentialPointerEnvKey(APP),
    CREDENTIAL_PROFILE_ENV_KEY,
  ];
}

/**
 * Does the ENVIRONMENT itself configure a loops authority or credential?
 *
 * Deliberately env-only: answering it must not touch the Keychain or the
 * filesystem, because doing so would defeat the isolation the opt-in
 * short-circuit exists to provide. A DECLARED-BUT-BLANK variable counts as
 * absent here — blank has always been this package's spelling for "not
 * configured" — but it is NOT absent once we do go hosted: the resolver
 * refuses a declared blank loudly rather than resolving around it.
 */
export function hasLoopsEnvAuthorityIntent(env: Env): boolean {
  return loopsAuthorityEnvKeys().some((key) => (env[key] ?? "").trim() !== "");
}

/** True when the operator spelled the explicit local opt-in (`=file`). */
export function isLoopsFileOptIn(env: Env): boolean {
  return (env[LOOPS_CONNECTION_ENV_KEY] ?? "").trim() === FILE_CONNECTION;
}

/** True when this environment should be served by the on-box SQLite store. */
export function selectsLoopsLocalStore(env: Env): boolean {
  return !hasLoopsEnvAuthorityIntent(env) && isLoopsFileOptIn(env);
}

/**
 * The connection switch accepts exactly one value now: the explicit local
 * opt-in `file`. The retired `api` raster was the app's own selection logic;
 * the shared resolver selects the hosted connection.
 */
function assertConnectionSwitchValue(env: Env): void {
  const raw = env[LOOPS_CONNECTION_ENV_KEY];
  if (raw === undefined) return;
  const value = raw.trim();
  if (value === "" || value === FILE_CONNECTION) return;
  if (value === "api") {
    throw new Error(
      `${LOOPS_CONNECTION_ENV_KEY}=api is retired: the shared credential resolver selects the hosted loops API ` +
        `(${clientTransportEnvKeys(APP).apiUrlKeys[0]} + ${clientTransportEnvKeys(APP).apiKeyKeys[0]}, the macOS Keychain ` +
        `item hasna.credentials.${APP}.api-key, or ~/.hasna/${APP}/config/credentials). ` +
        `Unset ${LOOPS_CONNECTION_ENV_KEY}, or set it to 'file' for the explicit local connection.`,
    );
  }
  throw new Error(`${LOOPS_CONNECTION_ENV_KEY} must be 'file'; got "${value}".`);
}

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
 * (actionable, names the env keys and the explicit local opt-in, never a
 * credential value); every other refusal keeps the resolver's own message,
 * which already names the tier it consulted.
 */
function translateResolverFailure(error: unknown): never {
  const message = error instanceof Error ? error.message : String(error);
  const keys = clientTransportEnvKeys(APP);
  const urlKey = keys.apiUrlKeys[0];
  const keyKey = keys.apiKeyKeys[0];
  if (/no API key could be resolved/.test(message)) {
    if (/is not set and no API key could be resolved/.test(message)) {
      throw new Error(
        `no loops client connection is configured: set ${urlKey} and ${keyKey} to connect to the hosted loops API ` +
          `(or store the key in the macOS Keychain item hasna.credentials.${APP}.api-key or ~/.hasna/${APP}/config/credentials), ` +
          `or set ${LOOPS_CONNECTION_ENV_KEY}=file to explicitly use this machine's local file store. ${message}`,
        { cause: error },
      );
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
 * on-box file store.
 *
 * Local mode is legitimate for loops (a persistent local loop runner), but it
 * is still announced: "no credential resolved" and "deliberately offline"
 * look identical in the output otherwise, and the first one is usually a
 * misconfiguration the operator wants to hear about.
 */
export function noticeLocalLoopsMode(write: (line: string) => void = (line) => console.error(line)): void {
  if (localNoticePrinted) return;
  localNoticePrinted = true;
  write(
    `loops: local mode — ${LOOPS_CONNECTION_ENV_KEY}=file selected this machine's local file store ` +
      `(no ${clientTransportEnvKeys(APP).apiUrlKeys[0]} / ${clientTransportEnvKeys(APP).apiKeyKeys[0]} resolved, ` +
      `and no macOS Keychain item or credential file holds a loops key).`,
  );
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
  assertConnectionSwitchValue(env);
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