import { afterEach, describe, expect, test } from 'bun:test';
import { ZohoBiginClient, DEFAULT_BASE_URL } from './client';
import { ZohoBigin } from './index';
import { ZohoBiginApiError } from '../types';

const realFetch = globalThis.fetch;

interface Recorded {
  url: string;
  method: string;
  body?: string;
  headers?: Record<string, string>;
}

function installFetch(
  handler: (url: string, init: RequestInit | undefined, recorded: Recorded[]) => unknown,
): Recorded[] {
  const recorded: Recorded[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const headers = init?.headers as Record<string, string> | undefined;
    recorded.push({
      url,
      method: init?.method ?? 'GET',
      body: typeof init?.body === 'string' ? init.body : undefined,
      headers,
    });
    const json = handler(url, init, recorded);
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      json: () => Promise.resolve(json ?? {}),
    } as Response;
  }) as unknown as typeof fetch;
  return recorded;
}

function installErrorFetch(status: number, body: unknown): void {
  globalThis.fetch = (async () =>
    ({
      ok: false,
      status,
      statusText: 'Error',
      json: () => Promise.resolve(body),
    }) as Response) as unknown as typeof fetch;
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('ZohoBiginClient', () => {
  test('throws when token is missing', () => {
    expect(() => new ZohoBiginClient({ token: '' })).toThrow('Zoho Bigin token is required');
  });

  test('uses default base URL', () => {
    const client = new ZohoBiginClient({ token: 'test-token' });
    expect(client.getBaseUrl()).toBe(DEFAULT_BASE_URL);
  });

  test('sends Zoho-oauthtoken header and Contacts path', async () => {
    const recorded = installFetch(() => ({ data: [] }));
    const client = new ZohoBiginClient({ token: 'oauth-token-123' });
    await client.request('/Contacts');

    expect(recorded).toHaveLength(1);
    expect(recorded[0]!.url).toBe(`${DEFAULT_BASE_URL}/Contacts`);
    expect(recorded[0]!.headers?.Authorization).toBe('Zoho-oauthtoken oauth-token-123');
  });

  test('retries on 429 then succeeds', async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      if (calls === 1) {
        return {
          ok: false,
          status: 429,
          statusText: 'Too Many Requests',
          json: () => Promise.resolve({ message: 'rate limited' }),
        } as Response;
      }
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        json: () => Promise.resolve({ data: [{ id: '1' }] }),
      } as Response;
    }) as unknown as typeof fetch;

    const client = new ZohoBiginClient({ token: 'token' });
    const result = await client.request<{ data: { id: string }[] }>('/Contacts');
    expect(result.data[0]?.id).toBe('1');
    expect(calls).toBe(2);
  });

  test('throws ZohoBiginApiError on client error', async () => {
    installErrorFetch(401, { message: 'INVALID_TOKEN', code: 'AUTH' });
    const client = new ZohoBiginClient({ token: 'bad' });
    await expect(client.request('/Contacts')).rejects.toBeInstanceOf(ZohoBiginApiError);
  });

  test('normalizes lowercase methods before sending a body', async () => {
    const recorded = installFetch(() => ({ data: [{ id: '1' }] }));
    const client = new ZohoBiginClient({ token: 'token' });
    await client.request('/Contacts', {
      method: 'post',
      body: { data: [{ Last_Name: 'Doe' }] },
    });

    expect(recorded[0]!.method).toBe('POST');
    expect(JSON.parse(recorded[0]!.body!)).toEqual({ data: [{ Last_Name: 'Doe' }] });
  });
});

describe('ZohoBigin API methods', () => {
  test('listContacts hits /Contacts', async () => {
    const recorded = installFetch(() => ({ data: [] }));
    const bigin = new ZohoBigin({ token: 't' });
    await bigin.listContacts({ page: 1, per_page: 10 });

    expect(recorded[0]!.url).toContain('/Contacts');
    expect(recorded[0]!.url).toContain('page=1');
    expect(recorded[0]!.url).toContain('per_page=10');
  });

  test('listCompanies hits /Accounts', async () => {
    const recorded = installFetch(() => ({ data: [] }));
    const bigin = new ZohoBigin({ token: 't' });
    await bigin.listCompanies();

    expect(recorded[0]!.url).toContain('/Accounts');
  });

  test('listPipelines hits /Pipelines', async () => {
    const recorded = installFetch(() => ({ data: [] }));
    const bigin = new ZohoBigin({ token: 't' });
    await bigin.listPipelines();

    expect(recorded[0]!.url).toContain('/Pipelines');
  });

  test('listTasks hits /Tasks', async () => {
    const recorded = installFetch(() => ({ data: [] }));
    const bigin = new ZohoBigin({ token: 't' });
    await bigin.listTasks();

    expect(recorded[0]!.url).toContain('/Tasks');
  });

  test('addContacts POSTs to /Contacts with data wrapper', async () => {
    const recorded = installFetch(() => ({ data: [{ id: '1' }] }));
    const bigin = new ZohoBigin({ token: 't' });
    await bigin.addContacts([{ Last_Name: 'Doe' }]);

    expect(recorded[0]!.url).toContain('/Contacts');
    expect(recorded[0]!.method).toBe('POST');
    expect(JSON.parse(recorded[0]!.body!)).toEqual({ data: [{ Last_Name: 'Doe' }] });
  });

  test('fromEnv requires ZOHOBGIN_TOKEN', () => {
    const prev = process.env.ZOHOBGIN_TOKEN;
    delete process.env.ZOHOBGIN_TOKEN;
    expect(() => ZohoBigin.fromEnv()).toThrow('ZOHOBGIN_TOKEN is required');
    if (prev) process.env.ZOHOBGIN_TOKEN = prev;
  });
});
