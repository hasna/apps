/**
 * @hasna/logs — Store resolver.
 * Copyright 2026 Hasna Inc.
 * Licensed under the Apache License, Version 2.0
 *
 * ONE entry point that resolves the live {@link Store} from the environment:
 *
 *   a credential resolves (Keychain / disk / env)  => ApiStore  (HTTP /v1)
 *   HASNA_LOGS_LOCAL=1 (explicit opt-in, nothing configured) => LocalStore (on-box SQLite)
 *   otherwise                                         => FAIL CLOSED (actionable error)
 *
 * Callers (CLI, MCP, SDK) call {@link resolveStore} once and hold the interface;
 * they never branch on transport and never touch `getDb()` / raw `fetch`
 * directly. The flip is the @hasna/contracts client transport contract: a
 * credential from ANY tier selects HTTP, and the authority follows
 * `HASNA_LOGS_API_URL`, the Keychain `api-url` item, the credentials file, and
 * finally defaults to the fleet gateway `https://api.hasna.com/logs`. Owner
 * ruling (2026-09-04, credential-resolver adoption, hasna/apps#1720): running
 * WITHOUT a resolvable credential must NEVER silently fall back to the local
 * SQLite store (~/.hasna/logs/logs.db) — local mode is reachable only through
 * the explicit opt-in HASNA_LOGS_LOCAL=1 (alias LOGS_LOCAL=1), and a run that
 * lands there says so once on stderr.
 *
 * THE CHAIN is the shared @hasna/contracts resolver, resolved fresh per call:
 * an explicit argument, then HASNA_LOGS_API_KEY_OVERRIDE / HASNA_PROFILE /
 * HASNA_LOGS_API_KEY_REF, then the macOS Keychain item
 * `hasna.credentials.logs.api-key` (account HASNA_STATION, else `hostname -s`,
 * else USER), then `~/.hasna/logs/config/credentials` (0400/0600; HASNA_HOME /
 * HASNA_CONFIG_HOME move the root), then HASNA_LOGS_API_KEY. The legacy
 * unprefixed `LOGS_API_URL` / `LOGS_API_KEY` names survive only as the shared
 * resolver's silent alias fallback for one release and NEVER outrank the
 * canonical pair. Retired locations — `~/.hasna/fleet-env`, the legacy
 * `cloud` / `config` dotdir key stores under `~/.hasna`, `$XDG_CONFIG_HOME`,
 * `~/.logs/config.json` — are inputs nowhere, and no `*_MODE` /
 * `*_STORAGE_MODE` variable selects a transport.
 *
 * THE ENV OBJECT IS PASSED THROUGH BY IDENTITY. The resolver gates its
 * ambient Keychain tier on `env === process.env` (hasna/apps#1788), so this
 * module never copies or normalises the environment — the callers' `process.env`
 * stays tier-3-live, and a caller-built dictionary stays the hermetic seam.
 */
import {
  clientTransportEnvKeys,
  resolveClientTransport,
  type ClientTransportConfigurationError,
} from "@hasna/contracts/client";
import { resolveStorageClient } from "@hasna/contracts/client/storage";
import { ApiStore } from "./api.ts";
import { LocalStore } from "./local.ts";
import type {
  LogsCredentialChainOptions,
  LogsCredentialTier,
} from "./client-types.ts";
import type { Store } from "./types.ts";

export type { Store } from "./types.ts";
export { LocalStore } from "./local.ts";
export { ApiStore } from "./api.ts";

/** App slug used for the client-flip env keys (HASNA_LOGS_*). */
export const LOGS_APP_SLUG = "logs";

/** Env vars that opt in to the local SQLite store explicitly. */
export const LOGS_LOCAL_OPT_IN_ENV_KEYS = ["HASNA_LOGS_LOCAL", "LOGS_LOCAL"] as const;

const TRUE_ENV_VALUES = new Set(["1", "true", "yes", "on"]);

/** Every env name that can configure a logs authority or credential, resolver-derived. */
export function logsAuthorityEnvKeys(): string[] {
  const keys = clientTransportEnvKeys(LOGS_APP_SLUG);
  return [...keys.apiUrlKeys, ...keys.apiKeyKeys];
}

/**
 * True only when the caller explicitly opted into the local SQLite store.
 * A defined-but-blank or false value is never an opt-in.
 */
export function isLogsLocalOptIn(env: NodeJS.ProcessEnv = process.env): boolean {
  return LOGS_LOCAL_OPT_IN_ENV_KEYS.some((name) =>
    TRUE_ENV_VALUES.has(env[name]?.trim().toLowerCase() ?? ""),
  );
}

/**
 * The one-line local-mode announcement, printed once per process on stderr.
 * Local is legitimate for this package, but an operator who believes they are
 * on the fleet must be told they are not (owner ruling 2026-09-04).
 */
let localModeAnnounced = false;

/** Test seam: forget that the local-mode line was printed. */
export function resetLogsLocalModeNotice(): void {
  localModeAnnounced = false;
}

function announceLocalMode(env: NodeJS.ProcessEnv): void {
  if (localModeAnnounced) return;
  localModeAnnounced = true;
  const keys = clientTransportEnvKeys(LOGS_APP_SLUG);
  process.stderr.write(
    "logs: local mode — no fleet credential resolved; using the on-box SQLite store " +
      `(~/.hasna/logs/logs.db) via the ${LOGS_LOCAL_OPT_IN_ENV_KEYS[0]} opt-in. To go hosted, put the key ` +
      `in the Keychain item hasna.credentials.${LOGS_APP_SLUG}.api-key or ~/.hasna/${LOGS_APP_SLUG}/config/credentials, ` +
      `or set ${keys.apiKeyKeys[0]} (${keys.apiUrlKeys[0]} defaults to https://api.hasna.com/${LOGS_APP_SLUG}).\n`,
  );
}

function failClosedError(): Error {
  const authority = clientTransportEnvKeys(LOGS_APP_SLUG);
  return new Error(
    `@hasna/logs requires the fleet API: set ${authority.apiUrlKeys[0]} and ${authority.apiKeyKeys[0]} ` +
      `(${authority.apiUrlKeys[0]} defaults to https://api.hasna.com/${LOGS_APP_SLUG}). ` +
      "No credential resolved from the macOS Keychain item " +
      `hasna.credentials.${LOGS_APP_SLUG}.api-key, ~/.hasna/${LOGS_APP_SLUG}/config/credentials (0400/0600), ` +
      `or ${authority.apiKeyKeys[0]}. ` +
      "Refusing to silently serve the local store (~/.hasna/logs/logs.db); to run in explicit local mode, " +
      `set ${LOGS_LOCAL_OPT_IN_ENV_KEYS[0]}=1 (alias ${LOGS_LOCAL_OPT_IN_ENV_KEYS[1]}).`,
  );
}

/**
 * Shape match, never `instanceof`: @hasna/contracts builds its `./client` and
 * `./client/storage` bundles as separate module instances, each carrying its
 * own copy of the error class (the projects seam documents the same rule), so
 * a cross-subpath `instanceof ClientTransportConfigurationError` is false
 * even at the same published version. The class sets `name` in its
 * constructor, which is stable across the copies; match on that.
 */
function isClientTransportConfigurationError(
  error: unknown,
): error is ClientTransportConfigurationError {
  return (
    error instanceof Error && error.name === "ClientTransportConfigurationError"
  );
}

/**
 * What the resolver threw, and what it means for the local decision.
 *
 * ONLY the "nothing at all is configured" refusal may degrade to the on-box
 * store (and even then only under the explicit opt-in). A DECLARED authority
 * or credential that cannot be honoured — a blank variable, a disagreeing
 * alias pair, an unreadable credentials file, a URL without a key — is a
 * misconfiguration the operator must see; serving a stale local dataset
 * instead is the false green this campaign exists to end.
 */
function nothingConfiguredRefusal(error: ClientTransportConfigurationError): boolean {
  return /is not set and no API key could be resolved/.test(error.message);
}

/**
 * Resolve the live {@link Store} from the environment. Returns an
 * {@link ApiStore} when the @hasna/contracts client transport resolves HTTP
 * (a credential from any tier), a {@link LocalStore} when the caller
 * explicitly opted in with HASNA_LOGS_LOCAL=1 and NOTHING configured an
 * authority or credential, and otherwise FAILS CLOSED: no silent local
 * fallback when the fleet credential is missing or misconfigured.
 *
 * Local mode is the only branch that prints: one "local" line on stderr, once
 * per process.
 */
export function resolveStore(env: NodeJS.ProcessEnv = process.env): Store {
  try {
    return new ApiStore(resolveStorageClient(LOGS_APP_SLUG, env).client);
  } catch (error) {
    if (!isClientTransportConfigurationError(error)) throw error;
    if (isLogsLocalOptIn(env) && nothingConfiguredRefusal(error)) {
      announceLocalMode(env);
      return new LocalStore();
    }
    throw failClosedError();
  }
}

/** True when the environment resolves to the HTTP transport. */
export function usesHttpTransport(env: NodeJS.ProcessEnv = process.env): boolean {
  try {
    resolveStorageClient(LOGS_APP_SLUG, env);
    return true;
  } catch (error) {
    if (isClientTransportConfigurationError(error)) return false;
    throw error;
  }
}

/** The transport decision this process resolves to, in diagnostics shape. */
export interface LogsTransportReport {
  transport: "http" | "local";
  /**
   * WHAT selected the transport, never a value: an env key NAME, a Keychain
   * item reference, the absolute PATH of the credentials file, `"default"`
   * (the fleet gateway), or `"local"` (the explicit opt-in).
   */
  source: string;
  /** `<origin>/v1` base the client targets; null on the local store. */
  base_url: string | null;
  /** True when an authority was CONFIGURED (env, Keychain, or file) rather than defaulted. */
  api_url_present: boolean;
  api_url_source: string | null;
  api_key_present: boolean;
  /** WHICH tier supplied the key (env key name, Keychain item, path), or null. Never a value. */
  api_key_source: string | null;
  api_key_tier: LogsCredentialTier | null;
  /** True when the explicit local opt-in selected the on-box store. */
  local_opt_in: boolean;
}

/**
 * Resolve the transport decision as a diagnostic report — the shape behind
 * `logs transport` and the transport-report tests. Values are never included;
 * sources are env key NAMES, Keychain references and file paths.
 *
 * Throws like {@link resolveStore}: every refusal except "nothing configured
 * + explicit opt-in" propagates.
 */
export function resolveLogsTransport(
  env: NodeJS.ProcessEnv = process.env,
  options: { credentials?: LogsCredentialChainOptions } = {},
): LogsTransportReport {
  try {
    const resolution = resolveClientTransport(
      LOGS_APP_SLUG,
      env as Record<string, string | undefined>,
      options.credentials ? { credentials: options.credentials } : {},
    );
    return {
      transport: "http",
      source: resolution.transportSource,
      base_url: resolution.baseUrl,
      api_url_present:
        resolution.apiUrlSource !== null && resolution.apiUrlSource !== "default",
      api_url_source: resolution.apiUrlSource,
      api_key_present: resolution.apiKeyPresent,
      api_key_source: resolution.apiKeySource,
      api_key_tier: resolution.apiKeyTier,
      local_opt_in: false,
    };
  } catch (error) {
    if (!isClientTransportConfigurationError(error)) throw error;
    if (isLogsLocalOptIn(env) && nothingConfiguredRefusal(error)) {
      return {
        transport: "local",
        source: "local",
        base_url: null,
        api_url_present: false,
        api_url_source: null,
        api_key_present: false,
        api_key_source: null,
        api_key_tier: null,
        local_opt_in: true,
      };
    }
    throw error;
  }
}

/**
 * Return the concrete {@link LocalStore} for on-box maintenance operations
 * whose SUBJECT exists only on the local backend, throwing loudly in HTTP mode
 * instead of silently touching a stale local db. Local mode here, like every
 * local access, requires the explicit opt-in (HASNA_LOGS_LOCAL=1); otherwise
 * the operation fails closed. Reversible: unset the API vars and set
 * HASNA_LOGS_LOCAL=1.
 *
 * STRONG REASON (recorded 2026-08-18 for the local-only-capability review;
 * reviewer rules on it): the operations behind this guard — `db doctor
 * segments`, `db doctor rebuild-index`, `db doctor repair-segments` — verify,
 * rebuild and repair the raw event store: on-disk JSONL segment files plus
 * manifests and hashes (`src/lib/event-store.ts` reads those files directly).
 * The hosted tier deliberately does NOT persist raw envelopes: the cloud
 * `event_records` rows carry redacted metadata plus a content hash with
 * `segment_id`/`segment_path` placeholders and `raw: null` by design
 * (`src/server/cloud/store.ts`). There is therefore no hosted subject for
 * these operations — no raw segments to verify, no SQLite projections to
 * rebuild from them, no segment lines to quarantine. Porting would mean
 * re-architecting the hosted tier to store raw envelopes (a product change
 * against a documented design choice), not porting this capability; a
 * Postgres integrity check would be a NEW capability, not this one.
 */
export function requireLocalStore(
  operation: string,
  env: NodeJS.ProcessEnv = process.env,
): LocalStore {
  if (usesHttpTransport(env)) {
    throw new Error(
      `'${operation}' is a local-only operation and cannot run on the HTTP transport (the cloud tier is a shared log sink). Unset HASNA_LOGS_API_URL/HASNA_LOGS_API_KEY and set HASNA_LOGS_LOCAL=1 to run it against the local store.`,
    );
  }
  if (!isLogsLocalOptIn(env)) {
    throw new Error(
      `'${operation}' is a local-only operation and the local store is not the default. Run it in explicit local mode: set HASNA_LOGS_LOCAL=1 (alias LOGS_LOCAL).`,
    );
  }
  return new LocalStore();
}

/**
 * Best-effort {@link LocalStore} for internal self-telemetry: returns a store
 * only in explicit local mode (HASNA_LOGS_LOCAL=1), or `null` on the HTTP
 * transport AND when no explicit opt-in is present (where the events catalog
 * has no home and a local file must never be opened silently). Callers must
 * treat telemetry as optional and never let it change behavior.
 */
export function localStoreIfAvailable(
  env: NodeJS.ProcessEnv = process.env,
): LocalStore | null {
  if (usesHttpTransport(env)) return null;
  return isLogsLocalOptIn(env) ? new LocalStore() : null;
}