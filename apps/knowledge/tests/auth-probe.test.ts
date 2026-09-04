/**
 * knowledge — live auth probe (`auth whoami` / `auth status`) tests.
 * Copyright 2026 Hasna Inc.
 * Licensed under the Apache License, Version 2.0
 *
 * Issue #1587: whoami reported `authenticated: true` merely from key presence
 * in env, so a revoked key "passed" whoami while every read 401'd. These tests
 * pin the fix: whoami sends ONE authenticated probe request through the exact
 * read-path transport and reports the server's answer — rejected keys come
 * back `authenticated: false` with `reason: unauthorized` and the failing
 * key's kid surfaced.
 *
 * All traffic is hermetic: stub servers on 127.0.0.1 (loopback is allowed by
 * the outbound network guard while NODE_ENV=test) and keys minted locally
 * with a throwaway signing secret — never a real credential, never a value in
 * test output.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mintApiKey } from '@hasna/contracts/auth';
import { probeKnowledgeAuth } from '../src/auth';
import type { KnowledgeAuthProbe } from '../src/auth';
import { knowledgeTestEnv } from './preload';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = join(__dirname, '..', 'src', 'cli.ts');

/** Deterministic token whose kid matches the fleet revocation the issue names. */
const minted = mintApiKey({
  app: 'knowledge',
  scopes: ['knowledge:read', 'knowledge:write'],
  signingSecret: 'probe-test-secret-0123456789abcdef',
  kid: 'c27c603d5b428ec4',
  tid: 'org_hasna',
  agent: 'probe-test-agent',
});
const REVOKED_SHAPE_KEY = minted.token;
const MINTED_KID = minted.claims.kid;
const MINTED_TID = minted.claims.tid ?? null;
const MINTED_AGENT = minted.claims.agent ?? null;

interface StubServer {
  port: number;
  stop: () => void;
  /** Requests the stub received, as `METHOD pathname?query`. */
  seen: string[];
}

const NOT_PROBED: KnowledgeAuthProbe = {
  probed: false,
  verified: false,
  status: null,
  reason: null,
  principal: null,
};

function startStub(status: number, body: unknown): StubServer {
  const seen: string[] = [];
  const server = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    fetch(req) {
      const url = new URL(req.url);
      seen.push(`${req.method} ${url.pathname}${url.search}`);
      return new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      });
    },
  });
  return { port: server.port, stop: () => server.stop(), seen };
}

function httpEnv(port: number): Record<string, string> {
  return knowledgeTestEnv({
    HASNA_KNOWLEDGE_API_URL: `http://127.0.0.1:${port}`,
    HASNA_KNOWLEDGE_API_KEY: REVOKED_SHAPE_KEY,
    NODE_ENV: 'test',
  });
}

/**
 * Async CLI runner for tests that need the IN-PROCESS stub server to answer:
 * `Bun.spawnSync` blocks this test process, which also blocks `Bun.serve`, so
 * a synchronous spawn deadlocks the child's probe request against the parent's
 * server. Async spawn keeps the event loop free.
 */
async function runCliAsync(args: string[], env: Record<string, string>) {
  const proc = Bun.spawn(['bun', CLI, ...args], {
    env: knowledgeTestEnv(env),
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  return { exitCode: await proc.exited, stdout, stderr };
}

describe('probeKnowledgeAuth — live probe decoding', () => {
  test('401 from the server reports unauthorized with the failing kid surfaced', async () => {
    const stub = startStub(401, { error: 'API key has been revoked.' });
    try {
      const probe = await probeKnowledgeAuth(httpEnv(stub.port));
      expect(probe).toEqual({
        probed: true,
        verified: false,
        status: 401,
        reason: 'unauthorized',
        principal: { kid: MINTED_KID, app: 'knowledge', agent: MINTED_AGENT, tid: MINTED_TID },
      });
      // Exactly one authenticated request through the read path.
      expect(stub.seen).toEqual(['GET /v1/notes?limit=1&offset=0']);
    } finally {
      stub.stop();
    }
  });

  test('403 is decoded as unauthorized too', async () => {
    const stub = startStub(403, { error: 'forbidden' });
    try {
      const probe = await probeKnowledgeAuth(httpEnv(stub.port));
      expect(probe).toMatchObject({ verified: false, status: 403, reason: 'unauthorized' });
    } finally {
      stub.stop();
    }
  });

  test('2xx verifies the credential', async () => {
    const stub = startStub(200, { items: [], total: 0 });
    try {
      const probe = await probeKnowledgeAuth(httpEnv(stub.port));
      expect(probe).toEqual({
        probed: true,
        verified: true,
        status: 200,
        reason: null,
        principal: { kid: MINTED_KID, app: 'knowledge', agent: MINTED_AGENT, tid: MINTED_TID },
      });
      expect(stub.seen).toEqual(['GET /v1/notes?limit=1&offset=0']);
    } finally {
      stub.stop();
    }
  });

  test('404 is reported distinctly from a rejected key', async () => {
    const stub = startStub(404, { error: 'not found' });
    try {
      const probe = await probeKnowledgeAuth(httpEnv(stub.port));
      expect(probe).toMatchObject({ verified: false, status: 404, reason: 'not_found' });
    } finally {
      stub.stop();
    }
  });

  test('5xx is reported as server_error, never as a rejected key', async () => {
    const stub = startStub(503, { error: 'overloaded' });
    try {
      const probe = await probeKnowledgeAuth(httpEnv(stub.port));
      expect(probe).toMatchObject({ verified: false, status: 503, reason: 'server_error' });
    } finally {
      stub.stop();
    }
  });

  test('no key configured: nothing is probed and no live claim is made', async () => {
    const stub = startStub(200, { items: [], total: 0 });
    try {
      const probe = await probeKnowledgeAuth(
        knowledgeTestEnv({ HASNA_KNOWLEDGE_API_URL: `http://127.0.0.1:${stub.port}`, NODE_ENV: 'test' }),
      );
      expect(probe).toEqual(NOT_PROBED);
      expect(stub.seen).toEqual([]);
    } finally {
      stub.stop();
    }
  });

  test('key without a hosted API transport: nothing is sent anywhere', async () => {
    const stub = startStub(200, { items: [], total: 0 });
    try {
      const probe = await probeKnowledgeAuth(
        knowledgeTestEnv({ HASNA_KNOWLEDGE_API_KEY: REVOKED_SHAPE_KEY, NODE_ENV: 'test' }),
      );
      expect(probe).toMatchObject({ probed: false, verified: false, status: null, reason: null });
      // The principal is still surfaced so the operator sees WHICH key is inert.
      expect(probe.principal).toEqual({ kid: MINTED_KID, app: 'knowledge', agent: MINTED_AGENT, tid: MINTED_TID });
      expect(stub.seen).toEqual([]);
    } finally {
      stub.stop();
    }
  });
});

describe('knowledge auth whoami --json (CLI, stubbed server)', () => {
  let server: { port: number; stop: () => void };
  let seen: string[];

  beforeAll(() => {
    seen = [];
    server = Bun.serve({
      port: 0,
      hostname: '127.0.0.1',
      fetch(req) {
        const url = new URL(req.url);
        seen.push(`${req.method} ${url.pathname}${url.search}`);
        // The fleet-answer shape for the issue's scenario: revoked key -> 401.
        return new Response(JSON.stringify({ error: 'API key has been revoked.' }), {
          status: 401,
          headers: { 'content-type': 'application/json' },
        });
      },
    });
  });

  afterAll(() => {
    server.stop();
  });

  test('a rejected key is reported authenticated:false with reason and kid — and exit 0 (the report succeeded)', async () => {
    const before = seen.length;
    const result = await runCliAsync(['auth', 'whoami', '--json'], {
      HASNA_KNOWLEDGE_API_URL: `http://127.0.0.1:${server.port}`,
      HASNA_KNOWLEDGE_API_KEY: REVOKED_SHAPE_KEY,
      NODE_ENV: 'test',
    });
    expect(result.exitCode).toBe(0);
    const out = JSON.parse(result.stdout) as Record<string, unknown>;
    expect(out.authenticated).toBe(false);
    expect(out.configured).toBe(true);
    expect(out.api_key_present).toBe(true);
    expect(out.probe).toBe('live');
    expect(out.verified).toBe(false);
    expect(out.reason).toBe('unauthorized');
    expect(out.status).toBe(401);
    expect(out.principal).toEqual({
      kid: MINTED_KID,
      app: 'knowledge',
      agent: MINTED_AGENT,
      tid: MINTED_TID,
    });
    const message = String(out.message);
    expect(message).toContain('rejected it (HTTP 401)');
    expect(message).toContain(`kid ${MINTED_KID}`);
    // The key VALUE never reaches output or stderr.
    expect(result.stdout).not.toContain(REVOKED_SHAPE_KEY);
    expect(result.stderr).not.toContain(REVOKED_SHAPE_KEY);
    // Exactly one authenticated probe request through the read path.
    expect(seen.slice(before)).toEqual(['GET /v1/notes?limit=1&offset=0']);
  });

  test('keyless local mode: whoami never probes and reports not authenticated', async () => {
    const before = seen.length;
    const result = await runCliAsync(['auth', 'whoami', '--json'], { NODE_ENV: 'test' });
    expect(result.exitCode).toBe(0);
    const out = JSON.parse(result.stdout) as Record<string, unknown>;
    expect(out.authenticated).toBe(false);
    expect(out.configured).toBe(false);
    expect(out.probe).toBe('none');
    expect(out.reason).toBeNull();
    expect(out.principal).toBeNull();
    expect(String(out.message)).toBe('Not authenticated');
    // A keyless whoami must not have sent any request.
    expect(seen.slice(before)).toEqual([]);
  });
});