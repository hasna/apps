import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test';
import { TursoClient } from './client';
import { DatabasesApi } from './databases';

describe('DatabasesApi', () => {
  let client: TursoClient;
  let databases: DatabasesApi;
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    client = new TursoClient(
      { apiKey: 'test-token', organization: 'acme-corp' },
      'https://api.turso.tech/v1',
    );
    databases = new DatabasesApi(client);
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  test('list() calls organization databases endpoint', async () => {
    global.fetch = mock(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: () => Promise.resolve(JSON.stringify({ databases: [{ Name: 'my-db' }] })),
      } as Response),
    );

    const result = await databases.list({ group: 'default' });

    const [url, options] = (global.fetch as ReturnType<typeof mock>).mock.calls[0];
    expect(url).toBe('https://api.turso.tech/v1/organizations/acme-corp/databases?group=default');
    expect(options.method).toBe('GET');
    expect(result.databases).toHaveLength(1);
  });

  test('get() encodes database name in path', async () => {
    global.fetch = mock(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: () => Promise.resolve(JSON.stringify({ database: { Name: 'my db' } })),
      } as Response),
    );

    await databases.get('my db');

    const [url] = (global.fetch as ReturnType<typeof mock>).mock.calls[0];
    expect(url).toBe('https://api.turso.tech/v1/organizations/acme-corp/databases/my%20db');
  });

  test('create() posts name and group body', async () => {
    global.fetch = mock(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: () =>
          Promise.resolve(
            JSON.stringify({
              database: { Name: 'agent-1', DbId: 'uuid', Hostname: 'agent-1-acme-corp.turso.io' },
            }),
          ),
      } as Response),
    );

    const result = await databases.create({ name: 'agent-1', group: 'default' });

    const [url, options] = (global.fetch as ReturnType<typeof mock>).mock.calls[0];
    expect(url).toBe('https://api.turso.tech/v1/organizations/acme-corp/databases');
    expect(options.method).toBe('POST');
    expect(options.body).toBe(JSON.stringify({ name: 'agent-1', group: 'default' }));
    expect(result.database.Name).toBe('agent-1');
  });

  test('delete() calls DELETE on database path', async () => {
    global.fetch = mock(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: () => Promise.resolve(JSON.stringify({ database: 'my-db' })),
      } as Response),
    );

    const result = await databases.delete('my-db');

    const [url, options] = (global.fetch as ReturnType<typeof mock>).mock.calls[0];
    expect(url).toBe('https://api.turso.tech/v1/organizations/acme-corp/databases/my-db');
    expect(options.method).toBe('DELETE');
    expect(result.database).toBe('my-db');
  });
});
