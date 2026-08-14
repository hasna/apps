import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test';
import { SmartRecruiters } from './index';
import { SmartRecruitersClient } from './client';
import { JobsApi } from './jobs';
import { CandidatesApi } from './candidates';
import { PostingsApi } from './postings';
import { ConfigurationApi } from './configuration';
import { UsersApi } from './users';
import { SmartRecruitersApiError, parseApiError } from '../types';

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
    'content-type': 'application/json',
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
// SmartRecruitersClient Tests
// ============================================

describe('SmartRecruitersClient', () => {
  it('should require an apiKey', () => {
    expect(() => new SmartRecruitersClient({ apiKey: '' })).toThrow(
      'apiKey is required'
    );
  });

  it('should create a client with a valid apiKey', () => {
    const client = new SmartRecruitersClient({ apiKey: 'testtoken' });
    expect(client).toBeDefined();
  });

  it('should include the X-SmartToken header in requests', async () => {
    const originalFetch = globalThis.fetch;
    let capturedHeaders: Record<string, string> = {};

    globalThis.fetch = mock((_url: any, options: any) => {
      capturedHeaders = options.headers;
      return Promise.resolve(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      );
    }) as any;

    const client = new SmartRecruitersClient({ apiKey: 'my-smart-token' });
    await client.get('/jobs');

    expect(capturedHeaders['X-SmartToken']).toBe('my-smart-token');
    expect(capturedHeaders['Accept']).toBe('application/json');

    restoreFetch(originalFetch);
  });

  it('should target the default base URL', async () => {
    const originalFetch = globalThis.fetch;
    let capturedUrl = '';

    globalThis.fetch = mock((url: any) => {
      capturedUrl = url.toString();
      return Promise.resolve(
        new Response(JSON.stringify({}), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      );
    }) as any;

    const client = new SmartRecruitersClient({ apiKey: 'token' });
    await client.get('/jobs');

    expect(capturedUrl).toContain('https://api.smartrecruiters.com/jobs');

    restoreFetch(originalFetch);
  });

  it('should honor a custom base URL and strip trailing slash', async () => {
    const originalFetch = globalThis.fetch;
    let capturedUrl = '';

    globalThis.fetch = mock((url: any) => {
      capturedUrl = url.toString();
      return Promise.resolve(
        new Response(JSON.stringify({}), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      );
    }) as any;

    const client = new SmartRecruitersClient({ apiKey: 'token', baseUrl: 'https://example.test/api/' });
    await client.get('/jobs');

    expect(capturedUrl).toBe('https://example.test/api/jobs');

    restoreFetch(originalFetch);
  });

  it('should handle 204 No Content', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response(null, { status: 204 }))
    ) as any;

    const client = new SmartRecruitersClient({ apiKey: 'token' });
    const result = await client.delete('/jobs/123');
    expect(result).toEqual({});

    restoreFetch(originalFetch);
  });

  it('should throw SmartRecruitersApiError on non-ok response', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetch({
      status: 401,
      body: { message: 'Authentication failed' },
    }) as any;

    const client = new SmartRecruitersClient({ apiKey: 'badtoken' });

    try {
      await client.get('/jobs');
      expect(true).toBe(false); // Should not reach here
    } catch (err) {
      expect(err).toBeInstanceOf(SmartRecruitersApiError);
      expect((err as SmartRecruitersApiError).statusCode).toBe(401);
      expect((err as SmartRecruitersApiError).message).toContain('Authentication failed');
    }

    restoreFetch(originalFetch);
  });

  it('should build URL with query parameters', async () => {
    const originalFetch = globalThis.fetch;
    let capturedUrl = '';

    globalThis.fetch = mock((url: any) => {
      capturedUrl = url.toString();
      return Promise.resolve(
        new Response(JSON.stringify({ content: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      );
    }) as any;

    const client = new SmartRecruitersClient({ apiKey: 'token' });
    await client.get('/jobs', { limit: 10, q: 'engineer' });

    expect(capturedUrl).toContain('limit=10');
    expect(capturedUrl).toContain('q=engineer');

    restoreFetch(originalFetch);
  });

  it('should return a credential preview that does not leak the token', () => {
    const client = new SmartRecruitersClient({ apiKey: 'abcdef1234567890' });
    expect(client.getCredentialPreview()).toBe('Token: abcdef...');
  });
});

// ============================================
// JobsApi Tests
// ============================================

describe('JobsApi', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    restoreFetch(originalFetch);
  });

  it('should list jobs and expose the content envelope', async () => {
    const body = {
      totalFound: 2,
      offset: 0,
      limit: 10,
      content: [
        { id: 'job-1', title: 'Backend Engineer' },
        { id: 'job-2', title: 'Product Manager' },
      ],
    };
    globalThis.fetch = mockFetch({ body }) as any;

    const sr = new SmartRecruiters({ apiKey: 'token' });
    const result = await sr.jobs.list({ limit: 10 });

    expect(result.totalFound).toBe(2);
    expect(result.content).toHaveLength(2);
    expect(result.content[0].title).toBe('Backend Engineer');
  });

  it('should send list filters as query params', async () => {
    let capturedUrl = '';
    globalThis.fetch = mock((url: any) => {
      capturedUrl = url.toString();
      return Promise.resolve(
        new Response(JSON.stringify({ content: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      );
    }) as any;

    const sr = new SmartRecruiters({ apiKey: 'token' });
    await sr.jobs.list({ status: 'SOURCING', postingStatus: 'PUBLIC', offset: 5 });

    expect(capturedUrl).toContain('status=SOURCING');
    expect(capturedUrl).toContain('postingStatus=PUBLIC');
    expect(capturedUrl).toContain('offset=5');
  });

  it('should URL-encode the job id in get', async () => {
    let capturedUrl = '';
    globalThis.fetch = mock((url: any) => {
      capturedUrl = url.toString();
      return Promise.resolve(
        new Response(JSON.stringify({ id: 'a/b' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      );
    }) as any;

    const sr = new SmartRecruiters({ apiKey: 'token' });
    await sr.jobs.get('a/b');

    expect(capturedUrl).toContain('/jobs/a%2Fb');
  });

  it('should get the hiring team', async () => {
    let capturedUrl = '';
    globalThis.fetch = mock((url: any) => {
      capturedUrl = url.toString();
      return Promise.resolve(
        new Response(JSON.stringify({ content: [{ id: 'u1', role: 'RECRUITER' }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      );
    }) as any;

    const sr = new SmartRecruiters({ apiKey: 'token' });
    const result = await sr.jobs.getHiringTeam('job-1');

    expect(capturedUrl).toContain('/jobs/job-1/hiring-team');
    expect(result.content[0].role).toBe('RECRUITER');
  });
});

// ============================================
// CandidatesApi Tests
// ============================================

describe('CandidatesApi', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    restoreFetch(originalFetch);
  });

  it('should list candidates on a job', async () => {
    let capturedUrl = '';
    globalThis.fetch = mock((url: any) => {
      capturedUrl = url.toString();
      return Promise.resolve(
        new Response(JSON.stringify({ content: [{ id: 'c1', firstName: 'Ada' }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      );
    }) as any;

    const sr = new SmartRecruiters({ apiKey: 'token' });
    const result = await sr.candidates.listByJob('job-1', { status: 'NEW' });

    expect(capturedUrl).toContain('/jobs/job-1/candidates');
    expect(capturedUrl).toContain('status=NEW');
    expect(result.content[0].firstName).toBe('Ada');
  });

  it('should get a candidate status on a job', async () => {
    let capturedUrl = '';
    globalThis.fetch = mock((url: any) => {
      capturedUrl = url.toString();
      return Promise.resolve(
        new Response(JSON.stringify({ status: 'IN_REVIEW' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      );
    }) as any;

    const sr = new SmartRecruiters({ apiKey: 'token' });
    const result = await sr.candidates.getStatus('job-1', 'c1');

    expect(capturedUrl).toContain('/jobs/job-1/candidates/c1/status');
    expect(result.status).toBe('IN_REVIEW');
  });
});

// ============================================
// PostingsApi Tests
// ============================================

describe('PostingsApi', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    restoreFetch(originalFetch);
  });

  it('should require a company identifier', async () => {
    const sr = new SmartRecruiters({ apiKey: 'token' });
    await expect(sr.postings.list()).rejects.toThrow('company identifier is required');
  });

  it('should use the configured default company', async () => {
    let capturedUrl = '';
    globalThis.fetch = mock((url: any) => {
      capturedUrl = url.toString();
      return Promise.resolve(
        new Response(JSON.stringify({ content: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      );
    }) as any;

    const sr = new SmartRecruiters({ apiKey: 'token', companyId: 'acme' });
    await sr.postings.list({ limit: 5 });

    expect(capturedUrl).toContain('/v1/companies/acme/postings');
    expect(capturedUrl).toContain('limit=5');
  });

  it('should let an explicit company override the default', async () => {
    let capturedUrl = '';
    globalThis.fetch = mock((url: any) => {
      capturedUrl = url.toString();
      return Promise.resolve(
        new Response(JSON.stringify({ id: 'p1' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      );
    }) as any;

    const sr = new SmartRecruiters({ apiKey: 'token', companyId: 'acme' });
    await sr.postings.get('p1', 'other-co');

    expect(capturedUrl).toContain('/v1/companies/other-co/postings/p1');
  });
});

// ============================================
// ConfigurationApi Tests
// ============================================

describe('ConfigurationApi', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    restoreFetch(originalFetch);
  });

  it('should list departments', async () => {
    let capturedUrl = '';
    globalThis.fetch = mock((url: any) => {
      capturedUrl = url.toString();
      return Promise.resolve(
        new Response(JSON.stringify({ content: [{ id: 'd1', label: 'Engineering' }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      );
    }) as any;

    const sr = new SmartRecruiters({ apiKey: 'token' });
    const result = await sr.configuration.departments();

    expect(capturedUrl).toContain('/configuration/departments');
    expect(result.content[0].label).toBe('Engineering');
  });
});

// ============================================
// SmartRecruiters Connector Class Tests
// ============================================

describe('SmartRecruiters', () => {
  it('should wire up all API modules', () => {
    const sr = new SmartRecruiters({ apiKey: 'token' });
    expect(sr.jobs).toBeInstanceOf(JobsApi);
    expect(sr.candidates).toBeInstanceOf(CandidatesApi);
    expect(sr.postings).toBeInstanceOf(PostingsApi);
    expect(sr.configuration).toBeInstanceOf(ConfigurationApi);
    expect(sr.users).toBeInstanceOf(UsersApi);
  });

  it('should create from environment variables', () => {
    const original = process.env.SMARTRECRUITERS_API_KEY;
    process.env.SMARTRECRUITERS_API_KEY = 'env-token';

    const sr = SmartRecruiters.fromEnv();
    expect(sr).toBeDefined();
    expect(sr.jobs).toBeInstanceOf(JobsApi);

    if (original) process.env.SMARTRECRUITERS_API_KEY = original;
    else delete process.env.SMARTRECRUITERS_API_KEY;
  });

  it('should throw when creating from env without credentials', () => {
    const original = process.env.SMARTRECRUITERS_API_KEY;
    delete process.env.SMARTRECRUITERS_API_KEY;

    expect(() => SmartRecruiters.fromEnv()).toThrow(
      'SMARTRECRUITERS_API_KEY environment variable is required'
    );

    if (original) process.env.SMARTRECRUITERS_API_KEY = original;
  });

  it('should expose the underlying client', () => {
    const sr = new SmartRecruiters({ apiKey: 'token' });
    expect(sr.getClient()).toBeInstanceOf(SmartRecruitersClient);
  });
});

// ============================================
// Error Handling Tests
// ============================================

describe('SmartRecruitersApiError', () => {
  it('should classify status codes', () => {
    expect(new SmartRecruitersApiError('x', 429).isRateLimited()).toBe(true);
    expect(new SmartRecruitersApiError('x', 500).isServerError()).toBe(true);
    expect(new SmartRecruitersApiError('x', 404).isNotFound()).toBe(true);
    expect(new SmartRecruitersApiError('x', 401).isAuthError()).toBe(true);
    expect(new SmartRecruitersApiError('x', 403).isAuthError()).toBe(true);
    expect(new SmartRecruitersApiError('x', 400).isClientError()).toBe(true);
  });

  it('should provide user-friendly messages', () => {
    expect(new SmartRecruitersApiError('', 401).getUserMessage()).toContain('Authentication failed');
    expect(new SmartRecruitersApiError('', 429).getUserMessage()).toContain('Rate limit');
    expect(new SmartRecruitersApiError('', 404).getUserMessage()).toContain('not found');
  });

  it('should serialize to JSON', () => {
    const err = new SmartRecruitersApiError('Test error', 422, {
      errors: [{ code: 'INVALID', message: 'Bad input', field: 'title' }],
    });
    const json = err.toJSON();
    expect(json.statusCode).toBe(422);
    expect(json.errors).toHaveLength(1);
  });
});

describe('parseApiError', () => {
  it('should parse a string response', () => {
    const err = parseApiError('Something went wrong', 500);
    expect(err.message).toBe('Something went wrong');
    expect(err.statusCode).toBe(500);
  });

  it('should parse an object with a message field', () => {
    const err = parseApiError({ message: 'Bad request' }, 400);
    expect(err.message).toBe('Bad request');
  });

  it('should parse an errors array', () => {
    const err = parseApiError(
      { errors: [{ code: 'REQUIRED', message: 'Title is required', field: 'title' }] },
      422
    );
    expect(err.errors).toHaveLength(1);
    expect(err.errors![0].code).toBe('REQUIRED');
    expect(err.message).toBe('Title is required');
  });

  it('should handle a null response', () => {
    const err = parseApiError(null, 500);
    expect(err.message).toBe('HTTP 500 Error');
  });
});
