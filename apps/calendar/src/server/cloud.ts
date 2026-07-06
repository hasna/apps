/**
 * Cloud (A1 pure-remote) service wiring for `calendar-serve`.
 *
 * Powers the versioned `/v1` API and its API-key auth. Per Amendment A1 the serve
 * process reads and writes the shared RDS Postgres DIRECTLY through the calendar
 * Postgres store — there is NO local sync/cache in the service. Everything here
 * is lazy: nothing touches Postgres or crypto until the first `/v1` (or `/ready`)
 * request, so the local-first CLI/MCP paths keep ZERO cloud dependencies.
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { verifyApiKey, ApiKeyStore, type ApiKeyVerifier, type AuthQueryClient } from "@hasna/contracts/auth";
import { createCalendarCloudQueryClient, type CalendarCloudQueryClient } from "./cloud-client.js";
import { CalendarPgStore } from "./pg-store.js";

export const CALENDAR_APP_SLUG = "calendar";

/** Resolve the remote DATABASE_URL from the supported env vars (priority order). */
export function resolveCloudDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string | undefined {
  return (
    env.HASNA_CALENDAR_DATABASE_URL ||
    env.CALENDAR_DATABASE_URL ||
    env.DATABASE_URL ||
    undefined
  );
}

/** Resolve the HMAC signing secret used to verify API keys. */
export function resolveSigningSecret(env: NodeJS.ProcessEnv = process.env): string | undefined {
  return (
    env.HASNA_CALENDAR_API_SIGNING_KEY ||
    env.HASNA_API_SIGNING_KEY ||
    env.API_KEY_SIGNING_SECRET ||
    undefined
  );
}

/** True when this process is configured to serve the cloud `/v1` API. */
export function isCloudModeEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(resolveCloudDatabaseUrl(env)) || env.HASNA_CALENDAR_STORAGE_MODE === "remote";
}

let cachedClient: CalendarCloudQueryClient | null = null;
let cachedStore: CalendarPgStore | null = null;
let cachedKeyStore: ApiKeyStore | null = null;
let cachedVerifier: ApiKeyVerifier | null = null;
let schemaEnsured: Promise<void> | null = null;

function getClient(): CalendarCloudQueryClient {
  if (cachedClient) return cachedClient;
  const url = resolveCloudDatabaseUrl();
  if (!url) {
    throw new Error(
      "Cloud /v1 requires a remote database URL (HASNA_CALENDAR_DATABASE_URL / CALENDAR_DATABASE_URL / DATABASE_URL).",
    );
  }
  const max = Number(process.env.HASNA_CALENDAR_DB_POOL_MAX) || 6;
  cachedClient = createCalendarCloudQueryClient(url, { max, idleTimeout: 30, connectionTimeout: 15 });
  return cachedClient;
}

/** The pure-remote Postgres store backing every `/v1` handler. */
export function getCloudStore(): CalendarPgStore {
  if (cachedStore) return cachedStore;
  cachedStore = new CalendarPgStore(getClient());
  return cachedStore;
}

/** Bridge the repo-native `{ rows }` client to the contracts kit's AuthQueryClient. */
function authClient(): AuthQueryClient {
  const client = getClient();
  return {
    async many<T extends Record<string, unknown>>(sql: string, params: readonly unknown[] = []): Promise<T[]> {
      return (await client.query<T>(sql, params)).rows;
    },
    async get<T extends Record<string, unknown>>(sql: string, params: readonly unknown[] = []): Promise<T | null> {
      return (await client.query<T>(sql, params)).rows[0] ?? null;
    },
    async execute(sql: string, params: readonly unknown[] = []): Promise<void> {
      await client.query(sql, params);
    },
  };
}

export function getApiKeyStore(): ApiKeyStore {
  if (cachedKeyStore) return cachedKeyStore;
  cachedKeyStore = new ApiKeyStore(authClient());
  return cachedKeyStore;
}

/**
 * The framework-agnostic API-key verifier for `/v1`. Tokens are stateless,
 * HMAC-signed by the contracts issuer; revocation is checked against the RDS
 * `api_keys` table. Fails closed when no signing secret is configured.
 */
export function getCloudVerifier(): ApiKeyVerifier {
  if (cachedVerifier) return cachedVerifier;
  const signingSecret = resolveSigningSecret();
  if (!signingSecret) {
    throw new Error(
      "Cloud /v1 auth requires a signing secret (HASNA_CALENDAR_API_SIGNING_KEY / HASNA_API_SIGNING_KEY / API_KEY_SIGNING_SECRET).",
    );
  }
  cachedVerifier = verifyApiKey({
    app: CALENDAR_APP_SLUG,
    signingSecret,
    isRevoked: getApiKeyStore().isRevoked,
  });
  return cachedVerifier;
}

function migrationsDir(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "..", "..", "migrations");
}

/** The committed relational schema SQL (split into individual statements). */
export function schemaStatements(): string[] {
  const sql = readFileSync(join(migrationsDir(), "0001_calendar_schema.sql"), "utf8");
  return splitSqlStatements(sql);
}

function splitSqlStatements(sql: string): string[] {
  return sql
    .split(/;\s*(?:\n|$)/)
    .map((s) => s.replace(/^\s*--.*$/gm, "").trim())
    .filter((s) => s.length > 0);
}

/**
 * Ensure the remote schema exists: the calendar relational tables plus the
 * contracts api-keys table. Idempotent (CREATE ... IF NOT EXISTS); run once per
 * process and by the migration runner. NEVER drops or rewrites existing tables.
 */
export async function ensureCloudSchema(): Promise<void> {
  if (schemaEnsured) return schemaEnsured;
  schemaEnsured = (async () => {
    const client = getClient();
    for (const stmt of schemaStatements()) {
      await client.query(stmt);
    }
    await getApiKeyStore().ensureSchema();
  })();
  return schemaEnsured;
}

/** Cheap readiness probe: round-trips a trivial query to RDS. */
export async function pingCloud(): Promise<boolean> {
  const res = await getClient().query<{ ok: number }>("select 1 as ok");
  return Number(res.rows[0]?.ok) === 1;
}

/** Test/shutdown helper. */
export async function closeCloud(): Promise<void> {
  if (cachedClient) await cachedClient.close();
  cachedClient = null;
  cachedStore = null;
  cachedKeyStore = null;
  cachedVerifier = null;
  schemaEnsured = null;
}
