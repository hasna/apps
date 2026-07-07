import { afterEach, describe, expect, test } from 'bun:test';
import { ConnectorClient } from './client';
import { BoxesApi } from './boxes';
import { CommentsApi } from './comments';
import { FieldsApi } from './fields';
import { PipelinesApi } from './pipelines';
import { StagesApi } from './stages';
import { TasksApi } from './tasks';

const realFetch = globalThis.fetch;

interface Recorded {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

function installFetch(handler: (recorded: Recorded) => unknown) {
  const recorded: Recorded[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const headers: Record<string, string> = {};
    if (init?.headers) {
      const h = init.headers as Record<string, string>;
      Object.assign(headers, h);
    }
    const entry: Recorded = {
      url,
      method: init?.method ?? 'GET',
      headers,
      body: typeof init?.body === 'string' ? init.body : undefined,
    };
    recorded.push(entry);
    const json = handler(entry);
    return {
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      async text() {
        return JSON.stringify(json ?? {});
      },
    } as Response;
  }) as typeof fetch;
  return recorded;
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('Streak ConnectorClient', () => {
  test('requires API key', () => {
    expect(() => new ConnectorClient({})).toThrow('API key is required');
  });

  test('builds Basic auth header from apiKey:', () => {
    const client = new ConnectorClient({ apiKey: 'test-key-123' });
    const expected = `Basic ${Buffer.from('test-key-123:').toString('base64')}`;
    expect(client.getAuthHeader()).toBe(expected);
  });

  test('GET requests use /api/v1 base URL', async () => {
    const recorded = installFetch((r) => {
      expect(r.url).toBe('https://api.streak.com/api/v1/pipelines');
      expect(r.method).toBe('GET');
      expect(r.headers.Authorization).toMatch(/^Basic /);
      return [{ key: 'p1', name: 'Sales' }];
    });
    const client = new ConnectorClient({ apiKey: 'key' });
    const result = await client.get<unknown[]>('/pipelines');
    expect(result).toEqual([{ key: 'p1', name: 'Sales' }]);
    expect(recorded).toHaveLength(1);
  });

  test('v1 PUT form requests send URL-encoded bodies', async () => {
    const recorded = installFetch((r) => {
      expect(r.method).toBe('PUT');
      expect(r.url).toBe('https://api.streak.com/api/v1/pipelines');
      expect(r.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
      expect(r.body).toBe('name=Sales&teamWide=true');
      return { key: 'p1', name: 'Sales' };
    });
    const client = new ConnectorClient({ apiKey: 'key' });
    const pipeline = await client.putForm<{ key: string }>('/pipelines', {
      name: 'Sales',
      teamWide: true,
    });
    expect(pipeline.key).toBe('p1');
    expect(recorded[0].method).toBe('PUT');
  });

  test('v2 POST requests use /api/v2 with JSON bodies', async () => {
    const recorded = installFetch((r) => {
      expect(r.method).toBe('POST');
      expect(r.url).toBe('https://api.streak.com/api/v2/pipelines/pipe1/boxes');
      expect(r.headers['Content-Type']).toBe('application/json');
      expect(r.body).toBe(JSON.stringify({ name: 'Deal' }));
      return { key: 'box1', name: 'Deal' };
    });
    const client = new ConnectorClient({ apiKey: 'key' });
    const box = await client.postV2<{ key: string }>('/pipelines/pipe1/boxes', { name: 'Deal' });
    expect(box.key).toBe('box1');
    expect(recorded[0].method).toBe('POST');
  });

  test('custom baseUrl is treated as the complete API root', async () => {
    const recorded = installFetch((r) => {
      expect(r.url).toBe('https://proxy.example/streak/pipelines');
      return [];
    });
    const client = new ConnectorClient({
      apiKey: 'key',
      baseUrl: 'https://proxy.example/streak',
    });
    await client.get('/pipelines');
    expect(recorded).toHaveLength(1);
  });

  test('POST updates resources (Streak convention)', async () => {
    const recorded = installFetch((r) => {
      expect(r.method).toBe('POST');
      expect(r.url).toContain('/boxes/box1');
      return { key: 'box1', name: 'Updated' };
    });
    const client = new ConnectorClient({ apiKey: 'key' });
    const box = await client.post<{ name: string }>('/boxes/box1', { name: 'Updated' });
    expect(box.name).toBe('Updated');
    expect(recorded[0].method).toBe('POST');
  });

  test('appends query params to URL', async () => {
    const recorded = installFetch((r) => {
      expect(r.url).toContain('query=acme');
      return { results: [] };
    });
    const client = new ConnectorClient({ apiKey: 'key' });
    await client.get('/search', { query: 'acme' });
    expect(recorded[0].url).toContain('query=acme');
  });

  test('throws ConnectorApiError on non-ok response', async () => {
    globalThis.fetch = (async () => ({
      ok: false,
      status: 401,
      headers: new Headers({ 'content-type': 'application/json' }),
      async text() {
        return JSON.stringify({ error: 'Unauthorized' });
      },
    })) as unknown as typeof fetch;
    const client = new ConnectorClient({ apiKey: 'bad-key' });
    await expect(client.get('/users/me')).rejects.toMatchObject({ statusCode: 401 });
  });
});

describe('Streak documented endpoint conventions', () => {
  test('box, task, and comment creates use v2 POST JSON endpoints', async () => {
    const recorded = installFetch((r) => ({ key: r.url.split('/').pop() || 'created' }));
    const client = new ConnectorClient({ apiKey: 'key' });

    await new BoxesApi(client).create('pipe1', { name: 'Deal' });
    await new TasksApi(client).create('box1', { text: 'Follow up' });
    await new CommentsApi(client).create('box1', 'Called customer');

    expect(recorded.map((r) => [r.method, r.url, r.body])).toEqual([
      ['POST', 'https://api.streak.com/api/v2/pipelines/pipe1/boxes', '{"name":"Deal"}'],
      ['POST', 'https://api.streak.com/api/v2/boxes/box1/tasks', '{"text":"Follow up"}'],
      ['POST', 'https://api.streak.com/api/v2/boxes/box1/comments', '{"message":"Called customer"}'],
    ]);
  });

  test('box update stays on the documented v1 POST JSON endpoint', async () => {
    const recorded = installFetch((r) => ({ key: 'box1', name: JSON.parse(r.body || '{}').name }));
    const client = new ConnectorClient({ apiKey: 'key' });

    await new BoxesApi(client).update('box1', { name: 'Updated' });

    expect(recorded.map((r) => [r.method, r.url, r.headers['Content-Type'], r.body])).toEqual([
      ['POST', 'https://api.streak.com/api/v1/boxes/box1', 'application/json', '{"name":"Updated"}'],
    ]);
  });

  test('task and comment deletes use documented v2 DELETE endpoints', async () => {
    const recorded = installFetch(() => ({}));
    const client = new ConnectorClient({ apiKey: 'key' });

    await new TasksApi(client).delete('task1');
    await new CommentsApi(client).delete('comment1');

    expect(recorded.map((r) => [r.method, r.url])).toEqual([
      ['DELETE', 'https://api.streak.com/api/v2/tasks/task1'],
      ['DELETE', 'https://api.streak.com/api/v2/comments/comment1'],
    ]);
  });

  test('pipeline, stage, and field creates use v1 PUT form endpoints', async () => {
    const recorded = installFetch((r) => ({ key: r.url.split('/').pop() || 'created' }));
    const client = new ConnectorClient({ apiKey: 'key' });

    await new PipelinesApi(client).create({ name: 'Sales', orgWide: true });
    await new StagesApi(client).create('pipe1', 'Qualified');
    await new FieldsApi(client).create('pipe1', { name: 'Amount', type: 'TEXT_INPUT' });

    expect(recorded.map((r) => [r.method, r.url, r.headers['Content-Type'], r.body])).toEqual([
      ['PUT', 'https://api.streak.com/api/v1/pipelines', 'application/x-www-form-urlencoded', 'name=Sales&orgWide=true'],
      ['PUT', 'https://api.streak.com/api/v1/pipelines/pipe1/stages', 'application/x-www-form-urlencoded', 'name=Qualified'],
      ['PUT', 'https://api.streak.com/api/v1/pipelines/pipe1/fields', 'application/x-www-form-urlencoded', 'name=Amount&type=TEXT_INPUT'],
    ]);
  });
});
