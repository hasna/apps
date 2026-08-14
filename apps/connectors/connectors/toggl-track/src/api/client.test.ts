import { afterEach, describe, expect, test } from 'bun:test';
import { TogglTrack, TogglTrackClient } from './index';
import { DEFAULT_BASE_URL } from './client';

const realFetch = globalThis.fetch;

interface Recorded {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: unknown;
}

function installFetch(handler?: (recorded: Recorded) => unknown) {
  const recorded: Recorded[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((value, key) => {
      headers[key] = value;
    });
    let body: unknown;
    if (typeof init?.body === 'string' && init.body.length > 0) {
      body = JSON.parse(init.body);
    }
    const entry: Recorded = { url, method: init?.method ?? 'GET', headers, body };
    recorded.push(entry);
    const json = handler ? handler(entry) : [];
    return {
      ok: true,
      status: 200,
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

describe('TogglTrackClient', () => {
  test('requires API token', () => {
    expect(() => new TogglTrackClient({ apiToken: '' })).toThrow('API token is required');
  });

  test('uses Basic auth with api_token password', async () => {
    const recorded = installFetch();
    const client = new TogglTrackClient({ apiToken: 'toggl-tok' });
    await client.get('/me');
    expect(recorded[0].url).toBe(`${DEFAULT_BASE_URL}/me`);
    const expected = `Basic ${Buffer.from('toggl-tok:api_token').toString('base64')}`;
    expect(recorded[0].headers.authorization || recorded[0].headers.Authorization).toBe(expected);
  });

  test('serializes array query params', () => {
    const client = new TogglTrackClient({ apiToken: 'tok' });
    const url = client.buildUrl('/workspaces/1/projects', {
      user_ids: ['10', '20'],
      active: true,
    });
    const parsed = new URL(url);
    expect(parsed.searchParams.getAll('user_ids')).toEqual(['10', '20']);
    expect(parsed.searchParams.get('active')).toBe('true');
  });

  test('createTimeEntry POSTs workspace path and body', async () => {
    const recorded = installFetch();
    const api = new TogglTrack({ apiToken: 'tok' });
    await api.timeEntries.create(12345, {
      description: 'Working on canvas',
      project_id: 100,
      start: '2026-05-15T09:00:00Z',
      duration: 3600,
      created_with: 'connect-toggl-track',
    });
    expect(recorded[0].method).toBe('POST');
    expect(recorded[0].url).toBe(`${DEFAULT_BASE_URL}/workspaces/12345/time_entries`);
    expect(recorded[0].body).toEqual({
      description: 'Working on canvas',
      project_id: 100,
      start: '2026-05-15T09:00:00Z',
      duration: 3600,
      created_with: 'connect-toggl-track',
      workspace_id: 12345,
    });
  });

  test('stopTimeEntry PATCHes stop endpoint', async () => {
    const recorded = installFetch();
    const api = new TogglTrack({ apiToken: 'tok' });
    await api.timeEntries.stop(12345, 999);
    expect(recorded[0].method).toBe('PATCH');
    expect(recorded[0].url).toBe(`${DEFAULT_BASE_URL}/workspaces/12345/time_entries/999/stop`);
  });

  test('listProjects GETs workspace projects path', async () => {
    const recorded = installFetch();
    const api = new TogglTrack({ apiToken: 'tok' });
    await api.projects.list(42, { name: 'Alpha' });
    expect(recorded[0].method).toBe('GET');
    expect(recorded[0].url).toContain('/workspaces/42/projects');
    expect(recorded[0].url).toContain('name=Alpha');
  });
});
