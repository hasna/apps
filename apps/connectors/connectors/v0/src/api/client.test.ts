import { afterEach, describe, expect, test } from 'bun:test';
import { V0Client, DEFAULT_BASE_URL } from './client';

const realFetch = globalThis.fetch;

interface RecordedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

function headerValue(headers: Record<string, string>, name: string): string | undefined {
  const key = Object.keys(headers).find(k => k.toLowerCase() === name.toLowerCase());
  return key ? headers[key] : undefined;
}

function installFetch(handler: (recorded: RecordedRequest) => unknown) {
  const recorded: RecordedRequest[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((value, key) => {
      headers[key] = value;
    });
    const entry: RecordedRequest = {
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
      statusText: 'OK',
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

describe('V0Client', () => {
  test('uses default base URL', () => {
    const client = new V0Client({ apiKey: 'test-key' });
    expect(client.getBaseUrl()).toBe(DEFAULT_BASE_URL);
  });

  test('allows custom base URL override', () => {
    const client = new V0Client({ apiKey: 'test-key', baseUrl: 'https://custom.example/v1/' });
    expect(client.getBaseUrl()).toBe('https://custom.example/v1');
  });

  test('requires API key', () => {
    expect(() => new V0Client({ apiKey: '' })).toThrow('API key is required');
  });

  test('GET /user sends Bearer auth header', async () => {
    const recorded = installFetch((req) => {
      expect(req.url).toBe('https://api.v0.dev/v1/user');
      expect(req.method).toBe('GET');
      expect(headerValue(req.headers, 'Authorization')).toBe('Bearer v0_test_key');
      return { id: 'user_1', email: 'dev@example.com' };
    });
    const client = new V0Client({ apiKey: 'v0_test_key' });
    const user = await client.get<{ id: string }>('/user');
    expect(user.id).toBe('user_1');
    expect(recorded).toHaveLength(1);
  });

  test('POST /projects sends JSON body', async () => {
    const recorded = installFetch((req) => {
      expect(req.url).toBe('https://api.v0.dev/v1/projects');
      expect(req.method).toBe('POST');
      expect(headerValue(req.headers, 'Authorization')).toBe('Bearer v0_test_key');
      expect(headerValue(req.headers, 'Content-Type')).toBe('application/json');
      expect(JSON.parse(req.body!)).toEqual({ name: 'My App', description: 'Demo' });
      return { id: 'proj_1', name: 'My App' };
    });
    const client = new V0Client({ apiKey: 'v0_test_key' });
    const project = await client.post<{ id: string }>('/projects', { name: 'My App', description: 'Demo' });
    expect(project.id).toBe('proj_1');
    expect(recorded).toHaveLength(1);
  });

  test('POST /chat/completions sends messages payload', async () => {
    installFetch((req) => {
      expect(req.url).toBe('https://api.v0.dev/v1/chat/completions');
      expect(req.method).toBe('POST');
      const body = JSON.parse(req.body!);
      expect(body.messages).toEqual([{ role: 'user', content: 'Hello' }]);
      expect(body.stream).toBeUndefined();
      return { choices: [{ message: { role: 'assistant', content: 'Hi' } }] };
    });
    const client = new V0Client({ apiKey: 'v0_test_key' });
    const result = await client.post('/chat/completions', {
      messages: [{ role: 'user', content: 'Hello' }],
    });
    expect((result as { choices: unknown[] }).choices).toHaveLength(1);
  });

  test('throws V0ApiError on non-OK responses', async () => {
    globalThis.fetch = (async () => ({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      headers: new Headers({ 'content-type': 'application/json' }),
      async text() {
        return JSON.stringify({ error: { message: 'Invalid API key' } });
      },
    })) as unknown as typeof fetch;
    const client = new V0Client({ apiKey: 'bad' });
    await expect(client.get('/user')).rejects.toThrow('Invalid API key');
  });
});
