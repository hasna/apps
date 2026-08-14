import { afterEach, describe, expect, test } from 'bun:test';
import { WorkOSClient } from './client';
import { WorkOS } from './index';
import { WorkOSApiError } from '../types';

const realFetch = globalThis.fetch;

interface RecordedCall {
  url: string;
  init?: RequestInit;
}

function installFetch(handler: (url: string, init?: RequestInit) => unknown): RecordedCall[] {
  const recorded: RecordedCall[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    recorded.push({ url, init });
    const json = handler(url, init);
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      async json() {
        return json ?? {};
      },
    } as Response;
  }) as typeof fetch;
  return recorded;
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('WorkOSClient', () => {
  const mockConfig = { apiKey: 'sk_test_workos_key' };

  test('throws when apiKey is missing', () => {
    expect(() => new WorkOSClient({ apiKey: '' })).toThrow('WorkOS apiKey is required');
  });

  test('sends Bearer authorization header', async () => {
    const recorded = installFetch(() => ({ object: 'list', data: [], list_metadata: {} }));

    const client = new WorkOSClient(mockConfig);
    await client.request('/organizations');

    expect(recorded).toHaveLength(1);
    const headers = recorded[0]!.init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer sk_test_workos_key');
    expect(headers.Accept).toBe('application/json');
  });

  test('appends query parameters', async () => {
    const recorded = installFetch(() => ({ object: 'list', data: [], list_metadata: {} }));

    const client = new WorkOSClient(mockConfig);
    await client.request('/events', {
      params: { limit: 25, after: 'event_123', organization_id: 'org_abc' },
    });

    expect(recorded[0]!.url).toBe(
      'https://api.workos.com/events?limit=25&after=event_123&organization_id=org_abc',
    );
  });

  test('throws WorkOSApiError on API error response', async () => {
    globalThis.fetch = (async () =>
      ({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        async json() {
          return { message: 'Invalid API key', code: 'invalid_api_key' };
        },
      }) as Response) as unknown as typeof fetch;

    const client = new WorkOSClient(mockConfig);
    await expect(client.request('/organizations')).rejects.toThrow(WorkOSApiError);
    await expect(client.request('/organizations')).rejects.toMatchObject({
      statusCode: 401,
      code: 'invalid_api_key',
    });
  });
});

describe('WorkOS', () => {
  test('listDirectoryUsers requires directory_id query param', async () => {
    const recorded = installFetch(() => ({ object: 'list', data: [], list_metadata: {} }));

    const workos = new WorkOS({ apiKey: 'sk_test' });
    await workos.listDirectoryUsers({ directory_id: 'directory_01' });

    expect(recorded[0]!.url).toContain('directory_id=directory_01');
  });

  test('fromEnv reads WORKOS_API_KEY', () => {
    const prev = process.env.WORKOS_API_KEY;
    process.env.WORKOS_API_KEY = 'env_key';
    expect(WorkOS.fromEnv()).toBeInstanceOf(WorkOS);
    if (prev === undefined) delete process.env.WORKOS_API_KEY;
    else process.env.WORKOS_API_KEY = prev;
  });
});
