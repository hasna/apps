import { afterEach, describe, expect, test } from 'bun:test';
import { ZohoSurveyClient, DEFAULT_BASE_URL } from './client';
import { ZohoSurvey } from './index';
import { ZohoSurveyApiError } from '../types';

const realFetch = globalThis.fetch;

interface Recorded {
  url: string;
  method: string;
  headers: Record<string, string>;
}

function installFetch(handler: (url: string, init: RequestInit | undefined) => unknown) {
  const recorded: Recorded[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const headers: Record<string, string> = {};
    if (init?.headers) {
      const raw = init.headers instanceof Headers ? Object.fromEntries(init.headers.entries()) : init.headers;
      Object.assign(headers, raw);
    }
    recorded.push({ url, method: init?.method ?? 'GET', headers });
    const json = handler(url, init);
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
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

describe('ZohoSurveyClient transport', () => {
  test('requires token and only requires portal fields for portal-scoped paths', () => {
    expect(() => new ZohoSurveyClient({ token: '', portalId: '1', departmentId: 'd' })).toThrow();
    const client = new ZohoSurveyClient({ token: 't' });
    expect(() => client.surveyBasePath()).toThrow('portalId is required');
  });

  test('supports token-only portal listing', async () => {
    const recorded = installFetch((url) => {
      expect(url).toContain('/portals');
      return { portals: [{ portalId: 'p1', portalName: 'Main' }] };
    });
    const survey = new ZohoSurvey({ token: 'tok123' });
    await expect(survey.listPortals()).resolves.toEqual([{ portalId: 'p1', portalName: 'Main' }]);
    expect(recorded[0].headers.Authorization).toBe('Zoho-oauthtoken tok123');
  });

  test('uses Zoho-oauthtoken header and portal path', async () => {
    const recorded = installFetch((url) => {
      expect(url).toContain('/portals/p1/departments/d1/surveys');
      return [{ id: 's1', name: 'NPS' }];
    });
    const client = new ZohoSurveyClient({ token: 'tok123', portalId: 'p1', departmentId: 'd1' });
    await client.request('/portals/p1/departments/d1/surveys');
    expect(recorded[0].headers.Authorization).toBe('Zoho-oauthtoken tok123');
    expect(recorded[0].method).toBe('GET');
  });

  test('defaults to survey.zoho.com private API base', () => {
    const client = new ZohoSurveyClient({ token: 't', portalId: 'p1', departmentId: 'd1' });
    expect(DEFAULT_BASE_URL).toBe('https://survey.zoho.com/survey/api/v1/private');
    expect(client.surveyBasePath()).toBe('/portals/p1/departments/d1');
  });

  test('parses API errors from errormessage field', async () => {
    globalThis.fetch = (async () => ({
      ok: false,
      status: 403,
      statusText: 'Forbidden',
      async text() {
        return JSON.stringify({ errormessage: 'Invalid scope', code: 403 });
      },
    })) as unknown as typeof fetch;

    const client = new ZohoSurveyClient({ token: 't', portalId: 'p1', departmentId: 'd1' });
    await expect(client.request('/portals')).rejects.toBeInstanceOf(ZohoSurveyApiError);
    await expect(client.request('/portals')).rejects.toMatchObject({
      message: 'Invalid scope',
      statusCode: 403,
    });
  });
});

describe('ZohoSurvey API methods', () => {
  test('listCollectors requests open collectors metainfo', async () => {
    const recorded = installFetch((url) => {
      expect(url).toContain('/collectors/metainfo');
      expect(url).toContain('status=open');
      return [{ id: 'c1', name: 'Web Link' }];
    });
    const survey = new ZohoSurvey({ token: 't', portalId: 'p1', departmentId: 'd1' });
    const collectors = await survey.listCollectors('s1');
    expect(collectors).toEqual([{ id: 'c1', name: 'Web Link' }]);
    expect(recorded[0].url).toContain('/surveys/s1/collectors/metainfo');
  });
});
