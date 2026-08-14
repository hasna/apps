import { afterEach, describe, expect, test } from 'bun:test';
import { Connector } from './index';
import { ConnectorClient } from './client';

const realFetch = globalThis.fetch;

interface Recorded {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: unknown;
}

function installFetch(handler: (url: string, init: RequestInit | undefined) => unknown): Recorded[] {
  const recorded: Recorded[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const headers: Record<string, string> = {};
    if (init?.headers) {
      for (const [k, v] of Object.entries(init.headers as Record<string, string>)) {
        headers[k] = v;
      }
    }
    recorded.push({ url, method: init?.method ?? 'GET', headers, body: init?.body });
    const json = handler(url, init);
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

describe('Teamwork client transport', () => {
  test('builds the base URL from a bare installation name', () => {
    const client = new ConnectorClient({ apiKey: 'tkn', installation: 'acme' });
    expect(client.getBaseUrl()).toBe('https://acme.teamwork.com');
  });

  test('accepts a full host as the installation', () => {
    const client = new ConnectorClient({ apiKey: 'tkn', installation: 'acme.teamwork.com' });
    expect(client.getBaseUrl()).toBe('https://acme.teamwork.com');
  });

  test('honors an explicit base URL override and trims trailing slashes', () => {
    const client = new ConnectorClient({ apiKey: 'tkn', baseUrl: 'https://acme.teamwork.com/' });
    expect(client.getBaseUrl()).toBe('https://acme.teamwork.com');
  });

  test('requires an API token', () => {
    expect(() => new ConnectorClient({ installation: 'acme' })).toThrow();
  });

  test('requires an installation or base URL', () => {
    expect(() => new ConnectorClient({ apiKey: 'tkn' })).toThrow();
  });

  test('authenticates with HTTP Basic using the token as the username', async () => {
    const recorded = installFetch(() => ({ projects: [], meta: { page: { hasMore: false } } }));
    const tw = new Connector({ apiKey: 'my-token', installation: 'acme' });
    await tw.projects.list();

    expect(recorded[0].url).toBe('https://acme.teamwork.com/projects/api/v3/projects.json');
    const expected = 'Basic ' + Buffer.from('my-token:x').toString('base64');
    expect(recorded[0].headers.Authorization).toBe(expected);
  });

  test('projects.list maps pagination params to v3 query string', async () => {
    const recorded = installFetch(() => ({ projects: [], meta: {} }));
    const tw = new Connector({ apiKey: 'tkn', installation: 'acme' });
    await tw.projects.list({ page: 2, pageSize: 50, searchTerm: 'launch' });

    const url = new URL(recorded[0].url);
    expect(url.pathname).toBe('/projects/api/v3/projects.json');
    expect(url.searchParams.get('page')).toBe('2');
    expect(url.searchParams.get('pageSize')).toBe('50');
    expect(url.searchParams.get('searchTerm')).toBe('launch');
  });

  test('tasks.listByProject targets the project-scoped endpoint', async () => {
    const recorded = installFetch(() => ({ tasks: [] }));
    const tw = new Connector({ apiKey: 'tkn', installation: 'acme' });
    await tw.tasks.listByProject(42);
    expect(new URL(recorded[0].url).pathname).toBe('/projects/api/v3/projects/42/tasks.json');
  });

  test('tasks.create posts to the tasklist endpoint with a task envelope', async () => {
    const recorded = installFetch(() => ({ task: { id: 1, name: 'Ship it' } }));
    const tw = new Connector({ apiKey: 'tkn', installation: 'acme' });
    await tw.tasks.create(7, { name: 'Ship it', priority: 'high' });

    const call = recorded[0];
    expect(call.method).toBe('POST');
    expect(new URL(call.url).pathname).toBe('/projects/api/v3/tasklists/7/tasks.json');
    const body = JSON.parse(call.body as string);
    expect(body).toEqual({ task: { name: 'Ship it', priority: 'high' } });
  });

  test('people.me hits the v3 me endpoint', async () => {
    const recorded = installFetch(() => ({ person: { id: 5 } }));
    const tw = new Connector({ apiKey: 'tkn', installation: 'acme' });
    await tw.people.me();
    expect(new URL(recorded[0].url).pathname).toBe('/projects/api/v3/me.json');
  });
});
