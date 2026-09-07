// ============================================================================
// Resolved-store reporting — "which store am I about to hit?"
//
// A mementos process has exactly two transport notions, and both are resolved
// from the environment alone:
//
//   - the CLIENT transport (`isApiMode()`, src/db/api-mode.ts) — local SQLite
//     or the HTTP API, decided by the @hasna/contracts credential chain (env
//     key, macOS Keychain, or `~/.hasna/mementos/config/credentials`) against
//     the deliberate local opt-ins (`HASNA_MEMENTOS_DB_PATH` /
//     `HASNA_MEMENTOS_LOCAL`); a half configuration throws naming the missing
//     variable.
//   - the SERVER backend (`getStorageBackend()`, src/storage.ts) — sqlite or
//     postgresql, selected by HASNA_MEMENTOS_DATABASE_URL presence. The
//     DIRECT Postgres path is server-only.
//
// There are no deployment modes (owner directive 2026-07-29; knowledge
// k_ms5wv466_u0jidq); the retired storage-mode variables are inert and nothing
// reads them.
//
// On a client, `isApiMode()` wins: the memory paths route to HTTP before
// `getDatabase()` is ever consulted, so the server backend can report `sqlite`
// while every write goes to the shared store. Reading either value alone is
// therefore misleading — this module composes the single answer.
//
// It resolves from the environment ONLY: no SQLite file is opened, no HTTP
// request is made, no credential value is read into the report. That makes it
// safe to call from an operator's shell, from a health check, and (critically)
// from a test harness that needs to prove it is isolated BEFORE it writes
// anything. See src/test-support/store-isolation.ts.
// ============================================================================

import { getDbPath } from "./database.js";
import {
  getApiConfig,
  getApiModeEnvSources,
  getConfiguredApiEnv,
  getResolvedApiModeReport,
  isApiMode,
} from "./api-mode.js";
import { getStorageBackend } from "../storage.js";

/**
 * The transport that reads and writes will actually use.
 *
 * - `local-sqlite`   — the on-disk SQLite file at `db_path` is authoritative.
 * - `cloud-api`      — authed HTTPS to the server (the shared store).
 * - `cloud-postgres` — a direct Postgres DSN; server-only, never a client.
 */
export type StoreBackend = "local-sqlite" | "cloud-api" | "cloud-postgres";

export interface StoreBackendReport {
  /** Machine-readable contract for scripts and test guards. */
  schema: "mementos.store_backend.v1";
  backend: StoreBackend;
  /** True when the HTTPS client transport is engaged (client reads AND writes). */
  api_mode: boolean;
  /** The server data backend (sqlite | postgresql) — reported for diagnosis, NOT the client answer. */
  server_backend: string;
  /** The SQLite path that WOULD be used. Meaningful only for `local-sqlite`. */
  db_path: string;
  /**
   * Cloud endpoint origin + prefix as CONFIGURED, not necessarily as used: it
   * is still reported when an explicit DB_PATH has outranked it, because the
   * operator needs to see what was set as well as what won. Read `backend` /
   * `api_mode` for what is actually in force, and `selected_by` for why.
   * Not a secret; the key is never included.
   */
  api_endpoint: string | null;
  /**
   * Whether an API key is CONFIGURED in the environment — again independent of
   * whether it won. The value is never read or reported.
   */
  api_key_present: boolean;
  /** Env key NAMES that produced this backend, or `"default"`. Names only. */
  selected_by: string;
}

/**
 * Resolve the effective store backend from the environment.
 *
 * Pure with respect to storage: touches no database, makes no network call, and
 * never places a credential value in the returned report.
 */
export function resolveStoreBackend(): StoreBackendReport {
  const apiMode = isApiMode();
  const apiConfig = getApiConfig();
  const serverBackend = getStorageBackend();
  const sources = getApiModeEnvSources();
  // One resolver pass for the SOURCES (never the key value): which tier
  // selected the cloud transport, for the operator-facing `selected_by`.
  const resolved = apiMode ? getResolvedApiModeReport() : null;

  // Since precedence 1 landed (2026-08-03), getApiConfig() returns null whenever
  // an explicit DB_PATH is set — including when a perfectly good API url+key are
  // also exported. Reading endpoint/key presence off that null would report
  // "no API key configured" to an operator whose key IS configured and merely
  // outranked, sending them to debug a credential that never failed. This report
  // is the one surface an operator reads to find out which store they are about
  // to talk to, so it answers "what is set" from the environment and "what won"
  // from the resolver, and never conflates the two.
  const configured = getConfiguredApiEnv();

  const backend: StoreBackend = apiMode
    ? "cloud-api"
    : serverBackend === "postgresql"
      ? "cloud-postgres"
      : "local-sqlite";

  let selectedBy = "default";
  if (apiMode) {
    // Name where the transport came from — resolver sources, never values: the
    // fleets of env keys are listed for the env-configured shape (the operator
    // needs to see their exact names), and the Keychain item / credentials-file
    // path / fleet gateway for the ambient tiers.
    selectedBy = resolved
      ? `${resolved.apiUrlSource ?? "default"} + ${resolved.apiKeySource ?? resolved.apiKeyTier ?? "?"} (resolved via @hasna/contracts)`
      : `${sources.urlKey} + ${sources.keyKey} (presence)`;
  } else if (backend === "local-sqlite" && configured.dbPathKey) {
    // Precedence 1. Worth naming even when nothing was outranked: "default" for
    // an explicitly pinned path is how an operator ends up believing the pin did
    // not take. When it DID outrank live credentials, saying so is the whole
    // point — that is the case that used to silently resolve to the shared store.
    selectedBy = configured.apiKeyPresent && configured.baseUrl
      ? `${configured.dbPathKey} (explicit local path, outranks the API selectors)`
      : `${configured.dbPathKey} (explicit local path)`;
  } else if (backend === "cloud-postgres") {
    // The postgresql backend is selected by DATABASE_URL presence.
    selectedBy = sources.databaseUrlKey ?? "storage config file";
  }

  return {
    schema: "mementos.store_backend.v1",
    backend,
    api_mode: apiMode,
    server_backend: serverBackend,
    db_path: getDbPath(),
    api_endpoint: apiConfig?.baseUrl ?? configured.baseUrl,
    api_key_present: Boolean(apiConfig?.apiKey) || configured.apiKeyPresent,
    selected_by: selectedBy,
  };
}
