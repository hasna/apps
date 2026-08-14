import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { VertexAiClient } from './client';
import { VertexAiApiError } from '../types';

describe('VertexAiClient', () => {
  const originalFetch = globalThis.fetch;
  let captured: Array<{ url: string; init?: RequestInit }> = [];

  beforeEach(() => {
    captured = [];
    globalThis.fetch = mock(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      captured.push({ url, init });
      return Response.json({ ok: true });
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('listModels uses regional host and Bearer authorization', async () => {
    const client = new VertexAiClient({
      accessToken: 'test-token',
      projectId: 'my-project',
      location: 'europe-west4',
    });

    await client.listModels({ projectId: 'my-project', location: 'europe-west4' });

    expect(captured).toHaveLength(1);
    expect(captured[0].url).toBe(
      'https://europe-west4-aiplatform.googleapis.com/v1/projects/my-project/locations/europe-west4/publishers/google/models',
    );
    const headers = new Headers(captured[0].init?.headers);
    expect(headers.get('Authorization')).toBe('Bearer test-token');
  });

  test('generateContent posts generation body with system instruction', async () => {
    const client = new VertexAiClient({
      accessToken: 'test-token',
      location: 'us-central1',
    });

    await client.generateContent({
      projectId: 'demo-project',
      model: 'gemini-2.5-pro',
      contents: [{ role: 'user', parts: [{ text: 'Hello' }] }],
      systemInstruction: 'Be brief',
      maxOutputTokens: 64,
    });

    expect(captured[0].url).toContain(':generateContent');
    const body = JSON.parse(captured[0].init?.body as string);
    expect(body).toMatchObject({
      generationConfig: { maxOutputTokens: 64 },
      systemInstruction: { parts: [{ text: 'Be brief' }] },
      contents: [{ role: 'user', parts: [{ text: 'Hello' }] }],
    });
  });

  test('embedContent posts embedding payload', async () => {
    const client = new VertexAiClient({ accessToken: 'test-token' });
    await client.embedContent({
      projectId: 'demo-project',
      model: 'text-embedding-005',
      content: { parts: [{ text: 'hello' }] },
      outputDimensionality: 256,
    });

    const body = JSON.parse(captured[0].init?.body as string);
    expect(body).toMatchObject({ outputDimensionality: 256 });
    expect(captured[0].url).toContain(':embedContent');
  });

  test('predictImage targets imagegeneration model predict endpoint', async () => {
    const client = new VertexAiClient({ accessToken: 'test-token', location: 'europe-west4' });
    await client.predictImage({
      projectId: 'demo-project',
      location: 'europe-west4',
      prompt: 'a cube',
      sampleCount: 2,
    });

    expect(captured[0].url).toBe(
      'https://europe-west4-aiplatform.googleapis.com/v1/projects/demo-project/locations/europe-west4/publishers/google/models/imagegeneration%40006:predict',
    );
    const body = JSON.parse(captured[0].init?.body as string);
    expect(body.instances).toEqual([{ prompt: 'a cube' }]);
    expect(body.parameters.sampleCount).toBe(2);
  });

  test('throws VertexAiApiError on non-2xx responses', async () => {
    globalThis.fetch = mock(async () =>
      new Response(JSON.stringify({ error: { message: 'upstream failed' } }), { status: 502 }),
    ) as unknown as typeof fetch;

    const client = new VertexAiClient({ accessToken: 'test-token' });
    await expect(client.listModels({ projectId: 'demo-project' })).rejects.toThrow(/502/);
  });

  test('requires access token at construction', () => {
    expect(() => new VertexAiClient({ accessToken: '' })).toThrow(VertexAiApiError);
  });
});
