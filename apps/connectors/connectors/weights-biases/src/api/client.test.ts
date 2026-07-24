import { describe, expect, test, mock, afterEach } from 'bun:test';
import { WeightsBiasesClient } from './client';

describe('WeightsBiasesClient', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    mock.restore();
  });

  test('sends Bearer auth header and builds /runs URL', async () => {
    let capturedUrl = '';
    let capturedHeaders: HeadersInit | undefined;

    globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input);
      capturedHeaders = init?.headers;
      return new Response(JSON.stringify({ runs: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    const client = new WeightsBiasesClient({ apiKey: 'test-key-12345' });
    await client.get('/runs', { entity: 'team', project: 'demo' });

    expect(capturedUrl).toBe('https://api.wandb.ai/v1/runs?entity=team&project=demo');
    expect(capturedHeaders).toMatchObject({
      Authorization: 'Bearer test-key-12345',
      Accept: 'application/json',
    });
  });

  test('uses custom base URL when configured', () => {
    const client = new WeightsBiasesClient({
      apiKey: 'key',
      baseUrl: 'https://custom.example/v1',
    });
    expect(client.getBaseUrl()).toBe('https://custom.example/v1');
  });

  test('throws when API key is missing', () => {
    expect(() => new WeightsBiasesClient({ apiKey: '' })).toThrow('API key is required');
  });
});
