// ── Loops storage backend contract ───────────────────────────────────────────
//
// ONE data-backend axis, two seams — there is no deployment-mode axis:
//
//   • Client store seam (CLI / MCP / SDK): `sqlite | http`. The client reads a
//     local SQLite file OR the server's HTTP `/v1` API. It NEVER opens a
//     Postgres connection directly.
//   • Server data backend (loops-serve / daemon): `sqlite | postgres`. The
//     on-box daemon schedules from SQLite; `loops-serve` runs against Postgres
//     selected by HASNA_LOOPS_DATABASE_URL.
//
// `HASNA_LOOPS_STORAGE_MODE` pins the CLIENT transport (`sqlite` forces the
// on-box file even when API vars are present — the reversible escape hatch;
// `http` requires the API vars). The database URL selects the server backend
// and nothing else: a DSN on a client machine does not change what the client
// reads.

import { packageVersion } from "./version.js";

export const LOOP_CLIENT_TRANSPORTS = ["sqlite", "http"] as const;
export type LoopClientTransport = (typeof LOOP_CLIENT_TRANSPORTS)[number];

export const LOOP_DATA_BACKENDS = ["sqlite", "postgres"] as const;
export type LoopDataBackend = (typeof LOOP_DATA_BACKENDS)[number];

/** Which store is authoritative for loop data on this machine. */
export type LoopStorageAuthority = "local_sqlite" | "server_api";

export type LoopRemoteSchedulerBackend =
  | "none"
  | "unconfigured"
  | "api_control_plane_contract"
  | "postgres_contract";
export type LoopRemoteArtifactStore = "none" | "object_store_contract";
export type LoopRouteAdmissionStateStore = "local_sqlite" | "control_plane_contract";
export type LoopRouteAdmissionGate =
  | "max_dispatch"
  | "max_active"
  | "max_active_per_project"
  | "max_active_per_project_group"
  | "max_active_scope"
  | "max_per_profile";

export interface LoopClientTransportResolution {
  transport: LoopClientTransport;
  source: string;
}

export interface LoopDataBackendResolution {
  backend: LoopDataBackend;
  source: string;
}

export interface LoopServerConfig {
  apiUrl?: string;
  databaseUrlPresent: boolean;
  apiKeyPresent: boolean;
}

export interface LoopStorageStatus {
  packageVersion: string;
  /** Server-side data backend of THIS process (postgres iff the DSN is set). */
  dataBackend: LoopDataBackend;
  /** Client store seam: on-box sqlite file or the server's HTTP API. */
  clientTransport: LoopClientTransport;
  /** Which store is authoritative for loop data on this machine. */
  authority: LoopStorageAuthority;
  /** Env key the authority decision came from, or `"default"`. */
  authoritySource: string;
  localStore: {
    backend: "sqlite";
    role: "authoritative" | "cache_and_spool";
  };
  server: {
    configured: boolean;
    apiUrl?: string;
    databaseUrlPresent: boolean;
    apiKeyPresent: boolean;
  };
  runner: {
    required: boolean;
    role: "daemon" | "control_plane_worker";
  };
  schedulerState: LoopSchedulerStateStatus;
  warnings: string[];
}

export interface LoopSchedulerStateStatus {
  authority: LoopStorageAuthority;
  localStore: {
    backend: "sqlite";
    role: "authoritative" | "cache_and_spool";
    runArtifacts: "local_files";
    routeAdmissionState: "workflow_work_items";
  };
  remoteStore: {
    backend: LoopRemoteSchedulerBackend;
    configured: boolean;
    applySupported: boolean;
    objectArtifacts: LoopRemoteArtifactStore;
    mutatesAws: false;
  };
  routeAdmission: {
    stateStore: LoopRouteAdmissionStateStore;
    activeStatuses: readonly ["admitted", "running"];
    gates: readonly LoopRouteAdmissionGate[];
    dryRunEvaluatesLiveCounts: false;
  };
}

const MODE_ENV_KEYS = ["HASNA_LOOPS_STORAGE_MODE"] as const;
const API_URL_ENV_KEYS = ["HASNA_LOOPS_API_URL"] as const;
const DATABASE_URL_ENV_KEYS = ["HASNA_LOOPS_DATABASE_URL"] as const;
const API_KEY_ENV_KEYS = ["HASNA_LOOPS_API_KEY"] as const;

type Env = Record<string, string | undefined>;

function envValue(env: Env, keys: readonly string[]): { key: string; value: string } | undefined {
  for (const key of keys) {
    const value = env[key]?.trim();
    if (value) return { key, value };
  }
  return undefined;
}

// Deployed fleets still carry the retired deployment-mode values in their
// environment; they keep selecting the backend they always selected. Every
// spelling lives on a marked line so the shim stays bounded and greppable.
const LEGACY_CLIENT_TRANSPORT_ALIASES: Record<string, LoopClientTransport> = {
  local: "sqlite", // LEGACY-DEPLOYMENT-MODE-ALIAS
  self_hosted: "http", // LEGACY-DEPLOYMENT-MODE-ALIAS
  cloud: "http", // LEGACY-DEPLOYMENT-MODE-ALIAS
};

export function normalizeLoopClientTransport(value: string): LoopClientTransport {
  const normalized = value.trim();
  if (normalized === "sqlite") return "sqlite";
  if (normalized === "http") return "http";
  const alias = LEGACY_CLIENT_TRANSPORT_ALIASES[normalized];
  if (alias) return alias;
  throw new Error(`unsupported Loops storage mode "${value}"; expected sqlite or http`);
}

/**
 * Resolve the client store transport: an explicit pin wins; otherwise the
 * presence of an API URL selects http; the default is the on-box sqlite file.
 */
export function resolveLoopClientTransport(env: Env = process.env): LoopClientTransportResolution {
  const explicit = envValue(env, MODE_ENV_KEYS);
  if (explicit) {
    return {
      transport: normalizeLoopClientTransport(explicit.value),
      source: explicit.key,
    };
  }
  const apiUrl = envValue(env, API_URL_ENV_KEYS);
  if (apiUrl) return { transport: "http", source: apiUrl.key };
  return { transport: "sqlite", source: "default" };
}

/**
 * Resolve the server-side data backend of this process. The database URL — and
 * only the database URL — selects postgres. The client pin never does: the
 * client is sqlite-or-http and never opens Postgres directly.
 */
export function resolveLoopDataBackend(env: Env = process.env): LoopDataBackendResolution {
  const databaseUrl = envValue(env, DATABASE_URL_ENV_KEYS);
  if (databaseUrl) return { backend: "postgres", source: databaseUrl.key };
  return { backend: "sqlite", source: "default" };
}

export function loopServerConfig(env: Env = process.env): LoopServerConfig {
  return {
    apiUrl: envValue(env, API_URL_ENV_KEYS)?.value,
    databaseUrlPresent: Boolean(envValue(env, DATABASE_URL_ENV_KEYS)),
    apiKeyPresent: Boolean(envValue(env, API_KEY_ENV_KEYS)),
  };
}

const ROUTE_ADMISSION_GATES = [
  "max_dispatch",
  "max_active",
  "max_active_per_project",
  "max_active_per_project_group",
  "max_active_scope",
  "max_per_profile",
] as const satisfies readonly LoopRouteAdmissionGate[];

interface AuthorityResolution {
  authority: LoopStorageAuthority;
  source: string;
}

/**
 * Which store is authoritative on this machine: an explicit sqlite pin keeps
 * the on-box file authoritative; an explicit http pin, an API URL, or a
 * database URL hands authority to the server contract.
 */
function resolveAuthority(env: Env): AuthorityResolution {
  const explicit = envValue(env, MODE_ENV_KEYS);
  if (explicit) {
    const transport = normalizeLoopClientTransport(explicit.value);
    return {
      authority: transport === "sqlite" ? "local_sqlite" : "server_api",
      source: explicit.key,
    };
  }
  const apiUrl = envValue(env, API_URL_ENV_KEYS);
  if (apiUrl) return { authority: "server_api", source: apiUrl.key };
  const databaseUrl = envValue(env, DATABASE_URL_ENV_KEYS);
  if (databaseUrl) return { authority: "server_api", source: databaseUrl.key };
  return { authority: "local_sqlite", source: "default" };
}

function remoteSchedulerBackend(
  authority: LoopStorageAuthority,
  config: LoopServerConfig,
): LoopRemoteSchedulerBackend {
  if (authority === "local_sqlite") return "none";
  if (config.databaseUrlPresent) return "postgres_contract";
  if (config.apiUrl) return "api_control_plane_contract";
  return "unconfigured";
}

function schedulerState(args: {
  authority: LoopStorageAuthority;
  localRole: LoopSchedulerStateStatus["localStore"]["role"];
  serverConfigured: boolean;
  config: LoopServerConfig;
}): LoopSchedulerStateStatus {
  const remote = args.authority === "server_api";
  return {
    authority: args.authority,
    localStore: {
      backend: "sqlite",
      role: args.localRole,
      runArtifacts: "local_files",
      routeAdmissionState: "workflow_work_items",
    },
    remoteStore: {
      backend: remoteSchedulerBackend(args.authority, args.config),
      configured: remote && args.serverConfigured,
      applySupported: false,
      objectArtifacts: remote ? "object_store_contract" : "none",
      mutatesAws: false,
    },
    routeAdmission: {
      stateStore: remote ? "control_plane_contract" : "local_sqlite",
      activeStatuses: ["admitted", "running"],
      gates: ROUTE_ADMISSION_GATES,
      dryRunEvaluatesLiveCounts: false,
    },
  };
}

function displayServerUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    const path = url.pathname === "/" ? "" : url.pathname.replace(/\/+$/g, "");
    return `${url.origin}${path}`;
  } catch {
    return "[invalid-url]";
  }
}

export function buildStorageStatus(opts: { env?: Env } = {}): LoopStorageStatus {
  const env = opts.env ?? process.env;
  const { authority, source } = resolveAuthority(env);
  const config = loopServerConfig(env);
  const apiUrl = displayServerUrl(config.apiUrl);
  const remote = authority === "server_api";
  const serverConfigured = Boolean(config.apiUrl || config.databaseUrlPresent);
  const clientTransport: LoopClientTransport =
    !remote ? "sqlite" : config.apiUrl && config.apiKeyPresent ? "http" : "sqlite";
  const dataBackend = resolveLoopDataBackend(env).backend;
  const warnings: string[] = [];

  if (remote && !serverConfigured) {
    warnings.push("server authority needs HASNA_LOOPS_API_URL or HASNA_LOOPS_DATABASE_URL before it can become authoritative");
  }
  if (remote && config.databaseUrlPresent && !config.apiUrl) {
    warnings.push("HASNA_LOOPS_DATABASE_URL selects the loops-serve postgres backend; loops-runner still needs HASNA_LOOPS_API_URL to claim remote work");
  }
  if (remote && config.apiUrl && !config.apiKeyPresent) {
    warnings.push("the http client transport needs HASNA_LOOPS_API_KEY before it can reach the server");
  }

  return {
    packageVersion: packageVersion(),
    dataBackend,
    clientTransport,
    authority,
    authoritySource: source,
    localStore: {
      backend: "sqlite",
      role: remote ? "cache_and_spool" : "authoritative",
    },
    server: {
      configured: serverConfigured,
      apiUrl,
      databaseUrlPresent: config.databaseUrlPresent,
      apiKeyPresent: config.apiKeyPresent,
    },
    runner: {
      required: remote,
      role: remote ? "control_plane_worker" : "daemon",
    },
    schedulerState: schedulerState({
      authority,
      localRole: remote ? "cache_and_spool" : "authoritative",
      serverConfigured,
      config,
    }),
    warnings,
  };
}

export function storageStatusLine(status: LoopStorageStatus): string {
  return [
    `backend=${status.dataBackend}`,
    `client=${status.clientTransport}`,
    `authority=${status.authority}`,
    `source=${status.authoritySource}`,
    `local=${status.localStore.role}`,
    `scheduler=${status.schedulerState.routeAdmission.stateStore}`,
    `server=${String(status.server.configured)}`,
  ].join(" ");
}
