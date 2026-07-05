import { afterEach, describe, expect, test } from 'bun:test';
import { UpstashApiPlatformClient } from './client';

describe('UpstashApiPlatformClient', () => {
  const config = {
    email: 'user@example.com',
    apiKey: 'management-key-1234567890',
  };

  const realFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  test('requires email and api key', () => {
    expect(() => new UpstashApiPlatformClient({ email: '', apiKey: '' })).toThrow(
      'Email and API key are required',
    );
  });

  test('sends Basic auth and v2 path for team listing', async () => {
    const recorded: Array<{ url: string; headers: Record<string, string> }> = [];
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      recorded.push({
        url,
        headers: Object.fromEntries(new Headers(init?.headers).entries()),
      });
      return {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: async () => JSON.stringify([{ team_id: 't1', team_name: 'Team One' }]),
      } as Response;
    }) as typeof fetch;

    const client = new UpstashApiPlatformClient(config);
    const teams = await client.get('/teams');

    expect(teams).toEqual([{ team_id: 't1', team_name: 'Team One' }]);
    expect(recorded[0]?.url).toBe('https://api.upstash.com/v2/teams');
    const expectedAuth = `Basic ${Buffer.from(`${config.email}:${config.apiKey}`).toString('base64')}`;
    expect(recorded[0]?.headers.authorization ?? recorded[0]?.headers.Authorization).toBe(expectedAuth);
  });

  test('uses audit log base URL without /v2 prefix', async () => {
    const recorded: string[] = [];
    globalThis.fetch = (async (input: string | URL | Request) => {
      recorded.push(typeof input === 'string' ? input : input.toString());
      return {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: async () => JSON.stringify([]),
      } as Response;
    }) as typeof fetch;

    const client = new UpstashApiPlatformClient(config);
    await client.get('/auditlogs', undefined, { baseUrl: 'https://api.upstash.com' });

    expect(recorded[0]).toBe('https://api.upstash.com/auditlogs');
  });

  test('throws UpstashApiError on non-OK responses', async () => {
    globalThis.fetch = (async () =>
      ({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        headers: new Headers({ 'content-type': 'application/json' }),
        text: async () => JSON.stringify({ error: 'invalid credentials' }),
      }) as Response) as unknown as typeof fetch;

    const client = new UpstashApiPlatformClient(config);
    await expect(client.get('/teams')).rejects.toMatchObject({ statusCode: 401 });
  });
});
