import { afterEach, describe, expect, test } from 'bun:test';
import { YouCom } from './index';

const realFetch = globalThis.fetch;

interface RecordedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

function installFetch(
  handler: (url: string, init: RequestInit | undefined, recorded: RecordedRequest[]) => unknown,
) {
  const recorded: RecordedRequest[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const headers: Record<string, string> = {};
    if (init?.headers) {
      const raw = init.headers instanceof Headers ? Object.fromEntries(init.headers.entries()) : init.headers;
      Object.assign(headers, raw);
    }
    recorded.push({
      url,
      method: init?.method ?? 'GET',
      headers,
      body: typeof init?.body === 'string' ? init.body : undefined,
    });
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

describe('YouComClient', () => {
  test('search.get sends X-API-Key to ydc-index.io/v1/search', async () => {
    const recorded = installFetch(() => ({ results: { web: [] } }));
    const client = new YouCom({ apiKey: 'test-key-123' });
    await client.search.get({ query: 'ai news', count: 5 });

    expect(recorded).toHaveLength(1);
    expect(recorded[0].url).toContain('https://ydc-index.io/v1/search');
    expect(recorded[0].url).toContain('query=ai+news');
    expect(recorded[0].url).toContain('count=5');
    expect(recorded[0].method).toBe('GET');
    expect(recorded[0].headers['X-API-Key']).toBe('test-key-123');
  });

  test('search.post sends JSON body with domain filters', async () => {
    const recorded = installFetch(() => ({ results: { web: [] } }));
    const client = new YouCom({ apiKey: 'test-key-123' });
    await client.search.post({
      query: 'cloud providers',
      include_domains: ['aws.amazon.com', 'cloud.google.com'],
    });

    expect(recorded).toHaveLength(1);
    expect(recorded[0].url).toBe('https://ydc-index.io/v1/search');
    expect(recorded[0].method).toBe('POST');
    expect(recorded[0].headers['X-API-Key']).toBe('test-key-123');
    expect(recorded[0].headers['Content-Type']).toBe('application/json');
    const body = JSON.parse(recorded[0].body!);
    expect(body.query).toBe('cloud providers');
    expect(body.include_domains).toEqual(['aws.amazon.com', 'cloud.google.com']);
  });

  test('research.create posts to api.you.com/v1/research', async () => {
    const recorded = installFetch(() => ({ output: { content: 'answer' } }));
    const client = new YouCom({ apiKey: 'test-key-123' });
    await client.research.create({
      input: 'What are microservices tradeoffs?',
      research_effort: 'standard',
    });

    expect(recorded).toHaveLength(1);
    expect(recorded[0].url).toBe('https://api.you.com/v1/research');
    expect(recorded[0].method).toBe('POST');
    expect(recorded[0].headers['X-API-Key']).toBe('test-key-123');
    const body = JSON.parse(recorded[0].body!);
    expect(body.input).toBe('What are microservices tradeoffs?');
    expect(body.research_effort).toBe('standard');
  });

  test('requires API key', () => {
    expect(() => new YouCom({ apiKey: '' })).toThrow('API key is required');
  });
});
