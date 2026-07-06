import { afterEach, describe, expect, test } from 'bun:test';
import { Sysdig } from './index';
import { resolveBaseUrl, REGIONS, DEFAULT_REGION, SysdigClient } from './client';
import { SysdigApiError } from '../types';

const realFetch = globalThis.fetch;

interface Recorded {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: unknown;
}

function installFetch(
  handler: (url: string, init: RequestInit | undefined) => { status?: number; json?: unknown; text?: string },
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
    const res = handler(url, init);
    const status = res.status ?? 200;
    const text = res.text ?? JSON.stringify(res.json ?? {});
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: 'OK',
      headers: { get: () => 'application/json' },
      async text() {
        return text;
      },
    } as unknown as Response;
  }) as typeof fetch;
  return recorded;
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('SysdigClient region resolution', () => {
  test('resolves the default region (us1) to app.sysdigcloud.com', () => {
    expect(resolveBaseUrl({ apiToken: 't' })).toBe('https://app.sysdigcloud.com');
    expect(REGIONS[DEFAULT_REGION]).toBe('https://app.sysdigcloud.com');
  });

  test('resolves named regions', () => {
    expect(resolveBaseUrl({ apiToken: 't', region: 'eu1' })).toBe('https://eu1.app.sysdig.com');
    expect(resolveBaseUrl({ apiToken: 't', region: 'US2' })).toBe('https://us2.app.sysdig.com');
  });

  test('baseUrl overrides region and trims trailing slashes', () => {
    expect(
      resolveBaseUrl({ apiToken: 't', region: 'eu1', baseUrl: 'https://api.sysdig.internal/' }),
    ).toBe('https://api.sysdig.internal');
  });

  test('throws on an unknown region', () => {
    expect(() => resolveBaseUrl({ apiToken: 't', region: 'mars' })).toThrow(/Unknown Sysdig region/);
  });

  test('constructor requires an API token', () => {
    expect(() => new SysdigClient({ apiToken: '' })).toThrow(/API token is required/);
  });
});

describe('Sysdig API transport', () => {
  test('sends Authorization: Bearer header and hits /api/user/me for whoami', async () => {
    const recorded = installFetch(() => ({ json: { user: { id: 1, username: 'alice@example.com' } } }));
    const sysdig = new Sysdig({ apiToken: 'secret-token', region: 'us2' });
    const user = await sysdig.getCurrentUser();
    expect(user.username).toBe('alice@example.com');
    expect(recorded[0].url).toBe('https://us2.app.sysdig.com/api/user/me');
    expect(recorded[0].headers.Authorization).toBe('Bearer secret-token');
  });

  test('listAlerts unwraps the alerts envelope', async () => {
    const recorded = installFetch(() => ({ json: { alerts: [{ id: 7, name: 'CPU' }] } }));
    const sysdig = new Sysdig({ apiToken: 't' });
    const alerts = await sysdig.listAlerts();
    expect(alerts).toEqual([{ id: 7, name: 'CPU' }]);
    expect(recorded[0].url).toBe('https://app.sysdigcloud.com/api/alerts');
  });

  test('createEvent posts to /api/v2/events with a JSON body', async () => {
    const recorded = installFetch(() => ({ json: { event: { id: 'evt-1', name: 'deploy' } } }));
    const sysdig = new Sysdig({ apiToken: 't' });
    const event = await sysdig.createEvent({ name: 'deploy', severity: 3 });
    expect(event.id).toBe('evt-1');
    const call = recorded[0];
    expect(call.method).toBe('POST');
    expect(call.url).toBe('https://app.sysdigcloud.com/api/v2/events');
    expect(JSON.parse(call.body as string)).toEqual({ event: { name: 'deploy', severity: 3 } });
    expect(call.headers['Content-Type']).toBe('application/json');
  });

  test('listSecurePolicies returns the raw array from /api/v1/secure/policies', async () => {
    const recorded = installFetch(() => ({ json: [{ id: 1, name: 'default' }] }));
    const sysdig = new Sysdig({ apiToken: 't' });
    const policies = await sysdig.listSecurePolicies();
    expect(policies).toEqual([{ id: 1, name: 'default' }]);
    expect(recorded[0].url).toBe('https://app.sysdigcloud.com/api/v1/secure/policies');
  });

  test('surfaces API errors with status code and joined messages', async () => {
    installFetch(() => ({ status: 403, json: { errors: [{ message: 'forbidden' }] } }));
    const sysdig = new Sysdig({ apiToken: 't' });
    try {
      await sysdig.listAlerts();
      throw new Error('expected error');
    } catch (err) {
      expect(err).toBeInstanceOf(SysdigApiError);
      expect((err as SysdigApiError).statusCode).toBe(403);
      expect((err as SysdigApiError).message).toBe('forbidden');
    }
  });
});
