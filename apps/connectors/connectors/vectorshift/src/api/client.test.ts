import { describe, test, expect, mock, afterEach } from 'bun:test';
import { VectorShiftClient } from './client';

describe('VectorShiftClient', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    mock.restore();
  });

  test('sends Bearer auth and hits pipelines list endpoint', async () => {
    let capturedUrl = '';
    let capturedHeaders: Record<string, string> = {};

    globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input);
      capturedHeaders = Object.fromEntries(new Headers(init?.headers).entries());
      return new Response(JSON.stringify({ status: 'success', object_ids: ['pipe-1'] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    const client = new VectorShiftClient({ apiKey: 'test-api-key' });
    const result = await client.get<{ status: string; object_ids: string[] }>('/pipelines', {
      include_shared: true,
      verbose: false,
    });

    expect(result.object_ids).toEqual(['pipe-1']);
    expect(capturedUrl).toBe('https://api.vectorshift.ai/v1/pipelines?include_shared=true&verbose=false');
    expect(capturedHeaders.authorization).toBe('Bearer test-api-key');
  });

  test('posts pipeline run payload to encoded path', async () => {
    let capturedUrl = '';
    let capturedBody = '';

    globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input);
      capturedBody = String(init?.body ?? '');
      return new Response(JSON.stringify({
        status: 'success',
        run_id: 'run-1',
        outputs: { answer: 'hello' },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    const client = new VectorShiftClient({ apiKey: 'test-api-key' });
    await client.post('/pipeline/pipe%2F1/run', { inputs: { question: 'hi' } });

    expect(capturedUrl).toBe('https://api.vectorshift.ai/v1/pipeline/pipe%2F1/run');
    expect(JSON.parse(capturedBody)).toEqual({ inputs: { question: 'hi' } });
  });
});
