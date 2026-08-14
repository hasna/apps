import { afterEach, describe, expect, test } from 'bun:test';
import { VercelAiGateway, VercelAiGatewayClient, ANTHROPIC_BASE_URL, OPENAI_BASE_URL, OPENRESPONSES_BASE_URL } from './index';

const realFetch = globalThis.fetch;

interface Recorded {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: unknown;
}

function installFetch(handler: (url: string, init: RequestInit | undefined, recorded: Recorded[]) => unknown) {
  const recorded: Recorded[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const headers: Record<string, string> = {};
    if (init?.headers) {
      const h = init.headers instanceof Headers ? init.headers : new Headers(init.headers);
      h.forEach((v, k) => { headers[k] = v; });
    }
    recorded.push({ url, method: init?.method ?? 'GET', headers, body: init?.body });
    const json = handler(url, init, recorded);
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: new Headers({ 'content-type': 'application/json' }),
      async text() {
        return JSON.stringify(json ?? {});
      },
    } as Response;
  }) as typeof fetch;
  return recorded;
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('VercelAiGatewayClient', () => {
  test('requires API key', () => {
    expect(() => new VercelAiGatewayClient({ apiKey: '' })).toThrow('API key is required');
  });

  test('listModels uses OpenAI base URL with Bearer auth', async () => {
    const recorded = installFetch(() => ({ object: 'list', data: [{ id: 'openai/gpt-4o' }] }));
    const client = new VercelAiGateway({ apiKey: 'test-key' });
    const result = await client.listModels();
    expect(result.data[0].id).toBe('openai/gpt-4o');
    expect(recorded[0].url).toBe(`${OPENAI_BASE_URL}/models`);
    expect(recorded[0].method).toBe('GET');
    expect(recorded[0].headers.authorization).toBe('Bearer test-key');
  });

  test('chat posts to /chat/completions with body', async () => {
    const recorded = installFetch(() => ({
      id: 'chat-1',
      object: 'chat.completion',
      created: 1,
      model: 'openai/gpt-4o-mini',
      choices: [{ index: 0, message: { role: 'assistant', content: 'hi' }, finish_reason: 'stop' }],
    }));
    const client = new VercelAiGateway({ apiKey: 'test-key' });
    await client.chat({
      model: 'openai/gpt-4o-mini',
      messages: [{ role: 'user', content: 'hello' }],
    });
    expect(recorded[0].url).toBe(`${OPENAI_BASE_URL}/chat/completions`);
    expect(recorded[0].method).toBe('POST');
    const body = JSON.parse(recorded[0].body as string);
    expect(body.model).toBe('openai/gpt-4o-mini');
    expect(body.messages[0].content).toBe('hello');
  });

  test('createAnthropicMessage uses Anthropic base URL and required headers', async () => {
    const recorded = installFetch(() => ({ id: 'msg-1', type: 'message', role: 'assistant', content: [] }));
    const client = new VercelAiGateway({ apiKey: 'anthropic-key' });
    await client.createAnthropicMessage({
      model: 'anthropic/claude-sonnet-4',
      messages: [{ role: 'user', content: 'ping' }],
      max_tokens: 256,
    });
    expect(recorded[0].url).toBe(`${ANTHROPIC_BASE_URL}/v1/messages`);
    expect(recorded[0].headers['x-api-key']).toBe('anthropic-key');
    expect(recorded[0].headers['anthropic-version']).toBe('2023-06-01');
    expect(recorded[0].headers.authorization).toBe('Bearer anthropic-key');
  });

  test('rawRequest switches base URL by compatibility', async () => {
    const recorded = installFetch(() => ({ ok: true }));
    const client = new VercelAiGateway({ apiKey: 'test-key' });

    await client.rawRequest({ path: '/responses', compatibility: 'openresponses', method: 'POST', body: { model: 'x' } });
    expect(recorded[0].url).toBe(`${OPENRESPONSES_BASE_URL}/responses`);

    await client.rawRequest({ path: '/models', compatibility: 'anthropic' });
    expect(recorded[1].url).toBe(`${ANTHROPIC_BASE_URL}/models`);

    await client.rawRequest({ path: '/models', compatibility: 'openai' });
    expect(recorded[2].url).toBe(`${OPENAI_BASE_URL}/models`);
  });

  test('throws VercelAiGatewayApiError on non-2xx', async () => {
    globalThis.fetch = (async () => ({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      headers: new Headers({ 'content-type': 'application/json' }),
      async text() {
        return JSON.stringify({ error: { message: 'Invalid API key' } });
      },
    })) as unknown as typeof fetch;
    const client = new VercelAiGateway({ apiKey: 'bad-key' });
    await expect(client.listModels()).rejects.toThrow('Invalid API key');
  });
});
