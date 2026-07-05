import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { ZohoCreatorClient } from './client';
import { ZohoCreator } from './index';
import { ZohoCreatorApiError } from '../types';

type FetchMock = ReturnType<typeof mock>;

function mockFetch(
  response: unknown,
  options: {
    ok?: boolean;
    status?: number;
  } = {},
): FetchMock {
  const fetchMock = mock(() =>
    Promise.resolve({
      ok: options.ok ?? true,
      status: options.status ?? 200,
      text: () => Promise.resolve(JSON.stringify(response)),
    } as Response),
  );
  global.fetch = fetchMock as unknown as typeof global.fetch;
  return fetchMock;
}

function mockedFetch(): FetchMock {
  return global.fetch as unknown as FetchMock;
}

describe('ZohoCreatorClient', () => {
  const mockConfig = {
    accessToken: 'zcr-tok',
    dataCenter: 'com' as const,
    environment: 'production' as const,
  };

  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe('constructor', () => {
    test('throws when access token is missing', () => {
      expect(() => new ZohoCreatorClient({ accessToken: '' })).toThrow('Zoho Creator access token is required');
    });

    test('throws for invalid data center', () => {
      expect(() => new ZohoCreatorClient({ accessToken: 'tok', dataCenter: 'invalid' as 'com' })).toThrow(
        'data_center must be one of',
      );
    });

    test('throws for invalid environment', () => {
      expect(() => new ZohoCreatorClient({ accessToken: 'tok', environment: 'staging' as 'stage' })).toThrow(
        'environment must be one of',
      );
    });

    test('creates client with valid config', () => {
      const client = new ZohoCreatorClient(mockConfig);
      expect(client).toBeInstanceOf(ZohoCreatorClient);
      expect(client.getBaseUrl()).toBe('https://creator.zoho.com');
      expect(client.getApiPrefix()).toBe('/api/v2.1');
    });

    test('stage environment uses /api/v2.1/stage prefix', () => {
      const client = new ZohoCreatorClient({ ...mockConfig, environment: 'stage' });
      expect(client.getApiPrefix()).toBe('/api/v2.1/stage');
    });

    test('stage_v2 environment uses /api/v2.1/stage prefix', () => {
      const client = new ZohoCreatorClient({ ...mockConfig, environment: 'stage_v2' });
      expect(client.getApiPrefix()).toBe('/api/v2.1/stage');
    });

    test('EU data center routes to creator.zoho.eu', () => {
      const client = new ZohoCreatorClient({ ...mockConfig, dataCenter: 'eu' });
      expect(client.getBaseUrl()).toBe('https://creator.zoho.eu');
    });
  });

  describe('request', () => {
    test('GET sends Zoho-oauthtoken Authorization header', async () => {
      const fetchMock = mockFetch({ code: 3000, data: [] });

      const client = new ZohoCreatorClient(mockConfig);
      await client.get('/applications');

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, options] = fetchMock.mock.calls[0];
      expect(url).toBe('https://creator.zoho.com/api/v2.1/applications');
      expect((options as RequestInit).method).toBe('GET');
      expect((options as RequestInit).headers).toMatchObject({
        Authorization: 'Zoho-oauthtoken zcr-tok',
      });
    });

    test('URL-encodes path segments', async () => {
      const fetchMock = mockFetch({ code: 3000 });

      const client = new ZohoCreatorClient(mockConfig);
      await client.get('/team%40example.com/Sales/report/All_Leads', { criteria: 'Status == "Open"', max_records: 100 });

      const [url] = fetchMock.mock.calls[0];
      expect(url).toContain('/api/v2.1/team%40example.com/Sales/report/All_Leads');
      expect(url).toContain('criteria=Status');
      expect(url).toContain('max_records=100');
    });

    test('POST sends JSON body', async () => {
      const fetchMock = mockFetch({ code: 3000 });

      const client = new ZohoCreatorClient(mockConfig);
      const body = { data: { Name: 'Ada', Email: 'ada@example.com' } };
      await client.post('/owner/App/form/Lead_Form', body);

      const [, options] = fetchMock.mock.calls[0];
      expect((options as RequestInit).method).toBe('POST');
      expect((options as RequestInit).body).toBe(JSON.stringify(body));
    });

    test('PATCH sends JSON body', async () => {
      const fetchMock = mockFetch({ code: 3000 });

      const client = new ZohoCreatorClient(mockConfig);
      await client.patch('/owner/App/report/All_Leads/rec-1', { data: { Status: 'Closed' } });

      const [url, options] = fetchMock.mock.calls[0];
      expect(url).toContain('/report/All_Leads/rec-1');
      expect((options as RequestInit).method).toBe('PATCH');
    });

    test('DELETE uses DELETE method', async () => {
      const fetchMock = mockFetch({ code: 3000 });

      const client = new ZohoCreatorClient(mockConfig);
      await client.delete('/owner/App/report/All_Leads/rec-1');

      const [, options] = fetchMock.mock.calls[0];
      expect((options as RequestInit).method).toBe('DELETE');
    });

    test('throws ZohoCreatorApiError on HTTP error', async () => {
      mockFetch({ message: 'rate limited' }, { ok: false, status: 429 });

      const client = new ZohoCreatorClient(mockConfig);
      await expect(client.get('/applications')).rejects.toThrow(ZohoCreatorApiError);
      await expect(client.get('/applications')).rejects.toThrow('rate limited');
    });

    test('throws ZohoCreatorApiError on API error code >= 4000', async () => {
      mockFetch({ code: 4000, message: 'Permission denied' });

      const client = new ZohoCreatorClient(mockConfig);
      await expect(client.get('/applications')).rejects.toThrow('Permission denied');
    });
  });
});

describe('ZohoCreator', () => {
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
    mockFetch({ code: 3000, data: [] });
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  test('listApplications hits /applications', async () => {
    const zc = new ZohoCreator({ accessToken: 'tok' });
    await zc.listApplications();
    const [url] = mockedFetch().mock.calls[0];
    expect(url).toBe('https://creator.zoho.com/api/v2.1/applications');
  });

  test('getReportRecords URL-encodes account owner and report', async () => {
    const zc = new ZohoCreator({ accessToken: 'tok' });
    await zc.getReportRecords('team@example.com', 'Sales', 'All_Leads', { criteria: 'x' });
    const [url] = mockedFetch().mock.calls[0];
    expect(url).toContain('/team%40example.com/Sales/report/All_Leads');
  });

  test('fromEnv requires ZOHOCREATOR_ACCESS_TOKEN', () => {
    const prev = process.env.ZOHOCREATOR_ACCESS_TOKEN;
    delete process.env.ZOHOCREATOR_ACCESS_TOKEN;
    expect(() => ZohoCreator.fromEnv()).toThrow('ZOHOCREATOR_ACCESS_TOKEN is required');
    if (prev) process.env.ZOHOCREATOR_ACCESS_TOKEN = prev;
  });
});
