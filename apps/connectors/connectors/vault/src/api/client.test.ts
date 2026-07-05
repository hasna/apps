import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { VaultClient } from './client';
import { Vault } from './index';
import { VaultApiError } from '../types';

type CapturedRequest = { url: URL; method: string; headers: Headers; body?: unknown };

const mockConfig = {
  baseUrl: 'https://vault.example.com',
  token: ' vlt-tok ',
  namespace: 'admin/team-a',
};

function parseBody(body: BodyInit | null | undefined): unknown {
  if (typeof body !== 'string' || body.length === 0) return undefined;
  return JSON.parse(body);
}

function installFetchMock(response?: Response): CapturedRequest[] {
  const captured: CapturedRequest[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url);
    captured.push({
      url,
      method: init?.method ?? 'GET',
      headers: new Headers(init?.headers),
      body: parseBody(init?.body),
    });
    if (response) return response.clone();
    return Response.json({ data: {} });
  }) as typeof fetch;
  return captured;
}

describe('VaultClient', () => {
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('constructor requires baseUrl and token', () => {
    expect(() => new VaultClient({ baseUrl: '', token: 'tok' })).toThrow('Vault baseUrl is required');
    expect(() => new VaultClient({ baseUrl: 'https://vault.example.com', token: '' })).toThrow('Vault token is required');
    const client = new VaultClient(mockConfig);
    expect(client.getBaseUrl()).toBe('https://vault.example.com');
  });

  test('getHealth hits /v1/sys/health with X-Vault-Token', async () => {
    const captured = installFetchMock();
    const client = new VaultClient(mockConfig);
    await client.request('GET', '/v1/sys/health');
    const req = captured[0]!;
    expect(req.method).toBe('GET');
    expect(req.url.origin).toBe('https://vault.example.com');
    expect(req.url.pathname).toBe('/v1/sys/health');
    expect(req.headers.get('X-Vault-Token')).toBe('vlt-tok');
    expect(req.headers.get('Accept')).toBe('application/json');
  });

  test('namespace is sent as X-Vault-Namespace', async () => {
    const captured = installFetchMock();
    const client = new VaultClient(mockConfig);
    await client.request('GET', '/v1/sys/health');
    expect(captured[0]!.headers.get('X-Vault-Namespace')).toBe('admin/team-a');
  });

  test('readKvSecret encodes mount and path', async () => {
    const captured = installFetchMock();
    const vault = new Vault({ baseUrl: mockConfig.baseUrl, token: 'vlt-tok' });
    await vault.readKvSecret({ mount: 'kv', path: 'service/api', version: 3 });
    const req = captured[0]!;
    expect(req.method).toBe('GET');
    expect(req.url.pathname).toBe('/v1/kv/data/service/api');
    expect(req.url.searchParams.get('version')).toBe('3');
  });

  test('writeKvSecret POSTs wrapped data and cas option', async () => {
    const captured = installFetchMock();
    const vault = new Vault({ baseUrl: mockConfig.baseUrl, token: 'vlt-tok' });
    await vault.writeKvSecret({ mount: 'kv', path: 'service/api', data: { key: 'value' }, cas: 2 });
    expect(captured[0]!.method).toBe('POST');
    expect(captured[0]!.url.pathname).toBe('/v1/kv/data/service/api');
    expect(captured[0]!.body).toEqual({ data: { key: 'value' }, options: { cas: 2 } });
  });

  test('listKvSecrets routes LIST as GET with list=true', async () => {
    const captured = installFetchMock();
    const vault = new Vault({ baseUrl: mockConfig.baseUrl, token: 'vlt-tok' });
    await vault.listKvSecrets({ mount: 'kv', path: 'service' });
    expect(captured[0]!.method).toBe('GET');
    expect(captured[0]!.url.pathname).toBe('/v1/kv/metadata/service');
    expect(captured[0]!.url.searchParams.get('list')).toBe('true');
  });

  test('encrypt hits transit encrypt endpoint', async () => {
    const captured = installFetchMock();
    const vault = new Vault({ baseUrl: mockConfig.baseUrl, token: 'vlt-tok' });
    await vault.encrypt({ mount: 'transit', key: 'app-key', plaintext: 'cGxhaW4=' });
    expect(captured[0]!.method).toBe('POST');
    expect(captured[0]!.url.pathname).toBe('/v1/transit/encrypt/app-key');
    expect(captured[0]!.body).toEqual({ plaintext: 'cGxhaW4=', context: undefined, type: undefined });
  });

  test('enableMount encodes path segments', async () => {
    const captured = installFetchMock();
    const vault = new Vault({ baseUrl: mockConfig.baseUrl, token: 'vlt-tok' });
    await vault.enableMount({ path: 'kv/team', type: 'kv' });
    expect(captured[0]!.url.pathname).toBe('/v1/sys/mounts/kv%2Fteam');
  });

  test('wrap sets X-Vault-Wrap-TTL header', async () => {
    const captured = installFetchMock();
    const vault = new Vault({ baseUrl: mockConfig.baseUrl, token: 'vlt-tok' });
    await vault.wrap({ data: { foo: 'bar' }, ttl: '5m' });
    expect(captured[0]!.method).toBe('POST');
    expect(captured[0]!.url.pathname).toBe('/v1/sys/wrapping/wrap');
    expect(captured[0]!.headers.get('X-Vault-Wrap-TTL')).toBe('5m');
    expect(captured[0]!.body).toEqual({ foo: 'bar' });
  });

  test('non-2xx responses surface errors[0]', async () => {
    installFetchMock(Response.json({ errors: ['permission denied'] }, { status: 403 }));
    const client = new VaultClient({ baseUrl: mockConfig.baseUrl, token: 'vlt-tok' });
    await expect(client.request('GET', '/v1/sys/policies/acl')).rejects.toThrow('Vault: permission denied');
  });

  test('throws VaultApiError with status code', async () => {
    installFetchMock(Response.json({ errors: ['denied'] }, { status: 403 }));
    const client = new VaultClient({ baseUrl: mockConfig.baseUrl, token: 'vlt-tok' });
    try {
      await client.request('GET', '/v1/sys/policies/acl');
      throw new Error('expected failure');
    } catch (err) {
      expect(err).toBeInstanceOf(VaultApiError);
      expect((err as VaultApiError).statusCode).toBe(403);
    }
  });
});

describe('Vault route matrix', () => {
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  const routeCases: Array<{
    run: (v: Vault) => Promise<unknown>;
    method: string;
    path: string;
    query?: Record<string, string>;
  }> = [
    { run: (v) => v.getSealStatus(), method: 'GET', path: '/v1/sys/seal-status' },
    { run: (v) => v.revokeToken({ token: 'child-token', orphan: true }), method: 'POST', path: '/v1/auth/token/revoke-orphan' },
    { run: (v) => v.listLeases({ prefix: 'database/creds/app' }), method: 'GET', path: '/v1/sys/leases/lookup/database/creds/app', query: { list: 'true' } },
    { run: (v) => v.listEntities(), method: 'GET', path: '/v1/identity/entity/id', query: { list: 'true' } },
    { run: (v) => v.getEntity({ id: 'entity/1' }), method: 'GET', path: '/v1/identity/entity/id/entity%2F1' },
  ];

  for (const routeCase of routeCases) {
    test(`${routeCase.path} uses ${routeCase.method}`, async () => {
      const captured = installFetchMock();
      const vault = new Vault({ baseUrl: 'https://vault.example.com', token: 'vlt-tok' });
      await routeCase.run(vault);
      const req = captured[0]!;
      expect(req.method).toBe(routeCase.method);
      expect(req.url.pathname).toBe(routeCase.path);
      if (routeCase.query) {
        expect(Object.fromEntries(req.url.searchParams.entries())).toEqual(routeCase.query);
      }
    });
  }
});
