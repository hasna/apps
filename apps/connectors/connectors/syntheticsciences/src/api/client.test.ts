import { afterEach, describe, expect, test } from 'bun:test';
import { SyntheticSciences } from './index';
import { SyntheticSciencesClient, DEFAULT_BASE_URL } from './client';
import { SyntheticSciencesApiError } from '../types';

const realFetch = globalThis.fetch;

interface Recorded {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: unknown;
}

function installFetch(
  handler: (url: string, init: RequestInit | undefined) => { status?: number; json?: unknown }
) {
  const recorded: Recorded[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    recorded.push({
      url,
      method: init?.method ?? 'GET',
      headers: (init?.headers as Record<string, string>) ?? {},
      body: init?.body,
    });
    const { status = 200, json = {} } = handler(url, init);
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: 'OK',
      headers: new Headers({ 'content-type': 'application/json' }),
      async text() {
        return JSON.stringify(json);
      },
    } as Response;
  }) as typeof fetch;
  return recorded;
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('SyntheticSciences client', () => {
  test('requires an API key', () => {
    expect(() => new SyntheticSciencesClient({ apiKey: '' })).toThrow();
  });

  test('uses the default base URL and trims trailing slashes', () => {
    expect(new SyntheticSciencesClient({ apiKey: 'k' }).getBaseUrl()).toBe(DEFAULT_BASE_URL);
    expect(new SyntheticSciencesClient({ apiKey: 'k', baseUrl: 'https://x.test/v2/' }).getBaseUrl()).toBe(
      'https://x.test/v2'
    );
  });

  test('sends a Bearer token and hits the projects endpoint', async () => {
    const recorded = installFetch((url) => {
      if (url.includes('/projects')) return { json: { data: [{ id: 'p1', name: 'Alpha' }] } };
      return { json: {} };
    });
    const ss = new SyntheticSciences({ apiKey: 'secret-key' });
    const res = await ss.research.listProjects({ limit: 5 });
    expect(res.data[0].id).toBe('p1');
    expect(recorded[0].url).toBe(`${DEFAULT_BASE_URL}/projects?limit=5`);
    expect(recorded[0].method).toBe('GET');
    expect(recorded[0].headers.Authorization).toBe('Bearer secret-key');
  });

  test('createProject POSTs a JSON body', async () => {
    const recorded = installFetch(() => ({ json: { id: 'p2', name: 'Beta' } }));
    const ss = new SyntheticSciences({ apiKey: 'k' });
    const res = await ss.research.createProject({ name: 'Beta', description: 'test' });
    expect(res.id).toBe('p2');
    const call = recorded[0];
    expect(call.method).toBe('POST');
    expect(call.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(call.body as string)).toEqual({ name: 'Beta', description: 'test' });
  });

  test('searchLiterature POSTs to /literature/search', async () => {
    const recorded = installFetch(() => ({ json: { data: [{ title: 'A paper' }] } }));
    const ss = new SyntheticSciences({ apiKey: 'k' });
    await ss.research.searchLiterature({ query: 'protein folding', limit: 3 });
    expect(recorded[0].url).toBe(`${DEFAULT_BASE_URL}/literature/search`);
    expect(JSON.parse(recorded[0].body as string)).toEqual({ query: 'protein folding', limit: 3 });
  });

  test('getGpuJob encodes the id into the path', async () => {
    const recorded = installFetch(() => ({ json: { id: 'job/1', status: 'running' } }));
    const ss = new SyntheticSciences({ apiKey: 'k' });
    await ss.research.getGpuJob('job/1');
    expect(recorded[0].url).toBe(`${DEFAULT_BASE_URL}/gpu-jobs/job%2F1`);
  });

  test('input validation rejects missing required fields', async () => {
    const ss = new SyntheticSciences({ apiKey: 'k' });
    expect(ss.research.getProject('')).rejects.toThrow('project id is required');
    expect(ss.research.searchLiterature({ query: '' })).rejects.toThrow('search query is required');
    expect(
      ss.research.createExperiment({ project_id: '', hypothesis: 'h' })
    ).rejects.toThrow('project_id is required');
  });

  test('throws a typed error on non-2xx responses', async () => {
    installFetch(() => ({ status: 404, json: { error: { message: 'not found', type: 'not_found' } } }));
    const ss = new SyntheticSciences({ apiKey: 'k' });
    try {
      await ss.research.getProject('missing');
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(SyntheticSciencesApiError);
      expect((err as SyntheticSciencesApiError).statusCode).toBe(404);
      expect((err as SyntheticSciencesApiError).message).toBe('not found');
    }
  });

  test('fromEnv reads API key and base URL from the environment', () => {
    const prevKey = process.env.SYNTHETICSCIENCES_API_KEY;
    const prevUrl = process.env.SYNTHETICSCIENCES_BASE_URL;
    process.env.SYNTHETICSCIENCES_API_KEY = 'env-key-1234567890';
    process.env.SYNTHETICSCIENCES_BASE_URL = 'https://staging.syntheticsciences.ai/v1';
    try {
      const ss = SyntheticSciences.fromEnv();
      expect(ss.getClient().getBaseUrl()).toBe('https://staging.syntheticsciences.ai/v1');
      expect(ss.getApiKeyPreview()).toContain('...');
    } finally {
      if (prevKey === undefined) delete process.env.SYNTHETICSCIENCES_API_KEY;
      else process.env.SYNTHETICSCIENCES_API_KEY = prevKey;
      if (prevUrl === undefined) delete process.env.SYNTHETICSCIENCES_BASE_URL;
      else process.env.SYNTHETICSCIENCES_BASE_URL = prevUrl;
    }
  });

  test('fromEnv throws without an API key', () => {
    const prevKey = process.env.SYNTHETICSCIENCES_API_KEY;
    delete process.env.SYNTHETICSCIENCES_API_KEY;
    try {
      expect(() => SyntheticSciences.fromEnv()).toThrow('SYNTHETICSCIENCES_API_KEY');
    } finally {
      if (prevKey !== undefined) process.env.SYNTHETICSCIENCES_API_KEY = prevKey;
    }
  });
});
