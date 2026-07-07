import { afterEach, describe, expect, test } from 'bun:test';
import { SparkPostClient } from './client';
import { SparkPost } from './index';
import { SparkPostApiError } from '../types';

const realFetch = globalThis.fetch;

interface Recorded {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

function installFetch(handler: (url: string, init: RequestInit | undefined, recorded: Recorded[]) => unknown) {
  const recorded: Recorded[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const headers: Record<string, string> = {};
    if (init?.headers) {
      const h = init.headers as Record<string, string>;
      Object.assign(headers, h);
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
      headers: { get: () => 'application/json' },
      async text() {
        return JSON.stringify(json ?? {});
      },
    } as unknown as Response;
  }) as typeof fetch;
  return recorded;
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('SparkPostClient', () => {
  test('requires API key', () => {
    expect(() => new SparkPostClient({ apiKey: '' })).toThrow('API key is required');
  });

  test('uses raw API key in Authorization header (not Bearer)', async () => {
    const recorded = installFetch(() => ({ results: [] }));
    const client = new SparkPostClient({ apiKey: 'test-api-key-12345' });
    await client.get('/templates');
    expect(recorded[0].headers.Authorization).toBe('test-api-key-12345');
    expect(recorded[0].headers.Authorization).not.toContain('Bearer');
  });

  test('uses US base URL by default', async () => {
    const recorded = installFetch(() => ({ results: [] }));
    const client = new SparkPostClient({ apiKey: 'key' });
    await client.get('/transmissions');
    expect(recorded[0].url).toStartWith('https://api.sparkpost.com/api/v1/transmissions');
  });

  test('uses EU base URL when region is eu', async () => {
    const recorded = installFetch(() => ({ results: [] }));
    const client = new SparkPostClient({ apiKey: 'key', region: 'eu' });
    await client.get('/transmissions');
    expect(recorded[0].url).toStartWith('https://api.eu.sparkpost.com/api/v1/transmissions');
  });

  test('POST /transmissions sends email payload', async () => {
    const recorded = installFetch((url) => {
      if (url.includes('/transmissions')) {
        return { results: { id: 'tx-1', total_accepted_recipients: 1, total_rejected_recipients: 0 } };
      }
      return {};
    });
    const sp = new SparkPost({ apiKey: 'key' });
    const result = await sp.sendSimpleEmail({
      to: 'user@example.com',
      from: 'sender@example.com',
      subject: 'Hello',
      html: '<p>Hi</p>',
    });
    expect(result.results.id).toBe('tx-1');
    const call = recorded.find(r => r.url.includes('/transmissions'))!;
    expect(call.method).toBe('POST');
    const body = JSON.parse(call.body!);
    expect(body.recipients[0].address).toBe('user@example.com');
    expect(body.content.from).toBe('sender@example.com');
    expect(body.content.subject).toBe('Hello');
  });

  test('GET /templates lists templates', async () => {
    const recorded = installFetch(() => ({ results: [{ id: 'tpl-1', name: 'Welcome' }] }));
    const sp = new SparkPost({ apiKey: 'key' });
    const result = await sp.listTemplates();
    expect(result.results[0].id).toBe('tpl-1');
    expect(recorded[0].url).toContain('/templates');
    expect(recorded[0].method).toBe('GET');
  });

  test('GET /sending-domains lists domains', async () => {
    const recorded = installFetch(() => ({ results: [{ domain: 'example.com' }] }));
    const sp = new SparkPost({ apiKey: 'key' });
    const result = await sp.listSendingDomains();
    expect(result.results[0].domain).toBe('example.com');
    expect(recorded[0].url).toContain('/sending-domains');
  });

  test('parses SparkPost errors array', async () => {
    globalThis.fetch = (async () => ({
      ok: false,
      status: 400,
      statusText: 'Bad Request',
      headers: { get: () => 'application/json' },
      async text() {
        return JSON.stringify({ errors: [{ message: 'Invalid API key', code: '1902' }] });
      },
    } as unknown as Response)) as unknown as typeof fetch;

    const client = new SparkPostClient({ apiKey: 'bad-key' });
    await expect(client.get('/account')).rejects.toThrow(SparkPostApiError);
    try {
      await client.get('/account');
    } catch (err) {
      expect(err).toBeInstanceOf(SparkPostApiError);
      expect((err as SparkPostApiError).message).toBe('Invalid API key');
      expect((err as SparkPostApiError).status).toBe(400);
    }
  });

  test('rejects invalid region', () => {
    expect(() => new SparkPostClient({ apiKey: 'key', region: 'ap' as 'us' })).toThrow('Region must be "us" or "eu"');
  });

  test('GET /recipient-validation/single/{address} validates email', async () => {
    const recorded = installFetch(() => ({ results: { result: 'valid', valid: true } }));
    const sp = new SparkPost({ apiKey: 'key' });
    const result = await sp.validateRecipient('user@example.com');
    expect(result.results.result).toBe('valid');
    expect(recorded[0].method).toBe('GET');
    expect(recorded[0].url).toContain('/recipient-validation/single/user%40example.com');
  });

  test('PUT /suppression-list wraps recipients array', async () => {
    const recorded = installFetch(() => ({}));
    const sp = new SparkPost({ apiKey: 'key' });
    await sp.addSuppression([{ recipient: 'user@example.com', type: 'transactional' }]);
    expect(recorded[0].method).toBe('PUT');
    expect(recorded[0].url).toContain('/suppression-list');
    const body = JSON.parse(recorded[0].body!);
    expect(body.recipients[0].recipient).toBe('user@example.com');
  });

  test('listSuppressions forwards per_page query param', async () => {
    const recorded = installFetch(() => ({ results: [] }));
    const sp = new SparkPost({ apiKey: 'key' });
    await sp.listSuppressions({ per_page: 50 });
    expect(recorded[0].url).toContain('per_page=50');
  });
});
