/**
 * @hasna/knowledge
 * Copyright 2026 Hasna Inc.
 * Licensed under the Apache License, Version 2.0
 *
 * The request-boundary guard: while `NODE_ENV=test`, a non-loopback outbound
 * request is refused before a socket is opened.
 *
 * This is the PRIMARY control, and it is tested at the transport, not at a stub.
 * Clearing the selector env vars is defence in depth only: a test file that
 * assigns them at module scope runs after any one-shot clear, one `bun test`
 * process shares one preload so a single file's leak reaches every later file,
 * and a `bunfig.toml` preload is simply absent when the suite is run from a
 * subdirectory. Each of those produced a green run with live writes. Guarding
 * the egress survives all three, because at that point it no longer matters
 * which layer decided to make the request or when the variable was set.
 *
 * The loopback case is a positive control on purpose: if the guard blocked
 * hermetic 127.0.0.1 servers, the suite would be pushed toward stubbing the
 * transport, and a stub proves nothing about egress.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ingestSourceRef } from '../src/source-ingest';
import {
  KnowledgeNetworkGuardError,
  NETWORK_GUARD_ENV,
  assertOutboundRequestAllowed,
  isLoopbackHostname,
  isNetworkGuardActive,
} from '../src/net-guard';
import { resolveKnowledgeCloudStore } from '../src/cloud-store';

const GUARDED = { NODE_ENV: 'test' } as NodeJS.ProcessEnv;
const UNGUARDED = { NODE_ENV: 'production' } as NodeJS.ProcessEnv;
const FAKE_KEY = 'k_fake_test_key';
/** Reserved TLD: guaranteed never to resolve, so a leak here cannot reach anything. */
const NON_LOOPBACK = 'https://knowledge.invalid';

describe('loopback classification', () => {
  test('accepts every hostname that cannot leave this machine', () => {
    for (const host of [
      'localhost',
      'LOCALHOST',
      'app.localhost',
      '127.0.0.1',
      '127.1.2.3',
      // `new URL('http://127.1')` normalizes to this — the guard sees the
      // normalized form, not what was typed.
      new URL('http://127.1').hostname,
      '[::1]',
      '[0:0:0:0:0:0:0:1]',
      // IPv4-mapped loopback is compressed by URL parsing: ::ffff:127.0.0.1
      // becomes ::ffff:7f00:1, which no naive string check would catch.
      new URL('http://[::ffff:127.0.0.1]').hostname,
    ]) {
      expect(isLoopbackHostname(host)).toBe(true);
    }
  });

  test('rejects wildcards and anything routable', () => {
    // 0.0.0.0 and [::] are bind-any addresses, NOT loopback. Accepting a
    // wildcard as "safe" is how a guard gets talked past.
    for (const host of ['0.0.0.0', '[::]', '', '   ', 'knowledge.invalid', '127.0.0.1.example', '10.0.0.1', '[fe80::1]']) {
      expect(isLoopbackHostname(host)).toBe(false);
    }
  });
});

describe('guard arming', () => {
  test(`armed only by ${NETWORK_GUARD_ENV}=test`, () => {
    expect(isNetworkGuardActive(GUARDED)).toBe(true);
    expect(isNetworkGuardActive({ NODE_ENV: 'TEST' } as NodeJS.ProcessEnv)).toBe(true);
    expect(isNetworkGuardActive(UNGUARDED)).toBe(false);
    expect(isNetworkGuardActive({} as NodeJS.ProcessEnv)).toBe(false);
  });

  test('this very suite runs with the guard armed', () => {
    // If bun ever stops defaulting NODE_ENV=test, every egress assertion below
    // would silently start proving nothing. Fail here instead.
    expect(isNetworkGuardActive()).toBe(true);
  });
});

describe('assertOutboundRequestAllowed', () => {
  test('permits loopback targets in every accepted input shape', () => {
    expect(() => assertOutboundRequestAllowed('http://127.0.0.1:8080/v1/notes', GUARDED)).not.toThrow();
    expect(() => assertOutboundRequestAllowed(new URL('http://localhost/v1/notes'), GUARDED)).not.toThrow();
    expect(() => assertOutboundRequestAllowed(new Request('http://[::1]:9/v1/notes'), GUARDED)).not.toThrow();
  });

  test('refuses a non-loopback target while armed', () => {
    expect(() => assertOutboundRequestAllowed(`${NON_LOOPBACK}/v1/notes`, GUARDED)).toThrow(
      KnowledgeNetworkGuardError,
    );
  });

  test('the refusal never names the target host', () => {
    // A refusal message is exactly the text that gets pasted into a task
    // comment or a CI log, so it reports the scheme and port and nothing else.
    try {
      assertOutboundRequestAllowed('https://knowledge.invalid:8443/v1/notes', GUARDED);
      throw new Error('expected the guard to refuse');
    } catch (error) {
      expect(error).toBeInstanceOf(KnowledgeNetworkGuardError);
      const guardError = error as KnowledgeNetworkGuardError;
      expect(guardError.message).not.toContain('knowledge.invalid');
      expect(guardError.message).toContain('non-loopback https request');
      expect(guardError.scheme).toBe('https');
      expect(guardError.port).toBe('8443');
    }
  });

  test('fails closed on an unparseable target', () => {
    expect(() => assertOutboundRequestAllowed('not a url', GUARDED)).toThrow(KnowledgeNetworkGuardError);
  });

  test('permits everything when not armed', () => {
    expect(() => assertOutboundRequestAllowed(`${NON_LOOPBACK}/v1/notes`, UNGUARDED)).not.toThrow();
    expect(() => assertOutboundRequestAllowed('not a url', UNGUARDED)).not.toThrow();
  });
});

describe('the guard sits at the cloud transport boundary', () => {
  test('a cloud read against a non-loopback endpoint is refused, not attempted', async () => {
    // Explicit cloud mode, so nothing about the mode fix is doing the work here:
    // this is the transport refusing to emit the request. The failure must be
    // the guard, NOT an HTTP status and NOT a DNS error — either of those would
    // mean a socket was opened.
    const store = resolveKnowledgeCloudStore({
      HASNA_KNOWLEDGE_STORAGE_MODE: 'cloud',
      HASNA_KNOWLEDGE_API_URL: NON_LOOPBACK,
      HASNA_KNOWLEDGE_API_KEY: FAKE_KEY,
      NODE_ENV: 'test',
    } as NodeJS.ProcessEnv);
    expect(store).not.toBeNull();
    expect(store!.baseUrl).toBe(`${NON_LOOPBACK}/v1`);

    let caught: unknown = null;
    try {
      await store!.list({ limit: 1 });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(KnowledgeNetworkGuardError);
    expect(String(caught)).not.toContain('knowledge.invalid');
  });

  test('a cloud write against a non-loopback endpoint is refused too', async () => {
    const store = resolveKnowledgeCloudStore({
      HASNA_KNOWLEDGE_STORAGE_MODE: 'cloud',
      HASNA_KNOWLEDGE_API_URL: NON_LOOPBACK,
      HASNA_KNOWLEDGE_API_KEY: FAKE_KEY,
      NODE_ENV: 'test',
    } as NodeJS.ProcessEnv);
    let caught: unknown = null;
    try {
      await store!.create({ title: 'guarded', content: 'must never leave the machine' });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(KnowledgeNetworkGuardError);
  });
});

describe('the guard covers web source-ref ingestion too', () => {
  test('ingesting a non-loopback web source ref is refused before a request', async () => {
    // The package's second outbound path. No test in the suite ingests a web ref
    // today, which is precisely why it would have stayed unguarded: the cloud
    // transport was the visible hole, this one was not.
    const dir = mkdtempSync(join(tmpdir(), 'ok-net-guard-'));
    let caught: unknown = null;
    try {
      await ingestSourceRef({
        dbPath: join(dir, 'knowledge.db'),
        sourceRef: `${NON_LOOPBACK}/handbook.md`,
        purpose: 'knowledge_index',
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(KnowledgeNetworkGuardError);
    expect(String(caught)).not.toContain('knowledge.invalid');
  });
});

describe('loopback cloud traffic still works (positive control)', () => {
  let server: { port: number; stop: () => void };
  const seen: string[] = [];

  beforeAll(() => {
    server = Bun.serve({
      port: 0,
      hostname: '127.0.0.1',
      fetch(req) {
        const url = new URL(req.url);
        seen.push(`${req.method} ${url.pathname}`);
        return new Response(JSON.stringify({ items: [], total: 0 }), {
          headers: { 'content-type': 'application/json' },
        });
      },
    });
  });

  afterAll(() => {
    server.stop();
  });

  test('the real HTTP transport reaches a 127.0.0.1 server while the guard is armed', async () => {
    const store = resolveKnowledgeCloudStore({
      HASNA_KNOWLEDGE_STORAGE_MODE: 'cloud',
      HASNA_KNOWLEDGE_API_URL: `http://127.0.0.1:${server.port}`,
      HASNA_KNOWLEDGE_API_KEY: FAKE_KEY,
      NODE_ENV: 'test',
    } as NodeJS.ProcessEnv);
    const result = await store!.list({ limit: 1 });
    expect(result.items).toEqual([]);
    // Proves the request was really emitted rather than short-circuited: the
    // server recorded it.
    expect(seen).toContain('GET /v1/notes');
  });
});
