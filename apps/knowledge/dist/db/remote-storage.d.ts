import { type PoolQueryClient } from '../generated/storage-kit/query.js';
/** App name used for the canonical HASNA_KNOWLEDGE_* env contract. */
export declare const KNOWLEDGE_APP_NAME = "knowledge";
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
export declare function createKnowledgeDatabaseClient(env?: NodeJS.ProcessEnv): PoolQueryClient;
