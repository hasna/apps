import { afterEach, describe, expect, test } from 'bun:test';
import { ZohoRecruit, ZohoRecruitClient, resolveRecruitBaseUrl, RECRUIT_DC_BASES } from './index';
import { ZohoRecruitApiError } from '../types';

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('resolveRecruitBaseUrl', () => {
  test('defaults to com data center', () => {
    expect(resolveRecruitBaseUrl({})).toBe('https://recruit.zoho.com/recruit/v2');
  });

  test('resolves eu data center', () => {
    expect(resolveRecruitBaseUrl({ dataCenter: 'eu' })).toBe('https://recruit.zoho.eu/recruit/v2');
  });

  test('uses explicit baseUrl override', () => {
    expect(resolveRecruitBaseUrl({ baseUrl: 'https://custom.example/recruit/v2/' })).toBe(
      'https://custom.example/recruit/v2',
    );
  });

  test('throws for unknown data center', () => {
    expect(() => resolveRecruitBaseUrl({ dataCenter: 'invalid' })).toThrow('data_center must be one of');
  });
});

describe('ZohoRecruitClient', () => {
  test('requires token', () => {
    expect(() => new ZohoRecruitClient({ token: '' })).toThrow('token is required');
  });

  test('exposes resolved base URL', () => {
    const client = new ZohoRecruitClient({ token: 'test-token', dataCenter: 'eu' });
    expect(client.getBaseUrl()).toBe(RECRUIT_DC_BASES.eu + '/recruit/v2');
  });

  test('sends Zoho-oauthtoken auth header on GET', async () => {
    let capturedUrl = '';
    let capturedHeaders: Record<string, string> = {};
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      capturedUrl = typeof input === 'string' ? input : input.toString();
      capturedHeaders = Object.fromEntries(new Headers(init?.headers).entries());
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({ data: [] });
        },
      } as Response;
    }) as typeof fetch;

    const client = new ZohoRecruitClient({ token: 'oauth-token-123', dataCenter: 'com' });
    await client.request('/Candidates', { params: { page: 1, per_page: 10 } });

    expect(capturedUrl).toBe('https://recruit.zoho.com/recruit/v2/Candidates?page=1&per_page=10');
    expect(capturedHeaders.authorization).toBe('Zoho-oauthtoken oauth-token-123');
    expect(capturedHeaders.accept).toBe('application/json');
  });

  test('sends JSON body on POST', async () => {
    let capturedBody = '';
    globalThis.fetch = (async (_input, init?: RequestInit) => {
      capturedBody = init?.body as string;
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({ data: [{ details: { id: '1' } }] });
        },
      } as Response;
    }) as typeof fetch;

    const client = new ZohoRecruitClient({ token: 'tok' });
    await client.request('/Candidates', {
      method: 'POST',
      body: { data: [{ Last_Name: 'Smith' }] },
    });

    expect(JSON.parse(capturedBody)).toEqual({ data: [{ Last_Name: 'Smith' }] });
  });

  test('maps API errors to ZohoRecruitApiError', async () => {
    globalThis.fetch = (async () => ({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      async text() {
        return JSON.stringify({ message: 'Invalid OAuth token', code: 'INVALID_TOKEN' });
      },
    })) as unknown as typeof fetch;

    const client = new ZohoRecruitClient({ token: 'bad' });
    await expect(client.request('/org')).rejects.toBeInstanceOf(ZohoRecruitApiError);
    await expect(client.request('/org')).rejects.toMatchObject({
      message: 'Invalid OAuth token',
      statusCode: 401,
      code: 'INVALID_TOKEN',
    });
  });

  test('returns empty object for 204 responses', async () => {
    globalThis.fetch = (async () => ({
      ok: true,
      status: 204,
      async text() {
        return '';
      },
    })) as unknown as typeof fetch;

    const client = new ZohoRecruitClient({ token: 'tok' });
    const result = await client.request('/Candidates/1', { method: 'DELETE' });
    expect(result).toEqual({});
  });
});

describe('ZohoRecruit', () => {
  test('fromEnv requires ZOHORECRUIT_TOKEN', () => {
    const prev = process.env.ZOHORECRUIT_TOKEN;
    delete process.env.ZOHORECRUIT_TOKEN;
    expect(() => ZohoRecruit.fromEnv()).toThrow('ZOHORECRUIT_TOKEN is required');
    if (prev) process.env.ZOHORECRUIT_TOKEN = prev;
  });

  test('searchRecords builds query params', async () => {
    let capturedUrl = '';
    globalThis.fetch = (async (input: string | URL | Request) => {
      capturedUrl = typeof input === 'string' ? input : input.toString();
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({ data: [], info: { per_page: 200, count: 0, page: 1, more_records: false } });
        },
      } as Response;
    }) as typeof fetch;

    const recruit = new ZohoRecruit({ token: 'tok' });
    await recruit.searchRecords('Candidates', { email: 'test@example.com', criteria: '(Email:equals:test@example.com)' });
    expect(capturedUrl).toContain('/Candidates/search');
    expect(capturedUrl).toContain('email=test%40example.com');
  });
});
