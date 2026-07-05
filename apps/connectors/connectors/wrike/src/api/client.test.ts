import { describe, it, expect, mock } from 'bun:test';
import { WrikeClient } from './client';
import { Wrike } from './index';
import { WrikeApiError, parseWrikeError } from '../types';

function restoreFetch(original: typeof globalThis.fetch) {
  globalThis.fetch = original;
}

describe('WrikeClient', () => {
  it('should require an API token', () => {
    expect(() => new WrikeClient({ apiToken: '' })).toThrow('API token is required');
    expect(() => new WrikeClient({ apiToken: '   ' })).toThrow('API token is required');
  });

  it('should use lowercase bearer authorization header', async () => {
    const originalFetch = globalThis.fetch;
    let capturedHeaders: Record<string, string> = {};

    globalThis.fetch = mock((_url: unknown, options: { headers: Record<string, string> }) => {
      capturedHeaders = options.headers;
      return Promise.resolve(
        new Response(JSON.stringify({ kind: 'tasks', data: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    }) as any;

    const client = new WrikeClient({ apiToken: 'test-token-value' });
    await client.get('/tasks');

    expect(capturedHeaders.Authorization).toBe('bearer test-token-value');
    expect(capturedHeaders.Accept).toBe('application/json');

    restoreFetch(originalFetch);
  });

  it('should build URL from configurable host', async () => {
    const originalFetch = globalThis.fetch;
    let capturedUrl = '';

    globalThis.fetch = mock((url: string) => {
      capturedUrl = url;
      return Promise.resolve(
        new Response(JSON.stringify({ kind: 'version', data: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    }) as any;

    const client = new WrikeClient({ apiToken: 'token', host: 'app-eu.wrike.com' });
    await client.get('/version');

    expect(capturedUrl).toBe('https://app-eu.wrike.com/api/v4/version');
    expect(client.getBaseUrl()).toBe('https://app-eu.wrike.com/api/v4');

    restoreFetch(originalFetch);
  });

  it('should default host to www.wrike.com', () => {
    const client = new WrikeClient({ apiToken: 'token' });
    expect(client.getHost()).toBe('www.wrike.com');
    expect(client.getBaseUrl()).toBe('https://www.wrike.com/api/v4');
  });

  it('should JSON-stringify array fields in query params', () => {
    const client = new WrikeClient({ apiToken: 'token' });
    const query = client.buildQuery({ fields: ['title', 'status'] });
    expect(query).toBe('?fields=%5B%22title%22%2C%22status%22%5D');
  });

  it('should throw WrikeApiError on failed responses', async () => {
    const originalFetch = globalThis.fetch;

    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response(JSON.stringify({ errorDescription: 'Invalid token' }), {
          status: 401,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    ) as any;

    const client = new WrikeClient({ apiToken: 'bad-token' });

    try {
      await client.get('/tasks');
      expect(true).toBe(false);
    } catch (err) {
      expect(err).toBeInstanceOf(WrikeApiError);
      expect((err as WrikeApiError).message).toBe('Invalid token');
      expect((err as WrikeApiError).statusCode).toBe(401);
      expect((err as WrikeApiError).isAuthError()).toBe(true);
    }

    restoreFetch(originalFetch);
  });

  it('should handle 204 No Content', async () => {
    const originalFetch = globalThis.fetch;

    globalThis.fetch = mock(() =>
      Promise.resolve(new Response(null, { status: 204 })),
    ) as any;

    const client = new WrikeClient({ apiToken: 'token' });
    const result = await client.delete('/tasks/123');
    expect(result).toEqual({});

    restoreFetch(originalFetch);
  });
});

describe('parseWrikeError', () => {
  it('should parse errorDescription', () => {
    const err = parseWrikeError({ errorDescription: 'Not found' }, 404);
    expect(err.message).toBe('Not found');
    expect(err.statusCode).toBe(404);
  });

  it('should fall back to generic message', () => {
    const err = parseWrikeError(null, 500);
    expect(err.message).toBe('Wrike API request failed (500)');
  });
});

describe('Wrike', () => {
  it('should list tasks from folder path', async () => {
    const originalFetch = globalThis.fetch;
    let capturedUrl = '';

    globalThis.fetch = mock((url: string) => {
      capturedUrl = url;
      return Promise.resolve(
        new Response(JSON.stringify({ kind: 'tasks', data: [{ id: '1', title: 'Test' }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    }) as any;

    const wrike = new Wrike({ apiToken: 'token' });
    const result = await wrike.listTasks({ folderId: 'IEAAAAAQ' });

    expect(capturedUrl).toContain('/folders/IEAAAAAQ/tasks');
    expect(result.kind).toBe('tasks');

    restoreFetch(originalFetch);
  });

  it('should require taskId or folderId for createComment', async () => {
    const wrike = new Wrike({ apiToken: 'token' });
    await expect(wrike.createComment({ text: 'hello' })).rejects.toThrow('taskId or folderId is required');
  });
});
