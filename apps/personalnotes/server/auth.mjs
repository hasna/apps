// PersonalNotes self-hosted server — auth (personalnotes/v1 dialect §2).
// API keys: `pn_` + base64url(30 bytes), sha256-hashed at rest, 12-char prefix.
// Sessions: HS256 JWT {sub, tid, sid, email, iat, exp}, 7-day TTL, revocable
// via the sessions row. OTP login codes are printed to the server console
// (the dialect allows console delivery instead of email for self-hosting).

import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { ApiError } from './http.mjs';
import { nowIso } from './db.mjs';

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

function normalizeEmail(email) {
  return String(email ?? '').trim().toLowerCase();
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function slugify(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'personalnotes';
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

export function getTenant(db, id) {
  return db.query('SELECT * FROM tenants WHERE id = ?').get(id) ?? null;
}

export function getUser(db, id) {
  const u = db.query('SELECT * FROM users WHERE id = ? AND is_active = 1').get(id);
  return u ? publicUser(u) : null;
}

function findUserByEmail(db, email) {
  return db.query('SELECT * FROM users WHERE lower(email) = ?').get(email) ?? null;
}

function createSession(db, user) {
  const id = randomUUID();
  const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000).toISOString();
  db.query('INSERT INTO sessions (id, tenant_id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?, ?)').run(id, user.tenant_id, user.id, expiresAt, nowIso());
  return id;
}

export function insertApiKey(db, { tenantId, name, scopes, createdBy }) {
  const material = generateApiKey();
  const id = randomUUID();
  db.query('INSERT INTO api_keys (id, tenant_id, name, prefix, key_hash, scopes, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
    id, tenantId, name, material.prefix, material.hash, JSON.stringify(scopes), createdBy ?? null, nowIso(),
  );
  return { id, key: material.key, prefix: material.prefix, name, scopes };
}

/**
 * First user of a fresh self-hosted server. Single-user-friendly: used by
 * OTP first-login provisioning and by --auto-approve device logins when no
 * account exists yet.
 */
export function provisionTenantUser(db, { email, name }) {
  const tenantId = randomUUID();
  const userId = randomUUID();
  const tenantName = name || email.split('@')[0] || 'PersonalNotes';
  db.query('INSERT INTO tenants (id, name, slug, created_at) VALUES (?, ?, ?, ?)').run(tenantId, tenantName, `${slugify(tenantName)}-${rand(5)}`, nowIso());
  db.query('INSERT INTO users (id, tenant_id, email, name, role, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(userId, tenantId, email, name ?? null, 'owner', nowIso());
  return db.query('SELECT * FROM users WHERE id = ?').get(userId);
}

export function defaultUser(db) {
  const existing = db.query("SELECT * FROM users WHERE is_active = 1 ORDER BY created_at ASC, id ASC LIMIT 1").get();
  if (existing) return existing;
  return provisionTenantUser(db, { email: 'owner@localhost.localdomain', name: 'Owner' });
}

// --- OTP login (§2.2) --------------------------------------------------------

export function startOtpLogin(db, config, input) {
  const email = normalizeEmail(input.email);
  if (!isValidEmail(email)) throw new ApiError('bad_request', 'a valid email is required', 400);
  const code = otpCode();
  const expiresAt = new Date(Date.now() + OTP_TTL_MS).toISOString();
  db.query('INSERT INTO otp_login_requests (id, email, code_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)').run(
    randomUUID(), email, sha256(`${email}:${code}`), expiresAt, nowIso(),
  );
  // Self-hosted delivery: print to the server console (dialect §8 allows
  // console-printed codes instead of email).
  config.log(`[personalnotes-server] login code for ${email}: ${code} (expires in 10 minutes)`);
  return { sent: true, email, expiresAt, ...(config.devMode ? { devCode: code } : {}) };
}

export async function verifyOtp(db, config, input) {
  const email = normalizeEmail(input.email);
  const code = String(input.code ?? '').trim();
  if (!isValidEmail(email) || !code) throw new ApiError('bad_request', 'email and code are required', 400);
  const request = db
    .query("SELECT * FROM otp_login_requests WHERE email = ? AND status = 'pending' AND expires_at > ? ORDER BY created_at DESC LIMIT 1")
    .get(email, nowIso());
  if (!request || request.code_hash !== sha256(`${email}:${code}`)) throw new ApiError('unauthorized', 'invalid or expired login code', 401);
  db.query("UPDATE otp_login_requests SET status = 'consumed', consumed_at = ? WHERE id = ?").run(nowIso(), request.id);

  let user = findUserByEmail(db, email);
  let apiKey;
  if (!user) {
    user = provisionTenantUser(db, { email, name: input.name });
    // First-time verify auto-provisions tenant + owner + default full-scope
    // API key returned exactly once (§2.2).
    apiKey = insertApiKey(db, { tenantId: user.tenant_id, name: 'default', scopes: ['full'], createdBy: user.id }).key;
  }
  if (!user.is_active) throw new ApiError('forbidden', 'account is disabled', 403);
  const tenant = getTenant(db, user.tenant_id);
  if (!tenant) throw new ApiError('not_found', 'tenant not found', 404);
  const sid = createSession(db, user);
  const token = await signJwt({ sub: user.id, tid: user.tenant_id, sid, email: user.email }, config.jwtSecret, SESSION_TTL_SECONDS);
  return { token, user: publicUser(user), tenant: publicTenant(tenant), ...(apiKey ? { apiKey } : {}) };
}

// --- bearer validation --------------------------------------------------------

export function validateApiKey(db, presented) {
  if (!presented || !presented.startsWith('pn_')) return null;
  const hash = sha256(presented);
  const row = db.query('SELECT * FROM api_keys WHERE key_hash = ? LIMIT 1').get(hash);
  if (!row || row.revoked_at) return null;
  const a = Buffer.from(row.key_hash);
  const b = Buffer.from(hash);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  db.query('UPDATE api_keys SET last_used_at = ? WHERE id = ?').run(nowIso(), row.id);
  return { tenantId: row.tenant_id, actorId: row.created_by ?? row.tenant_id, keyId: row.id, scopes: JSON.parse(row.scopes), via: 'api_key' };
}

export async function validateSession(db, config, token) {
  const claims = await verifyJwt(token, config.jwtSecret);
  if (!claims?.sub || !claims.tid || !claims.sid) return null;
  const row = db
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
  db.query('UPDATE sessions SET revoked_at = ? WHERE id = ?').run(nowIso(), claims.sid);
}

// --- device-code flow (§2.3) ---------------------------------------------------

export function startDeviceAuth(db, config) {
  const deviceCode = `dc_${randomBytes(32).toString('base64url')}`;
  const code = userCode();
  const expiresAt = new Date(Date.now() + DEVICE_TTL_MS).toISOString();
  const id = randomUUID();
  db.query('INSERT INTO device_auth_requests (id, device_code_hash, user_code, expires_at, created_at) VALUES (?, ?, ?, ?, ?)').run(
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
export function approveDeviceAuth(db, { userCode: rawCode, userId, tenantId }) {
  const code = String(rawCode ?? '').trim().toUpperCase();
  const request = db
    .query("SELECT * FROM device_auth_requests WHERE user_code = ? AND status = 'pending' AND expires_at > ? LIMIT 1")
    .get(code, nowIso());
  if (!request) throw new ApiError('not_found', 'device code not found or expired', 404);
  const exchange = `dt_${randomBytes(32).toString('base64url')}`;
  db.query("UPDATE device_auth_requests SET tenant_id = ?, user_id = ?, status = 'approved', exchange_token_hash = ?, approved_at = ? WHERE id = ?").run(
    tenantId, userId, sha256(exchange), nowIso(), request.id,
  );
  return { approved: true, exchangeToken: exchange };
}

/** --auto-approve: immediately approve a just-started request for the default user. */
export function autoApproveDeviceAuth(db, requestId) {
  const user = defaultUser(db);
  db.query("UPDATE device_auth_requests SET tenant_id = ?, user_id = ?, status = 'approved', approved_at = ? WHERE id = ? AND status = 'pending'").run(
    user.tenant_id, user.id, nowIso(), requestId,
  );
  return user;
}

function completeDeviceAuth(db, request) {
  if (!request.tenant_id || !request.user_id) throw new ApiError('server_misconfigured', 'approved device request is missing tenant or user', 500);
  if (request.consumed_at) throw new ApiError('gone', 'device exchange already consumed', 410);
  const key = insertApiKey(db, { tenantId: request.tenant_id, name: 'device login', scopes: ['full'], createdBy: request.user_id });
  db.query("UPDATE device_auth_requests SET status = 'expired', api_key_id = ?, consumed_at = ? WHERE id = ?").run(key.id, nowIso(), request.id);
  return { status: 'approved', approved: true, apiKeyId: key.id, tenantId: request.tenant_id, userId: request.user_id, apiKey: key.key };
}

export function pollDeviceAuth(db, input) {
  const deviceCode = String(input.deviceCode ?? '');
  if (!deviceCode) throw new ApiError('bad_request', 'deviceCode is required', 400);
  const request = db.query('SELECT * FROM device_auth_requests WHERE device_code_hash = ? LIMIT 1').get(sha256(deviceCode));
  if (!request) throw new ApiError('not_found', 'device request not found', 404);
  if (request.expires_at < nowIso()) throw new ApiError('expired', 'device code expired', 410);
  if (request.consumed_at) throw new ApiError('gone', 'device exchange already consumed', 410);
  if (request.status === 'approved') return completeDeviceAuth(db, request);
  return { status: request.status, approved: false, message: request.status === 'pending' ? 'device login is pending' : `device login is ${request.status}` };
}

export function exchangeDeviceAuth(db, input) {
  const token = String(input.exchangeToken ?? '');
  if (!token) throw new ApiError('bad_request', 'exchangeToken is required', 400);
  const request = db.query('SELECT * FROM device_auth_requests WHERE exchange_token_hash = ? LIMIT 1').get(sha256(token));
  if (!request) throw new ApiError('not_found', 'device exchange not found', 404);
  if (request.expires_at < nowIso()) throw new ApiError('expired', 'device exchange expired', 410);
  if (request.status !== 'approved' || request.consumed_at) throw new ApiError('gone', 'device exchange already consumed', 410);
  return completeDeviceAuth(db, request);
}
