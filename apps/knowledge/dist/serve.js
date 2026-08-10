// @bun
var __defProp = Object.defineProperty;
var __returnValue = (v) => v;
function __exportSetter(name, newValue) {
  this[name] = __returnValue.bind(null, newValue);
}
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, {
      get: all[name],
      enumerable: true,
      configurable: true,
      set: __exportSetter.bind(all, name)
    });
};
var __esm = (fn, res) => () => (fn && (res = fn(fn = 0)), res);
var __require = import.meta.require;

// src/serve.ts
import { readFileSync as readFileSync4 } from "fs";

// node_modules/@hasna/contracts/dist/auth/index.js
import { createHash, createHmac, randomBytes, timingSafeEqual } from "crypto";
var MAX_TENANT_ID_LENGTH = 64;
var TENANT_ID_PATTERN = new RegExp(`^[A-Za-z0-9][A-Za-z0-9._-]{0,${MAX_TENANT_ID_LENGTH - 1}}$`);
var UUID_HEX = "[0-9a-fA-F]";
var UUID_PATTERN = new RegExp(`^\\{?(?:${UUID_HEX}{8}-${UUID_HEX}{4}-${UUID_HEX}{4}-${UUID_HEX}{4}-${UUID_HEX}{12}|${UUID_HEX}{32})\\}?$`);
function isValidTenantId(value) {
  return typeof value === "string" && TENANT_ID_PATTERN.test(value);
}
function isUuidTenantId(value) {
  return typeof value === "string" && UUID_PATTERN.test(value);
}
function canonicalizeTenantId(value) {
  if (!isUuidTenantId(value))
    return value;
  const hex = value.replace(/[{}-]/g, "").toLowerCase();
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
function normalizeTenantId(value) {
  const trimmed = typeof value === "string" ? value.trim() : "";
  const canonical = canonicalizeTenantId(trimmed);
  if (!isValidTenantId(canonical)) {
    throw new Error(`Invalid tenant id '${value}'. Expected 1-${MAX_TENANT_ID_LENGTH} characters matching ${TENANT_ID_PATTERN} (a UUID, ULID, slug, or prefixed id).`);
  }
  return canonical;
}
function tenantIdsEqual(left, right) {
  const canonical = (value) => {
    if (typeof value !== "string")
      return null;
    const folded = canonicalizeTenantId(value.trim());
    return isValidTenantId(folded) ? folded : null;
  };
  const a = canonical(left);
  const b = canonical(right);
  return a !== null && b !== null && a === b;
}
function ownTenantId(source) {
  return Object.hasOwn(source, "tid") ? source.tid : undefined;
}
var API_KEY_TOKEN_VERSION = 1;
var API_KEY_NAMESPACE = "hasna";
var API_KEY_TOKEN_PATTERN = /^hasna_([a-z][a-z0-9-]*)_([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/;
var TOKEN_PATTERN = API_KEY_TOKEN_PATTERN;
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
  const claimedTid = ownTenantId(claims);
  if (claimedTid !== undefined && !isValidTenantId(claimedTid)) {
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
  const verifiedTid = ownTenantId(claims);
  const tid = verifiedTid === undefined ? null : canonicalizeTenantId(verifiedTid);
  const tenantRequired = Boolean(options.requireTenant) || options.expectedTid !== undefined;
  if (tenantRequired && tid === null) {
    return {
      ok: false,
      reason: "tenant_required",
      message: "Token carries no tenant id ('tid') and this service requires one.",
      kid: claims.kid,
      tid: null
    };
  }
  if (options.expectedTid !== undefined && !tenantIdsEqual(tid, options.expectedTid)) {
    const expectationIsWellFormed = typeof options.expectedTid === "string" && isValidTenantId(options.expectedTid.trim());
    return {
      ok: false,
      reason: "tenant_mismatch",
      message: expectationIsWellFormed ? "Token is for a different tenant than the one this service accepts." : "Token tenant cannot be checked: the expected tenant id is not a valid tenant id.",
      kid: claims.kid,
      tid
    };
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
  return { ok: true, claims, kid: claims.kid, app, tid };
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
    },
    {
      id: `hasna_auth_0003_${table}_tenant`,
      sql: `ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS tid TEXT;
            CREATE INDEX IF NOT EXISTS ${table}_tid_idx ON ${table} (tid);`
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
  const tid = ownTenantId(row);
  return {
    kid: String(row.kid),
    app: String(row.app),
    agent: row.agent === null || row.agent === undefined ? null : String(row.agent),
    tid: tid === null || tid === undefined ? null : String(tid),
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
    const tid = ownTenantId(input);
    await this.client.execute(`INSERT INTO ${this.table}
         (kid, app, agent, tid, scopes, token_hash, issued_at, expires_at, created_by)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9)`, [
      input.kid,
      input.app,
      input.agent ?? null,
      tid === undefined || tid === null ? null : normalizeTenantId(tid),
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
      tid: ownTenantId(claims) ?? null,
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
    const tid = ownTenantId(options);
    if (tid !== undefined) {
      params.push(normalizeTenantId(tid));
      clauses.push(`tid = $${params.length}`);
    }
    if (!options.includeRevoked) {
      clauses.push("revoked_at IS NULL");
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = await this.client.many(`SELECT * FROM ${this.table} ${where} ORDER BY issued_at DESC`, params);
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
  if (options.expectedTid !== undefined && !isValidTenantId(options.expectedTid)) {
    throw new Error(`verifyApiKey received an invalid 'expectedTid': '${options.expectedTid}'.`);
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
    const perCallTid = Object.hasOwn(context, "expectedTid") ? context.expectedTid : undefined;
    const expectedTid = perCallTid !== undefined ? perCallTid : options.expectedTid;
    if (perCallTid !== undefined && options.expectedTid !== undefined && !tenantIdsEqual(perCallTid, options.expectedTid)) {
      await emit({ outcome: "deny", app: options.app, kid: null, tid: null, reason: "tenant_mismatch", scopesRequired: requiredScopes, method, path, status: 403, at });
      return {
        ok: false,
        status: 403,
        reason: "tenant_mismatch",
        message: "This route addresses a tenant other than the one this service is pinned to."
      };
    }
    const token = extractToken(headers, headerName, scheme);
    if (!token) {
      const decision = {
        ok: false,
        status: 401,
        reason: "missing_token",
        message: `Missing API key. Send it as '${headerName}: <key>' or 'Authorization: ${scheme} <key>'.`
      };
      await emit({ outcome: "deny", app: options.app, kid: null, tid: null, reason: "missing_token", scopesRequired: requiredScopes, method, path, status: 401, at });
      return decision;
    }
    const verified = verifyApiKeyToken(token, {
      signingSecret: options.signingSecret,
      expectedApp: options.app,
      nowMs: clock(),
      ...options.leewaySeconds !== undefined ? { leewaySeconds: options.leewaySeconds } : {},
      ...options.requireTenant !== undefined ? { requireTenant: options.requireTenant } : {},
      ...expectedTid !== undefined ? { expectedTid } : {},
      requiredScopes
    });
    if (!verified.ok) {
      const status = verified.reason === "insufficient_scope" || verified.reason === "tenant_mismatch" || verified.reason === "tenant_required" ? 403 : 401;
      await emit({ outcome: "deny", app: options.app, kid: verified.kid ?? null, tid: ownTenantId(verified) ?? null, reason: verified.reason, scopesRequired: requiredScopes, method, path, status, at });
      return { ok: false, status, reason: verified.reason, message: verified.message };
    }
    if (options.isRevoked) {
      const revoked = await options.isRevoked(verified.kid);
      if (revoked) {
        await emit({ outcome: "deny", app: options.app, kid: verified.kid, tid: verified.tid, reason: "revoked", scopesRequired: requiredScopes, method, path, status: 401, at });
        return { ok: false, status: 401, reason: "revoked", message: "API key has been revoked." };
      }
    }
    const principal = {
      kid: verified.kid,
      app: verified.app,
      scopes: verified.claims.scopes,
      agent: verified.claims.agent ?? null,
      tid: verified.tid,
      claims: verified.claims
    };
    await emit({ outcome: "allow", app: options.app, kid: verified.kid, tid: verified.tid, reason: null, scopesRequired: requiredScopes, method, path, status: 200, at });
    return { ok: true, status: 200, principal };
  }
  return { authenticate, app: options.app };
}
var MAX_FLEET_TOKEN_TTL_SECONDS = 24 * 60 * 60;

// src/generated/storage-kit/mode.ts
function normalizeStorageMode(value) {
  const normalized = value.trim().toLowerCase().replace(/-/g, "_");
  if (normalized === "sqlite")
    return { mode: "sqlite" };
  if (normalized === "postgres" || normalized === "postgresql")
    return { mode: "postgres" };
  throw new Error(`Unknown storage mode '${value}'. The runtime-placement axis was removed; ` + `set sqlite for the on-box SQLite file or postgres for a PostgreSQL server (DATABASE_URL).`);
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
      mode: databaseUrlPresent ? "postgres" : "sqlite",
      source: databaseUrlPresent ? databaseUrlSource : "default",
      databaseUrlPresent,
      databaseUrlSource,
      warning: null
    };
  }
  const { mode } = normalizeStorageMode(modeHit.value);
  const warnings = [];
  if (mode === "postgres" && !databaseUrlPresent) {
    warnings.push(`postgres storage needs ${databaseUrlKeys[0]} (reads and writes go to PostgreSQL).`);
  }
  if (modeHit.key !== modeKeys[0]) {
    warnings.push(`Using alias env ${modeHit.key}; the canonical key is ${modeKeys[0]}.`);
  }
  return {
    mode,
    source: modeHit.key,
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
  if (mode === "disable" || mode === "prefer") {
    return;
  }
  const ca = loadCaBundle(options);
  if (mode === "require") {
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
function createServerPoolFromEnv(appName, options = {}) {
  const env = options.env ?? process.env;
  const resolution = resolveStorageMode(appName, env);
  if (resolution.mode !== "postgres") {
    throw new Error(`createServerPoolFromEnv requires ${appName} storage mode 'postgres', got '${resolution.mode}'. ` + `Set HASNA_${appName.toUpperCase().replace(/-/g, "_")}_STORAGE_MODE=postgres.`);
  }
  const connectionString = resolveDatabaseUrl(appName, env);
  if (!connectionString) {
    throw new Error(`postgres storage for ${appName} needs a database URL. Set ` + `HASNA_${appName.toUpperCase().replace(/-/g, "_")}_DATABASE_URL.`);
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
// src/generated/storage-kit/migrations.ts
import { createHash as createHash2 } from "crypto";
var DEFAULT_MIGRATION_LEDGER_TABLE = "schema_migrations";
function checksumSql(sql) {
  const normalized = sql.trim().replace(/\r\n/g, `
`);
  return `sha256:${createHash2("sha256").update(normalized).digest("hex")}`;
}
function defineMigration(id, sql) {
  return Object.freeze({ id, sql: sql.trim(), checksum: checksumSql(sql) });
}

class MigrationLedger {
  client;
  migrations;
  ledgerTable;
  constructor(client, migrations, options = {}) {
    this.client = client;
    this.migrations = migrations;
    this.ledgerTable = options.ledgerTable ?? DEFAULT_MIGRATION_LEDGER_TABLE;
    const seen = new Set;
    for (const migration of migrations) {
      if (seen.has(migration.id))
        throw new Error(`Duplicate migration id: ${migration.id}`);
      seen.add(migration.id);
    }
  }
  async ensureLedger() {
    await this.client.execute(`CREATE TABLE IF NOT EXISTS ${this.ledgerTable} (
         id TEXT PRIMARY KEY,
         checksum TEXT NOT NULL,
         applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
       )`);
  }
  async listApplied() {
    await this.ensureLedger();
    return this.readApplied();
  }
  async readApplied() {
    const rows = await this.client.many(`SELECT id, checksum, applied_at FROM ${this.ledgerTable} ORDER BY id ASC`);
    return rows.map((row) => ({
      id: row.id,
      checksum: row.checksum,
      appliedAt: row.applied_at instanceof Date ? row.applied_at.toISOString() : String(row.applied_at)
    }));
  }
  buildPlan(applied) {
    const known = new Set(this.migrations.map((m) => m.id));
    for (const row of applied) {
      if (!known.has(row.id)) {
        throw new Error(`Applied migration '${row.id}' is not recognized by this build (downgrade?).`);
      }
    }
    const appliedById = new Map(applied.map((row) => [row.id, row]));
    for (const migration of this.migrations) {
      const existing = appliedById.get(migration.id);
      if (existing && existing.checksum !== migration.checksum) {
        throw new Error(`Migration checksum mismatch for '${migration.id}': the SQL changed after it was applied.`);
      }
    }
    return this.migrations.map((migration) => ({
      migration,
      state: appliedById.has(migration.id) ? "already_applied" : "pending"
    }));
  }
  async migrate(opts = {}) {
    const dryRun = opts.dryRun === true;
    await this.ensureLedger();
    const applied = await this.readApplied();
    const plan = this.buildPlan(applied);
    if (dryRun)
      return { dryRun, applied, plan };
    for (const item of plan) {
      if (item.state === "already_applied")
        continue;
      await this.client.execute(item.migration.sql);
      await this.client.execute(`INSERT INTO ${this.ledgerTable} (id, checksum, applied_at) VALUES ($1, $2, now())`, [item.migration.id, item.migration.checksum]);
    }
    return { dryRun, applied: await this.readApplied(), plan };
  }
}
function createMigrationLedger(client, migrations, options = {}) {
  return new MigrationLedger(client, migrations, options);
}
// src/generated/storage-kit/health.ts
async function checkHealth(client) {
  const start = Date.now();
  try {
    await client.get("SELECT 1 AS ok");
    return { ok: true, latencyMs: Date.now() - start };
  } catch (error) {
    return {
      ok: false,
      latencyMs: Date.now() - start,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}
async function checkReady(client, migrations, options = {}) {
  const start = Date.now();
  try {
    const ledger = new MigrationLedger(client, migrations, options);
    const result = await ledger.migrate({ dryRun: true });
    const pending = result.plan.filter((item) => item.state === "pending").map((item) => item.migration.id);
    return { ok: pending.length === 0, latencyMs: Date.now() - start, pendingMigrations: pending };
  } catch (error) {
    return {
      ok: false,
      latencyMs: Date.now() - start,
      pendingMigrations: [],
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

// src/generated/storage-kit/index.ts
var KIT_VERSION = "0.8.5";

// src/db/remote-storage.ts
var KNOWLEDGE_APP_NAME = "knowledge";
function createKnowledgeCloudClient() {
  return createServerPoolFromEnv(KNOWLEDGE_APP_NAME, { applicationName: "@hasna/knowledge" }).client;
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

// src/store.ts
import {
  chmodSync as chmodSync2,
  closeSync,
  existsSync as existsSync2,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync as readFileSync3,
  renameSync,
  unlinkSync,
  writeFileSync as writeFileSync2
} from "fs";
import { randomUUID } from "crypto";
import { basename, dirname as dirname2, join as join2 } from "path";

// src/workspace.ts
import { chmodSync, existsSync, mkdirSync, readFileSync as readFileSync2, writeFileSync } from "fs";
import { homedir } from "os";
import { dirname, join, resolve } from "path";
var HASNA_KNOWLEDGE_APP_PATH = join(".hasna", "knowledge");
var LEGACY_HASNA_KNOWLEDGE_APP_PATH = join(".hasna", "apps", "knowledge");
var EXAMPLE_KNOWLEDGE_CANONICAL = {
  division: "xyz",
  app_type: "opensource",
  app: "knowledge",
  env: "prod",
  local_path: HASNA_KNOWLEDGE_APP_PATH,
  s3: {
    bucket: "example-knowledge-prod",
    region: "us-east-1",
    profile: "example-infra",
    prefix: ".hasna/knowledge",
    server_side_encryption: "AES256"
  },
  secrets: {
    env: "example/knowledge/prod/env",
    aws: "example/knowledge/prod/aws",
    s3: "example/knowledge/prod/s3",
    rds: null,
    future_rds: "example/knowledge/prod/rds"
  },
  source_owner: "open-files",
  evidence_doc: "docs/canonical-secrets-bootstrap-2026-06-08.md"
};
function canonicalExampleKnowledgeStorage() {
  return {
    type: "s3",
    artifacts_root: "artifacts",
    s3: {
      bucket: EXAMPLE_KNOWLEDGE_CANONICAL.s3.bucket,
      prefix: EXAMPLE_KNOWLEDGE_CANONICAL.s3.prefix,
      region: EXAMPLE_KNOWLEDGE_CANONICAL.s3.region,
      profile: EXAMPLE_KNOWLEDGE_CANONICAL.s3.profile,
      server_side_encryption: EXAMPLE_KNOWLEDGE_CANONICAL.s3.server_side_encryption
    }
  };
}
function legacyGlobalStorePath() {
  return join(homedir(), ".open-knowledge", "db.json");
}
function globalKnowledgeHome() {
  return join(homedir(), ".hasna", "knowledge");
}
function projectKnowledgeHome(cwd = process.cwd()) {
  return resolve(cwd, HASNA_KNOWLEDGE_APP_PATH);
}
function legacyGlobalKnowledgeHome() {
  return join(homedir(), LEGACY_HASNA_KNOWLEDGE_APP_PATH);
}
function legacyProjectKnowledgeHome(cwd = process.cwd()) {
  return resolve(cwd, LEGACY_HASNA_KNOWLEDGE_APP_PATH);
}
function resolveLegacyScopedWorkspace(scope, cwd = process.cwd()) {
  if (scope === "project" || scope === "local") {
    return workspaceForHome(legacyProjectKnowledgeHome(cwd));
  }
  return workspaceForHome(legacyGlobalKnowledgeHome());
}
function workspaceForHome(home) {
  return {
    home,
    configPath: join(home, "config.json"),
    jsonStorePath: join(home, "db.json"),
    knowledgeDbPath: join(home, "knowledge.db"),
    artifactsDir: join(home, "artifacts"),
    cacheDir: join(home, "cache"),
    exportsDir: join(home, "exports"),
    indexesDir: join(home, "indexes"),
    logsDir: join(home, "logs"),
    runsDir: join(home, "runs"),
    schemasDir: join(home, "schemas"),
    wikiDir: join(home, "wiki")
  };
}
function defaultKnowledgeConfig() {
  return {
    version: 1,
    mode: "local",
    hosted: {
      api_url: "https://knowledge.md"
    },
    storage: {
      type: "local",
      artifacts_root: "artifacts"
    },
    sources: {
      preferred_ref: "open-files",
      allowed_schemes: ["open-files", "s3", "file", "https", "http"]
    },
    providers: {
      default_model: "openai:gpt-5.2",
      aliases: {
        fast: "openai:gpt-5-mini",
        reasoning: "anthropic:claude-opus-4-6",
        sonnet: "anthropic:claude-sonnet-4-6",
        deepseek: "deepseek:deepseek-chat",
        "deepseek-reasoning": "deepseek:deepseek-reasoner"
      },
      openai: {
        api_key_env: "OPENAI_API_KEY",
        default_model: "gpt-5.2"
      },
      anthropic: {
        api_key_env: "ANTHROPIC_API_KEY",
        default_model: "claude-sonnet-4-6"
      },
      deepseek: {
        api_key_env: "DEEPSEEK_API_KEY",
        default_model: "deepseek-chat"
      }
    },
    embeddings: {
      default_model: "openai:text-embedding-3-small",
      dimensions: 1536,
      batch_size: 64,
      max_parallel_calls: 4
    },
    safety: {
      network: {
        web_search_enabled: false,
        s3_reads_enabled: false,
        allowed_s3_buckets: []
      },
      redaction: {
        enabled: true
      },
      approvals: {
        generated_writes_require_approval: true
      }
    }
  };
}
function ensureKnowledgeWorkspace(home) {
  const workspace = workspaceForHome(home);
  mkdirSync(workspace.home, { recursive: true, mode: 448 });
  for (const dir of [
    workspace.artifactsDir,
    workspace.cacheDir,
    workspace.exportsDir,
    workspace.indexesDir,
    workspace.logsDir,
    workspace.runsDir,
    workspace.schemasDir,
    workspace.wikiDir
  ]) {
    mkdirSync(dir, { recursive: true, mode: 448 });
  }
  if (!existsSync(workspace.configPath)) {
    writeFileSync(workspace.configPath, `${JSON.stringify(defaultKnowledgeConfig(), null, 2)}
`, { mode: 384 });
    chmodSync(workspace.configPath, 384);
  }
  return workspace;
}
function resolveScopedWorkspace(scope, cwd = process.cwd()) {
  if (scope === "project" || scope === "local") {
    return workspaceForHome(projectKnowledgeHome(cwd));
  }
  return workspaceForHome(globalKnowledgeHome());
}
function ensureParentDir(path) {
  mkdirSync(dirname(path), { recursive: true });
}
function readKnowledgeConfig(path) {
  const raw = readFileSync2(path, "utf8");
  return JSON.parse(raw);
}
function writeKnowledgeConfig(path, config) {
  ensureParentDir(path);
  writeFileSync(path, `${JSON.stringify(config, null, 2)}
`, { mode: 384 });
  chmodSync(path, 384);
}

// src/store.ts
function defaultStorePath() {
  return workspaceForHome(globalKnowledgeHome()).jsonStorePath;
}
function ensureStore(path) {
  if (path === defaultStorePath() && existsSync2(legacyGlobalStorePath())) {
    importLegacyGlobalStore();
  }
  if (!existsSync2(path)) {
    ensureParentDir(path);
    writeFileAtomic(path, `${JSON.stringify({ items: [] }, null, 2)}
`);
  }
}
function timestampForPath(now) {
  return now.toISOString().replace(/[:.]/g, "-");
}
function storeIdentityKeys(item) {
  const keys = [`id:${item.id}`];
  if (typeof item.short_id === "string" && item.short_id.length > 0) {
    keys.push(`short_id:${item.short_id}`);
  }
  return keys;
}
function indexStoreItems(items) {
  const index = new Set;
  for (const item of items) {
    for (const key of storeIdentityKeys(item))
      index.add(key);
  }
  return index;
}
function storeContainsItem(index, item) {
  return storeIdentityKeys(item).some((key) => index.has(key));
}
function writeJsonFile(path, value) {
  ensureParentDir(path);
  writeFileSync2(path, `${JSON.stringify(value, null, 2)}
`, { mode: 384 });
  chmodSync2(path, 384);
}
function readStoreFileForImport(path) {
  const value = JSON.parse(readFileSync3(path, "utf8"));
  if (!value || typeof value !== "object" || !Array.isArray(value.items)) {
    return { store: { items: [] }, skippedInvalid: 0 };
  }
  const store = { items: [] };
  let skippedInvalid = 0;
  for (const item of value.items) {
    if (item && typeof item === "object" && typeof item.id === "string" && item.id.length > 0) {
      store.items.push(item);
    } else {
      skippedInvalid += 1;
    }
  }
  return { store, skippedInvalid };
}
function importLegacyGlobalStore(options = {}) {
  if (options.dryRun === true)
    return importLegacyGlobalStoreUnlocked(options);
  return withLock(defaultStorePath(), () => importLegacyGlobalStoreUnlocked(options), { createParent: true });
}
function importLegacyGlobalStoreUnlocked(options = {}) {
  const dryRun = options.dryRun === true;
  const now = options.now ?? new Date;
  const workspace = workspaceForHome(globalKnowledgeHome());
  const legacyPath = legacyGlobalStorePath();
  const canonicalPath = workspace.jsonStorePath;
  const legacyExists = existsSync2(legacyPath);
  const canonicalExisted = existsSync2(canonicalPath);
  const result = {
    ok: true,
    dry_run: dryRun,
    legacy_path: legacyPath,
    canonical_path: canonicalPath,
    legacy_exists: legacyExists,
    canonical_existed: canonicalExisted,
    canonical_created: false,
    would_create_canonical: false,
    imported: 0,
    skipped_existing: 0,
    skipped_invalid: 0,
    backup_path: null,
    report_path: null,
    errors: [],
    message: legacyExists ? "Legacy global store already imported" : "No legacy global store found"
  };
  if (!legacyExists)
    return result;
  let legacyStore;
  try {
    const legacy = readStoreFileForImport(legacyPath);
    legacyStore = legacy.store;
    result.skipped_invalid = legacy.skippedInvalid;
  } catch (error) {
    result.ok = false;
    result.errors.push(`Could not read legacy store: ${error instanceof Error ? error.message : String(error)}`);
    result.message = "Legacy global store import failed";
    return result;
  }
  let canonicalStore = { items: [] };
  if (canonicalExisted) {
    try {
      canonicalStore = readStoreFileForImport(canonicalPath).store;
    } catch (error) {
      result.ok = false;
      result.errors.push(`Could not read canonical store: ${error instanceof Error ? error.message : String(error)}`);
      result.message = "Legacy global store import failed";
      return result;
    }
  }
  const index = indexStoreItems(canonicalStore.items);
  const merged = { items: [...canonicalStore.items] };
  for (const item of legacyStore.items) {
    if (!item?.id) {
      result.skipped_invalid += 1;
      continue;
    }
    if (storeContainsItem(index, item)) {
      result.skipped_existing += 1;
      continue;
    }
    merged.items.push(item);
    for (const key of storeIdentityKeys(item))
      index.add(key);
    result.imported += 1;
  }
  result.would_create_canonical = !canonicalExisted && result.imported > 0;
  result.canonical_created = !dryRun && result.would_create_canonical;
  result.message = result.imported > 0 ? `Imported ${result.imported} legacy item(s) into canonical knowledge store` : "Legacy global store already imported";
  if (dryRun || result.imported === 0)
    return result;
  const suffix = `${timestampForPath(now)}-${randomUUID().slice(0, 8)}`;
  if (canonicalExisted) {
    result.backup_path = join2(workspace.exportsDir, `legacy-open-knowledge-db-before-import-${suffix}.json`);
    writeJsonFile(result.backup_path, canonicalStore);
  }
  writeJsonFile(canonicalPath, merged);
  result.report_path = join2(workspace.runsDir, `legacy-open-knowledge-import-${suffix}.json`);
  writeJsonFile(result.report_path, result);
  return result;
}
function loadStoreIfExists(path) {
  if (!existsSync2(path))
    return { exists: false, items: [] };
  const raw = readFileSync3(path, "utf8");
  const parsed = JSON.parse(raw);
  if (!parsed || !Array.isArray(parsed.items)) {
    return { exists: true, items: [] };
  }
  return { exists: true, items: parsed.items };
}
function lockPath(path) {
  return `${path}.lock`;
}
var LOCK_MAX_WAIT_MS = 1e4;
var LOCK_RETRY_MS = 25;
var LOCK_STALE_MS = 120000;
var SLEEP_BUFFER = new Int32Array(new SharedArrayBuffer(4));
function errCode(error) {
  return typeof error === "object" && error !== null && "code" in error ? String(error.code) : undefined;
}
function syncParentDir(path) {
  let fd = null;
  try {
    fd = openSync(dirname2(path), "r");
    fsyncSync(fd);
  } catch {} finally {
    if (fd !== null) {
      try {
        closeSync(fd);
      } catch {}
    }
  }
}
var heldLockPaths = new Set;
function writeFileAtomic(path, contents) {
  ensureParentDir(path);
  const tmp = join2(dirname2(path), `.${basename(path)}.tmp.${randomUUID()}`);
  let fd = null;
  try {
    fd = openSync(tmp, "wx", 384);
    writeFileSync2(fd, contents);
    fsyncSync(fd);
    closeSync(fd);
    fd = null;
    renameSync(tmp, path);
    try {
      chmodSync2(path, 384);
    } catch {}
    syncParentDir(path);
  } catch (error) {
    if (fd !== null) {
      try {
        closeSync(fd);
      } catch {}
    }
    try {
      unlinkSync(tmp);
    } catch {}
    throw error;
  }
}
function sleepSync(ms) {
  Atomics.wait(SLEEP_BUFFER, 0, 0, ms);
}
function processIsAlive(pid) {
  if (typeof pid !== "number" || !Number.isInteger(pid) || pid <= 0)
    return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return errCode(error) !== "ESRCH";
  }
}
function lockIsStale(path, now) {
  try {
    const raw = readFileSync3(path, "utf8");
    const lock = JSON.parse(raw);
    if (typeof lock.ts === "number") {
      return now - lock.ts > LOCK_STALE_MS && !processIsAlive(lock.pid);
    }
  } catch {}
  try {
    return now - lstatSync(path).mtimeMs > LOCK_STALE_MS;
  } catch {
    return false;
  }
}
function moveStaleLock(path) {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const stalePath = `${path}.stale.${stamp}.${randomUUID()}`;
  try {
    renameSync(path, stalePath);
  } catch (error) {
    if (errCode(error) !== "ENOENT")
      throw error;
    return;
  }
}
function breakStaleLock(lockPath2) {
  const owner = randomUUID();
  const breakerPath = `${lockPath2}.breaker`;
  const start = Date.now();
  while (Date.now() - start < LOCK_MAX_WAIT_MS) {
    if (tryAcquireLock(breakerPath, owner)) {
      try {
        if (lockIsStale(lockPath2, Date.now())) {
          moveStaleLock(lockPath2);
        }
      } finally {
        releaseLock(breakerPath, owner);
      }
      return;
    }
    sleepSync(LOCK_RETRY_MS);
  }
  throw new Error(`Could not acquire stale-lock breaker on ${breakerPath} after ${LOCK_MAX_WAIT_MS}ms`);
}
var LOCK_CONTENTION_CODES = new Set(["EEXIST", "EPERM", "EBUSY"]);
function isLockContentionCode(code) {
  return code !== undefined && LOCK_CONTENTION_CODES.has(code);
}
function tryAcquireLock(path, ownerId, onContention) {
  let fd = null;
  let created = false;
  try {
    fd = openSync(path, "wx", 384);
    created = true;
    writeFileSync2(fd, `${JSON.stringify({ owner: ownerId, pid: process.pid, ts: Date.now() })}
`);
    fsyncSync(fd);
    closeSync(fd);
    fd = null;
    syncParentDir(path);
    return true;
  } catch (error) {
    if (fd !== null) {
      try {
        closeSync(fd);
      } catch {}
    }
    if (created) {
      try {
        unlinkSync(path);
      } catch {}
    }
    const code = errCode(error);
    if (isLockContentionCode(code)) {
      onContention?.(code);
      return false;
    }
    throw error;
  }
}
function acquireLock(lockPath2, ownerId) {
  const start = Date.now();
  let lastContention;
  const note = (code) => {
    lastContention = code;
  };
  while (Date.now() - start < LOCK_MAX_WAIT_MS) {
    if (tryAcquireLock(lockPath2, ownerId, note))
      return;
    if (lockIsStale(lockPath2, Date.now())) {
      breakStaleLock(lockPath2);
    }
    sleepSync(LOCK_RETRY_MS);
  }
  throw new Error(`Could not acquire lock on ${lockPath2} after ${LOCK_MAX_WAIT_MS}ms` + (lastContention ? ` (last contention: ${lastContention})` : ""));
}
function releaseLock(lockPath2, ownerId) {
  try {
    if (existsSync2(lockPath2)) {
      const lock = JSON.parse(readFileSync3(lockPath2, "utf8"));
      if (lock.owner === ownerId) {
        unlinkSync(lockPath2);
      }
    }
  } catch {}
}
function loadStore(path) {
  ensureStore(path);
  const raw = readFileSync3(path, "utf8");
  const parsed = JSON.parse(raw);
  if (!parsed || !Array.isArray(parsed.items)) {
    return { items: [] };
  }
  return parsed;
}
function saveStore(path, store) {
  writeFileAtomic(path, `${JSON.stringify(store, null, 2)}
`);
}
function withLock(path, fn, options = {}) {
  const owner = randomUUID();
  const lpath = lockPath(path);
  if (heldLockPaths.has(lpath))
    return fn();
  if (options.createParent)
    ensureParentDir(lpath);
  acquireLock(lpath, owner);
  heldLockPaths.add(lpath);
  try {
    return fn();
  } finally {
    heldLockPaths.delete(lpath);
    releaseLock(lpath, owner);
  }
}
function makeId() {
  return `k_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
function makeShortId(id) {
  return id.replace(/^k_/, "").slice(0, 12);
}

// src/guarded-write-contract.ts
import { createHash as createHash3, randomUUID as randomUUID2 } from "crypto";
var KNOWLEDGE_GUARDED_WRITE_CONTRACT = "FCAME-1";
var KNOWLEDGE_PRIVATE_INPUT_SCHEMA = "hasna.knowledge.private-input.v1";
var KNOWLEDGE_PRIVATE_TITLE_LOOKUP_SCHEMA = "hasna.knowledge.private-title-lookup.v1";
var KNOWLEDGE_PRIVATE_QUERY_SCHEMA = "hasna.knowledge.private-query.v1";
var KNOWLEDGE_PRIVATE_RESULT_SCHEMA = "hasna.knowledge.private-result.v1";
var KNOWLEDGE_RELATIONS_SCHEMA = "hasna.knowledge.relations.v1";
var KNOWLEDGE_RELATIONS_METADATA_KEY = "hasna_knowledge_relations";
var DEFAULT_KNOWLEDGE_GUARDED_LIMITS = Object.freeze({
  submission: Object.freeze({
    max_calls: 1,
    max_items: 1,
    max_bytes: 1048576,
    wall_time_ms: 1e4
  }),
  reconciliation: Object.freeze({
    max_calls: 1,
    max_items: 1,
    max_bytes: 262144,
    wall_time_ms: 5000
  }),
  readback: Object.freeze({
    max_calls: 1,
    max_items: 1,
    max_bytes: 1048576,
    wall_time_ms: 5000
  })
});
var MAX_GUARDED_BYTES = 4 * 1024 * 1024;
var MAX_GUARDED_WALL_TIME_MS = 30000;
var MAX_DESCRIPTOR_LIFETIME_MS = 60 * 60 * 1000;
var PRIVATE_PAYLOADS = new WeakMap;
var PRIVATE_TITLE_LOOKUPS = new WeakMap;
var PRIVATE_QUERIES = new WeakMap;
var PRIVATE_RESULTS = new WeakMap;
function assertObjectKeys(value, field, allowed, required = allowed) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${field} must be an object.`);
  }
  const keys = Object.keys(value);
  const unexpected = keys.filter((key) => !allowed.includes(key));
  const missing = required.filter((key) => !keys.includes(key));
  if (unexpected.length > 0 || missing.length > 0) {
    throw new Error(`${field} keys must match its FCAME-1 schema` + `${unexpected.length > 0 ? `; unexpected: ${unexpected.sort().join(",")}` : ""}` + `${missing.length > 0 ? `; missing: ${missing.sort().join(",")}` : ""}.`);
  }
}
function assertBoundText(value, field, maxLength = 512) {
  if (typeof value !== "string" || value.length === 0 || value.length > maxLength || value.trim() !== value || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error(`${field} must be a non-empty, trimmed string without control characters.`);
  }
}
function assertKnowledgeGuardedBinding(binding) {
  assertObjectKeys(binding, "binding", ["authority", "tenant_id", "scope", "parent_id"]);
  assertObjectKeys(binding.authority, "binding.authority", ["classification", "authority_id"]);
  if (!["user_hosted", "hasna_saas"].includes(binding.authority.classification)) {
    throw new Error("binding.authority.classification must be user_hosted or hasna_saas.");
  }
  assertBoundText(binding.authority.authority_id, "binding.authority.authority_id");
  assertBoundText(binding.tenant_id, "binding.tenant_id", 64);
  assertBoundText(binding.scope, "binding.scope");
  assertBoundText(binding.parent_id, "binding.parent_id");
}
function assertKnowledgeGuardedPrecondition(verb, precondition) {
  if (!["create", "update"].includes(verb)) {
    throw new Error("verb must be create or update.");
  }
  if (verb === "create") {
    assertObjectKeys(precondition, "precondition", ["kind"]);
    if (!precondition || precondition.kind !== "absent") {
      throw new Error("create requires the create-if-absent precondition.");
    }
    return;
  }
  assertObjectKeys(precondition, "precondition", ["kind", "expected_version"]);
  if (!precondition || precondition.kind !== "version" || !Number.isInteger(precondition.expected_version) || precondition.expected_version < 1) {
    throw new Error("update requires a positive compare-and-swap expected_version.");
  }
}
function assertKnowledgeGuardedManifestBinding(manifest) {
  assertObjectKeys(manifest, "manifest", ["manifest_id", "ordinal", "phase", "compensates_receipt_id"]);
  assertBoundText(manifest.manifest_id, "manifest.manifest_id");
  if (!Number.isInteger(manifest.ordinal) || manifest.ordinal < 0) {
    throw new Error("manifest.ordinal must be a non-negative integer.");
  }
  if (!["primary", "recovery"].includes(manifest.phase)) {
    throw new Error("manifest.phase must be primary or recovery.");
  }
  if (manifest.phase === "primary" && manifest.compensates_receipt_id !== null) {
    throw new Error("a primary manifest step cannot compensate a receipt.");
  }
  if (manifest.compensates_receipt_id !== null && (typeof manifest.compensates_receipt_id !== "string" || !/^kwr_[0-9a-f]{64}$/.test(manifest.compensates_receipt_id))) {
    throw new Error("manifest.compensates_receipt_id must be null or an immutable guarded receipt id.");
  }
}
function assertKnowledgeGuardedBounds(bounds, field = "limits") {
  assertObjectKeys(bounds, field, ["max_calls", "max_items", "max_bytes", "wall_time_ms"]);
  if (bounds.max_calls !== 1)
    throw new Error(`${field}.max_calls must be exactly 1.`);
  if (bounds.max_items !== 1)
    throw new Error(`${field}.max_items must be exactly 1.`);
  if (!Number.isInteger(bounds.max_bytes) || bounds.max_bytes < 1 || bounds.max_bytes > MAX_GUARDED_BYTES) {
    throw new Error(`${field}.max_bytes must be a positive integer no greater than ${MAX_GUARDED_BYTES}.`);
  }
  if (!Number.isInteger(bounds.wall_time_ms) || bounds.wall_time_ms < 1 || bounds.wall_time_ms > MAX_GUARDED_WALL_TIME_MS) {
    throw new Error(`${field}.wall_time_ms must be a positive integer no greater than ${MAX_GUARDED_WALL_TIME_MS}.`);
  }
}
function assertKnowledgePrivateQueryBounds(bounds, field = "query limits") {
  assertObjectKeys(bounds, field, ["max_calls", "max_items", "max_bytes", "wall_time_ms"]);
  if (bounds.max_calls !== 1)
    throw new Error(`${field}.max_calls must be exactly 1.`);
  if (!Number.isInteger(bounds.max_items) || bounds.max_items < 1 || bounds.max_items > 50) {
    throw new Error(`${field}.max_items must be an integer between 1 and 50.`);
  }
  if (!Number.isInteger(bounds.max_bytes) || bounds.max_bytes < 1 || bounds.max_bytes > MAX_GUARDED_BYTES) {
    throw new Error(`${field}.max_bytes must be a positive integer no greater than ${MAX_GUARDED_BYTES}.`);
  }
  if (!Number.isInteger(bounds.wall_time_ms) || bounds.wall_time_ms < 1 || bounds.wall_time_ms > MAX_GUARDED_WALL_TIME_MS) {
    throw new Error(`${field}.wall_time_ms must be a positive integer no greater than ${MAX_GUARDED_WALL_TIME_MS}.`);
  }
}
function assertKnowledgePrivateQueryPage(page, bounds) {
  assertObjectKeys(page, "query page", ["limit", "offset"]);
  if (!Number.isInteger(page.limit) || page.limit < 1 || page.limit > bounds.max_items) {
    throw new Error("query page.limit must be a positive integer no greater than limits.max_items.");
  }
  if (!Number.isInteger(page.offset) || page.offset < 0 || page.offset > 1e4) {
    throw new Error("query page.offset must be an integer between 0 and 10000.");
  }
}
function assertKnowledgePrivateQuerySelector(selector) {
  if (!selector || typeof selector !== "object" || Array.isArray(selector)) {
    throw new Error("private query selector must be an object.");
  }
  switch (selector.kind) {
    case "exact_title":
      assertObjectKeys(selector, "private query selector", ["kind", "title"]);
      assertBoundText(selector.title, "private query selector.title", 2048);
      return;
    case "lexical_overlap":
    case "semantic_overlap":
      assertObjectKeys(selector, "private query selector", ["kind", "query"]);
      assertBoundText(selector.query, "private query selector.query", 4096);
      return;
    case "supersession":
      assertObjectKeys(selector, "private query selector", ["kind", "supersedes_item_id"]);
      assertBoundText(selector.supersedes_item_id, "private query selector.supersedes_item_id");
      return;
    case "current_version":
      assertObjectKeys(selector, "private query selector", ["kind", "item_id"]);
      assertBoundText(selector.item_id, "private query selector.item_id");
      return;
    case "historical_version":
      assertObjectKeys(selector, "private query selector", ["kind", "item_id", "version"]);
      assertBoundText(selector.item_id, "private query selector.item_id");
      if (!Number.isInteger(selector.version) || selector.version < 1) {
        throw new Error("private query selector.version must be a positive integer.");
      }
      return;
    case "canonical_pointer":
      assertObjectKeys(selector, "private query selector", ["kind", "canonical_item_id"]);
      assertBoundText(selector.canonical_item_id, "private query selector.canonical_item_id");
      return;
    default:
      throw new Error("private query selector.kind is unsupported.");
  }
}
function assertKnowledgeRelationsMetadata(metadata, itemId) {
  const raw = metadata[KNOWLEDGE_RELATIONS_METADATA_KEY];
  if (raw === undefined)
    return;
  assertObjectKeys(raw, `metadata.${KNOWLEDGE_RELATIONS_METADATA_KEY}`, ["schema", "supersedes_item_id", "canonical_item_id"], ["schema"]);
  if (raw.schema !== KNOWLEDGE_RELATIONS_SCHEMA) {
    throw new Error(`metadata.${KNOWLEDGE_RELATIONS_METADATA_KEY}.schema is unsupported.`);
  }
  const supersedes = raw.supersedes_item_id;
  const canonical = raw.canonical_item_id;
  if (supersedes === undefined && canonical === undefined) {
    throw new Error(`metadata.${KNOWLEDGE_RELATIONS_METADATA_KEY} must contain at least one pointer.`);
  }
  if (supersedes !== undefined) {
    assertBoundText(supersedes, `metadata.${KNOWLEDGE_RELATIONS_METADATA_KEY}.supersedes_item_id`);
    if (itemId && supersedes === itemId) {
      throw new Error("an item cannot supersede itself.");
    }
  }
  if (canonical !== undefined) {
    assertBoundText(canonical, `metadata.${KNOWLEDGE_RELATIONS_METADATA_KEY}.canonical_item_id`);
    if (itemId && canonical === itemId) {
      throw new Error(`metadata.${KNOWLEDGE_RELATIONS_METADATA_KEY}.canonical_item_id cannot reference itself.`);
    }
  }
}
function normalizeKnowledgeGuardedLimits(limits = {}) {
  assertObjectKeys(limits, "limits", ["submission", "reconciliation", "readback"], []);
  if (limits.submission !== undefined) {
    assertKnowledgeGuardedBounds(limits.submission, "limits.submission");
  }
  if (limits.reconciliation !== undefined) {
    assertKnowledgeGuardedBounds(limits.reconciliation, "limits.reconciliation");
  }
  if (limits.readback !== undefined) {
    assertKnowledgeGuardedBounds(limits.readback, "limits.readback");
  }
  const normalized = {
    submission: { ...DEFAULT_KNOWLEDGE_GUARDED_LIMITS.submission, ...limits.submission },
    reconciliation: { ...DEFAULT_KNOWLEDGE_GUARDED_LIMITS.reconciliation, ...limits.reconciliation },
    readback: { ...DEFAULT_KNOWLEDGE_GUARDED_LIMITS.readback, ...limits.readback }
  };
  assertKnowledgeGuardedBounds(normalized.submission, "limits.submission");
  assertKnowledgeGuardedBounds(normalized.reconciliation, "limits.reconciliation");
  assertKnowledgeGuardedBounds(normalized.readback, "limits.readback");
  return Object.freeze({
    submission: Object.freeze(normalized.submission),
    reconciliation: Object.freeze(normalized.reconciliation),
    readback: Object.freeze(normalized.readback)
  });
}
function canonicalValue(value, path) {
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value))
      throw new Error(`${path} contains a non-finite number.`);
    return value;
  }
  if (Array.isArray(value))
    return value.map((item, index) => canonicalValue(item, `${path}[${index}]`));
  if (typeof value !== "object") {
    throw new Error(`${path} must contain only JSON values.`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error(`${path} must contain plain JSON objects.`);
  }
  const result = {};
  for (const key of Object.keys(value).sort()) {
    const child = value[key];
    if (child === undefined)
      throw new Error(`${path}.${key} must not be undefined.`);
    result[key] = canonicalValue(child, `${path}.${key}`);
  }
  return result;
}
function deepFreezeJson(value) {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) {
      deepFreezeJson(child);
    }
    Object.freeze(value);
  }
  return value;
}
function canonicalKnowledgeGuardedJson(value) {
  return JSON.stringify(canonicalValue(value, "value"));
}
function knowledgeGuardedDigest(value) {
  return createHash3("sha256").update(canonicalKnowledgeGuardedJson(value), "utf8").digest("hex");
}
function knowledgeGuardedContentSha256(content) {
  if (typeof content !== "string")
    throw new Error("content must be a string.");
  return createHash3("sha256").update(content, "utf8").digest("hex");
}
function computeKnowledgeGuardedAdoptionDeterministicKey(input) {
  if (!["adopt", "rollback"].includes(input.action)) {
    throw new Error("adoption action must be adopt or rollback.");
  }
  assertBoundText(input.operation_id, "operation_id");
  assertBoundText(input.step_id, "step_id");
  assertBoundText(input.target_id, "target_id");
  assertKnowledgeGuardedBinding(input.binding);
  if (!Number.isInteger(input.expected_version) || input.expected_version < 1) {
    throw new Error("expected_version must be a positive integer.");
  }
  if (!/^[0-9a-f]{64}$/.test(input.expected_content_sha256)) {
    throw new Error("expected_content_sha256 must be a lowercase sha256 hex digest.");
  }
  const adoptionReceiptId = input.adoption_receipt_id ?? null;
  if (input.action === "adopt" && adoptionReceiptId !== null) {
    throw new Error("adopt must not reference an adoption receipt.");
  }
  if (input.action === "rollback" && (typeof adoptionReceiptId !== "string" || !/^kar_[0-9a-f]{64}$/.test(adoptionReceiptId))) {
    throw new Error("rollback requires an immutable adoption receipt id.");
  }
  return `fcame1_adoption_${knowledgeGuardedDigest({
    contract: KNOWLEDGE_GUARDED_WRITE_CONTRACT,
    action: input.action,
    operation_id: input.operation_id,
    step_id: input.step_id,
    target_id: input.target_id,
    binding: input.binding,
    expected_version: input.expected_version,
    expected_content_sha256: input.expected_content_sha256,
    adoption_receipt_id: adoptionReceiptId
  })}`;
}
function computeKnowledgeGuardedAdoptionReceiptId(deterministicKey) {
  if (!/^fcame1_adoption_[0-9a-f]{64}$/.test(deterministicKey)) {
    throw new Error("deterministicKey must be an FCAME-1 adoption key.");
  }
  return `kar_${deterministicKey.slice("fcame1_adoption_".length)}`;
}
function computeKnowledgeGuardedDeterministicKey(input) {
  assertKnowledgeGuardedBinding(input.binding);
  assertBoundText(input.operation_id, "operation_id");
  assertBoundText(input.step_id, "step_id");
  assertBoundText(input.target_id, "target_id");
  if (!/^[0-9a-f]{64}$/.test(input.payload_digest)) {
    throw new Error("payload_digest must be a lowercase sha256 hex digest.");
  }
  assertKnowledgeGuardedPrecondition(input.verb, input.precondition);
  if (input.manifest)
    assertKnowledgeGuardedManifestBinding(input.manifest);
  const digest = knowledgeGuardedDigest({
    contract: KNOWLEDGE_GUARDED_WRITE_CONTRACT,
    authority: input.binding.authority,
    tenant_id: input.binding.tenant_id,
    scope: input.binding.scope,
    parent_id: input.binding.parent_id,
    operation_id: input.operation_id,
    step_id: input.step_id,
    verb: input.verb,
    target_id: input.target_id,
    payload_digest: input.payload_digest,
    precondition: input.precondition,
    manifest: input.manifest ?? null
  });
  return `fcame1_${digest}`;
}
function computeKnowledgeGuardedRecoveryKey(input) {
  assertBoundText(input.manifest_id, "manifest_id");
  if (!Number.isInteger(input.ordinal) || input.ordinal < 0) {
    throw new Error("ordinal must be a non-negative integer.");
  }
  if (!/^fcame1_[0-9a-f]{64}$/.test(input.step_deterministic_key)) {
    throw new Error("step_deterministic_key must be an FCAME-1 deterministic key.");
  }
  assertBoundText(input.operation_id, "recovery.operation_id");
  assertBoundText(input.step_id, "recovery.step_id");
  assertBoundText(input.target_id, "recovery.target_id");
  assertKnowledgeGuardedBinding(input.binding);
  assertKnowledgeGuardedPrecondition(input.verb, input.precondition);
  const recoveryLimits = normalizeKnowledgeGuardedLimits(input.limits);
  if (canonicalKnowledgeGuardedJson(recoveryLimits) !== canonicalKnowledgeGuardedJson(input.limits)) {
    throw new Error("recovery.limits must be explicit and complete.");
  }
  if (!/^[0-9a-f]{64}$/.test(input.semantic_digest)) {
    throw new Error("recovery.semantic_digest must be a lowercase sha256 hex digest.");
  }
  if (!["forward_repair", "receipt_scoped_compensation"].includes(input.strategy)) {
    throw new Error("recovery.strategy must be forward_repair or receipt_scoped_compensation.");
  }
  if (input.strategy === "receipt_scoped_compensation" && input.receipt_scope !== "accepted_step_receipt" || input.strategy === "forward_repair" && input.receipt_scope !== null) {
    throw new Error("receipt_scoped_compensation requires accepted_step_receipt; forward_repair requires null receipt_scope.");
  }
  const expectedReceiptId = computeKnowledgeGuardedReceiptId(input.step_deterministic_key);
  if (input.strategy === "receipt_scoped_compensation" && input.compensates_receipt_id !== expectedReceiptId || input.strategy === "forward_repair" && input.compensates_receipt_id !== null) {
    throw new Error("receipt-scoped compensation must bind the deterministic accepted-step receipt; " + "forward repair must not bind one.");
  }
  return computeKnowledgeGuardedDeterministicKey({
    binding: input.binding,
    operation_id: input.operation_id,
    step_id: input.step_id,
    verb: input.verb,
    target_id: input.target_id,
    payload_digest: input.semantic_digest,
    precondition: input.precondition,
    manifest: {
      manifest_id: input.manifest_id,
      ordinal: input.ordinal,
      phase: "recovery",
      compensates_receipt_id: input.compensates_receipt_id
    }
  });
}
function computeKnowledgeGuardedReceiptId(deterministicKey) {
  if (!/^fcame1_[0-9a-f]{64}$/.test(deterministicKey)) {
    throw new Error("deterministicKey must be an FCAME-1 write key.");
  }
  return `kwr_${deterministicKey.slice("fcame1_".length)}`;
}
function computeKnowledgeGuardedManifestId(maintainer, operationId) {
  assertKnowledgeGuardedBinding(maintainer);
  assertBoundText(operationId, "operation_id");
  return `kmf_${knowledgeGuardedDigest({
    contract: KNOWLEDGE_GUARDED_WRITE_CONTRACT,
    maintainer,
    operation_id: operationId
  })}`;
}
function assertKnowledgeGuardedManifestStep(manifestId, step, expectedOrdinal) {
  assertObjectKeys(step, `steps[${expectedOrdinal}]`, [
    "ordinal",
    "operation_id",
    "step_id",
    "deterministic_key",
    "verb",
    "target_id",
    "binding",
    "semantic_digest",
    "precondition",
    "dependencies",
    "limits",
    "recovery"
  ]);
  assertObjectKeys(step.recovery, `steps[${expectedOrdinal}].recovery`, [
    "strategy",
    "operation_id",
    "step_id",
    "deterministic_key",
    "verb",
    "target_id",
    "semantic_digest",
    "precondition",
    "binding",
    "limits",
    "receipt_scope",
    "compensates_receipt_id"
  ]);
  if (step.ordinal !== expectedOrdinal) {
    throw new Error(`manifest steps must be ordered contiguously from zero; expected ordinal ${expectedOrdinal}.`);
  }
  assertBoundText(step.operation_id, `steps[${expectedOrdinal}].operation_id`);
  assertBoundText(step.step_id, `steps[${expectedOrdinal}].step_id`);
  assertBoundText(step.target_id, `steps[${expectedOrdinal}].target_id`);
  assertKnowledgeGuardedBinding(step.binding);
  assertKnowledgeGuardedPrecondition(step.verb, step.precondition);
  if (!/^[0-9a-f]{64}$/.test(step.semantic_digest)) {
    throw new Error(`steps[${expectedOrdinal}].semantic_digest must be a lowercase sha256 digest.`);
  }
  const normalizedLimits = normalizeKnowledgeGuardedLimits(step.limits);
  if (canonicalKnowledgeGuardedJson(normalizedLimits) !== canonicalKnowledgeGuardedJson(step.limits)) {
    throw new Error(`steps[${expectedOrdinal}].limits must be explicit and complete.`);
  }
  const expectedDependencies = Array.from({ length: expectedOrdinal }, (_unused, index) => index);
  if (!Array.isArray(step.dependencies) || canonicalKnowledgeGuardedJson(step.dependencies) !== canonicalKnowledgeGuardedJson(expectedDependencies)) {
    throw new Error(`steps[${expectedOrdinal}].dependencies must name every prior ordinal in order.`);
  }
  const expectedStepKey = computeKnowledgeGuardedDeterministicKey({
    binding: step.binding,
    operation_id: step.operation_id,
    step_id: step.step_id,
    verb: step.verb,
    target_id: step.target_id,
    payload_digest: step.semantic_digest,
    precondition: step.precondition,
    manifest: {
      manifest_id: manifestId,
      ordinal: step.ordinal,
      phase: "primary",
      compensates_receipt_id: null
    }
  });
  if (step.deterministic_key !== expectedStepKey) {
    throw new Error(`steps[${expectedOrdinal}].deterministic_key does not match its frozen tuple.`);
  }
  const expectedRecoveryKey = computeKnowledgeGuardedRecoveryKey({
    manifest_id: manifestId,
    ordinal: step.ordinal,
    step_deterministic_key: step.deterministic_key,
    strategy: step.recovery.strategy,
    operation_id: step.recovery.operation_id,
    step_id: step.recovery.step_id,
    verb: step.recovery.verb,
    target_id: step.recovery.target_id,
    semantic_digest: step.recovery.semantic_digest,
    precondition: step.recovery.precondition,
    binding: step.recovery.binding,
    limits: step.recovery.limits,
    receipt_scope: step.recovery.receipt_scope,
    compensates_receipt_id: step.recovery.compensates_receipt_id
  });
  if (step.recovery.deterministic_key !== expectedRecoveryKey) {
    throw new Error(`steps[${expectedOrdinal}].recovery.deterministic_key does not match its frozen tuple.`);
  }
}
function assertKnowledgeGuardedManifestOptions(maintainer, options) {
  assertKnowledgeGuardedBinding(maintainer);
  assertObjectKeys(options, "manifest", ["manifest_id", "operation_id", "steps"]);
  assertBoundText(options.manifest_id, "manifest_id");
  assertBoundText(options.operation_id, "operation_id");
  const expectedManifestId = computeKnowledgeGuardedManifestId(maintainer, options.operation_id);
  if (options.manifest_id !== expectedManifestId) {
    throw new Error("manifest_id must be the deterministic FCAME-1 id for its maintainer and workflow operation.");
  }
  if (!Array.isArray(options.steps) || options.steps.length < 2 || options.steps.length > 64) {
    throw new Error("a guarded workflow manifest must contain between 2 and 64 ordered steps.");
  }
  const identities = new Set;
  const deterministicKeys = new Set;
  options.steps.forEach((step, index) => {
    assertKnowledgeGuardedManifestStep(options.manifest_id, step, index);
    if (step.binding.tenant_id !== maintainer.tenant_id || step.recovery.binding.tenant_id !== maintainer.tenant_id) {
      throw new Error(`manifest step ${index} crosses tenants without an authority delegation contract.`);
    }
    for (const action of [step, step.recovery]) {
      const identity = `${action.binding.authority.classification}\x00${action.binding.authority.authority_id}` + `\x00${action.binding.tenant_id}\x00${action.binding.scope}\x00${action.binding.parent_id}` + `\x00${action.operation_id}\x00${action.step_id}`;
      if (identities.has(identity)) {
        throw new Error(`manifest step ${index} repeats an operation/step identity.`);
      }
      identities.add(identity);
      if (deterministicKeys.has(action.deterministic_key)) {
        throw new Error(`manifest step ${index} repeats a deterministic action key.`);
      }
      deterministicKeys.add(action.deterministic_key);
    }
  });
}
function computeKnowledgeGuardedManifestDigest(maintainer, options) {
  assertKnowledgeGuardedManifestOptions(maintainer, options);
  return knowledgeGuardedDigest({
    contract: KNOWLEDGE_GUARDED_WRITE_CONTRACT,
    manifest_id: options.manifest_id,
    operation_id: options.operation_id,
    maintainer,
    steps: options.steps
  });
}
function computeKnowledgeGuardedManifestDeterministicKey(maintainer, options) {
  return `fcame1_manifest_${computeKnowledgeGuardedManifestDigest(maintainer, options)}`;
}
function assertKnowledgeGuardedPayload(verb, payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("payload must be a JSON object.");
  }
  canonicalValue(payload, "payload");
  if (verb === "create") {
    const title = payload.title;
    if (typeof title !== "string" || title.trim().length === 0) {
      throw new Error("create payload.title is required.");
    }
  }
  const allowed = verb === "create" ? new Set(["title", "content", "url", "tags", "metadata"]) : new Set(["title", "content", "url", "tags", "metadata", "archived"]);
  for (const key of Object.keys(payload)) {
    if (!allowed.has(key))
      throw new Error(`payload.${key} is not allowed for ${verb}.`);
  }
  if ("title" in payload && payload.title !== undefined) {
    assertBoundText(payload.title, "payload.title", 2048);
  }
  if ("content" in payload && payload.content !== undefined && typeof payload.content !== "string") {
    throw new Error("payload.content must be a string.");
  }
  if ("url" in payload && payload.url !== undefined && payload.url !== null && (typeof payload.url !== "string" || payload.url.length > 8192 || /[\u0000-\u001f\u007f]/.test(payload.url))) {
    throw new Error("payload.url must be null or a string without control characters.");
  }
  if ("tags" in payload && payload.tags !== undefined) {
    if (!Array.isArray(payload.tags) || payload.tags.length > 256) {
      throw new Error("payload.tags must be an array of strings.");
    }
    payload.tags.forEach((tag, index) => assertBoundText(tag, `payload.tags[${index}]`, 256));
  }
  if ("archived" in payload && payload.archived !== undefined && typeof payload.archived !== "boolean") {
    throw new Error("payload.archived must be a boolean.");
  }
  if ("metadata" in payload && payload.metadata !== undefined) {
    if (payload.metadata === null || typeof payload.metadata !== "object" || Array.isArray(payload.metadata)) {
      throw new Error("payload.metadata must be a JSON object.");
    }
  }
  if (verb === "update" && Object.keys(payload).length === 0) {
    throw new Error("update payload must change at least one field.");
  }
}
function createKnowledgePrivateInputDescriptor(options) {
  assertBoundText(options.operation_id, "operation_id");
  assertBoundText(options.step_id, "step_id");
  assertBoundText(options.target_id, "target_id");
  assertKnowledgeGuardedBinding(options.binding);
  assertKnowledgeGuardedPrecondition(options.verb, options.precondition);
  if (options.manifest)
    assertKnowledgeGuardedManifestBinding(options.manifest);
  assertKnowledgeGuardedPayload(options.verb, options.payload);
  const expiresIn = options.expires_in_ms ?? 5 * 60 * 1000;
  if (!Number.isInteger(expiresIn) || expiresIn < 1 || expiresIn > MAX_DESCRIPTOR_LIFETIME_MS) {
    throw new Error(`expires_in_ms must be between 1 and ${MAX_DESCRIPTOR_LIFETIME_MS}.`);
  }
  const payload = deepFreezeJson(JSON.parse(canonicalKnowledgeGuardedJson(options.payload)));
  const payloadDigest = knowledgeGuardedDigest(payload);
  const bindingDigest = knowledgeGuardedDigest({
    binding: options.binding,
    operation_id: options.operation_id,
    step_id: options.step_id,
    verb: options.verb,
    target_id: options.target_id,
    precondition: options.precondition,
    payload_digest: payloadDigest,
    manifest: options.manifest ?? null
  });
  const expiresAt = new Date(Date.now() + expiresIn).toISOString();
  const metadata = Object.freeze({
    contract: KNOWLEDGE_GUARDED_WRITE_CONTRACT,
    schema: KNOWLEDGE_PRIVATE_INPUT_SCHEMA,
    descriptor_id: `kpv_${randomUUID2()}`,
    operation_id: options.operation_id,
    step_id: options.step_id,
    verb: options.verb,
    target_id: options.target_id,
    payload_digest: payloadDigest,
    binding_digest: bindingDigest,
    precondition: Object.freeze({ ...options.precondition }),
    binding: Object.freeze({
      authority: Object.freeze({ ...options.binding.authority }),
      tenant_id: options.binding.tenant_id,
      scope: options.binding.scope,
      parent_id: options.binding.parent_id
    }),
    manifest: options.manifest ? Object.freeze({
      manifest_id: options.manifest.manifest_id,
      ordinal: options.manifest.ordinal,
      phase: options.manifest.phase,
      compensates_receipt_id: options.manifest.compensates_receipt_id
    }) : null,
    expires_at: expiresAt
  });
  const descriptor = Object.freeze({
    ...metadata,
    toJSON: () => metadata
  });
  PRIVATE_PAYLOADS.set(descriptor, { payload, revoked: false });
  return descriptor;
}
function revokeKnowledgePrivateInputDescriptor(descriptor) {
  const state = PRIVATE_PAYLOADS.get(descriptor);
  if (!state)
    throw new Error("private input descriptor was not created by @hasna/knowledge.");
  state.revoked = true;
}
function materializeKnowledgePrivateInput(descriptor) {
  const state = PRIVATE_PAYLOADS.get(descriptor);
  if (!state)
    throw new Error("private input descriptor was not created by @hasna/knowledge.");
  if (state.revoked)
    throw new Error("private input descriptor has been revoked.");
  if (Date.parse(descriptor.expires_at) <= Date.now()) {
    throw new Error("private input descriptor has expired.");
  }
  return state.payload;
}
function createKnowledgePrivateTitleLookupDescriptor(options) {
  assertBoundText(options.operation_id, "operation_id");
  assertBoundText(options.step_id, "step_id");
  assertKnowledgeGuardedBinding(options.binding);
  assertBoundText(options.title, "title", 2048);
  const expiresIn = options.expires_in_ms ?? 5 * 60 * 1000;
  if (!Number.isInteger(expiresIn) || expiresIn < 1 || expiresIn > MAX_DESCRIPTOR_LIFETIME_MS) {
    throw new Error(`expires_in_ms must be between 1 and ${MAX_DESCRIPTOR_LIFETIME_MS}.`);
  }
  const titleDigest = knowledgeGuardedContentSha256(options.title);
  const bindingDigest = knowledgeGuardedDigest({
    binding: options.binding,
    operation_id: options.operation_id,
    step_id: options.step_id,
    title_digest: titleDigest
  });
  const metadata = Object.freeze({
    contract: KNOWLEDGE_GUARDED_WRITE_CONTRACT,
    schema: KNOWLEDGE_PRIVATE_TITLE_LOOKUP_SCHEMA,
    operation_id: options.operation_id,
    step_id: options.step_id,
    title_digest: titleDigest,
    binding_digest: bindingDigest,
    binding: Object.freeze({
      authority: Object.freeze({ ...options.binding.authority }),
      tenant_id: options.binding.tenant_id,
      scope: options.binding.scope,
      parent_id: options.binding.parent_id
    }),
    expires_at: new Date(Date.now() + expiresIn).toISOString()
  });
  const descriptor = {
    ...metadata,
    toJSON: () => metadata
  };
  Object.defineProperty(descriptor, "descriptor_id", {
    value: `kpl_${randomUUID2()}`,
    enumerable: false,
    configurable: false,
    writable: false
  });
  Object.freeze(descriptor);
  PRIVATE_TITLE_LOOKUPS.set(descriptor, { title: options.title, revoked: false });
  return descriptor;
}
function revokeKnowledgePrivateTitleLookupDescriptor(descriptor) {
  const state = PRIVATE_TITLE_LOOKUPS.get(descriptor);
  if (!state)
    throw new Error("private title lookup descriptor was not created by @hasna/knowledge.");
  state.revoked = true;
}
function materializeKnowledgePrivateTitleLookup(descriptor) {
  const state = PRIVATE_TITLE_LOOKUPS.get(descriptor);
  if (!state)
    throw new Error("private title lookup descriptor was not created by @hasna/knowledge.");
  if (state.revoked)
    throw new Error("private title lookup descriptor has been revoked.");
  if (Date.parse(descriptor.expires_at) <= Date.now()) {
    throw new Error("private title lookup descriptor has expired.");
  }
  if (knowledgeGuardedContentSha256(state.title) !== descriptor.title_digest) {
    throw new Error("private title lookup descriptor digest changed after freeze.");
  }
  return state.title;
}
function createKnowledgePrivateQueryDescriptor(options) {
  assertBoundText(options.operation_id, "operation_id");
  assertBoundText(options.step_id, "step_id");
  assertKnowledgeGuardedBinding(options.binding);
  assertKnowledgePrivateQuerySelector(options.selector);
  const archive = options.archive ?? "active";
  if (!["active", "archived", "all"].includes(archive)) {
    throw new Error("archive must be active, archived, or all.");
  }
  const limit = options.limit ?? 10;
  const offset = options.offset ?? 0;
  const bounds = {
    max_calls: 1,
    max_items: 50,
    max_bytes: 1048576,
    wall_time_ms: 1e4
  };
  assertKnowledgePrivateQueryPage({ limit, offset }, bounds);
  const expiresIn = options.expires_in_ms ?? 5 * 60 * 1000;
  if (!Number.isInteger(expiresIn) || expiresIn < 1 || expiresIn > MAX_DESCRIPTOR_LIFETIME_MS) {
    throw new Error(`expires_in_ms must be between 1 and ${MAX_DESCRIPTOR_LIFETIME_MS}.`);
  }
  const selector = deepFreezeJson(JSON.parse(canonicalKnowledgeGuardedJson(options.selector)));
  const selectorDigest = knowledgeGuardedDigest(selector);
  const page = Object.freeze({ limit, offset });
  const binding = Object.freeze({
    authority: Object.freeze({ ...options.binding.authority }),
    tenant_id: options.binding.tenant_id,
    scope: options.binding.scope,
    parent_id: options.binding.parent_id
  });
  const bindingDigest = knowledgeGuardedDigest({
    binding,
    operation_id: options.operation_id,
    step_id: options.step_id,
    query_kind: selector.kind,
    selector_digest: selectorDigest,
    archive,
    page
  });
  const metadata = Object.freeze({
    contract: KNOWLEDGE_GUARDED_WRITE_CONTRACT,
    schema: KNOWLEDGE_PRIVATE_QUERY_SCHEMA,
    operation_id: options.operation_id,
    step_id: options.step_id,
    query_kind: selector.kind,
    selector_digest: selectorDigest,
    binding_digest: bindingDigest,
    binding,
    archive,
    page,
    expires_at: new Date(Date.now() + expiresIn).toISOString()
  });
  const descriptor = {
    ...metadata,
    toJSON: () => metadata
  };
  Object.defineProperty(descriptor, "descriptor_id", {
    value: `kpq_${randomUUID2()}`,
    enumerable: false,
    configurable: false,
    writable: false
  });
  Object.freeze(descriptor);
  PRIVATE_QUERIES.set(descriptor, { selector, revoked: false });
  return descriptor;
}
function revokeKnowledgePrivateQueryDescriptor(descriptor) {
  const state = PRIVATE_QUERIES.get(descriptor);
  if (!state)
    throw new Error("private query descriptor was not created by @hasna/knowledge.");
  state.revoked = true;
}
function materializeKnowledgePrivateQuery(descriptor) {
  const state = PRIVATE_QUERIES.get(descriptor);
  if (!state)
    throw new Error("private query descriptor was not created by @hasna/knowledge.");
  if (state.revoked)
    throw new Error("private query descriptor has been revoked.");
  if (Date.parse(descriptor.expires_at) <= Date.now()) {
    throw new Error("private query descriptor has expired.");
  }
  if (knowledgeGuardedDigest(state.selector) !== descriptor.selector_digest) {
    throw new Error("private query descriptor selector digest changed after freeze.");
  }
  return state.selector;
}
function knowledgePrivateItemProof(item) {
  return Object.freeze({
    id: item.id,
    version: Number(item.version ?? 1),
    title_sha256: knowledgeGuardedContentSha256(item.title),
    content_sha256: knowledgeGuardedContentSha256(item.content),
    url_sha256: item.url === null || item.url === undefined ? null : knowledgeGuardedContentSha256(item.url),
    tags_sha256: knowledgeGuardedDigest(item.tags ?? []),
    metadata_sha256: knowledgeGuardedDigest(item.metadata ?? {}),
    archived: item.archived === true
  });
}
function knowledgePrivateQueryItemProof(item, matchedValue = null) {
  return Object.freeze({
    id_sha256: knowledgeGuardedContentSha256(item.id),
    version: Number(item.version ?? 1),
    title_sha256: knowledgeGuardedContentSha256(item.title),
    content_sha256: knowledgeGuardedContentSha256(item.content),
    url_sha256: item.url === null || item.url === undefined ? null : knowledgeGuardedContentSha256(item.url),
    tags_sha256: knowledgeGuardedDigest(item.tags ?? []),
    metadata_sha256: knowledgeGuardedDigest(item.metadata ?? {}),
    archived: item.archived === true,
    record_kind: "current",
    matched_value_sha256: matchedValue === null ? null : knowledgeGuardedContentSha256(matchedValue)
  });
}
function knowledgePrivateHistoricalQueryItemProof(item, matchedValue = null) {
  return Object.freeze({
    id_sha256: knowledgeGuardedContentSha256(item.item_id),
    version: item.version,
    title_sha256: knowledgeGuardedContentSha256(item.title),
    content_sha256: item.content_hash,
    url_sha256: item.url === null ? null : knowledgeGuardedContentSha256(item.url),
    tags_sha256: knowledgeGuardedDigest(item.tags),
    metadata_sha256: knowledgeGuardedDigest(item.metadata),
    archived: item.archived,
    record_kind: "historical",
    matched_value_sha256: matchedValue === null ? null : knowledgeGuardedContentSha256(matchedValue)
  });
}
function createKnowledgePrivateResultDescriptor(result, expiresInMs = 5 * 60 * 1000) {
  if (!Number.isInteger(expiresInMs) || expiresInMs < 1 || expiresInMs > MAX_DESCRIPTOR_LIFETIME_MS) {
    throw new Error(`expires_in_ms must be between 1 and ${MAX_DESCRIPTOR_LIFETIME_MS}.`);
  }
  const itemCount = result.kind === "title_lookup" || result.kind === "query" ? result.value.item_count : 1;
  const metadata = Object.freeze({
    contract: KNOWLEDGE_GUARDED_WRITE_CONTRACT,
    schema: KNOWLEDGE_PRIVATE_RESULT_SCHEMA,
    kind: result.kind,
    result_digest: knowledgeGuardedDigest(result.value),
    item_count: itemCount,
    expires_at: new Date(Date.now() + expiresInMs).toISOString()
  });
  const descriptor = {
    ...metadata,
    toJSON: () => metadata
  };
  Object.defineProperty(descriptor, "descriptor_id", {
    value: `kpr_${randomUUID2()}`,
    enumerable: false,
    configurable: false,
    writable: false
  });
  Object.freeze(descriptor);
  PRIVATE_RESULTS.set(descriptor, { result, revoked: false });
  return descriptor;
}
function revokeKnowledgePrivateResultDescriptor(descriptor) {
  const state = PRIVATE_RESULTS.get(descriptor);
  if (!state)
    throw new Error("private result descriptor was not created by @hasna/knowledge.");
  state.revoked = true;
}
function inspectKnowledgePrivateResult(descriptor) {
  const state = PRIVATE_RESULTS.get(descriptor);
  if (!state)
    throw new Error("private result descriptor was not created by @hasna/knowledge.");
  if (state.revoked)
    throw new Error("private result descriptor has been revoked.");
  if (Date.parse(descriptor.expires_at) <= Date.now()) {
    throw new Error("private result descriptor has expired.");
  }
  if (knowledgeGuardedDigest(state.result.value) !== descriptor.result_digest) {
    throw new Error("private result descriptor digest changed after freeze.");
  }
  if (state.result.kind === "write") {
    return Object.freeze({
      kind: "write",
      item_count: 1,
      items: Object.freeze([knowledgePrivateItemProof(state.result.value.readback.item)]),
      deterministic_key: state.result.value.deterministic_key,
      receipt_id: state.result.value.receipt.receipt_id,
      duplicate: state.result.value.duplicate
    });
  }
  if (state.result.kind === "readback") {
    return Object.freeze({
      kind: "readback",
      item_count: 1,
      items: Object.freeze([knowledgePrivateItemProof(state.result.value.item)])
    });
  }
  if (state.result.kind === "query") {
    return Object.freeze({
      kind: "query",
      item_count: state.result.value.item_count,
      items: Object.freeze([...state.result.value.items]),
      query_kind: state.result.value.query_kind,
      status: state.result.value.status,
      code: state.result.value.code,
      total: state.result.value.total,
      page: Object.freeze({ ...state.result.value.page })
    });
  }
  return Object.freeze({
    kind: "title_lookup",
    item_count: state.result.value.item_count,
    items: Object.freeze([...state.result.value.items])
  });
}
function assertKnowledgeTerminalCompleteness(reconciliation, expected) {
  if (reconciliation.contract !== KNOWLEDGE_GUARDED_WRITE_CONTRACT || reconciliation.deterministic_key !== expected.deterministic_key || reconciliation.operation_id !== expected.operation_id || reconciliation.step_id !== expected.step_id || reconciliation.exact !== true || reconciliation.bounded !== true || reconciliation.receipt_count !== 1 || reconciliation.terminal_complete !== true || reconciliation.receipt === null) {
    throw new Error("terminal_completeness_failed: exact bounded reconciliation did not yield one terminal receipt.");
  }
  if (reconciliation.receipt.deterministic_key !== expected.deterministic_key || reconciliation.receipt.operation_id !== expected.operation_id || reconciliation.receipt.step_id !== expected.step_id) {
    throw new Error("terminal_completeness_failed: receipt identity does not match the frozen operation.");
  }
  return reconciliation.receipt;
}
function evaluateKnowledgeGuardedManifestCompletion(steps) {
  if (steps.length === 0 || steps.some((step) => step.state === "unverified_external_authority" || step.recovery_state === "unverified_external_authority")) {
    return { terminal_complete: false, accepted_complete: false };
  }
  const acceptedComplete = steps.every((step) => step.state === "accepted" && step.recovery_state === "missing");
  if (acceptedComplete) {
    return { terminal_complete: true, accepted_complete: true };
  }
  const allPrimaryTerminal = steps.every((step) => step.state === "accepted" || step.state === "rejected");
  const allRecoveryMissing = steps.every((step) => step.recovery_state === "missing");
  if (allPrimaryTerminal && allRecoveryMissing) {
    return { terminal_complete: true, accepted_complete: false };
  }
  const firstNonAccepted = steps.findIndex((step) => step.state !== "accepted");
  if (firstNonAccepted === 0) {
    const cleanInitialRejection = steps[0].state === "rejected" && steps.slice(1).every((step) => step.state !== "accepted") && allRecoveryMissing;
    return { terminal_complete: cleanInitialRejection, accepted_complete: false };
  }
  if (firstNonAccepted < 1) {
    return { terminal_complete: false, accepted_complete: false };
  }
  const closingRecoveryOrdinal = firstNonAccepted - 1;
  const closingRecovery = steps[closingRecoveryOrdinal];
  const closingRecoveryTerminal = closingRecovery.recovery_state === "accepted" || closingRecovery.recovery_state === "rejected";
  const exactAcceptedPrefix = steps.slice(0, firstNonAccepted).every((step) => step.state === "accepted");
  const closedPrimarySuffix = steps.slice(firstNonAccepted).every((step) => step.state !== "accepted");
  const exactlyOneClosingRecovery = steps.every((step, ordinal) => ordinal === closingRecoveryOrdinal ? closingRecoveryTerminal : step.recovery_state === "missing");
  return {
    terminal_complete: closingRecoveryTerminal && exactAcceptedPrefix && closedPrimarySuffix && exactlyOneClosingRecovery,
    accepted_complete: false
  };
}
function assertKnowledgeGuardedManifestTerminalCompleteness(reconciliation, expected) {
  const evaluated = evaluateKnowledgeGuardedManifestCompletion(reconciliation.steps);
  if (reconciliation.contract !== KNOWLEDGE_GUARDED_WRITE_CONTRACT || reconciliation.manifest.manifest_id !== expected.manifest_id || expected.deterministic_key !== undefined && reconciliation.manifest.deterministic_key !== expected.deterministic_key || reconciliation.exact !== true || reconciliation.bounded !== true || reconciliation.terminal_complete !== evaluated.terminal_complete || reconciliation.accepted_complete !== evaluated.accepted_complete || evaluated.terminal_complete !== true || reconciliation.unsupported_gap !== null || reconciliation.steps.length !== reconciliation.manifest.step_count || reconciliation.steps.some((step, ordinal) => step.ordinal !== ordinal || step.deterministic_key !== reconciliation.manifest.steps[ordinal]?.deterministic_key || step.recovery_deterministic_key !== reconciliation.manifest.steps[ordinal]?.recovery.deterministic_key)) {
    throw new Error("manifest_terminal_completeness_failed: exact bounded reconciliation did not prove " + "an accepted primary sequence or one exact terminal recovery for its accepted prefix.");
  }
  if ((expected.require_accepted ?? true) && evaluated.accepted_complete !== true) {
    throw new Error("manifest_accepted_completeness_failed: at least one ordered primary step was not accepted.");
  }
  return reconciliation.manifest;
}
function knowledgeGuardedUtf8Bytes(value) {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
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
    const pkg = JSON.parse(readFileSync4(url, "utf8"));
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}
function resolveSigningSecret(env = process.env) {
  const secret = env.HASNA_KNOWLEDGE_API_SIGNING_KEY ?? env.API_KEY_SIGNING_SECRET ?? env.HASNA_API_SIGNING_KEY;
  if (!secret) {
    throw new Error("knowledge-serve requires an API signing secret: set HASNA_KNOWLEDGE_API_SIGNING_KEY " + "(or API_KEY_SIGNING_SECRET / HASNA_API_SIGNING_KEY).");
  }
  return secret;
}

class VersionConflictError extends Error {
  expected;
  current;
  code = "version_conflict";
  constructor(expected, current) {
    super(`version_conflict: expected version ${expected}, stored version is ${current}`);
    this.expected = expected;
    this.current = current;
    this.name = "VersionConflictError";
  }
}
function parseJsonColumn(value, fallback) {
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
}
function boundedInteger(value, fallback, field, minimum, maximum) {
  const resolved = value ?? fallback;
  if (!Number.isFinite(resolved) || !Number.isInteger(resolved) || resolved < minimum || resolved > maximum) {
    throw new HttpError(400, `${field} must be an integer between ${minimum} and ${maximum}.`);
  }
  return resolved;
}
function rowToVersion(row) {
  return {
    id: String(row.id),
    item_id: String(row.item_id),
    tenant_id: row.tenant_id ?? null,
    version: Number(row.version),
    title: String(row.title ?? ""),
    content: row.content ?? null,
    body_uri: row.body_uri ?? null,
    content_hash: String(row.content_hash ?? ""),
    content_bytes: Number(row.content_bytes ?? 0),
    url: row.url ?? null,
    tags: parseJsonColumn(row.tags, []),
    metadata: parseJsonColumn(row.metadata, {}),
    archived: Boolean(row.archived),
    actor: row.actor ?? null,
    reason: row.reason ?? null,
    valid_from: row.valid_from ?? null,
    valid_to: String(row.valid_to ?? "")
  };
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
    updated_at: String(row.updated_at),
    version: row.version == null ? 1 : Number(row.version)
  };
}

class NoteRepo {
  client;
  constructor(client) {
    this.client = client;
  }
  async write(options, fn) {
    return this.client.transaction(async (tx) => {
      await tx.execute(`SELECT set_config('hasna.actor', $1, true), set_config('hasna.reason', $2, true)`, [
        options.actor ?? "",
        options.reason ?? ""
      ]);
      return fn(tx);
    });
  }
  async create(input, options = {}) {
    if (!input.title || typeof input.title !== "string") {
      throw new HttpError(400, "title is required");
    }
    const now = new Date().toISOString();
    const suppliedId = typeof input.id === "string" ? input.id.trim() : "";
    if (input.metadata) {
      try {
        assertKnowledgeRelationsMetadata(input.metadata, suppliedId || undefined);
      } catch (error) {
        throw new HttpError(400, error instanceof Error ? error.message : "invalid relation metadata.");
      }
    }
    if (suppliedId) {
      const guarded = await this.client.get(`SELECT TRUE AS guarded FROM knowledge_items
          WHERE id = $1 AND authority_classification IS NOT NULL
          LIMIT 1`, [suppliedId]);
      if (guarded) {
        throw new HttpError(409, "guarded_item_requires_fcame1_writer");
      }
      const row2 = await this.write(options, (tx) => tx.get(`INSERT INTO knowledge_items (id, short_id, title, content, url, tags, metadata, archived, created_at, updated_at)
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
      ]));
      return rowToItem(row2);
    }
    const id = makeId();
    const row = await this.write(options, (tx) => tx.get(`INSERT INTO knowledge_items (id, short_id, title, content, url, tags, metadata, archived, created_at, updated_at)
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
    ]));
    return rowToItem(row);
  }
  async list(options = {}, guardedTenantId) {
    const limit = boundedInteger(options.limit, 50, "limit", 1, 200);
    const offset = boundedInteger(options.offset, 0, "offset", 0, 1e4);
    const params = [];
    const where = [];
    if (guardedTenantId) {
      params.push(guardedTenantId);
      where.push(`(authority_classification IS NULL OR tenant_id = $${params.length})`);
    } else {
      where.push("authority_classification IS NULL");
    }
    const archive = options.archive ?? "active";
    if (archive === "active")
      where.push("archived = FALSE");
    else if (archive === "archived")
      where.push("archived = TRUE");
    const filter = options.filter?.trim();
    if (filter) {
      params.push(filter);
      const position = params.length;
      where.push(`(strpos(LOWER(id), LOWER($${position})) > 0
          OR strpos(LOWER(title), LOWER($${position})) > 0
          OR strpos(LOWER(content), LOWER($${position})) > 0)`);
    }
    for (const raw of options.tags ?? []) {
      const whole = raw.trim().toLowerCase();
      const parts = raw.split(",").map((tag) => tag.trim().toLowerCase()).filter(Boolean);
      const tagPredicates = [];
      if (whole) {
        params.push(whole);
        tagPredicates.push(`EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(tags) AS item_tag
          WHERE LOWER(item_tag) = $${params.length}
        )`);
      }
      if (parts.length > 0) {
        const partPredicates = parts.map((part) => {
          params.push(part);
          return `EXISTS (
            SELECT 1 FROM jsonb_array_elements_text(tags) AS item_tag
            WHERE LOWER(item_tag) = $${params.length}
          )`;
        });
        tagPredicates.push(`(${partPredicates.join(" AND ")})`);
      }
      if (tagPredicates.length > 0)
        where.push(`(${tagPredicates.join(" OR ")})`);
    }
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const sortColumn = options.sort === "title" ? "title" : "created_at";
    const direction = options.direction === "desc" ? "DESC" : "ASC";
    const orderSql = `ORDER BY ${sortColumn} ${direction}, id ${direction}`;
    const totalRow = await this.client.get(`SELECT count(*)::text AS count FROM knowledge_items ${whereSql}`, params);
    const rows = await this.client.many(`SELECT * FROM knowledge_items ${whereSql} ${orderSql} LIMIT ${limit} OFFSET ${offset}`, params);
    return { items: rows.map(rowToItem), total: Number(totalRow?.count ?? 0) };
  }
  async search(options, guardedTenantId) {
    const query2 = options.query.trim();
    if (!query2)
      throw new HttpError(400, "q is required");
    const limit = boundedInteger(options.limit, 20, "limit", 1, 200);
    const offset = boundedInteger(options.offset, 0, "offset", 0, 1e4);
    const params = [];
    const where = [];
    if (guardedTenantId) {
      params.push(guardedTenantId);
      where.push(`(authority_classification IS NULL OR tenant_id = $${params.length})`);
    } else {
      where.push("authority_classification IS NULL");
    }
    const archive = options.archive ?? "active";
    if (archive === "active")
      where.push("archived = FALSE");
    else if (archive === "archived")
      where.push("archived = TRUE");
    params.push(query2);
    const tsQueryExpr = `websearch_to_tsquery('english', $${params.length})`;
    where.push(`search_vector @@ ${tsQueryExpr}`);
    const whereSql = `WHERE ${where.join(" AND ")}`;
    const totalRow = await this.client.get(`SELECT count(*)::text AS count FROM knowledge_items ${whereSql}`, params);
    const rows = await this.client.many(`SELECT *, ts_rank_cd(search_vector, ${tsQueryExpr}) AS search_rank
        FROM knowledge_items
        ${whereSql}
        ORDER BY search_rank DESC, created_at DESC, id ASC
        LIMIT ${limit} OFFSET ${offset}`, params);
    return {
      items: rows.map((row) => ({
        item: rowToItem(row),
        rank: Number(row.search_rank ?? 0)
      })),
      total: Number(totalRow?.count ?? 0)
    };
  }
  async get(idOrShort, guardedTenantId) {
    const guardedVisibility = guardedTenantId ? "AND (authority_classification IS NULL OR tenant_id = $2)" : "AND authority_classification IS NULL";
    const row = await this.client.get(`SELECT * FROM knowledge_items
        WHERE (id = $1 OR short_id = $1)
          ${guardedVisibility}
        LIMIT 1`, guardedTenantId ? [idOrShort, guardedTenantId] : [idOrShort]);
    return row ? rowToItem(row) : null;
  }
  async update(idOrShort, patch, options = {}) {
    const existing = await this.get(idOrShort);
    if (!existing)
      return null;
    if (patch.metadata !== undefined) {
      try {
        assertKnowledgeRelationsMetadata(patch.metadata, existing.id);
      } catch (error) {
        throw new HttpError(400, error instanceof Error ? error.message : "invalid relation metadata.");
      }
    }
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
    let where = `id = $${params.length}`;
    const { expectedVersion } = options;
    if (expectedVersion !== undefined) {
      params.push(expectedVersion);
      where += ` AND version = $${params.length}`;
    }
    const row = await this.write(options, (tx) => tx.get(`UPDATE knowledge_items SET ${sets.join(", ")} WHERE ${where} RETURNING *`, params));
    if (row)
      return rowToItem(row);
    if (expectedVersion === undefined)
      return null;
    const current = await this.get(existing.id);
    if (!current)
      return null;
    throw new VersionConflictError(expectedVersion, current.version ?? 1);
  }
  async listVersions(idOrShort, options = {}, guardedTenantId) {
    const existing = await this.get(idOrShort, guardedTenantId);
    if (!existing)
      return null;
    const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
    const offset = Math.max(options.offset ?? 0, 0);
    const totalRow = await this.client.get(`SELECT count(*)::text AS count FROM knowledge_item_versions WHERE item_id = $1`, [existing.id]);
    const rows = await this.client.many(`SELECT * FROM knowledge_item_versions WHERE item_id = $1
        ORDER BY version DESC LIMIT ${limit} OFFSET ${offset}`, [existing.id]);
    return {
      item_id: existing.id,
      current_version: existing.version ?? 1,
      total: Number(totalRow?.count ?? 0),
      items: rows.map(rowToVersion)
    };
  }
  async getVersion(idOrShort, version, guardedTenantId) {
    const existing = await this.get(idOrShort, guardedTenantId);
    if (!existing)
      return null;
    const row = await this.client.get(`SELECT * FROM knowledge_item_versions WHERE item_id = $1 AND version = $2`, [existing.id, version]);
    return row ? rowToVersion(row) : null;
  }
  async delete(idOrShort) {
    const existing = await this.get(idOrShort);
    if (!existing)
      return false;
    await this.client.execute(`DELETE FROM knowledge_items WHERE id = $1`, [existing.id]);
    return true;
  }
}

class OperationBindingConflictError extends Error {
  receipt;
  constructor(receipt) {
    super("operation and step are already bound to a different deterministic key");
    this.receipt = receipt;
    this.name = "OperationBindingConflictError";
  }
}

class AdoptionOperationBindingConflictError extends Error {
  receipt;
  constructor(receipt) {
    super("adoption operation and step are already bound to a different deterministic key");
    this.receipt = receipt;
    this.name = "AdoptionOperationBindingConflictError";
  }
}

class ManifestBindingConflictError extends Error {
  manifest;
  constructor(manifest) {
    super("manifest_id is already bound to a different deterministic key");
    this.manifest = manifest;
    this.name = "ManifestBindingConflictError";
  }
}
function rowToAdoptionReceipt(row) {
  return {
    contract: KNOWLEDGE_GUARDED_WRITE_CONTRACT,
    receipt_id: String(row.receipt_id),
    deterministic_key: String(row.deterministic_key),
    action: String(row.action),
    operation_id: String(row.operation_id),
    step_id: String(row.step_id),
    target_id: String(row.target_id),
    binding: {
      authority: {
        classification: String(row.authority_classification),
        authority_id: String(row.authority_id)
      },
      tenant_id: String(row.tenant_id),
      scope: String(row.scope),
      parent_id: String(row.parent_id)
    },
    expected_version: Number(row.expected_version),
    expected_content_sha256: String(row.expected_content_sha256),
    adoption_receipt_id: row.adoption_receipt_id == null ? null : String(row.adoption_receipt_id),
    prior_tenant_id: row.prior_tenant_id == null ? null : String(row.prior_tenant_id),
    status: String(row.status),
    code: String(row.code),
    effect_count: Number(row.effect_count),
    result_version: row.result_version == null ? null : Number(row.result_version),
    result_content_sha256: row.result_content_sha256 == null ? null : String(row.result_content_sha256),
    created_at: String(row.created_at)
  };
}
function guardedPreconditionFromRow(row) {
  return row.precondition_kind === "absent" ? { kind: "absent" } : { kind: "version", expected_version: Number(row.expected_version) };
}
function rowToGuardedReceipt(row) {
  return {
    contract: KNOWLEDGE_GUARDED_WRITE_CONTRACT,
    receipt_id: String(row.receipt_id),
    deterministic_key: String(row.deterministic_key),
    operation_id: String(row.operation_id),
    step_id: String(row.step_id),
    verb: String(row.verb),
    target_id: String(row.target_id),
    authority: {
      classification: String(row.authority_classification),
      authority_id: String(row.authority_id)
    },
    tenant_id: String(row.tenant_id),
    scope: String(row.scope),
    parent_id: String(row.parent_id),
    payload_digest: String(row.payload_digest),
    precondition: guardedPreconditionFromRow(row),
    manifest: row.manifest_id == null ? null : {
      manifest_id: String(row.manifest_id),
      ordinal: Number(row.manifest_ordinal),
      phase: String(row.manifest_phase),
      compensates_receipt_id: row.compensates_receipt_id == null ? null : String(row.compensates_receipt_id)
    },
    status: String(row.status),
    code: String(row.code),
    effect_count: Number(row.effect_count),
    result_id: row.result_id == null ? null : String(row.result_id),
    result_version: row.result_version == null ? null : Number(row.result_version),
    created_at: String(row.created_at)
  };
}
function rowMatchesGuardedBinding(row, binding) {
  return row.authority_classification === binding.authority.classification && row.authority_id === binding.authority.authority_id && row.tenant_id === binding.tenant_id && row.scope === binding.scope && row.parent_id === binding.parent_id;
}
function guardedRelationTargets(payload) {
  if (!("metadata" in payload) || !payload.metadata)
    return [];
  const relation = payload.metadata[KNOWLEDGE_RELATIONS_METADATA_KEY];
  if (!relation || typeof relation !== "object" || Array.isArray(relation))
    return [];
  const value = relation;
  return [value.supersedes_item_id, value.canonical_item_id].filter((target) => typeof target === "string");
}
function rowToManifestStep(row) {
  return {
    ordinal: Number(row.ordinal),
    operation_id: String(row.operation_id),
    step_id: String(row.step_id),
    deterministic_key: String(row.deterministic_key),
    verb: String(row.verb),
    target_id: String(row.target_id),
    binding: {
      authority: {
        classification: String(row.authority_classification),
        authority_id: String(row.authority_id)
      },
      tenant_id: String(row.tenant_id),
      scope: String(row.scope),
      parent_id: String(row.parent_id)
    },
    semantic_digest: String(row.semantic_digest),
    precondition: guardedPreconditionFromRow(row),
    dependencies: parseJsonColumn(row.dependencies, []),
    limits: parseJsonColumn(row.limits, normalizeKnowledgeGuardedLimits()),
    recovery: {
      strategy: String(row.recovery_strategy),
      operation_id: String(row.recovery_operation_id),
      step_id: String(row.recovery_step_id),
      deterministic_key: String(row.recovery_deterministic_key),
      verb: String(row.recovery_verb),
      target_id: String(row.recovery_target_id),
      semantic_digest: String(row.recovery_semantic_digest),
      precondition: row.recovery_precondition_kind === "absent" ? { kind: "absent" } : { kind: "version", expected_version: Number(row.recovery_expected_version) },
      binding: {
        authority: {
          classification: String(row.recovery_authority_classification),
          authority_id: String(row.recovery_authority_id)
        },
        tenant_id: String(row.recovery_tenant_id),
        scope: String(row.recovery_scope),
        parent_id: String(row.recovery_parent_id)
      },
      limits: parseJsonColumn(row.recovery_limits, normalizeKnowledgeGuardedLimits()),
      receipt_scope: row.recovery_receipt_scope == null ? null : "accepted_step_receipt",
      compensates_receipt_id: row.recovery_compensates_receipt_id == null ? null : String(row.recovery_compensates_receipt_id)
    }
  };
}
function rowsToManifest(row, stepRows) {
  return {
    contract: KNOWLEDGE_GUARDED_WRITE_CONTRACT,
    manifest_receipt_id: String(row.manifest_receipt_id),
    manifest_id: String(row.manifest_id),
    operation_id: String(row.operation_id),
    deterministic_key: String(row.deterministic_key),
    manifest_digest: String(row.manifest_digest),
    maintainer: {
      authority: {
        classification: String(row.maintainer_authority_classification),
        authority_id: String(row.maintainer_authority_id)
      },
      tenant_id: String(row.maintainer_tenant_id),
      scope: String(row.maintainer_scope),
      parent_id: String(row.maintainer_parent_id)
    },
    step_count: Number(row.step_count),
    steps: stepRows.map(rowToManifestStep),
    created_at: String(row.created_at)
  };
}

class GuardedWriteRepo {
  client;
  authority;
  constructor(client, authority) {
    this.client = client;
    this.authority = authority;
  }
  binding(envelope) {
    return envelope.descriptor.binding;
  }
  async receiptById(client, receiptId) {
    const row = await client.get(`SELECT * FROM knowledge_guarded_write_receipts WHERE receipt_id = $1`, [receiptId]);
    return row ? rowToGuardedReceipt(row) : null;
  }
  async adoptionReceiptById(client, receiptId) {
    const row = await client.get(`SELECT * FROM knowledge_guarded_adoption_receipts WHERE receipt_id = $1`, [receiptId]);
    return row ? rowToAdoptionReceipt(row) : null;
  }
  async finishAdoption(client, envelope, status, code, result, priorTenantId) {
    const binding = envelope.binding;
    const receiptId = computeKnowledgeGuardedAdoptionReceiptId(envelope.deterministic_key);
    const row = await client.get(`INSERT INTO knowledge_guarded_adoption_receipts (
         receipt_id, deterministic_key, operation_id, step_id, action, target_id,
         authority_classification, authority_id, tenant_id, scope, parent_id,
         expected_version, expected_content_sha256, adoption_receipt_id, prior_tenant_id,
         status, code, effect_count, result_version, result_content_sha256
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20
       )
       RETURNING *`, [
      receiptId,
      envelope.deterministic_key,
      envelope.operation_id,
      envelope.step_id,
      envelope.action,
      envelope.target_id,
      binding.authority.classification,
      binding.authority.authority_id,
      binding.tenant_id,
      binding.scope,
      binding.parent_id,
      envelope.expected_version,
      envelope.expected_content_sha256,
      envelope.adoption_receipt_id,
      priorTenantId,
      status,
      code,
      status === "accepted" ? 1 : 0,
      result?.version ?? null,
      result?.content_sha256 ?? null
    ]);
    const boundClaim = await client.get(`UPDATE knowledge_guarded_adoption_claims
          SET receipt_id = $1
        WHERE deterministic_key = $2 AND receipt_id IS NULL
        RETURNING deterministic_key`, [receiptId, envelope.deterministic_key]);
    if (!row)
      throw new Error("guarded adoption receipt insertion returned no row.");
    if (boundClaim?.deterministic_key !== envelope.deterministic_key) {
      throw new Error("guarded adoption receipt was not bound to exactly one live claim.");
    }
    return rowToAdoptionReceipt(row);
  }
  async bindingState(fullId, binding, limits) {
    const row = await this.client.get(`SELECT * FROM knowledge_items
        WHERE id = $1
          AND (
            (
              authority_classification IS NULL
              AND (tenant_id IS NULL OR tenant_id::text = $2)
            )
            OR tenant_id::text = $2
          )
        LIMIT 1`, [fullId, binding.tenant_id]);
    if (!row)
      return null;
    const legacyForRequestedTenant = row.authority_classification == null && row.authority_id == null && row.scope == null && row.parent_id == null && (row.tenant_id == null || String(row.tenant_id) === binding.tenant_id);
    const requested = rowMatchesGuardedBinding(row, binding);
    return {
      contract: KNOWLEDGE_GUARDED_WRITE_CONTRACT,
      exact: true,
      bounded: true,
      item_count: 1,
      target_id: fullId,
      state: legacyForRequestedTenant ? "legacy_unbound" : requested ? "bound_to_requested" : "bound_elsewhere",
      item_version: legacyForRequestedTenant || requested ? Number(row.version ?? 1) : null,
      content_sha256: legacyForRequestedTenant || requested ? knowledgeGuardedContentSha256(String(row.content ?? "")) : null,
      limits
    };
  }
  async executeAdoption(envelope, actor) {
    const binding = envelope.binding;
    return this.client.transaction(async (tx) => {
      await tx.execute(`SELECT
           set_config('hasna.actor', $1, true),
           set_config('hasna.reason', $2, true),
           set_config('hasna.knowledge_guarded_adoption_key', $3, true)`, [
        actor,
        `FCAME-1 ${envelope.action} ${envelope.operation_id}/${envelope.step_id}`,
        envelope.deterministic_key
      ]);
      await tx.execute(`INSERT INTO knowledge_guarded_adoption_claims (
           deterministic_key, planned_receipt_id, operation_id, step_id, action, target_id,
           authority_classification, authority_id, tenant_id, scope, parent_id,
           expected_version, expected_content_sha256, adoption_receipt_id
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
         ON CONFLICT DO NOTHING`, [
        envelope.deterministic_key,
        computeKnowledgeGuardedAdoptionReceiptId(envelope.deterministic_key),
        envelope.operation_id,
        envelope.step_id,
        envelope.action,
        envelope.target_id,
        binding.authority.classification,
        binding.authority.authority_id,
        binding.tenant_id,
        binding.scope,
        binding.parent_id,
        envelope.expected_version,
        envelope.expected_content_sha256,
        envelope.adoption_receipt_id
      ]);
      const claim = await tx.get(`SELECT * FROM knowledge_guarded_adoption_claims
          WHERE authority_classification = $1
            AND authority_id = $2
            AND tenant_id = $3
            AND scope = $4
            AND parent_id = $5
            AND operation_id = $6
            AND step_id = $7
          FOR UPDATE`, [
        binding.authority.classification,
        binding.authority.authority_id,
        binding.tenant_id,
        binding.scope,
        binding.parent_id,
        envelope.operation_id,
        envelope.step_id
      ]);
      if (!claim)
        throw new Error("guarded adoption claim was not created.");
      if (claim.deterministic_key !== envelope.deterministic_key) {
        const receipt2 = claim.receipt_id ? await this.adoptionReceiptById(tx, String(claim.receipt_id)) : null;
        throw new AdoptionOperationBindingConflictError(receipt2);
      }
      if (claim.receipt_id) {
        const receipt2 = await this.adoptionReceiptById(tx, String(claim.receipt_id));
        if (!receipt2)
          throw new Error("guarded adoption claim references a missing receipt.");
        return {
          contract: KNOWLEDGE_GUARDED_WRITE_CONTRACT,
          deterministic_key: envelope.deterministic_key,
          receipt: receipt2,
          duplicate: true
        };
      }
      if (envelope.action === "rollback") {
        const source = envelope.adoption_receipt_id ? await this.adoptionReceiptById(tx, envelope.adoption_receipt_id) : null;
        if (!source || source.action !== "adopt" || source.status !== "accepted" || source.effect_count !== 1 || source.target_id !== envelope.target_id || source.result_version !== envelope.expected_version || source.result_content_sha256 !== envelope.expected_content_sha256 || canonicalKnowledgeGuardedJson(source.binding) !== canonicalKnowledgeGuardedJson(binding)) {
          const receipt2 = await this.finishAdoption(tx, envelope, "rejected", "adoption_receipt_mismatch", null, null);
          return {
            contract: KNOWLEDGE_GUARDED_WRITE_CONTRACT,
            deterministic_key: envelope.deterministic_key,
            receipt: receipt2,
            duplicate: false
          };
        }
      }
      const existing = await tx.get(`SELECT * FROM knowledge_items
          WHERE id = $1
            AND (tenant_id IS NULL OR tenant_id::text = $2)
          FOR UPDATE`, [envelope.target_id, binding.tenant_id]);
      if (!existing) {
        const receipt2 = await this.finishAdoption(tx, envelope, "rejected", "not_found", null, null);
        return {
          contract: KNOWLEDGE_GUARDED_WRITE_CONTRACT,
          deterministic_key: envelope.deterministic_key,
          receipt: receipt2,
          duplicate: false
        };
      }
      const legacyForRequestedTenant = existing.authority_classification == null && existing.authority_id == null && existing.scope == null && existing.parent_id == null && (existing.tenant_id == null || String(existing.tenant_id) === binding.tenant_id);
      const requested = rowMatchesGuardedBinding(existing, binding);
      if (envelope.action === "adopt" && !legacyForRequestedTenant || envelope.action === "rollback" && (!requested || existing.guarded_adoption_receipt_id !== envelope.adoption_receipt_id)) {
        const code = envelope.action === "adopt" ? requested ? "already_bound" : "binding_mismatch" : requested ? "adoption_receipt_not_current" : "binding_mismatch";
        const receipt2 = await this.finishAdoption(tx, envelope, "rejected", code, null, null);
        return {
          contract: KNOWLEDGE_GUARDED_WRITE_CONTRACT,
          deterministic_key: envelope.deterministic_key,
          receipt: receipt2,
          duplicate: false
        };
      }
      const currentVersion = Number(existing.version ?? 1);
      if (currentVersion !== envelope.expected_version) {
        const receipt2 = await this.finishAdoption(tx, envelope, "rejected", "version_conflict", null, null);
        return {
          contract: KNOWLEDGE_GUARDED_WRITE_CONTRACT,
          deterministic_key: envelope.deterministic_key,
          receipt: receipt2,
          duplicate: false
        };
      }
      const currentContentSha256 = knowledgeGuardedContentSha256(String(existing.content ?? ""));
      if (currentContentSha256 !== envelope.expected_content_sha256) {
        const receipt2 = await this.finishAdoption(tx, envelope, "rejected", "content_digest_conflict", null, null);
        return {
          contract: KNOWLEDGE_GUARDED_WRITE_CONTRACT,
          deterministic_key: envelope.deterministic_key,
          receipt: receipt2,
          duplicate: false
        };
      }
      const updated = envelope.action === "adopt" ? await tx.get(`UPDATE knowledge_items SET
             authority_classification = $1,
             authority_id = $2,
             tenant_id = (
               jsonb_populate_record(
                 NULL::knowledge_items,
                 jsonb_build_object('tenant_id', $3::text)
               )
             ).tenant_id,
             scope = $4,
             parent_id = $5,
             guarded_adoption_receipt_id = $6
           WHERE id = $7
             AND version = $8
             AND authority_classification IS NULL
             AND authority_id IS NULL
             AND scope IS NULL
             AND parent_id IS NULL
             AND guarded_adoption_receipt_id IS NULL
             AND (tenant_id IS NULL OR tenant_id::text = $3)
             AND encode(sha256(convert_to(coalesce(content, ''), 'UTF8')), 'hex') = $9
           RETURNING *`, [
        binding.authority.classification,
        binding.authority.authority_id,
        binding.tenant_id,
        binding.scope,
        binding.parent_id,
        computeKnowledgeGuardedAdoptionReceiptId(envelope.deterministic_key),
        envelope.target_id,
        envelope.expected_version,
        envelope.expected_content_sha256
      ]) : await tx.get(`UPDATE knowledge_items SET
             authority_classification = NULL,
             authority_id = NULL,
             tenant_id = (
               jsonb_populate_record(
                 NULL::knowledge_items,
                 jsonb_build_object('tenant_id', $1::text)
               )
             ).tenant_id,
             scope = NULL,
             parent_id = NULL,
             guarded_adoption_receipt_id = NULL
           WHERE id = $2
             AND version = $3
             AND authority_classification = $4
             AND authority_id = $5
             AND tenant_id::text = $6
             AND scope = $7
             AND parent_id = $8
             AND guarded_adoption_receipt_id = $9
             AND encode(sha256(convert_to(coalesce(content, ''), 'UTF8')), 'hex') = $10
           RETURNING *`, [
        (await this.adoptionReceiptById(tx, envelope.adoption_receipt_id)).prior_tenant_id,
        envelope.target_id,
        envelope.expected_version,
        binding.authority.classification,
        binding.authority.authority_id,
        binding.tenant_id,
        binding.scope,
        binding.parent_id,
        envelope.adoption_receipt_id,
        envelope.expected_content_sha256
      ]);
      if (!updated) {
        const receipt2 = await this.finishAdoption(tx, envelope, "rejected", "compare_and_swap_conflict", null, null);
        return {
          contract: KNOWLEDGE_GUARDED_WRITE_CONTRACT,
          deterministic_key: envelope.deterministic_key,
          receipt: receipt2,
          duplicate: false
        };
      }
      const result = {
        version: Number(updated.version ?? 1),
        content_sha256: knowledgeGuardedContentSha256(String(updated.content ?? ""))
      };
      const receipt = await this.finishAdoption(tx, envelope, "accepted", envelope.action === "adopt" ? "adopted" : "rolled_back", result, envelope.action === "adopt" ? existing.tenant_id == null ? null : String(existing.tenant_id) : (await this.adoptionReceiptById(tx, envelope.adoption_receipt_id)).prior_tenant_id);
      return {
        contract: KNOWLEDGE_GUARDED_WRITE_CONTRACT,
        deterministic_key: envelope.deterministic_key,
        receipt,
        duplicate: false
      };
    });
  }
  async reconcileAdoption(deterministicKey, binding, operationId, stepId, limits) {
    const row = await this.client.get(`SELECT * FROM knowledge_guarded_adoption_receipts
        WHERE deterministic_key = $1
          AND authority_classification = $2
          AND authority_id = $3
          AND tenant_id = $4
          AND scope = $5
          AND parent_id = $6
          AND operation_id = $7
          AND step_id = $8
        LIMIT 1`, [
      deterministicKey,
      binding.authority.classification,
      binding.authority.authority_id,
      binding.tenant_id,
      binding.scope,
      binding.parent_id,
      operationId,
      stepId
    ]);
    return {
      contract: KNOWLEDGE_GUARDED_WRITE_CONTRACT,
      deterministic_key: deterministicKey,
      operation_id: operationId,
      step_id: stepId,
      exact: true,
      bounded: true,
      receipt_count: row ? 1 : 0,
      terminal_complete: Boolean(row),
      receipt: row ? rowToAdoptionReceipt(row) : null,
      limits
    };
  }
  async manifestById(client, manifestId) {
    const row = await client.get(`SELECT * FROM knowledge_guarded_write_manifests WHERE manifest_id = $1`, [manifestId]);
    if (!row)
      return null;
    const steps = await client.many(`SELECT * FROM knowledge_guarded_write_manifest_steps
        WHERE manifest_id = $1 ORDER BY ordinal ASC`, [manifestId]);
    return rowsToManifest(row, steps);
  }
  async createManifest(envelope) {
    const { manifest, maintainer } = envelope;
    return this.client.transaction(async (tx) => {
      await tx.execute(`INSERT INTO knowledge_guarded_write_manifests (
           manifest_id, manifest_receipt_id, deterministic_key, operation_id,
           manifest_digest,
           maintainer_authority_classification, maintainer_authority_id,
           maintainer_tenant_id, maintainer_scope, maintainer_parent_id,
           step_count
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         ON CONFLICT DO NOTHING`, [
        manifest.manifest_id,
        `kmr_${envelope.deterministic_key.replace(/^fcame1_manifest_/, "")}`,
        envelope.deterministic_key,
        manifest.operation_id,
        computeKnowledgeGuardedManifestDigest(maintainer, manifest),
        maintainer.authority.classification,
        maintainer.authority.authority_id,
        maintainer.tenant_id,
        maintainer.scope,
        maintainer.parent_id,
        manifest.steps.length
      ]);
      const row = await tx.get(`SELECT * FROM knowledge_guarded_write_manifests WHERE manifest_id = $1 FOR UPDATE`, [manifest.manifest_id]);
      if (!row)
        throw new Error("guarded manifest was not created.");
      const existingSteps = await tx.many(`SELECT * FROM knowledge_guarded_write_manifest_steps
          WHERE manifest_id = $1 ORDER BY ordinal ASC`, [manifest.manifest_id]);
      if (row.deterministic_key !== envelope.deterministic_key) {
        throw new ManifestBindingConflictError(rowsToManifest(row, existingSteps));
      }
      const duplicate = existingSteps.length > 0;
      if (!duplicate) {
        for (const step of manifest.steps) {
          await tx.execute(`INSERT INTO knowledge_guarded_write_manifest_steps (
               manifest_id, ordinal, operation_id, step_id, deterministic_key,
               verb, target_id, semantic_digest, precondition_kind, expected_version,
               dependencies, limits,
               authority_classification, authority_id, tenant_id, scope, parent_id,
               recovery_strategy, recovery_operation_id, recovery_step_id,
               recovery_deterministic_key, recovery_verb, recovery_target_id,
               recovery_semantic_digest, recovery_precondition_kind, recovery_expected_version,
               recovery_authority_classification, recovery_authority_id,
               recovery_tenant_id, recovery_scope, recovery_parent_id,
               recovery_limits, recovery_receipt_scope, recovery_compensates_receipt_id
             ) VALUES (
               $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,
               $18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34
             )`, [
            manifest.manifest_id,
            step.ordinal,
            step.operation_id,
            step.step_id,
            step.deterministic_key,
            step.verb,
            step.target_id,
            step.semantic_digest,
            step.precondition.kind,
            step.precondition.kind === "version" ? step.precondition.expected_version : null,
            JSON.stringify(step.dependencies),
            JSON.stringify(step.limits),
            step.binding.authority.classification,
            step.binding.authority.authority_id,
            step.binding.tenant_id,
            step.binding.scope,
            step.binding.parent_id,
            step.recovery.strategy,
            step.recovery.operation_id,
            step.recovery.step_id,
            step.recovery.deterministic_key,
            step.recovery.verb,
            step.recovery.target_id,
            step.recovery.semantic_digest,
            step.recovery.precondition.kind,
            step.recovery.precondition.kind === "version" ? step.recovery.precondition.expected_version : null,
            step.recovery.binding.authority.classification,
            step.recovery.binding.authority.authority_id,
            step.recovery.binding.tenant_id,
            step.recovery.binding.scope,
            step.recovery.binding.parent_id,
            JSON.stringify(step.recovery.limits),
            step.recovery.receipt_scope,
            step.recovery.compensates_receipt_id
          ]);
        }
      }
      const stored = await this.manifestById(tx, manifest.manifest_id);
      if (!stored || stored.steps.length !== manifest.steps.length) {
        throw new Error("guarded manifest exact readback failed in its creation transaction.");
      }
      return {
        contract: KNOWLEDGE_GUARDED_WRITE_CONTRACT,
        deterministic_key: envelope.deterministic_key,
        manifest: stored,
        duplicate
      };
    });
  }
  async assertManifestStep(client, envelope) {
    const manifestBinding = envelope.descriptor.manifest;
    if (!manifestBinding)
      return;
    const lockedManifest = await client.get(`SELECT manifest_id FROM knowledge_guarded_write_manifests
        WHERE manifest_id = $1
        FOR UPDATE`, [manifestBinding.manifest_id]);
    if (!lockedManifest)
      throw new HttpError(409, "guarded manifest does not exist.");
    const manifest = await this.manifestById(client, manifestBinding.manifest_id);
    if (!manifest)
      throw new Error("locked guarded manifest disappeared inside its transaction.");
    const step = manifest.steps[manifestBinding.ordinal];
    if (!step || step.ordinal !== manifestBinding.ordinal) {
      throw new HttpError(409, "guarded manifest step does not exist.");
    }
    const descriptor = envelope.descriptor;
    const action = manifestBinding.phase === "primary" ? step : step.recovery;
    if (action.deterministic_key !== envelope.deterministic_key || action.operation_id !== descriptor.operation_id || action.step_id !== descriptor.step_id || action.verb !== descriptor.verb || action.target_id !== descriptor.target_id || action.semantic_digest !== descriptor.payload_digest || canonicalKnowledgeGuardedJson(action.precondition) !== canonicalKnowledgeGuardedJson(descriptor.precondition) || canonicalKnowledgeGuardedJson(action.binding) !== canonicalKnowledgeGuardedJson(descriptor.binding) || canonicalKnowledgeGuardedJson(action.limits) !== canonicalKnowledgeGuardedJson(envelope.limits)) {
      throw new HttpError(409, "guarded write does not match its immutable manifest step.");
    }
    if (manifestBinding.phase === "recovery" && (manifestBinding.compensates_receipt_id !== step.recovery.compensates_receipt_id || step.recovery.strategy === "receipt_scoped_compensation" && manifestBinding.compensates_receipt_id === null)) {
      throw new HttpError(409, "guarded recovery does not match its receipt-scoped manifest action.");
    }
    const existingExactReceipt = await client.get(`SELECT receipt_id FROM knowledge_guarded_write_receipts
        WHERE deterministic_key = $1
          AND authority_classification = $2
          AND authority_id = $3
          AND tenant_id = $4
          AND scope = $5
          AND parent_id = $6
          AND operation_id = $7
          AND step_id = $8
        LIMIT 1`, [
      envelope.deterministic_key,
      descriptor.binding.authority.classification,
      descriptor.binding.authority.authority_id,
      descriptor.binding.tenant_id,
      descriptor.binding.scope,
      descriptor.binding.parent_id,
      descriptor.operation_id,
      descriptor.step_id
    ]);
    if (existingExactReceipt)
      return;
    const prerequisites = manifestBinding.phase === "primary" ? step.dependencies.map((ordinal) => manifest.steps[ordinal]) : manifest.steps.slice(0, step.ordinal + 1);
    let prefixReceipt = null;
    for (const prior of prerequisites) {
      if (prior.binding.authority.classification !== this.authority.classification || prior.binding.authority.authority_id !== this.authority.authority_id) {
        throw new HttpError(409, "manifest_prior_external_authority_receipt_unverified: this authority cannot certify the prior step.");
      }
      const receipt = await client.get(`SELECT * FROM knowledge_guarded_write_receipts
          WHERE deterministic_key = $1
            AND authority_classification = $2
            AND authority_id = $3
            AND tenant_id = $4
            AND scope = $5
            AND parent_id = $6
          LIMIT 1`, [
        prior.deterministic_key,
        prior.binding.authority.classification,
        prior.binding.authority.authority_id,
        prior.binding.tenant_id,
        prior.binding.scope,
        prior.binding.parent_id
      ]);
      if (!receipt || receipt.status !== "accepted") {
        throw new HttpError(409, "manifest_prior_step_not_accepted.");
      }
      if (prior.ordinal === step.ordinal)
        prefixReceipt = rowToGuardedReceipt(receipt);
    }
    if (manifestBinding.phase === "primary") {
      for (const prior of prerequisites) {
        if (prior.recovery.binding.authority.classification !== this.authority.classification || prior.recovery.binding.authority.authority_id !== this.authority.authority_id || prior.recovery.binding.tenant_id !== descriptor.binding.tenant_id) {
          throw new HttpError(409, "external_authority_receipt_verifier_required: " + "this authority cannot prove that a prior recovery action is absent.");
        }
        const recoveryReceipt = await client.get(`SELECT status FROM knowledge_guarded_write_receipts
            WHERE deterministic_key = $1
              AND authority_classification = $2
              AND authority_id = $3
              AND tenant_id = $4
              AND scope = $5
              AND parent_id = $6
              AND operation_id = $7
              AND step_id = $8
            LIMIT 1`, [
          prior.recovery.deterministic_key,
          prior.recovery.binding.authority.classification,
          prior.recovery.binding.authority.authority_id,
          prior.recovery.binding.tenant_id,
          prior.recovery.binding.scope,
          prior.recovery.binding.parent_id,
          prior.recovery.operation_id,
          prior.recovery.step_id
        ]);
        if (recoveryReceipt) {
          throw new HttpError(409, "manifest_prior_recovery_terminal: the workflow cannot resume its primary path " + "after a declared recovery action reached a terminal receipt.");
        }
      }
    }
    if (manifestBinding.phase === "recovery" && step.recovery.strategy === "receipt_scoped_compensation" && prefixReceipt?.receipt_id !== step.recovery.compensates_receipt_id) {
      throw new HttpError(409, "manifest compensation is not scoped to the accepted prefix receipt.");
    }
    if (manifestBinding.phase === "recovery") {
      const next = manifest.steps[step.ordinal + 1];
      if (!next) {
        throw new HttpError(409, "manifest has no partial suffix after this prefix; recovery is not runnable.");
      }
      if (next.binding.authority.classification !== this.authority.classification || next.binding.authority.authority_id !== this.authority.authority_id || next.binding.tenant_id !== descriptor.binding.tenant_id) {
        throw new HttpError(409, "external_authority_receipt_verifier_required: recovery cannot infer the next authority state.");
      }
      const nextReceipt = await client.get(`SELECT * FROM knowledge_guarded_write_receipts
          WHERE deterministic_key = $1
            AND authority_classification = $2
            AND authority_id = $3
            AND tenant_id = $4
            AND scope = $5
            AND parent_id = $6
          LIMIT 1`, [
        next.deterministic_key,
        next.binding.authority.classification,
        next.binding.authority.authority_id,
        next.binding.tenant_id,
        next.binding.scope,
        next.binding.parent_id
      ]);
      if (nextReceipt?.status === "accepted") {
        throw new HttpError(409, "manifest prefix has already advanced; this recovery action is no longer runnable.");
      }
    }
  }
  async finish(client, envelope, status, code, result) {
    const descriptor = envelope.descriptor;
    const binding = descriptor.binding;
    const receiptId = computeKnowledgeGuardedReceiptId(envelope.deterministic_key);
    const row = await client.get(`INSERT INTO knowledge_guarded_write_receipts (
         receipt_id, deterministic_key, operation_id, step_id, verb, target_id,
         authority_classification, authority_id, tenant_id, scope, parent_id,
         payload_digest, precondition_kind, expected_version,
         manifest_id, manifest_ordinal, manifest_phase, compensates_receipt_id,
         status, code, effect_count, result_id, result_version
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23
       )
       RETURNING *`, [
      receiptId,
      envelope.deterministic_key,
      descriptor.operation_id,
      descriptor.step_id,
      descriptor.verb,
      descriptor.target_id,
      binding.authority.classification,
      binding.authority.authority_id,
      binding.tenant_id,
      binding.scope,
      binding.parent_id,
      descriptor.payload_digest,
      descriptor.precondition.kind,
      descriptor.precondition.kind === "version" ? descriptor.precondition.expected_version : null,
      descriptor.manifest?.manifest_id ?? null,
      descriptor.manifest?.ordinal ?? null,
      descriptor.manifest?.phase ?? null,
      descriptor.manifest?.compensates_receipt_id ?? null,
      status,
      code,
      status === "accepted" ? 1 : 0,
      result?.id ?? null,
      result?.version ?? null
    ]);
    const boundClaim = await client.get(`UPDATE knowledge_guarded_write_claims
          SET receipt_id = $1
        WHERE deterministic_key = $2 AND receipt_id IS NULL
        RETURNING deterministic_key`, [receiptId, envelope.deterministic_key]);
    if (!row)
      throw new Error("guarded receipt insertion returned no row.");
    if (boundClaim?.deterministic_key !== envelope.deterministic_key) {
      throw new Error("guarded receipt was not bound to exactly one live operation claim.");
    }
    return rowToGuardedReceipt(row);
  }
  async execute(envelope, actor) {
    const descriptor = envelope.descriptor;
    const binding = this.binding(envelope);
    return this.client.transaction(async (tx) => {
      await tx.execute(`SELECT
           set_config('hasna.actor', $1, true),
           set_config('hasna.reason', $2, true),
           set_config('hasna.knowledge_guarded_deterministic_key', $3, true)`, [
        actor,
        `FCAME-1 ${descriptor.operation_id}/${descriptor.step_id}`,
        envelope.deterministic_key
      ]);
      await this.assertManifestStep(tx, envelope);
      await tx.execute(`INSERT INTO knowledge_guarded_write_claims (
           deterministic_key, operation_id, step_id,
           authority_classification, authority_id, tenant_id, scope, parent_id,
           verb, target_id, payload_digest, precondition_kind, expected_version,
           manifest_id, manifest_ordinal, manifest_phase, compensates_receipt_id
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
         ON CONFLICT DO NOTHING`, [
        envelope.deterministic_key,
        descriptor.operation_id,
        descriptor.step_id,
        binding.authority.classification,
        binding.authority.authority_id,
        binding.tenant_id,
        binding.scope,
        binding.parent_id,
        descriptor.verb,
        descriptor.target_id,
        descriptor.payload_digest,
        descriptor.precondition.kind,
        descriptor.precondition.kind === "version" ? descriptor.precondition.expected_version : null,
        descriptor.manifest?.manifest_id ?? null,
        descriptor.manifest?.ordinal ?? null,
        descriptor.manifest?.phase ?? null,
        descriptor.manifest?.compensates_receipt_id ?? null
      ]);
      const claim = await tx.get(`SELECT * FROM knowledge_guarded_write_claims
          WHERE authority_classification = $1
            AND authority_id = $2
            AND tenant_id = $3
            AND scope = $4
            AND parent_id = $5
            AND operation_id = $6
            AND step_id = $7
          FOR UPDATE`, [
        binding.authority.classification,
        binding.authority.authority_id,
        binding.tenant_id,
        binding.scope,
        binding.parent_id,
        descriptor.operation_id,
        descriptor.step_id
      ]);
      if (!claim)
        throw new Error("guarded operation claim was not created.");
      if (claim.deterministic_key !== envelope.deterministic_key) {
        const receipt2 = claim.receipt_id ? await this.receiptById(tx, String(claim.receipt_id)) : null;
        throw new OperationBindingConflictError(receipt2);
      }
      if (claim.receipt_id) {
        const receipt2 = await this.receiptById(tx, String(claim.receipt_id));
        if (!receipt2)
          throw new Error("guarded claim references a missing receipt.");
        return {
          contract: KNOWLEDGE_GUARDED_WRITE_CONTRACT,
          deterministic_key: envelope.deterministic_key,
          receipt: receipt2,
          duplicate: true
        };
      }
      for (const targetId of guardedRelationTargets(envelope.payload)) {
        const target = await tx.get(`SELECT id FROM knowledge_items
            WHERE id = $1
              AND authority_classification = $2
              AND authority_id = $3
              AND tenant_id = $4
              AND scope = $5
              AND parent_id = $6
            LIMIT 1`, [
          targetId,
          binding.authority.classification,
          binding.authority.authority_id,
          binding.tenant_id,
          binding.scope,
          binding.parent_id
        ]);
        if (!target) {
          const receipt2 = await this.finish(tx, envelope, "rejected", "relation_binding_mismatch", null);
          return {
            contract: KNOWLEDGE_GUARDED_WRITE_CONTRACT,
            deterministic_key: envelope.deterministic_key,
            receipt: receipt2,
            duplicate: false
          };
        }
      }
      if (descriptor.verb === "create") {
        const payload = envelope.payload;
        const now = new Date().toISOString();
        const inserted = await tx.get(`INSERT INTO knowledge_items (
             id, short_id, title, content, url, tags, metadata, archived,
             created_at, updated_at,
             authority_classification, authority_id, tenant_id, scope, parent_id
           ) VALUES (
             $1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,FALSE,$8,$8,$9,$10,$11,$12,$13
           )
           ON CONFLICT (id) DO NOTHING
           RETURNING *`, [
          descriptor.target_id,
          makeShortId(descriptor.target_id),
          payload.title,
          payload.content ?? "",
          payload.url ?? null,
          JSON.stringify(payload.tags ?? []),
          JSON.stringify(payload.metadata ?? {}),
          now,
          binding.authority.classification,
          binding.authority.authority_id,
          binding.tenant_id,
          binding.scope,
          binding.parent_id
        ]);
        if (!inserted) {
          const existing2 = await tx.get(`SELECT * FROM knowledge_items WHERE id = $1 FOR UPDATE`, [descriptor.target_id]);
          const code = existing2 && rowMatchesGuardedBinding(existing2, binding) ? "target_exists" : "binding_mismatch";
          const receipt3 = await this.finish(tx, envelope, "rejected", code, null);
          return {
            contract: KNOWLEDGE_GUARDED_WRITE_CONTRACT,
            deterministic_key: envelope.deterministic_key,
            receipt: receipt3,
            duplicate: false
          };
        }
        const item2 = rowToItem(inserted);
        const receipt2 = await this.finish(tx, envelope, "accepted", "created", item2);
        return {
          contract: KNOWLEDGE_GUARDED_WRITE_CONTRACT,
          deterministic_key: envelope.deterministic_key,
          receipt: receipt2,
          duplicate: false
        };
      }
      const existing = await tx.get(`SELECT * FROM knowledge_items WHERE id = $1 FOR UPDATE`, [descriptor.target_id]);
      if (!existing) {
        const receipt2 = await this.finish(tx, envelope, "rejected", "not_found", null);
        return {
          contract: KNOWLEDGE_GUARDED_WRITE_CONTRACT,
          deterministic_key: envelope.deterministic_key,
          receipt: receipt2,
          duplicate: false
        };
      }
      if (!rowMatchesGuardedBinding(existing, binding)) {
        const receipt2 = await this.finish(tx, envelope, "rejected", "binding_mismatch", null);
        return {
          contract: KNOWLEDGE_GUARDED_WRITE_CONTRACT,
          deterministic_key: envelope.deterministic_key,
          receipt: receipt2,
          duplicate: false
        };
      }
      const expectedVersion = descriptor.precondition.kind === "version" ? descriptor.precondition.expected_version : 0;
      const currentVersion = Number(existing.version ?? 1);
      if (currentVersion !== expectedVersion) {
        const receipt2 = await this.finish(tx, envelope, "rejected", "version_conflict", null);
        return {
          contract: KNOWLEDGE_GUARDED_WRITE_CONTRACT,
          deterministic_key: envelope.deterministic_key,
          receipt: receipt2,
          duplicate: false
        };
      }
      const patch = envelope.payload;
      const sets = [];
      const params = [];
      const push = (column, value, cast = "") => {
        params.push(value);
        sets.push(`${column} = $${params.length}${cast}`);
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
      params.push(descriptor.target_id);
      const idPosition = params.length;
      params.push(expectedVersion);
      const versionPosition = params.length;
      const updated = await tx.get(`UPDATE knowledge_items
            SET ${sets.join(", ")}
          WHERE id = $${idPosition} AND version = $${versionPosition}
          RETURNING *`, params);
      if (!updated)
        throw new Error("guarded compare-and-swap lost its locked target.");
      const item = rowToItem(updated);
      const receipt = await this.finish(tx, envelope, "accepted", "updated", item);
      return {
        contract: KNOWLEDGE_GUARDED_WRITE_CONTRACT,
        deterministic_key: envelope.deterministic_key,
        receipt,
        duplicate: false
      };
    });
  }
  async reconcileManifest(manifestId, maintainer, limits) {
    const manifest = await this.manifestById(this.client, manifestId);
    if (!manifest || canonicalKnowledgeGuardedJson(manifest.maintainer) !== canonicalKnowledgeGuardedJson(maintainer)) {
      return null;
    }
    const steps = [];
    const externalAuthorities = new Set;
    const reconcileAction = async (action) => {
      const locallyVerifiable = action.binding.authority.classification === this.authority.classification && action.binding.authority.authority_id === this.authority.authority_id && action.binding.tenant_id === maintainer.tenant_id;
      if (!locallyVerifiable) {
        const authorityKey = `${action.binding.authority.classification}:${action.binding.authority.authority_id}`;
        externalAuthorities.add(authorityKey);
        return { state: "unverified_external_authority", receipt: null };
      }
      const row = await this.client.get(`SELECT * FROM knowledge_guarded_write_receipts
          WHERE deterministic_key = $1
            AND authority_classification = $2
            AND authority_id = $3
            AND tenant_id = $4
            AND scope = $5
            AND parent_id = $6
            AND operation_id = $7
            AND step_id = $8
          LIMIT 1`, [
        action.deterministic_key,
        action.binding.authority.classification,
        action.binding.authority.authority_id,
        action.binding.tenant_id,
        action.binding.scope,
        action.binding.parent_id,
        action.operation_id,
        action.step_id
      ]);
      const receipt = row ? rowToGuardedReceipt(row) : null;
      return { state: receipt?.status ?? "missing", receipt };
    };
    for (const step of manifest.steps) {
      const primary = await reconcileAction(step);
      const recovery = await reconcileAction(step.recovery);
      steps.push({
        ordinal: step.ordinal,
        deterministic_key: step.deterministic_key,
        authority: step.binding.authority,
        state: primary.state,
        receipt: primary.receipt,
        recovery_deterministic_key: step.recovery.deterministic_key,
        recovery_state: recovery.state,
        recovery_receipt: recovery.receipt
      });
    }
    const completion = evaluateKnowledgeGuardedManifestCompletion(steps);
    return {
      contract: KNOWLEDGE_GUARDED_WRITE_CONTRACT,
      manifest,
      exact: true,
      bounded: true,
      terminal_complete: completion.terminal_complete,
      accepted_complete: completion.accepted_complete,
      unsupported_gap: externalAuthorities.size > 0 ? `external_authority_receipt_verifier_required:${[...externalAuthorities].sort().join(",")}` : null,
      steps,
      limits
    };
  }
  async reconcile(deterministicKey, binding, operationId, stepId, limits) {
    const row = await this.client.get(`SELECT * FROM knowledge_guarded_write_receipts
        WHERE deterministic_key = $1
          AND authority_classification = $2
          AND authority_id = $3
          AND tenant_id = $4
          AND scope = $5
          AND parent_id = $6
          AND operation_id = $7
          AND step_id = $8
        LIMIT 1`, [
      deterministicKey,
      binding.authority.classification,
      binding.authority.authority_id,
      binding.tenant_id,
      binding.scope,
      binding.parent_id,
      operationId,
      stepId
    ]);
    return {
      contract: KNOWLEDGE_GUARDED_WRITE_CONTRACT,
      deterministic_key: deterministicKey,
      operation_id: operationId,
      step_id: stepId,
      exact: true,
      bounded: true,
      receipt_count: row ? 1 : 0,
      terminal_complete: Boolean(row),
      receipt: row ? rowToGuardedReceipt(row) : null,
      limits
    };
  }
  async lookupTitle(title, binding, limits) {
    const rows = await this.client.many(`SELECT * FROM knowledge_items
        WHERE title = $1
          AND authority_classification = $2
          AND authority_id = $3
          AND tenant_id = $4
          AND scope = $5
          AND parent_id = $6
        ORDER BY id
        LIMIT 2`, [
      title,
      binding.authority.classification,
      binding.authority.authority_id,
      binding.tenant_id,
      binding.scope,
      binding.parent_id
    ]);
    if (rows.length > 1)
      throw new PrivateTitleLookupAmbiguousError;
    const items = rows.map((row) => knowledgePrivateItemProof(rowToItem(row)));
    return {
      contract: KNOWLEDGE_GUARDED_WRITE_CONTRACT,
      exact: true,
      bounded: true,
      item_count: items.length,
      binding,
      title_digest: knowledgeGuardedContentSha256(title),
      items,
      limits
    };
  }
  async query(selector, selectorDigest, archive, page, binding, limits) {
    if (selector.kind === "semantic_overlap") {
      return {
        contract: KNOWLEDGE_GUARDED_WRITE_CONTRACT,
        exact: true,
        bounded: true,
        private: true,
        query_kind: selector.kind,
        status: "unavailable",
        code: "semantic_query_unavailable",
        binding,
        selector_digest: selectorDigest,
        total: 0,
        item_count: 0,
        page: {
          limit: page.limit,
          offset: page.offset,
          returned: 0,
          has_more: false
        },
        items: [],
        limits
      };
    }
    const bindingParams = [
      binding.authority.classification,
      binding.authority.authority_id,
      binding.tenant_id,
      binding.scope,
      binding.parent_id
    ];
    const currentWhere = [
      "authority_classification = $1",
      "authority_id = $2",
      "tenant_id = $3",
      "scope = $4",
      "parent_id = $5"
    ];
    if (archive === "active")
      currentWhere.push("archived = FALSE");
    else if (archive === "archived")
      currentWhere.push("archived = TRUE");
    let currentOrder = "ORDER BY id ASC";
    let matchedValue;
    if (selector.kind === "historical_version") {
      const params = [...bindingParams, selector.item_id, selector.version];
      const historyWhere = [
        "i.authority_classification = $1",
        "i.authority_id = $2",
        "i.tenant_id = $3",
        "i.scope = $4",
        "i.parent_id = $5",
        "v.item_id = $6",
        "v.version = $7"
      ];
      if (archive === "active")
        historyWhere.push("v.archived = FALSE");
      else if (archive === "archived")
        historyWhere.push("v.archived = TRUE");
      const whereSql2 = `WHERE ${historyWhere.join(" AND ")}`;
      const totalRow2 = await this.client.get(`SELECT count(*)::text AS count
          FROM knowledge_item_versions v
          JOIN knowledge_items i ON i.id = v.item_id
          ${whereSql2}`, params);
      const rows2 = await this.client.many(`SELECT v.*
          FROM knowledge_item_versions v
          JOIN knowledge_items i ON i.id = v.item_id
          ${whereSql2}
          ORDER BY v.version ASC
          LIMIT ${page.limit} OFFSET ${page.offset}`, params);
      const total2 = Number(totalRow2?.count ?? 0);
      const items2 = rows2.map((row) => knowledgePrivateHistoricalQueryItemProof(rowToVersion(row), selector.item_id));
      return {
        contract: KNOWLEDGE_GUARDED_WRITE_CONTRACT,
        exact: true,
        bounded: true,
        private: true,
        query_kind: selector.kind,
        status: "available",
        code: null,
        binding,
        selector_digest: selectorDigest,
        total: total2,
        item_count: items2.length,
        page: {
          limit: page.limit,
          offset: page.offset,
          returned: items2.length,
          has_more: page.offset + items2.length < total2
        },
        items: items2,
        limits
      };
    }
    switch (selector.kind) {
      case "exact_title":
        bindingParams.push(selector.title);
        currentWhere.push(`title = $${bindingParams.length}`);
        matchedValue = selector.title;
        break;
      case "lexical_overlap": {
        bindingParams.push(selector.query);
        const tsQuery = `websearch_to_tsquery('english', $${bindingParams.length})`;
        currentWhere.push(`search_vector @@ ${tsQuery}`);
        currentOrder = `ORDER BY ts_rank_cd(search_vector, ${tsQuery}) DESC, id ASC`;
        matchedValue = selector.query;
        break;
      }
      case "supersession":
        bindingParams.push(KNOWLEDGE_RELATIONS_SCHEMA, selector.supersedes_item_id);
        currentWhere.push(`metadata #>> '{${KNOWLEDGE_RELATIONS_METADATA_KEY},schema}' = $${bindingParams.length - 1}`, `metadata #>> '{${KNOWLEDGE_RELATIONS_METADATA_KEY},supersedes_item_id}' = $${bindingParams.length}`);
        matchedValue = selector.supersedes_item_id;
        break;
      case "current_version":
        bindingParams.push(selector.item_id);
        currentWhere.push(`id = $${bindingParams.length}`);
        matchedValue = selector.item_id;
        break;
      case "canonical_pointer":
        bindingParams.push(KNOWLEDGE_RELATIONS_SCHEMA, selector.canonical_item_id);
        currentWhere.push(`metadata #>> '{${KNOWLEDGE_RELATIONS_METADATA_KEY},schema}' = $${bindingParams.length - 1}`, `metadata #>> '{${KNOWLEDGE_RELATIONS_METADATA_KEY},canonical_item_id}' = $${bindingParams.length}`);
        matchedValue = selector.canonical_item_id;
        break;
      default:
        throw new HttpError(400, "private query selector kind is unsupported.");
    }
    const whereSql = `WHERE ${currentWhere.join(" AND ")}`;
    const totalRow = await this.client.get(`SELECT count(*)::text AS count FROM knowledge_items ${whereSql}`, bindingParams);
    const rows = await this.client.many(`SELECT * FROM knowledge_items
        ${whereSql}
        ${currentOrder}
        LIMIT ${page.limit} OFFSET ${page.offset}`, bindingParams);
    const total = Number(totalRow?.count ?? 0);
    const items = rows.map((row) => knowledgePrivateQueryItemProof(rowToItem(row), matchedValue));
    return {
      contract: KNOWLEDGE_GUARDED_WRITE_CONTRACT,
      exact: true,
      bounded: true,
      private: true,
      query_kind: selector.kind,
      status: "available",
      code: null,
      binding,
      selector_digest: selectorDigest,
      total,
      item_count: items.length,
      page: {
        limit: page.limit,
        offset: page.offset,
        returned: items.length,
        has_more: page.offset + items.length < total
      },
      items,
      limits
    };
  }
  async readback(fullId, binding, limits) {
    const row = await this.client.get(`SELECT * FROM knowledge_items
        WHERE id = $1
          AND authority_classification = $2
          AND authority_id = $3
          AND tenant_id = $4
          AND scope = $5
          AND parent_id = $6
        LIMIT 1`, [
      fullId,
      binding.authority.classification,
      binding.authority.authority_id,
      binding.tenant_id,
      binding.scope,
      binding.parent_id
    ]);
    if (!row)
      return null;
    return {
      contract: KNOWLEDGE_GUARDED_WRITE_CONTRACT,
      exact: true,
      bounded: true,
      item_count: 1,
      binding,
      item: rowToItem(row),
      limits
    };
  }
}

class PrivateTitleLookupAmbiguousError extends Error {
  constructor() {
    super("more than one exact title exists in the frozen binding.");
    this.name = "PrivateTitleLookupAmbiguousError";
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
      updated_at: { type: "string" },
      version: { type: "integer", description: "Current entry version; send it back as If-Match to write safely." }
    },
    required: ["id", "title", "content", "tags", "archived", "created_at", "updated_at", "version"]
  };
  const noteVersionSchema = {
    type: "object",
    description: "An immutable snapshot of the entry as it stood BEFORE the edit that produced the next version.",
    properties: {
      id: { type: "string" },
      item_id: { type: "string" },
      tenant_id: { type: "string", nullable: true },
      version: { type: "integer" },
      title: { type: "string" },
      content: { type: "string", nullable: true },
      body_uri: { type: "string", nullable: true },
      content_hash: { type: "string" },
      content_bytes: { type: "integer" },
      url: { type: "string", nullable: true },
      tags: { type: "array", items: { type: "string" } },
      metadata: { type: "object", additionalProperties: true },
      archived: { type: "boolean" },
      actor: { type: "string", nullable: true },
      reason: { type: "string", nullable: true },
      valid_from: { type: "string", nullable: true },
      valid_to: { type: "string" }
    },
    required: ["id", "item_id", "version", "title", "content_hash", "content_bytes", "tags", "archived", "valid_to"]
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
      archived: { type: "boolean" },
      expected_version: {
        type: "integer",
        description: "Optimistic concurrency guard, equivalent to the If-Match header, for clients that cannot set headers. " + "The write applies only if the stored entry is still at this version; otherwise 409 version_conflict."
      }
    }
  };
  const versionConflict = {
    type: "object",
    properties: {
      error: { type: "string", enum: ["version_conflict"] },
      expected: { type: "integer" },
      current: { type: "integer" }
    },
    required: ["error", "expected", "current"]
  };
  const guardedReceipt = {
    type: "object",
    description: "Immutable FCAME-1 terminal receipt. Private payload bytes are never stored here.",
    properties: {
      contract: { type: "string", enum: [KNOWLEDGE_GUARDED_WRITE_CONTRACT] },
      receipt_id: { type: "string" },
      deterministic_key: { type: "string" },
      operation_id: { type: "string" },
      step_id: { type: "string" },
      status: { type: "string", enum: ["accepted", "rejected"] },
      code: { type: "string" },
      effect_count: { type: "integer", enum: [0, 1] },
      result_id: { type: "string", nullable: true },
      result_version: { type: "integer", nullable: true },
      created_at: { type: "string" }
    },
    required: [
      "contract",
      "receipt_id",
      "deterministic_key",
      "operation_id",
      "step_id",
      "status",
      "code",
      "effect_count",
      "created_at"
    ]
  };
  const guardedAdoptionReceipt = {
    type: "object",
    description: "Immutable FCAME-1 receipt for an exact legacy binding adoption or its receipt-scoped rollback.",
    properties: {
      contract: { type: "string", enum: [KNOWLEDGE_GUARDED_WRITE_CONTRACT] },
      receipt_id: { type: "string" },
      deterministic_key: { type: "string" },
      action: { type: "string", enum: ["adopt", "rollback"] },
      operation_id: { type: "string" },
      step_id: { type: "string" },
      target_id: { type: "string" },
      expected_version: { type: "integer" },
      expected_content_sha256: { type: "string" },
      adoption_receipt_id: { type: "string", nullable: true },
      prior_tenant_id: { type: "string", nullable: true },
      status: { type: "string", enum: ["accepted", "rejected"] },
      code: { type: "string" },
      effect_count: { type: "integer", enum: [0, 1] },
      result_version: { type: "integer", nullable: true },
      result_content_sha256: { type: "string", nullable: true },
      created_at: { type: "string" }
    },
    required: [
      "contract",
      "receipt_id",
      "deterministic_key",
      "action",
      "operation_id",
      "step_id",
      "target_id",
      "expected_version",
      "expected_content_sha256",
      "status",
      "code",
      "effect_count",
      "created_at"
    ]
  };
  const guardedLimitParameters = [
    "max_calls",
    "max_items",
    "max_bytes",
    "wall_time_ms"
  ].map((name) => ({
    name,
    in: "query",
    required: true,
    schema: { type: "integer", minimum: 1 }
  }));
  const guardedBindingParameters = [
    "authority_classification",
    "authority_id",
    "tenant_id",
    "scope",
    "parent_id"
  ].map((name) => ({
    name,
    in: "query",
    required: true,
    schema: { type: "string" }
  }));
  return {
    openapi: "3.0.3",
    info: { title: "Knowledge", version, description: "@hasna/knowledge self-hosted HTTP API" },
    components: {
      securitySchemes: { apiKey: { type: "apiKey", in: "header", name: "x-api-key" } },
      schemas: {
        Note: noteSchema,
        NoteInput: noteInput,
        NotePatch: notePatch,
        NoteVersion: noteVersionSchema,
        VersionConflict: versionConflict,
        GuardedReceipt: guardedReceipt,
        GuardedAdoptionReceipt: guardedAdoptionReceipt,
        GuardedAdoptionEnvelope: {
          type: "object",
          description: "Exact full-ID, version, and raw UTF-8 content-sha256 compare-and-swap for legacy binding adoption " + "or immutable-receipt-scoped rollback.",
          required: [
            "contract",
            "action",
            "deterministic_key",
            "operation_id",
            "step_id",
            "target_id",
            "binding",
            "expected_version",
            "expected_content_sha256",
            "adoption_receipt_id",
            "limits"
          ],
          additionalProperties: false
        },
        GuardedWriteEnvelope: {
          type: "object",
          description: "FCAME-1 frozen descriptor metadata, deterministic key, explicit finite limits, and private payload. " + "The payload is accepted only in this authenticated request body.",
          required: ["contract", "descriptor", "deterministic_key", "limits", "payload"],
          additionalProperties: true
        },
        GuardedManifest: {
          type: "object",
          description: "Immutable ordered workflow manifest. Every step declares deterministic forward repair or " + "accepted-receipt-scoped compensation.",
          required: [
            "manifest_receipt_id",
            "manifest_id",
            "operation_id",
            "deterministic_key",
            "manifest_digest",
            "maintainer",
            "step_count",
            "steps",
            "created_at"
          ],
          additionalProperties: true
        },
        NoteList: {
          type: "object",
          properties: {
            items: { type: "array", items: { $ref: "#/components/schemas/Note" } },
            total: { type: "integer" }
          },
          required: ["items", "total"]
        },
        NoteSearchList: {
          type: "object",
          properties: {
            items: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  item: { $ref: "#/components/schemas/Note" },
                  rank: { type: "number" }
                },
                required: ["item", "rank"]
              }
            },
            total: { type: "integer" }
          },
          required: ["items", "total"]
        },
        NoteVersionList: {
          type: "object",
          properties: {
            item_id: { type: "string" },
            current_version: { type: "integer" },
            total: { type: "integer" },
            items: { type: "array", items: { $ref: "#/components/schemas/NoteVersion" } }
          },
          required: ["item_id", "current_version", "total", "items"]
        }
      }
    },
    security: [{ apiKey: [] }],
    paths: {
      "/v1/notes": {
        get: {
          operationId: "listNotes",
          summary: "List knowledge items with literal filters and bounded paging",
          parameters: [
            { name: "limit", in: "query", schema: { type: "integer" } },
            { name: "offset", in: "query", schema: { type: "integer" } },
            { name: "filter", in: "query", schema: { type: "string" } },
            {
              name: "tags",
              in: "query",
              style: "form",
              explode: true,
              schema: { type: "array", items: { type: "string" } }
            },
            { name: "archive", in: "query", schema: { type: "string", enum: ["active", "archived", "all"] } },
            { name: "sort", in: "query", schema: { type: "string", enum: ["created", "title"] } },
            { name: "direction", in: "query", schema: { type: "string", enum: ["asc", "desc"] } }
          ],
          responses: {
            "200": {
              content: {
                "application/json": { schema: { $ref: "#/components/schemas/NoteList" } }
              }
            }
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
      "/v1/notes/search": {
        get: {
          operationId: "searchNotes",
          summary: "Ranked PostgreSQL full-text query with bounded paging",
          parameters: [
            { name: "q", in: "query", required: true, schema: { type: "string" } },
            { name: "limit", in: "query", schema: { type: "integer" } },
            { name: "offset", in: "query", schema: { type: "integer" } },
            { name: "archive", in: "query", schema: { type: "string", enum: ["active", "archived", "all"] } }
          ],
          responses: {
            "200": {
              content: {
                "application/json": { schema: { $ref: "#/components/schemas/NoteSearchList" } }
              }
            }
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
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
            {
              name: "If-Match",
              in: "header",
              required: false,
              schema: { type: "string" },
              description: "Optimistic concurrency guard: the version the client last read. The write applies only if the " + "stored entry is still at that version, otherwise 409 version_conflict. Optional in this phase so " + 'already-installed clients keep working; `*` means "any existing version".'
            }
          ],
          requestBody: {
            required: true,
            content: { "application/json": { schema: { $ref: "#/components/schemas/NotePatch" } } }
          },
          responses: {
            "200": { content: { "application/json": { schema: { $ref: "#/components/schemas/Note" } } } },
            "409": {
              description: "The stored entry moved on; nothing was written.",
              content: { "application/json": { schema: { $ref: "#/components/schemas/VersionConflict" } } }
            }
          }
        },
        delete: {
          operationId: "deleteNote",
          summary: "Delete a knowledge item",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: { "204": {} }
        }
      },
      "/v1/notes/{id}/versions": {
        get: {
          operationId: "listNoteVersions",
          summary: "List prior versions of a knowledge item (newest first)",
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
            { name: "limit", in: "query", schema: { type: "integer" } },
            { name: "offset", in: "query", schema: { type: "integer" } }
          ],
          responses: {
            "200": { content: { "application/json": { schema: { $ref: "#/components/schemas/NoteVersionList" } } } },
            "404": { description: "No such entry. An entry that exists but was never edited returns 200 with an empty list." }
          }
        }
      },
      "/v1/notes/{id}/versions/{version}": {
        get: {
          operationId: "getNoteVersion",
          summary: "Fetch one prior version of a knowledge item",
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
            { name: "version", in: "path", required: true, schema: { type: "integer" } }
          ],
          responses: {
            "200": { content: { "application/json": { schema: { $ref: "#/components/schemas/NoteVersion" } } } },
            "404": { description: "No such entry, or no such version of it." }
          }
        }
      },
      "/v1/guarded-writes": {
        post: {
          operationId: "executeGuardedKnowledgeWrite",
          summary: "Execute one FCAME-1 create-if-absent or compare-and-swap write",
          description: "Requires x-knowledge-tenant-id, Idempotency-Key, and the four x-knowledge-* bound headers. " + "The server stores one immutable terminal receipt and never falls back to local or raw storage.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/GuardedWriteEnvelope" }
              }
            }
          },
          responses: {
            "201": { description: "Accepted with one immutable receipt." },
            "200": { description: "Same deterministic operation already accepted; duplicate proof returned." },
            "409": { description: "Terminal rejection or operation/step binding conflict." }
          }
        }
      },
      "/v1/guarded-writes/lookups/title": {
        post: {
          operationId: "lookupGuardedKnowledgeTitle",
          summary: "Bounded exact-title lookup under one frozen FCAME-1 binding",
          description: "Returns zero or one metadata-only item proof. More than one exact title is an ambiguity error; " + "item bodies and titles are never returned.",
          responses: {
            "200": { description: "Exact bounded metadata-only result containing zero or one item proof." },
            "409": { description: "More than one exact title exists under the frozen binding." }
          }
        }
      },
      "/v1/guarded-adoptions": {
        post: {
          operationId: "executeGuardedKnowledgeAdoption",
          summary: "Adopt one exact legacy row or roll it back through its immutable adoption receipt",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/GuardedAdoptionEnvelope" }
              }
            }
          },
          responses: {
            "201": { description: "Accepted with one immutable adoption receipt." },
            "200": { description: "Exact deterministic replay; no second effect." },
            "409": { description: "Terminal CAS/binding rejection or operation binding conflict." }
          }
        }
      },
      "/v1/guarded-adoptions/receipts/{deterministicKey}": {
        get: {
          operationId: "reconcileGuardedKnowledgeAdoption",
          summary: "Bounded exact adoption-receipt reconciliation",
          parameters: [
            {
              name: "deterministicKey",
              in: "path",
              required: true,
              schema: { type: "string" }
            },
            ...guardedBindingParameters,
            { name: "operation_id", in: "query", required: true, schema: { type: "string" } },
            { name: "step_id", in: "query", required: true, schema: { type: "string" } },
            ...guardedLimitParameters
          ],
          responses: {
            "200": { description: "Exact bounded result containing zero or one immutable receipt." }
          }
        }
      },
      "/v1/guarded-adoptions/items/{id}/binding-state": {
        get: {
          operationId: "readGuardedKnowledgeBindingState",
          summary: "Exact bounded stored-binding-state readback for a full Knowledge id",
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
            ...guardedBindingParameters,
            ...guardedLimitParameters
          ],
          responses: {
            "200": {
              description: "legacy_unbound, bound_to_requested, or bound_elsewhere; elsewhere does not disclose version/hash."
            },
            "404": { description: "No exact full-ID row." }
          }
        }
      },
      "/v1/guarded-writes/queries": {
        post: {
          operationId: "queryGuardedKnowledge",
          summary: "Bounded private Knowledge query under one frozen FCAME-1 binding",
          description: "The raw selector exists only in this authenticated request body. " + "The response contains hashes, versions, page evidence, and no raw selector or item id.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["contract", "descriptor", "selector", "limits"],
                  additionalProperties: false
                }
              }
            }
          },
          responses: {
            "200": { description: "Exact bounded private result or typed semantic unavailability." },
            "400": { description: "Descriptor, selector, binding digest, page, or bounds mismatch." }
          }
        }
      },
      "/v1/guarded-writes/receipts/{deterministicKey}": {
        get: {
          operationId: "reconcileGuardedKnowledgeWrite",
          summary: "Bounded exact terminal-receipt reconciliation",
          parameters: [
            {
              name: "deterministicKey",
              in: "path",
              required: true,
              schema: { type: "string" }
            },
            ...guardedBindingParameters,
            { name: "operation_id", in: "query", required: true, schema: { type: "string" } },
            { name: "step_id", in: "query", required: true, schema: { type: "string" } },
            ...guardedLimitParameters
          ],
          responses: {
            "200": {
              description: "Exact bounded result containing zero or one terminal receipt and completeness."
            }
          }
        }
      },
      "/v1/guarded-writes/items/{id}": {
        get: {
          operationId: "readbackGuardedKnowledgeItem",
          summary: "Exact full-ID readback under the frozen binding",
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
            ...guardedBindingParameters,
            ...guardedLimitParameters
          ],
          responses: {
            "200": { description: "Exactly one full-ID and binding match." },
            "404": { description: "No exact full-ID and binding match." }
          }
        }
      },
      "/v1/guarded-manifests": {
        post: {
          operationId: "createGuardedKnowledgeManifest",
          summary: "Create an immutable ordered FCAME-1 workflow manifest before step zero",
          responses: {
            "201": { description: "Manifest created." },
            "200": { description: "Exact manifest replay; duplicate proof returned." },
            "409": { description: "manifest_id is already bound to different semantics." }
          }
        }
      },
      "/v1/guarded-manifests/{manifestId}": {
        get: {
          operationId: "reconcileGuardedKnowledgeManifest",
          summary: "Derive bounded workflow completeness from immutable authority receipts",
          description: "External-authority steps remain unverified and keep terminal_complete false until that authority " + "provides a verifiable receipt path.",
          parameters: [
            { name: "manifestId", in: "path", required: true, schema: { type: "string" } },
            ...guardedBindingParameters,
            ...guardedLimitParameters
          ],
          responses: {
            "200": { description: "Manifest plus per-step receipt state and any unsupported authority gap." },
            "404": { description: "No exact manifest and maintainer binding match." }
          }
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
function boundedJson(body, status, bounds, startedAt) {
  if (Date.now() - startedAt > bounds.wall_time_ms) {
    throw new HttpError(408, "guarded phase exceeded its producer wall-time cap.");
  }
  const encoded = JSON.stringify(body);
  if (Buffer.byteLength(encoded, "utf8") > bounds.max_bytes) {
    throw new HttpError(413, "guarded phase response exceeds its producer byte cap.");
  }
  return new Response(encoded, {
    status,
    headers: { "content-type": "application/json" }
  });
}
function parsePositiveInteger(value, field) {
  const parsed = Number(value);
  if (!value || !Number.isInteger(parsed) || parsed < 1) {
    throw new HttpError(400, `${field} must be a positive integer.`);
  }
  return parsed;
}
function guardedBoundsFromHeaders(req) {
  const bounds = {
    max_calls: parsePositiveInteger(req.headers.get("x-knowledge-max-calls"), "x-knowledge-max-calls"),
    max_items: parsePositiveInteger(req.headers.get("x-knowledge-max-items"), "x-knowledge-max-items"),
    max_bytes: parsePositiveInteger(req.headers.get("x-knowledge-max-bytes"), "x-knowledge-max-bytes"),
    wall_time_ms: parsePositiveInteger(req.headers.get("x-knowledge-wall-time-ms"), "x-knowledge-wall-time-ms")
  };
  try {
    assertKnowledgeGuardedBounds(bounds);
  } catch (error) {
    throw new HttpError(400, error instanceof Error ? error.message : "invalid guarded bounds.");
  }
  return bounds;
}
function privateQueryBoundsFromHeaders(req) {
  const bounds = {
    max_calls: parsePositiveInteger(req.headers.get("x-knowledge-max-calls"), "x-knowledge-max-calls"),
    max_items: parsePositiveInteger(req.headers.get("x-knowledge-max-items"), "x-knowledge-max-items"),
    max_bytes: parsePositiveInteger(req.headers.get("x-knowledge-max-bytes"), "x-knowledge-max-bytes"),
    wall_time_ms: parsePositiveInteger(req.headers.get("x-knowledge-wall-time-ms"), "x-knowledge-wall-time-ms")
  };
  try {
    assertKnowledgePrivateQueryBounds(bounds);
  } catch (error) {
    throw new HttpError(400, error instanceof Error ? error.message : "invalid private query bounds.");
  }
  return bounds;
}
function guardedBoundsFromQuery(req, url) {
  const fromHeaders = guardedBoundsFromHeaders(req);
  const fromQuery = {
    max_calls: parsePositiveInteger(url.searchParams.get("max_calls"), "max_calls"),
    max_items: parsePositiveInteger(url.searchParams.get("max_items"), "max_items"),
    max_bytes: parsePositiveInteger(url.searchParams.get("max_bytes"), "max_bytes"),
    wall_time_ms: parsePositiveInteger(url.searchParams.get("wall_time_ms"), "wall_time_ms")
  };
  if (canonicalKnowledgeGuardedJson(fromHeaders) !== canonicalKnowledgeGuardedJson(fromQuery)) {
    throw new HttpError(400, "guarded query bounds must exactly match the bound headers.");
  }
  return fromHeaders;
}
async function readBoundedJson(req, bounds, startedAt) {
  if (!req.body)
    throw new HttpError(400, "guarded write body is required.");
  const reader = req.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const remaining = bounds.wall_time_ms - (Date.now() - startedAt);
      if (remaining <= 0)
        throw new HttpError(408, "guarded request exceeded its producer wall-time cap.");
      let timer;
      const result = await Promise.race([
        reader.read(),
        new Promise((_resolve, reject) => {
          timer = setTimeout(() => reject(new HttpError(408, "guarded request exceeded its producer wall-time cap.")), remaining);
        })
      ]).finally(() => {
        if (timer)
          clearTimeout(timer);
      });
      if (result.done)
        break;
      total += result.value.byteLength;
      if (total > bounds.max_bytes) {
        throw new HttpError(413, "guarded request exceeds its producer byte cap.");
      }
      chunks.push(result.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new HttpError(400, "guarded request body must be valid JSON.");
  }
}
function guardedBindingFromQuery(url) {
  const binding = {
    authority: {
      classification: url.searchParams.get("authority_classification"),
      authority_id: url.searchParams.get("authority_id")
    },
    tenant_id: url.searchParams.get("tenant_id"),
    scope: url.searchParams.get("scope"),
    parent_id: url.searchParams.get("parent_id")
  };
  try {
    assertKnowledgeGuardedBinding(binding);
  } catch (error) {
    throw new HttpError(400, error instanceof Error ? error.message : "invalid guarded binding.");
  }
  return binding;
}
function assertConfiguredAuthority(binding, authority) {
  if (binding.authority.classification !== authority.classification || binding.authority.authority_id !== authority.authority_id) {
    throw new HttpError(403, "guarded write authority does not match this service authority.");
  }
}
function assertExactRequestKeys(value, field, expected) {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (canonicalKnowledgeGuardedJson(actual) !== canonicalKnowledgeGuardedJson(wanted)) {
    throw new Error(`${field} keys do not match the FCAME-1 request schema.`);
  }
}
function validateGuardedEnvelope(value, headerBounds, authority, idempotencyKey) {
  try {
    if (!value || typeof value !== "object")
      throw new Error("guarded write envelope is required.");
    const envelope = value;
    assertExactRequestKeys(value, "guarded write envelope", ["contract", "descriptor", "deterministic_key", "limits", "payload"]);
    const descriptor = envelope.descriptor;
    if (envelope.contract !== KNOWLEDGE_GUARDED_WRITE_CONTRACT) {
      throw new Error("unsupported guarded-write contract.");
    }
    if (!descriptor || descriptor.contract !== KNOWLEDGE_GUARDED_WRITE_CONTRACT || descriptor.schema !== KNOWLEDGE_PRIVATE_INPUT_SCHEMA) {
      throw new Error("invalid private input descriptor schema.");
    }
    assertExactRequestKeys(descriptor, "private input descriptor", [
      "contract",
      "schema",
      "descriptor_id",
      "operation_id",
      "step_id",
      "verb",
      "target_id",
      "payload_digest",
      "binding_digest",
      "precondition",
      "binding",
      "manifest",
      "expires_at"
    ]);
    if (typeof descriptor.descriptor_id !== "string" || descriptor.descriptor_id.length === 0) {
      throw new Error("private input descriptor id is required.");
    }
    const descriptorExpiresAt = Date.parse(descriptor.expires_at);
    const descriptorNow = Date.now();
    if (!Number.isFinite(descriptorExpiresAt) || descriptorExpiresAt <= descriptorNow || descriptorExpiresAt > descriptorNow + 60 * 60 * 1000) {
      throw new Error("private input descriptor is expired or malformed.");
    }
    assertKnowledgeGuardedBinding(descriptor.binding);
    assertConfiguredAuthority(descriptor.binding, authority);
    assertKnowledgeGuardedPrecondition(descriptor.verb, descriptor.precondition);
    assertKnowledgeGuardedPayload(descriptor.verb, envelope.payload);
    if ("metadata" in envelope.payload && envelope.payload.metadata) {
      assertKnowledgeRelationsMetadata(envelope.payload.metadata, descriptor.target_id);
    }
    const limits = normalizeKnowledgeGuardedLimits(envelope.limits);
    if (canonicalKnowledgeGuardedJson(limits) !== canonicalKnowledgeGuardedJson(envelope.limits)) {
      throw new Error("guarded-write limits must be explicit and complete.");
    }
    if (canonicalKnowledgeGuardedJson(limits.submission) !== canonicalKnowledgeGuardedJson(headerBounds)) {
      throw new Error("submission limits must exactly match the producer bound headers.");
    }
    const payloadDigest = knowledgeGuardedDigest(envelope.payload);
    if (payloadDigest !== descriptor.payload_digest) {
      throw new Error("private payload digest does not match the frozen descriptor.");
    }
    const bindingDigest = knowledgeGuardedDigest({
      binding: descriptor.binding,
      operation_id: descriptor.operation_id,
      step_id: descriptor.step_id,
      verb: descriptor.verb,
      target_id: descriptor.target_id,
      precondition: descriptor.precondition,
      payload_digest: descriptor.payload_digest,
      manifest: descriptor.manifest
    });
    if (bindingDigest !== descriptor.binding_digest) {
      throw new Error("private descriptor binding digest does not match.");
    }
    const expectedKey = computeKnowledgeGuardedDeterministicKey({
      binding: descriptor.binding,
      operation_id: descriptor.operation_id,
      step_id: descriptor.step_id,
      verb: descriptor.verb,
      target_id: descriptor.target_id,
      payload_digest: descriptor.payload_digest,
      precondition: descriptor.precondition,
      manifest: descriptor.manifest
    });
    if (envelope.deterministic_key !== expectedKey || idempotencyKey !== expectedKey) {
      throw new Error("deterministic key must match both the frozen tuple and Idempotency-Key.");
    }
    if (knowledgeGuardedUtf8Bytes(envelope) > headerBounds.max_bytes) {
      throw new Error("guarded write envelope exceeds the producer byte cap.");
    }
    return envelope;
  } catch (error) {
    if (error instanceof HttpError)
      throw error;
    throw new HttpError(400, error instanceof Error ? error.message : "invalid guarded write envelope.");
  }
}
function validatePrivateTitleLookupEnvelope(value, headerBounds, authority) {
  try {
    if (!value || typeof value !== "object") {
      throw new Error("private title lookup envelope is required.");
    }
    const envelope = value;
    assertExactRequestKeys(value, "private title lookup envelope", ["contract", "descriptor", "title", "limits"]);
    if (envelope.contract !== KNOWLEDGE_GUARDED_WRITE_CONTRACT) {
      throw new Error("unsupported guarded-write contract.");
    }
    const descriptor = envelope.descriptor;
    if (!descriptor || descriptor.contract !== KNOWLEDGE_GUARDED_WRITE_CONTRACT || descriptor.schema !== KNOWLEDGE_PRIVATE_TITLE_LOOKUP_SCHEMA) {
      throw new Error("invalid private title lookup descriptor schema.");
    }
    assertExactRequestKeys(descriptor, "private title lookup descriptor", [
      "contract",
      "schema",
      "operation_id",
      "step_id",
      "title_digest",
      "binding_digest",
      "binding",
      "expires_at"
    ]);
    if (typeof descriptor.operation_id !== "string" || descriptor.operation_id.length === 0 || typeof descriptor.step_id !== "string" || descriptor.step_id.length === 0 || typeof envelope.title !== "string" || envelope.title.length === 0 || envelope.title.length > 2048) {
      throw new Error("private title lookup operation, step, and bounded title are required.");
    }
    const descriptorExpiresAt = Date.parse(descriptor.expires_at);
    const descriptorNow = Date.now();
    if (!Number.isFinite(descriptorExpiresAt) || descriptorExpiresAt <= descriptorNow || descriptorExpiresAt > descriptorNow + 60 * 60 * 1000) {
      throw new Error("private title lookup descriptor is expired or malformed.");
    }
    assertKnowledgeGuardedBinding(descriptor.binding);
    assertConfiguredAuthority(descriptor.binding, authority);
    assertKnowledgeGuardedBounds(envelope.limits, "private title lookup bounds");
    if (canonicalKnowledgeGuardedJson(envelope.limits) !== canonicalKnowledgeGuardedJson(headerBounds)) {
      throw new Error("private title lookup limits must exactly match the producer bound headers.");
    }
    const titleDigest = knowledgeGuardedContentSha256(envelope.title);
    if (titleDigest !== descriptor.title_digest) {
      throw new Error("private title lookup digest does not match the frozen descriptor.");
    }
    const bindingDigest = knowledgeGuardedDigest({
      binding: descriptor.binding,
      operation_id: descriptor.operation_id,
      step_id: descriptor.step_id,
      title_digest: descriptor.title_digest
    });
    if (bindingDigest !== descriptor.binding_digest) {
      throw new Error("private title lookup binding digest does not match.");
    }
    if (knowledgeGuardedUtf8Bytes(envelope) > headerBounds.max_bytes) {
      throw new Error("private title lookup envelope exceeds the producer byte cap.");
    }
    return envelope;
  } catch (error) {
    if (error instanceof HttpError)
      throw error;
    throw new HttpError(400, error instanceof Error ? error.message : "invalid private title lookup envelope.");
  }
}
function validatePrivateQueryEnvelope(value, headerBounds, authority) {
  try {
    if (!value || typeof value !== "object") {
      throw new Error("private query envelope is required.");
    }
    const envelope = value;
    assertExactRequestKeys(value, "private query envelope", ["contract", "descriptor", "selector", "limits"]);
    if (envelope.contract !== KNOWLEDGE_GUARDED_WRITE_CONTRACT) {
      throw new Error("unsupported guarded-write contract.");
    }
    const descriptor = envelope.descriptor;
    if (!descriptor || descriptor.contract !== KNOWLEDGE_GUARDED_WRITE_CONTRACT || descriptor.schema !== KNOWLEDGE_PRIVATE_QUERY_SCHEMA) {
      throw new Error("invalid private query descriptor schema.");
    }
    assertExactRequestKeys(descriptor, "private query descriptor", [
      "contract",
      "schema",
      "operation_id",
      "step_id",
      "query_kind",
      "selector_digest",
      "binding_digest",
      "binding",
      "archive",
      "page",
      "expires_at"
    ]);
    if (typeof descriptor.operation_id !== "string" || descriptor.operation_id.length === 0 || typeof descriptor.step_id !== "string" || descriptor.step_id.length === 0 || !["active", "archived", "all"].includes(descriptor.archive)) {
      throw new Error("private query operation, step, and archive mode are required.");
    }
    const descriptorExpiresAt = Date.parse(descriptor.expires_at);
    const descriptorNow = Date.now();
    if (!Number.isFinite(descriptorExpiresAt) || descriptorExpiresAt <= descriptorNow || descriptorExpiresAt > descriptorNow + 60 * 60 * 1000) {
      throw new Error("private query descriptor is expired or malformed.");
    }
    assertKnowledgeGuardedBinding(descriptor.binding);
    assertConfiguredAuthority(descriptor.binding, authority);
    assertKnowledgePrivateQueryBounds(envelope.limits);
    assertKnowledgePrivateQueryPage(descriptor.page, envelope.limits);
    if (canonicalKnowledgeGuardedJson(envelope.limits) !== canonicalKnowledgeGuardedJson(headerBounds)) {
      throw new Error("private query limits must exactly match the producer bound headers.");
    }
    assertKnowledgePrivateQuerySelector(envelope.selector);
    if (envelope.selector.kind !== descriptor.query_kind) {
      throw new Error("private query selector kind does not match the frozen descriptor.");
    }
    const selectorDigest = knowledgeGuardedDigest(envelope.selector);
    if (selectorDigest !== descriptor.selector_digest) {
      throw new Error("private query selector digest does not match the frozen descriptor.");
    }
    const bindingDigest = knowledgeGuardedDigest({
      binding: descriptor.binding,
      operation_id: descriptor.operation_id,
      step_id: descriptor.step_id,
      query_kind: descriptor.query_kind,
      selector_digest: descriptor.selector_digest,
      archive: descriptor.archive,
      page: descriptor.page
    });
    if (bindingDigest !== descriptor.binding_digest) {
      throw new Error("private query binding digest does not match.");
    }
    if (knowledgeGuardedUtf8Bytes(envelope) > headerBounds.max_bytes) {
      throw new Error("private query envelope exceeds the producer byte cap.");
    }
    return envelope;
  } catch (error) {
    if (error instanceof HttpError)
      throw error;
    throw new HttpError(400, error instanceof Error ? error.message : "invalid private query envelope.");
  }
}
function validateGuardedAdoptionEnvelope(value, headerBounds, authority, idempotencyKey) {
  try {
    if (!value || typeof value !== "object") {
      throw new Error("guarded adoption envelope is required.");
    }
    const envelope = value;
    assertExactRequestKeys(value, "guarded adoption envelope", [
      "contract",
      "action",
      "deterministic_key",
      "operation_id",
      "step_id",
      "target_id",
      "binding",
      "expected_version",
      "expected_content_sha256",
      "adoption_receipt_id",
      "limits"
    ]);
    if (envelope.contract !== KNOWLEDGE_GUARDED_WRITE_CONTRACT) {
      throw new Error("unsupported guarded adoption contract.");
    }
    assertKnowledgeGuardedBinding(envelope.binding);
    assertConfiguredAuthority(envelope.binding, authority);
    const limits = normalizeKnowledgeGuardedLimits(envelope.limits);
    if (canonicalKnowledgeGuardedJson(limits) !== canonicalKnowledgeGuardedJson(envelope.limits)) {
      throw new Error("guarded-adoption limits must be explicit and complete.");
    }
    if (canonicalKnowledgeGuardedJson(limits.submission) !== canonicalKnowledgeGuardedJson(headerBounds)) {
      throw new Error("adoption submission limits must exactly match the producer bound headers.");
    }
    const expectedKey = computeKnowledgeGuardedAdoptionDeterministicKey({
      action: envelope.action,
      operation_id: envelope.operation_id,
      step_id: envelope.step_id,
      target_id: envelope.target_id,
      binding: envelope.binding,
      expected_version: envelope.expected_version,
      expected_content_sha256: envelope.expected_content_sha256,
      adoption_receipt_id: envelope.adoption_receipt_id
    });
    if (envelope.deterministic_key !== expectedKey || idempotencyKey !== expectedKey) {
      throw new Error("adoption deterministic key must match both the exact tuple and Idempotency-Key.");
    }
    if (knowledgeGuardedUtf8Bytes(envelope) > headerBounds.max_bytes) {
      throw new Error("guarded adoption envelope exceeds the producer byte cap.");
    }
    return envelope;
  } catch (error) {
    if (error instanceof HttpError)
      throw error;
    throw new HttpError(400, error instanceof Error ? error.message : "invalid guarded adoption envelope.");
  }
}
function validateGuardedManifestEnvelope(value, bounds, authority, idempotencyKey) {
  try {
    if (!value || typeof value !== "object")
      throw new Error("guarded manifest envelope is required.");
    const envelope = value;
    assertExactRequestKeys(value, "guarded manifest envelope", ["contract", "maintainer", "manifest", "deterministic_key"]);
    if (envelope.contract !== KNOWLEDGE_GUARDED_WRITE_CONTRACT) {
      throw new Error("unsupported guarded manifest contract.");
    }
    assertKnowledgeGuardedBinding(envelope.maintainer);
    assertConfiguredAuthority(envelope.maintainer, authority);
    assertKnowledgeGuardedManifestOptions(envelope.maintainer, envelope.manifest);
    const expectedKey = computeKnowledgeGuardedManifestDeterministicKey(envelope.maintainer, envelope.manifest);
    if (envelope.deterministic_key !== expectedKey || idempotencyKey !== expectedKey) {
      throw new Error("manifest deterministic key must match both the frozen tuple and Idempotency-Key.");
    }
    if (knowledgeGuardedUtf8Bytes(envelope) > bounds.max_bytes) {
      throw new Error("guarded manifest exceeds the producer byte cap.");
    }
    return envelope;
  } catch (error) {
    if (error instanceof HttpError)
      throw error;
    throw new HttpError(400, error instanceof Error ? error.message : "invalid guarded manifest envelope.");
  }
}
function principalActor(principal) {
  return principal.agent ? `agent:${principal.agent}` : `key:${principal.kid}`;
}
function parseExpectedVersion(req, body) {
  const header = req.headers.get("if-match");
  if (header != null && header.trim() !== "" && header.trim() !== "*") {
    const cleaned = header.trim().replace(/^W\//i, "").replace(/^"(.*)"$/, "$1");
    const parsed2 = Number(cleaned);
    if (!Number.isInteger(parsed2) || parsed2 < 1) {
      throw new HttpError(400, `If-Match must be an entry version number (got ${header}).`);
    }
    return parsed2;
  }
  const fromBody = body.expected_version;
  if (fromBody === undefined || fromBody === null)
    return;
  const parsed = Number(fromBody);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new HttpError(400, "expected_version must be a positive integer entry version.");
  }
  return parsed;
}
function createServeHandler(deps) {
  const repo = new NoteRepo(deps.client);
  const guardedRepo = deps.guardedAuthority ? new GuardedWriteRepo(deps.client, deps.guardedAuthority) : null;
  const mode2 = "postgres";
  const authOrThrow = async (req, requiredScopes, expectedTid) => {
    const url = new URL(req.url);
    const decision = await deps.verifier.authenticate(req.headers, {
      method: req.method,
      path: url.pathname,
      requiredScopes,
      ...expectedTid !== undefined ? { expectedTid } : {}
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
      if (path === "/v1/guarded-manifests" && method === "POST") {
        if (!guardedRepo) {
          return json({ error: "guarded_authority_unconfigured" }, 503);
        }
        const startedAt = Date.now();
        const tenantId = req.headers.get("x-knowledge-tenant-id");
        if (!tenantId)
          throw new HttpError(400, "x-knowledge-tenant-id is required.");
        await authOrThrow(req, ["knowledge:write"], tenantId);
        const bounds = guardedBoundsFromHeaders(req);
        const raw = await readBoundedJson(req, bounds, startedAt);
        const envelope = validateGuardedManifestEnvelope(raw, bounds, guardedRepo.authority, req.headers.get("idempotency-key"));
        if (envelope.maintainer.tenant_id !== tenantId) {
          throw new HttpError(403, "manifest tenant does not match the authenticated request tenant.");
        }
        try {
          const submission = await guardedRepo.createManifest(envelope);
          return boundedJson(submission, submission.duplicate ? 200 : 201, bounds, startedAt);
        } catch (error) {
          if (error instanceof ManifestBindingConflictError) {
            return boundedJson({
              error: "manifest_binding_conflict",
              manifest: error.manifest
            }, 409, bounds, startedAt);
          }
          throw error;
        }
      }
      const guardedManifestMatch = path.match(/^\/v1\/guarded-manifests\/([^/]+)$/);
      if (guardedManifestMatch) {
        if (method !== "GET")
          return json({ error: "method_not_allowed" }, 405);
        if (!guardedRepo)
          return json({ error: "guarded_authority_unconfigured" }, 503);
        const startedAt = Date.now();
        const binding = guardedBindingFromQuery(url);
        assertConfiguredAuthority(binding, guardedRepo.authority);
        await authOrThrow(req, ["knowledge:read"], binding.tenant_id);
        const bounds = guardedBoundsFromQuery(req, url);
        const reconciliation = await guardedRepo.reconcileManifest(decodeURIComponent(guardedManifestMatch[1]), binding, bounds);
        return reconciliation ? boundedJson(reconciliation, 200, bounds, startedAt) : boundedJson({ error: "not_found" }, 404, bounds, startedAt);
      }
      if (path === "/v1/guarded-adoptions" && method === "POST") {
        if (!guardedRepo) {
          return json({ error: "guarded_authority_unconfigured" }, 503);
        }
        const startedAt = Date.now();
        const tenantId = req.headers.get("x-knowledge-tenant-id");
        if (!tenantId)
          throw new HttpError(400, "x-knowledge-tenant-id is required.");
        const principal = await authOrThrow(req, ["knowledge:write"], tenantId);
        const bounds = guardedBoundsFromHeaders(req);
        const raw = await readBoundedJson(req, bounds, startedAt);
        const envelope = validateGuardedAdoptionEnvelope(raw, bounds, guardedRepo.authority, req.headers.get("idempotency-key"));
        if (envelope.binding.tenant_id !== tenantId) {
          throw new HttpError(403, "adoption tenant does not match the authenticated request tenant.");
        }
        try {
          const submission = await guardedRepo.executeAdoption(envelope, principalActor(principal));
          if (submission.receipt.status === "rejected") {
            if (submission.receipt.code === "not_found") {
              return boundedJson({ error: "not_found" }, 404, bounds, startedAt);
            }
            return boundedJson({ error: "guarded_adoption_rejected", ...submission }, 409, bounds, startedAt);
          }
          return boundedJson(submission, submission.duplicate ? 200 : 201, bounds, startedAt);
        } catch (error) {
          if (error instanceof AdoptionOperationBindingConflictError) {
            return boundedJson({
              error: "adoption_operation_conflict",
              receipt: error.receipt
            }, 409, bounds, startedAt);
          }
          throw error;
        }
      }
      const guardedAdoptionReceiptMatch = path.match(/^\/v1\/guarded-adoptions\/receipts\/([^/]+)$/);
      if (guardedAdoptionReceiptMatch) {
        if (method !== "GET")
          return json({ error: "method_not_allowed" }, 405);
        if (!guardedRepo)
          return json({ error: "guarded_authority_unconfigured" }, 503);
        const startedAt = Date.now();
        const binding = guardedBindingFromQuery(url);
        assertConfiguredAuthority(binding, guardedRepo.authority);
        await authOrThrow(req, ["knowledge:read"], binding.tenant_id);
        const bounds = guardedBoundsFromQuery(req, url);
        const operationId = url.searchParams.get("operation_id");
        const stepId = url.searchParams.get("step_id");
        if (!operationId || !stepId) {
          throw new HttpError(400, "operation_id and step_id are required for exact adoption reconciliation.");
        }
        const reconciliation = await guardedRepo.reconcileAdoption(decodeURIComponent(guardedAdoptionReceiptMatch[1]), binding, operationId, stepId, bounds);
        return boundedJson(reconciliation, 200, bounds, startedAt);
      }
      const guardedBindingStateMatch = path.match(/^\/v1\/guarded-adoptions\/items\/([^/]+)\/binding-state$/);
      if (guardedBindingStateMatch) {
        if (method !== "GET")
          return json({ error: "method_not_allowed" }, 405);
        if (!guardedRepo)
          return json({ error: "guarded_authority_unconfigured" }, 503);
        const startedAt = Date.now();
        const binding = guardedBindingFromQuery(url);
        assertConfiguredAuthority(binding, guardedRepo.authority);
        await authOrThrow(req, ["knowledge:read"], binding.tenant_id);
        const bounds = guardedBoundsFromQuery(req, url);
        const readback = await guardedRepo.bindingState(decodeURIComponent(guardedBindingStateMatch[1]), binding, bounds);
        return readback ? boundedJson(readback, 200, bounds, startedAt) : boundedJson({ error: "not_found" }, 404, bounds, startedAt);
      }
      if (path === "/v1/guarded-writes" && method === "POST") {
        if (!guardedRepo) {
          return json({ error: "guarded_authority_unconfigured" }, 503);
        }
        const startedAt = Date.now();
        const tenantId = req.headers.get("x-knowledge-tenant-id");
        if (!tenantId)
          throw new HttpError(400, "x-knowledge-tenant-id is required.");
        const principal = await authOrThrow(req, ["knowledge:write"], tenantId);
        const bounds = guardedBoundsFromHeaders(req);
        const raw = await readBoundedJson(req, bounds, startedAt);
        const envelope = validateGuardedEnvelope(raw, bounds, guardedRepo.authority, req.headers.get("idempotency-key"));
        if (envelope.descriptor.binding.tenant_id !== tenantId) {
          throw new HttpError(403, "descriptor tenant does not match the authenticated request tenant.");
        }
        try {
          const submission = await guardedRepo.execute(envelope, principalActor(principal));
          if (submission.receipt.status === "rejected") {
            return boundedJson({ error: "guarded_write_rejected", ...submission }, 409, bounds, startedAt);
          }
          return boundedJson(submission, submission.duplicate ? 200 : 201, bounds, startedAt);
        } catch (error) {
          if (error instanceof OperationBindingConflictError) {
            return boundedJson({
              error: "operation_binding_conflict",
              receipt: error.receipt
            }, 409, bounds, startedAt);
          }
          throw error;
        }
      }
      if (path === "/v1/guarded-writes/lookups/title" && method === "POST") {
        if (!guardedRepo) {
          return json({ error: "guarded_authority_unconfigured" }, 503);
        }
        const startedAt = Date.now();
        const tenantId = req.headers.get("x-knowledge-tenant-id");
        if (!tenantId)
          throw new HttpError(400, "x-knowledge-tenant-id is required.");
        await authOrThrow(req, ["knowledge:read"], tenantId);
        const bounds = guardedBoundsFromHeaders(req);
        const raw = await readBoundedJson(req, bounds, startedAt);
        const envelope = validatePrivateTitleLookupEnvelope(raw, bounds, guardedRepo.authority);
        if (envelope.descriptor.binding.tenant_id !== tenantId) {
          throw new HttpError(403, "descriptor tenant does not match the authenticated request tenant.");
        }
        try {
          const result = await guardedRepo.lookupTitle(envelope.title, envelope.descriptor.binding, bounds);
          return boundedJson(result, 200, bounds, startedAt);
        } catch (error) {
          if (error instanceof PrivateTitleLookupAmbiguousError) {
            return boundedJson({ error: "private_title_lookup_ambiguous" }, 409, bounds, startedAt);
          }
          throw error;
        }
      }
      if (path === "/v1/guarded-writes/queries" && method === "POST") {
        if (!guardedRepo) {
          return json({ error: "guarded_authority_unconfigured" }, 503);
        }
        const startedAt = Date.now();
        const tenantId = req.headers.get("x-knowledge-tenant-id");
        if (!tenantId)
          throw new HttpError(400, "x-knowledge-tenant-id is required.");
        await authOrThrow(req, ["knowledge:read"], tenantId);
        const bounds = privateQueryBoundsFromHeaders(req);
        const raw = await readBoundedJson(req, bounds, startedAt);
        const envelope = validatePrivateQueryEnvelope(raw, bounds, guardedRepo.authority);
        if (envelope.descriptor.binding.tenant_id !== tenantId) {
          throw new HttpError(403, "descriptor tenant does not match the authenticated request tenant.");
        }
        const result = await guardedRepo.query(envelope.selector, envelope.descriptor.selector_digest, envelope.descriptor.archive, envelope.descriptor.page, envelope.descriptor.binding, bounds);
        return boundedJson(result, 200, bounds, startedAt);
      }
      const guardedReceiptMatch = path.match(/^\/v1\/guarded-writes\/receipts\/([^/]+)$/);
      if (guardedReceiptMatch) {
        if (method !== "GET")
          return json({ error: "method_not_allowed" }, 405);
        if (!guardedRepo)
          return json({ error: "guarded_authority_unconfigured" }, 503);
        const startedAt = Date.now();
        const binding = guardedBindingFromQuery(url);
        assertConfiguredAuthority(binding, guardedRepo.authority);
        await authOrThrow(req, ["knowledge:read"], binding.tenant_id);
        const bounds = guardedBoundsFromQuery(req, url);
        const operationId = url.searchParams.get("operation_id");
        const stepId = url.searchParams.get("step_id");
        if (!operationId || !stepId) {
          throw new HttpError(400, "operation_id and step_id are required for exact reconciliation.");
        }
        const reconciliation = await guardedRepo.reconcile(decodeURIComponent(guardedReceiptMatch[1]), binding, operationId, stepId, bounds);
        return boundedJson(reconciliation, 200, bounds, startedAt);
      }
      const guardedItemMatch = path.match(/^\/v1\/guarded-writes\/items\/([^/]+)$/);
      if (guardedItemMatch) {
        if (method !== "GET")
          return json({ error: "method_not_allowed" }, 405);
        if (!guardedRepo)
          return json({ error: "guarded_authority_unconfigured" }, 503);
        const startedAt = Date.now();
        const binding = guardedBindingFromQuery(url);
        assertConfiguredAuthority(binding, guardedRepo.authority);
        await authOrThrow(req, ["knowledge:read"], binding.tenant_id);
        const bounds = guardedBoundsFromQuery(req, url);
        const readback = await guardedRepo.readback(decodeURIComponent(guardedItemMatch[1]), binding, bounds);
        return readback ? boundedJson(readback, 200, bounds, startedAt) : boundedJson({ error: "not_found" }, 404, bounds, startedAt);
      }
      if (path === "/v1/notes/search") {
        if (method !== "GET")
          return json({ error: "method_not_allowed" }, 405);
        const principal = await authOrThrow(req, ["knowledge:read"]);
        const query2 = url.searchParams.get("q") ?? "";
        const archiveRaw = url.searchParams.get("archive") ?? "active";
        if (!["active", "archived", "all"].includes(archiveRaw)) {
          throw new HttpError(400, "archive must be active, archived, or all.");
        }
        const result = await repo.search({
          query: query2,
          archive: archiveRaw,
          limit: url.searchParams.has("limit") ? Number(url.searchParams.get("limit")) : undefined,
          offset: url.searchParams.has("offset") ? Number(url.searchParams.get("offset")) : undefined
        }, principal.tid);
        return json(result);
      }
      if (path === "/v1/notes") {
        if (method === "GET") {
          const principal = await authOrThrow(req, ["knowledge:read"]);
          const archiveRaw = url.searchParams.get("archive") ?? "active";
          const sortRaw = url.searchParams.get("sort") ?? "created";
          const directionRaw = url.searchParams.get("direction") ?? "asc";
          if (!["active", "archived", "all"].includes(archiveRaw)) {
            throw new HttpError(400, "archive must be active, archived, or all.");
          }
          if (!["created", "title"].includes(sortRaw)) {
            throw new HttpError(400, "sort must be created or title.");
          }
          if (!["asc", "desc"].includes(directionRaw)) {
            throw new HttpError(400, "direction must be asc or desc.");
          }
          const tags = url.searchParams.getAll("tags");
          const result = await repo.list({
            limit: url.searchParams.has("limit") ? Number(url.searchParams.get("limit")) : undefined,
            offset: url.searchParams.has("offset") ? Number(url.searchParams.get("offset")) : undefined,
            filter: url.searchParams.get("filter") ?? undefined,
            tags: tags.length > 0 ? tags : undefined,
            archive: archiveRaw,
            sort: sortRaw,
            direction: directionRaw
          }, principal.tid);
          return json(result);
        }
        if (method === "POST") {
          const principal = await authOrThrow(req, ["knowledge:write"]);
          const body = await req.json().catch(() => ({}));
          const item = await repo.create(body, { actor: principalActor(principal) });
          return json(item, 201);
        }
        return json({ error: "method_not_allowed" }, 405);
      }
      const versionListMatch = path.match(/^\/v1\/notes\/([^/]+)\/versions$/);
      if (versionListMatch) {
        if (method !== "GET")
          return json({ error: "method_not_allowed" }, 405);
        const principal = await authOrThrow(req, ["knowledge:read"]);
        const history = await repo.listVersions(decodeURIComponent(versionListMatch[1]), {
          limit: url.searchParams.has("limit") ? Number(url.searchParams.get("limit")) : undefined,
          offset: url.searchParams.has("offset") ? Number(url.searchParams.get("offset")) : undefined
        }, principal.tid);
        return history ? json(history) : json({ error: "not_found" }, 404);
      }
      const versionOneMatch = path.match(/^\/v1\/notes\/([^/]+)\/versions\/(\d+)$/);
      if (versionOneMatch) {
        if (method !== "GET")
          return json({ error: "method_not_allowed" }, 405);
        const principal = await authOrThrow(req, ["knowledge:read"]);
        const snapshot = await repo.getVersion(decodeURIComponent(versionOneMatch[1]), Number(versionOneMatch[2]), principal.tid);
        return snapshot ? json(snapshot) : json({ error: "not_found" }, 404);
      }
      const noteMatch = path.match(/^\/v1\/notes\/([^/]+)$/);
      if (noteMatch) {
        const id = decodeURIComponent(noteMatch[1]);
        if (method === "GET") {
          const principal = await authOrThrow(req, ["knowledge:read"]);
          const item = await repo.get(id, principal.tid);
          return item ? json(item) : json({ error: "not_found" }, 404);
        }
        if (method === "PATCH") {
          const principal = await authOrThrow(req, ["knowledge:write"]);
          const body = await req.json().catch(() => ({}));
          const expectedVersion = parseExpectedVersion(req, body);
          const { expected_version: _ignored, ...patch } = body;
          try {
            const item = await repo.update(id, patch, {
              expectedVersion,
              actor: principalActor(principal)
            });
            return item ? json(item) : json({ error: "not_found" }, 404);
          } catch (error) {
            if (error instanceof VersionConflictError) {
              return json({ error: "version_conflict", expected: error.expected, current: error.current }, 409);
            }
            throw error;
          }
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
function resolveKnowledgeGuardedAuthority(env = process.env) {
  const classification = env.HASNA_KNOWLEDGE_AUTHORITY_CLASSIFICATION;
  const authorityId = env.HASNA_KNOWLEDGE_AUTHORITY_ID;
  if (!classification && !authorityId)
    return;
  if (!classification || !authorityId) {
    throw new Error("FCAME-1 guarded writes require both HASNA_KNOWLEDGE_AUTHORITY_CLASSIFICATION " + "and HASNA_KNOWLEDGE_AUTHORITY_ID.");
  }
  const binding = {
    authority: {
      classification,
      authority_id: authorityId
    },
    tenant_id: "validation-only",
    scope: "validation-only",
    parent_id: "validation-only"
  };
  assertKnowledgeGuardedBinding(binding);
  return binding.authority;
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
  const handler = createServeHandler({
    client,
    verifier,
    store,
    version,
    guardedAuthority: resolveKnowledgeGuardedAuthority(env)
  });
  const BunGlobal = globalThis.Bun;
  if (!BunGlobal?.serve) {
    throw new Error("knowledge-serve requires the Bun runtime (Bun.serve unavailable).");
  }
  const server = BunGlobal.serve({ port, hostname, fetch: handler });
  console.log(`[knowledge-serve] listening on http://${hostname}:${server.port} (mode=postgres, version=${version})`);
  return {
    port: server.port,
    hostname,
    stop: async () => {
      server.stop();
      await client.close();
    }
  };
}
export {
  startKnowledgeServe,
  resolveKnowledgeGuardedAuthority,
  normalizeCloudDatabaseUrl,
  knowledgeOpenApi,
  createServeHandler,
  VersionConflictError,
  NoteRepo,
  KNOWLEDGE_SERVE_APP
};
