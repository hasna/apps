import { describe, expect, it, mock } from 'bun:test';
import { StainlessClient } from './api/client';
import { Stainless } from './api';
import { StainlessApiError, TARGETS } from './types';

describe('StainlessClient', () => {
  it('requires an API key', () => {
    expect(() => new StainlessClient({ apiKey: '' })).toThrow('API key is required');
  });

  it('sends the x-stainless-api-key header and builds the /v0 URL', async () => {
    let capturedUrl = '';
    let capturedHeaders: Record<string, string> = {};
    const fetchMock = mock(async (url: string, init: RequestInit) => {
      capturedUrl = url;
      capturedHeaders = init.headers as Record<string, string>;
      return new Response(JSON.stringify({ object: 'user', id: 'u_1' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    const original = globalThis.fetch;
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    try {
      const client = new StainlessClient({ apiKey: 'sk-test-123' });
      const res = await client.get<{ id: string }>('/user');
      expect(res.id).toBe('u_1');
    } finally {
      globalThis.fetch = original;
    }

    expect(capturedUrl).toBe('https://api.stainless.com/v0/user');
    expect(capturedHeaders['x-stainless-api-key']).toBe('sk-test-123');
    expect(capturedHeaders['Authorization']).toBeUndefined();
  });

  it('honors the staging environment and query params', async () => {
    let capturedUrl = '';
    const fetchMock = mock(async (url: string) => {
      capturedUrl = url;
      return new Response(JSON.stringify({ data: [], has_more: false }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    const original = globalThis.fetch;
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    try {
      const client = new StainlessClient({ apiKey: 'sk-test', environment: 'staging' });
      await client.get('/builds', { project: 'demo', limit: 5 });
    } finally {
      globalThis.fetch = original;
    }
    expect(capturedUrl).toBe('https://staging.stainless.com/v0/builds?project=demo&limit=5');
  });

  it('throws StainlessApiError on non-2xx responses', async () => {
    const fetchMock = mock(async () =>
      new Response(JSON.stringify({ error: { message: 'nope', type: 'invalid_request' } }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const original = globalThis.fetch;
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    try {
      const client = new StainlessClient({ apiKey: 'sk-test' });
      await expect(client.get('/user')).rejects.toBeInstanceOf(StainlessApiError);
    } finally {
      globalThis.fetch = original;
    }
  });

  it('redacts the API key preview', () => {
    const client = new StainlessClient({ apiKey: 'sk-abcdef123456' });
    const preview = client.getApiKeyPreview();
    expect(preview).toContain('...');
    expect(preview).not.toBe('sk-abcdef123456');
  });
});

describe('Stainless', () => {
  it('requires a project for build creation when none configured', async () => {
    const client = new Stainless({ apiKey: 'sk-test' });
    await expect(client.builds.create({ revision: 'main' })).rejects.toThrow(/project is required/);
  });

  it('exposes all resource modules', () => {
    const client = new Stainless({ apiKey: 'sk-test' });
    expect(client.builds).toBeDefined();
    expect(client.projects).toBeDefined();
    expect(client.projects.branches).toBeDefined();
    expect(client.orgs).toBeDefined();
    expect(client.user).toBeDefined();
  });

  it('lists the expected SDK targets', () => {
    expect(TARGETS).toContain('typescript');
    expect(TARGETS).toContain('python');
    expect(TARGETS).toContain('openapi');
  });
});
