import { describe, test, expect, mock, afterEach } from 'bun:test';
import { Talkdesk } from './index';

/**
 * Exercise the resource modules against a mocked HTTP layer, asserting each
 * hits the documented Talkdesk endpoint with the right method.
 */
describe('Talkdesk resources', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  function stubFetch(impl: () => Promise<Response>): ReturnType<typeof mock> {
    const m = mock(impl);
    global.fetch = m as unknown as typeof fetch;
    return m;
  }

  function mockJson(payload: unknown, status = 200): ReturnType<typeof mock> {
    return stubFetch(() =>
      Promise.resolve({
        ok: status >= 200 && status < 300,
        status,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: () => Promise.resolve(JSON.stringify(payload)),
      } as Response)
    );
  }

  function firstCall(m: ReturnType<typeof mock>): [string, RequestInit] {
    return m.mock.calls[0] as [string, RequestInit];
  }

  function client() {
    return new Talkdesk({ accessToken: 'tok' });
  }

  test('fromEnv throws without credentials', () => {
    const prev = { ...process.env };
    delete process.env.TALKDESK_CLIENT_ID;
    delete process.env.TALKDESK_CLIENT_SECRET;
    delete process.env.TALKDESK_ACCESS_TOKEN;
    try {
      expect(() => Talkdesk.fromEnv()).toThrow(/TALKDESK_CLIENT_ID/);
    } finally {
      process.env = prev;
    }
  });

  test('users.list hits GET /users', async () => {
    const m = mockJson({ _embedded: { users: [{ id: 'u1' }] } });
    const res = await client().users.list({ page: 1, perPage: 50 });
    const [url, options] = firstCall(m);
    expect(url).toContain('https://api.talkdeskapp.com/users');
    expect(url).toContain('page=1');
    expect(url).toContain('per_page=50');
    expect(options.method).toBe('GET');
    expect(res._embedded?.users[0]?.id).toBe('u1');
  });

  test('users.get hits GET /users/{id}', async () => {
    const m = mockJson({ id: 'u42' });
    await client().users.get('u42');
    expect(firstCall(m)[0]).toBe('https://api.talkdeskapp.com/users/u42');
  });

  test('users.me hits GET /users/me', async () => {
    const m = mockJson({ id: 'me' });
    await client().users.me();
    expect(firstCall(m)[0]).toBe('https://api.talkdeskapp.com/users/me');
  });

  test('contacts.create hits POST /contacts', async () => {
    const m = mockJson({ id: 'c1', name: 'Ada' }, 201);
    await client().contacts.create({ name: 'Ada', emails: [{ email: 'ada@example.com' }] });
    const [url, options] = firstCall(m);
    expect(url).toBe('https://api.talkdeskapp.com/contacts');
    expect(options.method).toBe('POST');
    expect(JSON.parse(options.body as string).name).toBe('Ada');
  });

  test('contacts.get encodes the id in the path', async () => {
    const m = mockJson({ id: 'a b' });
    await client().contacts.get('a b');
    expect(firstCall(m)[0]).toBe('https://api.talkdeskapp.com/contacts/a%20b');
  });

  test('contacts.delete hits DELETE /contacts/{id}', async () => {
    const m = stubFetch(() =>
      Promise.resolve({ ok: true, status: 204, headers: new Headers({}), text: () => Promise.resolve('') } as Response)
    );
    await client().contacts.delete('c9');
    const [url, options] = firstCall(m);
    expect(url).toBe('https://api.talkdeskapp.com/contacts/c9');
    expect(options.method).toBe('DELETE');
  });

  test('reports.createCallsJob hits POST /data/reports/calls/jobs', async () => {
    const m = mockJson({ job_id: 'j1', status: 'processing' }, 201);
    const job = await client().reports.createCallsJob({ format: 'json' });
    const [url, options] = firstCall(m);
    expect(url).toBe('https://api.talkdeskapp.com/data/reports/calls/jobs');
    expect(options.method).toBe('POST');
    expect(job.job_id).toBe('j1');
  });

  test('reports.getCallsJob hits GET /data/reports/calls/jobs/{id}', async () => {
    const m = mockJson({ job_id: 'j1', status: 'done' });
    await client().reports.getCallsJob('j1');
    expect(firstCall(m)[0]).toBe('https://api.talkdeskapp.com/data/reports/calls/jobs/j1');
  });
});
