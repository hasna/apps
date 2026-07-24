#!/usr/bin/env bun
// @bun

// src/serve.ts
import { readFileSync as readFileSync2 } from "fs";

// node_modules/@hasna/contracts/dist/auth/index.js
import { createHash, createHmac, randomBytes, timingSafeEqual } from "crypto";
var API_KEY_TOKEN_VERSION = 1;
var API_KEY_NAMESPACE = "hasna";
var TOKEN_PATTERN = /^hasna_([a-z][a-z0-9-]*)_([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/;
var DEFAULT_API_KEY_TTL_SECONDS = 90 * 24 * 60 * 60;
function toBuffer(secret) {
  return typeof secret === "string" ? Buffer.from(secret, "utf8") : secret;
}
function hmac(signingSecret, message) {
  return createHmac("sha256", toBuffer(signingSecret)).update(message, "utf8").digest();
}
function apiKeyPrefix(app) {
  return `${API_KEY_NAMESPACE}_${app}_`;
}
function parseApiKey(token) {
  if (typeof token !== "string")
    return null;
  const match = TOKEN_PATTERN.exec(token);
  if (!match)
    return null;
  const [, app, body, sig] = match;
  if (!app || !body || !sig)
    return null;
  let claims;
  try {
    claims = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (typeof claims !== "object" || claims === null || typeof claims.kid !== "string" || typeof claims.app !== "string" || !Array.isArray(claims.scopes)) {
    return null;
  }
  return { app, body, sig, claims };
}
function verifyApiKeyToken(token, options) {
  const parsed = parseApiKey(token);
  if (!parsed) {
    return { ok: false, reason: "malformed", message: "Token is malformed." };
  }
  const { app, body, sig, claims } = parsed;
  if (claims.v !== API_KEY_TOKEN_VERSION) {
    return { ok: false, reason: "unsupported_version", message: `Unsupported token version ${claims.v}.` };
  }
  if (claims.app !== app) {
    return { ok: false, reason: "app_mismatch", message: "Token prefix app does not match claims." };
  }
  if (options.expectedApp !== undefined && app !== options.expectedApp) {
    return { ok: false, reason: "app_mismatch", message: `Token is for app '${app}', expected '${options.expectedApp}'.` };
  }
  const expected = hmac(options.signingSecret, `${apiKeyPrefix(app)}${body}`);
  let provided;
  try {
    provided = Buffer.from(sig, "base64url");
  } catch {
    return { ok: false, reason: "bad_signature", message: "Signature is not valid base64url." };
  }
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    return { ok: false, reason: "bad_signature", message: "Signature verification failed." };
  }
  const now = Math.floor((options.nowMs ?? Date.now()) / 1000);
  const leeway = options.leewaySeconds ?? 0;
  if (typeof claims.iat === "number" && now + leeway < claims.iat) {
    return { ok: false, reason: "not_yet_valid", message: "Token is not yet valid." };
  }
  if (claims.exp !== null && typeof claims.exp === "number" && now - leeway >= claims.exp) {
    return { ok: false, reason: "expired", message: "Token has expired." };
  }
  if (options.requiredScopes && options.requiredScopes.length > 0) {
    const granted = claims.scopes;
    const satisfies = (required) => granted.some((g) => {
      if (g === "*")
        return true;
      const gi = g.indexOf(":");
      const ri = required.indexOf(":");
      if (gi < 0 || ri < 0)
        return false;
      const gApp = g.slice(0, gi);
      const gAction = g.slice(gi + 1);
      const rApp = required.slice(0, ri);
      const rAction = required.slice(ri + 1);
      return (gApp === "*" || gApp === rApp) && (gAction === "*" || gAction === rAction);
    });
    for (const required of options.requiredScopes) {
      if (!satisfies(required)) {
        return { ok: false, reason: "insufficient_scope", message: `Missing required scope '${required}'.` };
      }
    }
  }
  return { ok: true, claims, kid: claims.kid, app };
}
var DEFAULT_API_KEYS_TABLE = "api_keys";
function createTableSql(table) {
  return `CREATE TABLE IF NOT EXISTS ${table} (
    kid TEXT PRIMARY KEY,
    app TEXT NOT NULL,
    agent TEXT,
    scopes JSONB NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    issued_at TIMESTAMPTZ NOT NULL,
    expires_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,
    revoked_reason TEXT,
    last_used_at TIMESTAMPTZ,
    created_by TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`;
}
function apiKeyMigrations(table = DEFAULT_API_KEYS_TABLE) {
  return [
    { id: `hasna_auth_0001_${table}`, sql: createTableSql(table) },
    {
      id: `hasna_auth_0002_${table}_indexes`,
      sql: `CREATE INDEX IF NOT EXISTS ${table}_app_idx ON ${table} (app);
            CREATE INDEX IF NOT EXISTS ${table}_token_hash_idx ON ${table} (token_hash);`
    }
  ];
}
function toIso(value) {
  if (value === null || value === undefined)
    return null;
  if (value instanceof Date)
    return value.toISOString();
  return new Date(String(value)).toISOString();
}
function parseScopes(value) {
  if (Array.isArray(value))
    return value.map((v) => String(v));
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.map((v) => String(v)) : [];
    } catch {
      return [];
    }
  }
  return [];
}
function rowToRecord(row) {
  return {
    kid: String(row.kid),
    app: String(row.app),
    agent: row.agent === null || row.agent === undefined ? null : String(row.agent),
    scopes: parseScopes(row.scopes),
    tokenHash: String(row.token_hash),
    issuedAt: toIso(row.issued_at) ?? new Date(0).toISOString(),
    expiresAt: toIso(row.expires_at),
    revokedAt: toIso(row.revoked_at),
    revokedReason: row.revoked_reason === null || row.revoked_reason === undefined ? null : String(row.revoked_reason),
    lastUsedAt: toIso(row.last_used_at),
    createdBy: row.created_by === null || row.created_by === undefined ? null : String(row.created_by)
  };
}

class ApiKeyStore {
  client;
  table;
  constructor(client, options = {}) {
    this.client = client;
    this.table = options.table ?? DEFAULT_API_KEYS_TABLE;
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(this.table)) {
      throw new Error(`Invalid api-keys table name '${this.table}'.`);
    }
  }
  migrations() {
    return apiKeyMigrations(this.table);
  }
  async ensureSchema() {
    for (const migration of this.migrations()) {
      await this.client.execute(migration.sql);
    }
  }
  async insert(input) {
    await this.client.execute(`INSERT INTO ${this.table}
         (kid, app, agent, scopes, token_hash, issued_at, expires_at, created_by)
       VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8)`, [
      input.kid,
      input.app,
      input.agent ?? null,
      JSON.stringify(input.scopes),
      input.tokenHash,
      input.issuedAt.toISOString(),
      input.expiresAt ? input.expiresAt.toISOString() : null,
      input.createdBy ?? null
    ]);
  }
  async insertMinted(minted, createdBy) {
    const claims = minted.claims;
    await this.insert({
      kid: minted.kid,
      app: claims.app,
      agent: claims.agent ?? null,
      scopes: claims.scopes,
      tokenHash: minted.tokenHash,
      issuedAt: new Date(claims.iat * 1000),
      expiresAt: claims.exp === null ? null : new Date(claims.exp * 1000),
      createdBy: createdBy ?? null
    });
  }
  async findByKid(kid) {
    const row = await this.client.get(`SELECT * FROM ${this.table} WHERE kid = $1`, [kid]);
    return row ? rowToRecord(row) : null;
  }
  async findByTokenHash(tokenHash) {
    const row = await this.client.get(`SELECT * FROM ${this.table} WHERE token_hash = $1`, [tokenHash]);
    return row ? rowToRecord(row) : null;
  }
  isRevoked = async (kid) => {
    const row = await this.client.get(`SELECT revoked_at FROM ${this.table} WHERE kid = $1`, [kid]);
    if (!row)
      return false;
    return row.revoked_at !== null && row.revoked_at !== undefined;
  };
  async status(kid, nowMs = Date.now()) {
    const record = await this.findByKid(kid);
    if (!record)
      return "unknown";
    if (record.revokedAt)
      return "revoked";
    if (record.expiresAt && new Date(record.expiresAt).getTime() <= nowMs)
      return "expired";
    return "active";
  }
  statusChecker() {
    return async (kid) => {
      const status = await this.status(kid);
      return status !== "active";
    };
  }
  async revoke(kid, reason, atMs = Date.now()) {
    const row = await this.client.get(`UPDATE ${this.table}
          SET revoked_at = COALESCE(revoked_at, $2), revoked_reason = COALESCE(revoked_reason, $3)
        WHERE kid = $1
      RETURNING kid`, [kid, new Date(atMs).toISOString(), reason ?? null]);
    return row !== null;
  }
  async touchLastUsed(kid, atMs = Date.now()) {
    await this.client.execute(`UPDATE ${this.table} SET last_used_at = $2 WHERE kid = $1`, [
      kid,
      new Date(atMs).toISOString()
    ]);
  }
  async list(options = {}) {
    const clauses = [];
    const params = [];
    if (options.app) {
      params.push(options.app);
      clauses.push(`app = $${params.length}`);
    }
    if (!options.includeRevoked) {
      clauses.push("revoked_at IS NULL");
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = await this.client.many(`SELECT * FROM ${this.table} ${where} ORDER BY issued_at DESC`);
    return rows.map(rowToRecord);
  }
  async revokedKids() {
    const rows = await this.client.many(`SELECT kid FROM ${this.table} WHERE revoked_at IS NOT NULL`);
    return rows.map((row) => String(row.kid));
  }
}
function readHeader(source, name) {
  const lower = name.toLowerCase();
  if (typeof source === "function") {
    return source(name) ?? source(lower) ?? null;
  }
  if (typeof Headers !== "undefined" && source instanceof Headers) {
    return source.get(name);
  }
  const record = source;
  const value = record[name] ?? record[lower] ?? record[name.toUpperCase()];
  if (Array.isArray(value))
    return value[0] ?? null;
  return value ?? null;
}
function extractToken(source, headerName = "x-api-key", scheme = "Bearer") {
  const direct = readHeader(source, headerName);
  if (direct && direct.trim().length > 0)
    return direct.trim();
  const authz = readHeader(source, "authorization");
  if (authz) {
    const prefix = `${scheme} `;
    if (authz.toLowerCase().startsWith(prefix.toLowerCase())) {
      const token = authz.slice(prefix.length).trim();
      if (token.length > 0)
        return token;
    }
  }
  return null;
}
function verifyApiKey(options) {
  if (!options.app)
    throw new Error("verifyApiKey requires an 'app' slug.");
  if (!options.signingSecret) {
    throw new Error("verifyApiKey requires a 'signingSecret'. Set it from HASNA_<APP>_API_SIGNING_KEY.");
  }
  const headerName = options.headerName ?? "x-api-key";
  const scheme = options.scheme ?? "Bearer";
  const clock = options.nowMs ?? (() => Date.now());
  async function emit(event) {
    if (!options.audit)
      return;
    try {
      await options.audit(event);
    } catch {}
  }
  async function authenticate(headers, context = {}) {
    const method = context.method ?? null;
    const path = context.path ?? null;
    const requiredScopes = [...options.requiredScopes ?? [], ...context.requiredScopes ?? []];
    const at = new Date(clock()).toISOString();
    const token = extractToken(headers, headerName, scheme);
    if (!token) {
      const decision = {
        ok: false,
        status: 401,
        reason: "missing_token",
        message: `Missing API key. Send it as '${headerName}: <key>' or 'Authorization: ${scheme} <key>'.`
      };
      await emit({ outcome: "deny", app: options.app, kid: null, reason: "missing_token", scopesRequired: requiredScopes, method, path, status: 401, at });
      return decision;
    }
    const verified = verifyApiKeyToken(token, {
      signingSecret: options.signingSecret,
      expectedApp: options.app,
      nowMs: clock(),
      ...options.leewaySeconds !== undefined ? { leewaySeconds: options.leewaySeconds } : {},
      requiredScopes
    });
    if (!verified.ok) {
      const status = verified.reason === "insufficient_scope" ? 403 : 401;
      await emit({ outcome: "deny", app: options.app, kid: null, reason: verified.reason, scopesRequired: requiredScopes, method, path, status, at });
      return { ok: false, status, reason: verified.reason, message: verified.message };
    }
    if (options.isRevoked) {
      const revoked = await options.isRevoked(verified.kid);
      if (revoked) {
        await emit({ outcome: "deny", app: options.app, kid: verified.kid, reason: "revoked", scopesRequired: requiredScopes, method, path, status: 401, at });
        return { ok: false, status: 401, reason: "revoked", message: "API key has been revoked." };
      }
    }
    const principal = {
      kid: verified.kid,
      app: verified.app,
      scopes: verified.claims.scopes,
      agent: verified.claims.agent ?? null,
      claims: verified.claims
    };
    await emit({ outcome: "allow", app: options.app, kid: verified.kid, reason: null, scopesRequired: requiredScopes, method, path, status: 200, at });
    return { ok: true, status: 200, principal };
  }
  return { authenticate, app: options.app };
}

// src/generated/storage-kit/mode.ts
var DEPRECATED_STORAGE_MODE_ALIASES = [
  "remote",
  "hybrid",
  "self_hosted"
];
function normalizeStorageMode(value) {
  const normalized = value.trim().toLowerCase().replace(/-/g, "_");
  if (normalized === "local")
    return { mode: "local", deprecatedAlias: null };
  if (normalized === "cloud")
    return { mode: "cloud", deprecatedAlias: null };
  if (DEPRECATED_STORAGE_MODE_ALIASES.includes(normalized)) {
    return { mode: "cloud", deprecatedAlias: normalized };
  }
  throw new Error(`Unknown storage mode: ${value}. Use local or cloud.`);
}
function envToken(name) {
  return name.toUpperCase().replace(/-/g, "_");
}
function storageEnvKeys(name) {
  const token = envToken(name);
  return {
    modeKeys: [`HASNA_${token}_STORAGE_MODE`, `${token}_STORAGE_MODE`],
    databaseUrlKeys: [`HASNA_${token}_DATABASE_URL`, `${token}_DATABASE_URL`]
  };
}
function firstEnv(env, keys) {
  for (const key of keys) {
    const value = env[key]?.trim();
    if (value)
      return { key, value };
  }
  return null;
}
function resolveStorageMode(name, env = process.env) {
  const { modeKeys, databaseUrlKeys } = storageEnvKeys(name);
  const dbHit = firstEnv(env, databaseUrlKeys);
  const databaseUrlPresent = Boolean(dbHit);
  const databaseUrlSource = dbHit ? dbHit.key : null;
  const modeHit = firstEnv(env, modeKeys);
  if (!modeHit) {
    return {
      mode: "local",
      source: "default",
      deprecatedAlias: null,
      databaseUrlPresent,
      databaseUrlSource,
      warning: null
    };
  }
  const { mode, deprecatedAlias } = normalizeStorageMode(modeHit.value);
  const warnings = [];
  if (deprecatedAlias) {
    warnings.push(`Deprecated storage mode '${deprecatedAlias}' from ${modeHit.key} is treated as 'cloud'. Set ${modeKeys[0]}=cloud instead.`);
  }
  if (mode === "cloud" && !databaseUrlPresent) {
    warnings.push(`cloud mode needs ${databaseUrlKeys[0]} (PURE REMOTE: reads and writes go to cloud Postgres).`);
  }
  if (modeHit.key !== modeKeys[0]) {
    warnings.push(`Using alias env ${modeHit.key}; the canonical key is ${modeKeys[0]}.`);
  }
  return {
    mode,
    source: modeHit.key,
    deprecatedAlias,
    databaseUrlPresent,
    databaseUrlSource,
    warning: warnings.length > 0 ? warnings.join(" ") : null
  };
}
function resolveDatabaseUrl(name, env = process.env) {
  const { databaseUrlKeys } = storageEnvKeys(name);
  const hit = firstEnv(env, databaseUrlKeys);
  return hit ? hit.value : null;
}
// src/generated/storage-kit/tls.ts
import { readFileSync } from "fs";
function sslModeFromConnectionString(connectionString) {
  const queryStart = connectionString.indexOf("?");
  const params = new URLSearchParams(queryStart === -1 ? "" : connectionString.slice(queryStart + 1));
  const sslmode = params.get("sslmode")?.trim().toLowerCase();
  if (sslmode) {
    switch (sslmode) {
      case "disable":
      case "prefer":
      case "require":
      case "verify-ca":
      case "verify-full":
        return sslmode;
      case "allow":
        return "prefer";
      default:
        throw new Error(`Unknown sslmode '${sslmode}' in connection string.`);
    }
  }
  const ssl = params.get("ssl")?.trim().toLowerCase();
  if (ssl && ["1", "true", "yes", "on", "require"].includes(ssl))
    return "require";
  return "disable";
}
function loadCaBundle(options) {
  const env = options.env ?? process.env;
  if (options.ca && options.ca.trim())
    return options.ca;
  const path = options.caCertPath ?? env.PGSSLROOTCERT ?? env.NODE_EXTRA_CA_CERTS;
  if (path && path.trim())
    return readFileSync(path.trim(), "utf8");
  return null;
}
function resolveTlsConfig(connectionString, options = {}) {
  const mode = sslModeFromConnectionString(connectionString);
  if (mode === "disable") {
    return;
  }
  const ca = loadCaBundle(options);
  if (mode === "prefer" || mode === "require") {
    return ca ? { rejectUnauthorized: false, ca } : { rejectUnauthorized: false };
  }
  if (!ca) {
    throw new Error(`sslmode=${mode} requires a CA bundle. Set PGSSLROOTCERT (or pass caCertPath/ca) to the ` + `Amazon RDS global bundle: https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem`);
  }
  return { rejectUnauthorized: true, ca };
}
// src/generated/storage-kit/query.ts
function wrapExecutor(executor) {
  return {
    async query(sql, params) {
      const result = await executor.query(sql, params);
      return { rows: result.rows, rowCount: result.rowCount ?? result.rows.length };
    },
    async many(sql, params) {
      const result = await executor.query(sql, params);
      return result.rows;
    },
    async get(sql, params) {
      const result = await executor.query(sql, params);
      return result.rows[0] ?? null;
    },
    async one(sql, params) {
      const result = await executor.query(sql, params);
      if (result.rows.length !== 1) {
        throw new Error(`Expected exactly one row, got ${result.rows.length}.`);
      }
      return result.rows[0];
    },
    async execute(sql, params) {
      await executor.query(sql, params);
    }
  };
}
function createQueryClient(pool) {
  const base = wrapExecutor(pool);
  return {
    ...base,
    pool,
    async transaction(fn) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await fn(wrapExecutor(client));
        await client.query("COMMIT");
        return result;
      } catch (error) {
        try {
          await client.query("ROLLBACK");
        } catch {}
        throw error;
      } finally {
        client.release();
      }
    },
    async close() {
      await pool.end();
    }
  };
}
// src/generated/storage-kit/pool.ts
import pg from "pg";
function createPgPool(options) {
  const ssl = resolveTlsConfig(options.connectionString, {
    ...options.ca !== undefined ? { ca: options.ca } : {},
    ...options.caCertPath !== undefined ? { caCertPath: options.caCertPath } : {},
    ...options.env !== undefined ? { env: options.env } : {}
  });
  const config = { connectionString: options.connectionString };
  if (ssl !== undefined)
    config.ssl = ssl;
  if (options.max !== undefined)
    config.max = options.max;
  if (options.idleTimeoutMillis !== undefined)
    config.idleTimeoutMillis = options.idleTimeoutMillis;
  if (options.connectionTimeoutMillis !== undefined)
    config.connectionTimeoutMillis = options.connectionTimeoutMillis;
  if (options.applicationName !== undefined)
    config.application_name = options.applicationName;
  return new pg.Pool(config);
}
function createCloudPoolFromEnv(appName, options = {}) {
  const env = options.env ?? process.env;
  const resolution = resolveStorageMode(appName, env);
  if (resolution.mode !== "cloud") {
    throw new Error(`createCloudPoolFromEnv requires ${appName} storage mode 'cloud', got '${resolution.mode}'. ` + `Set HASNA_${appName.toUpperCase().replace(/-/g, "_")}_STORAGE_MODE=cloud.`);
  }
  const connectionString = resolveDatabaseUrl(appName, env);
  if (!connectionString) {
    throw new Error(`cloud mode for ${appName} needs a database URL. Set ` + `HASNA_${appName.toUpperCase().replace(/-/g, "_")}_DATABASE_URL.`);
  }
  const pool = createPgPool({
    connectionString,
    ...options.ca !== undefined ? { ca: options.ca } : {},
    ...options.caCertPath !== undefined ? { caCertPath: options.caCertPath } : {},
    env,
    ...options.max !== undefined ? { max: options.max } : {},
    ...options.idleTimeoutMillis !== undefined ? { idleTimeoutMillis: options.idleTimeoutMillis } : {},
    ...options.connectionTimeoutMillis !== undefined ? { connectionTimeoutMillis: options.connectionTimeoutMillis } : {},
    ...options.applicationName !== undefined ? { applicationName: options.applicationName } : {}
  });
  return {
    client: createQueryClient(pool),
    connectionSource: resolution.databaseUrlSource ?? "unknown"
  };
}
// src/db/remote-storage.ts
var KNOWLEDGE_APP_NAME = "knowledge";
function createKnowledgeCloudClient() {
  return createCloudPoolFromEnv(KNOWLEDGE_APP_NAME, { applicationName: "@hasna/knowledge" }).client;
}

// src/registry-contract.ts
var KNOWLEDGE_REGISTRY_CONTRACT_VERSION = 2;
function knowledgeRegistryContract(input) {
  return {
    contract_version: KNOWLEDGE_REGISTRY_CONTRACT_VERSION,
    service: "open-knowledge",
    mode: input.mode,
    capabilities: [
      "registry",
      "notes-read",
      "notes-write",
      "open-files-source-refs",
      "s3-generated-artifacts"
    ],
    endpoints: {
      registry: "/v1/registry",
      notes: "/v1/notes",
      note: "/v1/notes/{id}",
      health: "/health",
      version: "/version",
      ready: "/ready",
      openapi: "/openapi.json"
    },
    source_contract: {
      owner: "open-files",
      preferred_ref: "open-files",
      allowed_schemes: input.sourceSchemes,
      raw_source_bytes_stored_in_open_knowledge: false
    },
    artifact_contract: {
      storage_type: input.storageType,
      uri_prefix: input.artifactUriPrefix,
      generated_only: true
    }
  };
}

// src/workspace.ts
import { dirname, join, resolve } from "path";
var HASNA_KNOWLEDGE_APP_PATH = join(".hasna", "knowledge");
var LEGACY_HASNA_KNOWLEDGE_APP_PATH = join(".hasna", "apps", "knowledge");

// src/store.ts
var heldLockPaths = new Set;
function makeId() {
  return `k_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
function makeShortId(id) {
  return id.replace(/^k_/, "").slice(0, 12);
}

// src/serve.ts
var KNOWLEDGE_SERVE_APP = "knowledge";
function normalizeCloudDatabaseUrl(env = process.env) {
  const key = "HASNA_KNOWLEDGE_DATABASE_URL";
  const url = env[key] ?? env.KNOWLEDGE_DATABASE_URL;
  if (!url)
    return url;
  const lower = url.toLowerCase();
  const needsCompat = (lower.includes("sslmode=require") || lower.includes("sslmode=prefer")) && !lower.includes("uselibpqcompat");
  if (!needsCompat)
    return url;
  const updated = url.includes("?") ? `${url}&uselibpqcompat=true` : `${url}?uselibpqcompat=true`;
  env[key] = updated;
  return updated;
}
function resolveVersion() {
  if (process.env.HASNA_KNOWLEDGE_VERSION)
    return process.env.HASNA_KNOWLEDGE_VERSION;
  try {
    const url = new URL("../package.json", import.meta.url);
    const pkg = JSON.parse(readFileSync2(url, "utf8"));
    return pkg.version ?? "0.0.0";
  } catch {
    return process.env.npm_package_version ?? "0.0.0";
  }
}
function resolveSigningSecret(env = process.env) {
  const secret = env.HASNA_KNOWLEDGE_API_SIGNING_KEY ?? env.API_KEY_SIGNING_SECRET ?? env.HASNA_API_SIGNING_KEY;
  if (!secret) {
    throw new Error("knowledge-serve requires an API signing secret: set HASNA_KNOWLEDGE_API_SIGNING_KEY " + "(or API_KEY_SIGNING_SECRET / HASNA_API_SIGNING_KEY).");
  }
  return secret;
}
function rowToItem(row) {
  const parseJson = (value, fallback) => {
    if (value == null)
      return fallback;
    if (typeof value === "string") {
      try {
        return JSON.parse(value);
      } catch {
        return fallback;
      }
    }
    return value;
  };
  return {
    id: String(row.id),
    short_id: row.short_id ?? null,
    title: String(row.title ?? ""),
    content: String(row.content ?? ""),
    url: row.url ?? null,
    tags: parseJson(row.tags, []),
    metadata: parseJson(row.metadata, {}),
    archived: Boolean(row.archived),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at)
  };
}

class NoteRepo {
  client;
  constructor(client) {
    this.client = client;
  }
  async create(input) {
    if (!input.title || typeof input.title !== "string") {
      throw new HttpError(400, "title is required");
    }
    const now = new Date().toISOString();
    const suppliedId = typeof input.id === "string" ? input.id.trim() : "";
    if (suppliedId) {
      const row2 = await this.client.get(`INSERT INTO knowledge_items (id, short_id, title, content, url, tags, metadata, archived, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,FALSE,$8,$8)
         ON CONFLICT (id) DO UPDATE SET
           title = EXCLUDED.title,
           content = EXCLUDED.content,
           url = EXCLUDED.url,
           tags = EXCLUDED.tags,
           metadata = EXCLUDED.metadata,
           updated_at = EXCLUDED.updated_at
         RETURNING *`, [
        suppliedId,
        makeShortId(suppliedId),
        input.title,
        input.content ?? "",
        input.url ?? null,
        JSON.stringify(input.tags ?? []),
        JSON.stringify(input.metadata ?? {}),
        now
      ]);
      return rowToItem(row2);
    }
    const id = makeId();
    const row = await this.client.get(`INSERT INTO knowledge_items (id, short_id, title, content, url, tags, metadata, archived, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,FALSE,$8,$9)
       RETURNING *`, [
      id,
      makeShortId(id),
      input.title,
      input.content ?? "",
      input.url ?? null,
      JSON.stringify(input.tags ?? []),
      JSON.stringify(input.metadata ?? {}),
      now,
      now
    ]);
    return rowToItem(row);
  }
  async list(options = {}) {
    const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
    const offset = Math.max(options.offset ?? 0, 0);
    const where = [];
    const params = [];
    if (!options.includeArchived)
      where.push("archived = FALSE");
    const search = options.search?.trim();
    let tsQueryExpr = null;
    if (search) {
      params.push(search);
      tsQueryExpr = `websearch_to_tsquery('english', $${params.length})`;
      where.push(`search_vector @@ ${tsQueryExpr}`);
    }
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const orderSql = tsQueryExpr ? `ORDER BY ts_rank_cd(search_vector, ${tsQueryExpr}) DESC, created_at DESC` : "ORDER BY created_at DESC";
    const totalRow = await this.client.get(`SELECT count(*)::text AS count FROM knowledge_items ${whereSql}`, params);
    const rows = await this.client.many(`SELECT * FROM knowledge_items ${whereSql} ${orderSql} LIMIT ${limit} OFFSET ${offset}`, params);
    return { items: rows.map(rowToItem), total: Number(totalRow?.count ?? 0) };
  }
  async get(idOrShort) {
    const row = await this.client.get(`SELECT * FROM knowledge_items WHERE id = $1 OR short_id = $1 LIMIT 1`, [idOrShort]);
    return row ? rowToItem(row) : null;
  }
  async update(idOrShort, patch) {
    const existing = await this.get(idOrShort);
    if (!existing)
      return null;
    const sets = [];
    const params = [];
    const push = (col, val, cast = "") => {
      params.push(val);
      sets.push(`${col} = $${params.length}${cast}`);
    };
    if (patch.title !== undefined)
      push("title", patch.title);
    if (patch.content !== undefined)
      push("content", patch.content);
    if (patch.url !== undefined)
      push("url", patch.url);
    if (patch.tags !== undefined)
      push("tags", JSON.stringify(patch.tags), "::jsonb");
    if (patch.metadata !== undefined)
      push("metadata", JSON.stringify(patch.metadata), "::jsonb");
    if (patch.archived !== undefined)
      push("archived", patch.archived);
    push("updated_at", new Date().toISOString());
    params.push(existing.id);
    const row = await this.client.get(`UPDATE knowledge_items SET ${sets.join(", ")} WHERE id = $${params.length} RETURNING *`, params);
    return row ? rowToItem(row) : null;
  }
  async delete(idOrShort) {
    const existing = await this.get(idOrShort);
    if (!existing)
      return false;
    await this.client.execute(`DELETE FROM knowledge_items WHERE id = $1`, [existing.id]);
    return true;
  }
}
function knowledgeOpenApi(version) {
  const noteSchema = {
    type: "object",
    properties: {
      id: { type: "string" },
      short_id: { type: "string", nullable: true },
      title: { type: "string" },
      content: { type: "string" },
      url: { type: "string", nullable: true },
      tags: { type: "array", items: { type: "string" } },
      metadata: { type: "object", additionalProperties: true },
      archived: { type: "boolean" },
      created_at: { type: "string" },
      updated_at: { type: "string" }
    },
    required: ["id", "title", "content", "tags", "archived", "created_at", "updated_at"]
  };
  const noteInput = {
    type: "object",
    properties: {
      id: { type: "string" },
      title: { type: "string" },
      content: { type: "string" },
      url: { type: "string", nullable: true },
      tags: { type: "array", items: { type: "string" } },
      metadata: { type: "object", additionalProperties: true }
    },
    required: ["title"]
  };
  const notePatch = {
    type: "object",
    properties: {
      title: { type: "string" },
      content: { type: "string" },
      url: { type: "string", nullable: true },
      tags: { type: "array", items: { type: "string" } },
      metadata: { type: "object", additionalProperties: true },
      archived: { type: "boolean" }
    }
  };
  return {
    openapi: "3.0.3",
    info: { title: "Knowledge", version, description: "@hasna/knowledge self-hosted HTTP API" },
    components: {
      securitySchemes: { apiKey: { type: "apiKey", in: "header", name: "x-api-key" } },
      schemas: {
        Note: noteSchema,
        NoteInput: noteInput,
        NotePatch: notePatch,
        NoteList: {
          type: "object",
          properties: {
            items: { type: "array", items: { $ref: "#/components/schemas/Note" } },
            total: { type: "integer" }
          },
          required: ["items", "total"]
        }
      }
    },
    security: [{ apiKey: [] }],
    paths: {
      "/v1/notes": {
        get: {
          operationId: "listNotes",
          summary: "List knowledge items",
          parameters: [
            { name: "limit", in: "query", schema: { type: "integer" } },
            { name: "offset", in: "query", schema: { type: "integer" } },
            { name: "search", in: "query", schema: { type: "string" } }
          ],
          responses: {
            "200": { content: { "application/json": { schema: { $ref: "#/components/schemas/NoteList" } } } }
          }
        },
        post: {
          operationId: "createNote",
          summary: "Create a knowledge item",
          requestBody: {
            required: true,
            content: { "application/json": { schema: { $ref: "#/components/schemas/NoteInput" } } }
          },
          responses: {
            "201": { content: { "application/json": { schema: { $ref: "#/components/schemas/Note" } } } }
          }
        }
      },
      "/v1/notes/{id}": {
        get: {
          operationId: "getNote",
          summary: "Fetch a knowledge item",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: {
            "200": { content: { "application/json": { schema: { $ref: "#/components/schemas/Note" } } } }
          }
        },
        patch: {
          operationId: "updateNote",
          summary: "Update a knowledge item",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          requestBody: {
            required: true,
            content: { "application/json": { schema: { $ref: "#/components/schemas/NotePatch" } } }
          },
          responses: {
            "200": { content: { "application/json": { schema: { $ref: "#/components/schemas/Note" } } } }
          }
        },
        delete: {
          operationId: "deleteNote",
          summary: "Delete a knowledge item",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: { "204": {} }
        }
      },
      "/v1/registry": {
        get: {
          operationId: "getRegistry",
          summary: "Knowledge registry contract",
          responses: {
            "200": { content: { "application/json": { schema: { type: "object", additionalProperties: true } } } }
          }
        }
      }
    }
  };
}

class HttpError extends Error {
  status;
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}
function createServeHandler(deps) {
  const repo = new NoteRepo(deps.client);
  const mode2 = "cloud";
  const authOrThrow = async (req, requiredScopes) => {
    const url = new URL(req.url);
    const decision = await deps.verifier.authenticate(req.headers, {
      method: req.method,
      path: url.pathname,
      requiredScopes
    });
    if (decision.ok === false) {
      throw new HttpError(decision.status, decision.message);
    }
    deps.store.touchLastUsed(decision.principal.kid).catch(() => {});
    return decision.principal;
  };
  return async (req) => {
    const url = new URL(req.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";
    const method = req.method.toUpperCase();
    try {
      if (path === "/health" && method === "GET") {
        return json({ status: "ok", version: deps.version, mode: mode2 });
      }
      if (path === "/version" && method === "GET") {
        return json({ status: "ok", version: deps.version, mode: mode2 });
      }
      if (path === "/ready" && method === "GET") {
        try {
          await deps.client.query("SELECT 1");
          return json({ status: "ready", version: deps.version, mode: mode2 });
        } catch {
          return json({ status: "unavailable", version: deps.version, mode: mode2 }, 503);
        }
      }
      if (path === "/openapi.json" && method === "GET") {
        return json(knowledgeOpenApi(deps.version));
      }
      if (path === "/v1/registry" && method === "GET") {
        await authOrThrow(req, ["knowledge:read"]);
        return json(knowledgeRegistryContract({
          mode: "hosted",
          sourceSchemes: ["open-files", "s3", "web", "file"],
          storageType: "s3",
          artifactUriPrefix: process.env.HASNA_KNOWLEDGE_S3_PREFIX ?? null
        }));
      }
      if (path === "/v1/notes") {
        if (method === "GET") {
          await authOrThrow(req, ["knowledge:read"]);
          const result = await repo.list({
            limit: url.searchParams.has("limit") ? Number(url.searchParams.get("limit")) : undefined,
            offset: url.searchParams.has("offset") ? Number(url.searchParams.get("offset")) : undefined,
            search: url.searchParams.get("search") ?? undefined,
            includeArchived: url.searchParams.get("includeArchived") === "true"
          });
          return json(result);
        }
        if (method === "POST") {
          await authOrThrow(req, ["knowledge:write"]);
          const body = await req.json().catch(() => ({}));
          const item = await repo.create(body);
          return json(item, 201);
        }
        return json({ error: "method_not_allowed" }, 405);
      }
      const noteMatch = path.match(/^\/v1\/notes\/([^/]+)$/);
      if (noteMatch) {
        const id = decodeURIComponent(noteMatch[1]);
        if (method === "GET") {
          await authOrThrow(req, ["knowledge:read"]);
          const item = await repo.get(id);
          return item ? json(item) : json({ error: "not_found" }, 404);
        }
        if (method === "PATCH") {
          await authOrThrow(req, ["knowledge:write"]);
          const body = await req.json().catch(() => ({}));
          const item = await repo.update(id, body);
          return item ? json(item) : json({ error: "not_found" }, 404);
        }
        if (method === "DELETE") {
          await authOrThrow(req, ["knowledge:write"]);
          const ok = await repo.delete(id);
          return ok ? new Response(null, { status: 204 }) : json({ error: "not_found" }, 404);
        }
        return json({ error: "method_not_allowed" }, 405);
      }
      return json({ error: "not_found", path }, 404);
    } catch (error) {
      if (error instanceof HttpError) {
        const reason = error.status === 401 || error.status === 403 ? "unauthorized" : "error";
        return json({ error: reason, message: error.message }, error.status);
      }
      const message = error instanceof Error ? error.message : "internal error";
      return json({ error: "internal", message }, 500);
    }
  };
}
async function startKnowledgeServe(options = {}) {
  const env = options.env ?? process.env;
  const port = options.port ?? Number(env.PORT ?? env.HASNA_KNOWLEDGE_SERVE_PORT ?? 8080);
  const hostname = options.hostname ?? env.HOST ?? "0.0.0.0";
  const version = resolveVersion();
  normalizeCloudDatabaseUrl(env);
  const client = createKnowledgeCloudClient();
  const store = new ApiKeyStore(client);
  const verifier = verifyApiKey({
    app: KNOWLEDGE_SERVE_APP,
    signingSecret: resolveSigningSecret(env),
    isRevoked: store.isRevoked,
    audit: (e) => {
      if (e.outcome === "deny") {
        console.warn(`[knowledge-serve] auth deny kid=${e.kid ?? "-"} reason=${e.reason} ${e.method} ${e.path}`);
      }
    }
  });
  const handler = createServeHandler({ client, verifier, store, version });
  const BunGlobal = globalThis.Bun;
  if (!BunGlobal?.serve) {
    throw new Error("knowledge-serve requires the Bun runtime (Bun.serve unavailable).");
  }
  const server = BunGlobal.serve({ port, hostname, fetch: handler });
  console.log(`[knowledge-serve] listening on http://${hostname}:${server.port} (mode=cloud, version=${version})`);
  return {
    port: server.port,
    hostname,
    stop: async () => {
      server.stop();
      await client.close();
    }
  };
}

// src/serve-entry.ts
var running = await startKnowledgeServe();
var shutdown = async (signal) => {
  console.log(`[knowledge-serve] received ${signal}, shutting down`);
  await running.stop();
  process.exit(0);
};
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
