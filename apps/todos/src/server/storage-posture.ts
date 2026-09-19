/** Explicit storage selection for the standalone Todos server. */
import { isTodosLocalOptIn } from "../lib/local-opt-in.js";
import { resolveCloudDatabaseUrl } from "./cloud.js";

export const SERVER_STORAGE_CONFIG_MISSING = "TODOS_SERVER_STORAGE_CONFIG_MISSING";

export type TodosServerStorageMode = "postgresql" | "sqlite";

export class ServerStorageNotConfiguredError extends Error {
  readonly code = SERVER_STORAGE_CONFIG_MISSING;

  constructor() {
    super(
      `${SERVER_STORAGE_CONFIG_MISSING}: todos-serve refuses to select SQLite implicitly. ` +
        "For hosted/production service use, configure HASNA_TODOS_DATABASE_URL (or TODOS_DATABASE_URL / DATABASE_URL). " +
        "For deliberate local-only self-hosting or development, set HASNA_TODOS_LOCAL=1 (alias TODOS_LOCAL=1) with no hosted authority configured.",
    );
    this.name = "ServerStorageNotConfiguredError";
  }
}

/**
 * Select the service backend without an absence-based fallback.
 *
 * A database URL always selects the hosted PostgreSQL authority. SQLite is
 * available only through the same explicit local opt-in used by the CLI/MCP/SDK.
 */
export function resolveServerStorageMode(env: NodeJS.ProcessEnv = process.env): TodosServerStorageMode {
  if (resolveCloudDatabaseUrl(env)) return "postgresql";
  if (isTodosLocalOptIn(env)) return "sqlite";
  throw new ServerStorageNotConfiguredError();
}
