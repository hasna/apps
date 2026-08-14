import { describe, expect, test } from 'bun:test';
import { buildAuthHeader, DEFAULT_BASE_URL, VoiceflowClient } from './client';

describe('buildAuthHeader', () => {
  test('passes VF.DM. key without Bearer prefix', () => {
    const key = 'VF.DM.test-key-12345';
    expect(buildAuthHeader(key)).toBe(key);
  });

  test('strips Bearer prefix when provided', () => {
    const key = 'VF.DM.test-key-12345';
    expect(buildAuthHeader(`Bearer ${key}`)).toBe(key);
  });

  test('trims whitespace', () => {
    expect(buildAuthHeader('  VF.DM.abc  ')).toBe('VF.DM.abc');
  });
});

describe('VoiceflowClient', () => {
  test('uses default base URL', () => {
    const client = new VoiceflowClient({ apiKey: 'VF.DM.test' });
    expect(client.getBaseUrl()).toBe(DEFAULT_BASE_URL);
  });

  test('uses custom base URL from config', () => {
    const client = new VoiceflowClient({
      apiKey: 'VF.DM.test',
      baseUrl: 'https://custom.example.com/v1',
    });
    expect(client.getBaseUrl()).toBe('https://custom.example.com/v1');
  });

  test('builds request URL with query params', async () => {
    const originalFetch = globalThis.fetch;
    let capturedUrl = '';

    globalThis.fetch = (async (input: RequestInfo | URL) => {
      capturedUrl = String(input);
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;

    try {
      const client = new VoiceflowClient({ apiKey: 'VF.DM.test' });
      await client.get('/projects', { limit: 5 });
      expect(capturedUrl).toBe(`${DEFAULT_BASE_URL}/projects?limit=5`);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('sends Authorization header with raw API key', async () => {
    const originalFetch = globalThis.fetch;
    let capturedAuth = '';

    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string>;
      capturedAuth = headers.Authorization;
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;

    try {
      const client = new VoiceflowClient({ apiKey: 'VF.DM.secret-key' });
      await client.get('/projects');
      expect(capturedAuth).toBe('VF.DM.secret-key');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
