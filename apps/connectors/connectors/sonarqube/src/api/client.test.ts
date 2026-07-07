import { afterEach, describe, expect, test } from 'bun:test';
import { SonarQubeClient } from './client';
import { SonarQubeApiError } from '../types';

const realFetch = globalThis.fetch;

interface Recorded {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

function installFetch(
  handler: (
    url: string,
    init: RequestInit | undefined,
    recorded: Recorded[]
  ) => { ok: boolean; status: number; body?: unknown }
) {
  const recorded: Recorded[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const headerEntries = new Headers(init?.headers);
    const headers: Record<string, string> = {};
    headerEntries.forEach((value, key) => {
      headers[key] = value;
    });
    recorded.push({
      url,
      method: init?.method ?? 'GET',
      headers,
      body: typeof init?.body === 'string' ? init.body : undefined,
    });
    const result = handler(url, init, recorded);
    const text = result.body === undefined ? '' : JSON.stringify(result.body);
    return {
      ok: result.ok,
      status: result.status,
      statusText: result.ok ? 'OK' : 'Error',
      headers: new Headers({ 'content-type': 'application/json' }),
      async text() {
        return text;
      },
    } as Response;
  }) as typeof fetch;
  return recorded;
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('SonarQubeClient', () => {
  const mockConfig = {
    token: 'sqp_test_token_12345',
    baseUrl: 'https://sonarcloud.io',
  };

  test('throws when token is missing', () => {
    expect(() => new SonarQubeClient({ token: '', baseUrl: mockConfig.baseUrl })).toThrow('SonarQube token is required');
  });

  test('throws when baseUrl is missing', () => {
    expect(() => new SonarQubeClient({ token: 'token', baseUrl: '' })).toThrow('SonarQube base URL is required');
  });

  test('strips trailing slash from base URL', () => {
    const client = new SonarQubeClient({ ...mockConfig, baseUrl: 'https://sonarcloud.io/' });
    expect(client.getBaseUrl()).toBe('https://sonarcloud.io');
  });

  test('get() uses Basic auth and GET', async () => {
    const recorded = installFetch((url) => {
      expect(url).toBe('https://sonarcloud.io/api/system/status');
      return { ok: true, status: 200, body: { status: 'UP' } };
    });

    const client = new SonarQubeClient(mockConfig);
    const result = await client.get('/api/system/status');

    expect(result).toEqual({ status: 'UP' });
    expect(recorded[0]?.method).toBe('GET');
    expect(recorded[0]?.headers.authorization).toMatch(/^Basic /);
    expect(recorded[0]?.headers.accept).toBe('application/json');
  });

  test('get() joins array query params with commas', async () => {
    const recorded = installFetch(() => ({ ok: true, status: 200, body: {} }));
    const client = new SonarQubeClient(mockConfig);

    await client.get('/api/issues/search', {
      severities: ['MAJOR', 'CRITICAL'],
      statuses: ['OPEN'],
    });

    expect(recorded[0]?.url).toContain('severities=MAJOR%2CCRITICAL');
    expect(recorded[0]?.url).toContain('statuses=OPEN');
  });

  test('post() sends application/x-www-form-urlencoded body', async () => {
    const recorded = installFetch(() => ({ ok: true, status: 200, body: { project: { key: 'demo' } } }));
    const client = new SonarQubeClient(mockConfig);

    const result = await client.post('/api/projects/create', {
      project: 'demo',
      name: 'Demo Project',
    });

    expect(recorded[0]?.method).toBe('POST');
    expect(recorded[0]?.headers['content-type']).toBe('application/x-www-form-urlencoded');
    expect(recorded[0]?.body).toBe('project=demo&name=Demo+Project');
    expect(result).toEqual({ project: { key: 'demo' } });
  });

  test('throws SonarQubeApiError from errors[].msg', async () => {
    installFetch(() => ({
      ok: false,
      status: 400,
      body: { errors: [{ msg: 'Project already exists' }] },
    }));
    const client = new SonarQubeClient(mockConfig);

    await expect(client.post('/api/projects/create', { project: 'demo', name: 'Demo' }))
      .rejects
      .toThrow(SonarQubeApiError);
  });

  test('handles 204 No Content', async () => {
    installFetch(() => ({ ok: true, status: 204 }));
    const client = new SonarQubeClient(mockConfig);
    const result = await client.post('/api/projects/delete', { project: 'demo' });
    expect(result).toEqual({});
  });
});
