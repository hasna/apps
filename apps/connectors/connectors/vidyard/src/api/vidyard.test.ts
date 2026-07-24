import { describe, test, expect, mock } from 'bun:test';
import { VidyardClient, DEFAULT_BASE_URL } from './client';
import { Vidyard } from './index';
import { VidyardApiError } from '../types';

describe('VidyardClient', () => {
  test('requires api token', () => {
    expect(() => new VidyardClient({ apiKey: '' })).toThrow('Vidyard API token is required');
  });

  test('builds URL with auth_token query param', () => {
    const client = new VidyardClient({ apiKey: 'test-token' });
    const url = client.buildUrl('/videos');
    expect(url).toBe(`${DEFAULT_BASE_URL}/videos?auth_token=test-token`);
  });

  test('builds URL with extra params', () => {
    const client = new VidyardClient({ apiKey: 'test-token' });
    const url = client.buildUrl('/events/search', { query: 'demo', page: 1 });
    expect(url).toContain('auth_token=test-token');
    expect(url).toContain('query=demo');
    expect(url).toContain('page=1');
  });

  test('can omit auth_token from URL when using body auth', () => {
    const client = new VidyardClient({ apiKey: 'test-token' });
    const url = client.buildUrl('/videos', undefined, { includeAuth: false });
    expect(url).toBe(`${DEFAULT_BASE_URL}/videos`);
  });

  test('getApiKeyPreview masks token', () => {
    const client = new VidyardClient({ apiKey: 'abcdef1234567890' });
    expect(client.getApiKeyPreview()).toBe('abcdef...7890');
  });

  test('request sends auth_token on GET', async () => {
    const client = new VidyardClient({ apiKey: 'secret-token' });
    let requestedUrl = '';

    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock((input: RequestInfo | URL) => {
      requestedUrl = String(input);
      return Promise.resolve(new Response(JSON.stringify([{ id: 1, name: 'Demo' }]), { status: 200 }));
    }) as any;

    const result = await client.get<unknown[]>('/videos');
    expect(requestedUrl).toContain('auth_token=secret-token');
    expect(result).toEqual([{ id: 1, name: 'Demo' }]);

    globalThis.fetch = originalFetch;
  });

  test('request maps HTTP errors to VidyardApiError', async () => {
    const client = new VidyardClient({ apiKey: 'secret-token' });

    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response(JSON.stringify({ message: 'Unauthorized' }), { status: 401 })),
    ) as any;

    await expect(client.get('/videos')).rejects.toThrow(VidyardApiError);

    globalThis.fetch = originalFetch;
  });

  test('POST with body includes auth_token in JSON body', async () => {
    const client = new VidyardClient({ apiKey: 'secret-token' });
    let body = '';

    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock((_input: RequestInfo | URL, init?: RequestInit) => {
      body = String(init?.body ?? '');
      return Promise.resolve(new Response(JSON.stringify({ id: 99 }), { status: 201 }));
    }) as any;

    await client.post('/videos', { video: { name: 'New video' } });
    const parsed = JSON.parse(body) as { auth_token?: string; video?: { name: string } };
    expect(parsed.auth_token).toBe('secret-token');
    expect(parsed.video?.name).toBe('New video');

    globalThis.fetch = originalFetch;
  });
});

describe('Vidyard', () => {
  test('fromEnv throws without VIDYARD_API_KEY', () => {
    const original = process.env.VIDYARD_API_KEY;
    delete process.env.VIDYARD_API_KEY;

    expect(() => Vidyard.fromEnv()).toThrow('VIDYARD_API_KEY environment variable is required');

    if (original) process.env.VIDYARD_API_KEY = original;
  });

  test('fromEnv creates connector with env var', () => {
    const original = process.env.VIDYARD_API_KEY;
    process.env.VIDYARD_API_KEY = 'env-token-12345';

    const connector = Vidyard.fromEnv();
    expect(connector.getApiKeyPreview()).toBe('env-to...2345');

    if (original) process.env.VIDYARD_API_KEY = original;
    else delete process.env.VIDYARD_API_KEY;
  });
});

describe('VidyardApiError', () => {
  test('detects auth and rate limit errors', () => {
    const authError = new VidyardApiError('unauthorized', 401);
    const rateError = new VidyardApiError('too many', 429);

    expect(authError.isAuthError()).toBe(true);
    expect(rateError.isRateLimited()).toBe(true);
  });
});
