// notes-server edge test suite — agent-authored (SOL consult refused: the
// fleet ChatGPT codex lane was at capacity; see the task receipt).
//
// Covers gaps the existing server.test.mjs leaves open: OTP failure paths and
// rate limiting, scoped API keys and the requireScope 403 matrix, cross-tenant
// isolation (including per-tenant seq counters), notes CRUD edge conditions
// (empty titles, label cap, folder:null, pinned/archived, revisions, hashes),
// the payload size guard, and the http.mjs helper contracts.
// Run: bun test (from the app root or this directory).

import { describe, expect, test } from 'bun:test';
import { openDb } from './db.mjs';
import { createApp, resolveConfig } from './app.mjs';
import { sha256 } from './auth.mjs';
import { parsePeerList } from './client-ip.mjs';
import { ApiError, errorBody, mapError, bearer, parseLimit } from './http.mjs';

const LOOPBACK = { ip: '127.0.0.1' };

async function makeApp(overrides = {}) {
  const db = openDb(':memory:');
  const config = { ...resolveConfig({}, []), devMode: true, log: () => {}, ...overrides };
  return { db, app: await createApp({ db, config, testOnlySqlite: true }) };
}

function call(app, method, path, { token, body, env = LOOPBACK, headers: extra = {} } = {}) {
  const headers = { 'content-type': 'application/json', ...extra };
  if (token) headers.authorization = `Bearer ${token}`;
  return app.request(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }, env);
}

async function login(app, email = 'owner@example.com') {
  const started = await (await call(app, 'POST', '/v1/auth/login', { body: { email } })).json();
  const res = await call(app, 'POST', '/v1/auth/verify', { body: { email, code: started.devCode, requestId: started.requestId } });
  expect(res.status).toBe(200);
  return res.json(); // { token, user, tenant, apiKey? }
}

describe('http helpers', () => {
  test('parseLimit: fallback on junk, clamp at max, floor at the integer', () => {
    expect(parseLimit(undefined)).toBe(50);
    expect(parseLimit('abc')).toBe(50);
    expect(parseLimit('0')).toBe(50);
    expect(parseLimit('-5')).toBe(50);
    expect(parseLimit('12.7')).toBe(12);
    expect(parseLimit('500')).toBe(200);
    expect(parseLimit('200')).toBe(200);
    expect(parseLimit('7', 10)).toBe(7);
  });

  test('bearer: only a Bearer scheme yields a token', () => {
    expect(bearer(undefined)).toBe('');
    expect(bearer('')).toBe('');
    expect(bearer('Basic dXNlcjpwYXNz')).toBe('');
    expect(bearer('Bearer tok')).toBe('tok');
    expect(bearer('bearer tok')).toBe('tok');
    expect(bearer('Bearer')).toBe('');
    expect(bearer('Bearer  tok  ')).toBe('tok');
  });

  test('mapError: ApiError passthrough, sqlite/postgres conflicts -> 409, unknown -> 500', () => {
    expect(mapError(new ApiError('not_found', 'note not found', 404))).toEqual({
      code: 'not_found', message: 'note not found', status: 404, details: undefined,
    });
    const sqlite = new Error('UNIQUE constraint failed');
    sqlite.code = 'SQLITE_CONSTRAINT_UNIQUE';
    expect(mapError(sqlite)).toEqual({ code: 'conflict', message: 'resource already exists', status: 409 });
    const pg = new Error('duplicate key');
    pg.code = '23505';
    expect(mapError(pg)).toEqual({ code: 'conflict', message: 'resource already exists', status: 409 });
    expect(mapError(new Error('boom'))).toEqual({ code: 'internal_error', message: 'internal server error', status: 500 });
  });

  test('errorBody: details ride along only when defined', () => {
    expect(errorBody('bad_request', 'nope')).toEqual({ error: { code: 'bad_request', message: 'nope' } });
    expect(errorBody('bad_request', 'nope', { why: 1 })).toEqual({ error: { code: 'bad_request', message: 'nope', details: { why: 1 } } });
  });
});

describe('OTP login edges', () => {
  const mint = (app, email, ip = '127.0.0.1') => call(app, 'POST', '/v1/auth/login', { body: { email }, env: { ip } });
  const verify = (app, body, ip = '127.0.0.1') => call(app, 'POST', '/v1/auth/verify', { body, env: { ip } });
  const pendingCount = async (db, email) =>
    (await db.query("SELECT COUNT(*) AS n FROM otp_login_requests WHERE email = ? AND status = 'pending'").get(email)).n;
  const requestRow = (db, id) => db.query('SELECT status, failed_attempts FROM otp_login_requests WHERE id = ?').get(id);

  test('invalid email -> 400 before any code is issued', async () => {
    const { app } = await makeApp();
    for (const email of ['', 'not-an-email', 'a@b']) {
      const res = await mint(app, email);
      expect(res.status).toBe(400);
      expect((await res.json()).error.code).toBe('bad_request');
    }
  });

  test('login mints a request per call — its own code and its own nonce — and a nonce accepts only its own code', async () => {
    const { app, db } = await makeApp();
    const email = 'two@example.com';
    const a = await (await mint(app, email, '10.0.0.1')).json();
    const b = await (await mint(app, email, '10.0.0.2')).json();
    for (const r of [a, b]) {
      expect(r.sent).toBe(true);
      expect(r.requestId).toMatch(/^[0-9a-f-]{36}$/);
      expect(r.devCode).toMatch(/^\d{6}$/);
    }
    expect(a.requestId).not.toBe(b.requestId);
    expect(await pendingCount(db, email)).toBe(2);
    // b's code under a's nonce is a wrong code for a (unless the two six-digit
    // codes happen to coincide, in which case it is simply right).
    const crossed = await verify(app, { email, requestId: a.requestId, code: b.devCode });
    expect(crossed.status).toBe(a.devCode === b.devCode ? 200 : 401);
    expect((await verify(app, { email, requestId: b.requestId, code: b.devCode })).status).toBe(200);
  });

  test('wrong code -> 401', async () => {
    const { app } = await makeApp();
    const email = 'wrong@example.com';
    const started = await (await mint(app, email)).json();
    const res = await verify(app, { email, requestId: started.requestId, code: '000000' });
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe('unauthorized');
    expect(started.devCode).not.toBe('000000');
  });

  test('expired request -> 401 (invalid or expired login code)', async () => {
    const { db, app } = await makeApp();
    const email = 'expired@example.com';
    const id = 'expired-request';
    db.query('INSERT INTO otp_login_requests (id, email, code_hash, status, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
      id, email, sha256(`${email}:123456`), 'pending', new Date(Date.now() - 1000).toISOString(), new Date().toISOString(),
    );
    const res = await verify(app, { email, requestId: id, code: '123456' });
    expect(res.status).toBe(401);
    expect((await res.json()).error.message).toContain('invalid or expired login code');
  });

  test('a consumed code cannot be replayed', async () => {
    const { app } = await makeApp();
    const email = 'replay@example.com';
    const started = await (await mint(app, email)).json();
    const body = { email, requestId: started.requestId, code: started.devCode };
    expect((await verify(app, body)).status).toBe(200);
    expect((await verify(app, body)).status).toBe(401);
  });

  test('email lookup is case-insensitive: same user, api key issued exactly once', async () => {
    const { app } = await makeApp();
    const first = await (await mint(app, 'Case@Example.com')).json();
    const one = await (await verify(app, { email: 'Case@Example.com', requestId: first.requestId, code: first.devCode })).json();
    expect(one.apiKey).toStartWith('pn_');
    const second = await (await mint(app, '  case@example.com ')).json();
    const two = await (await verify(app, { email: 'CASE@example.com', requestId: second.requestId, code: second.devCode })).json();
    expect(two.apiKey).toBeUndefined();
    expect(two.user.id).toBe(one.user.id);
  });

  test('verify without a valid nonce is refused before anything is counted', async () => {
    const { app, db } = await makeApp();
    const email = 'nonce@example.com';
    const started = await (await mint(app, email)).json();
    // No nonce at all: a malformed request, not a guess.
    const bare = await verify(app, { email, code: started.devCode });
    expect(bare.status).toBe(400);
    expect((await bare.json()).error.code).toBe('bad_request');
    // Nonces nobody minted, the right nonce under another address, an
    // oversized nonce: none resolve, none count against the real request —
    // even with the CORRECT code attached.
    const bogus = [
      { email, requestId: crypto.randomUUID(), code: started.devCode },
      { email: 'other@example.com', requestId: started.requestId, code: started.devCode },
      { email, requestId: 'x'.repeat(65), code: started.devCode },
      { email, requestId: crypto.randomUUID(), code: '000000' },
      { email, requestId: crypto.randomUUID(), code: '000001' },
      { email, requestId: crypto.randomUUID(), code: '000002' },
    ];
    for (const [i, body] of bogus.entries()) expect((await verify(app, body, `10.6.0.${i + 1}`)).status).toBe(401);
    expect(await requestRow(db, started.requestId)).toEqual({ status: 'pending', failed_attempts: 0 });
    expect((await verify(app, { email, requestId: started.requestId, code: started.devCode })).status).toBe(200);
  });

  test('OTP login is rate limited per IP after 5 requests; other IPs unaffected', async () => {
    const { app } = await makeApp();
    for (let i = 0; i < 5; i += 1) expect((await mint(app, `rl${i}@example.com`)).status).toBe(200);
    const sixth = await mint(app, 'rl5@example.com');
    expect(sixth.status).toBe(429);
    expect((await sixth.json()).error.code).toBe('rate_limited');
    expect((await mint(app, 'rl6@example.com', '127.0.0.2')).status).toBe(200);
  });

  test('login: a flood from many IPs can never lock the address owner out (#1542 review)', async () => {
    const { app } = await makeApp();
    const victim = 'locked@example.com';
    for (let i = 0; i < 12; i += 1) expect((await mint(app, victim, `203.0.113.${i + 1}`)).status).toBe(200);
    const mine = await mint(app, victim, '198.51.100.7');
    expect(mine.status).toBe(200);
    const { requestId, devCode } = await mine.json();
    expect(devCode).toMatch(/^\d{6}$/);
    const verified = await verify(app, { email: victim, requestId, code: devCode }, '198.51.100.7');
    expect(verified.status).toBe(200);
    expect((await verified.json()).token).toBeString();
  });

  test('login: the process-wide mint budget refuses new codes at 429 for everyone; 0 disables it', async () => {
    const { app } = await makeApp({ otpMintBudget: 3 });
    for (let i = 1; i <= 3; i += 1) expect((await mint(app, `budget${i}@example.com`, `10.4.0.${i}`)).status).toBe(200);
    const fourth = await mint(app, 'budget4@example.com', '10.4.0.4');
    expect(fourth.status).toBe(429);
    expect((await fourth.json()).error.code).toBe('rate_limited');
    // A volume key the caller cannot pick — not an address key: an address
    // that already has a request is refused from a fresh IP exactly like any
    // other address, and nobody's request is touched.
    expect((await mint(app, 'budget1@example.com', '10.4.0.5')).status).toBe(429);
    const { app: unbounded } = await makeApp({ otpMintBudget: 0 });
    for (let i = 0; i < 6; i += 1) expect((await mint(unbounded, `free${i}@example.com`, `10.4.1.${i}`)).status).toBe(200);
  });

  test('invariant: N distinct IPs requesting codes for X and guessing at them cannot prevent X from logging in with a valid code (#1770 review)', async () => {
    // Round 1: 25 attacker IPs each mint a request for the victim (the only
    // nonces they will ever hold), guess three wrong codes at their own
    // request and one at a nonce they made up; the owner's request, minted
    // BEFORE the flood, logs in after it. Rounds 2–5: the round-1 review's
    // exact repro — owner mints, ten IPs send one wrong code each, owner
    // verifies. Every attacker verdict is 401; the owner's is 200 every time.
    const { app } = await makeApp();
    const victim = 'target@example.com';
    const owner = '198.51.100.7';
    const attackerIps = Array.from({ length: 25 }, (_, i) => `203.0.113.${i + 1}`);
    const seen = new Set();
    const attack = async (ip, guesses) => {
      const minted = await mint(app, victim, ip);
      expect(minted.status).toBe(200);
      const { requestId } = await minted.json();
      for (let g = 0; g < guesses; g += 1) {
        const res = await verify(app, { email: victim, requestId, code: String(g).padStart(6, '0') }, ip);
        seen.add(res.status);
        expect(res.status).not.toBe(200);
      }
      const fabricated = await verify(app, { email: victim, requestId: crypto.randomUUID(), code: '123456' }, ip);
      seen.add(fabricated.status);
      expect(fabricated.status).not.toBe(200);
    };
    const ownerMints = async () => {
      const minted = await mint(app, victim, owner);
      expect(minted.status).toBe(200);
      return minted.json();
    };
    const ownerVerifies = async ({ requestId, devCode }) => {
      const ok = await verify(app, { email: victim, requestId, code: devCode }, owner);
      expect(ok.status).toBe(200);
      expect((await ok.json()).token).toBeString();
    };
    const first = await ownerMints();
    for (const ip of attackerIps) await attack(ip, 3);
    await ownerVerifies(first);
    for (let round = 2; round <= 5; round += 1) {
      const minted = await ownerMints();
      for (const ip of attackerIps.slice(0, 10)) await attack(ip, 1);
      await ownerVerifies(minted);
    }
    expect([...seen]).toEqual([401]);
  });

  test('verify: five wrong codes burn THAT request — even the correct code is then refused — and a fresh mint for the same address works at once', async () => {
    const lines = [];
    const { app, db } = await makeApp({ log: (line) => lines.push(String(line)) });
    const email = 'burn@example.com';
    const first = await (await mint(app, email)).json();
    for (let i = 1; i <= 5; i += 1) {
      const res = await verify(app, { email, requestId: first.requestId, code: '000000' }, `10.2.0.${i}`);
      expect(res.status).toBe(401);
      expect(await requestRow(db, first.requestId)).toEqual(i < 5 ? { status: 'pending', failed_attempts: i } : { status: 'burned', failed_attempts: 5 });
    }
    // The operator sees the burn — the address, never the nonce or a code.
    const burned = lines.filter((l) => l.includes('burned after'));
    expect(burned).toHaveLength(1);
    expect(burned[0]).toContain(email);
    expect(burned[0]).not.toContain(first.requestId);
    expect(burned[0]).not.toMatch(/\b\d{6}\b/);
    // Burned: the correct code is refused for this request, and refused
    // attempts are not counted any further …
    expect((await verify(app, { email, requestId: first.requestId, code: first.devCode }, '10.2.0.6')).status).toBe(401);
    expect(await requestRow(db, first.requestId)).toEqual({ status: 'burned', failed_attempts: 5 });
    // … and nothing about the ADDRESS is: the next mint is immediate and logs in.
    const second = await (await mint(app, email)).json();
    expect(second.requestId).not.toBe(first.requestId);
    expect((await verify(app, { email, requestId: second.requestId, code: second.devCode })).status).toBe(200);
  });

  test('verify: the fourth wrong code does not burn; the correct code still logs in (boundary)', async () => {
    const { app, db } = await makeApp();
    const email = 'four@example.com';
    const started = await (await mint(app, email)).json();
    for (let i = 1; i <= 4; i += 1) expect((await verify(app, { email, requestId: started.requestId, code: '000000' }, `10.7.0.${i}`)).status).toBe(401);
    expect(await requestRow(db, started.requestId)).toEqual({ status: 'pending', failed_attempts: 4 });
    expect((await verify(app, { email, requestId: started.requestId, code: started.devCode })).status).toBe(200);
  });

  test("verify: a stranger's failures burn only the stranger's request; a stranger's later mint never stales the owner's code", async () => {
    const { app, db } = await makeApp();
    const email = 'shared@example.com';
    const ownerReq = await (await mint(app, email, '198.51.100.7')).json();
    const strangerReq = await (await mint(app, email, '203.0.113.5')).json();
    for (let i = 1; i <= 6; i += 1) {
      expect((await verify(app, { email, requestId: strangerReq.requestId, code: '000000' }, `203.0.113.${i}`)).status).toBe(401);
    }
    expect(await requestRow(db, strangerReq.requestId)).toEqual({ status: 'burned', failed_attempts: 5 });
    expect(await requestRow(db, ownerReq.requestId)).toEqual({ status: 'pending', failed_attempts: 0 });
    // Another stranger mints AFTER the owner did: lookup is by nonce, so the
    // owner's code is still the owner's code (the round-2 residual).
    expect((await mint(app, email, '203.0.113.9')).status).toBe(200);
    const ok = await verify(app, { email, requestId: ownerReq.requestId, code: ownerReq.devCode }, '198.51.100.7');
    expect(ok.status).toBe(200);
  });

  test('per-IP quotas key on the forwarded client behind a trusted proxy, not on the balancer peer (ALB case, #1784)', async () => {
    const alb = { ip: '10.0.5.1' };
    const via = (xff) => ({ env: alb, headers: { 'x-forwarded-for': xff } });
    const loginVia = (app, email, xff) => call(app, 'POST', '/v1/auth/login', { body: { email }, ...via(xff) });
    const verifyVia = (app, body, xff) => call(app, 'POST', '/v1/auth/verify', { body, ...via(xff) });
    const guess = { email: 'x@example.com', code: '000000' };
    // The pre-#1784 shape, for contrast: with no trusted hop every request
    // shares the balancer's bucket, so 20 wrong verifies from one client
    // lock a second client's correct code out for the hour.
    const { app: naive } = await makeApp();
    const victimNaive = await (await loginVia(naive, 'v@example.com', '198.51.100.4')).json();
    for (let i = 0; i < 20; i += 1) expect((await verifyVia(naive, { ...guess, requestId: crypto.randomUUID() }, '203.0.113.7')).status).toBe(401);
    expect((await verifyVia(naive, { email: 'v@example.com', requestId: victimNaive.requestId, code: victimNaive.devCode }, '198.51.100.4')).status).toBe(429);
    // With the ALB declared as the one trusted hop, the attacker's bucket is
    // the attacker's, and the second client logs in.
    const { app } = await makeApp({ trustedProxyHops: 1 });
    const victim = await (await loginVia(app, 'v@example.com', '198.51.100.4')).json();
    for (let i = 0; i < 20; i += 1) expect((await verifyVia(app, { ...guess, requestId: crypto.randomUUID() }, '203.0.113.7')).status).toBe(401);
    expect((await verifyVia(app, { ...guess, requestId: crypto.randomUUID() }, '203.0.113.7')).status).toBe(429);
    expect((await verifyVia(app, { email: 'v@example.com', requestId: victim.requestId, code: victim.devCode }, '198.51.100.4')).status).toBe(200);
    // A client-supplied chain on the left never buys a fresh bucket: the
    // entry the ALB appended (rightmost) is the key.
    for (let i = 0; i < 5; i += 1) expect((await loginVia(app, `s${i}@example.com`, `10.${i}.${i}.${i}, 192.0.2.44`)).status).toBe(200);
    expect((await loginVia(app, 's5@example.com', '10.9.9.9, 192.0.2.44')).status).toBe(429);
    // No forwarded header at all: the request did not traverse the proxy, so
    // the socket peer is the key.
    expect((await call(app, 'POST', '/v1/auth/login', { body: { email: 'direct@example.com' }, env: alb })).status).toBe(200);
  });

  test('x-real-ip is the key only when the trusted hop is an allowlisted gateway peer (api.hasna.com case)', async () => {
    const { app } = await makeApp({ trustedProxyHops: 1, trustedGatewayPeers: parsePeerList('173.245.48.0/20') });
    const alb = { ip: '10.0.5.1' };
    const loginWith = (email, headers) => call(app, 'POST', '/v1/auth/login', { body: { email }, env: alb, headers });
    // Through the gateway: the ALB appended the gateway's egress, and
    // x-real-ip (set by the gateway from cf-connecting-ip) is the client.
    const gw = (client) => ({ 'x-forwarded-for': `${client}, 173.245.50.9`, 'x-real-ip': client });
    for (let i = 0; i < 5; i += 1) expect((await loginWith(`g${i}@example.com`, gw('203.0.113.7'))).status).toBe(200);
    expect((await loginWith('g5@example.com', gw('203.0.113.7'))).status).toBe(429);
    expect((await loginWith('g6@example.com', gw('198.51.100.4'))).status).toBe(200);
    // Straight at the ALB, x-real-ip is whatever the client typed: ignored,
    // so rotating it buys nothing.
    for (let i = 0; i < 5; i += 1) {
      expect((await loginWith(`d${i}@example.com`, { 'x-forwarded-for': '192.0.2.44', 'x-real-ip': `203.0.113.${i + 10}` })).status).toBe(200);
    }
    expect((await loginWith('d5@example.com', { 'x-forwarded-for': '192.0.2.44', 'x-real-ip': '203.0.113.99' })).status).toBe(429);
  });

  test('--auto-approve trusts only the raw socket peer: a forwarded loopback never approves a remote device login', async () => {
    const { app } = await makeApp({ autoApprove: true, trustedProxyHops: 1 });
    const remote = await (await call(app, 'POST', '/v1/auth/device/start', {
      body: {}, env: { ip: '203.0.113.9' }, headers: { 'x-forwarded-for': '127.0.0.1' },
    })).json();
    const poll = await (await call(app, 'POST', '/v1/auth/device/token', { body: { deviceCode: remote.deviceCode } })).json();
    expect(poll.status).toBe('pending');
  });

  test('an oversized "email" is refused before any request is minted', async () => {
    const { app, db } = await makeApp();
    const junk = `${'a'.repeat(300)}@example.com`;
    const res = await mint(app, junk);
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('bad_request');
    expect((await db.query('SELECT COUNT(*) AS n FROM otp_login_requests').get()).n).toBe(0);
  });

  test('the OTP code never reaches the server log by default (regression for #1542)', async () => {
    const lines = [];
    const { app } = await makeApp({ log: (line) => lines.push(String(line)) });
    const email = 'noleak@example.com';
    const started = await (await mint(app, email)).json();
    expect(started.devCode).toMatch(/^\d{6}$/);
    const output = lines.join('\n');
    // A non-secret reference is still logged (observability), but never the code or the nonce.
    expect(output).toContain(email);
    expect(output).toContain('login code requested');
    expect(output).not.toContain(started.devCode);
    expect(output).not.toContain(started.requestId);
    expect(output).not.toMatch(/\b\d{6}\b/);
  });

  test('console delivery of login codes requires the explicit HASNA_NOTES_SERVER_AUTH_CONSOLE_CODES opt-in', async () => {
    expect(resolveConfig({ HASNA_NOTES_SERVER_AUTH_CONSOLE_CODES: '1' }, []).consoleCodes).toBe(true);
    expect(resolveConfig({}, []).consoleCodes).toBe(false);
    const lines = [];
    const { app } = await makeApp({ consoleCodes: true, log: (line) => lines.push(String(line)) });
    const email = 'optin@example.com';
    const started = await (await mint(app, email)).json();
    expect(lines.join('\n')).toContain(started.devCode);
  });

  test('the proxy knobs come from HASNA_NOTES_SERVER_TRUSTED_PROXY_HOPS / _TRUSTED_GATEWAY_PEERS and default to trusting nothing', () => {
    expect(resolveConfig({}, []).trustedProxyHops).toBe(0);
    expect(resolveConfig({}, []).trustedGatewayPeers).toEqual([]);
    expect(resolveConfig({ HASNA_NOTES_SERVER_TRUSTED_PROXY_HOPS: '1' }, []).trustedProxyHops).toBe(1);
    expect(resolveConfig({ HASNA_NOTES_SERVER_TRUSTED_PROXY_HOPS: 'yes' }, []).trustedProxyHops).toBe(0);
    expect(resolveConfig({ HASNA_NOTES_SERVER_TRUSTED_GATEWAY_PEERS: '173.245.48.0/20, junk' }, []).trustedGatewayPeers).toHaveLength(1);
  });

  test('device login pairing codes are never written to the server log', async () => {
    const lines = [];
    const { app } = await makeApp({ log: (line) => lines.push(String(line)) });
    const started = await (await call(app, 'POST', '/v1/auth/device/start', { body: {} })).json();
    expect(started.userCode).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    const output = lines.join('\n');
    expect(output).not.toContain(started.userCode);
    expect(output).not.toMatch(/\b[A-Z0-9]{4}-[A-Z0-9]{4}\b/);
  });
});

describe('api key scopes', () => {
  async function makeScopedKey(app, sessionToken, scopes) {
    const res = await call(app, 'POST', '/v1/api-keys', {
      token: sessionToken,
      body: { name: 'scoped', scopes },
    });
    expect(res.status).toBe(201);
    return (await res.json()).key;
  }

  test('notes_read key can list but not write, and cannot administer keys', async () => {
    const { app } = await makeApp();
    const { token } = await login(app);
    const key = await makeScopedKey(app, token, ['notes_read']);

    const list = await call(app, 'GET', '/v1/notes', { token: key });
    expect(list.status).toBe(200);
    const write = await call(app, 'POST', '/v1/notes', { token: key, body: { title: 'x' } });
    expect(write.status).toBe(403);
    expect((await write.json()).error.code).toBe('forbidden');
    const admin = await call(app, 'GET', '/v1/api-keys', { token: key });
    expect(admin.status).toBe(403);
  });

  test('notes_write key can write but not read', async () => {
    const { app } = await makeApp();
    const { token } = await login(app);
    const key = await makeScopedKey(app, token, ['notes_write']);
    const write = await call(app, 'POST', '/v1/notes', { token: key, body: { clientId: 'w-1', title: 'w' } });
    expect(write.status).toBe(201);
    const read = await call(app, 'GET', '/v1/notes', { token: key });
    expect(read.status).toBe(403);
  });

  test('admin/full keys list and mint keys; whoami reports the exact scopes', async () => {
    const { app } = await makeApp();
    const { token, apiKey } = await login(app);
    const adminKey = await makeScopedKey(app, token, ['admin']);
    const list = await call(app, 'GET', '/v1/api-keys', { token: adminKey });
    expect(list.status).toBe(200);
    const whoamiRead = await (await call(app, 'GET', '/v1/auth/whoami', { token: apiKey })).json();
    expect(whoamiRead.auth).toEqual({ via: 'api_key', scopes: ['full'] });
    const whoamiScoped = await (await call(app, 'GET', '/v1/auth/whoami', { token: adminKey })).json();
    expect(whoamiScoped.auth.scopes).toEqual(['admin']);
  });
});

describe('tenant isolation', () => {
  test('a tenant can never see, patch, or delete another tenant’s note; seq counters are per tenant', async () => {
    const { app } = await makeApp();
    const a = await login(app, 'a@example.com');
    const b = await login(app, 'b@example.com');

    const created = await (await call(app, 'POST', '/v1/notes', { token: a.apiKey, body: { clientId: 'iso-1', title: 'A secret' } })).json();
    expect(created.seq).toBe(1);

    for (const method of ['GET', 'PATCH', 'DELETE']) {
      const res = await call(app, method, `/v1/notes/${created.id}`, {
        token: b.apiKey,
        body: method === 'PATCH' ? { title: 'hijack' } : undefined,
      });
      expect(res.status).toBe(404, `${method} from another tenant must 404`);
    }
    const aList = await (await call(app, 'GET', '/v1/notes', { token: a.apiKey })).json();
    expect(aList.data).toHaveLength(1);
    const bList = await (await call(app, 'GET', '/v1/notes', { token: b.apiKey })).json();
    expect(bList.data).toHaveLength(0);

    // Per-tenant seq: B's first note starts at 1, not 2.
    const bNote = await (await call(app, 'POST', '/v1/notes', { token: b.apiKey, body: { clientId: 'iso-b', title: 'B' } })).json();
    expect(bNote.seq).toBe(1);
  });
});

describe('notes CRUD edges', () => {
  test('nonexistent ids 404 on get/patch/delete with the dialect envelope', async () => {
    const { app } = await makeApp();
    const { apiKey } = await login(app);
    const id = '00000000-0000-4000-8000-0000000000ff';
    for (const method of ['GET', 'PATCH', 'DELETE']) {
      const res = await call(app, method, `/v1/notes/${id}`, {
        token: apiKey,
        body: method === 'PATCH' ? { title: 'x' } : undefined,
      });
      expect(res.status).toBe(404);
      expect((await res.json()).error.code).toBe('not_found');
    }
  });

  test('updating a soft-deleted note restores it (GAP-2 closure: PATCH clears the tombstone)', async () => {
    // The dialect contract (§notes server/notes.mjs updateNote) makes PATCH
    // the REST restore path: last-write-wins PATCH clears deleted_at and logs
    // note.restored, so a trashed note can come back. 404 would make REST
    // restore impossible; server.test.mjs pins the same contract.
    const { app } = await makeApp();
    const { apiKey } = await login(app);
    const note = await (await call(app, 'POST', '/v1/notes', { token: apiKey, body: { clientId: 'del-1', title: 'x' } })).json();
    await call(app, 'DELETE', `/v1/notes/${note.id}`, { token: apiKey });
    const restored = await (await call(app, 'PATCH', `/v1/notes/${note.id}`, { token: apiKey, body: { title: 'y' } })).json();
    expect(restored.deletedAt).toBeNull();
    expect(restored.title).toBe('y');
    // A second PATCH on the restored note is an ordinary update.
    const again = await (await call(app, 'PATCH', `/v1/notes/${note.id}`, { token: apiKey, body: { title: 'z' } })).json();
    expect(again.deletedAt).toBeNull();
    expect(again.title).toBe('z');
  });

  test('whitespace-only title falls back to Untitled; labels are trimmed, deduped, and capped at 50', async () => {
    const { app } = await makeApp();
    const { apiKey } = await login(app);
    const labels = Array.from({ length: 60 }, (_, i) => `label-${i % 10}-${i}`);
    const note = await (await call(app, 'POST', '/v1/notes', { token: apiKey, body: { clientId: 'edge-1', title: '   ', labels } })).json();
    expect(note.title).toBe('Untitled');
    expect(note.labels).toHaveLength(50);
    expect(new Set(note.labels).size).toBe(50);
  });

  test('folder:null clears the folder while absent folder keeps the current value', async () => {
    const { app } = await makeApp();
    const { apiKey } = await login(app);
    const note = await (await call(app, 'POST', '/v1/notes', { token: apiKey, body: { clientId: 'f-1', title: 'x', folder: 'work' } })).json();
    expect(note.folder).toBe('work');
    const kept = await (await call(app, 'PATCH', `/v1/notes/${note.id}`, { token: apiKey, body: { title: 'x2' } })).json();
    expect(kept.folder).toBe('work');
    const cleared = await (await call(app, 'PATCH', `/v1/notes/${note.id}`, { token: apiKey, body: { folder: null } })).json();
    expect(cleared.folder).toBeNull();
  });

  test('pinned/archived flags round-trip and revision/contentHash move on every patch', async () => {
    const { app } = await makeApp();
    const { apiKey } = await login(app);
    const note = await (await call(app, 'POST', '/v1/notes', { token: apiKey, body: { clientId: 'pa-1', title: 'x', pinned: true, archived: true } })).json();
    expect(note.pinned).toBe(true);
    expect(note.archived).toBe(true);
    expect(note.revision).toBe(1);

    const patched = await (await call(app, 'PATCH', `/v1/notes/${note.id}`, { token: apiKey, body: { archived: false, bodyMarkdown: 'new body' } })).json();
    expect(patched.archived).toBe(false);
    expect(patched.pinned).toBe(true);
    expect(patched.revision).toBe(2);
    expect(patched.contentHash).not.toBe(note.contentHash);

    const renamed = await (await call(app, 'PATCH', `/v1/notes/${note.id}`, { token: apiKey, body: { title: 'renamed' } })).json();
    expect(renamed.revision).toBe(3);
    expect(renamed.contentHash).not.toBe(patched.contentHash);
  });
});

describe('request guards', () => {
  test('content-length above the 2 MiB cap is refused with 413 before any route logic', async () => {
    const { app } = await makeApp();
    const res = await app.request('/health', {
      method: 'GET',
      headers: { 'content-length': String(2 * 1024 * 1024 + 1) },
    }, LOOPBACK);
    expect(res.status).toBe(413);
    expect((await res.json()).error.code).toBe('payload_too_large');
  });
});
