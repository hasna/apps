import { afterEach, describe, expect, test } from 'bun:test';
import { ConnectorClient } from './client';
import { Userlist } from './index';

const realFetch = globalThis.fetch;

interface RecordedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

function installFetch(
  handler: (req: RecordedRequest) => { status: number; body?: string; contentType?: string }
): RecordedRequest[] {
  const recorded: RecordedRequest[] = [];

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const headers: Record<string, string> = {};
    const rawHeaders = init?.headers;
    if (rawHeaders instanceof Headers) {
      rawHeaders.forEach((value, key) => {
        headers[key.toLowerCase()] = value;
      });
    } else if (Array.isArray(rawHeaders)) {
      for (const [key, value] of rawHeaders) {
        headers[key.toLowerCase()] = value;
      }
    } else if (rawHeaders) {
      Object.entries(rawHeaders).forEach(([key, value]) => {
        headers[key.toLowerCase()] = String(value);
      });
    }

    const entry: RecordedRequest = {
      url,
      method: init?.method ?? 'GET',
      headers,
      body: typeof init?.body === 'string' ? init.body : undefined,
    };
    recorded.push(entry);

    const result = handler(entry);
    return {
      ok: result.status >= 200 && result.status < 300,
      status: result.status,
      statusText: String(result.status),
      headers: {
        get(name: string) {
          if (name.toLowerCase() === 'content-type') {
            return result.contentType ?? null;
          }
          return null;
        },
      },
      async text() {
        return result.body ?? '';
      },
    } as Response;
  }) as typeof fetch;

  return recorded;
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('Userlist Push API client', () => {
  test('requires Push API key', () => {
    expect(() => new ConnectorClient({})).toThrow('Push API key is required');
  });

  test('POST /users sends Push auth header and JSON body', async () => {
    const recorded = installFetch(() => ({ status: 202 }));

    const client = new ConnectorClient({ apiKey: 'tok' });
    await client.post('/users', {
      identifier: 'user-123',
      email: 'user@example.com',
    });

    expect(recorded).toHaveLength(1);
    expect(recorded[0].url).toBe('https://push.userlist.com/users');
    expect(recorded[0].method).toBe('POST');
    expect(recorded[0].headers.authorization).toBe('Push tok');
    expect(recorded[0].headers['content-type']).toContain('application/json');
    expect(JSON.parse(recorded[0].body!)).toEqual({
      identifier: 'user-123',
      email: 'user@example.com',
    });
  });

  test('DELETE /users sends JSON body per Push API docs', async () => {
    const recorded = installFetch(() => ({ status: 202 }));

    const client = new ConnectorClient({ apiKey: 'tok' });
    await client.delete('/users', { identifier: 'user-123' });

    expect(recorded[0].method).toBe('DELETE');
    expect(recorded[0].url).toBe('https://push.userlist.com/users');
    expect(JSON.parse(recorded[0].body!)).toEqual({ identifier: 'user-123' });
  });

  test('DELETE /relationships sends user and company in body', async () => {
    const recorded = installFetch(() => ({ status: 202 }));

    const client = new ConnectorClient({ apiKey: 'tok' });
    await client.delete('/relationships', { user: 'user-123', company: 'company-567' });

    expect(JSON.parse(recorded[0].body!)).toEqual({
      user: 'user-123',
      company: 'company-567',
    });
  });

  test('202 Accepted returns empty success object', async () => {
    installFetch(() => ({ status: 202 }));

    const client = new ConnectorClient({ apiKey: 'tok' });
    const result = await client.post('/events', { name: 'signed_up', user: 'user-1' });
    expect(result).toEqual({});
  });

  test('422 responses throw ConnectorApiError with message', async () => {
    installFetch(() => ({
      status: 422,
      contentType: 'application/json',
      body: JSON.stringify({
        status: 422,
        code: 'unprocessable_content',
        errors: ['User must exist'],
      }),
    }));

    const client = new ConnectorClient({ apiKey: 'tok' });
    await expect(client.post('/events', { name: 'test' })).rejects.toThrow('User must exist');
  });

  test('Userlist.fromEnv requires USERLIST_PUSH_API_KEY', () => {
    const previous = process.env.USERLIST_PUSH_API_KEY;
    delete process.env.USERLIST_PUSH_API_KEY;
    expect(() => Userlist.fromEnv()).toThrow('USERLIST_PUSH_API_KEY');
    if (previous) process.env.USERLIST_PUSH_API_KEY = previous;
  });

  test('Userlist module routes identify and track through client', async () => {
    const recorded = installFetch(() => ({ status: 202 }));

    const userlist = new Userlist({ apiKey: 'key-abc' });
    await userlist.users.identify({ identifier: 'u1', email: 'a@b.com' });
    await userlist.events.track({ name: 'project_created', user: 'u1' });

    expect(recorded).toHaveLength(2);
    expect(recorded[0].url).toContain('/users');
    expect(recorded[1].url).toContain('/events');
    expect(JSON.parse(recorded[1].body!).name).toBe('project_created');
  });
});
