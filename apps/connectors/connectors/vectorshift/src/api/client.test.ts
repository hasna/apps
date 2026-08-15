import { describe, test, expect, mock, afterEach } from 'bun:test';
import { VectorShiftClient } from './client';
import { VectorShiftApiError } from '../types';

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

  test('parses streaming SSE chunks and requests event-stream responses', async () => {
    let capturedHeaders: Record<string, string> = {};
    let capturedBody = '';

    globalThis.fetch = mock(async (_input: RequestInfo | URL, init?: RequestInit) => {
      capturedHeaders = Object.fromEntries(new Headers(init?.headers).entries());
      capturedBody = String(init?.body ?? '');
      return new Response(streamFromChunks([
        'event: message\ndata: {"delta":"hel"',
        ',"conversation_id":"conv-1"}\n\n',
        'data: [DONE]\n\n',
      ]), {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      });
    }) as unknown as typeof fetch;

    const client = new VectorShiftClient({ apiKey: 'test-api-key' });
    const events = [];
    for await (const event of client.requestStream('/chatbot/bot-1/run', {
      body: { text: 'hi', stream: true },
    })) {
      events.push(event);
    }

    expect(capturedHeaders.authorization).toBe('Bearer test-api-key');
    expect(capturedHeaders.accept).toBe('text/event-stream');
    expect(JSON.parse(capturedBody)).toEqual({ text: 'hi', stream: true });
    expect(events).toEqual([
      {
        event: 'message',
        data: '{"delta":"hel","conversation_id":"conv-1"}',
      },
    ]);
  });

  test('raises API errors from streaming error events', async () => {
    globalThis.fetch = mock(async () => new Response(streamFromChunks([
      'event: error\ndata: stream failed\n\n',
    ]), {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    })) as unknown as typeof fetch;

    const client = new VectorShiftClient({ apiKey: 'test-api-key' });
    let thrown: unknown;
    try {
      for await (const _event of client.requestStream('/chatbot/bot-1/run', {
        body: { text: 'hi', stream: true },
      })) {
        // Exhaust the generator.
      }
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(VectorShiftApiError);
    expect((thrown as Error).message).toBe('stream failed');
  });
});

function streamFromChunks(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
}
