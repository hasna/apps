import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test';
import { WebhooksClient } from './webhooks';
import { validatePublicHttpUrl } from '../utils/url';

type FetchFn = typeof fetch;

describe('WebhooksClient', () => {
  let originalFetch: FetchFn;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  test('sendJson adds signing headers when signing secret is configured', async () => {
    let capturedHeaders: HeadersInit | undefined;
    const fetchMock = mock((url: string | URL, init?: RequestInit) => {
      capturedHeaders = init?.headers;
      return Promise.resolve({
        ok: true,
        status: 200,
        text: () => Promise.resolve('ok'),
      } as Response);
    }) as unknown as FetchFn;
    global.fetch = fetchMock;

    const client = new WebhooksClient(
      {
        defaultUrl: 'https://example.com/hook',
        signingSecret: 'test-secret',
      },
      fetchMock,
    );

    await client.sendJson({ payload: { event: 'created' } });

    expect(String(urlFromMock(fetchMock))).toBe('https://example.com/hook');
    const headers = capturedHeaders as Record<string, string>;
    expect(headers['X-Webhook-Signature']).toMatch(/^sha256=[a-f0-9]{64}$/);
    expect(headers['X-Webhook-Timestamp']).toMatch(/^\d+$/);
    expect(headers['Content-Type']).toBe('application/json');
  });

  test('rejects localhost webhook URLs', async () => {
    const client = new WebhooksClient({ signingSecret: 'secret' }, global.fetch);

    await expect(
      client.sendJson({ url: 'http://localhost/hook', payload: { ok: true } }),
    ).rejects.toThrow(/blocked host/i);
  });

  test('ping sends the expected payload shape', async () => {
    let capturedBody = '';
    const fetchMock = mock((_url: string | URL, init?: RequestInit) => {
      capturedBody = String(init?.body);
      return Promise.resolve({
        ok: true,
        status: 200,
        text: () => Promise.resolve(''),
      } as Response);
    }) as unknown as FetchFn;

    const client = new WebhooksClient(
      { defaultUrl: 'https://example.com/hook' },
      fetchMock,
    );

    const result = await client.ping();
    const body = JSON.parse(capturedBody) as { ping: string; timestamp: string };

    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
    expect(result.url).toBe('https://example.com/hook');
    expect(body.ping).toBe('webhook');
    expect(body.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  test('listIncoming returns guidance without making network calls', async () => {
    const fetchMock = mock(() => Promise.reject(new Error('network should not be called'))) as unknown as FetchFn;
    const client = new WebhooksClient({}, fetchMock);

    const result = await client.listIncoming({ limit: 10, sinceMs: 1_700_000_000_000 });

    expect((fetchMock as unknown as ReturnType<typeof mock>)).not.toHaveBeenCalled();
    expect(result.limit).toBe(10);
    expect(result.sinceMs).toBe(1_700_000_000_000);
    expect(result.events).toEqual([]);
    expect(result.message).toContain('not available');
    expect(result.hint).toContain('X-Webhook-Signature');
  });
});

describe('validatePublicHttpUrl', () => {
  test('accepts public https URLs', () => {
    expect(validatePublicHttpUrl('https://example.com/webhook')).toBe('https://example.com/webhook');
  });

  test('rejects private IPv4 addresses', () => {
    expect(() => validatePublicHttpUrl('http://192.168.1.10/hook')).toThrow(/private/i);
  });
});

function urlFromMock(fetchFn: FetchFn): string | URL {
  const calls = (fetchFn as unknown as ReturnType<typeof mock>).mock.calls;
  return calls[0]?.[0] as string | URL;
}
