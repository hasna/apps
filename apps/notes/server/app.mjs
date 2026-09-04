// Hasna Notes self-hosted server — Hono app (personalnotes/v1 dialect).
// Production server: PostgreSQL through HASNA_NOTES_DATABASE_URL. SQLite may
// be injected by isolated tests/import tooling, but notes-serve never selects
// it and it is not an authoritative runtime backend.

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { ApiError, errorBody, mapError, bearer, parseLimit } from './http.mjs';
import { getMeta, setMeta } from './sql.mjs';
import { serverEnv } from './env.mjs';
import {
  approveDeviceAuth, autoApproveDeviceAuth, exchangeDeviceAuth, expireOtpRequests, getTenant, getUser,
  insertApiKey, isValidEmail, listApiKeys, normalizeEmail, pollDeviceAuth, resolveSigningSecret,
  revokeSession, startDeviceAuth, startOtpLogin, validateApiKey, validateSession, verifyOtp,
} from './auth.mjs';
import { createNote, deleteNote, exportNotes, getNote, listNotes, updateNote } from './notes.mjs';

// I38-00565: the server's version was a hardcoded constant that drifted from
// the app manifest (reported 0.1.0 while the source was 0.3.0), so the live
// /version lied about the deployed image. The version now comes from the app
// manifest — the same file the version wave bumps and the same file the
// Docker image ships as /app/package.json — so it cannot drift again.
const MANIFEST = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
export const VERSION = MANIFEST.version;
export const SERVICE = 'notes-server';
export const DEFAULT_PORT = 8788;
const REQUEST_MAX_BYTES = 2 * 1024 * 1024;

/** Non-storage config from env + argv. Storage is resolved only by openStorage. */
export function resolveConfig(env = process.env, argv = []) {
  const flag = (name) => argv.includes(name);
  const flagValue = (name) => {
    const i = argv.indexOf(name);
    return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : undefined;
  };
  const host = flagValue('--host') ?? (flag('--host') ? '0.0.0.0' : undefined) ?? serverEnv(env, 'HOST') ?? '127.0.0.1';
  const port = Number(flagValue('--port') ?? serverEnv(env, 'PORT') ?? env.PORT ?? DEFAULT_PORT);
  if (argv.some((arg) => arg === '--db' || arg.startsWith('--db=')) || Object.hasOwn(env, 'HASNA_NOTES_SERVER_DB')) {
    throw new Error('notes-server: --db and HASNA_NOTES_SERVER_DB were removed; configure server PostgreSQL with HASNA_NOTES_DATABASE_URL.');
  }
  return {
    host,
    port,
    publicUrl: serverEnv(env, 'URL') ?? `http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`,
    // --auto-approve: single-user convenience — device logins from loopback
    // are approved automatically for the (auto-provisioned) owner account.
    autoApprove: flag('--auto-approve') || serverEnv(env, 'AUTO_APPROVE') === '1',
    // Dev mode: include devCode in OTP login responses (platform authDevMode parity).
    devMode: flag('--dev') || serverEnv(env, 'DEV') === '1',
    // Console delivery of OTP login codes (self-hosting). Explicit opt-in;
    // never set in hosted/prod deploys — codes written to the log would let
    // anyone with log access log in as any user (issue #1542).
    consoleCodes: serverEnv(env, 'AUTH_CONSOLE_CODES') === '1',
    jwtSecret: serverEnv(env, 'JWT_SECRET'), // default: generated + persisted in the DB meta table
    env,
    log: console.log,
  };
}

function isLoopback(ip) {
  return ip === '::1' || ip === '::ffff:127.0.0.1' || String(ip ?? '').startsWith('127.');
}

// The personalnotes/v1 wire dialect, documented as OpenAPI (the future hosted
// wrapper speaks this same dialect — documented, not renamed).
const OPENAPI_DOC = {
  openapi: '3.1.0',
  info: {
    title: 'Hasna Notes API — personalnotes/v1 wire dialect',
    version: VERSION,
    description: 'The self-hosted Hasna Notes server API. Clients authenticate with a Bearer api key (the key is issued by the server at first login).',
  },
  paths: {
    '/health': { get: { summary: 'liveness probe', responses: { 200: { description: 'healthy' } } } },
    '/ready': { get: { summary: 'readiness probe incl. storage backend', responses: { 200: { description: 'ready' } } } },
    '/version': { get: { summary: 'server version', responses: { 200: { description: 'version' } } } },
    '/api/v1': { get: { summary: 'dialect discovery', responses: { 200: { description: 'dialect metadata' } } } },
    '/api/v1/auth/login': { post: { summary: 'request an OTP login code', responses: { 200: { description: 'sent' } } } },
    '/api/v1/auth/verify': { post: { summary: 'verify the OTP code; first login provisions tenant + api key', responses: { 200: { description: 'session token and optional api key' } } } },
    '/api/v1/notes': { get: { summary: 'list notes' }, post: { summary: 'create a note' } },
    '/api/v1/notes/{id}': { get: { summary: 'get a note' }, patch: { summary: 'update a note' }, delete: { summary: 'soft-delete a note' } },
    '/api/v1/export': { post: { summary: 'export notes' } },
  },
};

export async function createApp({ db, config, testOnlySqlite = false }) {
  if (db?.backend !== 'postgresql' && !(testOnlySqlite && db?.backend === 'sqlite')) {
    throw new Error('notes-server: PostgreSQL is required; SQLite is isolated test-only storage.');
  }
  const cfg = { ...config };
  if (!cfg.jwtSecret) {
    // Zero-ops: persist a generated secret so sessions survive restarts.
    let secret = await getMeta(db, 'jwt_secret');
    if (!secret) {
      secret = randomBytes(32).toString('base64url');
      await setMeta(db, 'jwt_secret', secret);
    }
    cfg.jwtSecret = secret;
  }
  // The PostgreSQL backend authenticates api keys through @hasna/contracts
  // auth, which requires the signing secret (canonical HASNA_NOTES_API_SIGNING_KEY
  // with the documented fallbacks).
  if (db.backend === 'postgresql' && !cfg.signingSecret) {
    cfg.signingSecret = resolveSigningSecret(cfg.env ?? process.env);
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
  // Contract endpoints: readiness and version are required by the service
  // contract for a supported API surface (see hasna.contract.json).
  // Readiness reports the selected storage backend — never the DSN.
  const readiness = (c) => c.json({ status: 'ready', service: SERVICE, version: VERSION, backend: db.backend, store: db.backend });
  app.get('/ready', readiness);
  const versionInfo = (c) => c.json({ version: VERSION, service: SERVICE });
  app.get('/version', versionInfo);
  const discovery = (c) => c.json({ version: VERSION, service: SERVICE, dialect: 'personalnotes/v1', open_source: '@hasna/notes' });
  app.get('/api/v1', discovery);
  app.get('/api/v1/', discovery);
  app.get('/openapi.json', (c) => c.json(OPENAPI_DOC));
  app.get('/favicon.ico', (c) => c.body(null, 204));
  app.get('/device', (c) =>
    c.html(
      `<!doctype html><html><head><meta charset="utf-8"><title>Hasna Notes Device Login</title></head><body><main><h1>Hasna Notes Device Login</h1><p>Sign in with <code>POST /api/v1/auth/login</code> + <code>/verify</code> (one-time login codes are never written to the server log), then approve your device code with <code>POST /api/v1/auth/device/approve {"userCode":"XXXX-XXXX"}</code> using the session token. Self-hosted tip: start the server with <code>--auto-approve</code> and device logins from this machine complete automatically. Self-hosters that need login codes on the server console must opt in explicitly: <code>HASNA_NOTES_SERVER_AUTH_CONSOLE_CODES=1</code>.</p></main></body></html>`,
    ),
  );

  // Count one hit against `key`, rejecting with 429 past `max` per window.
  // Once past 10k entries, buckets whose window has already closed are swept
  // on the way in, so the map is bounded by the arrival rate inside one window
  // rather than by total distinct keys ever seen (buckets still inside their
  // window are live protection and are never dropped).
  const countAgainst = (key, max, windowMs) => {
    const now = Date.now();
    if (rateBuckets.size > 10000) {
      for (const [k, v] of rateBuckets) if (v.resetAt < now) rateBuckets.delete(k);
    }
    const current = rateBuckets.get(key);
    if (!current || current.resetAt < now) {
      rateBuckets.set(key, { count: 1, resetAt: now + windowMs });
      return;
    }
    current.count += 1;
    if (current.count > max) throw new ApiError('rate_limited', 'too many requests; try again later', 429);
  };

  const rateLimit = (c, name, max, windowMs = 60 * 60 * 1000) => {
    const ip = c.env?.ip || 'unknown';
    countAgainst(`${name}:${ip}`, max, windowMs);
  };

  // --- per-target-address controls for passwordless login (issue #1542) -----
  //
  // A per-IP limit alone still lets a distributed caller mint unlimited live
  // login codes for ONE address, and grind its 6-digit code from as many
  // addresses as it likes. The target address therefore needs a limit of its
  // own — but NOT an hourly quota.
  //
  // A quota counted on a key the CALLER chooses (someone else's email) is an
  // account-lockout primitive: anyone who knows an address spends its budget
  // from throwaway IPs and keeps the owner out for the rest of the window,
  // renewably, for as long as they care to. That trades a code flood for a
  // sustained denial of login on every account, which is the worse of the two.
  // Both dimensions below are shaped to bound an attacker's volume without
  // ever refusing the address owner:
  //
  //   /auth/login   a MIN-INTERVAL between minted codes (`otpCooldownMs`).
  //     Inside the interval the request is answered 200 with the envelope of
  //     the code that is already outstanding; nothing new is minted, logged or
  //     delivered. Every code for an address is delivered only to that address,
  //     so its owner already holds a usable one and the caller learns nothing
  //     it did not already know. Mint rate: 1 per interval, not unbounded.
  //
  //   /auth/verify  consecutive wrong codes are counted per address across all
  //     source IPs and BURN THE CODE (never the account) at
  //     OTP_MAX_FAILED_ATTEMPTS. Guessing is bounded at that many tries per
  //     issued code — far tighter than any per-hour cap — and the owner
  //     recovers with one more /auth/login: the burn clears the cooldown, so
  //     the next request mints immediately. A successful verify clears both
  //     counters.
  //
  // Both maps, like every rate bucket above, live in THIS process: behind
  // several tasks the ceilings are per task. They are keyed only by addresses
  // that already passed validation (capped at 254 chars) and every entry
  // expires, so a caller cannot grow them with junk.
  const OTP_MAX_FAILED_ATTEMPTS = 10;
  const OTP_FAILURE_WINDOW_MS = 10 * 60 * 1000; // the code's own lifetime
  const otpCooldownMs = Number.isFinite(cfg.otpCooldownMs) ? cfg.otpCooldownMs : 60 * 1000;
  const otpOutstanding = new Map(); // email -> { expiresAt, response }
  const otpFailures = new Map(); // email -> { expiresAt, count }

  const pruneExpired = (map, now) => {
    if (map.size <= 10000) return;
    for (const [k, v] of map) if (v.expiresAt <= now) map.delete(k);
  };

  /** The normalized address of a login request, or null when it is not one. */
  const loginEmail = (value) => {
    const normalized = normalizeEmail(value);
    return isValidEmail(normalized) ? normalized : null;
  };

  const forgetOtpState = (email) => {
    if (!email) return;
    otpOutstanding.delete(email);
    otpFailures.delete(email);
  };

  const countFailedOtp = async (email) => {
    const now = Date.now();
    const current = otpFailures.get(email);
    const bucket = current && current.expiresAt > now
      ? current
      : { count: 0, expiresAt: now + OTP_FAILURE_WINDOW_MS };
    bucket.count += 1;
    if (bucket.count < OTP_MAX_FAILED_ATTEMPTS) {
      pruneExpired(otpFailures, now);
      otpFailures.set(email, bucket);
      return;
    }
    // Budget spent: kill the authenticator, not the account, and clear the
    // cooldown so the owner's very next /auth/login mints a fresh code.
    forgetOtpState(email);
    await expireOtpRequests(db, email);
  };

  const jsonBody = (c) => c.req.json().catch(() => ({}));

  // Auth routes are mirrored unversioned under /api/auth/* (dialect §1).
  for (const prefix of ['/api/auth', '/api/v1/auth']) {
    app.post(`${prefix}/login`, async (c) => {
      rateLimit(c, 'otp', 5);
      const body = await jsonBody(c);
      const email = loginEmail(body?.email);
      const now = Date.now();
      const outstanding = email ? otpOutstanding.get(email) : undefined;
      // Inside the min-interval: hand back the outstanding code's envelope
      // without minting a second one. The owner is never refused (see above).
      if (outstanding && outstanding.expiresAt > now) return c.json(outstanding.response);
      const response = await startOtpLogin(db, cfg, body);
      if (email) {
        // A fresh code carries a fresh guess budget.
        otpFailures.delete(email);
        if (otpCooldownMs > 0) {
          pruneExpired(otpOutstanding, now);
          otpOutstanding.set(email, { expiresAt: now + otpCooldownMs, response });
        }
      }
      return c.json(response);
    });
    app.post(`${prefix}/verify`, async (c) => {
      rateLimit(c, 'otp_verify', 20);
      const body = await jsonBody(c);
      const email = loginEmail(body?.email);
      try {
        const result = await verifyOtp(db, cfg, body);
        // Possession proven: drop the guess counter and the spent code's
        // cooldown, so neither a burst of wrong guesses nor this login can
        // delay the owner's next one. Clear this source's verify bucket too.
        forgetOtpState(email);
        rateBuckets.delete(`otp_verify:${c.env?.ip || 'unknown'}`);
        return c.json(result);
      } catch (error) {
        // 401 is "no live code, or the wrong one" — a guess against the code.
        if (email && error instanceof ApiError && error.status === 401) await countFailedOtp(email);
        throw error;
      }
    });
    app.post(`${prefix}/device/start`, async (c) => {
      rateLimit(c, 'device_start', 20);
      const { id, result } = await startDeviceAuth(db, cfg);
      // One-time pairing codes never go to the log (issue #1542) — the user
      // sees them via the API response the client displays.
      if (cfg.autoApprove && isLoopback(c.env?.ip)) {
        const user = await autoApproveDeviceAuth(db, id);
        cfg.log(`[${SERVICE}] auto-approved device login for ${user.email} (loopback + --auto-approve)`);
      } else {
        cfg.log(`[${SERVICE}] device login requested — approve at ${result.verificationUri} or POST /api/v1/auth/device/approve with a signed-in session`);
      }
      return c.json(result, 201);
    });
    app.post(`${prefix}/device/token`, async (c) => {
      rateLimit(c, 'device_poll', 120);
      return c.json(await pollDeviceAuth(db, cfg, await jsonBody(c)));
    });
    app.post(`${prefix}/device/exchange`, async (c) => {
      rateLimit(c, 'device_exchange', 60);
      return c.json(await exchangeDeviceAuth(db, cfg, await jsonBody(c)));
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
    const keyCtx = await validateApiKey(db, token, cfg);
    const ctx = keyCtx ?? (await validateSession(db, cfg, token).then((s) => (s ? { ...s, scopes: ['full'], via: 'session' } : null)));
    if (!ctx) return c.json(errorBody('unauthorized', 'valid session or Hasna Notes API key required'), 401);
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

  app.get('/api/v1/auth/whoami', async (c) => {
    const actor = c.get('actor');
    const user = actor.type === 'user' ? await getUser(db, actor.id) : null;
    const tenant = await getTenant(db, c.get('tenantId'));
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
    return c.json(await approveDeviceAuth(db, { userCode: body.userCode, userId: c.get('actor').id, tenantId: c.get('tenantId') }));
  });

  app.get('/api/v1/api-keys', async (c) => {
    requireScope(c, 'admin');
    return c.json({ data: await listApiKeys(db, c.get('tenantId')) });
  });

  app.post('/api/v1/api-keys', async (c) => {
    requireScope(c, 'admin');
    const body = await jsonBody(c);
    const created = await insertApiKey(db, {
      tenantId: c.get('tenantId'),
      name: body.name ?? 'CLI',
      scopes: body.scopes?.length ? body.scopes : ['full'],
      createdBy: c.get('actor').type === 'user' ? c.get('actor').id : null,
    }, cfg);
    return c.json({ key: created.key, api_key: { id: created.id, name: created.name, prefix: created.prefix, scopes: created.scopes } }, 201);
  });

  app.get('/api/v1/notes', async (c) => {
    requireScope(c, 'notes_read');
    const { data, nextCursor } = await listNotes(db, c.get('tenantId'), {
      limit: parseLimit(c.req.query('limit'), 50, 200),
      includeDeleted: c.req.query('include_deleted') === '1',
      cursor: c.req.query('cursor'),
    });
    return c.json({ data, nextCursor });
  });

  app.post('/api/v1/notes', async (c) => {
    requireScope(c, 'notes_write');
    rateLimit(c, 'note_write', 300);
    return c.json(await createNote(db, c.get('tenantId'), await jsonBody(c), c.get('actor')), 201);
  });

  app.get('/api/v1/notes/:id', async (c) => {
    requireScope(c, 'notes_read');
    return c.json(await getNote(db, c.get('tenantId'), c.req.param('id')));
  });

  app.patch('/api/v1/notes/:id', async (c) => {
    requireScope(c, 'notes_write');
    rateLimit(c, 'note_write', 300);
    return c.json(await updateNote(db, c.get('tenantId'), c.req.param('id'), await jsonBody(c), c.get('actor')));
  });

  app.delete('/api/v1/notes/:id', async (c) => {
    requireScope(c, 'notes_write');
    return c.json(await deleteNote(db, c.get('tenantId'), c.req.param('id'), c.get('actor')));
  });

  app.post('/api/v1/export', async (c) => {
    requireScope(c, 'notes_read');
    return c.json(await exportNotes(db, c.get('tenantId')));
  });

  return app;
}
