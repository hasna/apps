import { describe, it, expect, mock } from 'bun:test';
import { EdgeConfigPlatformClient } from './client';
import { EdgeConfigPlatform } from './index';
import { EdgeConfigPlatformApiError } from '../types';

function restoreFetch(original: typeof globalThis.fetch) {
  globalThis.fetch = original;
}

describe('EdgeConfigPlatformClient', () => {
  it('should require an API key', () => {
    expect(() => new EdgeConfigPlatformClient({ apiKey: '' })).toThrow('API key is required');
  });

  it('should include Bearer Authorization header', async () => {
    const originalFetch = globalThis.fetch;
    let capturedHeaders: Record<string, string> = {};

    globalThis.fetch = mock((_url: unknown, options: RequestInit) => {
      capturedHeaders = options.headers as Record<string, string>;
      return Promise.resolve(
        new Response(JSON.stringify([]), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      );
    }) as any;

    const client = new EdgeConfigPlatformClient({ apiKey: 'test-token' });
    await client.get('/v1/edge-config');

    expect(capturedHeaders['Authorization']).toBe('Bearer test-token');
    expect(capturedHeaders['Accept']).toBe('application/json');

    restoreFetch(originalFetch);
  });

  it('should append teamId query parameter when configured', async () => {
    const originalFetch = globalThis.fetch;
    let capturedUrl = '';

    globalThis.fetch = mock((url: unknown) => {
      capturedUrl = String(url);
      return Promise.resolve(
        new Response(JSON.stringify([]), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      );
    }) as any;

    const client = new EdgeConfigPlatformClient({ apiKey: 'test-token', teamId: 'team_abc123' });
    await client.get('/v1/edge-config');

    expect(capturedUrl).toContain('teamId=team_abc123');
    expect(capturedUrl).toContain('https://api.vercel.com/v1/edge-config');

    restoreFetch(originalFetch);
  });

  it('should throw EdgeConfigPlatformApiError on non-ok response', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response(JSON.stringify({ error: { code: 'unauthorized', message: 'Not authorized' } }), {
          status: 401,
          headers: { 'content-type': 'application/json' },
        })
      )
    ) as any;

    const client = new EdgeConfigPlatformClient({ apiKey: 'bad-token' });

    try {
      await client.get('/v1/edge-config');
      expect(true).toBe(false);
    } catch (err) {
      expect(err).toBeInstanceOf(EdgeConfigPlatformApiError);
      expect((err as EdgeConfigPlatformApiError).statusCode).toBe(401);
      expect((err as EdgeConfigPlatformApiError).message).toBe('Not authorized');
    }

    restoreFetch(originalFetch);
  });

  it('should handle 204 No Content', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(() => Promise.resolve(new Response(null, { status: 204 }))) as any;

    const client = new EdgeConfigPlatformClient({ apiKey: 'test-token' });
    const result = await client.delete('/v1/edge-config/ecfg_test');
    expect(result).toEqual({});

    restoreFetch(originalFetch);
  });
});

describe('EdgeConfigPlatform', () => {
  it('should PATCH items at /v1/edge-config/{id}/items', async () => {
    const originalFetch = globalThis.fetch;
    let capturedUrl = '';
    let capturedMethod = '';
    let capturedBody = '';

    globalThis.fetch = mock((url: unknown, options: RequestInit) => {
      capturedUrl = String(url);
      capturedMethod = options.method || 'GET';
      capturedBody = options.body as string;
      return Promise.resolve(
        new Response(JSON.stringify({ status: 'ok' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      );
    }) as any;

    const api = new EdgeConfigPlatform({ apiKey: 'test-token', teamId: 'team_xyz' });
    const result = await api.patchItems('ecfg_abc', {
      items: [{ operation: 'upsert', key: 'feature_flag', value: true }],
    });

    expect(capturedMethod).toBe('PATCH');
    expect(capturedUrl).toContain('/v1/edge-config/ecfg_abc/items');
    expect(capturedUrl).toContain('teamId=team_xyz');
    expect(JSON.parse(capturedBody)).toEqual({
      items: [{ operation: 'upsert', key: 'feature_flag', value: true }],
    });
    expect(result).toEqual({ status: 'ok' });

    restoreFetch(originalFetch);
  });

  it('should list edge configs at /v1/edge-config', async () => {
    const originalFetch = globalThis.fetch;
    let capturedUrl = '';

    globalThis.fetch = mock((url: unknown) => {
      capturedUrl = String(url);
      return Promise.resolve(
        new Response(JSON.stringify([{ id: 'ecfg_1', slug: 'my-config' }]), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      );
    }) as any;

    const api = new EdgeConfigPlatform({ apiKey: 'test-token' });
    const result = await api.listEdgeConfigs();

    expect(capturedUrl).toContain('https://api.vercel.com/v1/edge-config');
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe('ecfg_1');
    expect(result[0]?.slug).toBe('my-config');

    restoreFetch(originalFetch);
  });
});
