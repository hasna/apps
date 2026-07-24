import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { WorkatoConnector } from './index';

type CapturedRequest = {
  url: URL;
  method: string;
  headers: Headers;
  body?: unknown;
};

type CommandCase = {
  name: string;
  run: (connector: WorkatoConnector) => Promise<unknown>;
  method?: string;
  path: string;
  query?: Record<string, string>;
  body?: unknown;
};

function parseBody(body: BodyInit | null | undefined): unknown {
  if (typeof body !== 'string' || body.length === 0) return undefined;
  return JSON.parse(body);
}

function installFetchMock(baseUrl: string) {
  const captured: CapturedRequest[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url,
    );
    captured.push({
      url,
      method: init?.method ?? 'GET',
      headers: new Headers(init?.headers),
      body: parseBody(init?.body),
    });
    return Response.json({ ok: true, path: url.pathname });
  }) as typeof fetch;
  return { captured, connector: new WorkatoConnector({ apiToken: 'workato-token', baseUrl }) };
}

function expectWorkatoRequest(request: CapturedRequest, commandCase: CommandCase, basePath: string) {
  expect(request.url.pathname).toBe(`${basePath}${commandCase.path}`);
  for (const [key, value] of Object.entries(commandCase.query ?? {})) {
    expect(request.url.searchParams.get(key), key).toBe(value);
  }
  expect([...request.url.searchParams.keys()].sort()).toEqual(
    Object.keys(commandCase.query ?? {}).sort(),
  );
  expect(request.method).toBe(commandCase.method ?? 'GET');
  expect(request.headers.get('Authorization')).toBe('Bearer workato-token');
  expect(request.headers.get('Accept')).toBe('application/json');
  if (commandCase.body === undefined) {
    expect(request.headers.get('Content-Type')).toBeNull();
  } else {
    expect(request.headers.get('Content-Type')).toBe('application/json');
  }
  expect(request.body).toEqual(commandCase.body);
}

describe('WorkatoConnector API modules', () => {
  const baseUrl = 'https://workato.example/api/v3';
  const pageQuery = { per_page: '20', page: '2' };

  const cases: CommandCase[] = [
    {
      name: 'recipes.list',
      run: c => c.recipes.list({ folderId: 10, running: true, perPage: 20, page: 2, updatedAfter: '2026-01-01T00:00:00Z', order: 'updated_at' }),
      path: '/recipes',
      query: { folder_id: '10', running: 'true', per_page: '20', page: '2', updated_after: '2026-01-01T00:00:00Z', order: 'updated_at' },
    },
    { name: 'recipes.get', run: c => c.recipes.get(1), path: '/recipes/1' },
    { name: 'recipes.start', run: c => c.recipes.start(1), method: 'PUT', path: '/recipes/1/start' },
    { name: 'recipes.stop', run: c => c.recipes.stop(1), method: 'PUT', path: '/recipes/1/stop' },
    {
      name: 'jobs.list',
      run: c => c.jobs.list({ recipeId: 1, status: 'succeeded', perPage: 20, offset: 5, fromTimestamp: '2026-01-01T00:00:00Z', toTimestamp: '2026-01-02T00:00:00Z' }),
      path: '/recipes/1/jobs',
      query: { status: 'succeeded', per_page: '20', offset: '5', from_timestamp: '2026-01-01T00:00:00Z', to_timestamp: '2026-01-02T00:00:00Z' },
    },
    { name: 'jobs.get', run: c => c.jobs.get(1, 'job/1'), path: '/recipes/1/jobs/job%2F1' },
    {
      name: 'connections.list',
      run: c => c.connections.list({ provider: 'salesforce', folderId: 10, perPage: 20, page: 2 }),
      path: '/connections',
      query: { provider: 'salesforce', folder_id: '10', per_page: '20', page: '2' },
    },
    { name: 'connections.get', run: c => c.connections.get(2), path: '/connections/2' },
    {
      name: 'connections.create',
      run: c => c.connections.create({ name: 'CRM', provider: 'salesforce', folderId: 10, input: { host: 'example' } }),
      method: 'POST',
      path: '/connections',
      body: { name: 'CRM', provider: 'salesforce', folder_id: 10, input: { host: 'example' } },
    },
    {
      name: 'connections.update',
      run: c => c.connections.update({ id: 2, name: 'CRM 2', input: { host: 'example2' } }),
      method: 'PUT',
      path: '/connections/2',
      body: { name: 'CRM 2', input: { host: 'example2' } },
    },
    { name: 'connections.delete', run: c => c.connections.delete(2), method: 'DELETE', path: '/connections/2' },
    {
      name: 'folders.list',
      run: c => c.folders.list({ parentId: 10, perPage: 20, page: 2 }),
      path: '/folders',
      query: { parent_id: '10', per_page: '20', page: '2' },
    },
    {
      name: 'folders.create',
      run: c => c.folders.create({ name: 'Ops', parentId: 10 }),
      method: 'POST',
      path: '/folders',
      body: { name: 'Ops', parent_id: 10 },
    },
    {
      name: 'folders.update',
      run: c => c.folders.update({ id: 3, name: 'Ops 2', parentId: 11 }),
      method: 'PUT',
      path: '/folders/3',
      body: { name: 'Ops 2', parent_id: 11 },
    },
    { name: 'folders.delete', run: c => c.folders.delete(3), method: 'DELETE', path: '/folders/3' },
    { name: 'projects.list', run: c => c.projects.list({ perPage: 20, page: 2 }), path: '/projects', query: pageQuery },
    { name: 'projects.get', run: c => c.projects.get(4), path: '/projects/4' },
    {
      name: 'projects.export',
      run: c => c.projects.export({ projectId: 4, includeData: true }),
      method: 'POST',
      path: '/projects/4/export',
      body: { include_data: true },
    },
    { name: 'lookupTables.list', run: c => c.lookupTables.list({ perPage: 20, page: 2 }), path: '/lookup_tables', query: pageQuery },
    { name: 'lookupTables.get', run: c => c.lookupTables.get(5), path: '/lookup_tables/5' },
    {
      name: 'lookupTables.lookupRow',
      run: c => c.lookupTables.lookupRow({ tableId: 5, column: 'email', value: 'person@example.com' }),
      path: '/lookup_tables/5/rows',
      query: { column: 'email', value: 'person@example.com' },
    },
    {
      name: 'lookupTables.createRow',
      run: c => c.lookupTables.createRow({ tableId: 5, data: { email: 'person@example.com' } }),
      method: 'POST',
      path: '/lookup_tables/5/rows',
      body: { data: { email: 'person@example.com' } },
    },
    {
      name: 'lookupTables.updateRow',
      run: c => c.lookupTables.updateRow({ tableId: 5, rowId: 6, data: { email: 'new@example.com' } }),
      method: 'PUT',
      path: '/lookup_tables/5/rows/6',
      body: { data: { email: 'new@example.com' } },
    },
    { name: 'lookupTables.deleteRow', run: c => c.lookupTables.deleteRow(5, 6), method: 'DELETE', path: '/lookup_tables/5/rows/6' },
    { name: 'properties.list', run: c => c.properties.list({ perPage: 20, page: 2 }), path: '/properties', query: pageQuery },
    {
      name: 'properties.upsert',
      run: c => c.properties.upsert({ name: 'region', value: 'eu' }),
      method: 'POST',
      path: '/properties',
      body: { name: 'region', value: 'eu' },
    },
    { name: 'users.list', run: c => c.users.list({ perPage: 20, page: 2 }), path: '/users', query: pageQuery },
  ];

  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  test('executes all 27 API operations through expected endpoints', async () => {
    const { captured, connector } = installFetchMock(baseUrl);

    for (const commandCase of cases) {
      const result = await commandCase.run(connector);
      expect(result).toEqual({ ok: true, path: `/api/v3${commandCase.path}` });
    }

    expect(captured).toHaveLength(cases.length);
    expect(cases).toHaveLength(27);
    cases.forEach((commandCase, index) => {
      expectWorkatoRequest(captured[index]!, commandCase, '/api/v3');
    });

    global.fetch = originalFetch;
  });

  test('uses default API base URL', async () => {
    const { captured, connector } = installFetchMock('https://www.workato.com/api');

    const result = await connector.users.list();
    expect(result).toEqual({ ok: true, path: '/api/users' });
    expect(captured).toHaveLength(1);
    expect(captured[0]!.url.origin).toBe('https://www.workato.com');
    expect(captured[0]!.url.pathname).toBe('/api/users');

    global.fetch = originalFetch;
  });
});
