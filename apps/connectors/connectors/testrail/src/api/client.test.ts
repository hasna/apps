import { describe, it, expect } from 'bun:test';
import { TestRailClient } from './client';
import { TestRailApiError } from '../types';

describe('TestRailClient', () => {
  const config = {
    email: 'user@example.com',
    apiKey: 'test-api-key',
    baseUrl: 'https://mycompany.testrail.io',
  };

  it('should require email, apiKey, and baseUrl', () => {
    expect(() => new TestRailClient({ ...config, email: '' })).toThrow('Email is required');
    expect(() => new TestRailClient({ ...config, apiKey: '' })).toThrow('API key is required');
    expect(() => new TestRailClient({ ...config, baseUrl: '' })).toThrow('Base URL is required');
  });

  it('should build index.php?/api/v2 URLs with segments and query params', () => {
    const client = new TestRailClient(config);
    const url = client.buildMethodUrl('get_cases', [1], { suite_id: 2, limit: 10 });
    expect(url).toBe('https://mycompany.testrail.io/index.php?/api/v2/get_cases/1&suite_id=2&limit=10');
  });

  it('should build get_case URL', () => {
    const client = new TestRailClient(config);
    const url = client.buildMethodUrl('get_case', [42]);
    expect(url).toBe('https://mycompany.testrail.io/index.php?/api/v2/get_case/42');
  });

  it('should strip trailing slash from base URL', () => {
    const client = new TestRailClient({
      ...config,
      baseUrl: 'https://mycompany.testrail.io/',
    });
    const url = client.buildMethodUrl('get_projects');
    expect(url).toBe('https://mycompany.testrail.io/index.php?/api/v2/get_projects');
  });

  it('should include Basic Authorization header in requests', async () => {
    const originalFetch = globalThis.fetch;
    let capturedUrl = '';
    let capturedHeaders: Record<string, string> = {};

    globalThis.fetch = ((_url: string, options: RequestInit) => {
      capturedUrl = _url;
      capturedHeaders = options.headers as Record<string, string>;
      return Promise.resolve(
        new Response(JSON.stringify({ id: 42, title: 'Sample' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      );
    }) as typeof fetch;

    const client = new TestRailClient(config);
    await client.get('get_case', [42]);

    const expectedAuth = `Basic ${Buffer.from('user@example.com:test-api-key').toString('base64')}`;
    expect(capturedHeaders.Authorization).toBe(expectedAuth);
    expect(capturedHeaders.Accept).toBe('application/json');
    expect(capturedUrl).toBe('https://mycompany.testrail.io/index.php?/api/v2/get_case/42');

    globalThis.fetch = originalFetch;
  });

  it('should throw TestRailApiError on non-ok response', async () => {
    const originalFetch = globalThis.fetch;

    globalThis.fetch = (() =>
      Promise.resolve(
        new Response(JSON.stringify({ error: 'Authentication failed' }), {
          status: 401,
          headers: { 'content-type': 'application/json' },
        })
      )) as unknown as typeof fetch;

    const client = new TestRailClient(config);

    try {
      await client.get('get_projects');
      expect(true).toBe(false);
    } catch (err) {
      expect(err).toBeInstanceOf(TestRailApiError);
      expect((err as TestRailApiError).statusCode).toBe(401);
      expect((err as TestRailApiError).message).toContain('Authentication failed');
    }

    globalThis.fetch = originalFetch;
  });

  it('should send JSON body for POST requests', async () => {
    const originalFetch = globalThis.fetch;
    let capturedBody = '';
    let capturedMethod = '';

    globalThis.fetch = ((_url: string, options: RequestInit) => {
      capturedBody = options.body as string;
      capturedMethod = options.method || '';
      return Promise.resolve(
        new Response(JSON.stringify({ id: 1 }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      );
    }) as typeof fetch;

    const client = new TestRailClient(config);
    await client.post('add_case', [1], { title: 'New case', section_id: 5 });

    expect(capturedMethod).toBe('POST');
    expect(JSON.parse(capturedBody)).toEqual({ title: 'New case', section_id: 5 });

    globalThis.fetch = originalFetch;
  });

  it('should return email preview', () => {
    const client = new TestRailClient(config);
    expect(client.getEmailPreview()).toBe('use...@example.com');
  });
});
