import { afterEach, describe, expect, test } from 'bun:test';
import { UniOne } from './index';

const realFetch = globalThis.fetch;

interface RecordedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

function installFetch(handler: (recorded: RecordedRequest) => unknown) {
  const recorded: RecordedRequest[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const headers: Record<string, string> = {};
    if (init?.headers) {
      const raw = init.headers instanceof Headers ? Object.fromEntries(init.headers.entries()) : init.headers as Record<string, string>;
      Object.assign(headers, raw);
    }
    const entry: RecordedRequest = {
      url,
      method: init?.method ?? 'GET',
      headers,
      body: typeof init?.body === 'string' ? init.body : undefined,
    };
    recorded.push(entry);
    const json = handler(entry);
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

describe('UniOne API transport', () => {
  test('listProjects uses POST with correct URL, X-API-KEY, and Content-Type headers', async () => {
    const recorded = installFetch((req) => {
      expect(req.url).toBe('https://api.unione.io/en/transactional/api/v1/project/list.json');
      expect(req.method).toBe('POST');
      expect(req.headers['X-API-KEY']).toBe('unione-key');
      expect(req.headers['Content-Type']).toBe('application/json');
      expect(req.headers['Accept']).toBe('application/json');
      expect(req.body).toBe('{}');
      return { status: 'success', projects: [{ id: 1, name: 'Main' }] };
    });

    const client = new UniOne({ apiKey: 'unione-key' });
    const result = await client.listProjects();

    expect(result.projects).toEqual([{ id: 1, name: 'Main' }]);
    expect(recorded).toHaveLength(1);
  });

  test('sendEmail posts JSON body to /email/send.json', async () => {
    const recorded = installFetch((req) => {
      expect(req.url).toContain('/email/send.json');
      expect(req.method).toBe('POST');
      const body = JSON.parse(req.body ?? '{}');
      expect(body.message.recipients[0].email).toBe('user@example.com');
      return { status: 'success', job_id: 'job-1' };
    });

    const client = new UniOne({ apiKey: 'unione-key' });
    const result = await client.sendEmail({
      message: {
        recipients: [{ email: 'user@example.com' }],
        body: { html: '<p>Hi</p>' },
        subject: 'Hello',
      },
    });

    expect(result.job_id).toBe('job-1');
    expect(recorded).toHaveLength(1);
  });

  test('requires API key', () => {
    expect(() => new UniOne({ apiKey: '' })).toThrow('UniOne API key is required');
  });
});
