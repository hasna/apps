import {
  createPgPool,
} from '../generated/storage-kit/pool.js';
import {
  createQueryClient,
  type PoolQueryClient,
} from '../generated/storage-kit/query.js';
import {
  KNOWLEDGE_DATABASE_URL_ENV,
  assertNoRetiredKnowledgeStorageSelector,
} from '../client-transport.js';

/** App name used for the canonical HASNA_KNOWLEDGE_* env contract. */
export const KNOWLEDGE_APP_NAME = 'knowledge';

/**
 * Build a PostgreSQL query client from the environment. SERVER-SIDE ONLY.
 *
 * This is the ONLY sanctioned raw-Postgres path and it lives on the server
 * (src/serve + scripts/apply-postgres-migrations), which runs inside our AWS with
 * the RDS DSN injected from Secrets Manager. It is intentionally NOT exported
 * from the CLI/MCP/SDK client surface: the raw RDS DSN is never distributed to
 * fleet machines, and clients reach the shared store only through the HTTP
 * ApiStore (a user-hosted server's `/v1` route + bearer key). The previous
 * `PgAdapterAsync` client adapter — a DSN-on-client sync engine — has been
 * removed to eliminate that forbidden path.
 *
 * Requires `HASNA_KNOWLEDGE_DATABASE_URL`. Throws without logging the URL.
 */
export function createKnowledgeDatabaseClient(env: NodeJS.ProcessEnv = process.env): PoolQueryClient {
  assertNoRetiredKnowledgeStorageSelector(env);
  const connectionString = env[KNOWLEDGE_DATABASE_URL_ENV]?.trim();
  if (!connectionString) {
    throw new Error(
      `knowledge server requires ${KNOWLEDGE_DATABASE_URL_ENV} for PostgreSQL. `
        + 'Knowledge clients use HASNA_KNOWLEDGE_API_URL and never receive this database URL.',
    );
  }
  return createQueryClient(createPgPool({
    connectionString,
    env,
    applicationName: '@hasna/knowledge',
  }));
}
