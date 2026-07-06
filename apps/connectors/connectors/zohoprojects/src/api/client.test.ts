import { afterEach, describe, expect, test } from 'bun:test';
import { ZohoProjectsClient, DC_BASES, resolveBaseUrl } from './client';
import { ZohoProjectsApiError } from '../types';

const realFetch = globalThis.fetch;

interface Recorded {
  url: string;
  method: string;
  headers: Record<string, string>;
}

function installFetch(
  handler: (url: string, init: RequestInit | undefined, recorded: Recorded[]) => Response | Promise<Response>,
): Recorded[] {
  const recorded: Recorded[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const headers = Object.fromEntries(new Headers(init?.headers).entries());
    recorded.push({ url, method: init?.method ?? 'GET', headers });
    return handler(url, init, recorded);
  }) as typeof fetch;
  return recorded;
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('ZohoProjectsClient', () => {
  const mockConfig = {
    token: 'test-oauth-token',
    portalId: 'portal/123',
    dataCenter: 'eu',
  };

  describe('resolveBaseUrl', () => {
    test('resolves EU data center', () => {
      expect(resolveBaseUrl({ token: 't', dataCenter: 'eu' })).toBe(DC_BASES.eu);
    });

    test('defaults to com data center', () => {
      expect(resolveBaseUrl({ token: 't' })).toBe(DC_BASES.com);
    });

    test('uses explicit baseUrl override', () => {
      expect(resolveBaseUrl({ token: 't', baseUrl: 'https://custom.example/' })).toBe(
        'https://custom.example',
      );
    });

    test('throws on invalid data center', () => {
      expect(() => resolveBaseUrl({ token: 't', dataCenter: 'invalid' })).toThrow(
        ZohoProjectsApiError,
      );
    });
  });

  describe('constructor', () => {
    test('throws when token is missing', () => {
      expect(() => new ZohoProjectsClient({ token: '' })).toThrow('Zoho Projects token is required');
    });

    test('creates client with valid config', () => {
      const client = new ZohoProjectsClient(mockConfig);
      expect(client.getBaseUrl()).toBe(DC_BASES.eu);
      expect(client.getPortalId()).toBe('portal/123');
    });
  });

  describe('portalPath', () => {
    test('encodes portal ID in path', () => {
      const client = new ZohoProjectsClient(mockConfig);
      expect(client.portalPath('my portal', '/projects/')).toBe('/portal/my%20portal/projects/');
    });
  });

  describe('request', () => {
    test('uses /restapi prefix and Zoho-oauthtoken header', async () => {
      const recorded = installFetch(() =>
        ({
          ok: true,
          status: 200,
          text: () => Promise.resolve(JSON.stringify({ portals: [] })),
        }) as Response,
      );

      const client = new ZohoProjectsClient(mockConfig);
      await client.request('/portals/');

      expect(recorded).toHaveLength(1);
      expect(recorded[0].url).toBe(`${DC_BASES.eu}/restapi/portals/`);
      expect(recorded[0].headers.authorization).toBe('Zoho-oauthtoken test-oauth-token');
      expect(recorded[0].headers.accept).toBe('application/json');
    });

    test('shapes snake_case query params', async () => {
      const recorded = installFetch(() =>
        ({
          ok: true,
          status: 200,
          text: () => Promise.resolve('{}'),
        }) as Response,
      );

      const client = new ZohoProjectsClient(mockConfig);
      await client.request(client.portalPath('p1', '/projects/'), {
        params: {
          sort_column: 'created',
          sort_order: 'descending',
          tasklist_id: 'tl1',
        },
      });

      expect(recorded[0].url).toContain('/restapi/portal/p1/projects/');
      expect(recorded[0].url).toContain('sort_column=created');
      expect(recorded[0].url).toContain('sort_order=descending');
      expect(recorded[0].url).toContain('tasklist_id=tl1');
    });

    test('encodes project and task IDs in portal-scoped paths', async () => {
      const recorded = installFetch(() =>
        ({
          ok: true,
          status: 200,
          text: () => Promise.resolve('{}'),
        }) as Response,
      );

      const client = new ZohoProjectsClient(mockConfig);
      await client.request(
        client.portalPath('p1', `/projects/${encodeURIComponent('proj a')}/tasks/${encodeURIComponent('task b')}/`),
      );

      expect(recorded[0].url).toContain('/projects/proj%20a/tasks/task%20b/');
    });

    test('throws ZohoProjectsApiError on API error response', async () => {
      installFetch(() =>
        ({
          ok: false,
          status: 401,
          statusText: 'Unauthorized',
          text: () => Promise.resolve(JSON.stringify({ error: { message: 'Invalid OAuth token' } })),
        }) as Response,
      );

      const client = new ZohoProjectsClient(mockConfig);
      await expect(client.request('/portals/')).rejects.toThrow(ZohoProjectsApiError);
      await expect(client.request('/portals/')).rejects.toThrow('Invalid OAuth token');
    });

    test('requirePortalId throws when portalId missing', () => {
      const client = new ZohoProjectsClient({ token: 't' });
      expect(() => client.requirePortalId()).toThrow('portalId is required');
    });
  });
});
