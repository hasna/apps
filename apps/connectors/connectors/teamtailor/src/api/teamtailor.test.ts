import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test';
import { Teamtailor } from './index';
import { TeamtailorClient } from './client';
import { ResourceApi } from './resources';
import { TeamtailorApiError, parseApiError } from '../types';

// ============================================
// Helper: mock fetch
// ============================================

function mockFetch(response: {
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
}) {
  const status = response.status ?? 200;
  const headers = new Headers({
    'content-type': 'application/vnd.api+json',
    ...(response.headers || {}),
  });

  return mock(() =>
    Promise.resolve(
      new Response(
        status === 204 ? null : JSON.stringify(response.body),
        { status, headers }
      )
    )
  );
}

function restoreFetch(original: typeof globalThis.fetch) {
  globalThis.fetch = original;
}

// ============================================
// TeamtailorClient Tests
// ============================================

describe('TeamtailorClient', () => {
  it('should require an apiKey', () => {
    expect(() => new TeamtailorClient({ apiKey: '' })).toThrow(
      'apiKey is required'
    );
  });

  it('should create client with a valid apiKey', () => {
    const client = new TeamtailorClient({ apiKey: 'testkey' });
    expect(client).toBeDefined();
  });

  it('should include Token Authorization and X-Api-Version headers', async () => {
    const originalFetch = globalThis.fetch;
    let capturedHeaders: Record<string, string> = {};

    globalThis.fetch = mock((_url: any, options: any) => {
      capturedHeaders = options.headers;
      return Promise.resolve(
        new Response(JSON.stringify({ data: [] }), {
          status: 200,
          headers: { 'content-type': 'application/vnd.api+json' },
        })
      );
    }) as any;

    const client = new TeamtailorClient({ apiKey: 'mykey', apiVersion: '20240101' });
    await client.get('/candidates');

    expect(capturedHeaders['Authorization']).toBe('Token token=mykey');
    expect(capturedHeaders['X-Api-Version']).toBe('20240101');
    expect(capturedHeaders['Accept']).toBe('application/vnd.api+json');

    restoreFetch(originalFetch);
  });

  it('should apply a default X-Api-Version when none is configured', async () => {
    const originalFetch = globalThis.fetch;
    let capturedHeaders: Record<string, string> = {};

    globalThis.fetch = mock((_url: any, options: any) => {
      capturedHeaders = options.headers;
      return Promise.resolve(
        new Response(JSON.stringify({ data: [] }), {
          status: 200,
          headers: { 'content-type': 'application/vnd.api+json' },
        })
      );
    }) as any;

    const client = new TeamtailorClient({ apiKey: 'mykey' });
    await client.get('/jobs');

    expect(capturedHeaders['X-Api-Version']).toMatch(/^\d{8}$/);

    restoreFetch(originalFetch);
  });

  it('should send JSON:API Content-Type for write requests', async () => {
    const originalFetch = globalThis.fetch;
    let capturedBody = '';
    let capturedHeaders: Record<string, string> = {};

    globalThis.fetch = mock((_url: any, options: any) => {
      capturedBody = options.body;
      capturedHeaders = options.headers;
      return Promise.resolve(
        new Response(JSON.stringify({ data: { id: '1', type: 'candidates', attributes: {} } }), {
          status: 201,
          headers: { 'content-type': 'application/vnd.api+json' },
        })
      );
    }) as any;

    const client = new TeamtailorClient({ apiKey: 'key' });
    await client.post('/candidates', { data: { type: 'candidates', attributes: { email: 'a@b.com' } } });

    expect(capturedHeaders['Content-Type']).toBe('application/vnd.api+json');
    expect(JSON.parse(capturedBody)).toEqual({
      data: { type: 'candidates', attributes: { email: 'a@b.com' } },
    });

    restoreFetch(originalFetch);
  });

  it('should handle 204 No Content', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response(null, { status: 204 }))
    ) as any;

    const client = new TeamtailorClient({ apiKey: 'key' });
    const result = await client.delete('/candidates/1');
    expect(result).toEqual({});

    restoreFetch(originalFetch);
  });

  it('should throw TeamtailorApiError on non-ok response with JSON:API errors', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetch({
      status: 401,
      body: { errors: [{ status: '401', title: 'Unauthorized', detail: 'Invalid token' }] },
    }) as any;

    const client = new TeamtailorClient({ apiKey: 'badkey' });

    try {
      await client.get('/candidates');
      expect(true).toBe(false); // should not reach
    } catch (err) {
      expect(err).toBeInstanceOf(TeamtailorApiError);
      expect((err as TeamtailorApiError).statusCode).toBe(401);
      expect((err as TeamtailorApiError).message).toContain('Invalid token');
      expect((err as TeamtailorApiError).errors).toHaveLength(1);
    }

    restoreFetch(originalFetch);
  });

  it('should return a credential preview', () => {
    const client = new TeamtailorClient({ apiKey: 'abcdef1234567890' });
    expect(client.getCredentialPreview()).toBe('Token: abcdef...');
  });
});

// ============================================
// ResourceApi Tests
// ============================================

describe('ResourceApi', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    restoreFetch(originalFetch);
  });

  it('should list resources and parse the JSON:API envelope', async () => {
    const body = {
      data: [
        { id: '1', type: 'candidates', attributes: { 'first-name': 'Ada', email: 'ada@example.com' } },
        { id: '2', type: 'candidates', attributes: { 'first-name': 'Grace', email: 'grace@example.com' } },
      ],
      meta: { 'record-count': 2, 'page-count': 1 },
    };
    globalThis.fetch = mockFetch({ body }) as any;

    const tt = new Teamtailor({ apiKey: 'key' });
    const result = await tt.candidates.list();

    expect(result.data).toHaveLength(2);
    expect(result.data[0].id).toBe('1');
    expect(result.data[0].attributes['first-name']).toBe('Ada');
    expect(result.meta?.['record-count']).toBe(2);
  });

  it('should send JSON:API pagination and filter params', async () => {
    let capturedUrl = '';
    globalThis.fetch = mock((url: any) => {
      capturedUrl = url.toString();
      return Promise.resolve(
        new Response(JSON.stringify({ data: [] }), {
          status: 200,
          headers: { 'content-type': 'application/vnd.api+json' },
        })
      );
    }) as any;

    const tt = new Teamtailor({ apiKey: 'key' });
    await tt.jobs.list({
      pageNumber: 2,
      pageSize: 15,
      include: 'department',
      sort: '-created-at',
      filter: { status: 'published' },
    });

    const decoded = decodeURIComponent(capturedUrl);
    expect(decoded).toContain('page[number]=2');
    expect(decoded).toContain('page[size]=15');
    expect(decoded).toContain('include=department');
    expect(decoded).toContain('sort=-created-at');
    expect(decoded).toContain('filter[status]=published');
  });

  it('should get a single resource by id', async () => {
    const body = {
      data: { id: '42', type: 'jobs', attributes: { title: 'Backend Engineer', status: 'published' } },
    };
    globalThis.fetch = mockFetch({ body }) as any;

    const tt = new Teamtailor({ apiKey: 'key' });
    const result = await tt.jobs.get('42');

    expect(result.data.id).toBe('42');
    expect(result.data.attributes.title).toBe('Backend Engineer');
  });

  it('should URL-encode ids in get', async () => {
    let capturedUrl = '';
    globalThis.fetch = mock((url: any) => {
      capturedUrl = url.toString();
      return Promise.resolve(
        new Response(JSON.stringify({ data: { id: 'a/b', type: 'jobs', attributes: {} } }), {
          status: 200,
          headers: { 'content-type': 'application/vnd.api+json' },
        })
      );
    }) as any;

    const tt = new Teamtailor({ apiKey: 'key' });
    await tt.jobs.get('a/b');

    expect(capturedUrl).toContain('/jobs/a%2Fb');
  });

  it('should create a resource with a JSON:API write body', async () => {
    let capturedUrl = '';
    let capturedMethod = '';
    let capturedBody = '';
    globalThis.fetch = mock((url: any, options: any) => {
      capturedUrl = url.toString();
      capturedMethod = options.method;
      capturedBody = options.body;
      return Promise.resolve(
        new Response(
          JSON.stringify({ data: { id: '7', type: 'candidates', attributes: { email: 'new@example.com' } } }),
          { status: 201, headers: { 'content-type': 'application/vnd.api+json' } }
        )
      );
    }) as any;

    const tt = new Teamtailor({ apiKey: 'key' });
    const result = await tt.candidates.create({ 'first-name': 'New', email: 'new@example.com' });

    expect(capturedUrl).toContain('/candidates');
    expect(capturedMethod).toBe('POST');
    expect(JSON.parse(capturedBody)).toEqual({
      data: {
        type: 'candidates',
        attributes: { 'first-name': 'New', email: 'new@example.com' },
      },
    });
    expect(result.data.id).toBe('7');
  });

  it('should include relationships in the write body when provided', async () => {
    let capturedBody = '';
    globalThis.fetch = mock((_url: any, options: any) => {
      capturedBody = options.body;
      return Promise.resolve(
        new Response(
          JSON.stringify({ data: { id: '9', type: 'job-applications', attributes: {} } }),
          { status: 201, headers: { 'content-type': 'application/vnd.api+json' } }
        )
      );
    }) as any;

    const tt = new Teamtailor({ apiKey: 'key' });
    await tt.jobApplications.create(
      {},
      { candidate: { data: { type: 'candidates', id: '1' } } }
    );

    expect(JSON.parse(capturedBody)).toEqual({
      data: {
        type: 'job-applications',
        attributes: {},
        relationships: { candidate: { data: { type: 'candidates', id: '1' } } },
      },
    });
  });

  it('should update a resource with PATCH and an id in the body', async () => {
    let capturedUrl = '';
    let capturedMethod = '';
    let capturedBody = '';
    globalThis.fetch = mock((url: any, options: any) => {
      capturedUrl = url.toString();
      capturedMethod = options.method;
      capturedBody = options.body;
      return Promise.resolve(
        new Response(
          JSON.stringify({ data: { id: '3', type: 'candidates', attributes: { email: 'x@y.com' } } }),
          { status: 200, headers: { 'content-type': 'application/vnd.api+json' } }
        )
      );
    }) as any;

    const tt = new Teamtailor({ apiKey: 'key' });
    await tt.candidates.update('3', { email: 'x@y.com' });

    expect(capturedUrl).toContain('/candidates/3');
    expect(capturedMethod).toBe('PATCH');
    expect(JSON.parse(capturedBody)).toEqual({
      data: { type: 'candidates', id: '3', attributes: { email: 'x@y.com' } },
    });
  });

  it('should delete a resource', async () => {
    let capturedMethod = '';
    let capturedUrl = '';
    globalThis.fetch = mock((url: any, options: any) => {
      capturedUrl = url.toString();
      capturedMethod = options.method;
      return Promise.resolve(new Response(null, { status: 204 }));
    }) as any;

    const tt = new Teamtailor({ apiKey: 'key' });
    await tt.candidates.delete('5');

    expect(capturedMethod).toBe('DELETE');
    expect(capturedUrl).toContain('/candidates/5');
  });
});

// ============================================
// Teamtailor Connector Class Tests
// ============================================

describe('Teamtailor', () => {
  it('should expose all resource modules', () => {
    const tt = new Teamtailor({ apiKey: 'key' });
    expect(tt.candidates).toBeInstanceOf(ResourceApi);
    expect(tt.jobs).toBeInstanceOf(ResourceApi);
    expect(tt.jobApplications).toBeInstanceOf(ResourceApi);
    expect(tt.users).toBeInstanceOf(ResourceApi);
    expect(tt.departments).toBeInstanceOf(ResourceApi);
    expect(tt.locations).toBeInstanceOf(ResourceApi);
    expect(tt.stages).toBeInstanceOf(ResourceApi);
  });

  it('should create from environment variables', () => {
    const originalKey = process.env.TEAMTAILOR_API_KEY;
    process.env.TEAMTAILOR_API_KEY = 'envkey';

    const tt = Teamtailor.fromEnv();
    expect(tt).toBeDefined();
    expect(tt.candidates).toBeInstanceOf(ResourceApi);

    if (originalKey) process.env.TEAMTAILOR_API_KEY = originalKey;
    else delete process.env.TEAMTAILOR_API_KEY;
  });

  it('should throw when creating from env without a key', () => {
    const originalKey = process.env.TEAMTAILOR_API_KEY;
    delete process.env.TEAMTAILOR_API_KEY;

    expect(() => Teamtailor.fromEnv()).toThrow(
      'TEAMTAILOR_API_KEY environment variable is required'
    );

    if (originalKey) process.env.TEAMTAILOR_API_KEY = originalKey;
  });

  it('should expose the underlying client', () => {
    const tt = new Teamtailor({ apiKey: 'key' });
    expect(tt.getClient()).toBeInstanceOf(TeamtailorClient);
  });
});

// ============================================
// Error Handling Tests
// ============================================

describe('TeamtailorApiError', () => {
  it('should create error with statusCode', () => {
    const err = new TeamtailorApiError('Not found', 404);
    expect(err.statusCode).toBe(404);
    expect(err.name).toBe('TeamtailorApiError');
  });

  it('should detect rate limiting and auth errors', () => {
    expect(new TeamtailorApiError('', 429).isRateLimited()).toBe(true);
    expect(new TeamtailorApiError('', 401).isAuthError()).toBe(true);
    expect(new TeamtailorApiError('', 403).isAuthError()).toBe(true);
    expect(new TeamtailorApiError('', 500).isServerError()).toBe(true);
    expect(new TeamtailorApiError('', 404).isNotFound()).toBe(true);
  });

  it('should provide user-friendly messages', () => {
    expect(new TeamtailorApiError('', 401).getUserMessage()).toContain('Authentication failed');
    expect(new TeamtailorApiError('', 406).getUserMessage()).toContain('X-Api-Version');
    expect(new TeamtailorApiError('', 429).getUserMessage()).toContain('Rate limit');
  });

  it('should serialize to JSON', () => {
    const err = new TeamtailorApiError('Test', 400, {
      errors: [{ code: 'invalid', detail: 'Bad input' }],
    });
    const json = err.toJSON();
    expect(json.statusCode).toBe(400);
    expect(json.errors).toHaveLength(1);
  });
});

describe('parseApiError', () => {
  it('should parse a JSON:API errors array', () => {
    const err = parseApiError(
      { errors: [{ status: '422', title: 'Validation', detail: 'email is invalid' }] },
      422
    );
    expect(err.statusCode).toBe(422);
    expect(err.message).toContain('email is invalid');
    expect(err.errors).toHaveLength(1);
  });

  it('should join multiple error details', () => {
    const err = parseApiError(
      { errors: [{ detail: 'first problem' }, { detail: 'second problem' }] },
      422
    );
    expect(err.message).toContain('first problem');
    expect(err.message).toContain('second problem');
  });

  it('should parse a string response', () => {
    const err = parseApiError('Something went wrong', 500);
    expect(err.message).toBe('Something went wrong');
    expect(err.statusCode).toBe(500);
  });

  it('should handle a null response', () => {
    const err = parseApiError(null, 500);
    expect(err.message).toBe('HTTP 500 Error');
  });
});
