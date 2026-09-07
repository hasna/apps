// Client-side storage resolver for @hasna/economy.
//
// The economy CLI, MCP server and `./sdk` route every data operation through
// this one seam. It asks the @hasna/contracts 1.0.2 client resolver for an
// authenticated HTTP storage client; the resolver consults, FRESH ON EVERY
// CALL (and per request inside the transport):
//
//   1. an explicit `apiKey` / `profile` argument
//   2. a deliberate env pointer       — HASNA_ECONOMY_API_KEY_OVERRIDE,
//                                       HASNA_PROFILE, HASNA_ECONOMY_API_KEY_REF
//   3. the macOS Keychain             — `hasna.credentials.economy.api-key`,
//                                       account HASNA_STATION -> hostname -s -> USER
//   4. disk                           — ~/.hasna/economy/config/credentials
//                                       (HASNA_HOME / HASNA_CONFIG_HOME override;
//                                       XDG is never consulted)
//   5. HASNA_ECONOMY_API_KEY in the env — legitimate, no deprecation notice
//
// The authority follows the same ladder — HASNA_ECONOMY_API_URL, the Keychain
// `api-url` item, the credentials file — and DEFAULTS to the fleet gateway
// `https://api.hasna.com/economy` once a credential resolves (the client
// appends `/v1`). Retired locations (~/.hasna/fleet-env, ~/.hasna/cloud,
// ~/.config/hasna, $XDG_CONFIG_HOME) are never read, and no `*_MODE` /
// `*_STORAGE_MODE` variable selects anything: the transport is decided by URL
// + key alone.
//
// FAIL-CLOSED DEFAULT (owner directive 2026-09-04). A run WITHOUT a credential
// and WITHOUT the explicit local opt-in is a HARD ERROR naming every tier that
// was consulted; no SQLite file is opened and no `economy-local-fallback`
// event is emitted. The on-box store is reachable only through the EXPLICIT
// local opt-in (`HASNA_ECONOMY_LOCAL=1`, alias `ECONOMY_LOCAL=1`), which is
// answered BEFORE the resolver runs so an unhosted run reads neither the
// Keychain nor the credential file. A configured authority always outranks the
// opt-in: a station that resolves a hosted URL or credential stays hosted, and
// a half-configured run (URL without a key) fails loudly rather than serving a
// different dataset.
//
// SAFETY: never logs or embeds the API key — it lives only inside the transport.

import {
  appConfigDiskValue,
  ClientTransportConfigurationError,
  clientTransportEnvKeys,
  createClientTransport,
  credentialDiskSources,
  credentialOverrideEnvKey,
  credentialPointerEnvKey,
  CREDENTIAL_PROFILE_ENV_KEY,
  keychainConfigValue,
  type CredentialChainOptions,
} from "@hasna/contracts/client";
import { createHasnaStorageClient, type HasnaStorageClient } from "@hasna/contracts/client/storage";
import type { ClientTransportResolution } from "@hasna/contracts/client";

/** The economy app slug used for the HASNA_<APP>_* env lookups. */
export const ECONOMY_APP = "economy";

/**
 * The @hasna/contracts transport overrides (test injection: fetchImpl, headers,
 * timeout, retry, sleepImpl) plus the tier-1 credential chain options
 * (`--api-key` / `--profile` and the injectable `security` runner tests use).
 */
export type EconomyStorageClientOverrides = Parameters<typeof createClientTransport>[2];

/** Retired client storage-mode variables — naming one in an error is the guard. */
const RETIRED_STORAGE_MODE_KEYS = [
  "HASNA_ECONOMY_STORAGE_MODE",
  "HASNA_ECONOMY_MODE",
  "ECONOMY_STORAGE_MODE",
  "ECONOMY_MODE",
] as const;

function assertNoRetiredStorageMode(env: NodeJS.ProcessEnv): void {
  const legacyKey = RETIRED_STORAGE_MODE_KEYS.find(
    (key) => Object.hasOwn(env, key) && env[key] !== undefined,
  );
  if (!legacyKey) return;
  throw new Error(
    `${legacyKey} was removed. Deployment modes no longer exist: delete the storage-mode variable. ` +
      `The client routes through the HTTP API resolved by @hasna/contracts ` +
      `(HASNA_ECONOMY_API_URL + HASNA_ECONOMY_API_KEY, the Keychain, or ` +
      `~/.hasna/economy/config/credentials), or serves the local SQLite store only when ` +
      `HASNA_ECONOMY_LOCAL=1 is set.`,
  );
}

export type EconomyCloudStorage =
  | {
      /** True when reads/writes must go to the cloud HTTP API. */
      readonly active: true;
      /** The ready HTTP storage client. */
      readonly client: HasnaStorageClient;
    }
  | {
      readonly active: false;
      readonly client: null;
    };

/**
 * Explicit local-store opt-in variables. The on-box SQLite store is served
 * only when one of these is set to a truthy value; without either of them (and
 * without a resolved credential) the client fails closed.
 */
export const LOCAL_STORAGE_OPT_IN_KEYS = ["HASNA_ECONOMY_LOCAL", "ECONOMY_LOCAL"] as const;

/** Truthy env-flag parse: set, non-blank, and not 0/false/no/off (any case). */
function envFlagSet(env: NodeJS.ProcessEnv, key: string): boolean {
  const raw = env[key];
  if (raw === undefined) return false;
  const value = raw.trim().toLowerCase();
  return value !== "" && value !== "0" && value !== "false" && value !== "no" && value !== "off";
}

function localStorageExplicitlyOptedIn(env: NodeJS.ProcessEnv): boolean {
  return LOCAL_STORAGE_OPT_IN_KEYS.some((key) => envFlagSet(env, key));
}

/**
 * Every env name that can configure an economy authority or credential,
 * resolver-derived — the one spelling the resolver itself looks for, so a
 * second copy can never fall behind it.
 */
export function economyAuthorityEnvKeys(): string[] {
  const keys = clientTransportEnvKeys(ECONOMY_APP);
  return [
    ...keys.apiUrlKeys,
    ...keys.apiKeyKeys,
    credentialOverrideEnvKey(ECONOMY_APP),
    credentialPointerEnvKey(ECONOMY_APP),
    CREDENTIAL_PROFILE_ENV_KEY,
  ];
}

/**
 * Does the ENVIRONMENT itself configure an economy authority or credential?
 *
 * Deliberately narrower than "does a credential resolve": answering it must not
 * touch the Keychain or the filesystem, because doing so would defeat the
 * isolation the local-opt-in short-circuit exists to provide (the @hasna/todos
 * `local-opt-in.ts` pattern, owner directive 2026-09-04). It reads the env
 * dictionary and nothing else.
 *
 * A DECLARED-BUT-BLANK variable counts as absent HERE — a blank has always been
 * this package's spelling for "not configured", and helpers in the wild blank
 * rather than delete. It is NOT absent once we do go hosted: the resolver
 * refuses a blank loudly rather than falling through to another identity, which
 * is the behaviour that matters at that point.
 */
export function hasEconomyEnvAuthorityIntent(env: Record<string, string | undefined>): boolean {
  return economyAuthorityEnvKeys().some((key) => (env[key] ?? "").trim().length > 0);
}

/**
 * True when SOMETHING configures a hosted authority for economy: the
 * `HASNA_ECONOMY_API_URL` env key (or its legacy alias), the Keychain
 * `api-url` item, or the `~/.hasna/economy/config/credentials` file.
 *
 * It asks the SAME three sources, in the same order and through the same
 * @hasna/contracts entry points, that `createClientTransport` consults before
 * it falls back to the fleet gateway; the gateway default is deliberately NOT
 * one of them, because a default that always applies would make this always
 * true. It drives the fail-closed message's way-out branch: an opted-in run
 * with a configured authority is a half-applied hosted run, and the error says
 * so instead of inviting the operator to use a different dataset.
 */
export function hostedAuthorityConfigured(
  env: Record<string, string | undefined>,
  options: EconomyStorageClientOverrides = {},
): boolean {
  const keys = clientTransportEnvKeys(ECONOMY_APP);
  if (keys.apiUrlKeys.some((key) => (env[key] ?? "").trim().length > 0)) return true;
  if (keychainConfigValue(ECONOMY_APP, env, options.credentials?.keychain) !== null) return true;
  return appConfigDiskValue(ECONOMY_APP, env, keys.apiUrlKeys) !== null;
}

/**
 * The environment as the resolver should see it: every authority/credential
 * variable that is DECLARED BUT BLANK removed.
 *
 * A blank has always been this package's spelling for "not configured" — it is
 * how the CLI's spawned-process fixtures neutralise an inherited fleet
 * environment and how consumer fixtures still write it. @hasna/contracts takes
 * the opposite and, for its purposes, correct view: a declared-but-blank
 * credential is a misconfiguration it refuses loudly rather than resolving
 * around. Both are right at their own layer: a blank that means "unset" at the
 * economy seam is not a credential the operator named.
 */
export function economyResolverEnv<T extends Record<string, string | undefined>>(env: T): T {
  const blanks = economyAuthorityEnvKeys().filter(
    (key) => key in env && (env[key] ?? "").trim() === "",
  );
  if (blanks.length === 0) return env;
  const next = { ...env } as T;
  for (const key of blanks) delete next[key];
  return next;
}

/**
 * @hasna/contracts marks the LIVE process environment with this symbol so its
 * ambient tiers — the macOS Keychain `api-key` and `api-url` items, which
 * belong to the machine rather than to any env object — know they were handed
 * the real environment and not a caller-built one. It is a registry symbol
 * precisely so a normaliser like ours can read it without importing internals.
 */
const CONTRACTS_AMBIENT_ENVIRONMENT = Symbol.for("hasna:contracts:ambientClientEnvironment");

/** Is this the environment the machine's ambient credential stores belong to? */
function isAmbientEconomyEnv(env: Record<string, string | undefined>): boolean {
  if (typeof process !== "undefined" && (env as unknown) === (process.env as unknown)) return true;
  return (env as unknown as Record<symbol, unknown>)[CONTRACTS_AMBIENT_ENVIRONMENT] === true;
}

/**
 * Build the resolver's inputs: the normalised environment AND the credential
 * options that keep the machine's Keychain tier reachable across it.
 *
 * Dropping a declared-but-blank variable hands @hasna/contracts a COPY, and
 * the resolver gates its ambient tiers on object identity (`env === process.env`,
 * or the registry symbol its own snapshot carries). A copy is, by that test, a
 * caller-built world — the hermetic seam — so the Keychain is outside it and
 * tier 3 turns itself off silently, dropping a station from its Keychain
 * identity to the next tier in the chain. The gate is decided HERE, on the
 * original env, and carried across as the documented `keychain.enabled` control
 * rather than being left to an identity test the copy cannot pass (hasna/apps#1788).
 */
export function economyResolverInputs<T extends Record<string, string | undefined>>(
  env: T,
  credentials: CredentialChainOptions = {},
): { env: T; credentials: CredentialChainOptions } {
  const normalised = economyResolverEnv(env);
  if (normalised === env) return { env: normalised, credentials };
  const keychain = { ...credentials.keychain };
  if (keychain.enabled === undefined && keychain.run === undefined) {
    keychain.enabled = isAmbientEconomyEnv(env);
  }
  return { env: normalised, credentials: { ...credentials, keychain } };
}

/**
 * Resolve the authenticated economy HTTP storage client for this environment.
 *
 * There is no `local` branch here on purpose: a client never infers a local
 * dataset from missing configuration. When nothing resolves, the shared
 * resolver THROWS and the caller decides (see {@link resolveEconomyCloudStorage}).
 */
export interface ResolvedEconomyStorageClient {
  transport: "http";
  client: HasnaStorageClient;
  resolution: ClientTransportResolution;
}

/** The one call the storage seam makes: resolve the http client from the env. */
export function resolveEconomyStorageClient(
  name: string,
  env: Record<string, string | undefined>,
  overrides: EconomyStorageClientOverrides = {},
): ResolvedEconomyStorageClient {
  const { env: resolverEnv, credentials } = economyResolverInputs(env, overrides.credentials);
  const wired = createClientTransport(name, resolverEnv, {
    credentials,
    ...(overrides.fetchImpl ? { fetchImpl: overrides.fetchImpl } : {}),
    ...(overrides.headers ? { headers: overrides.headers } : {}),
    ...(overrides.timeoutMs ? { timeoutMs: overrides.timeoutMs } : {}),
    ...(overrides.retry !== undefined ? { retry: overrides.retry } : {}),
    ...(overrides.sleepImpl ? { sleepImpl: overrides.sleepImpl } : {}),
  });
  return {
    transport: "http",
    client: createHasnaStorageClient(name, wired.client),
    resolution: wired.resolution,
  };
}

/**
 * The one line a local run prints, so an unhosted run can never be mistaken for
 * a hosted one that came back empty (owner directive 2026-09-04). It goes to
 * stderr, so `--json` stdout stays machine-readable.
 */
export function localEconomyNotice(): string {
  return (
    `economy: local mode (${LOCAL_STORAGE_OPT_IN_KEYS[0]}=1) — reading and writing the on-box ` +
    `SQLite store, not the hosted fleet. Data in the shared economy API is NOT included.`
  );
}

/**
 * The fail-closed error for a run with no credential and no local opt-in.
 *
 * The message is the documentation surface: it carries the resolver's own
 * diagnostic (which names the Keychain item, the credentials file it looked
 * for, and `HASNA_ECONOMY_API_KEY`) and adds the local opt-in, which the shared
 * resolver cannot know about.
 */
export function credentialRequiredError(env: NodeJS.ProcessEnv, cause?: unknown): Error {
  const keys = clientTransportEnvKeys(ECONOMY_APP);
  const clientEnv = env as Record<string, string | undefined>;
  const detail =
    cause instanceof Error
      ? cause.message
      : `No API key could be resolved for '${ECONOMY_APP}'. Looked in the Keychain (macOS only), ` +
        `then for a credential file at ${credentialDiskSources(ECONOMY_APP, clientEnv).join(" or ") || "<no HOME set>"}, ` +
        `then for ${keys.apiKeyKeys[0]} in the environment.`;
  const wayOut = hostedAuthorityConfigured(clientEnv)
    ? `${keys.apiUrlKeys[0]} (or the Keychain hasna.credentials.${ECONOMY_APP}.api-url item, or ` +
      `~/.hasna/${ECONOMY_APP}/config/credentials) selects a hosted service, so ${LOCAL_STORAGE_OPT_IN_KEYS[0]} ` +
      `does not apply; unset the authority to use the local store.`
    : `Or set ${LOCAL_STORAGE_OPT_IN_KEYS[0]}=1 to explicitly opt into the local store.`;
  return new Error(
    `Economy fails closed instead of silently serving the local SQLite store: ${detail} ` +
      `Set ${keys.apiUrlKeys[0]} and ${keys.apiKeyKeys[0]} (or store the key in the Keychain item ` +
      `hasna.credentials.${ECONOMY_APP}.api-key, or in ~/.hasna/${ECONOMY_APP}/config/credentials) to use the ` +
      `hosted economy API at ${keys.apiUrlKeys[0]} or the default fleet gateway. ` +
      wayOut,
  );
}

let cache: EconomyCloudStorage | undefined;
let localNoticePrinted = false;

/**
 * Resolve the economy client storage transport for the current environment.
 *
 * Returns `{ active: true, client }` only when @hasna/contracts resolves an
 * authenticated HTTP transport (a credential from any tier, authority defaulted
 * to the fleet gateway). Returns `{ active: false }` (local store) only when
 * the explicit local opt-in (`HASNA_ECONOMY_LOCAL=1` / `ECONOMY_LOCAL=1`) is
 * set AND no hosted authority or credential resolves. Throws in every other
 * unconfigured case — the error names the required API environment so a
 * missing-env run can never silently serve the local dataset.
 */
export function resolveEconomyCloudStorage(
  env: NodeJS.ProcessEnv = process.env,
  overrides?: EconomyStorageClientOverrides,
): EconomyCloudStorage {
  assertNoRetiredStorageMode(env);
  const clientEnv = env as Record<string, string | undefined>;

  // The local lane is checked first ONLY to answer "is this an unhosted run?" —
  // it still yields to EVERY hosted signal, so an opted-in station that is also
  // configured for the fleet keeps talking to the fleet rather than quietly
  // diverging from it. The check is the env dictionary ALONE (the @hasna/todos
  // local-opt-in pattern): answering it must not touch the Keychain or the
  // credential file, because the opt-in's whole promise is that an unhosted
  // run is isolated from the machine's ambient stores. A configured authority
  // still outranks the opt-in — a URL without a key is a half-applied hosted
  // run and fails loudly in the resolver below, never a silent local serve.
  if (localStorageExplicitlyOptedIn(env) && !hasEconomyEnvAuthorityIntent(clientEnv)) {
    return { active: false, client: null };
  }

  let resolved: ResolvedEconomyStorageClient;
  try {
    resolved = resolveEconomyStorageClient(ECONOMY_APP, clientEnv, overrides ?? {});
  } catch (error) {
    if (error instanceof ClientTransportConfigurationError) {
      throw credentialRequiredError(env, error);
    }
    throw error;
  }
  return { active: true, client: resolved.client };
}

/**
 * Memoized {@link resolveEconomyCloudStorage} for the process lifetime.
 *
 * A local-mode resolution (the explicit opt-in) announces itself on stderr with
 * one line, once per process, so an unhosted run is never mistaken for a hosted
 * one that came back empty (owner directive 2026-09-04). The notice goes to
 * stderr so `--json` stdout stays machine-readable. The memoization never
 * stalls a credential rotation: the @hasna/contracts transport behind a hosted
 * client re-resolves its credential on EVERY request, so a long-lived MCP
 * server or SDK consumer picks up a new key without a restart.
 */
export function economyCloudStorage(env: NodeJS.ProcessEnv = process.env): EconomyCloudStorage {
  if (cache === undefined) {
    cache = resolveEconomyCloudStorage(env);
    if (!cache.active && !localNoticePrinted) {
      localNoticePrinted = true;
      if (typeof process !== "undefined") process.stderr.write(`${localEconomyNotice()}\n`);
    }
  }
  return cache;
}

/** Test-only: drop the memoized resolution so a new env can be resolved. */
export function resetEconomyCloudStorageCache(): void {
  cache = undefined;
  localNoticePrinted = false;
}

/** Active cloud storage (narrowed so `client` is non-null). */
export type ActiveEconomyCloudStorage = Extract<EconomyCloudStorage, { active: true }>;

/** Query params accepted by the read helpers below. */
export type CloudQuery = Record<string, string | number | boolean | null | undefined>;

/** Drop undefined/null entries so we never send empty query params. */
function cleanQuery(query?: CloudQuery): CloudQuery | undefined {
  if (!query) return undefined;
  const out: CloudQuery = {};
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null && v !== "") out[k] = v;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Read a collection resource from the cloud API and return the extracted array
 * (the serve envelope's `data`/`items`). Used by the read commands (sessions,
 * top, breakdown, accounts) so they render cloud data — never the local store —
 * when the client is on the http transport.
 */
export async function cloudListItems<T = unknown>(
  storage: ActiveEconomyCloudStorage,
  resource: string,
  query?: CloudQuery,
): Promise<T[]> {
  const cleaned = cleanQuery(query);
  const res = await storage.client.list<T>(resource, cleaned ? { query: cleaned } : {});
  return res.items;
}

/**
 * Read a single (non-collection) resource and return the unwrapped `data`
 * payload (e.g. `/usage` -> `{ snapshots, summary }`). Falls back to the raw
 * body if the server does not use the `{ data }` envelope.
 */
export async function cloudObject<T = unknown>(
  storage: ActiveEconomyCloudStorage,
  path: string,
  query?: CloudQuery,
): Promise<T> {
  const cleaned = cleanQuery(query);
  const raw = await storage.client.transport.get<unknown>(path, cleaned ? { query: cleaned } : {});
  if (raw && typeof raw === "object" && "data" in (raw as Record<string, unknown>)) {
    return (raw as { data: T }).data;
  }
  return raw as T;
}

/**
 * The transport decision, rendered for operators (the `economy status` /
 * `economy transport` surfaces and diagnostics). Reports WHERE the authority and
 * credential came from — never the credential value.
 */
export interface EconomyTransportAuthority {
  /** `<origin>/v1` base for the server API, or null when nothing resolved. */
  baseUrl: string | null;
  /** An env key NAME, a Keychain reference, a file PATH, or `"default"`. */
  apiUrlSource: string | null;
  /** An env key NAME, a Keychain reference, or a file PATH. Never a value. */
  apiKeySource: string | null;
  /** Which tier of the credential chain supplied the key. */
  apiKeyTier: string | null;
  /** Human-readable warning, or null. Never contains secret values. */
  warning: string | null;
}

export interface EconomyTransportReport {
  ok: boolean;
  /** True when this process is a client of a resolved store (hosted or local). */
  selected: boolean;
  transport: "http" | "sqlite";
  /** `"local-opt-in"` for the explicit local lane, else the http transport source. */
  source: string | null;
  authority: EconomyTransportAuthority | null;
  /** Human-readable issues when `ok` is false (the fail-closed refusal). */
  issues: string[];
}

/**
 * Resolve the economy transport and report the decision WITHOUT throwing.
 *
 * The one surface that must not fail the process on a missing credential: a
 * status command that throws would turn "tell me why I am unconfigured" into a
 * crash. Everything else calls {@link resolveEconomyCloudStorage} and fails
 * closed.
 */
export function economyTransportReport(
  env: NodeJS.ProcessEnv = process.env,
  overrides?: EconomyStorageClientOverrides,
): EconomyTransportReport {
  const clientEnv = env as Record<string, string | undefined>;
  assertNoRetiredStorageMode(env);

  if (localStorageExplicitlyOptedIn(env) && !hasEconomyEnvAuthorityIntent(clientEnv)) {
    return {
      ok: true,
      selected: true,
      transport: "sqlite",
      source: "local-opt-in",
      authority: null,
      issues: [],
    };
  }

  try {
    const resolved = resolveEconomyStorageClient(ECONOMY_APP, clientEnv, overrides ?? {});
    return {
      ok: true,
      selected: true,
      transport: "http",
      source: resolved.resolution.transportSource,
      authority: {
        baseUrl: resolved.resolution.baseUrl,
        apiUrlSource: resolved.resolution.apiUrlSource,
        apiKeySource: resolved.resolution.apiKeySource,
        apiKeyTier: resolved.resolution.apiKeyTier,
        warning: resolved.resolution.warning,
      },
      issues: [],
    };
  } catch (error) {
    if (error instanceof ClientTransportConfigurationError) {
      return {
        ok: false,
        selected: true,
        transport: "http",
        source: null,
        authority: null,
        issues: [error.message],
      };
    }
    throw error;
  }
}
