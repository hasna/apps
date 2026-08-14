import { afterEach, describe, expect, mock, test } from 'bun:test';
import { VectorShift } from './index';

describe('VectorShift API', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    mock.restore();
  });

  test('maps chatbot SSE chunks to stream events and completion', async () => {
    globalThis.fetch = mock(async () => new Response(streamFromChunks([
      'data: {"delta":"hel","conversation_id":"conv-1"}\n\n',
      'data: {"delta":"lo","follow_up_questions":["next?"]}\n\n',
      'data: [DONE]\n\n',
    ]), {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    })) as unknown as typeof fetch;

    const client = new VectorShift({ apiKey: 'test-api-key' });
    const events = [];
    for await (const event of client.runChatbotStream('bot-1', { text: 'hi' })) {
      events.push(event);
    }

    expect(events).toHaveLength(3);
    expect(events[0]).toMatchObject({
      type: 'message',
      delta: 'hel',
      conversation_id: 'conv-1',
    });
    expect(events[1]).toMatchObject({
      type: 'message',
      delta: 'lo',
      follow_up_questions: ['next?'],
    });
    expect(events[2]).toEqual({ type: 'done' });
  });

  test('collects chatbot stream when runChatbot receives stream true', async () => {
    globalThis.fetch = mock(async () => new Response(streamFromChunks([
      'data: {"delta":"hel","conversation_id":"conv-1"}\n\n',
      'data: {"delta":"lo"}\n\n',
      'data: [DONE]\n\n',
    ]), {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    })) as unknown as typeof fetch;

    const client = new VectorShift({ apiKey: 'test-api-key' });
    await expect(client.runChatbot('bot-1', { text: 'hi', stream: true })).resolves.toEqual({
      status: 'success',
      conversation_id: 'conv-1',
      output_message: 'hello',
      follow_up_questions: undefined,
    });
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
