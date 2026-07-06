import { afterEach, describe, expect, test } from 'bun:test';
import { Tinybird } from './index';
import { TinybirdClient } from './client';

const realFetch = globalThis.fetch;

interface Recorded {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

function installFetch(handler: (url: string, init: RequestInit | undefined, recorded: Recorded[]) => unknown) {
  const recorded: Recorded[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => {
      headers[k.toLowerCase()] = v;
    });
    const body = typeof init?.body === 'string' ? init.body : undefined;
    recorded.push({ url, method: init?.method ?? 'GET', headers, body });
    const json = handler(url, init, recorded);
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: new Headers({ 'content-type': 'application/json' }),
      async text() {
        return typeof json === 'string' ? json : JSON.stringify(json ?? {});
      },
    } as Response;
  }) as typeof fetch;
  return recorded;
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('TinybirdClient transport', () => {
  test('sends Bearer authorization header', async () => {
    const recorded = installFetch(() => ({ ok: true }));
    const tb = new Tinybird({ apiToken: 'p.abc123' });
    await tb.pipes.list();
    expect(recorded[0].headers.authorization).toBe('Bearer p.abc123');
  });

  test('sql query uses /v0/sql with q and format params', async () => {
    const recorded = installFetch(() => ({ data: [] }));
    const tb = new Tinybird({ apiToken: 'tok' });
    await tb.sql.query({ q: 'SELECT 1', format: 'json' });
    expect(recorded[0].url).toContain('https://api.tinybird.co/v0/sql');
    expect(recorded[0].url).toContain('q=SELECT+1');
    expect(recorded[0].url).toContain('format=json');
    expect(recorded[0].method).toBe('GET');
  });

  test('pipe query uses GET on /v0/pipes/{name}.json', async () => {
    const recorded = installFetch(() => ({ data: [] }));
    const tb = new Tinybird({ apiToken: 'tok' });
    await tb.pipes.query('my_pipe');
    expect(recorded[0].url).toContain('/v0/pipes/my_pipe.json');
    expect(recorded[0].method).toBe('GET');
  });

  test('events ingest POSTs NDJSON with application/x-ndjson', async () => {
    const recorded = installFetch(() => 'ok');
    const tb = new Tinybird({ apiToken: 'tok' });
    await tb.events.ingest('events_ds', '{"a":1}\n');
    expect(recorded[0].url).toContain('/v0/events?name=events_ds');
    expect(recorded[0].method).toBe('POST');
    expect(recorded[0].headers['content-type']).toBe('application/x-ndjson');
    expect(recorded[0].body).toBe('{"a":1}\n');
  });

  test('datasource create uses URLSearchParams POST without JSON body', async () => {
    const recorded = installFetch(() => ({ datasource: { name: 'ds' } }));
    const tb = new Tinybird({ apiToken: 'tok' });
    await tb.datasources.createOrAppend({ name: 'ds', mode: 'create', schema: 'a Int32' });
    expect(recorded[0].url).toContain('/v0/datasources?');
    expect(recorded[0].url).toContain('name=ds');
    expect(recorded[0].url).toContain('mode=create');
    expect(recorded[0].url).toContain('schema=');
    expect(recorded[0].method).toBe('POST');
    expect(recorded[0].body).toBeUndefined();
  });

  test('pipe create with SQL sends query parameters instead of JSON body', async () => {
    const recorded = installFetch(() => ({ pipe: { name: 'p' } }));
    const tb = new Tinybird({ apiToken: 'tok' });
    await tb.pipes.create({ name: 'p', sql: 'select 1', description: 'demo' });
    expect(recorded[0].url).toContain('/v0/pipes?');
    expect(recorded[0].url).toContain('name=p');
    expect(recorded[0].url).toContain('sql=select+1');
    expect(recorded[0].url).toContain('description=demo');
    expect(recorded[0].method).toBe('POST');
    expect(recorded[0].body).toBeUndefined();
  });

  test('append node sends SQL as raw body with node metadata in query', async () => {
    const recorded = installFetch(() => ({ node: { name: 'n' } }));
    const tb = new Tinybird({ apiToken: 'tok' });
    await tb.pipes.appendNode('p', { nodeName: 'n', sql: 'select * from p', description: 'next' });
    expect(recorded[0].url).toContain('/v0/pipes/p/nodes?');
    expect(recorded[0].url).toContain('name=n');
    expect(recorded[0].url).toContain('description=next');
    expect(recorded[0].headers['content-type']).toBe('text/plain; charset=utf-8');
    expect(recorded[0].body).toBe('select * from p');
  });

  test('token create sends repeated scope form fields', async () => {
    const recorded = installFetch(() => ({ token: 'p.token' }));
    const tb = new Tinybird({ apiToken: 'tok' });
    await tb.tokens.create({ name: 'read', scopes: ['PIPES:READ:p', 'DATASOURCES:READ:ds'], description: 'Read token' });
    expect(recorded[0].url).toContain('/v0/tokens');
    expect(recorded[0].headers['content-type']).toBe('application/x-www-form-urlencoded');
    expect(recorded[0].body).toBe('name=read&description=Read+token&scope=PIPES%3AREAD%3Ap&scope=DATASOURCES%3AREAD%3Ads');
  });

  test('datasource row delete sends form-encoded delete condition', async () => {
    const recorded = installFetch(() => ({ ok: true }));
    const tb = new Tinybird({ apiToken: 'tok' });
    await tb.datasources.deleteRows('events', "date < '2026-01-01'");
    expect(recorded[0].url).toContain('/v0/datasources/events/delete');
    expect(recorded[0].headers['content-type']).toBe('application/x-www-form-urlencoded');
    expect(recorded[0].body).toBe('delete_condition=date+%3C+%272026-01-01%27');
  });

  test('requires api token', () => {
    expect(() => new Tinybird({ apiToken: '' })).toThrow('Tinybird API token is required');
  });

  test('respects custom base URL', async () => {
    const recorded = installFetch(() => ({}));
    const tb = new Tinybird({ apiToken: 'tok', baseUrl: 'https://custom.example.com/' });
    await tb.tokens.list();
    expect(recorded[0].url).toMatch(/^https:\/\/custom\.example\.com\/v0\/tokens/);
  });

  test('form helper skips empty and undefined values', () => {
    const client = new TinybirdClient({ apiToken: 'tok' });
    expect(client.createForm({ a: '1', b: '', c: undefined, d: false }).toString()).toBe('a=1&d=false');
  });
});
