import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test';
import { createHmac } from 'node:crypto';
import { WebhooksClient } from './webhooks';
import {
  validatePublicHttpUrl,
  validatePublicHttpUrlForRequest,
  type DnsLookupAddress,
  type DnsLookupFn,
} from '../utils/url';

type FetchFn = typeof fetch;
const publicDnsLookup: DnsLookupFn = async () => [{ address: '93.184.216.34', family: 4 }];

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
    let capturedInit: RequestInit | undefined;
    const fetchMock = mock((url: string | URL, init?: RequestInit) => {
      capturedInit = init;
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
      publicDnsLookup,
    );

    await client.sendJson({ payload: { event: 'created' } });

    expect(String(urlFromMock(fetchMock))).toBe('https://example.com/hook');
    expect(capturedInit?.redirect).toBe('manual');
    const headers = capturedHeaders as Record<string, string>;
    const body = JSON.stringify({ event: 'created' });
    const timestamp = headers['X-Webhook-Timestamp'];
    const expectedSignature = createHmac('sha256', 'test-secret')
      .update(`${timestamp}.${body}`)
      .digest('hex');
    expect(headers['X-Webhook-Signature']).toMatch(/^sha256=[a-f0-9]{64}$/);
    expect(headers['X-Webhook-Signature']).toBe(`sha256=${expectedSignature}`);
    expect(headers['X-Webhook-Timestamp']).toMatch(/^\d+$/);
    expect(headers['Content-Type']).toBe('application/json');
  });

  test('rejects localhost webhook URLs', async () => {
    const client = new WebhooksClient({ signingSecret: 'secret' }, global.fetch, publicDnsLookup);

    await expect(
      client.sendJson({ url: 'http://localhost/hook', payload: { ok: true } }),
    ).rejects.toThrow(/blocked host/i);
  });

  test('rejects hostnames resolving to private addresses before fetch', async () => {
    const fetchMock = mock(() => Promise.resolve(new Response('should not send'))) as unknown as FetchFn;
    const client = new WebhooksClient({}, fetchMock, async () => [
      { address: '10.1.2.3', family: 4 },
    ]);

    await expect(
      client.sendJson({ url: 'https://hooks.example.com/hook', payload: { ok: true } }),
    ).rejects.toThrow(/hostname resolves/i);
    expect((fetchMock as unknown as ReturnType<typeof mock>)).not.toHaveBeenCalled();
  });

  test('does not automatically follow redirects to local or metadata URLs', async () => {
    let redirectRequests = 0;
    const redirectServer = Bun.serve({
      port: 0,
      fetch() {
        redirectRequests += 1;
        return Response.redirect('http://169.254.169.254/latest/meta-data/', 302);
      },
    });
    let capturedInit: RequestInit | undefined;
    const fetchMock = mock(async (_url: string | URL, init?: RequestInit) => {
      capturedInit = init;
      return Bun.fetch(`http://127.0.0.1:${redirectServer.port}/redirect`, init);
    }) as unknown as FetchFn;
    const client = new WebhooksClient({}, fetchMock, publicDnsLookup);

    try {
      const result = await client.sendJson({
        url: 'https://hooks.example.com/hook',
        payload: { event: 'created' },
      });

      expect(result.ok).toBe(false);
      expect(result.status).toBe(302);
      expect(capturedInit?.redirect).toBe('manual');
      expect(redirectRequests).toBe(1);
      expect((fetchMock as unknown as ReturnType<typeof mock>).mock.calls).toHaveLength(1);
    } finally {
      redirectServer.stop(true);
    }
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
      publicDnsLookup,
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

  const blockedDirectUrls = [
    ['localhost', 'http://localhost/hook'],
    ['localhost subdomain', 'http://app.localhost/hook'],
    ['local domain', 'http://printer.local/hook'],
    ['zero IPv4', 'http://0.0.0.0/hook'],
    ['loopback IPv4', 'http://127.0.0.1/hook'],
    ['RFC1918 10/8 IPv4', 'http://10.0.0.1/hook'],
    ['RFC1918 172.16/12 IPv4', 'http://172.16.0.1/hook'],
    ['RFC1918 192.168/16 IPv4', 'http://192.168.1.10/hook'],
    ['link-local metadata IPv4', 'http://169.254.169.254/latest/meta-data/'],
    ['carrier-grade NAT IPv4', 'http://100.64.0.1/hook'],
    ['loopback IPv6', 'http://[::1]/hook'],
    ['unique-local IPv6', 'http://[fc00::1]/hook'],
    ['link-local IPv6', 'http://[fe80::1]/hook'],
    ['IPv6 metadata address', 'http://[fd00:ec2::254]/hook'],
    ['IPv4-mapped loopback IPv6', 'http://[::ffff:127.0.0.1]/hook'],
    ['IPv4-mapped metadata IPv6', 'http://[::ffff:169.254.169.254]/hook'],
  ] as const;

  for (const [name, url] of blockedDirectUrls) {
    test(`rejects ${name}`, () => {
      expect(() => validatePublicHttpUrl(url)).toThrow(/private|blocked|local|metadata/i);
    });
  }

  test('rejects public-looking hostnames that resolve to non-public addresses', async () => {
    const blockedAnswers: DnsLookupAddress[][] = [
      [{ address: '127.0.0.1', family: 4 }],
      [{ address: '10.0.0.1', family: 4 }],
      [{ address: '172.16.0.1', family: 4 }],
      [{ address: '192.168.1.10', family: 4 }],
      [{ address: '169.254.169.254', family: 4 }],
      [{ address: '100.64.0.1', family: 4 }],
      [{ address: '::1', family: 6 }],
      [{ address: 'fc00::1', family: 6 }],
      [{ address: 'fe80::1', family: 6 }],
      [{ address: 'fd00:ec2::254', family: 6 }],
    ];

    for (const answers of blockedAnswers) {
      await expect(
        validatePublicHttpUrlForRequest(
          'https://hooks.example.com/webhook',
          'Webhook URL',
          async () => answers,
        ),
      ).rejects.toThrow(/hostname resolves/i);
    }
  });

  test('rejects mixed DNS answers when any address is non-public', async () => {
    await expect(
      validatePublicHttpUrlForRequest(
        'https://hooks.example.com/webhook',
        'Webhook URL',
        async () => [
          { address: '93.184.216.34', family: 4 },
          { address: '192.168.1.10', family: 4 },
        ],
      ),
    ).rejects.toThrow(/hostname resolves/i);
  });
});

function urlFromMock(fetchFn: FetchFn): string | URL {
  const calls = (fetchFn as unknown as ReturnType<typeof mock>).mock.calls;
  return calls[0]?.[0] as string | URL;
}
