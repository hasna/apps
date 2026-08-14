import { afterEach, describe, expect, test } from 'bun:test';
import { ZohoFormsClient } from './client';
import { ZohoForms } from './index';
import { ZohoFormsApiError } from '../types';

const realFetch = globalThis.fetch;

interface Recorded {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

function installFetch(
  handler: (url: string, init: RequestInit | undefined, recorded: Recorded[]) => {
    ok: boolean;
    status: number;
    statusText?: string;
    body?: unknown;
  },
) {
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
    const result = handler(url, init, recorded);
    return {
      ok: result.ok,
      status: result.status,
      statusText: result.statusText ?? 'OK',
      async text() {
        return JSON.stringify(result.body ?? {});
      },
    } as Response;
  }) as typeof fetch;
  return recorded;
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('ZohoFormsClient', () => {
  test('throws when token is missing', () => {
    expect(() => new ZohoFormsClient({ token: '' })).toThrow('Zoho Forms token is required');
  });

  test('uses Zoho-oauthtoken authorization header', async () => {
    const recorded = installFetch(() => ({ ok: true, status: 200, body: { forms: [] } }));
    const client = new ZohoFormsClient({ token: 'test-token', dataCenter: 'com' });
    await client.request('/forms');
    expect(recorded[0].headers.Authorization).toBe('Zoho-oauthtoken test-token');
  });

  test('resolves EU data center origin', async () => {
    const recorded = installFetch(() => ({ ok: true, status: 200, body: { forms: [] } }));
    const client = new ZohoFormsClient({ token: 'tok', dataCenter: 'eu' });
    expect(client.getBaseUrl()).toBe('https://forms.zoho.eu/api/v2');
    await client.request('/forms');
    expect(recorded[0].url).toBe('https://forms.zoho.eu/api/v2/forms');
  });

  test('normalizes explicit API base URL without appending api path twice', async () => {
    const recorded = installFetch(() => ({ ok: true, status: 200, body: { forms: [] } }));
    const client = new ZohoFormsClient({
      token: 'tok',
      baseUrl: 'https://example.test/api/v2',
    });
    expect(client.getBaseUrl()).toBe('https://example.test/api/v2');
    await client.request('/forms');
    expect(recorded[0].url).toBe('https://example.test/api/v2/forms');
  });

  test('listEntries uses report path when reportLinkName is set', async () => {
    const recorded = installFetch(() => ({ ok: true, status: 200, body: { entries: [] } }));
    const forms = new ZohoForms({ token: 'tok', dataCenter: 'com' });
    await forms.listEntries('my-form', { reportLinkName: 'my-report' });
    expect(recorded[0].url).toBe('https://forms.zoho.com/api/v2/forms/my-form/reports/my-report/entries');
  });

  test('createEntry sends { data: ... } body', async () => {
    const recorded = installFetch(() => ({ ok: true, status: 200, body: { code: '200' } }));
    const forms = new ZohoForms({ token: 'tok' });
    await forms.createEntry('contact-form', { Email: 'a@example.com', Name: 'Ada' });
    expect(recorded[0].method).toBe('POST');
    expect(JSON.parse(recorded[0].body!)).toEqual({
      data: { Email: 'a@example.com', Name: 'Ada' },
    });
  });

  test('deleteEntries rejects an empty ID list before making a request', async () => {
    const recorded = installFetch(() => ({ ok: true, status: 200, body: {} }));
    const forms = new ZohoForms({ token: 'tok' });
    await expect(forms.deleteEntries('contact-form', [])).rejects.toThrow(
      'At least one entry ID is required for bulk delete',
    );
    expect(recorded).toHaveLength(0);
  });

  test('throws ZohoFormsApiError on 429', async () => {
    installFetch(() => ({
      ok: false,
      status: 429,
      statusText: 'Too Many Requests',
      body: { message: 'Rate limit exceeded' },
    }));
    const client = new ZohoFormsClient({ token: 'tok' });
    await expect(client.request('/forms')).rejects.toThrow(ZohoFormsApiError);
    try {
      await client.request('/forms');
    } catch (err) {
      expect((err as ZohoFormsApiError).statusCode).toBe(429);
      expect((err as ZohoFormsApiError).isRateLimited()).toBe(true);
    }
  });

  test('fromEnv requires ZOHOFORMS_TOKEN', () => {
    const prev = process.env.ZOHOFORMS_TOKEN;
    delete process.env.ZOHOFORMS_TOKEN;
    expect(() => ZohoForms.fromEnv()).toThrow('ZOHOFORMS_TOKEN is required');
    if (prev) process.env.ZOHOFORMS_TOKEN = prev;
  });
});
