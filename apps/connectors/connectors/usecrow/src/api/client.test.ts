import { afterEach, describe, expect, test } from 'bun:test';
import { Connector, ConnectorClient } from './index';

const realFetch = globalThis.fetch;

interface Recorded {
  url: string;
  method: string;
  body?: string;
}

function installFetch(handler: (url: string, init: RequestInit | undefined, recorded: Recorded[]) => unknown) {
  const recorded: Recorded[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    recorded.push({
      url,
      method: init?.method ?? 'GET',
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

describe('Usecrow API client', () => {
  const config = {
    productId: 'prod-123',
    identityToken: 'jwt-token',
    baseUrl: 'https://api.usecrow.org',
    model: 'gpt-4',
    subdomain: 'demo',
  };

  test('requires product_id', () => {
    expect(() => new ConnectorClient({})).toThrow('product_id is required');
  });

  test('sendMessage POSTs to /api/chat/message with product fields merged', async () => {
    const recorded = installFetch(() => ({ ok: true }));
    const client = new Connector({ ...config });
    await client.chat.sendMessage({ message: 'hello' });

    expect(recorded).toHaveLength(1);
    expect(recorded[0].url).toBe('https://api.usecrow.org/api/chat/message');
    expect(recorded[0].method).toBe('POST');
    const body = JSON.parse(recorded[0].body!);
    expect(body.product_id).toBe('prod-123');
    expect(body.identity_token).toBe('jwt-token');
    expect(body.model).toBe('gpt-4');
    expect(body.subdomain).toBe('demo');
    expect(body.message).toBe('hello');
  });

  test('listConversations GETs with product_id and identity_token query params', async () => {
    const recorded = installFetch(() => ({ conversations: [] }));
    const client = new Connector({ ...config });
    await client.chat.listConversations();

    expect(recorded[0].method).toBe('GET');
    const url = new URL(recorded[0].url);
    expect(url.pathname).toBe('/api/chat/conversations');
    expect(url.searchParams.get('product_id')).toBe('prod-123');
    expect(url.searchParams.get('identity_token')).toBe('jwt-token');
  });

  test('getConversationHistory encodes conversation ID in path', async () => {
    const recorded = installFetch(() => ({ messages: [] }));
    const client = new Connector({ ...config });
    await client.chat.getConversationHistory({ conversationId: 'conv/1' });

    const url = new URL(recorded[0].url);
    expect(url.pathname).toBe('/api/chat/conversations/conv%2F1/history');
    expect(url.searchParams.get('product_id')).toBe('prod-123');
  });

  test('getAnonymousConversationHistory does not require identity_token', async () => {
    const recorded = installFetch(() => ({ messages: [] }));
    const client = new Connector({ productId: 'prod-123', baseUrl: 'https://api.usecrow.org' });
    await client.chat.getAnonymousConversationHistory({ conversationId: 'anon-1' });

    const url = new URL(recorded[0].url);
    expect(url.pathname).toBe('/api/chat/conversations/anon-1/history/anonymous');
    expect(url.searchParams.get('product_id')).toBe('prod-123');
    expect(url.searchParams.has('identity_token')).toBe(false);
  });

  test('listRecordedWorkflows uses product ID in path', async () => {
    const recorded = installFetch(() => ({ workflows: [] }));
    const client = new Connector({ ...config });
    await client.workflows.listRecordedWorkflows();

    const url = new URL(recorded[0].url);
    expect(url.pathname).toBe('/api/products/prod-123/recorded-workflows');
  });

  test('browserUse.start POSTs to /api/browser-use/start', async () => {
    const recorded = installFetch(() => ({ session_id: 'sess-1' }));
    const client = new Connector({ ...config });
    await client.browserUse.start({ action: 'navigate' });

    expect(recorded[0].url).toBe('https://api.usecrow.org/api/browser-use/start');
    expect(recorded[0].method).toBe('POST');
    const body = JSON.parse(recorded[0].body!);
    expect(body.product_id).toBe('prod-123');
    expect(body.action).toBe('navigate');
  });

  test('rawRequest forwards method and path', async () => {
    const recorded = installFetch(() => ({ custom: true }));
    const client = new Connector({ ...config });
    await client.rawRequest({ path: '/api/custom', method: 'POST', body: { foo: 'bar' } });

    expect(recorded[0].method).toBe('POST');
    expect(recorded[0].url).toBe('https://api.usecrow.org/api/custom');
  });

  test('listConversations throws without identity_token', async () => {
    const client = new Connector({ productId: 'prod-123' });
    expect(() => client.getClient().identityQuery()).toThrow('identity_token is required');
  });
});
