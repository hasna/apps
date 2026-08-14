import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { Teleport } from './index';
import { TeleportClient } from './client';

type TeleportApi = Teleport;
type TeleportMethodName = keyof {
  [K in keyof TeleportApi as TeleportApi[K] extends (...args: never[]) => unknown ? K : never]: true;
};

type CapturedRequest = { url: URL; method: string; headers: Headers; body?: unknown };

const mockConfig = { baseUrl: 'https://teleport.example.com', token: ' tp-tok ' };
const originalFetch = globalThis.fetch;

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
    return Response.json({});
  }) as typeof fetch;
  return captured;
}

const routeCases: Array<{
  name: TeleportMethodName;
  method: string;
  args?: unknown[];
  path: string;
  query?: Record<string, string>;
  body?: unknown;
}> = [
  { name: 'getPing', method: 'GET', path: '/v1/webapi/ping' },
  { name: 'listNodes', method: 'GET', args: [{ searchAsRoles: true, query: 'labels.env=prod', pageSize: 25, startKey: 'next' }], path: '/v1/sites/local/nodes', query: { query: 'labels.env=prod', page_size: '25', start_key: 'next', search_as_roles: 'true' } },
  { name: 'getNode', method: 'GET', args: ['node/1'], path: '/v1/sites/local/nodes/node%2F1' },
  { name: 'listApps', method: 'GET', path: '/v1/sites/local/apps' },
  { name: 'listKubernetesClusters', method: 'GET', path: '/v1/sites/local/kubernetes' },
  { name: 'listDatabases', method: 'GET', path: '/v1/sites/local/databases' },
  { name: 'listDesktops', method: 'GET', path: '/v1/sites/local/desktops' },
  { name: 'listSessions', method: 'GET', args: [{ from: '2026-05-01T00:00:00Z', to: '2026-05-15T00:00:00Z', order: 'DESC', pageSize: 50, startKey: 'next' }], path: '/v1/sites/local/sessions', query: { from: '2026-05-01T00:00:00Z', to: '2026-05-15T00:00:00Z', order: 'DESC', page_size: '50', start_key: 'next' } },
  { name: 'getSession', method: 'GET', args: ['session/1'], path: '/v1/sites/local/sessions/session%2F1' },
  { name: 'terminateSession', method: 'DELETE', args: ['session/1', 'participant-1'], path: '/v1/sites/local/sessions/session%2F1', query: { participant_id: 'participant-1' } },
  { name: 'listUsers', method: 'GET', path: '/v1/users' },
  { name: 'getUser', method: 'GET', args: ['ada/user', true], path: '/v1/users/ada%2Fuser', query: { with_secrets: 'true' } },
  { name: 'createUser', method: 'POST', args: [{ metadata: { name: 'ada' }, spec: { roles: ['editor'] } }], path: '/v1/users', body: { metadata: { name: 'ada' }, spec: { roles: ['editor'] } } },
  { name: 'updateUser', method: 'PUT', args: ['ada/user', { metadata: { name: 'ada' }, spec: { roles: ['admin'] } }], path: '/v1/users/ada%2Fuser', body: { metadata: { name: 'ada' }, spec: { roles: ['admin'] } } },
  { name: 'deleteUser', method: 'DELETE', args: ['ada/user'], path: '/v1/users/ada%2Fuser' },
  { name: 'listRoles', method: 'GET', path: '/v1/roles' },
  { name: 'getRole', method: 'GET', args: ['access/role'], path: '/v1/roles/access%2Frole' },
  { name: 'upsertRole', method: 'POST', args: [{ metadata: { name: 'access' }, spec: { allow: {} } }], path: '/v1/roles', body: { metadata: { name: 'access' }, spec: { allow: {} } } },
  { name: 'deleteRole', method: 'DELETE', args: ['access/role'], path: '/v1/roles/access%2Frole' },
  { name: 'listAccessRequests', method: 'GET', args: [{ state: 'PENDING', user: 'ada' }], path: '/v1/access_requests', query: { state: 'PENDING', user: 'ada' } },
  { name: 'getAccessRequest', method: 'GET', args: ['req/1'], path: '/v1/access_requests/req%2F1' },
  { name: 'createAccessRequest', method: 'POST', args: [{ user: 'ada', roles: ['editor'], resourceIds: [{ kind: 'node', name: 'node-1', cluster: 'root' }], reason: 'debug', suggestedReviewers: ['ops'] }], path: '/v1/access_requests', body: { user: 'ada', roles: ['editor'], resource_ids: [{ kind: 'node', name: 'node-1', cluster: 'root' }], request_reason: 'debug', suggested_reviewers: ['ops'] } },
  { name: 'approveAccessRequest', method: 'POST', args: ['req/1', 'lgtm'], path: '/v1/access_requests/req%2F1/review', body: { state: 'APPROVED', reason: 'lgtm' } },
  { name: 'denyAccessRequest', method: 'POST', args: ['req/1', 'nope'], path: '/v1/access_requests/req%2F1/review', body: { state: 'DENIED', reason: 'nope' } },
  { name: 'deleteAccessRequest', method: 'DELETE', args: ['req/1'], path: '/v1/access_requests/req%2F1' },
  { name: 'listTokens', method: 'GET', path: '/v1/tokens' },
  { name: 'createToken', method: 'POST', args: [{ roles: ['node'], ttl: '1h', name: 'node-token', allowedCidrs: ['203.0.113.0/24'] }], path: '/v1/tokens', body: { roles: ['node'], ttl: '1h', name: 'node-token', allowed_cidrs: ['203.0.113.0/24'] } },
  { name: 'deleteToken', method: 'DELETE', args: ['node/token'], path: '/v1/tokens/node%2Ftoken' },
  { name: 'getAuditEvents', method: 'GET', args: [{ from: '2026-05-01T00:00:00Z', to: '2026-05-15T00:00:00Z', eventType: ['session.start'], pageSize: 100, startKey: 'next', order: 'ASC' }], path: '/v1/events/search', query: { from: '2026-05-01T00:00:00Z', to: '2026-05-15T00:00:00Z', event_type: 'session.start', page_size: '100', start_key: 'next', order: 'ASC' } },
  { name: 'getSessionRecording', method: 'GET', args: ['session/1'], path: '/v1/sessions/session%2F1/recording' },
  { name: 'listAuthConnectors', method: 'GET', path: '/v1/auth_connectors' },
  { name: 'upsertAuthConnector', method: 'POST', args: [{ kind: 'oidc', metadata: { name: 'google' }, spec: { issuer_url: 'https://accounts.example.com' } }], path: '/v1/auth_connectors', body: { kind: 'oidc', metadata: { name: 'google' }, spec: { issuer_url: 'https://accounts.example.com' } } },
  { name: 'deleteAuthConnector', method: 'DELETE', args: ['oidc', 'google/oidc'], path: '/v1/auth_connectors/oidc/google%2Foidc' },
];

beforeEach(() => {
  globalThis.fetch = originalFetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('TeleportClient', () => {
  test('throws when baseUrl is missing', () => {
    expect(() => new TeleportClient({ baseUrl: '', token: 'tok' })).toThrow('Teleport baseUrl is required');
  });

  test('throws when token is missing', () => {
    expect(() => new TeleportClient({ baseUrl: 'https://teleport.example.com', token: '' })).toThrow('Teleport token is required');
  });

  test('strips trailing slash from base URL', () => {
    const client = new TeleportClient({ baseUrl: 'https://teleport.example.com/', token: 'tok' });
    expect(client.getBaseUrl()).toBe('https://teleport.example.com');
  });
});

describe('Teleport API routes', () => {
  test('covers every command route and request shape', async () => {
    expect(routeCases).toHaveLength(33);
    expect(new Set(routeCases.map((tc) => tc.name)).size).toBe(routeCases.length);

    const api = new Teleport(mockConfig);

    for (const tc of routeCases) {
      const captured = installFetchMock();
      const fn = api[tc.name] as (...args: unknown[]) => Promise<unknown>;
      await fn.call(api, ...(tc.args ?? []));
      const req = captured[0]!;
      expect(req.method, tc.name).toBe(tc.method);
      expect(req.url.origin, tc.name).toBe('https://teleport.example.com');
      expect(req.url.pathname, tc.name).toBe(tc.path);
      expect(Object.fromEntries(req.url.searchParams.entries()), tc.name).toEqual(tc.query ?? {});
      expect(req.headers.get('Authorization'), tc.name).toBe('Bearer tp-tok');
      expect(req.headers.get('Accept'), tc.name).toBe('application/json');
      if (tc.body === undefined) {
        expect(req.headers.get('Content-Type'), tc.name).toBeNull();
        expect(req.body, tc.name).toBeUndefined();
      } else {
        expect(req.headers.get('Content-Type'), tc.name).toBe('application/json');
        expect(req.body, tc.name).toEqual(tc.body);
      }
    }
  });

  test('getPing hits /v1/webapi/ping with Bearer auth', async () => {
    const captured = installFetchMock();
    await new Teleport(mockConfig).getPing();
    expect(captured[0]!.url.pathname).toBe('/v1/webapi/ping');
    expect(captured[0]!.headers.get('Authorization')).toBe('Bearer tp-tok');
  });

  test('approveAccessRequest POSTs review with state=APPROVED', async () => {
    const captured = installFetchMock();
    await new Teleport(mockConfig).approveAccessRequest('req-1', 'lgtm');
    expect(captured[0]!.method).toBe('POST');
    expect(captured[0]!.url.pathname).toBe('/v1/access_requests/req-1/review');
    expect(captured[0]!.body).toEqual({ state: 'APPROVED', reason: 'lgtm' });
  });

  test('non-2xx responses surface Teleport error message', async () => {
    installFetchMock(Response.json({ message: 'permission denied' }, { status: 403 }));
    await expect(new Teleport(mockConfig).getPing()).rejects.toThrow('Teleport: permission denied');
  });
});

describe('Teleport.fromEnv', () => {
  const originalBaseUrl = process.env.TELEPORT_BASE_URL;
  const originalToken = process.env.TELEPORT_TOKEN;

  afterEach(() => {
    if (originalBaseUrl === undefined) delete process.env.TELEPORT_BASE_URL;
    else process.env.TELEPORT_BASE_URL = originalBaseUrl;
    if (originalToken === undefined) delete process.env.TELEPORT_TOKEN;
    else process.env.TELEPORT_TOKEN = originalToken;
  });

  test('requires TELEPORT_BASE_URL and TELEPORT_TOKEN', () => {
    delete process.env.TELEPORT_BASE_URL;
    delete process.env.TELEPORT_TOKEN;
    expect(() => Teleport.fromEnv()).toThrow('TELEPORT_BASE_URL and TELEPORT_TOKEN are required');
  });
});
