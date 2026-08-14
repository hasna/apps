import { describe, test, expect, mock } from 'bun:test';
import { ConnectorClient } from './client';
import { JobsApi } from './jobs';
import { CandidatesApi } from './candidates';
import { Connector } from './index';
import { ConnectorApiError } from '../types';

describe('ConnectorClient', () => {
  test('requires api key', () => {
    expect(new ConnectorClient({ apiKey: 'token', subdomain: 'acme' })).toBeDefined();
    expect(() => new ConnectorClient({ subdomain: 'acme' })).toThrow('API key or token is required');
  });

  test('requires subdomain', () => {
    expect(() => new ConnectorClient({ apiKey: 'token' })).toThrow('Workable subdomain is required');
    expect(() => new ConnectorClient({ apiKey: 'token', subdomain: '  ' })).toThrow('Workable subdomain is required');
  });

  test('builds correct base URL', () => {
    const client = new ConnectorClient({ apiKey: 'token', subdomain: 'acme' });
    expect(client.buildUrl('/jobs')).toBe('https://acme.workable.com/spi/v3/jobs');
    expect(client.buildUrl('/jobs', { state: 'published', limit: 10 })).toBe(
      'https://acme.workable.com/spi/v3/jobs?state=published&limit=10',
    );
  });

  test('sends Authorization Bearer header', async () => {
    const client = new ConnectorClient({ apiKey: 'secret-token', subdomain: 'acme' });
    let authHeader = '';

    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock((_url, init) => {
      const headers = init?.headers;
      if (headers instanceof Headers) {
        authHeader = headers.get('Authorization') || '';
      } else if (headers && typeof headers === 'object') {
        authHeader = String((headers as Record<string, string>).Authorization || '');
      }
      return Promise.resolve(
        new Response(JSON.stringify({ jobs: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    }) as any;

    await client.get('/jobs');
    expect(authHeader).toBe('Bearer secret-token');

    globalThis.fetch = originalFetch;
  });

  test('throws ConnectorApiError on HTTP error', async () => {
    const client = new ConnectorClient({ apiKey: 'token', subdomain: 'acme' });

    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response(JSON.stringify({ message: 'Unauthorized' }), {
          status: 401,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    ) as any;

    await expect(client.get('/jobs')).rejects.toThrow(ConnectorApiError);

    globalThis.fetch = originalFetch;
  });

  test('getApiKeyPreview masks key', () => {
    const client = new ConnectorClient({ apiKey: 'abcdef1234567890', subdomain: 'acme' });
    expect(client.getApiKeyPreview()).toBe('abcdef...7890');
  });
});

describe('JobsApi', () => {
  test('listJobs calls SPI v3 jobs endpoint', async () => {
    const client = new ConnectorClient({ apiKey: 'token', subdomain: 'acme' });
    const jobsApi = new JobsApi(client);
    let requestedUrl = '';

    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock((url) => {
      requestedUrl = String(url);
      return Promise.resolve(
        new Response(JSON.stringify({ jobs: [{ shortcode: 'ENG-1' }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    }) as any;

    const result = await jobsApi.list({ state: 'published', limit: 5 });
    expect(requestedUrl).toContain('https://acme.workable.com/spi/v3/jobs');
    expect(requestedUrl).toContain('state=published');
    expect(requestedUrl).toContain('limit=5');
    expect(result.jobs?.[0]?.shortcode).toBe('ENG-1');

    globalThis.fetch = originalFetch;
  });
});

describe('CandidatesApi', () => {
  test('createCandidate posts to job candidates endpoint', async () => {
    const client = new ConnectorClient({ apiKey: 'token', subdomain: 'acme' });
    const candidatesApi = new CandidatesApi(client);
    let requestedUrl = '';
    let body = '';

    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock((url, init) => {
      requestedUrl = String(url);
      body = String(init?.body);
      return Promise.resolve(
        new Response(JSON.stringify({ id: 'cand-1', name: 'Jane Doe' }), {
          status: 201,
          headers: { 'content-type': 'application/json' },
        }),
      );
    }) as any;

    const result = await candidatesApi.create({
      shortcode: 'ENG-1',
      candidate: { name: 'Jane Doe', email: 'jane@example.com' },
    });

    expect(requestedUrl).toBe('https://acme.workable.com/spi/v3/jobs/ENG-1/candidates');
    expect(body).toContain('Jane Doe');
    expect(result.id).toBe('cand-1');

    globalThis.fetch = originalFetch;
  });

  test('moveStage posts target_stage', async () => {
    const client = new ConnectorClient({ apiKey: 'token', subdomain: 'acme' });
    const candidatesApi = new CandidatesApi(client);
    let body = '';

    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock((_url, init) => {
      body = String(init?.body);
      return Promise.resolve(
        new Response(JSON.stringify({ id: 'cand-1' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    }) as any;

    await candidatesApi.moveStage({ id: 'cand-1', targetStage: 'phone-screen' });
    expect(body).toContain('phone-screen');

    globalThis.fetch = originalFetch;
  });
});

describe('Connector', () => {
  test('fromEnv requires WORKABLE_API_TOKEN and WORKABLE_SUBDOMAIN', () => {
    const origToken = process.env.WORKABLE_API_TOKEN;
    const origSub = process.env.WORKABLE_SUBDOMAIN;
    delete process.env.WORKABLE_API_TOKEN;
    delete process.env.WORKABLE_SUBDOMAIN;

    expect(() => Connector.fromEnv()).toThrow('WORKABLE_API_TOKEN');

    process.env.WORKABLE_API_TOKEN = 'token';
    expect(() => Connector.fromEnv()).toThrow('WORKABLE_SUBDOMAIN');

    process.env.WORKABLE_SUBDOMAIN = 'acme';
    expect(Connector.fromEnv()).toBeDefined();

    if (origToken) process.env.WORKABLE_API_TOKEN = origToken;
    else delete process.env.WORKABLE_API_TOKEN;
    if (origSub) process.env.WORKABLE_SUBDOMAIN = origSub;
    else delete process.env.WORKABLE_SUBDOMAIN;
  });
});
