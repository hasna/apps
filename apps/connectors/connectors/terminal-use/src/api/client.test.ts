import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test';
import { ConnectorClient } from './client';
import { ConnectorApiError } from '../types';

describe('ConnectorClient', () => {
  const mockConfig = {
    token: 'tu_test_token_12345',
    agentApiKey: 'agent-key-abc',
    baseUrl: 'https://api.terminaluse.com',
  };

  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  test('throws when token is missing', () => {
    expect(() => new ConnectorClient({})).toThrow('API token is required');
  });

  test('trims trailing slash from custom base_url', async () => {
    global.fetch = mock(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: () => Promise.resolve('[]'),
      } as Response)
    );

    const client = new ConnectorClient({
      token: 'tu_test',
      baseUrl: 'https://custom.example.com/',
    });

    await client.get('/projects');
    const [url] = (global.fetch as ReturnType<typeof mock>).mock.calls[0];
    expect(url).toBe('https://custom.example.com/projects');
  });

  test('rejects non-relative paths', async () => {
    const client = new ConnectorClient(mockConfig);
    await expect(client.get('projects')).rejects.toThrow('must be relative');
    expect(() => client.assertRelativePath('//evil.example.com/projects')).toThrow('Absolute URLs');
  });

  test('sends bearer and x-agent-api-key headers', async () => {
    global.fetch = mock(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: () => Promise.resolve('[]'),
      } as Response)
    );

    const client = new ConnectorClient(mockConfig);
    await client.get('/projects');

    const [, options] = (global.fetch as ReturnType<typeof mock>).mock.calls[0];
    expect(options.headers.Authorization).toBe('Bearer tu_test_token_12345');
    expect(options.headers['x-agent-api-key']).toBe('agent-key-abc');
  });

  test('appends query parameters', async () => {
    global.fetch = mock(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: () => Promise.resolve('[]'),
      } as Response)
    );

    const client = new ConnectorClient(mockConfig);
    await client.get('/projects', { namespace_id: 'ns-1', limit: 10 });

    const [url] = (global.fetch as ReturnType<typeof mock>).mock.calls[0];
    expect(url).toContain('namespace_id=ns-1');
    expect(url).toContain('limit=10');
  });

  test('post sends JSON body', async () => {
    global.fetch = mock(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: () => Promise.resolve('{"id":"p1"}'),
      } as Response)
    );

    const client = new ConnectorClient(mockConfig);
    const body = { namespace_id: 'ns-1', name: 'demo' };
    await client.post('/projects', body);

    const [, options] = (global.fetch as ReturnType<typeof mock>).mock.calls[0];
    expect(options.method).toBe('POST');
    expect(options.body).toBe(JSON.stringify(body));
  });

  test('surfaces non-2xx responses as ConnectorApiError', async () => {
    global.fetch = mock(() =>
      Promise.resolve({
        ok: false,
        status: 401,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: () => Promise.resolve(JSON.stringify({ message: 'Unauthorized' })),
      } as Response)
    );

    const client = new ConnectorClient(mockConfig);
    await expect(client.get('/projects')).rejects.toBeInstanceOf(ConnectorApiError);
    await expect(client.get('/projects')).rejects.toThrow('Unauthorized');
  });

  test('stream returns raw response on success', async () => {
    const response = {
      ok: true,
      status: 200,
      body: {},
    } as Response;

    global.fetch = mock(() => Promise.resolve(response));

    const client = new ConnectorClient(mockConfig);
    const result = await client.stream('/tasks/task-1/stream');
    expect(result).toBe(response);
  });

  test('getTokenPreview masks long tokens', () => {
    const client = new ConnectorClient(mockConfig);
    expect(client.getTokenPreview()).toBe('tu_tes...2345');
  });
});
