// Hasna Notes self-hosted server — auth (personalnotes/v1 dialect §2).
//
// PostgreSQL production auth; isolated SQLite test fixtures keep the dialect's
// `pn_` api keys (sha256-hashed at rest, 12-char prefix) and HS256 JWT
// sessions. The PostgreSQL backend's api_keys table comes from
// @hasna/contracts/auth (ApiKeyStore): keys are minted and verified with the
// signing secret HASNA_NOTES_API_SIGNING_KEY (documented fallbacks
// API_KEY_SIGNING_SECRET, HASNA_API_SIGNING_KEY) as `hasna_notes_` tokens.
// The wire dialect (Bearer authorization, /api/v1 paths, JSON shapes) is
// identical on both backends — clients receive the key from the server and
// never parse its format.
//
// Sessions: HS256 JWT {sub, tid, sid, email, iat, exp}, 7-day TTL, revocable
// via the sessions row. OTP login codes are NEVER written to the server log:
// anyone with log access could complete a login as any user (issue #1542).
// Console delivery for self-hosting remains available as an explicit opt-in
// (HASNA_NOTES_SERVER_AUTH_CONSOLE_CODES=1); without it the server logs only
// a non-secret reference and the code reaches the user out of band or via
// devCode in dev mode.

import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { ApiError } from './http.mjs';
import { nowIso } from './sql.mjs';
import { ApiKeyStore, mintApiKey, verifyApiKey } from '@hasna/contracts/auth';

export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;
const DEVICE_TTL_MS = 10 * 60 * 1000;
const OTP_TTL_MS = 10 * 60 * 1000;

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function generateApiKey() {
  const key = `pn_${randomBytes(30).toString('base64url')}`;
  return { key, prefix: key.slice(0, 12), hash: sha256(key) };
}

/**
 * Resolve the API signing secret for the PostgreSQL backend. The canonical
 * name is HASNA_NOTES_API_SIGNING_KEY, with the documented fallbacks
 * (API_KEY_SIGNING_SECRET, HASNA_API_SIGNING_KEY).
 */
export function resolveSigningSecret(env = process.env) {
  const secret =
    env.HASNA_NOTES_API_SIGNING_KEY ??
    env.API_KEY_SIGNING_SECRET ??
    env.HASNA_API_SIGNING_KEY;
  if (!secret) {
    throw new Error(
      'notes server requires an API signing secret for the postgresql backend: set HASNA_NOTES_API_SIGNING_KEY ' +
        '(or API_KEY_SIGNING_SECRET / HASNA_API_SIGNING_KEY).',
    );
  }
  return secret;
}

// Dialect scopes ('full', 'admin', 'notes_read', 'notes_write') vs the
// contracts scopes model ('*', '<app>:<action>'). 'full'/'admin' mint as
// '*' (everything); read/write mint as 'notes:*'; the mapping is inverted on
// verify so the dialect's scope checks behave identically.
function dialectScopesToContract(scopes) {
  if (!Array.isArray(scopes) || scopes.length === 0) return ['*'];
  if (scopes.includes('full') || scopes.includes('admin')) return ['*'];
  return [...new Set(scopes.map((s) => (s === 'notes_read' || s === 'notes_write' ? 'notes:*' : String(s))))];
}

function contractScopesToDialect(scopes) {
  if (!Array.isArray(scopes)) return ['full'];
  if (scopes.includes('*')) return ['full'];
  const out = new Set();
  for (const s of scopes) {
    if (s === 'notes:*') {
      out.add('notes_read');
      out.add('notes_write');
    } else {
      out.add(String(s));
    }
  }
  return [...out];
}

// --- JWT (HS256, same claim names as the hosted platform) ------------------

function b64(data) {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  return Buffer.from(bytes).toString('base64url');
}

async function hmac(secret, input) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(input));
  return b64(new Uint8Array(sig));
}

export async function signJwt(claims, secret, ttlSeconds) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64(JSON.stringify({ ...claims, iat: now, exp: now + ttlSeconds }));
  return `${header}.${body}.${await hmac(secret, `${header}.${body}`)}`;
}

export async function verifyJwt(token, secret) {
  const [header, body, signature] = String(token).split('.');
  if (!header || !body || !signature) return null;
  if ((await hmac(secret, `${header}.${body}`)) !== signature) return null;
  let claims;
  try {
    claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!claims.exp || claims.exp < Math.floor(Date.now() / 1000)) return null;
  return claims;
}

// --- helpers ----------------------------------------------------------------

export function normalizeEmail(email) {
  return String(email ?? '').trim().toLowerCase();
}

// RFC 5321 caps a forward path at 254 characters, so anything longer is not an
// address. The cap is enforced here, before any caller records the value:
// /auth/login keys per-address state on the normalized string, and an
// unbounded "email" (the only ceiling was the 2 MiB body guard) would end up
// in that key.
export function isValidEmail(email) {
  return String(email ?? '').length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function slugify(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'notes';
}

function rand(n) {
  return randomBytes(n).toString('base64url').replace(/[^a-z0-9]/gi, '').toLowerCase().slice(0, n);
}

function otpCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function userCode() {
  return `${rand(4)}-${rand(4)}`.toUpperCase();
}

function publicUser(u) {
  return { id: u.id, email: u.email, name: u.name, tenantId: u.tenant_id, role: u.role, isPlatformAdmin: Boolean(u.is_platform_admin) };
}

function publicTenant(t) {
  return { id: t.id, name: t.name, slug: t.slug, plan: t.plan };
}

export async function getTenant(db, id) {
  return (await db.query('SELECT * FROM tenants WHERE id = ?').get(id)) ?? null;
}

export async function getUser(db, id) {
  const u = await db.query('SELECT * FROM users WHERE id = ? AND is_active = 1').get(id);
  return u ? publicUser(u) : null;
}

async function findUserByEmail(db, email) {
  return (await db.query('SELECT * FROM users WHERE lower(email) = ?').get(email)) ?? null;
}

async function createSession(db, user) {
  const id = randomUUID();
  const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000).toISOString();
  await db.query('INSERT INTO sessions (id, tenant_id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?, ?)').run(id, user.tenant_id, user.id, expiresAt, nowIso());
  return id;
}

// --- api keys ----------------------------------------------------------------

/**
 * Insert an api key. SQLite: dialect pn_ keys. PostgreSQL: a contracts
 * ApiKeyStore key minted with the signing secret. Returns the dialect wire
 * shape { id, key, prefix, name, scopes }.
 */
export async function insertApiKey(db, { tenantId, name, scopes, createdBy }, config = {}) {
  if (db.backend === 'postgresql') {
    const store = new ApiKeyStore(db.client);
    const minted = mintApiKey({
      app: 'notes',
      scopes: dialectScopesToContract(scopes),
      signingSecret: config.signingSecret,
      tid: tenantId,
      agent: createdBy ?? null,
      ttlSeconds: null,
    });
    await store.insertMinted(minted, createdBy ?? null);
    return { id: minted.kid, key: minted.token, prefix: minted.prefix, name, scopes: contractScopesToDialect(minted.claims.scopes), kid: minted.kid };
  }
  const material = generateApiKey();
  const id = randomUUID();
  await db.query('INSERT INTO api_keys (id, tenant_id, name, prefix, key_hash, scopes, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
    id, tenantId, name, material.prefix, material.hash, JSON.stringify(scopes), createdBy ?? null, nowIso(),
  );
  return { id, key: material.key, prefix: material.prefix, name, scopes };
}

/**
 * Validate a presented bearer credential as an api key. Returns the actor
 * context { tenantId, actorId, keyId, scopes, via } or null.
 */
export async function validateApiKey(db, presented, config = {}) {
  if (db.backend === 'postgresql') {
    if (!presented || !presented.startsWith('hasna_')) return null;
    const store = new ApiKeyStore(db.client);
    const verifier = verifyApiKey({
      app: 'notes',
      signingSecret: config.signingSecret,
      requireTenant: true,
      keyStatus: store.keyStatus,
    });
    const outcome = await verifier.authenticate({ authorization: `Bearer ${presented}` });
    if (!outcome.ok) {
      if (outcome.reason === 'tenant_required' || outcome.reason === 'tenant_mismatch') {
        throw new ApiError('forbidden', outcome.message, 403);
      }
      return null;
    }
    const { principal } = outcome;
    await store.touchLastUsed(principal.kid);
    return {
      tenantId: principal.tid ?? null,
      actorId: principal.agent ?? principal.tid ?? null,
      keyId: principal.kid,
      scopes: contractScopesToDialect(principal.scopes),
      via: 'api_key',
    };
  }
  if (!presented || !presented.startsWith('pn_')) return null;
  const hash = sha256(presented);
  const row = await db.query('SELECT * FROM api_keys WHERE key_hash = ? LIMIT 1').get(hash);
  if (!row || row.revoked_at) return null;
  const a = Buffer.from(row.key_hash);
  const b = Buffer.from(hash);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  await db.query('UPDATE api_keys SET last_used_at = ? WHERE id = ?').run(nowIso(), row.id);
  return { tenantId: row.tenant_id, actorId: row.created_by ?? row.tenant_id, keyId: row.id, scopes: JSON.parse(row.scopes), via: 'api_key' };
}

/** List api keys for a tenant in the dialect wire shape. */
export async function listApiKeys(db, tenantId) {
  if (db.backend === 'postgresql') {
    const store = new ApiKeyStore(db.client);
    const records = await store.list({ app: 'notes', tid: tenantId });
    return records.map((r) => ({
      id: r.kid,
      name: r.agent ?? r.app,
      prefix: 'hasna_notes_',
      scopes: contractScopesToDialect(r.scopes),
      lastUsedAt: r.lastUsedAt,
      revokedAt: r.revokedAt,
      createdAt: r.issuedAt,
    }));
  }
  const rows = await db
    .query('SELECT id, name, prefix, scopes, last_used_at, revoked_at, created_at FROM api_keys WHERE tenant_id = ? ORDER BY created_at DESC')
    .all(tenantId);
  return rows.map((r) => ({ id: r.id, name: r.name, prefix: r.prefix, scopes: JSON.parse(r.scopes), lastUsedAt: r.last_used_at, revokedAt: r.revoked_at, createdAt: r.created_at }));
}

/**
 * First user of a fresh self-hosted server. Single-user-friendly: used by
 * OTP first-login provisioning and by --auto-approve device logins when no
 * account exists yet.
 */
export async function provisionTenantUser(db, { email, name }) {
  const tenantId = randomUUID();
  const userId = randomUUID();
  const tenantName = name || email.split('@')[0] || 'Hasna Notes';
  await db.query('INSERT INTO tenants (id, name, slug, created_at) VALUES (?, ?, ?, ?)').run(tenantId, tenantName, `${slugify(tenantName)}-${rand(5)}`, nowIso());
  await db.query('INSERT INTO users (id, tenant_id, email, name, role, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(userId, tenantId, email, name ?? null, 'owner', nowIso());
  return await db.query('SELECT * FROM users WHERE id = ?').get(userId);
}

export async function defaultUser(db) {
  const existing = await db.query("SELECT * FROM users WHERE is_active = 1 ORDER BY created_at ASC, id ASC LIMIT 1").get();
  if (existing) return existing;
  return provisionTenantUser(db, { email: 'owner@localhost.localdomain', name: 'Owner' });
}

// --- OTP login (§2.2) --------------------------------------------------------

export async function startOtpLogin(db, config, input) {
  const email = normalizeEmail(input.email);
  if (!isValidEmail(email)) throw new ApiError('bad_request', 'a valid email is required', 400);
  const code = otpCode();
  const expiresAt = new Date(Date.now() + OTP_TTL_MS).toISOString();
  await db.query('INSERT INTO otp_login_requests (id, email, code_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)').run(
    randomUUID(), email, sha256(`${email}:${code}`), expiresAt, nowIso(),
  );
  // The one-time code must never reach the log (issue #1542): anyone with log
  // access could request a code for any email and complete the login. Log a
  // non-secret reference by default; print the code only when the self-hosting
  // console-delivery opt-in (HASNA_NOTES_SERVER_AUTH_CONSOLE_CODES=1) is set —
  // the hosted/prod task definition must never set it.
  config.log(`[notes-server] login code requested for ${email} (expires in 10 minutes)`);
  if (config.consoleCodes) {
    config.log(`[notes-server] login code for ${email}: ${code} (expires in 10 minutes)`);
  }
  return { sent: true, email, expiresAt, ...(config.devMode ? { devCode: code } : {}) };
}

/**
 * Invalidate every live login code for an address.
 *
 * Called when too many wrong codes are submitted for that address (app.mjs).
 * The guess budget belongs to the CODE, not to the account: the outstanding
 * code dies and the owner simply asks for a new one. Nothing about the
 * account is disabled, so a stranger who knows an address can cost its owner
 * one extra round trip and nothing more (issue #1542 review).
 */
export async function expireOtpRequests(db, email) {
  const normalized = normalizeEmail(email);
  if (!isValidEmail(normalized)) return;
  await db
    .query("UPDATE otp_login_requests SET status = 'consumed', consumed_at = ? WHERE email = ? AND status = 'pending'")
    .run(nowIso(), normalized);
}

export async function verifyOtp(db, config, input) {
  const email = normalizeEmail(input.email);
  const code = String(input.code ?? '').trim();
  if (!isValidEmail(email) || !code) throw new ApiError('bad_request', 'email and code are required', 400);
  const request = await db
    .query("SELECT * FROM otp_login_requests WHERE email = ? AND status = 'pending' AND expires_at > ? ORDER BY created_at DESC LIMIT 1")
    .get(email, nowIso());
  if (!request || request.code_hash !== sha256(`${email}:${code}`)) throw new ApiError('unauthorized', 'invalid or expired login code', 401);
  await db.query("UPDATE otp_login_requests SET status = 'consumed', consumed_at = ? WHERE id = ?").run(nowIso(), request.id);

  let user = await findUserByEmail(db, email);
  let apiKey;
  if (!user) {
    user = await provisionTenantUser(db, { email, name: input.name });
    // First-time verify auto-provisions tenant + owner + default full-scope
    // API key returned exactly once (§2.2).
    apiKey = (await insertApiKey(db, { tenantId: user.tenant_id, name: 'default', scopes: ['full'], createdBy: user.id }, config)).key;
  }
  if (!user.is_active) throw new ApiError('forbidden', 'account is disabled', 403);
  const tenant = await getTenant(db, user.tenant_id);
  if (!tenant) throw new ApiError('not_found', 'tenant not found', 404);
  const sid = await createSession(db, user);
  const token = await signJwt({ sub: user.id, tid: user.tenant_id, sid, email: user.email }, config.jwtSecret, SESSION_TTL_SECONDS);
  return { token, user: publicUser(user), tenant: publicTenant(tenant), ...(apiKey ? { apiKey } : {}) };
}

// --- bearer validation --------------------------------------------------------

export async function validateSession(db, config, token) {
  const claims = await verifyJwt(token, config.jwtSecret);
  if (!claims?.sub || !claims.tid || !claims.sid) return null;
  const row = await db
    .query(
      `SELECT s.tenant_id AS tenant_id, s.user_id AS user_id, s.revoked_at AS revoked_at, s.expires_at AS expires_at, u.is_active AS is_active
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.id = ? AND s.user_id = ? AND s.tenant_id = ? LIMIT 1`,
    )
    .get(claims.sid, claims.sub, claims.tid);
  if (!row || row.revoked_at || row.expires_at < nowIso() || !row.is_active) return null;
  return { tenantId: row.tenant_id, actorId: row.user_id };
}

export async function revokeSession(db, config, token) {
  const claims = await verifyJwt(token, config.jwtSecret);
  if (!claims?.sid) return;
  await db.query('UPDATE sessions SET revoked_at = ? WHERE id = ?').run(nowIso(), claims.sid);
}

// --- device-code flow (§2.3) ---------------------------------------------------

export async function startDeviceAuth(db, config) {
  const deviceCode = `dc_${randomBytes(32).toString('base64url')}`;
  const code = userCode();
  const expiresAt = new Date(Date.now() + DEVICE_TTL_MS).toISOString();
  const id = randomUUID();
  await db.query('INSERT INTO device_auth_requests (id, device_code_hash, user_code, expires_at, created_at) VALUES (?, ?, ?, ?, ?)').run(
    id, sha256(deviceCode), code, expiresAt, nowIso(),
  );
  return {
    id,
    result: {
      deviceCode,
      userCode: code,
      verificationUri: `${config.publicUrl.replace(/\/$/, '')}/device`,
      expiresAt,
      interval: 5,
    },
  };
}

/** Approve a pending device request for a user (session-authenticated route). */
export async function approveDeviceAuth(db, { userCode: rawCode, userId, tenantId }) {
  const code = String(rawCode ?? '').trim().toUpperCase();
  const request = await db
    .query("SELECT * FROM device_auth_requests WHERE user_code = ? AND status = 'pending' AND expires_at > ? LIMIT 1")
    .get(code, nowIso());
  if (!request) throw new ApiError('not_found', 'device code not found or expired', 404);
  const exchange = `dt_${randomBytes(32).toString('base64url')}`;
  await db.query("UPDATE device_auth_requests SET tenant_id = ?, user_id = ?, status = 'approved', exchange_token_hash = ?, approved_at = ? WHERE id = ?").run(
    tenantId, userId, sha256(exchange), nowIso(), request.id,
  );
  return { approved: true, exchangeToken: exchange };
}

/** --auto-approve: immediately approve a just-started request for the default user. */
export async function autoApproveDeviceAuth(db, requestId) {
  const user = await defaultUser(db);
  await db.query("UPDATE device_auth_requests SET tenant_id = ?, user_id = ?, status = 'approved', approved_at = ? WHERE id = ? AND status = 'pending'").run(
    user.tenant_id, user.id, nowIso(), requestId,
  );
  return user;
}

async function completeDeviceAuth(db, request, config) {
  if (!request.tenant_id || !request.user_id) throw new ApiError('server_misconfigured', 'approved device request is missing tenant or user', 500);
  if (request.consumed_at) throw new ApiError('gone', 'device exchange already consumed', 410);
  const key = await insertApiKey(db, { tenantId: request.tenant_id, name: 'device login', scopes: ['full'], createdBy: request.user_id }, config);
  await db.query("UPDATE device_auth_requests SET status = 'expired', api_key_id = ?, consumed_at = ? WHERE id = ?").run(key.id, nowIso(), request.id);
  return { status: 'approved', approved: true, apiKeyId: key.id, tenantId: request.tenant_id, userId: request.user_id, apiKey: key.key };
}

export async function pollDeviceAuth(db, config, input) {
  const deviceCode = String(input.deviceCode ?? '');
  if (!deviceCode) throw new ApiError('bad_request', 'deviceCode is required', 400);
  const request = await db.query('SELECT * FROM device_auth_requests WHERE device_code_hash = ? LIMIT 1').get(sha256(deviceCode));
  if (!request) throw new ApiError('not_found', 'device request not found', 404);
  if (request.expires_at < nowIso()) throw new ApiError('expired', 'device code expired', 410);
  if (request.consumed_at) throw new ApiError('gone', 'device exchange already consumed', 410);
  if (request.status === 'approved') return completeDeviceAuth(db, request, config);
  return { status: request.status, approved: false, message: request.status === 'pending' ? 'device login is pending' : `device login is ${request.status}` };
}

export async function exchangeDeviceAuth(db, config, input) {
  const token = String(input.exchangeToken ?? '');
  if (!token) throw new ApiError('bad_request', 'exchangeToken is required', 400);
  const request = await db.query('SELECT * FROM device_auth_requests WHERE exchange_token_hash = ? LIMIT 1').get(sha256(token));
  if (!request) throw new ApiError('not_found', 'device exchange not found', 404);
  if (request.expires_at < nowIso()) throw new ApiError('expired', 'device exchange expired', 410);
  if (request.status !== 'approved' || request.consumed_at) throw new ApiError('gone', 'device exchange already consumed', 410);
  return completeDeviceAuth(db, request, config);
}
