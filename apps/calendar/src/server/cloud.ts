/** PostgreSQL-only /v1 server wiring. Configuration is validated before bind;
 * connections remain lazy and schema changes remain explicit migrations. */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { verifyApiKey, ApiKeyStore, type ApiKeyVerifier, type AuthQueryClient } from "@hasna/contracts/auth";
import { createCalendarCloudQueryClient, type CalendarCloudQueryClient } from "./cloud-client.js";
import { CalendarPgStore } from "./pg-store.js";
import { validateDatabaseUrl } from "./database-config.js";
export { validateDatabaseUrl } from "./database-config.js";

export const CALENDAR_APP_SLUG = "calendar";

/** Resolve the app-scoped database URL that selects the PostgreSQL backend. */
function resolveHostedDatabaseUrl(env: NodeJS.ProcessEnv): string | undefined {
  const keys = ["HASNA_CALENDAR_DATABASE_URL", "CALENDAR_DATABASE_URL"];
  const present = keys.filter(k => env[k] !== undefined);
  if (!present.length) return undefined;
  const value = env[present[0]!];
  if (!value || value !== value.trim() || present.some(k => env[k] !== value)) throw new Error("Calendar PostgreSQL configuration is blank or conflicting.");
  return validateDatabaseUrl(value);
}

/**
 * True when this process is configured for the PostgreSQL backend, i.e. an
 * app-scoped database URL is set. Missing configuration cannot start a server.
 */
export function hasHostedDatabase(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(resolveHostedDatabaseUrl(env));
}

/**
 * The data backend this process uses: `postgres` when an app-scoped database
 * URL is set; absent/invalid configuration throws. Reported on `/health`, `/ready` and
 * `/version`.
 */
export type ServerBackend = "postgres";

export function resolveBackend(env: NodeJS.ProcessEnv = process.env): ServerBackend {
  if (!hasHostedDatabase(env)) throw new Error("HASNA_CALENDAR_DATABASE_URL is required before serving Calendar traffic.");
  return "postgres";
}

/**
 * Resolve the database URL from the supported env vars (priority order).
 *
 * At runtime only the app-scoped variables select the PostgreSQL backend. A
 * generic `DATABASE_URL` is accepted only via the `includeGenericDatabaseUrl`
 * opt-in, used by `calendar-serve migrate`, where the command is already an
 * explicit database operation rather than a backend-selection signal.
 */
export function resolveCloudDatabaseUrl(
  env: NodeJS.ProcessEnv = process.env,
  options: { includeGenericDatabaseUrl?: boolean } = {},
): string | undefined {
  return resolveHostedDatabaseUrl(env)
    || (options.includeGenericDatabaseUrl && env.DATABASE_URL !== undefined ? validateDatabaseUrl(env.DATABASE_URL) : undefined)
    || undefined;
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
      "Calendar /v1 requires a database URL (HASNA_CALENDAR_DATABASE_URL / CALENDAR_DATABASE_URL).",
    );
  }
  const max = Number(process.env.HASNA_CALENDAR_DB_POOL_MAX) || 6;
  cachedClient = createCalendarCloudQueryClient(url, { max, idleTimeout: 30, connectionTimeout: 15 });
  return cachedClient;
}

/** The Postgres store backing every `/v1` handler. */
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
      "Calendar /v1 auth requires a signing secret (HASNA_CALENDAR_API_SIGNING_KEY / HASNA_API_SIGNING_KEY / API_KEY_SIGNING_SECRET).",
    );
  }
  const store = getApiKeyStore();
  cachedVerifier = verifyApiKey({
    app: CALENDAR_APP_SLUG,
    signingSecret,
    // Strict key-status hook: anything other than "active" (unknown, revoked,
    // expired) denies. The contract refuses the deprecated `isRevoked`-only
    // wiring eagerly at construction (contracts #62, 0.8.7+) — the calendar
    // 0.3.6 /v1 503 incident (row I38-00755, deploy-oss-fleet-0823a confirm
    // 725517) was exactly that throw surfacing as 503 on every business route.
    keyStatus: store.keyStatus,
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

/** Cheap readiness probe: round-trips a trivial query to Postgres. */
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
