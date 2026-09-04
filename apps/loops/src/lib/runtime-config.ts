/**
 * Runtime configuration for @hasna/loops.
 *
 * Deployment modes were removed: there is no `local | self_hosted | cloud`
 * axis, no mode enums, and no `HASNA_LOOPS_STORAGE_MODE`. The only technical
 * switches left are the server's data backend (`sqlite | postgresql`, selected
 * by `HASNA_LOOPS_DATABASE_URL`) and the client's connection
 * (`file | api`, selected by `HASNA_LOOPS_API_URL` + `HASNA_LOOPS_API_KEY`).
 *
 * The client connects to a local SQLite file or to the server HTTP API. It
 * never opens Postgres directly: `HASNA_LOOPS_DATABASE_URL` is server-only and
 * is never used to connect from the client — at most its *presence* is
 * reported. A retired `HASNA_LOOPS_STORAGE_MODE` env is rejected with a hard
 * error (closed matrix: old mode env is never honored).
 */

export type Env = Record<string, string | undefined>;

/** Server-side storage backend; `postgresql` iff HASNA_LOOPS_DATABASE_URL is present. */
export type RuntimeStorage = "sqlite" | "postgresql";

/** Client connection transport: local file or server HTTP API. */
export type RuntimeConnection = "file" | "api";

export interface RuntimeConfig {
  /** Server-side storage backend this runtime should use. */
  storage: RuntimeStorage;
  /** Client connection transport. */
  connection: RuntimeConnection;
  /** Raw API URL value; never print it — scrub with displayControlPlaneUrl. */
  apiUrl?: string;
  apiUrlPresent: boolean;
  apiKeyPresent: boolean;
  databaseUrlPresent: boolean;
}

/** Presence report for the control-plane env vars; never contains values of keys. */
export interface LoopControlPlaneConfig {
  apiUrl?: string;
  apiUrlPresent: boolean;
  apiKeyPresent: boolean;
  databaseUrlPresent: boolean;
}

export type LoopRouteAdmissionGate =
  | "max_dispatch"
  | "max_active"
  | "max_active_per_project"
  | "max_active_per_project_group"
  | "max_active_scope"
  | "max_per_profile";

/** Policy gates applied to route admission; kept unchanged from the pre-mode-removal contract. */
export const ROUTE_ADMISSION_GATES = [
  "max_dispatch",
  "max_active",
  "max_active_per_project",
  "max_active_per_project_group",
  "max_active_scope",
  "max_per_profile",
] as const satisfies readonly LoopRouteAdmissionGate[];

const STORAGE_MODE_ENV_KEYS = ["HASNA_LOOPS_STORAGE_MODE"] as const;
const API_URL_ENV_KEYS = ["HASNA_LOOPS_API_URL"] as const;
const API_KEY_ENV_KEYS = ["HASNA_LOOPS_API_KEY"] as const;
const DATABASE_URL_ENV_KEYS = ["HASNA_LOOPS_DATABASE_URL"] as const;

function envValue(env: Env, keys: readonly string[]): { key: string; value: string } | undefined {
  for (const key of keys) {
    const value = env[key]?.trim();
    if (value) return { key, value };
  }
  return undefined;
}

/**
 * Closed-matrix rejection of the retired mode env: a non-empty
 * HASNA_LOOPS_STORAGE_MODE is a hard error naming the variable as retired,
 * never honored. An empty/blank value counts as unset.
 *
 * Exported so the client store resolution path (getStore -> resolveCloudStorage)
 * rejects a leftover env as loudly as status/doctor/serve do, instead of
 * silently reading the wrong dataset.
 */
export function assertNoRetiredStorageMode(env: Env): void {
  const mode = envValue(env, STORAGE_MODE_ENV_KEYS);
  if (mode) {
    throw new Error(
      `HASNA_LOOPS_STORAGE_MODE is retired and must be removed: deployment modes no longer exist ` +
        `(found ${mode.key}="${mode.value}"). Configure the client connection with HASNA_LOOPS_API_URL and ` +
        `HASNA_LOOPS_API_KEY, and server storage with HASNA_LOOPS_DATABASE_URL.`,
    );
  }
}

/**
 * Resolve the runtime configuration from the environment.
 *
 * The connection is `api` iff BOTH HASNA_LOOPS_API_URL and HASNA_LOOPS_API_KEY
 * are present; a partial remote configuration (exactly one of them) throws,
 * naming the missing variable. Otherwise the connection is `file`. Server-side
 * storage is `postgresql` iff HASNA_LOOPS_DATABASE_URL is present; clients
 * never read the DSN value itself, only its presence.
 */
export function resolveRuntimeConfig(env: Env = process.env): RuntimeConfig {
  assertNoRetiredStorageMode(env);
  const apiUrl = envValue(env, API_URL_ENV_KEYS);
  const apiKey = envValue(env, API_KEY_ENV_KEYS);
  if (apiUrl && !apiKey) {
    throw new Error(
      "HASNA_LOOPS_API_URL is set without HASNA_LOOPS_API_KEY; an API connection requires both " +
        "(set HASNA_LOOPS_CONNECTION=file for the explicit local file connection)",
    );
  }
  if (apiKey && !apiUrl) {
    throw new Error(
      "HASNA_LOOPS_API_KEY is set without HASNA_LOOPS_API_URL; an API connection requires both " +
        "(set HASNA_LOOPS_CONNECTION=file for the explicit local file connection)",
    );
  }
  const databaseUrlPresent = Boolean(envValue(env, DATABASE_URL_ENV_KEYS));
  return {
    storage: databaseUrlPresent ? "postgresql" : "sqlite",
    connection: apiUrl && apiKey ? "api" : "file",
    apiUrl: apiUrl?.value,
    apiUrlPresent: Boolean(apiUrl),
    apiKeyPresent: Boolean(apiKey),
    databaseUrlPresent,
  };
}

/**
 * Successor to the pre-mode-removal `loopControlPlaneConfig`: presence booleans
 * for the control-plane env vars. The API key value is never returned.
 */
export function loopControlPlaneConfig(env: Env = process.env): LoopControlPlaneConfig {
  assertNoRetiredStorageMode(env);
  const apiUrl = envValue(env, API_URL_ENV_KEYS);
  return {
    apiUrl: apiUrl?.value,
    apiUrlPresent: Boolean(apiUrl),
    apiKeyPresent: Boolean(envValue(env, API_KEY_ENV_KEYS)),
    databaseUrlPresent: Boolean(envValue(env, DATABASE_URL_ENV_KEYS)),
  };
}

/** Server-side storage backend selector for loops-serve. */
export function runtimeStorage(env: Env = process.env): RuntimeStorage {
  assertNoRetiredStorageMode(env);
  return envValue(env, DATABASE_URL_ENV_KEYS) ? "postgresql" : "sqlite";
}

/** Storage-kit backend token for loops-serve ("sqlite" | "postgres"). */
export type RuntimeStorageBackend = "sqlite" | "postgres";

export function runtimeStorageBackend(env: Env = process.env): RuntimeStorageBackend {
  assertNoRetiredStorageMode(env);
  return envValue(env, DATABASE_URL_ENV_KEYS) ? "postgres" : "sqlite";
}

/**
 * Scrub a control-plane URL for display: origin + path only, dropping any
 * credentials, query, and fragment. Returns "[invalid-url]" for unparsable
 * values and undefined for empty ones.
 */
export function displayControlPlaneUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    const path = url.pathname === "/" ? "" : url.pathname.replace(/\/+$/g, "");
    return `${url.origin}${path}`;
  } catch {
    return "[invalid-url]";
  }
}
