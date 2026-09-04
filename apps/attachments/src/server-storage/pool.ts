// Application-owned server storage, derived from @hasna/contracts 0.8.2.
// See README.md for provenance; this is not an unmodified generated registry kit.

// Explicit PostgreSQL pool factory; no storage mode selection or defaults.

import pg from "pg";
import type { Pool, PoolConfig } from "pg";
import { resolveServerDatabase } from "./backend";
import { resolveTlsConfig, type TlsResolveOptions } from "./tls.js";

export interface CreatePgPoolOptions extends TlsResolveOptions {
  connectionString: string;
  /** Max clients in the pool. Defaults to pg's default (10). */
  max?: number;
  /** Idle client timeout (ms). */
  idleTimeoutMillis?: number;
  /** Connection acquisition timeout (ms). */
  connectionTimeoutMillis?: number;
  /** Application name reported to Postgres (shows in pg_stat_activity). */
  applicationName?: string;
}

/** Build a `pg.Pool` with fleet-standard TLS handling. */
export function createPgPool(options: CreatePgPoolOptions): Pool {
  resolveServerDatabase({ HASNA_ATTACHMENTS_DATABASE_URL: options.connectionString });
  const ssl = resolveTlsConfig(options.connectionString, {
    ...(options.ca !== undefined ? { ca: options.ca } : {}),
    ...(options.caCertPath !== undefined ? { caCertPath: options.caCertPath } : {}),
    ...(options.env !== undefined ? { env: options.env } : {}),
  });

  // pg reparses connectionString after merging options and can overwrite ssl.
  // Validate above, then remove every accepted TLS directive from that parser.
  const connection = new URL(options.connectionString);
  connection.searchParams.delete("sslmode");
  connection.searchParams.delete("ssl");
  const config: PoolConfig = { connectionString: connection.href, ssl: ssl ?? false };
  if (options.max !== undefined) config.max = options.max;
  if (options.idleTimeoutMillis !== undefined) config.idleTimeoutMillis = options.idleTimeoutMillis;
  if (options.connectionTimeoutMillis !== undefined) config.connectionTimeoutMillis = options.connectionTimeoutMillis;
  if (options.applicationName !== undefined) config.application_name = options.applicationName;

  return new pg.Pool(config);
}
