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
import { readFileSync as readFileSync5 } from "fs";

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
function hasTransaction(client) {
  return typeof client.transaction === "function";
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
      await this.applyPendingMigration(item.migration);
    }
    return { dryRun, applied: await this.readApplied(), plan };
  }
  async applyPendingMigration(migration) {
    const apply = async (client) => {
      await client.execute(migration.sql);
      await client.execute(`INSERT INTO ${this.ledgerTable} (id, checksum, applied_at) VALUES ($1, $2, now())`, [migration.id, migration.checksum]);
    };
    if (hasTransaction(this.client)) {
      await this.client.transaction(apply);
      return;
    }
    await this.client.execute("BEGIN");
    try {
      await apply(this.client);
      await this.client.execute("COMMIT");
    } catch (error) {
      try {
        await this.client.execute("ROLLBACK");
      } catch {}
      throw error;
    }
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
var KIT_VERSION = "0.4.0";

// src/db/remote-storage.ts
var KNOWLEDGE_APP_NAME = "knowledge";
function translatePlaceholders(sql) {
  let index = 0;
  return sql.replace(/\?/g, () => `$${++index}`);
}
function normalizeParams(params) {
  const flat = params.length === 1 && Array.isArray(params[0]) ? params[0] : params;
  return flat.map((value) => value === undefined ? null : value);
}

class PgAdapterAsync {
  client;
  constructor(connectionString) {
    const pool2 = createPgPool({
      connectionString,
      applicationName: "@hasna/knowledge"
    });
    this.client = createQueryClient(pool2);
  }
  get pool() {
    return this.client.pool;
  }
  async run(sql, ...params) {
    const result = await this.client.query(translatePlaceholders(sql), normalizeParams(params));
    return { changes: result.rowCount };
  }
  async all(sql, ...params) {
    const result = await this.client.query(translatePlaceholders(sql), normalizeParams(params));
    return result.rows;
  }
  async get(sql, ...params) {
    return this.client.get(translatePlaceholders(sql), normalizeParams(params));
  }
  async close() {
    await this.client.close();
  }
}
function createKnowledgeCloudClient() {
  return createCloudPoolFromEnv(KNOWLEDGE_APP_NAME, { applicationName: "@hasna/knowledge" }).client;
}

// src/auth.ts
import { existsSync, mkdirSync, readFileSync as readFileSync2, unlinkSync, writeFileSync } from "fs";
import { homedir } from "os";
import { dirname, join } from "path";
var DEFAULT_KNOWLEDGE_API_URL = "https://knowledge.hasna.xyz";
function normalizeKnowledgeApiOrigin(apiUrl) {
  const url = new URL(apiUrl);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Knowledge API URL must use http or https.");
  }
  const pathname = url.pathname.replace(/\/+$/, "");
  if (pathname === "/api" || pathname === "/api/v1") {
    url.pathname = "/";
  } else if (pathname.endsWith("/api/v1")) {
    url.pathname = pathname.slice(0, -"/api/v1".length) || "/";
  } else if (pathname.endsWith("/api")) {
    url.pathname = pathname.slice(0, -"/api".length) || "/";
  }
  return url.toString().replace(/\/+$/, "");
}
function knowledgeAuthPath(env = process.env) {
  if (env.HASNA_KNOWLEDGE_AUTH_PATH)
    return env.HASNA_KNOWLEDGE_AUTH_PATH;
  const root = env.HASNA_KNOWLEDGE_AUTH_DIR ?? join(homedir(), ".hasna", "knowledge");
  return join(root, "auth.json");
}
function resolveKnowledgeApiUrl(config, env = process.env) {
  return normalizeKnowledgeApiOrigin(env.KNOWLEDGE_API_URL ?? config?.hosted?.api_url ?? DEFAULT_KNOWLEDGE_API_URL);
}
function getKnowledgeAuth(env = process.env) {
  try {
    const path = knowledgeAuthPath(env);
    if (!existsSync(path))
      return null;
    const parsed = JSON.parse(readFileSync2(path, "utf8"));
    return typeof parsed.api_key === "string" && parsed.api_key.length > 0 ? parsed : null;
  } catch {
    return null;
  }
}
function saveKnowledgeAuth(auth, env = process.env) {
  const path = knowledgeAuthPath(env);
  const stored = {
    ...auth,
    api_url: auth.api_url ? normalizeKnowledgeApiOrigin(auth.api_url) : undefined,
    created_at: auth.created_at ?? new Date().toISOString()
  };
  mkdirSync(dirname(path), { recursive: true, mode: 448 });
  writeFileSync(path, `${JSON.stringify(stored, null, 2)}
`, { mode: 384 });
  return stored;
}
function clearKnowledgeAuth(env = process.env) {
  try {
    unlinkSync(knowledgeAuthPath(env));
    return true;
  } catch {
    return false;
  }
}
function getKnowledgeApiKey(env = process.env) {
  if (env.KNOWLEDGE_API_KEY)
    return { apiKey: env.KNOWLEDGE_API_KEY, source: "env" };
  if (env.HASNA_KNOWLEDGE_API_KEY)
    return { apiKey: env.HASNA_KNOWLEDGE_API_KEY, source: "env" };
  const auth = getKnowledgeAuth(env);
  return auth?.api_key ? { apiKey: auth.api_key, source: "file" } : { apiKey: null, source: "none" };
}
function knowledgeAuthStatus(config, env = process.env) {
  const auth = getKnowledgeAuth(env);
  const key = getKnowledgeApiKey(env);
  const apiUrl = env.KNOWLEDGE_API_URL ? resolveKnowledgeApiUrl(config, env) : auth?.api_url ? normalizeKnowledgeApiOrigin(auth.api_url) : resolveKnowledgeApiUrl(config, env);
  return {
    authenticated: Boolean(key.apiKey),
    source: key.source,
    api_url: apiUrl,
    auth_path: knowledgeAuthPath(env),
    email: key.source === "file" ? auth?.email ?? null : null,
    org_id: key.source === "file" ? auth?.org_id ?? null : null,
    org_slug: key.source === "file" ? auth?.org_slug ?? null : null,
    user_id: key.source === "file" ? auth?.user_id ?? null : null,
    api_key_present: Boolean(key.apiKey)
  };
}

// src/remote-client.ts
var REMOTE_KNOWLEDGE_CONTRACT_VERSION = 1;
function isRecord(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
function stringValue(record, key) {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}
function numberValue(record, key) {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
function arrayValue(record, key) {
  const value = record[key];
  return Array.isArray(value) ? value : undefined;
}
function normalizeRemoteKnowledgeRunContract(payload, fallback) {
  const record = isRecord(payload) ? payload : {};
  return {
    contract_version: REMOTE_KNOWLEDGE_CONTRACT_VERSION,
    id: stringValue(record, "id") ?? fallback?.id,
    type: stringValue(record, "type") ?? fallback?.type,
    status: stringValue(record, "status") ?? fallback?.status,
    query: stringValue(record, "query") ?? fallback?.query,
    prompt: stringValue(record, "prompt") ?? fallback?.prompt,
    output_preview: Object.prototype.hasOwnProperty.call(record, "output_preview") ? record.output_preview : fallback?.output_preview,
    citations: arrayValue(record, "citations") ?? fallback?.citations,
    artifacts: arrayValue(record, "artifacts") ?? fallback?.artifacts,
    usage: isRecord(record.usage) ? record.usage : fallback?.usage,
    created_at: stringValue(record, "created_at") ?? fallback?.created_at,
    started_at: stringValue(record, "started_at") ?? fallback?.started_at,
    completed_at: stringValue(record, "completed_at") ?? fallback?.completed_at,
    duration_ms: numberValue(record, "duration_ms") ?? fallback?.duration_ms,
    error_code: stringValue(record, "error_code") ?? fallback?.error_code,
    error_message: stringValue(record, "error_message") ?? fallback?.error_message,
    error: stringValue(record, "error") ?? fallback?.error,
    details: Object.prototype.hasOwnProperty.call(record, "details") ? record.details : fallback?.details
  };
}
function knowledgeRegistryContract(input) {
  return {
    contract_version: REMOTE_KNOWLEDGE_CONTRACT_VERSION,
    service: "open-knowledge",
    mode: input.mode,
    capabilities: [
      "registry",
      "search",
      "ask",
      "build",
      "sync",
      "status",
      "logs",
      "artifacts",
      "open-files-source-refs",
      "s3-generated-artifacts"
    ],
    endpoints: {
      registry: "/api/v1/knowledge/registry",
      search: "/api/v1/knowledge/search",
      ask: "/api/v1/knowledge/ask",
      build: "/api/v1/knowledge/build",
      sync: "/api/v1/knowledge/sync",
      run_status: "/api/v1/knowledge/runs/{run_id}",
      run_logs: "/api/v1/knowledge/runs/{run_id}/logs",
      run_artifacts: "/api/v1/knowledge/runs/{run_id}/artifacts"
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

class RemoteKnowledgeClient {
  apiKey;
  apiUrl;
  constructor(apiKey, apiUrl) {
    this.apiKey = apiKey;
    this.apiUrl = apiUrl;
  }
  static fromConfig(config, env = process.env) {
    const key = getKnowledgeApiKey(env);
    if (!key.apiKey)
      return null;
    return new RemoteKnowledgeClient(key.apiKey, resolveKnowledgeApiUrl(config, env));
  }
  async request(path, options = {}) {
    return fetch(`${this.apiUrl}${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        ...options.headers
      }
    });
  }
  async registry() {
    const response = await this.request("/api/v1/knowledge/registry");
    return response.json();
  }
  async search(request) {
    const response = await this.request("/api/v1/knowledge/search", {
      method: "POST",
      body: JSON.stringify(request)
    });
    return normalizeRemoteKnowledgeRunContract(await response.json(), { type: "search", query: request.query });
  }
  async ask(request) {
    const response = await this.request("/api/v1/knowledge/ask", {
      method: "POST",
      body: JSON.stringify(request)
    });
    return normalizeRemoteKnowledgeRunContract(await response.json(), { type: "ask", prompt: request.prompt });
  }
  async build(request) {
    const response = await this.request("/api/v1/knowledge/build", {
      method: "POST",
      body: JSON.stringify(request)
    });
    return normalizeRemoteKnowledgeRunContract(await response.json(), { type: "build", prompt: request.prompt });
  }
  async sync(request = {}) {
    const response = await this.request("/api/v1/knowledge/sync", {
      method: "POST",
      body: JSON.stringify(request)
    });
    return normalizeRemoteKnowledgeRunContract(await response.json(), { type: "sync" });
  }
  async runStatus(runId) {
    const response = await this.request(`/api/v1/knowledge/runs/${encodeURIComponent(runId)}`);
    if (!response.ok)
      return null;
    return normalizeRemoteKnowledgeRunContract(await response.json(), { id: runId, type: "status" });
  }
  async runLogs(runId) {
    const response = await this.request(`/api/v1/knowledge/runs/${encodeURIComponent(runId)}/logs`);
    if (!response.ok)
      return [];
    const payload = await response.json();
    return Array.isArray(payload) ? payload : [];
  }
  async runArtifacts(runId) {
    const response = await this.request(`/api/v1/knowledge/runs/${encodeURIComponent(runId)}/artifacts`);
    if (!response.ok)
      return [];
    const payload = await response.json();
    return Array.isArray(payload) ? payload : [];
  }
}

// src/store.ts
import { readFileSync as readFileSync4, writeFileSync as writeFileSync3, existsSync as existsSync3, renameSync, unlinkSync as unlinkSync2 } from "fs";
import { randomUUID } from "crypto";

// src/workspace.ts
import { existsSync as existsSync2, mkdirSync as mkdirSync2, readFileSync as readFileSync3, writeFileSync as writeFileSync2 } from "fs";
import { homedir as homedir2 } from "os";
import { dirname as dirname2, join as join2, resolve } from "path";
var HASNA_KNOWLEDGE_APP_PATH = join2(".hasna", "knowledge");
var LEGACY_HASNA_KNOWLEDGE_APP_PATH = join2(".hasna", "apps", "knowledge");
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
  return join2(homedir2(), ".open-knowledge", "db.json");
}
function globalKnowledgeHome() {
  return join2(homedir2(), ".hasna", "knowledge");
}
function projectKnowledgeHome(cwd = process.cwd()) {
  return resolve(cwd, HASNA_KNOWLEDGE_APP_PATH);
}
function legacyGlobalKnowledgeHome() {
  return join2(homedir2(), LEGACY_HASNA_KNOWLEDGE_APP_PATH);
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
    configPath: join2(home, "config.json"),
    jsonStorePath: join2(home, "db.json"),
    knowledgeDbPath: join2(home, "knowledge.db"),
    artifactsDir: join2(home, "artifacts"),
    cacheDir: join2(home, "cache"),
    exportsDir: join2(home, "exports"),
    indexesDir: join2(home, "indexes"),
    logsDir: join2(home, "logs"),
    runsDir: join2(home, "runs"),
    schemasDir: join2(home, "schemas"),
    wikiDir: join2(home, "wiki")
  };
}
function defaultKnowledgeConfig() {
  return {
    version: 1,
    mode: "local",
    hosted: {
      api_url: "https://knowledge.hasna.xyz"
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
  mkdirSync2(workspace.home, { recursive: true });
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
    mkdirSync2(dir, { recursive: true });
  }
  if (!existsSync2(workspace.configPath)) {
    writeFileSync2(workspace.configPath, `${JSON.stringify(defaultKnowledgeConfig(), null, 2)}
`);
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
  mkdirSync2(dirname2(path), { recursive: true });
}
function readKnowledgeConfig(path) {
  const raw = readFileSync3(path, "utf8");
  return JSON.parse(raw);
}
function writeKnowledgeConfig(path, config) {
  ensureParentDir(path);
  writeFileSync2(path, `${JSON.stringify(config, null, 2)}
`);
}

// src/store.ts
function defaultStorePath() {
  return workspaceForHome(globalKnowledgeHome()).jsonStorePath;
}
function ensureStore(path) {
  if (!existsSync3(path)) {
    ensureParentDir(path);
    if (path === defaultStorePath() && existsSync3(legacyGlobalStorePath())) {
      writeFileSync3(path, readFileSync4(legacyGlobalStorePath(), "utf8"));
    } else {
      writeFileSync3(path, JSON.stringify({ items: [] }, null, 2));
    }
  }
}
function loadStoreIfExists(path) {
  if (!existsSync3(path))
    return { exists: false, items: [] };
  const raw = readFileSync4(path, "utf8");
  const parsed = JSON.parse(raw);
  if (!parsed || !Array.isArray(parsed.items)) {
    return { exists: true, items: [] };
  }
  return { exists: true, items: parsed.items };
}
function lockPath(path) {
  return `${path}.lock`;
}
function acquireLock(lockPath2, ownerId) {
  const maxWait = 5000;
  const interval = 50;
  const start = Date.now();
  while (Date.now() - start < maxWait) {
    try {
      if (!existsSync3(lockPath2)) {
        writeFileSync3(lockPath2, JSON.stringify({ owner: ownerId, ts: Date.now() }));
        return;
      }
      const lock = JSON.parse(readFileSync4(lockPath2, "utf8"));
      if (Date.now() - lock.ts > 1e4) {
        unlinkSync2(lockPath2);
      }
    } catch {}
    const start2 = Date.now();
    while (Date.now() - start2 < interval) {}
  }
  throw new Error(`Could not acquire lock on ${lockPath2} after ${maxWait}ms`);
}
function releaseLock(lockPath2, ownerId) {
  try {
    if (existsSync3(lockPath2)) {
      const lock = JSON.parse(readFileSync4(lockPath2, "utf8"));
      if (lock.owner === ownerId) {
        unlinkSync2(lockPath2);
      }
    }
  } catch {}
}
function saveStore(path, store) {
  const tmp = `${path}.tmp.${randomUUID()}`;
  writeFileSync3(tmp, JSON.stringify(store, null, 2));
  renameSync(tmp, path);
}
function withLock(path, fn, options = {}) {
  const owner = randomUUID();
  const lpath = lockPath(path);
  if (options.createParent)
    ensureParentDir(lpath);
  acquireLock(lpath, owner);
  try {
    return fn();
  } finally {
    releaseLock(lpath, owner);
  }
}
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
    const pkg = JSON.parse(readFileSync5(url, "utf8"));
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
    const id = makeId();
    const now = new Date().toISOString();
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
    if (options.search) {
      params.push(`%${options.search}%`);
      where.push(`(title ILIKE $${params.length} OR content ILIKE $${params.length})`);
    }
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const totalRow = await this.client.get(`SELECT count(*)::text AS count FROM knowledge_items ${whereSql}`, params);
    const rows = await this.client.many(`SELECT * FROM knowledge_items ${whereSql} ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`, params);
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
export {
  startKnowledgeServe,
  normalizeCloudDatabaseUrl,
  knowledgeOpenApi,
  createServeHandler,
  NoteRepo,
  KNOWLEDGE_SERVE_APP
};
