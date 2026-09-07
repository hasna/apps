// ============================================================================
// Authenticated HTTPS client transport (self-hosted cloud, NO DSN on clients).
//
// Mission constraint (project CLAUDE.md, NON-NEGOTIABLE): fleet clients must
// reach the self-hosted cloud store over HTTPS with a bearer API key —
// `Authorization: Bearer <key>` against the resolved /v1 authority. The raw
// RDS DSN is NEVER distributed to client machines. This module is the
// sanctioned client transport: it turns the core memory operations
// (create/get/list/update/delete/search) into authed HTTP calls against the
// cloud server, which runs the exact same domain logic against cloud Postgres.
//
// CREDENTIALS ARE NOT RESOLVED HERE ANY MORE. Since the 2026-09-04 adoption
// ruling (hasna/apps#1720) every hosted Hasna CLI resolves its credential and
// its service authority through the ONE resolver in `@hasna/contracts/client`,
// so this module contributes no tier of its own. The chain, resolved fresh on
// every request:
//
//   1. an explicit argument      — `credentials.apiKey` / `credentials.profile`
//   2. a deliberate env pointer  — `HASNA_MEMENTOS_API_KEY_OVERRIDE`,
//                                  `HASNA_PROFILE`, `HASNA_MEMENTOS_API_KEY_REF`
//   3. the macOS Keychain        — generic-password `hasna.credentials.mementos.api-key`,
//                                  account `HASNA_STATION` → `hostname -s` → `USER`
//   4. disk                      — `~/.hasna/mementos/config/credentials`,
//                                  owner-only 0400/0600 (`HASNA_HOME` /
//                                  `HASNA_CONFIG_HOME` move the root)
//   5. `HASNA_MEMENTOS_API_KEY`  — a legitimate tier below disk, no deprecation
//                                  notice
//
// and the authority follows `HASNA_MEMENTOS_API_URL`, the Keychain `api-url`
// item, the credentials file, and finally defaults to the fleet gateway
// `https://api.hasna.com/mementos` (the client appends `/v1`). The legacy
// unprefixed `MEMENTOS_*` spellings survive only as the resolver's silent
// alias fallback for one release; every message here names the canonical
// `HASNA_MEMENTOS_*` names.
//
// Retired locations — `~/.hasna/fleet-env/`, `~/.hasna/cloud/`,
// `~/.config/hasna/` and `$XDG_CONFIG_HOME` — are inputs nowhere, and no
// `*_MODE` / `*_STORAGE_MODE` variable is read: the transport is decided by
// what RESOLVES, never by a mode word (the storage-mode ratchet that used to
// turn those variables into errors was removed with the adoption; the
// variables are inert, and the test harnesses delete them so no fixture can
// depend on a stale fragment).
//
// Activation is fail-safe and reversible:
//   - API mode is ON when the resolver finds a credential (and the authority
//     with it — the fleet gateway when nothing configures a URL).
//   - API mode is OFF when the operator deliberately selected the on-box
//     store: `HASNA_MEMENTOS_DB_PATH` / `MEMENTOS_DB_PATH` (an explicit file,
//     precedence 1) or `HASNA_MEMENTOS_LOCAL=1` (alias `MEMENTOS_LOCAL=1`),
//     answered WITHOUT the resolver so no Keychain item or credential file is
//     read for a local run.
//   - A client DSN (`HASNA_MEMENTOS_DATABASE_URL`) still disables API mode: a
//     DSN on a client is forbidden, and the two transports never mix.
//   - A half configuration is an ERROR, never a fall-back: an API URL with no
//     resolvable credential is refused, never silently downgraded to the
//     on-box store. (Until 2026-07-30 this silently resolved to local SQLite,
//     and that fall-back was documented as intended — the defect: an operator
//     whose API key failed to load got a different, usually stale, dataset
//     with no error and no flag.)
//
// FAIL CLOSED (owner ruling 2026-09-04). Hosted with no credential anywhere —
// no env key, no Keychain item, no credentials file — exits non-zero with one
// clear line naming every tier consulted; there is no SQLite fallback and no
// `*-local-fallback` event. The on-box SQLite store is reachable ONLY through
// the deliberate opt-ins listed above (see `assertClientStoreConfigured`).
//
// Transport: a synchronous HTTP request via `Bun.spawnSync(["curl", …])`. The
// domain functions in this codebase are synchronous, so the client transport
// must be too. curl is spawned DIRECTLY (no `bash -c`), and the bearer key is
// fed to curl on stdin via `-H @-` (curl reads one header line per stdin line).
// The key therefore never appears in argv (`ps`/`/proc/<pid>/cmdline`) nor in
// the child's environment, and is never logged. The request body, when present,
// is written to a private 0600 temp file passed as `--data-binary @<file>` and
// removed immediately after the call, so it never touches argv either.
// ============================================================================

import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeFileSync, unlinkSync } from "node:fs";
import { randomUUID } from "node:crypto";
import {
  clientTransportEnvKeys,
  resolveClientTransport,
  resolveCredential,
  toV1BaseUrl,
  ClientTransportConfigurationError,
  type ClientTransportResolution,
  type ResolvedCredential,
} from "@hasna/contracts/client";
import {
  MEMENTOS_DB_PATH_ENV_KEYS,
  MEMENTOS_LOCAL_OPT_IN_ENV_KEYS,
  hasExplicitLocalDbPath,
  mementosResolverInputs,
  selectsMementosLocalStore,
} from "../lib/local-opt-in.js";

export interface ApiConfig {
  baseUrl: string; // normalized, includes the /v1 prefix, no trailing slash
  apiKey: string;
}

/** Tier-1 credential inputs (explicit key/profile, keychain runner for tests). */
export interface MementosClientResolveOptions {
  credentials?: import("@hasna/contracts/client").CredentialChainOptions;
}

/** The env keys that select the API transport, resolver-derived, canonical first. */
export const API_URL_ENV_KEYS: readonly [string, string] = clientTransportEnvKeys("mementos")
  .apiUrlKeys as [string, string];
export const API_KEY_ENV_KEYS: readonly [string, string] = clientTransportEnvKeys("mementos")
  .apiKeyKeys as [string, string];

/** The env keys that select the server postgresql backend (and disable client API mode). */
export const DATABASE_URL_ENV_KEYS = ["HASNA_MEMENTOS_DATABASE_URL", "MEMENTOS_DATABASE_URL"] as const;

/** The explicit local SQLite path — the precedence-1 local opt-in. */
export const DB_PATH_ENV_KEYS = MEMENTOS_DB_PATH_ENV_KEYS;

type Env = Record<string, string | undefined>;

function firstEnv(keys: readonly string[], env: Env = process.env): string | undefined {
  for (const k of keys) {
    const v = env[k]?.trim();
    if (v) return v;
  }
  return undefined;
}

/** The env key that supplied a value, or `null`. Never returns the value. */
function firstEnvKey(keys: readonly string[], env: Env = process.env): string | null {
  for (const k of keys) {
    if (env[k]?.trim()) return k;
  }
  return null;
}

function hasDatabaseUrl(env: Env = process.env): boolean {
  return Boolean(firstEnv(DATABASE_URL_ENV_KEYS, env));
}

/**
 * Which env keys currently select API mode, by name only — never the values.
 * Used by the operator-facing mode report so a human can see *why* the client
 * is pointed at the cloud without reading source or echoing a credential. The
 * API key is read from the resolver's own key list, so a tier that moves
 * cannot drift out of this report.
 */
export function getApiModeEnvSources(env: Env = process.env): {
  urlKey: string | null;
  keyKey: string | null;
  databaseUrlKey: string | null;
} {
  return {
    urlKey: firstEnvKey(API_URL_ENV_KEYS, env),
    keyKey: firstEnvKey(API_KEY_ENV_KEYS, env),
    databaseUrlKey: firstEnvKey(DATABASE_URL_ENV_KEYS, env),
  };
}

/**
 * The shared resolver closes the userinfo/query/fragment classes, but its URL
 * parser reports a BARE trailing `?` or `#` as an empty search/hash — the
 * exact hasna/apps#1601 concatenation defect class
 * (`…/mementos/v1?/memories`). The raw text is what the route is built from,
 * so the resolved authority is checked for the delimiters here too.
 */
function assertCleanResolvedBase(baseUrl: string): string {
  if (/[?#]/.test(baseUrl)) {
    throw new Error("mementos base URL must not contain userinfo, query, or fragment data");
  }
  return baseUrl;
}

/**
 * What the environment CONFIGURES, regardless of which store finally wins.
 *
 * Distinct from {@link getApiConfig}, which answers "may I build a cloud
 * request?" and returns null once an explicit DB_PATH outranks the credentials
 * (precedence 1). An operator report needs both halves separately: conflating
 * them prints "no API key configured" at someone whose key is configured and
 * merely outranked, which points them at a credential problem they do not have.
 *
 * Never returns a credential value — the endpoint is not secret, the key is
 * reported only as a boolean. `apiKeyPresent` is answered through the resolver
 * chain (any tier: env, Keychain, credentials file), because the Keychain and
 * disk tiers are ambient and an env-only read would report "absent" on the
 * very stations the resolver serves most.
 *
 * A malformed configured base THROWS (fail closed: a misconfigured endpoint
 * must fail closed, exactly like a half-configured credential pair does), with
 * the resolver's own message and never the raw value.
 */
export function getConfiguredApiEnv(env: Env = process.env): {
  baseUrl: string | null;
  apiKeyPresent: boolean;
  dbPathKey: string | null;
} {
  const rawBase = firstEnv(API_URL_ENV_KEYS, env);
  let baseUrl: string | null = null;
  if (rawBase) {
    const normalized = toV1BaseUrl(rawBase);
    assertCleanResolvedBase(normalized);
    baseUrl = normalized;
  }
  return {
    baseUrl,
    apiKeyPresent: resolveCredential("mementos", env, mementosResolverInputs(env).credentials) !== null,
    dbPathKey: firstEnvKey(DB_PATH_ENV_KEYS, env),
  };
}

/**
 * Escape hatch for a test that genuinely must reach a non-loopback endpoint.
 * Opt-in by design: the default has to be safe, because the failure it prevents
 * is silent and lands in a shared store.
 */
export const ALLOW_REMOTE_API_IN_TESTS_ENV = "MEMENTOS_ALLOW_REMOTE_API_IN_TESTS";

/** Hosts that cannot be anything but this machine. */
function isLoopbackHost(rawHost: string): boolean {
  const host = rawHost.replace(/^\[/, "").replace(/\]$/, "").toLowerCase();
  return host === "localhost" || host === "::1" || /^127\./.test(host);
}

/**
 * Refuse an outbound cloud request from a test process unless it is loopback.
 *
 * The `bun test` preload clears the store selectors ONCE at process start. That
 * leaves two measured gaps, both of which end in a request from a test process
 * to the shared production store:
 *
 *   - a test file that sets a selector at MODULE SCOPE re-arms API mode after
 *     the preload has already run and finished; and
 *   - `bunfig.toml` is resolved from the cwd and bun does not walk up, so
 *     `cd src/db && bun test <file>` runs with no preload at all.
 *
 * Neither is visible to a process-start check or to a static repo sweep, so the
 * check belongs here — at the one point every cloud read and write funnels
 * through, evaluated when the request is actually made. Loopback stays allowed
 * so the suites that drive a local stub server are unaffected.
 */
function assertRequestAllowedUnderTest(baseUrl: string): void {
  if (process.env["NODE_ENV"] !== "test") return;
  if (process.env[ALLOW_REMOTE_API_IN_TESTS_ENV]?.trim()) return;

  let host: string;
  try {
    host = new URL(baseUrl).hostname;
  } catch {
    host = "";
  }
  if (host && isLoopbackHost(host)) return;

  throw new Error(
    "api-mode: REFUSING to make a cloud request from a test process — this would write to or read " +
      "from the SHARED PRODUCTION memory store, where test fixtures are indistinguishable from real " +
      "memories.\n" +
      `  host           : ${host || "(unparseable base URL)"}\n` +
      "  how this happens: a selector set at module scope (after the bun test preload ran), or `bun test` " +
      "invoked from a directory with no bunfig.toml so the preload never loaded.\n" +
      "  fix            : build the child/process env via src/test-support/store-isolation.ts, or point the " +
      "suite at a loopback stub.\n" +
      `  override       : set ${ALLOW_REMOTE_API_IN_TESTS_ENV}=1 only for a test that must reach a remote endpoint.`,
  );
}

/** Raised when the environment does not unambiguously select one store. */
export class MementosStoreConfigError extends Error {
  readonly code = "MEMENTOS_STORE_CONFIG";
  constructor(message: string) {
    super(message);
    this.name = "MementosStoreConfigError";
  }
}

/**
 * Wrap every @hasna/contracts refusal in the client's own store-config error,
 * carrying the resolver's message (which names every tier it consulted — and
 * never a credential value) behind the stable `MEMENTOS_STORE_CONFIG` code
 * callers match on. The opt-in hint is appended so every refusal names the way
 * into the on-box store.
 */
function toStoreConfigError(error: unknown): MementosStoreConfigError {
  const message = error instanceof Error ? error.message : String(error);
  return new MementosStoreConfigError(
    `${message} Local SQLite is opt-in only (${DB_PATH_ENV_KEYS[0]}, or ${MEMENTOS_LOCAL_OPT_IN_ENV_KEYS[0]} = 1) and is disabled by default — failing closed`,
  );
}

/**
 * Resolve the API client configuration through the @hasna/contracts chain, or
 * return `null` when the environment selects the on-box store or configures
 * nothing at all.
 *
 * EVERY CALL RESOLVES FRESH: the Keychain and the credentials file are
 * re-read per request, so a key rotation heals a long-lived shell or MCP
 * server without a restart. Deliberately a single pass down the chain (one
 * credential resolution, once), with the resolved value handed back to the
 * transport as its tier-1 argument so the authority pass never re-reads the
 * tiers — and so the key that validated the authority is the key the request
 * sends (no TOCTOU between two reads).
 *
 * Refusals — a URL without a credential, blank or disagreeing aliases, an
 * unusable credential file, an invalid authority — THROW as
 * {@link MementosStoreConfigError}. Only "nothing configured anywhere" (no
 * env pointer, no Keychain item, no credentials file) returns null, and the
 * fail-closed gate {@link assertClientStoreConfigured} refuses THAT at every
 * store entry point: a null here is never permission to open the on-box
 * default file.
 */
export function getApiConfig(
  env: Env = process.env,
  options: MementosClientResolveOptions = {},
): ApiConfig | null {
  if (hasDatabaseUrl(env)) return null; // a client DSN disables API mode (unchanged)
  if (selectsMementosLocalStore(env)) return null; // explicit local opt-in, answered WITHOUT the resolver

  const inputs = mementosResolverInputs(env, options.credentials);
  let credential: ResolvedCredential | null;
  try {
    credential = resolveCredential("mementos", inputs.env, inputs.credentials);
  } catch (error) {
    throw toStoreConfigError(error);
  }

  let resolution: ClientTransportResolution;
  try {
    resolution = resolveClientTransport("mementos", inputs.env, {
      credentials: credential ? { ...inputs.credentials, apiKey: credential.apiKey } : inputs.credentials,
    });
  } catch (error) {
    if (
      error instanceof ClientTransportConfigurationError &&
      credential === null &&
      /is not set and no API key could be resolved/.test(error.message)
    ) {
      // Genuinely nothing configured anywhere: no URL, no key, no Keychain
      // item, no credentials file. The fail-closed gate owns this refusal.
      return null;
    }
    throw toStoreConfigError(error);
  }

  return { baseUrl: assertCleanResolvedBase(resolution.baseUrl), apiKey: credential!.apiKey };
}

/**
 * True when the client should route memory operations to the cloud API.
 * Fail-closed against a client-side DSN: if DATABASE_URL is present, API mode
 * refuses to engage so the two transports never mix.
 */
export function isApiMode(): boolean {
  if (hasDatabaseUrl()) return false;
  return getApiConfig() !== null;
}

/** WHERE the API transport came from, for operator reports. Never a value. */
export interface ResolvedApiModeReport {
  /** The resolved `<origin>/v1` authority this client would send to. */
  baseUrl: string;
  /** An env key NAME, a Keychain item reference, a file PATH, or `"default"`. */
  apiUrlSource: string | null;
  /** An env key NAME, a Keychain item reference, or a file PATH. Never a value. */
  apiKeySource: string | null;
  /** The tier of the credential chain that supplied the key. */
  apiKeyTier: string | null;
}

/**
 * Resolve WHERE the client transport came from, without exposing the key.
 *
 * One pass down the @hasna/contracts chain, used by the operator-facing mode
 * report (`storage mode`) so a human can see *why* the client is pointed at
 * the cloud — an env key name, a Keychain item reference, a credentials-file
 * path, or the fleet gateway default. `null` when the environment selects the
 * on-box store or configures nothing at all; refusals throw exactly as
 * {@link getApiConfig} does.
 */
export function getResolvedApiModeReport(
  env: Env = process.env,
  options: MementosClientResolveOptions = {},
): ResolvedApiModeReport | null {
  if (hasDatabaseUrl(env)) return null;
  if (selectsMementosLocalStore(env)) return null;

  const inputs = mementosResolverInputs(env, options.credentials);
  let credential: ResolvedCredential | null;
  try {
    credential = resolveCredential("mementos", inputs.env, inputs.credentials);
  } catch (error) {
    throw toStoreConfigError(error);
  }
  if (!credential) {
    try {
      resolveClientTransport("mementos", inputs.env, { credentials: inputs.credentials });
    } catch (error) {
      if (
        error instanceof ClientTransportConfigurationError &&
        /is not set and no API key could be resolved/.test(error.message)
      ) {
        return null;
      }
      throw toStoreConfigError(error);
    }
    return null;
  }
  const resolution = resolveClientTransport("mementos", inputs.env, {
    credentials: { ...inputs.credentials, apiKey: credential.apiKey },
  });
  assertCleanResolvedBase(resolution.baseUrl);
  return {
    baseUrl: resolution.baseUrl,
    apiUrlSource: resolution.apiUrlSource,
    // The TRUE tier, not the tier-1 spelling the transport was handed: passing
    // the value down as an argument makes the transport report "explicit apiKey
    // argument", which would erase the Keychain/disk/env origin an operator
    // needs in a diagnostic. `credential.source` is that origin, never a value.
    apiKeySource: credential.source,
    apiKeyTier: credential.tier,
  };
}

/**
 * Throw unless the environment unambiguously selects one store.
 *
 * AMBIGUOUS CONFIGURATION IS AN ERROR, NOT A DEFAULT. Half an API configuration
 * used to resolve to `null`, which every caller read as "local SQLite" — so an
 * operator whose API key failed to load silently got a different, usually stale,
 * dataset with no error and no flag. From the caller's side that is
 * indistinguishable from a store that is working.
 *
 * THIS FUNCTION ONLY ASSERTS. It returns `void`, so it cannot select anything —
 * the precedence table below describes the RESOLVER, which is `getApiConfig()`
 * immediately after it, and each early `return` here only suppresses the
 * ambiguity error for a case that is already unambiguous. The SELECTION is
 * implemented in `getApiConfig()` / `isApiMode()`; the table is documented here
 * because this is where the error text lives.
 *
 * Precedence, highest first:
 *  1. An explicit SQLite path (`HASNA_MEMENTOS_DB_PATH` / `MEMENTOS_DB_PATH`) is
 *     the narrowest, most specific signal and selects LOCAL before the resolver
 *     is even consulted, so local dev, tooling and import/export keep working
 *     when a credential is exported globally. (`MEMENTOS_DB_PATH`'s precedence
 *     over a COMPLETE API pair is the package's documented precedence-1 rule
 *     since 2026-08-03.)
 *  2. A client DSN present disables API mode. A DSN on a client is forbidden
 *     and is tracked separately in database.ts.
 *  3. The @hasna/contracts resolve — everything else. A URL without a
 *     resolvable credential, a blank or disagreeing pair, an unusable
 *     credential file, or an invalid authority THROWS here; a credential with
 *     no URL resolves to the fleet gateway (complete configuration).
 *  4. Nothing configured anywhere -> no transport selected. This used to
 *     resolve to LOCAL (the "documented single-operator default"); since the
 *     2026-09-04 fail-closed ruling a client that needs the store REFUSES
 *     instead — an explicit opt-in (`HASNA_MEMENTOS_DB_PATH` or
 *     `HASNA_MEMENTOS_LOCAL=1`) is now the only way into the on-box SQLite
 *     store, and `assertClientStoreConfigured()` (below) enforces that at
 *     every entry point that would otherwise open the default local file.
 *
 * Never reads, logs, or embeds a credential value — only variable NAMES and
 * tier descriptions.
 */
export function assertUnambiguousStoreEnv(
  env: Env = process.env,
  options: MementosClientResolveOptions = {},
): void {
  // 1. Explicit local path: unambiguous, so there is no error to raise. The
  // SELECTION itself happens in getApiConfig(); this return only skips the
  // refusal checks below, which would otherwise fire on a stray API URL.
  if (hasExplicitLocalDbPath(env)) return;
  if (hasDatabaseUrl(env)) return; // 2. unchanged DSN behaviour
  // 3. Everything else is the resolver's call; getApiConfig() throws on any
  // refusal and the gate below refuses the nothing-configured case.
  getApiConfig(env, options);
}

/**
 * FAIL-CLOSED store gate (owner ruling 2026-09-04, fleet fail-closed wave).
 *
 * The transport rules above answer "which store is configured?" and treat
 * "none" as a question, not an answer: `isApiMode()` returns false and
 * `getApiConfig()` returns null, and every domain call site reads that as
 * "open the local store". That was the defect: a fleet CLI run WITHOUT a
 * credential silently opened the default on-box SQLite store
 * (~/.hasna/mementos/mementos.db), served it as if it were the memory store,
 * and exited 0 — a false green against a different dataset.
 *
 * This function is the guard every store-access entry point calls BEFORE it
 * may open the default local file (CLI command startup, `getDatabase()`
 * default-path fallthrough, ...). It throws unless one of these is true:
 *
 *   - an explicit SQLite path is set (`HASNA_MEMENTOS_DB_PATH` /
 *     `MEMENTOS_DB_PATH`) — the documented EXPLICIT LOCAL OPT-IN, or
 *   - the deliberate flag opt-in (`HASNA_MEMENTOS_LOCAL=1` / `MEMENTOS_LOCAL=1`)
 *     with no authority or credential configured — answered BEFORE the
 *     resolver runs, so a local run reads no Keychain item and no credential
 *     file, or
 *   - a client DSN is present (its own server-only guard already fails closed
 *     in getDatabase; the DSN tier is untouched here), or
 *   - the @hasna/contracts chain resolves a credential (fleet API mode —
 *     authority included, defaulting to the fleet gateway).
 *
 * Anything else — no credential, no opt-in — is a REFUSAL, never a local
 * default. Never reads, logs, or embeds a credential value — only variable
 * NAMES and tier descriptions.
 */
export function assertClientStoreConfigured(
  env: Env = process.env,
  options: MementosClientResolveOptions = {},
): void {
  // 1. Explicit local opt-ins — an explicit SQLite path, or the deliberate
  // flag with nothing configured — are answered WITHOUT the resolver, so a
  // local run reads no Keychain item and no credential file.
  if (selectsMementosLocalStore(env)) return;
  // 2. A client DSN present — its own server-only guard already fails closed
  // in getDatabase; the DSN tier is untouched here.
  if (hasDatabaseUrl(env)) return;
  // 3. Everything else is the resolver's call: a chain that resolves a
  // credential (env, Keychain, credentials file) is configured; every refusal
  // (a URL without a credential, blank or disagreeing aliases, an unusable
  // credential file, an invalid authority) throws here; and a chain that
  // resolves NOTHING is the refusal below — never a local default.
  const config = getApiConfig(env, options);
  if (config !== null) return; // fleet API mode — credential + authority resolved
  throw new MementosStoreConfigError(
    "mementos is not configured to reach any memory store, and will NOT fall back to the " +
      "on-box SQLite store (~/.hasna/mementos/mementos.db). " +
      "No credential could be resolved from the Keychain item hasna.credentials.mementos.api-key " +
      "(macOS only), ~/.hasna/mementos/config/credentials, or " +
      `${API_KEY_ENV_KEYS[0]}; the authority would be the fleet gateway ${"https://api.hasna.com/mementos"} ` +
      `(or ${API_URL_ENV_KEYS[0]} if set). ` +
      `Set ${API_URL_ENV_KEYS[0]} and ${API_KEY_ENV_KEYS[0]} (the resolver also accepts the legacy ` +
      `${API_URL_ENV_KEYS[1]} / ${API_KEY_ENV_KEYS[1]} aliases for one release) to use the fleet memory ` +
      `API, or opt into an explicit local SQLite file with ${DB_PATH_ENV_KEYS[0]} / ` +
      `${DB_PATH_ENV_KEYS[1]} (or ${MEMENTOS_LOCAL_OPT_IN_ENV_KEYS[0]}=1).`,
  );
}

export class ApiRequestError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: string,
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

interface RawResponse {
  status: number;
  body: string;
}

const DEFAULT_TIMEOUT_S = "45";

/**
 * Synchronous authed HTTP request to the cloud API. Returns the raw status +
 * body. The bearer key is fed to curl on stdin (`-H @-`) so it never appears in
 * argv or the environment. The body (if any) is written to a private 0600 temp
 * file and passed as `--data-binary @file` so it never appears in argv either.
 *
 * The credential and authority are resolved FRESH for every request — through
 * the @hasna/contracts chain, Keychain and credentials file included — so a
 * rotation heals a long-lived shell or MCP server without a restart (owner
 * ruling 2026-09-04, hasna/apps#1720).
 */
function apiRequestRaw(method: string, path: string, body?: unknown): RawResponse {
  const cfg = getApiConfig();
  if (!cfg) throw new Error("api-mode: not configured (no Hasna mementos credential resolved)");

  // Fail closed before anything leaves the process. See the function's comment
  // for the two preload bypasses this exists to catch.
  assertRequestAllowedUnderTest(cfg.baseUrl);

  const url = `${cfg.baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
  const hasBody = body !== undefined && body !== null;
  const timeout = process.env["HASNA_MEMENTOS_API_TIMEOUT"] || DEFAULT_TIMEOUT_S;

  // Secret headers are read by curl from stdin via `-H @-` (one header per
  // line). The key is NEVER placed on argv or in the process environment, so it
  // cannot leak via `ps` / `/proc/<pid>/cmdline` / `/proc/<pid>/environ`.
  const headerLines = `Authorization: Bearer ${cfg.apiKey}\nx-api-key: ${cfg.apiKey}\n`;

  // Only non-secret values ever reach argv (method, url, timeout, static headers).
  const args = [
    "curl",
    "-sS",
    "--fail-with-body",
    "-m",
    timeout,
    "-X",
    method,
    "-H",
    "@-", // read the auth headers from stdin
    "-H",
    "Content-Type: application/json",
    "-H",
    "Accept: application/json",
    "-w",
    "\\n%{http_code}",
  ];

  let bodyFile: string | undefined;
  if (hasBody) {
    bodyFile = join(tmpdir(), `mem-req-${process.pid}-${randomUUID()}.json`);
    writeFileSync(bodyFile, JSON.stringify(body), { mode: 0o600 });
    args.push("--data-binary", `@${bodyFile}`);
  }
  args.push(url);

  // Hand curl an environment with the key vars stripped, so the secret is not
  // even present in the child's `/proc/<pid>/environ` (it travels only on stdin).
  const childEnv: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v === undefined) continue;
    if (k === "HASNA_MEMENTOS_API_KEY" || k === "MEMENTOS_API_KEY") continue;
    childEnv[k] = v;
  }

  let out = "";
  let err = "";
  try {
    const proc = Bun.spawnSync(args, {
      stdin: Buffer.from(headerLines),
      stdout: "pipe",
      stderr: "pipe",
      env: childEnv,
    });
    out = proc.stdout ? new TextDecoder().decode(proc.stdout) : "";
    err = proc.stderr ? new TextDecoder().decode(proc.stderr) : "";
  } finally {
    if (bodyFile) {
      try {
        unlinkSync(bodyFile);
      } catch {
        // temp file already gone — nothing to clean up
      }
    }
  }

  // curl exit 7/28/etc → transport failure (server unreachable / timeout).
  // With --fail-with-body, a non-2xx still returns exit!=0 but we parse the code.
  const nl = out.lastIndexOf("\n");
  const codeStr = nl >= 0 ? out.slice(nl + 1).trim() : "";
  const respBody = nl >= 0 ? out.slice(0, nl) : out;
  const status = parseInt(codeStr, 10);

  if (!Number.isFinite(status) || status === 0) {
    throw new ApiRequestError(
      `mementos cloud request failed (${method} ${path}): ${err.trim() || "no HTTP status"}`,
      0,
      respBody,
    );
  }
  return { status, body: respBody };
}

export interface ApiJsonOptions {
  /**
   * Treat `404` as a normal outcome and return `{status: 404, data: undefined}`
   * instead of throwing. ONLY for callers where "absent" is a real answer —
   * a GET of one record by id, a DELETE that tolerates an already-gone row, or
   * a call that has an explicit fallback for a route an older server image does
   * not serve yet (see `runCleanupViaApi`).
   *
   * It must never be set on a create/upsert path. A 404 there means the route
   * did not exist on the server (client/server version skew, wrong base URL),
   * so nothing was written; returning success-shaped data made the CLI print
   * "Saved:" and exit 0 having persisted nothing. Default is fail-closed.
   */
  allow404?: boolean;
}

/**
 * Authed JSON request. Throws {@link ApiRequestError} on every non-2xx,
 * including 404, unless the caller opts into 404 pass-through via
 * {@link ApiJsonOptions.allow404}.
 */
export function apiJson<T = unknown>(
  method: string,
  path: string,
  body?: unknown,
  options?: ApiJsonOptions,
): { status: number; data: T } {
  const raw = apiRequestRaw(method, path, body);
  if (raw.status >= 200 && raw.status < 300) {
    let data: T;
    if (raw.body.trim()) {
      try {
        data = JSON.parse(raw.body) as T;
      } catch (e) {
        // The CLI's own stdout is the data contract for structured commands, so
        // an internal failure must never read as "the CLI produced unparseable
        // output". A truncated 2xx body (proxy cap, server crash mid-write) is
        // a CLOUD failure: name it as one, with the remedy.
        throw new ApiRequestError(
          `mementos cloud ${method} ${path} returned status ${raw.status} with a body that is not valid JSON (${e instanceof Error ? e.message : String(e)}) — the response is truncated or the server is unhealthy`,
          raw.status,
          raw.body.slice(0, 500),
        );
      }
    } else {
      data = undefined as unknown as T;
    }
    return { status: raw.status, data };
  }
  if (raw.status === 404 && options?.allow404) {
    return { status: 404, data: undefined as unknown as T };
  }
  let msg = `mementos cloud ${method} ${path} → ${raw.status}`;
  try {
    const parsed = JSON.parse(raw.body) as { error?: string; message?: string };
    if (parsed.error || parsed.message) msg += `: ${parsed.error || parsed.message}`;
  } catch {
    if (raw.body.trim()) msg += `: ${raw.body.slice(0, 200)}`;
  }
  throw new ApiRequestError(msg, raw.status, raw.body);
}

/** Build a query string from a filter object (skips undefined/null/empty). */
export function toQuery(params: Record<string, unknown>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    if (Array.isArray(v)) {
      if (v.length === 0) continue;
      sp.set(k, v.join(","));
    } else if (typeof v === "boolean") {
      sp.set(k, v ? "true" : "false");
    } else {
      sp.set(k, String(v));
    }
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}