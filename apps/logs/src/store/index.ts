/**
 * @hasna/logs — Store resolver.
 * Copyright 2026 Hasna Inc.
 * Licensed under the Apache License, Version 2.0
 *
 * ONE entry point that resolves the live {@link Store} from the environment:
 *
 *   HASNA_LOGS_LOCAL=1 (explicit opt-in)            => LocalStore (on-box SQLite)
 *   a credential resolves (Keychain / disk / env)   => ApiStore   (HTTP /v1)
 *   otherwise                                       => LocalStore (on-box SQLite)
 *
 * The storage-mode axis is retired (owner directive 2026-08-15): EVERY command
 * works on EVERY transport — hosted API (any API URL + API key) OR local
 * (SQLite). The HTTP transport is selected by a resolvable credential from the
 * shared @hasna/contracts chain; with NO credential, local is the default, not
 * an error. `HASNA_LOGS_LOCAL=1` (alias `LOGS_LOCAL=1`) is the explicit opt-in
 * that forces the on-box store even when a credential resolves, and a run that
 * lands on local says so once on stderr — it is never silent. No command is
 * transport-gated, and no `*_MODE` / `*_STORAGE_MODE` variable selects a
 * transport.
 *
 * A DECLARED authority or credential that cannot be honoured — a blank
 * variable, a URL without a key, disagreeing aliases — is still an operator
 * error and throws loudly; it is never silently routed to the local store.
 *
 * Callers (CLI, MCP, SDK) call {@link resolveStore} once and hold the interface;
 * they never branch on transport and never touch `getDb()` / raw `fetch`
 * directly.
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
 * `~/.logs/config.json` — are inputs nowhere.
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
 * Local is legitimate for this package — with no fleet credential it is the
 * default transport — but an operator who believes they are on the fleet must
 * be told they are not (owner ruling 2026-09-04 retained the line).
 */
let localModeAnnounced = false;

/** Test seam: forget that the local-mode line was printed. */
export function resetLogsLocalModeNotice(): void {
  localModeAnnounced = false;
}

function writeLocalAnnouncement(line: string): void {
  if (localModeAnnounced) return;
  localModeAnnounced = true;
  process.stderr.write(line);
}

function announceLocalMode(env: NodeJS.ProcessEnv): void {
  const keys = clientTransportEnvKeys(LOGS_APP_SLUG);
  writeLocalAnnouncement(
    "logs: local store — data plane traffic goes to the on-box SQLite store " +
      `(~/.hasna/logs/logs.db) (${LOGS_LOCAL_OPT_IN_ENV_KEYS[0]} opt-in or no fleet credential). To go hosted, put the key ` +
      `in the Keychain item hasna.credentials.${LOGS_APP_SLUG}.api-key or ~/.hasna/${LOGS_APP_SLUG}/config/credentials, ` +
      `or set ${keys.apiKeyKeys[0]} (${keys.apiUrlKeys[0]} defaults to https://api.hasna.com/${LOGS_APP_SLUG}).\n`,
  );
}

function misconfiguredAuthorityError(): Error {
  const authority = clientTransportEnvKeys(LOGS_APP_SLUG);
  return new Error(
    `@hasna/logs cannot honour a declared authority: ${authority.apiUrlKeys[0]} / ${authority.apiKeyKeys[0]} ` +
      "are set in a way the credential chain refuses (blank value, URL without a key, disagreeing aliases, " +
      "or an unreadable credentials file). Fix the declaration — an error here is never routed to the local store. " +
      `To force the on-box SQLite store, set ${LOGS_LOCAL_OPT_IN_ENV_KEYS[0]}=1 (alias ${LOGS_LOCAL_OPT_IN_ENV_KEYS[1]}).`,
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
 * ONLY the "nothing at all is configured" refusal may select the on-box
 * store. A DECLARED authority or credential that cannot be honoured — a
 * blank variable, a disagreeing alias pair, an unreadable credentials file, a
 * URL without a key — is a misconfiguration the operator must see; routing it
 * to the local store would be a false green.
 */
function nothingConfiguredRefusal(error: ClientTransportConfigurationError): boolean {
  return /is not set and no API key could be resolved/.test(error.message);
}

/**
 * Resolve the live {@link Store} from the environment. Returns an
 * {@link ApiStore} when the @hasna/contracts client transport resolves HTTP
 * (a credential from any tier), a {@link LocalStore} when the caller
 * explicitly opted in with HASNA_LOGS_LOCAL=1 (the opt-in always selects the
 * on-box store, even when a credential resolves), a {@link LocalStore} with
 * no credential at all (local is the default — the storage-mode axis is
 * retired), and otherwise throws: a declared authority that cannot be
 * honoured is an operator error, never silently routed.
 *
 * Local is the only branch that prints: one "local" line on stderr, once per
 * process.
 */
export function resolveStore(env: NodeJS.ProcessEnv = process.env): Store {
  if (isLogsLocalOptIn(env)) {
    announceLocalMode(env);
    return new LocalStore();
  }
  try {
    return new ApiStore(resolveStorageClient(LOGS_APP_SLUG, env).client);
  } catch (error) {
    if (!isClientTransportConfigurationError(error)) throw error;
    if (nothingConfiguredRefusal(error)) {
      announceLocalMode(env);
      return new LocalStore();
    }
    throw misconfiguredAuthorityError();
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
   * (the fleet gateway), or `"local"` (the explicit opt-in or the
   * no-credential default).
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
 * Throws like {@link resolveStore}: a declared authority that cannot be
 * honoured propagates.
 */
export function resolveLogsTransport(
  env: NodeJS.ProcessEnv = process.env,
  options: { credentials?: LogsCredentialChainOptions } = {},
): LogsTransportReport {
  if (isLogsLocalOptIn(env)) {
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
    if (nothingConfiguredRefusal(error)) {
      return {
        transport: "local",
        source: "local",
        base_url: null,
        api_url_present: false,
        api_url_source: null,
        api_key_present: false,
        api_key_source: null,
        api_key_tier: null,
        local_opt_in: false,
      };
    }
    throw error;
  }
}

/**
 * Return the concrete {@link LocalStore} for raw-store maintenance operations.
 * Their SUBJECT — the on-disk JSONL segment files plus manifests and hashes —
 * always lives on the box, so the operations run identically on BOTH
 * transports: the command is never transport-gated (owner directive
 * 2026-08-15; the storage-mode axis is retired). `HASNA_LOGS_LOCAL=1` is not
 * required for these: with no credential the local store is the default
 * transport anyway, and with a credential the command still maintains the
 * on-box raw store it is documented to maintain.
 */
export function requireLocalStore(
  operation: string,
  env: NodeJS.ProcessEnv = process.env,
): LocalStore {
  // The subject of these operations — the raw JSONL segments and SQLite
  // projections — always lives on the box, so a run that reaches this store
  // is local work even when the data plane resolved to the hosted API. Say so
  // once, accurately, on every transport; it is never silent.
  writeLocalAnnouncement(
    "logs: local store — raw-store maintenance on the on-box SQLite store " +
      `(~/.hasna/logs/logs.db): the raw JSONL segments and SQLite projections it maintains live on this ` +
      `box on every transport (${LOGS_LOCAL_OPT_IN_ENV_KEYS[0]}=1 or no fleet credential route the data plane here too).\n`,
  );
  return new LocalStore();
}

/**
 * Best-effort {@link LocalStore} for internal self-telemetry: returns a store
 * when the data plane is local (explicit opt-in or the no-credential default),
 * or `null` on the HTTP transport. A DECLARED authority or credential that
 * cannot be honoured (blank variable, URL without a key, disagreeing aliases,
 * unreadable credentials file) also returns `null`: a misconfiguration is
 * never silently opened as the local store — the data-plane command fails
 * loud instead. Callers must treat telemetry as optional and never let it
 * change behavior.
 */
export function localStoreIfAvailable(
  env: NodeJS.ProcessEnv = process.env,
): LocalStore | null {
  if (isLogsLocalOptIn(env)) return new LocalStore();
  try {
    resolveStorageClient(LOGS_APP_SLUG, env);
    return null;
  } catch (error) {
    if (!isClientTransportConfigurationError(error)) return null;
    if (nothingConfiguredRefusal(error)) return new LocalStore();
    return null;
  }
}