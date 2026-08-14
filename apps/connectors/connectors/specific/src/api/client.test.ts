import { describe, test, expect, afterEach } from 'bun:test';
import { SpecificClient } from './client';
import { SpecificApiError } from '../types';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('SpecificClient', () => {
  test('requires an API key', () => {
    expect(() => new SpecificClient({ apiKey: '' })).toThrow('API key is required');
  });

  test('POSTs GraphQL with the raw API key (no Bearer prefix)', async () => {
    let captured: { url: string; init: RequestInit } | undefined;
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      captured = { url, init };
      return new Response(JSON.stringify({ data: { myWorkspace: { id: 'ws_1' } } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    const client = new SpecificClient({ apiKey: 'secret-key' });
    const data = await client.request<{ myWorkspace: { id: string } }>(
      'query { myWorkspace { id } }',
      { foo: 'bar' },
    );

    expect(data.myWorkspace.id).toBe('ws_1');
    expect(captured?.url).toBe('https://public-api.specific.app/graphql');
    expect(captured?.init.method).toBe('POST');
    const headers = captured?.init.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('secret-key');
    expect(headers['Authorization']).not.toContain('Bearer');
    const body = JSON.parse(captured?.init.body as string);
    expect(body.query).toContain('myWorkspace');
    expect(body.variables).toEqual({ foo: 'bar' });
  });

  test('respects a custom base URL', async () => {
    let capturedUrl = '';
    globalThis.fetch = (async (url: string) => {
      capturedUrl = url;
      return new Response(JSON.stringify({ data: { ok: true } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    const client = new SpecificClient({ apiKey: 'k', baseUrl: 'https://example.test/graphql' });
    await client.request('query { ok }');
    expect(capturedUrl).toBe('https://example.test/graphql');
  });

  test('throws SpecificApiError on GraphQL errors', async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ errors: [{ message: 'Unauthorized' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })) as unknown as typeof fetch;

    const client = new SpecificClient({ apiKey: 'k' });
    await expect(client.request('query { ok }')).rejects.toBeInstanceOf(SpecificApiError);
  });

  test('throws SpecificApiError on HTTP failure', async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ errors: [{ message: 'Forbidden' }] }), {
        status: 403,
        headers: { 'content-type': 'application/json' },
      })) as unknown as typeof fetch;

    const client = new SpecificClient({ apiKey: 'k' });
    await expect(client.request('query { ok }')).rejects.toMatchObject({ statusCode: 403 });
  });

  test('masks the API key in previews', () => {
    const client = new SpecificClient({ apiKey: 'abcdef1234567890' });
    const preview = client.getApiKeyPreview();
    expect(preview).toContain('...');
    expect(preview).not.toBe('abcdef1234567890');
  });
});
