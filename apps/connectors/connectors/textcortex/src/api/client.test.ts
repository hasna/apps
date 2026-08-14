import { afterEach, describe, expect, test } from 'bun:test';
import { TextCortex, HEMINGWAI_PATHS } from './index';

const realFetch = globalThis.fetch;

interface Recorded {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

function installFetch(handler: (recorded: Recorded) => unknown) {
  const recorded: Recorded[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((value, key) => {
      headers[key.toLowerCase()] = value;
    });
    const entry: Recorded = {
      url,
      method: init?.method ?? 'GET',
      headers,
      body: typeof init?.body === 'string' ? init.body : undefined,
    };
    recorded.push(entry);
    const json = handler(entry);
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

describe('TextCortexClient', () => {
  test('generateText posts to hemingwai generate endpoint with Bearer auth', async () => {
    const recorded = installFetch((entry) => {
      expect(entry.url).toBe(`https://api.textcortex.com${HEMINGWAI_PATHS.generate}`);
      expect(entry.method).toBe('POST');
      expect(entry.headers.authorization).toBe('Bearer textcortex-key');
      const body = JSON.parse(entry.body ?? '{}');
      expect(body.prompt).toBe('Write a launch note');
      expect(body.max_tokens).toBe(64);
      return { data: { outputs: [{ text: 'Launch note content' }] } };
    });

    const client = new TextCortex({ apiKey: 'textcortex-key' });
    const response = await client.hemingwai.generateText({ prompt: 'Write a launch note', max_tokens: 64 });

    expect(recorded).toHaveLength(1);
    expect(client.hemingwai.extractText(response)).toBe('Launch note content');
  });

  test('summarizeText uses summarize endpoint', async () => {
    const recorded = installFetch((entry) => {
      expect(entry.url).toBe(`https://api.textcortex.com${HEMINGWAI_PATHS.summarize}`);
      expect(entry.method).toBe('POST');
      return { data: { outputs: [{ text: 'Summary' }] } };
    });

    const client = new TextCortex({ apiKey: 'key' });
    await client.hemingwai.summarizeText({ text: 'Long article', max_tokens: 128 });
    expect(recorded).toHaveLength(1);
  });

  test('rewriteText uses rewrite endpoint', async () => {
    const recorded = installFetch((entry) => {
      expect(entry.url).toBe(`https://api.textcortex.com${HEMINGWAI_PATHS.rewrite}`);
      return { data: { outputs: [{ text: 'Rewritten' }] } };
    });

    const client = new TextCortex({ apiKey: 'key' });
    await client.hemingwai.rewriteText({ text: 'Original', mode: 'formal' });
    expect(recorded).toHaveLength(1);
  });

  test('classifyText uses classify endpoint', async () => {
    const recorded = installFetch((entry) => {
      expect(entry.url).toBe(`https://api.textcortex.com${HEMINGWAI_PATHS.classify}`);
      return { data: { outputs: [{ text: 'positive' }] } };
    });

    const client = new TextCortex({ apiKey: 'key' });
    await client.hemingwai.classifyText({ text: 'Great product', labels: ['positive', 'negative'] });
    expect(recorded).toHaveLength(1);
  });

  test('custom baseUrl is respected', async () => {
    const recorded = installFetch((entry) => {
      expect(entry.url.startsWith('https://custom.example.com/hemingwai/')).toBe(true);
      return {};
    });

    const client = new TextCortex({ apiKey: 'key', baseUrl: 'https://custom.example.com' });
    await client.hemingwai.generateText({ prompt: 'test' });
    expect(recorded).toHaveLength(1);
  });

  test('throws TextCortexApiError on HTTP error', async () => {
    globalThis.fetch = (async () => ({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      headers: new Headers({ 'content-type': 'application/json' }),
      async text() {
        return JSON.stringify({ message: 'Invalid API key' });
      },
    })) as unknown as typeof fetch;

    const client = new TextCortex({ apiKey: 'bad-key' });
    await expect(client.hemingwai.generateText({ prompt: 'test' })).rejects.toThrow('Invalid API key');
  });
});
