/**
 * Runtime configuration for @hasna/loops.
 *
 * Deployment modes were removed: there is no `local | self_hosted | cloud`
 * axis, no mode enums, and no `HASNA_LOOPS_STORAGE_MODE` (the retired switch
 * is not read anywhere in this package). The only technical switches left are
 * the server's data backend (`sqlite | postgresql`, selected by
 * `HASNA_LOOPS_DATABASE_URL`) and the client's connection, which the SHARED
 * credential resolver decides (`@hasna/contracts` 1.0.2: env, Keychain,
 * credential file; see `lib/cloud/resolve.ts`).
 *
 * The client connects to a local SQLite file or to the server HTTP API. It
 * never opens Postgres directly: `HASNA_LOOPS_DATABASE_URL` is server-only and
 * is never used to connect from the client — at most its *presence* is
 * reported.
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

const API_URL_ENV_KEYS = ["HASNA_LOOPS_API_URL"] as const;
const API_KEY_ENV_KEYS = ["HASNA_LOOPS_API_KEY"] as const;
const DATABASE_URL_ENV_KEYS = ["HASNA_LOOPS_DATABASE_URL"] as const;

/** The first env key with a non-blank value among `keys`, or undefined. */
export function envValue(env: Env, keys: readonly string[]): { key: string; value: string } | undefined {
  for (const key of keys) {
    const value = env[key]?.trim();
    if (value) return { key, value };
  }
  return undefined;
}

/**
 * Resolve the runtime configuration from the environment.
 *
 * The connection is `api` iff BOTH HASNA_LOOPS_API_URL and HASNA_LOOPS_API_KEY
 * are present; a partial remote configuration (exactly one of them) throws,
 * naming the missing variable. Otherwise the connection is `file`. Server-side
 * storage is `postgresql` iff HASNA_LOOPS_DATABASE_URL is present; clients
 * never read the DSN value itself, only its presence.
 *
 * This is the env-PRESENCE report used by server surfaces (loops-serve, the
 * API foundation, doctor). The client data path and the CLI `status` command
 * resolve the connection through the shared credential resolver instead
 * (lib/cloud/resolve.ts), so a Keychain or credential-file identity reports
 * `api` even when no env variable is set.
 */
export function resolveRuntimeConfig(env: Env = process.env): RuntimeConfig {
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
 * Presence booleans for the control-plane env vars. The API key value is never
 * returned.
 */
export function loopControlPlaneConfig(env: Env = process.env): LoopControlPlaneConfig {
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
  return envValue(env, DATABASE_URL_ENV_KEYS) ? "postgresql" : "sqlite";
}

/** Storage-kit backend token for loops-serve ("sqlite" | "postgres"). */
export type RuntimeStorageBackend = "sqlite" | "postgres";

export function runtimeStorageBackend(env: Env = process.env): RuntimeStorageBackend {
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