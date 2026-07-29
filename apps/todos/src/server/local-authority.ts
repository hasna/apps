import { extractToken, type ApiKeyVerifier } from "@hasna/contracts/auth";
import { getDatabase } from "../db/database.js";
import { safeEqualStrings, verifyApiKey } from "../db/api-keys.js";
import { createLocalTodosAuthorityHandshake } from "../authority.js";
import { createLocalPrGroupLedger } from "../pr-groups/index.js";
import { PrGroupLedger } from "../pr-groups/ledger.js";
import { PostgresPrGroupLedgerPersistence, postgresPrGroupSchemaSql } from "../pr-groups/postgres.js";
import { createTodosCloudQueryClient, type TodosCloudQueryClient } from "../storage/cloud-client.js";
import { loadTodosStorageConfig } from "../storage/config.js";
import { createTodosStorageAdapter } from "../storage/factory.js";
import type { TodosStorageAdapter } from "../storage/interfaces.js";
import { postgresTodosSyncSchemaSql } from "../storage/postgres-sync.js";

const DEFAULT_LOCAL_AUTHORITY_ID = "customer-local";

let postgresClient: TodosCloudQueryClient | null = null;
let storageAdapter: TodosStorageAdapter | null = null;
let prGroupLedger: PrGroupLedger | null = null;
let schemaReady: Promise<void> | null = null;

export function getLocalAuthorityId(env: NodeJS.ProcessEnv = process.env): string {
  return env.HASNA_TODOS_AUTHORITY_ID?.trim() || DEFAULT_LOCAL_AUTHORITY_ID;
}

export function getLocalAuthorityHandshake(env: NodeJS.ProcessEnv = process.env) {
  return createLocalTodosAuthorityHandshake(getLocalAuthorityId(env));
}

function getPostgresClient(): TodosCloudQueryClient {
  if (postgresClient) return postgresClient;
  const config = loadTodosStorageConfig();
  if (config.backend !== "postgres" || !config.database) {
    throw new Error("postgres customer-server backend is not configured");
  }
  postgresClient = createTodosCloudQueryClient(config.database.url, {
    max: 6,
    idleTimeout: 30,
    connectionTimeout: 15,
  });
  return postgresClient;
}

export function getLocalAuthorityStorageAdapter(): TodosStorageAdapter {
  if (storageAdapter) return storageAdapter;
  const config = loadTodosStorageConfig();
  storageAdapter = config.backend === "sqlite"
    ? createTodosStorageAdapter({ config, sqlite: { db: getDatabase() } })
    : createTodosStorageAdapter({ config, postgresClient: getPostgresClient() });
  return storageAdapter;
}

export function getLocalAuthorityPrGroupLedger(): PrGroupLedger {
  if (prGroupLedger) return prGroupLedger;
  const config = loadTodosStorageConfig();
  prGroupLedger = config.backend === "sqlite"
    ? createLocalPrGroupLedger(getDatabase())
    : new PrGroupLedger(new PostgresPrGroupLedgerPersistence(getPostgresClient()));
  return prGroupLedger;
}

export async function ensureLocalAuthoritySchema(): Promise<void> {
  const config = loadTodosStorageConfig();
  if (config.backend === "sqlite") {
    getDatabase();
    return;
  }
  if (!schemaReady) {
    schemaReady = (async () => {
      const client = getPostgresClient();
      for (const sql of postgresTodosSyncSchemaSql()) await client.query(sql);
      for (const sql of postgresPrGroupSchemaSql()) await client.query(sql);
    })();
  }
  await schemaReady;
}

export function getLocalAuthorityVerifier(env: NodeJS.ProcessEnv = process.env): ApiKeyVerifier {
  const configuredKey = env.HASNA_TODOS_API_KEY?.trim() || null;
  return {
    app: "todos",
    async authenticate(headers, context) {
      const token = extractToken(headers);
      const stored = token ? verifyApiKey(token) : null;
      const staticMatch = Boolean(token && configuredKey && safeEqualStrings(token, configuredKey));
      if (!token || (!stored && !staticMatch)) {
        return { ok: false, status: 401, reason: "invalid_signature", message: "Unauthorized" };
      }
      const granted = stored?.permissions ?? ["*"];
      const scopes = granted.map((permission) => permission === "*" ? "todos:*" : permission);
      const required = context?.requiredScopes ?? [];
      const allowed = required.every((scope) => scopes.includes("todos:*") || scopes.includes(scope));
      if (!allowed) {
        return { ok: false, status: 403, reason: "insufficient_scope", message: "Forbidden" };
      }
      return {
        ok: true,
        status: 200,
        principal: {
          kid: stored?.id ?? "configured-key",
          app: "todos",
          scopes,
          agent: null,
          tid: getLocalAuthorityId(env),
          claims: {} as never,
        },
      };
    },
  };
}

export async function pingLocalAuthority(): Promise<boolean> {
  const config = loadTodosStorageConfig();
  if (config.backend === "sqlite") {
    getDatabase().query("SELECT 1 AS ok").get();
    return true;
  }
  const result = await getPostgresClient().query<{ ok: number }>("SELECT 1 AS ok");
  return result.rows[0]?.ok === 1;
}

export async function closeLocalAuthority(): Promise<void> {
  if (postgresClient) await postgresClient.close();
  postgresClient = null;
  storageAdapter = null;
  prGroupLedger = null;
  schemaReady = null;
}
