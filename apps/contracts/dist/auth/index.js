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

// src/auth/scopes.ts
var SCOPE_PART = /^(?:\*|[a-z][a-z0-9-]*(?:\.[a-z0-9-]+)*)$/;
function isValidScope(scope) {
  if (scope === "*")
    return true;
  const idx = scope.indexOf(":");
  if (idx <= 0 || idx === scope.length - 1)
    return false;
  const app = scope.slice(0, idx);
  const action = scope.slice(idx + 1);
  return SCOPE_PART.test(app) && SCOPE_PART.test(action);
}
function isConcreteScope(scope) {
  if (!isValidScope(scope) || scope === "*")
    return false;
  return !scope.includes("*");
}
function parts(scope) {
  if (scope === "*")
    return ["*", "*"];
  const idx = scope.indexOf(":");
  return [scope.slice(0, idx), scope.slice(idx + 1)];
}
function scopeMatches(granted, required) {
  if (!isValidScope(granted) || !isConcreteScope(required))
    return false;
  if (granted === "*")
    return true;
  const [gApp, gAction] = parts(granted);
  const [rApp, rAction] = parts(required);
  const appOk = gApp === "*" || gApp === rApp;
  const actionOk = gAction === "*" || gAction === rAction;
  return appOk && actionOk;
}
function hasScope(granted, required) {
  return granted.some((g) => scopeMatches(g, required));
}
function hasAllScopes(granted, required) {
  return required.every((r) => hasScope(granted, r));
}
function normalizeScopes(scopes) {
  const seen = new Set;
  for (const raw of scopes) {
    const scope = raw.trim();
    if (!isValidScope(scope)) {
      throw new Error(`Invalid scope '${raw}'. Expected '*' or '<app>:<action>' (e.g. 'todos:read', 'todos:*').`);
    }
    seen.add(scope);
  }
  if (seen.size === 0) {
    throw new Error("At least one scope is required.");
  }
  return [...seen].sort();
}
// src/auth/tenant.ts
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
// src/auth/keys.ts
import { createHash, createHmac, randomBytes, timingSafeEqual } from "crypto";
var API_KEY_TOKEN_VERSION = 1;
var API_KEY_NAMESPACE = "hasna";
var APP_SLUG_PATTERN = /^[a-z][a-z0-9-]*$/;
var API_KEY_TOKEN_PATTERN = /^hasna_([a-z][a-z0-9-]*)_([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/;
var TOKEN_PATTERN = API_KEY_TOKEN_PATTERN;
var DEFAULT_API_KEY_TTL_SECONDS = 90 * 24 * 60 * 60;
function ownAgentClaim(source) {
  return Object.hasOwn(source, "agent") && typeof source.agent === "string" ? source.agent : null;
}
function ownScopesClaim(source) {
  return Object.hasOwn(source, "scopes") && Array.isArray(source.scopes) ? source.scopes : null;
}
function ownOption(options, name) {
  return Object.hasOwn(options, name) ? options[name] : undefined;
}
function base64urlEncode(input) {
  return Buffer.from(input).toString("base64url");
}
function describeType(value) {
  if (value === null)
    return "null";
  if (value === undefined)
    return "undefined";
  const name = value?.constructor?.name;
  return name ? `${typeof value} (${name})` : typeof value;
}
function isBinarySecret(value) {
  return ArrayBuffer.isView(value) || value instanceof ArrayBuffer;
}
var typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype);
var intrinsicViewBuffer = Object.getOwnPropertyDescriptor(typedArrayPrototype, "buffer").get;
var intrinsicViewByteOffset = Object.getOwnPropertyDescriptor(typedArrayPrototype, "byteOffset").get;
var intrinsicViewByteLength = Object.getOwnPropertyDescriptor(typedArrayPrototype, "byteLength").get;
var intrinsicDataViewBuffer = Object.getOwnPropertyDescriptor(DataView.prototype, "buffer").get;
var intrinsicDataViewByteOffset = Object.getOwnPropertyDescriptor(DataView.prototype, "byteOffset").get;
var intrinsicDataViewByteLength = Object.getOwnPropertyDescriptor(DataView.prototype, "byteLength").get;
function viewWindow(view) {
  try {
    return [
      intrinsicViewBuffer.call(view),
      intrinsicViewByteOffset.call(view),
      intrinsicViewByteLength.call(view)
    ];
  } catch {
    return [
      intrinsicDataViewBuffer.call(view),
      intrinsicDataViewByteOffset.call(view),
      intrinsicDataViewByteLength.call(view)
    ];
  }
}
function toBuffer(secret) {
  if (typeof secret === "string")
    return Buffer.from(secret.trim(), "utf8");
  if (ArrayBuffer.isView(secret)) {
    const [store, byteOffset, byteLength] = viewWindow(secret);
    return Buffer.from(store, byteOffset, byteLength);
  }
  return Buffer.from(secret);
}
function hmac(signingSecret, message) {
  return createHmac("sha256", toBuffer(signingSecret)).update(message, "utf8").digest();
}
function hashToken(token) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}
function apiKeyPrefix(app) {
  return `${API_KEY_NAMESPACE}_${app}_`;
}
function generateKid(bytes = 8) {
  return randomBytes(bytes).toString("hex");
}
function mintApiKey(options) {
  const requestedApp = ownOption(options, "app");
  const requestedScopes = ownOption(options, "scopes");
  const requestedSecret = ownOption(options, "signingSecret");
  const requestedKid = ownOption(options, "kid");
  const requestedNowMs = ownOption(options, "nowMs");
  const requestedTtlSeconds = ownOption(options, "ttlSeconds");
  const requestedTid = ownTenantId(options);
  const agent = ownAgentClaim(options);
  if (typeof requestedApp !== "string") {
    throw new Error(`app must be a string; received ${describeType(requestedApp)}. Expected a slug matching ${APP_SLUG_PATTERN}.`);
  }
  const app = requestedApp.trim();
  if (!APP_SLUG_PATTERN.test(app)) {
    throw new Error(`Invalid app slug '${requestedApp}'. Expected ${APP_SLUG_PATTERN}.`);
  }
  if (!Array.isArray(requestedScopes) || requestedScopes.length === 0) {
    throw new Error("At least one scope is required to mint an API key.");
  }
  for (const scope of requestedScopes) {
    if (!isValidScope(scope)) {
      throw new Error(`Invalid scope '${scope}'. Expected '*' or '<app>:<action>'.`);
    }
  }
  if (typeof requestedSecret !== "string" && !isBinarySecret(requestedSecret)) {
    throw new Error("signingSecret must be a string, Buffer, TypedArray, DataView, or ArrayBuffer; " + `received ${describeType(requestedSecret)}.`);
  }
  const secret = toBuffer(requestedSecret);
  if (secret.length < 16) {
    throw new Error("signingSecret must be at least 16 bytes of entropy.");
  }
  const kid = requestedKid ?? generateKid();
  if (!/^[A-Za-z0-9_-]+$/.test(kid)) {
    throw new Error(`Invalid kid '${kid}'. Expected url-safe characters only.`);
  }
  const tid = requestedTid === undefined ? undefined : normalizeTenantId(requestedTid);
  const nowMs = requestedNowMs ?? Date.now();
  const iat = Math.floor(nowMs / 1000);
  const ttl = requestedTtlSeconds === undefined ? DEFAULT_API_KEY_TTL_SECONDS : requestedTtlSeconds;
  if (ttl !== null && (!Number.isFinite(ttl) || ttl <= 0)) {
    throw new Error("ttlSeconds must be a positive number or null (no expiry).");
  }
  const exp = ttl === null ? null : iat + Math.floor(ttl);
  const claims = {
    v: API_KEY_TOKEN_VERSION,
    kid,
    app,
    ...tid !== undefined ? { tid } : {},
    scopes: [...requestedScopes],
    iat,
    exp,
    ...agent !== null ? { agent } : {}
  };
  const body = base64urlEncode(JSON.stringify(claims));
  const signingInput = `${apiKeyPrefix(app)}${body}`;
  const sig = base64urlEncode(hmac(secret, signingInput));
  const token = `${signingInput}.${sig}`;
  return {
    token,
    kid,
    claims,
    tokenHash: hashToken(token),
    prefix: apiKeyPrefix(app)
  };
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
  if (typeof claims !== "object" || claims === null || typeof claims.kid !== "string" || typeof claims.app !== "string" || ownScopesClaim(claims) === null) {
    return null;
  }
  const claimedTid = ownTenantId(claims);
  if (claimedTid !== undefined && !isValidTenantId(claimedTid)) {
    return null;
  }
  return { app, body, sig, claims };
}
function verifyApiKeyToken(token, options) {
  const optSigningSecret = ownOption(options, "signingSecret");
  const optExpectedApp = ownOption(options, "expectedApp");
  const optNowMs = ownOption(options, "nowMs");
  const optLeewaySeconds = ownOption(options, "leewaySeconds");
  const optRequiredScopes = ownOption(options, "requiredScopes");
  const optRequireTenant = ownOption(options, "requireTenant");
  const optExpectedTid = ownOption(options, "expectedTid");
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
  if (optExpectedApp !== undefined && app !== optExpectedApp) {
    return { ok: false, reason: "app_mismatch", message: `Token is for app '${app}', expected '${optExpectedApp}'.` };
  }
  const expected = hmac(optSigningSecret, `${apiKeyPrefix(app)}${body}`);
  let provided;
  try {
    provided = Buffer.from(sig, "base64url");
  } catch {
    return { ok: false, reason: "bad_signature", message: "Signature is not valid base64url." };
  }
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    return { ok: false, reason: "bad_signature", message: "Signature verification failed." };
  }
  const agent = ownAgentClaim(claims);
  const now = Math.floor((optNowMs ?? Date.now()) / 1000);
  const leeway = optLeewaySeconds ?? 0;
  if (typeof claims.iat === "number" && now + leeway < claims.iat) {
    return { ok: false, reason: "not_yet_valid", message: "Token is not yet valid.", agent };
  }
  if (claims.exp !== null && typeof claims.exp === "number" && now - leeway >= claims.exp) {
    return { ok: false, reason: "expired", message: "Token has expired.", agent };
  }
  const verifiedTid = ownTenantId(claims);
  const tid = verifiedTid === undefined ? null : canonicalizeTenantId(verifiedTid);
  const tenantRequired = Boolean(optRequireTenant) || optExpectedTid !== undefined;
  if (tenantRequired && tid === null) {
    return {
      ok: false,
      reason: "tenant_required",
      message: "Token carries no tenant id ('tid') and this service requires one.",
      kid: claims.kid,
      tid: null,
      agent
    };
  }
  if (optExpectedTid !== undefined && !tenantIdsEqual(tid, optExpectedTid)) {
    const expectationIsWellFormed = typeof optExpectedTid === "string" && isValidTenantId(optExpectedTid.trim());
    return {
      ok: false,
      reason: "tenant_mismatch",
      message: expectationIsWellFormed ? "Token is for a different tenant than the one this service accepts." : "Token tenant cannot be checked: the expected tenant id is not a valid tenant id.",
      kid: claims.kid,
      tid,
      agent
    };
  }
  if (optRequiredScopes && optRequiredScopes.length > 0) {
    const granted = ownScopesClaim(claims) ?? [];
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
    for (const required of optRequiredScopes) {
      if (!satisfies(required)) {
        return { ok: false, reason: "insufficient_scope", message: `Missing required scope '${required}'.`, agent };
      }
    }
  }
  return { ok: true, claims, kid: claims.kid, app, tid, agent };
}
// src/auth/store.ts
var DEFAULT_API_KEYS_TABLE = "api_keys";
var API_KEY_ISSUANCE_PENDING_REASON = "credential_delivery_pending";
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
  const agentValue = Object.hasOwn(row, "agent") ? row.agent : null;
  return {
    kid: String(row.kid),
    app: String(row.app),
    agent: agentValue === null || agentValue === undefined ? null : String(agentValue),
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
    await this.insertWithLifecycle(input, null, null);
  }
  async insertWithLifecycle(input, revokedAt, revokedReason) {
    const tid = ownTenantId(input);
    const agent = ownAgentClaim(input);
    await this.client.execute(`INSERT INTO ${this.table}
         (kid, app, agent, tid, scopes, token_hash, issued_at, expires_at, created_by, revoked_at, revoked_reason)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10, $11)`, [
      input.kid,
      input.app,
      agent,
      tid === undefined || tid === null ? null : normalizeTenantId(tid),
      JSON.stringify(input.scopes),
      input.tokenHash,
      input.issuedAt.toISOString(),
      input.expiresAt ? input.expiresAt.toISOString() : null,
      input.createdBy ?? null,
      revokedAt,
      revokedReason
    ]);
  }
  mintedInput(minted, createdBy) {
    const claims = minted.claims;
    return {
      kid: minted.kid,
      app: claims.app,
      agent: ownAgentClaim(claims),
      tid: ownTenantId(claims) ?? null,
      scopes: claims.scopes,
      tokenHash: minted.tokenHash,
      issuedAt: new Date(claims.iat * 1000),
      expiresAt: claims.exp === null ? null : new Date(claims.exp * 1000),
      createdBy: createdBy ?? null
    };
  }
  async insertMinted(minted, createdBy) {
    await this.insert(this.mintedInput(minted, createdBy));
  }
  async insertMintedPending(minted, createdBy, atMs = Date.now()) {
    await this.insertWithLifecycle(this.mintedInput(minted, createdBy), new Date(atMs).toISOString(), API_KEY_ISSUANCE_PENDING_REASON);
  }
  async activatePending(kid, tokenHash) {
    const row = await this.client.get(`UPDATE ${this.table}
          SET revoked_at = NULL, revoked_reason = NULL
        WHERE kid = $1
          AND revoked_at IS NOT NULL
          AND revoked_reason = $2
          AND token_hash = $3
      RETURNING kid`, [kid, API_KEY_ISSUANCE_PENDING_REASON, tokenHash]);
    if (row)
      return true;
    const active = await this.client.get(`SELECT kid FROM ${this.table}
        WHERE kid = $1
          AND token_hash = $2
          AND revoked_at IS NULL
          AND revoked_reason IS NULL`, [kid, tokenHash]);
    return active !== null;
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
  keyStatus = async (kid) => {
    return this.status(kid);
  };
  statusChecker() {
    return async (kid) => {
      const status = await this.status(kid);
      return status !== "active";
    };
  }
  async revoke(kid, reason, atMs = Date.now(), options = {}) {
    const params = [kid, new Date(atMs).toISOString(), reason ?? null];
    let scope = "";
    if (options.app !== undefined) {
      params.push(options.app);
      scope = ` AND app = $${params.length}`;
    }
    const row = await this.client.get(`UPDATE ${this.table}
          SET revoked_at = COALESCE(revoked_at, $2), revoked_reason = COALESCE(revoked_reason, $3)
        WHERE kid = $1${scope}
      RETURNING kid`, params);
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
// src/auth/middleware.ts
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
function ownOption2(bag, name) {
  return Object.hasOwn(bag, name) ? bag[name] : undefined;
}
function verifyApiKey(options) {
  const optionApp = ownOption2(options, "app");
  const optionSigningSecret = ownOption2(options, "signingSecret");
  const optionExpectedTid = ownOption2(options, "expectedTid");
  const optionRequiredScopes = ownOption2(options, "requiredScopes");
  const optionRequireTenant = ownOption2(options, "requireTenant");
  const optionLeewaySeconds = ownOption2(options, "leewaySeconds");
  const audit = ownOption2(options, "audit");
  const headerName = ownOption2(options, "headerName") ?? "x-api-key";
  const scheme = ownOption2(options, "scheme") ?? "Bearer";
  const clock = ownOption2(options, "nowMs") ?? (() => Date.now());
  if (!optionApp)
    throw new Error("verifyApiKey requires an 'app' slug.");
  if (!optionSigningSecret) {
    throw new Error("verifyApiKey requires a 'signingSecret'. Set it from HASNA_<APP>_API_SIGNING_KEY.");
  }
  if (optionExpectedTid !== undefined && !isValidTenantId(optionExpectedTid)) {
    throw new Error(`verifyApiKey received an invalid 'expectedTid': '${optionExpectedTid}'.`);
  }
  const app = optionApp;
  const signingSecret = optionSigningSecret;
  const ownKeyStatus = ownOption2(options, "keyStatus");
  const ownIsRevoked = ownOption2(options, "isRevoked");
  const allowUnregistered = ownOption2(options, "allowUnregisteredKeys") === true;
  if (ownKeyStatus && ownIsRevoked) {
    throw new Error("verifyApiKey received both 'keyStatus' and 'isRevoked'. Supply exactly one \u2014 " + "letting one silently win would hide which check is actually guarding the service. " + "Use 'keyStatus' (store.keyStatus); drop 'isRevoked'.");
  }
  if (!ownKeyStatus && !allowUnregistered) {
    throw new Error(ownIsRevoked ? "verifyApiKey was given only 'isRevoked', which cannot refuse a key this service has " + "no record of: it returns false both for an active key and for one that was never " + "registered, so an unregistered key is irrevocable. Wire 'keyStatus: store.keyStatus' " + "(or 'isRevoked: store.statusChecker()'), or set 'allowUnregisteredKeys: true' to " + "accept that risk explicitly." : "verifyApiKey requires a key-status hook. Without one this service performs NO " + "revocation check and cannot turn any of its keys off. Wire " + "'keyStatus: store.keyStatus', or set 'allowUnregisteredKeys: true' to declare that " + "this service intentionally cannot revoke keys.");
  }
  async function emit(event) {
    if (!audit)
      return;
    try {
      await audit(event);
    } catch {}
  }
  async function authenticate(headers, context = {}) {
    const method = ownOption2(context, "method") ?? null;
    const path = ownOption2(context, "path") ?? null;
    const requiredScopes = [
      ...optionRequiredScopes ?? [],
      ...ownOption2(context, "requiredScopes") ?? []
    ];
    const at = new Date(clock()).toISOString();
    const perCallTid = ownOption2(context, "expectedTid");
    const expectedTid = perCallTid !== undefined ? perCallTid : optionExpectedTid;
    if (perCallTid !== undefined && optionExpectedTid !== undefined && !tenantIdsEqual(perCallTid, optionExpectedTid)) {
      await emit({ outcome: "deny", app, kid: null, tid: null, reason: "tenant_mismatch", scopesRequired: requiredScopes, method, path, status: 403, at });
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
      await emit({ outcome: "deny", app, kid: null, tid: null, reason: "missing_token", scopesRequired: requiredScopes, method, path, status: 401, at });
      return decision;
    }
    const verified = verifyApiKeyToken(token, {
      signingSecret,
      expectedApp: app,
      nowMs: clock(),
      ...optionLeewaySeconds !== undefined ? { leewaySeconds: optionLeewaySeconds } : {},
      ...optionRequireTenant !== undefined ? { requireTenant: optionRequireTenant } : {},
      ...expectedTid !== undefined ? { expectedTid } : {},
      requiredScopes
    });
    if (!verified.ok) {
      const status = verified.reason === "insufficient_scope" || verified.reason === "tenant_mismatch" || verified.reason === "tenant_required" ? 403 : 401;
      await emit({
        outcome: "deny",
        app,
        kid: ownOption2(verified, "kid") ?? null,
        tid: ownTenantId(verified) ?? null,
        ...Object.hasOwn(verified, "agent") ? { agent: verified.agent } : {},
        reason: verified.reason,
        scopesRequired: requiredScopes,
        method,
        path,
        status,
        at
      });
      return { ok: false, status, reason: verified.reason, message: verified.message };
    }
    if (ownKeyStatus) {
      let status;
      try {
        status = await ownKeyStatus(verified.kid);
      } catch {
        await emit({ outcome: "deny", app, kid: verified.kid, tid: verified.tid, agent: verified.agent, reason: "status_unavailable", scopesRequired: requiredScopes, method, path, status: 503, at });
        return {
          ok: false,
          status: 503,
          reason: "status_unavailable",
          message: "Could not verify API key status. Try again shortly."
        };
      }
      if (status !== "active") {
        const known = status === "revoked" || status === "expired" || status === "unknown";
        if (!(status === "unknown" && allowUnregistered)) {
          const reason = status === "revoked" || status === "expired" ? status : "unknown_key";
          const message = reason === "unknown_key" ? known ? "API key is not registered with this service." : "API key status could not be recognized." : status === "expired" ? "API key has expired." : "API key has been revoked.";
          await emit({ outcome: "deny", app, kid: verified.kid, tid: verified.tid, agent: verified.agent, reason, scopesRequired: requiredScopes, method, path, status: 401, at });
          return { ok: false, status: 401, reason, message };
        }
      }
    } else if (ownIsRevoked) {
      let revoked;
      try {
        revoked = await ownIsRevoked(verified.kid);
      } catch {
        await emit({ outcome: "deny", app, kid: verified.kid, tid: verified.tid, agent: verified.agent, reason: "status_unavailable", scopesRequired: requiredScopes, method, path, status: 503, at });
        return {
          ok: false,
          status: 503,
          reason: "status_unavailable",
          message: "Could not verify API key status. Try again shortly."
        };
      }
      if (revoked) {
        await emit({ outcome: "deny", app, kid: verified.kid, tid: verified.tid, agent: verified.agent, reason: "revoked", scopesRequired: requiredScopes, method, path, status: 401, at });
        return { ok: false, status: 401, reason: "revoked", message: "API key has been revoked." };
      }
    }
    const principal = {
      kid: verified.kid,
      app: verified.app,
      scopes: verified.claims.scopes,
      agent: verified.agent,
      tid: verified.tid,
      claims: verified.claims
    };
    await emit({ outcome: "allow", app, kid: verified.kid, tid: verified.tid, agent: verified.agent, reason: null, scopesRequired: requiredScopes, method, path, status: 200, at });
    return { ok: true, status: 200, principal };
  }
  return { authenticate, app };
}
function expressApiKey(options) {
  const verifier = verifyApiKey(options);
  return async (req, res, next) => {
    const decision = await verifier.authenticate(req.headers, {
      method: req.method,
      path: req.originalUrl ?? req.url ?? req.path
    });
    if (decision.ok) {
      req.apiKey = decision.principal;
      next();
      return;
    }
    res.status(decision.status).json({ error: decision.message, reason: decision.reason });
  };
}
function honoApiKey(options) {
  const verifier = verifyApiKey(options);
  return async (c, next) => {
    const decision = await verifier.authenticate((name) => c.req.header(name), {
      method: c.req.method,
      path: c.req.path
    });
    if (decision.ok) {
      c.set("apiKey", decision.principal);
      return next();
    }
    return c.json({ error: decision.message, reason: decision.reason }, decision.status);
  };
}
// src/auth/identity.ts
import { createPublicKey, verify as edVerify } from "crypto";

// src/env-token.ts
function envToken(name) {
  return name.toUpperCase().replace(/-/g, "_");
}

// src/auth/identity.ts
var FLEET_TOKEN_ALG = "EdDSA";
var FLEET_TOKEN_TYP = "at+jwt";
var MAX_FLEET_TOKEN_TTL_SECONDS = 24 * 60 * 60;
var MAX_FLEET_TOKEN_LEEWAY_SECONDS = 300;
var PRINCIPAL_TYPES = ["user", "service"];
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isUsableEd25519Jwk(value) {
  if (!isRecord(value))
    return false;
  if (value.kty !== "OKP" || value.crv !== "Ed25519")
    return false;
  if (typeof value.x !== "string" || value.x.length === 0)
    return false;
  if (typeof value.kid !== "string" || value.kid.length === 0)
    return false;
  if (value.use !== undefined && value.use !== "sig")
    return false;
  if (value.alg !== undefined && value.alg !== FLEET_TOKEN_ALG)
    return false;
  return true;
}
function parseFleetJwks(value) {
  const document = typeof value === "string" ? safeJsonParse(value) : value;
  if (!isRecord(document)) {
    return { ok: false, problem: "not_an_object", message: "JWKS must be a JSON object." };
  }
  if (!Array.isArray(document.keys)) {
    return { ok: false, problem: "keys_not_an_array", message: "JWKS must have a 'keys' array." };
  }
  if (document.keys.length === 0) {
    return { ok: false, problem: "empty_key_set", message: "JWKS contains no keys." };
  }
  if (document.keys.some((key) => isRecord(key) && typeof key.d === "string")) {
    return {
      ok: false,
      problem: "private_material",
      message: "JWKS contains a private key component ('d'). Publish public keys only."
    };
  }
  const keys = document.keys.filter(isUsableEd25519Jwk);
  if (keys.length === 0) {
    return {
      ok: false,
      problem: "no_usable_key",
      message: `JWKS contains no usable Ed25519 signing key (need kty 'OKP', crv 'Ed25519', a 'kid', and alg '${FLEET_TOKEN_ALG}' when present).`
    };
  }
  return { ok: true, jwks: { keys } };
}
function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
function decodeSegment(segment) {
  try {
    return JSON.parse(Buffer.from(segment, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}
function audienceMatches(aud, audience) {
  if (typeof aud === "string")
    return aud === audience;
  if (Array.isArray(aud))
    return aud.some((entry) => typeof entry === "string" && entry === audience);
  return false;
}
var MAX_IDENTIFIER_LENGTH = 255;
function isBoundedIdentifier(value) {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_IDENTIFIER_LENGTH && /^[\u0021-\u007e]+$/.test(value);
}
function ownScopeClaim(source) {
  return Object.hasOwn(source, "scope") && Array.isArray(source.scope) ? source.scope : null;
}
function claimsProblem(claims) {
  if (typeof claims.iss !== "string" || claims.iss.length === 0)
    return "iss must be a non-empty string";
  if (!isBoundedIdentifier(claims.sub))
    return `sub must be 1-${MAX_IDENTIFIER_LENGTH} printable ASCII characters`;
  if (!isBoundedIdentifier(claims.jti)) {
    return `jti must be 1-${MAX_IDENTIFIER_LENGTH} printable ASCII characters (it is the revocation handle)`;
  }
  if (!isValidTenantId(claims.tid))
    return "tid must be a valid tenant id";
  if (!PRINCIPAL_TYPES.includes(claims.pt)) {
    return `pt must be one of ${PRINCIPAL_TYPES.join(", ")}`;
  }
  const scope = ownScopeClaim(claims);
  if (scope === null || scope.some((entry) => typeof entry !== "string" || !isValidScope(entry))) {
    return "scope must be an array of valid '<app>:<action>' scopes";
  }
  if (!Number.isFinite(claims.iat))
    return "iat must be a number";
  return null;
}
function verifyFleetToken(token, options) {
  if (typeof token !== "string") {
    return { ok: false, reason: "malformed", message: "Token must be a string." };
  }
  const parts2 = token.split(".");
  if (parts2.length !== 3 || parts2.some((part) => part.length === 0)) {
    return { ok: false, reason: "malformed", message: "Token is not a compact JWS." };
  }
  const [headerSegment, payloadSegment, signatureSegment] = parts2;
  const header = decodeSegment(headerSegment);
  if (!isRecord(header)) {
    return { ok: false, reason: "malformed", message: "Token header is not a JSON object." };
  }
  if (header.alg !== FLEET_TOKEN_ALG) {
    return {
      ok: false,
      reason: "unsupported_alg",
      message: `Token alg must be '${FLEET_TOKEN_ALG}'.`
    };
  }
  if (header.typ !== undefined && header.typ !== FLEET_TOKEN_TYP) {
    return { ok: false, reason: "unsupported_typ", message: `Token typ must be '${FLEET_TOKEN_TYP}'.` };
  }
  if (header.crit !== undefined) {
    return { ok: false, reason: "unsupported_crit", message: "Token declares a 'crit' extension this verifier does not implement." };
  }
  if (header.b64 !== undefined) {
    return { ok: false, reason: "unsupported_crit", message: "Token declares the 'b64' extension, which this verifier does not implement." };
  }
  if (typeof header.kid !== "string" || header.kid.length === 0) {
    return { ok: false, reason: "missing_kid", message: "Token header must carry a 'kid'." };
  }
  const candidateKeys = Array.isArray(options.jwks?.keys) ? options.jwks.keys : [];
  const usableKeys = candidateKeys.filter(isUsableEd25519Jwk);
  if (usableKeys.length === 0) {
    return { ok: false, reason: "no_usable_key", message: "No usable Ed25519 key in the configured JWKS." };
  }
  if (candidateKeys.some((key) => isRecord(key) && typeof key.d === "string")) {
    return {
      ok: false,
      reason: "private_material",
      message: "Configured JWKS contains a private key component ('d'). Publish public keys only."
    };
  }
  const matching = usableKeys.filter((key) => key.kid === header.kid);
  if (matching.length === 0) {
    return { ok: false, reason: "unknown_kid", message: "No configured key matches the token's 'kid'." };
  }
  const signingInput = Buffer.from(`${headerSegment}.${payloadSegment}`, "utf8");
  const signatureBytes = Buffer.from(signatureSegment, "base64url");
  let signatureValid = false;
  for (const candidate of matching) {
    try {
      const publicKey = createPublicKey({ key: candidate, format: "jwk" });
      if (edVerify(null, signingInput, publicKey, signatureBytes)) {
        signatureValid = true;
        break;
      }
    } catch {}
  }
  if (!signatureValid) {
    return { ok: false, reason: "bad_signature", message: "Signature verification failed." };
  }
  const payload = decodeSegment(payloadSegment);
  if (!isRecord(payload)) {
    return { ok: false, reason: "malformed", message: "Token payload is not a JSON object." };
  }
  const problem = claimsProblem(payload);
  if (problem) {
    return { ok: false, reason: "invalid_claims", message: `Token claims are invalid: ${problem}.` };
  }
  const claims = payload;
  if (claims.iss !== options.issuer) {
    return { ok: false, reason: "issuer_mismatch", message: "Token was issued by a different issuer." };
  }
  if (!audienceMatches(claims.aud, options.audience)) {
    return { ok: false, reason: "audience_mismatch", message: "Token was issued for a different audience." };
  }
  if (!Number.isFinite(claims.exp)) {
    return { ok: false, reason: "missing_expiry", message: "Token must carry a numeric 'exp'." };
  }
  const maxTtl = options.maxTtlSeconds ?? MAX_FLEET_TOKEN_TTL_SECONDS;
  if (claims.exp - claims.iat > maxTtl) {
    return {
      ok: false,
      reason: "excessive_ttl",
      message: `Token lifetime exceeds the ${maxTtl}s ceiling; offline verification cannot see a revocation, so the TTL is the revocation window.`
    };
  }
  const now = Math.floor((options.nowMs ?? Date.now()) / 1000);
  const leeway = Math.min(Math.max(options.leewaySeconds ?? 0, 0), MAX_FLEET_TOKEN_LEEWAY_SECONDS);
  if (now - leeway >= claims.exp) {
    return { ok: false, reason: "expired", message: "Token has expired." };
  }
  if (now + leeway < claims.iat) {
    return { ok: false, reason: "not_yet_valid", message: "Token is not yet valid." };
  }
  if (claims.nbf !== undefined) {
    if (!Number.isFinite(claims.nbf)) {
      return { ok: false, reason: "invalid_claims", message: "Token claims are invalid: nbf must be a number." };
    }
    if (now + leeway < claims.nbf) {
      return { ok: false, reason: "not_yet_valid", message: "Token is not yet valid." };
    }
  }
  const tid = canonicalizeTenantId(claims.tid);
  if (options.expectedTid !== undefined && !tenantIdsEqual(tid, options.expectedTid)) {
    return {
      ok: false,
      reason: "tenant_mismatch",
      message: isValidTenantId(options.expectedTid) ? "Token is for a different tenant than the one this service accepts." : "Token tenant cannot be checked: the expected tenant id is not a valid tenant id."
    };
  }
  const grantedScopes = ownScopeClaim(claims) ?? [];
  if (options.requiredScopes && options.requiredScopes.length > 0) {
    for (const required of options.requiredScopes) {
      if (!grantedScopes.some((granted) => scopeMatches(granted, required))) {
        return { ok: false, reason: "insufficient_scope", message: `Missing required scope '${required}'.` };
      }
    }
  }
  return {
    ok: true,
    principal: {
      sub: claims.sub,
      tid,
      principalType: claims.pt,
      scopes: [...grantedScopes],
      jti: claims.jti,
      kid: header.kid,
      issuer: claims.iss,
      audience: options.audience,
      expiresAt: new Date(claims.exp * 1000).toISOString(),
      claims
    }
  };
}
function createIdentityVerifier(config, jwksSource, options = {}) {
  if (!config.issuer)
    throw new Error("createIdentityVerifier requires a non-empty 'issuer'.");
  if (!config.audience)
    throw new Error("createIdentityVerifier requires a non-empty 'audience'.");
  if (typeof jwksSource !== "function") {
    throw new Error("createIdentityVerifier requires a jwksSource function returning the key set.");
  }
  async function verify(token, context = {}) {
    let resolved;
    try {
      resolved = await jwksSource();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, reason: "no_usable_key", message: `Could not resolve the JWKS: ${message}` };
    }
    const parsed = parseFleetJwks(resolved);
    if (!parsed.ok) {
      const reason = parsed.problem === "private_material" ? "private_material" : "no_usable_key";
      return { ok: false, reason, message: `Configured JWKS is unusable: ${parsed.message}` };
    }
    const jwks = parsed.jwks;
    const result = verifyFleetToken(token, {
      jwks,
      issuer: config.issuer,
      audience: config.audience,
      leewaySeconds: config.leewaySeconds,
      maxTtlSeconds: config.maxTtlSeconds,
      ...context.expectedTid !== undefined ? { expectedTid: context.expectedTid } : {},
      ...context.requiredScopes !== undefined ? { requiredScopes: context.requiredScopes } : {}
    });
    if (!result.ok)
      return result;
    if (options.isRevoked) {
      const revoked = await options.isRevoked(result.principal.jti);
      if (revoked) {
        return { ok: false, reason: "revoked", message: "Token has been revoked." };
      }
    }
    return result;
  }
  return { verify, config };
}
async function resolveTenantOrg(principal, resolver) {
  const org = await resolver(principal.tid);
  if (org === null || org === undefined) {
    return {
      ok: false,
      reason: "unknown_tenant",
      message: "Token names a tenant that is not provisioned in this service."
    };
  }
  return { ok: true, org, tid: principal.tid };
}
function identityEnvKeys(name) {
  const token = envToken(name);
  return {
    issuerKeys: [`HASNA_${token}_IDENTITY_ISSUER`, `${token}_IDENTITY_ISSUER`],
    audienceKeys: [`HASNA_${token}_IDENTITY_AUDIENCE`, `${token}_IDENTITY_AUDIENCE`],
    jwksUriKeys: [`HASNA_${token}_IDENTITY_JWKS_URI`, `${token}_IDENTITY_JWKS_URI`],
    jwksKeys: [`HASNA_${token}_IDENTITY_JWKS`, `${token}_IDENTITY_JWKS`],
    leewayKeys: [`HASNA_${token}_IDENTITY_LEEWAY_SECONDS`, `${token}_IDENTITY_LEEWAY_SECONDS`]
  };
}
function firstEnv(env, keys) {
  for (const key of keys) {
    const raw = env[key];
    if (raw === undefined)
      continue;
    const value = raw.trim();
    return { key, value, blank: value.length === 0 };
  }
  return null;
}
function resolveIdentityConfig(name, env = process.env) {
  const keys = identityEnvKeys(name);
  const checkedKeys = [
    ...keys.issuerKeys,
    ...keys.audienceKeys,
    ...keys.jwksUriKeys,
    ...keys.jwksKeys,
    ...keys.leewayKeys
  ];
  const issuer = firstEnv(env, keys.issuerKeys);
  const audience = firstEnv(env, keys.audienceKeys);
  const jwksUri = firstEnv(env, keys.jwksUriKeys);
  const inline = firstEnv(env, keys.jwksKeys);
  const leeway = firstEnv(env, keys.leewayKeys);
  const present = [issuer, audience, jwksUri, inline, leeway].filter((hit) => hit !== null);
  if (present.length === 0) {
    return { enabled: false, reason: "unconfigured", checkedKeys };
  }
  const invalid = (error) => ({
    enabled: false,
    reason: "invalid",
    error,
    checkedKeys
  });
  const blank = present.filter((hit) => hit.blank);
  if (blank.length > 0) {
    return invalid(`Identity option is misconfigured: ${blank.map((hit) => hit.key).join(", ")} is set but empty. Unset it to disable the identity option, or give it a value.`);
  }
  if (!issuer) {
    return invalid(`Identity option is partially configured: set ${keys.issuerKeys[0]} (expected token 'iss').`);
  }
  if (!jwksUri && !inline) {
    return invalid(`Identity option is partially configured: set ${keys.jwksUriKeys[0]} (fetched out of band by your own refresher) or ${keys.jwksKeys[0]} (inline JWKS JSON).`);
  }
  let inlineJwks = null;
  if (inline) {
    const parsed = parseFleetJwks(inline.value);
    if (!parsed.ok)
      return invalid(`${inline.key} is not a usable JWKS: ${parsed.message}`);
    inlineJwks = parsed.jwks;
  }
  if (jwksUri) {
    const uriProblem = jwksUriProblem(jwksUri.value);
    if (uriProblem)
      return invalid(`${jwksUri.key} is not a usable JWKS URI: ${uriProblem}`);
  }
  let leewaySeconds = 0;
  if (leeway) {
    const parsed = /^[0-9]+$/.test(leeway.value) ? Number(leeway.value) : Number.NaN;
    if (!Number.isInteger(parsed)) {
      return invalid(`${leeway.key} must be a whole number of seconds.`);
    }
    if (parsed > MAX_FLEET_TOKEN_LEEWAY_SECONDS) {
      return invalid(`${leeway.key} is ${parsed}s, above the ${MAX_FLEET_TOKEN_LEEWAY_SECONDS}s ceiling. Leeway widens the window in which an expired \u2014 possibly revoked \u2014 token is still accepted.`);
    }
    leewaySeconds = parsed;
  }
  const sources = { issuer: issuer.key };
  if (audience)
    sources.audience = audience.key;
  if (jwksUri)
    sources.jwksUri = jwksUri.key;
  if (inline)
    sources.jwks = inline.key;
  if (leeway)
    sources.leewaySeconds = leeway.key;
  return {
    enabled: true,
    config: {
      issuer: issuer.value,
      audience: audience?.value ?? name,
      jwksUri: jwksUri?.value ?? null,
      leewaySeconds,
      maxTtlSeconds: MAX_FLEET_TOKEN_TTL_SECONDS
    },
    inlineJwks,
    sources
  };
}
function jwksUriProblem(value) {
  if (/[\u0000-\u001f\u007f]/.test(value))
    return "it contains control characters";
  if (/\s/.test(value))
    return "it contains whitespace";
  const match = /^([a-z][a-z0-9+.-]*):\/\/([^/?#]*)/i.exec(value);
  if (!match)
    return "it must be an absolute URL";
  const scheme = match[1].toLowerCase();
  const authority = match[2];
  if (!authority)
    return "it must include a host";
  if (authority.includes("@"))
    return "it must not embed credentials";
  if (!isPlausibleAuthority(authority))
    return "its host is not a plain hostname, IPv4, or bracketed IPv6 with an optional port";
  const isLoopback = /^(?:localhost|127\.0\.0\.1|\[::1\])(?::[0-9]+)?$/i.test(authority);
  if (scheme === "https")
    return null;
  if (scheme === "http" && isLoopback)
    return null;
  return "it must use https (http is accepted only for an exact loopback host)";
}
function isPlausibleAuthority(authority) {
  const match = /^(\[[0-9a-f:.]+\]|[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*)(?::([0-9]{1,5}))?$/i.exec(authority);
  if (!match)
    return false;
  if (match[2] === undefined)
    return true;
  const port = Number(match[2]);
  return port >= 1 && port <= 65535 && String(port) === match[2];
}
// src/auth/signing-secret.ts
function signingSecretEnvKeys(app) {
  return [`HASNA_${envToken(app)}_API_SIGNING_KEY`, "HASNA_API_SIGNING_KEY"];
}

class SigningSecretError extends Error {
  attempted;
  constructor(message, attempted) {
    super(message);
    this.name = "SigningSecretError";
    this.attempted = Object.freeze([...attempted]);
  }
}
function normalizeSigningSecret(secret) {
  return typeof secret === "string" ? secret.trim() : secret;
}
function signingSecretHasSurroundingWhitespace(value) {
  return value !== value.trim();
}
function resolveSigningSecret(app, env, options = {}) {
  const keys = options.envName ? [options.envName] : signingSecretEnvKeys(app);
  for (const key of keys) {
    const raw = env[key];
    if (raw === undefined)
      continue;
    const value = raw.trim();
    if (!value)
      continue;
    return { value, source: key, trimmed: signingSecretHasSurroundingWhitespace(raw) };
  }
  throw new SigningSecretError(`No signing secret found. Set ${keys.join(" or ")} (openssl rand -hex 32).`, keys);
}
// src/auth/key-lifecycle.ts
var KEY_LIFECYCLE_BASE_PATH = "/v1/admin/keys";
var KEY_LIFECYCLE_SCOPE_ACTION = "keys.admin";
function keyLifecycleScope(app) {
  return `${app}:${KEY_LIFECYCLE_SCOPE_ACTION}`;
}
var DEFAULT_CLIENT_KEY_TTL_DAYS = 365;
function ownField(bag, name) {
  if (typeof bag !== "object" || bag === null)
    return;
  return Object.hasOwn(bag, name) ? bag[name] : undefined;
}
function fail(status, reason, message) {
  return { status, body: { error: message, reason } };
}
function publicRecord(record, nowMs) {
  return {
    kid: record.kid,
    app: record.app,
    agent: record.agent,
    tid: record.tid,
    scopes: record.scopes,
    issued_at: record.issuedAt,
    expires_at: record.expiresAt,
    revoked_at: record.revokedAt,
    revoked_reason: record.revokedReason,
    last_used_at: record.lastUsedAt,
    created_by: record.createdBy,
    status: recordStatus(record, nowMs)
  };
}
function recordStatus(record, nowMs) {
  if (record.revokedAt)
    return "revoked";
  if (record.expiresAt && new Date(record.expiresAt).getTime() <= nowMs)
    return "expired";
  return "active";
}
function parseBody(body) {
  if (body === undefined || body === null || body === "")
    return {};
  if (typeof body === "string") {
    try {
      const parsed = JSON.parse(body);
      return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  if (typeof body === "object" && !Array.isArray(body))
    return body;
  return null;
}
function createKeyLifecycleRoutes(options) {
  const app = options.app;
  if (!/^[a-z][a-z0-9-]*$/.test(app)) {
    throw new Error(`Invalid app slug '${app}'. Expected a lowercase DNS-style slug.`);
  }
  const basePath = (options.basePath ?? KEY_LIFECYCLE_BASE_PATH).replace(/\/+$/, "");
  if (!basePath.startsWith("/")) {
    throw new Error("Key lifecycle basePath must be an absolute path.");
  }
  const operatorScope = options.operatorScope ?? keyLifecycleScope(app);
  const maxTtlDays = options.maxTtlDays ?? DEFAULT_CLIENT_KEY_TTL_DAYS;
  if (!Number.isFinite(maxTtlDays) || maxTtlDays <= 0) {
    throw new Error("maxTtlDays must be a positive number.");
  }
  const clock = options.nowMs ?? Date.now;
  const verifier = verifyApiKey({
    app,
    signingSecret: options.signingSecret,
    requiredScopes: [operatorScope],
    ...options.keyStatus !== undefined ? { keyStatus: options.keyStatus } : {},
    ...options.allowUnregisteredKeys !== undefined ? { allowUnregisteredKeys: options.allowUnregisteredKeys } : {},
    ...options.audit !== undefined ? { audit: options.audit } : {},
    ...options.nowMs !== undefined ? { nowMs: options.nowMs } : {}
  });
  function routePath(path) {
    const withoutQuery = path.split(/[?#]/, 1)[0] ?? "";
    return withoutQuery.replace(/\/+$/, "") || "/";
  }
  function matches(path) {
    const resolved = routePath(path);
    return resolved === basePath || resolved.startsWith(`${basePath}/`);
  }
  function subPath(path) {
    const resolved = routePath(path);
    return resolved === basePath ? "" : resolved.slice(basePath.length);
  }
  async function mint(body, createdBy) {
    const rawAgent = ownField(body, "agent");
    if (typeof rawAgent !== "string" || rawAgent.trim().length === 0) {
      return fail(400, "invalid_agent", "Provide 'agent': the subject this key is issued to.");
    }
    const agent = rawAgent.trim();
    const rawScopes = ownField(body, "scopes");
    const scopes = rawScopes === undefined ? [`${app}:read`, `${app}:write`] : rawScopes;
    if (!Array.isArray(scopes) || scopes.length === 0 || !scopes.every((s) => typeof s === "string")) {
      return fail(400, "invalid_scopes", "'scopes' must be a non-empty array of scope strings.");
    }
    for (const scope of scopes) {
      if (!isValidScope(scope)) {
        return fail(400, "invalid_scopes", `Invalid scope '${scope}'. Expected '<app>:<action>'.`);
      }
      if (scope === "*" || !scope.startsWith(`${app}:`)) {
        return fail(400, "invalid_scopes", `Scope '${scope}' is not for app '${app}'. This route mints keys for '${app}' only.`);
      }
    }
    const rawTid = ownField(body, "tid");
    let tid;
    if (rawTid !== undefined && rawTid !== null) {
      try {
        tid = normalizeTenantId(String(rawTid));
      } catch (error) {
        return fail(400, "invalid_tid", error instanceof Error ? error.message : "Invalid 'tid'.");
      }
    }
    const ttlField = Object.hasOwn(body, "ttl_days") ? "ttl_days" : Object.hasOwn(body, "ttlDays") ? "ttlDays" : null;
    const rawTtl = ttlField === null ? undefined : ownField(body, ttlField);
    let ttlSeconds;
    if (rawTtl === null) {
      ttlSeconds = null;
    } else if (rawTtl === undefined) {
      ttlSeconds = Math.floor(DEFAULT_CLIENT_KEY_TTL_DAYS * 86400);
    } else {
      const days = Number(rawTtl);
      if (!Number.isFinite(days) || days <= 0 || days > maxTtlDays) {
        return fail(400, "invalid_ttl", `'ttl_days' must be a positive number no greater than ${maxTtlDays}, or null for no expiry.`);
      }
      ttlSeconds = Math.floor(days * 86400);
    }
    let minted;
    try {
      minted = mintApiKey({
        app,
        scopes: [...scopes],
        signingSecret: options.signingSecret,
        ttlSeconds,
        agent,
        nowMs: clock(),
        ...tid !== undefined ? { tid } : {}
      });
    } catch (error) {
      return fail(400, "mint_failed", error instanceof Error ? error.message : "Could not mint key.");
    }
    try {
      await options.store.insertMinted(minted, createdBy);
    } catch {
      return fail(503, "record_not_stored", "The key was minted but its record could not be stored, so it was discarded. Retry.");
    }
    return {
      status: 201,
      body: {
        key: minted.token,
        kid: minted.kid,
        app,
        agent,
        tid: tid ?? null,
        scopes: [...scopes],
        issued_at: new Date(minted.claims.iat * 1000).toISOString(),
        expires_at: minted.claims.exp === null ? null : new Date(minted.claims.exp * 1000).toISOString()
      }
    };
  }
  async function list(path) {
    const query = new URLSearchParams(path.includes("?") ? path.slice(path.indexOf("?") + 1) : "");
    const includeRevoked = query.get("include_revoked") === "1" || query.get("include_revoked") === "true";
    const rawTid = query.get("tid");
    let records;
    try {
      records = await options.store.list({
        app,
        includeRevoked,
        ...rawTid !== null ? { tid: rawTid } : {}
      });
    } catch (error) {
      return fail(400, "invalid_filter", error instanceof Error ? error.message : "Invalid list filter.");
    }
    const now = clock();
    return { status: 200, body: { keys: records.map((record) => publicRecord(record, now)) } };
  }
  async function ownedByApp(kid) {
    if (options.store.findByKid) {
      const record = await options.store.findByKid(kid);
      return record !== null && record.app === app;
    }
    if (typeof options.store.list === "function") {
      const records = await options.store.list({ app, includeRevoked: true });
      return records.some((record) => record.kid === kid && record.app === app);
    }
    return null;
  }
  async function revoke(kid, body) {
    const rawReason = ownField(body, "reason");
    const reason = typeof rawReason === "string" && rawReason.trim() ? rawReason.trim() : "revoked_by_operator";
    let owned;
    try {
      owned = await ownedByApp(kid);
    } catch {
      return fail(503, "ownership_unresolved", "Could not read the key's record to confirm it belongs to this app. Retry.");
    }
    if (owned === null) {
      return fail(501, "not_implemented", "This key store cannot establish which app a key belongs to.");
    }
    if (!owned)
      return fail(404, "unknown_key", `No key with kid '${kid}' is recorded for '${app}'.`);
    const revoked = await options.store.revoke(kid, reason, clock(), { app });
    if (!revoked)
      return fail(404, "unknown_key", `No key with kid '${kid}' is recorded for '${app}'.`);
    return { status: 200, body: { kid, revoked: true, reason } };
  }
  async function handle(request) {
    const method = String(request.method ?? "").toUpperCase();
    const path = String(request.path ?? "");
    if (!matches(path))
      return fail(404, "not_found", "No such route.");
    const rest = subPath(path).split(/[?#]/, 1)[0] ?? "";
    const decision = await verifier.authenticate(request.headers, {
      method,
      path: routePath(path),
      requiredScopes: [operatorScope]
    });
    if (!decision.ok) {
      return { status: decision.status, body: { error: decision.message, reason: decision.reason } };
    }
    if (!hasScope(decision.principal.scopes, operatorScope)) {
      return fail(403, "insufficient_scope", `This route requires the '${operatorScope}' scope.`);
    }
    const createdBy = decision.principal.agent ?? decision.principal.kid;
    const body = parseBody(request.body);
    if (body === null)
      return fail(400, "invalid_body", "Request body must be a JSON object.");
    if (rest === "") {
      if (method === "POST")
        return mint(body, createdBy);
      if (method === "GET")
        return list(path);
      return fail(405, "method_not_allowed", "Use POST to mint a key or GET to list keys.");
    }
    const segments = rest.split("/").filter(Boolean);
    const kid = segments[0] ?? "";
    if (!/^[A-Za-z0-9_-]+$/.test(kid)) {
      return fail(400, "invalid_kid", "Key id must be url-safe (letters, digits, '_' or '-').");
    }
    if (segments.length === 1) {
      if (method === "DELETE")
        return revoke(kid, body);
      if (method === "GET") {
        if (!options.store.findByKid) {
          return fail(501, "not_implemented", "This key store cannot look a key up by kid.");
        }
        const record = await options.store.findByKid(kid);
        if (!record || record.app !== app) {
          return fail(404, "unknown_key", `No key with kid '${kid}' is recorded for '${app}'.`);
        }
        return { status: 200, body: { key: publicRecord(record, clock()) } };
      }
      return fail(405, "method_not_allowed", "Use GET to read a key or DELETE to revoke it.");
    }
    if (segments.length === 2 && segments[1] === "revoke") {
      if (method === "POST")
        return revoke(kid, body);
      return fail(405, "method_not_allowed", "Use POST to revoke a key.");
    }
    return fail(404, "not_found", "No such route.");
  }
  return { basePath, operatorScope, matches, handle };
}
export {
  verifyFleetToken,
  verifyApiKeyToken,
  verifyApiKey,
  tenantIdsEqual,
  signingSecretHasSurroundingWhitespace,
  signingSecretEnvKeys,
  scopeMatches,
  resolveTenantOrg,
  resolveSigningSecret,
  resolveIdentityConfig,
  parseFleetJwks,
  parseApiKey,
  ownTenantId,
  ownScopesClaim,
  ownAgentClaim,
  normalizeTenantId,
  normalizeSigningSecret,
  normalizeScopes,
  mintApiKey,
  keyLifecycleScope,
  isValidTenantId,
  isValidScope,
  isUuidTenantId,
  isConcreteScope,
  identityEnvKeys,
  honoApiKey,
  hashToken,
  hasScope,
  hasAllScopes,
  generateKid,
  extractToken,
  expressApiKey,
  createKeyLifecycleRoutes,
  createIdentityVerifier,
  canonicalizeTenantId,
  apiKeyPrefix,
  apiKeyMigrations,
  TENANT_ID_PATTERN,
  SigningSecretError,
  PRINCIPAL_TYPES,
  MAX_TENANT_ID_LENGTH,
  MAX_IDENTIFIER_LENGTH,
  MAX_FLEET_TOKEN_TTL_SECONDS,
  MAX_FLEET_TOKEN_LEEWAY_SECONDS,
  KEY_LIFECYCLE_SCOPE_ACTION,
  KEY_LIFECYCLE_BASE_PATH,
  FLEET_TOKEN_TYP,
  FLEET_TOKEN_ALG,
  DEFAULT_CLIENT_KEY_TTL_DAYS,
  DEFAULT_API_KEY_TTL_SECONDS,
  DEFAULT_API_KEYS_TABLE,
  ApiKeyStore,
  APP_SLUG_PATTERN,
  API_KEY_TOKEN_VERSION,
  API_KEY_TOKEN_PATTERN,
  API_KEY_NAMESPACE,
  API_KEY_ISSUANCE_PENDING_REASON
};
