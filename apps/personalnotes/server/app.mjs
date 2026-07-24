// PersonalNotes self-hosted server — Hono app (personalnotes/v1 dialect).
// Reference implementation: one SQLite file, no billing/credits/multi-tenant
// admin — those are hosted-platform concerns and out of the dialect (§8).

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { randomBytes } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { ApiError, errorBody, mapError, bearer, parseLimit } from './http.mjs';
import { getMeta, setMeta } from './db.mjs';
import {
  approveDeviceAuth, autoApproveDeviceAuth, exchangeDeviceAuth, getTenant, getUser, insertApiKey,
  pollDeviceAuth, revokeSession, startDeviceAuth, startOtpLogin, validateApiKey, validateSession, verifyOtp,
} from './auth.mjs';
import { createNote, deleteNote, exportNotes, getNote, listNotes, syncNotes, updateNote } from './notes.mjs';

export const VERSION = '0.1.0';
export const SERVICE = 'personalnotes-server';
export const DEFAULT_PORT = 8788;
export const DEFAULT_DB_PATH = join(homedir(), '.hasna', 'apps', 'notes-server', 'server.db');
const REQUEST_MAX_BYTES = 2 * 1024 * 1024;

/** Config from env + argv. Zero-ops defaults: loopback bind, single SQLite file. */
export function resolveConfig(env = process.env, argv = []) {
  const flag = (name) => argv.includes(name);
  const flagValue = (name) => {
    const i = argv.indexOf(name);
    return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : undefined;
  };
  const host = flagValue('--host') ?? (flag('--host') ? '0.0.0.0' : undefined) ?? env.PERSONALNOTES_SERVER_HOST ?? '127.0.0.1';
  const port = Number(flagValue('--port') ?? env.PERSONALNOTES_SERVER_PORT ?? env.PORT ?? DEFAULT_PORT);
  return {
    host,
    port,
    dbPath: flagValue('--db') ?? env.PERSONALNOTES_SERVER_DB ?? DEFAULT_DB_PATH,
    publicUrl: env.PERSONALNOTES_SERVER_URL ?? `http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`,
    // --auto-approve: single-user convenience — device logins from loopback
    // are approved automatically for the (auto-provisioned) owner account.
    autoApprove: flag('--auto-approve') || env.PERSONALNOTES_SERVER_AUTO_APPROVE === '1',
    // Dev mode: include devCode in OTP login responses (platform authDevMode parity).
    devMode: flag('--dev') || env.PERSONALNOTES_SERVER_DEV === '1',
    jwtSecret: env.PERSONALNOTES_SERVER_JWT_SECRET, // default: generated + persisted in the DB meta table
    log: console.log,
  };
}

function isLoopback(ip) {
  return ip === '::1' || ip === '::ffff:127.0.0.1' || String(ip ?? '').startsWith('127.');
}

export function createApp({ db, config }) {
  const cfg = { ...config };
  if (!cfg.jwtSecret) {
    // Zero-ops: persist a generated secret so sessions survive restarts.
    let secret = getMeta(db, 'jwt_secret');
    if (!secret) {
      secret = randomBytes(32).toString('base64url');
      setMeta(db, 'jwt_secret', secret);
    }
    cfg.jwtSecret = secret;
  }
  cfg.log = cfg.log ?? console.log;

  const app = new Hono();
  const rateBuckets = new Map();

  app.onError((err, c) => {
    const m = mapError(err);
    if (m.code === 'internal_error') console.error(`[${SERVICE}] request failed`, err);
    return c.json(errorBody(m.code, m.message, m.details), m.status);
  });

  app.use('*', cors({
    origin: (origin) => origin ?? '*',
    allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['authorization', 'content-type', 'idempotency-key'],
    maxAge: 86400,
  }));

  app.use('*', async (c, next) => {
    const length = Number(c.req.header('content-length') ?? '0');
    if (Number.isFinite(length) && length > REQUEST_MAX_BYTES) {
      return c.json(errorBody('payload_too_large', 'request body exceeds configured size limit'), 413);
    }
    await next();
  });

  const health = (c) => c.json({ status: 'healthy', service: SERVICE, version: VERSION });
  app.get('/health', health);
  app.get('/api/v1/health', health); // optional alias allowed by §1
  const discovery = (c) => c.json({ version: VERSION, service: SERVICE, dialect: 'personalnotes/v1', open_source: '@hasna/personalnotes' });
  app.get('/api/v1', discovery);
  app.get('/api/v1/', discovery);
  app.get('/favicon.ico', (c) => c.body(null, 204));
  app.get('/device', (c) =>
    c.html(
      `<!doctype html><html><head><meta charset="utf-8"><title>PersonalNotes Device Login</title></head><body><main><h1>PersonalNotes Device Login</h1><p>Sign in with <code>POST /api/v1/auth/login</code> + <code>/verify</code> (the code is printed on the server console), then approve your device code with <code>POST /api/v1/auth/device/approve {"userCode":"XXXX-XXXX"}</code> using the session token. Self-hosted tip: start the server with <code>--auto-approve</code> and device logins from this machine complete automatically.</p></main></body></html>`,
    ),
  );

  const rateLimit = (c, name, max, windowMs = 60 * 60 * 1000) => {
    const ip = c.env?.ip || 'unknown';
    const key = `${name}:${ip}`;
    const now = Date.now();
    const current = rateBuckets.get(key);
    if (!current || current.resetAt < now) {
      rateBuckets.set(key, { count: 1, resetAt: now + windowMs });
      return;
    }
    current.count += 1;
    if (current.count > max) throw new ApiError('rate_limited', 'too many requests; try again later', 429);
  };

  const jsonBody = (c) => c.req.json().catch(() => ({}));

  // Auth routes are mirrored unversioned under /api/auth/* (dialect §1).
  for (const prefix of ['/api/auth', '/api/v1/auth']) {
    app.post(`${prefix}/login`, async (c) => {
      rateLimit(c, 'otp', 5);
      return c.json(startOtpLogin(db, cfg, await jsonBody(c)));
    });
    app.post(`${prefix}/verify`, async (c) => {
      rateLimit(c, 'otp_verify', 20);
      return c.json(await verifyOtp(db, cfg, await jsonBody(c)));
    });
    app.post(`${prefix}/device/start`, (c) => {
      rateLimit(c, 'device_start', 20);
      const { id, result } = startDeviceAuth(db, cfg);
      if (cfg.autoApprove && isLoopback(c.env?.ip)) {
        const user = autoApproveDeviceAuth(db, id);
        cfg.log(`[${SERVICE}] auto-approved device login ${result.userCode} for ${user.email} (loopback + --auto-approve)`);
      } else {
        cfg.log(`[${SERVICE}] device login requested: code ${result.userCode} — approve at ${result.verificationUri} or POST /api/v1/auth/device/approve with a signed-in session`);
      }
      return c.json(result, 201);
    });
    app.post(`${prefix}/device/token`, async (c) => {
      rateLimit(c, 'device_poll', 120);
      return c.json(pollDeviceAuth(db, await jsonBody(c)));
    });
    app.post(`${prefix}/device/exchange`, async (c) => {
      rateLimit(c, 'device_exchange', 60);
      return c.json(exchangeDeviceAuth(db, await jsonBody(c)));
    });
  }

  // Everything else under /api/v1 requires a bearer credential.
  app.use('/api/v1/*', async (c, next) => {
    const path = c.req.path;
    if (
      path === '/api/v1' || path === '/api/v1/' || path === '/api/v1/health' ||
      path.startsWith('/api/v1/auth/login') || path.startsWith('/api/v1/auth/verify') ||
      path.startsWith('/api/v1/auth/device/start') || path.startsWith('/api/v1/auth/device/token') ||
      path.startsWith('/api/v1/auth/device/exchange')
    ) {
      return next();
    }
    const token = bearer(c.req.header('authorization'));
    const keyCtx = validateApiKey(db, token);
    const ctx = keyCtx ?? (await validateSession(db, cfg, token).then((s) => (s ? { ...s, scopes: ['full'], via: 'session' } : null)));
    if (!ctx) return c.json(errorBody('unauthorized', 'valid session or PersonalNotes API key required'), 401);
    c.set('auth', ctx);
    c.set('tenantId', ctx.tenantId);
    c.set('actor', { type: ctx.via === 'api_key' ? 'api_key' : 'user', id: ctx.actorId });
    await next();
  });

  const hasScope = (auth, scope) => auth.scopes.includes('full') || auth.scopes.includes('admin') || auth.scopes.includes(scope);
  const requireScope = (c, scope) => {
    if (!hasScope(c.get('auth'), scope)) throw new ApiError('forbidden', `${scope} scope required`, 403);
  };
  const requireUserSession = (c) => {
    if (c.get('auth').via !== 'session' || c.get('actor').type !== 'user') throw new ApiError('forbidden', 'user session required', 403);
  };

  app.get('/api/v1/auth/whoami', (c) => {
    const actor = c.get('actor');
    const user = actor.type === 'user' ? getUser(db, actor.id) : null;
    const tenant = getTenant(db, c.get('tenantId'));
    return c.json({
      user,
      tenant: tenant ? { id: tenant.id, name: tenant.name, slug: tenant.slug, plan: tenant.plan } : null,
      auth: { via: c.get('auth').via, scopes: c.get('auth').scopes },
    });
  });

  app.post('/api/v1/auth/logout', async (c) => {
    await revokeSession(db, cfg, bearer(c.req.header('authorization')));
    return c.json({ ok: true });
  });

  app.post('/api/v1/auth/device/approve', async (c) => {
    requireUserSession(c);
    const body = await jsonBody(c);
    return c.json(approveDeviceAuth(db, { userCode: body.userCode, userId: c.get('actor').id, tenantId: c.get('tenantId') }));
  });

  app.get('/api/v1/api-keys', (c) => {
    requireScope(c, 'admin');
    const rows = db
      .query('SELECT id, name, prefix, scopes, last_used_at, revoked_at, created_at FROM api_keys WHERE tenant_id = ? ORDER BY created_at DESC')
      .all(c.get('tenantId'))
      .map((r) => ({ id: r.id, name: r.name, prefix: r.prefix, scopes: JSON.parse(r.scopes), lastUsedAt: r.last_used_at, revokedAt: r.revoked_at, createdAt: r.created_at }));
    return c.json({ data: rows });
  });

  app.post('/api/v1/api-keys', async (c) => {
    requireScope(c, 'admin');
    const body = await jsonBody(c);
    const created = insertApiKey(db, {
      tenantId: c.get('tenantId'),
      name: body.name ?? 'CLI',
      scopes: body.scopes?.length ? body.scopes : ['full'],
      createdBy: c.get('actor').type === 'user' ? c.get('actor').id : null,
    });
    return c.json({ key: created.key, api_key: { id: created.id, name: created.name, prefix: created.prefix, scopes: created.scopes } }, 201);
  });

  app.get('/api/v1/notes', (c) => {
    requireScope(c, 'notes_read');
    const { data, nextCursor } = listNotes(db, c.get('tenantId'), {
      limit: parseLimit(c.req.query('limit'), 50, 200),
      includeDeleted: c.req.query('include_deleted') === '1',
      cursor: c.req.query('cursor'),
    });
    return c.json({ data, nextCursor });
  });

  app.post('/api/v1/notes', async (c) => {
    requireScope(c, 'notes_write');
    rateLimit(c, 'note_write', 300);
    return c.json(createNote(db, c.get('tenantId'), await jsonBody(c), c.get('actor')), 201);
  });

  app.get('/api/v1/notes/:id', (c) => {
    requireScope(c, 'notes_read');
    return c.json(getNote(db, c.get('tenantId'), c.req.param('id')));
  });

  app.patch('/api/v1/notes/:id', async (c) => {
    requireScope(c, 'notes_write');
    rateLimit(c, 'note_write', 300);
    return c.json(updateNote(db, c.get('tenantId'), c.req.param('id'), await jsonBody(c), c.get('actor')));
  });

  app.delete('/api/v1/notes/:id', (c) => {
    requireScope(c, 'notes_write');
    return c.json(deleteNote(db, c.get('tenantId'), c.req.param('id'), c.get('actor')));
  });

  app.post('/api/v1/sync', async (c) => {
    requireScope(c, 'notes_write');
    rateLimit(c, 'sync', 120);
    return c.json(syncNotes(db, c.get('tenantId'), await jsonBody(c), c.req.header('idempotency-key'), c.get('actor')));
  });

  app.post('/api/v1/export', (c) => {
    requireScope(c, 'notes_read');
    return c.json(exportNotes(db, c.get('tenantId')));
  });

  return app;
}
