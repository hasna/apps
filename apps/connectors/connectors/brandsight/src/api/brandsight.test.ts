import { describe, test, expect, mock, beforeEach } from 'bun:test';
import { ConnectorClient } from './client';
import { MonitoringApi } from './monitoring';
import { IntelligenceApi } from './intelligence';
import { Connector } from './index';
import { ConnectorApiError } from '../types';

// ============================================
// Client Tests
// ============================================

describe('ConnectorClient', () => {
  test('requires apiKey', () => {
    expect(() => new ConnectorClient({ apiKey: '' })).toThrow('API key is required');
  });

  test('creates client with valid config', () => {
    const client = new ConnectorClient({ apiKey: 'test-key-1234567890' });
    expect(client).toBeDefined();
    expect(client.getApiKeyPreview()).toBe('test-k...7890');
  });

  test('builds correct URL', () => {
    const client = new ConnectorClient({ apiKey: 'key' });
    const url = client.buildUrl('/brands/acme/monitor');
    expect(url).toBe('https://api.brandsight.com/v1/brands/acme/monitor');
  });

  test('getApiKeyPreview masks key', () => {
    const client = new ConnectorClient({ apiKey: 'abcdef1234567890' });
    expect(client.getApiKeyPreview()).toBe('abcdef...7890');
  });

  test('getApiKeyPreview returns *** for short key', () => {
    const client = new ConnectorClient({ apiKey: '1234567890' });
    expect(client.getApiKeyPreview()).toBe('***');
  });

  test('request returns stub when API unreachable', async () => {
    const client = new ConnectorClient({ apiKey: 'test-key-12345' });

    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(() =>
      Promise.reject(new Error('Network error'))
    ) as any;

    const result = await client.request('/brands/test/monitor');
    expect(result.stub).toBe(true);
    expect(result.data).toBeNull();

    globalThis.fetch = originalFetch;
  });

  test('request throws ConnectorApiError on HTTP error', async () => {
    const client = new ConnectorClient({ apiKey: 'test-key-12345' });

    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response('Unauthorized', { status: 401, statusText: 'Unauthorized' }))
    ) as any;

    await expect(client.request('/brands/test/monitor')).rejects.toThrow('Brandsight API GET');

    globalThis.fetch = originalFetch;
  });

  test('request returns parsed JSON on success', async () => {
    const client = new ConnectorClient({ apiKey: 'test-key-12345' });
    const mockData = { alerts: [{ domain: 'test.com', type: 'typosquat', registered_at: '2024-01-01' }] };

    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response(JSON.stringify(mockData), { status: 200 }))
    ) as any;

    const result = await client.request('/brands/test/monitor');
    expect(result.stub).toBe(false);
    expect(result.data).toEqual(mockData);

    globalThis.fetch = originalFetch;
  });
});

// ============================================
// Connector Tests
// ============================================

describe('Connector', () => {
  test('creates connector with valid config', () => {
    const connector = new Connector({ apiKey: 'key' });
    expect(connector.monitoring).toBeDefined();
    expect(connector.intelligence).toBeDefined();
  });

  test('fromEnv throws without BRANDSIGHT_API_KEY', () => {
    const origKey = process.env.BRANDSIGHT_API_KEY;
    delete process.env.BRANDSIGHT_API_KEY;

    expect(() => Connector.fromEnv()).toThrow('BRANDSIGHT_API_KEY environment variable is required');

    if (origKey) process.env.BRANDSIGHT_API_KEY = origKey;
  });

  test('fromEnv creates connector with env var', () => {
    const origKey = process.env.BRANDSIGHT_API_KEY;
    process.env.BRANDSIGHT_API_KEY = 'test-key-12345';

    const connector = Connector.fromEnv();
    expect(connector).toBeDefined();
    expect(connector.getApiKeyPreview()).toBe('test-k...2345');

    if (origKey) process.env.BRANDSIGHT_API_KEY = origKey; else delete process.env.BRANDSIGHT_API_KEY;
  });

  test('getClient returns the underlying client', () => {
    const connector = new Connector({ apiKey: 'key' });
    const client = connector.getClient();
    expect(client).toBeInstanceOf(ConnectorClient);
  });
});

// ============================================
// MonitoringApi Tests
// ============================================

describe('MonitoringApi', () => {
  let client: ConnectorClient;
  let monitoringApi: MonitoringApi;

  beforeEach(() => {
    client = new ConnectorClient({ apiKey: 'test-key-12345' });
    monitoringApi = new MonitoringApi(client);
  });

  test('monitorBrand returns live data on success', async () => {
    const mockResponse = {
      alerts: [
        { domain: 'acme-deals.com', type: 'keyword', registered_at: '2024-01-01T00:00:00Z' },
      ],
    };

    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response(JSON.stringify(mockResponse), { status: 200 }))
    ) as any;

    const result = await monitoringApi.monitorBrand('acme');
    expect(result.brand).toBe('acme');
    expect(result.stub).toBe(false);
    expect(result.alerts).toHaveLength(1);
    expect(result.alerts[0].domain).toBe('acme-deals.com');
    expect(result.alerts[0].type).toBe('keyword');

    globalThis.fetch = originalFetch;
  });

  test('monitorBrand returns stub data when API unreachable', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(() =>
      Promise.reject(new Error('Network error'))
    ) as any;

    const result = await monitoringApi.monitorBrand('acme');
    expect(result.brand).toBe('acme');
    expect(result.stub).toBe(true);
    expect(result.alerts.length).toBeGreaterThan(0);
    // Stub alerts should reference the brand name
    expect(result.alerts[0].domain).toContain('acme');

    globalThis.fetch = originalFetch;
  });

  test('getSimilarDomains returns live data on success', async () => {
    const mockResponse = {
      similar: ['acme-online.com', 'acmes.com', '4cm3.com'],
    };

    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response(JSON.stringify(mockResponse), { status: 200 }))
    ) as any;

    const result = await monitoringApi.getSimilarDomains('acme.com');
    expect(result.domain).toBe('acme.com');
    expect(result.stub).toBe(false);
    expect(result.similar).toHaveLength(3);
    expect(result.similar).toContain('acme-online.com');

    globalThis.fetch = originalFetch;
  });

  test('getSimilarDomains returns stub data when API unreachable', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(() =>
      Promise.reject(new Error('Network error'))
    ) as any;

    const result = await monitoringApi.getSimilarDomains('acme.com');
    expect(result.domain).toBe('acme.com');
    expect(result.stub).toBe(true);
    expect(result.similar.length).toBeGreaterThan(0);

    globalThis.fetch = originalFetch;
  });
});

// ============================================
// IntelligenceApi Tests
// ============================================

describe('IntelligenceApi', () => {
  let client: ConnectorClient;
  let intelligenceApi: IntelligenceApi;

  beforeEach(() => {
    client = new ConnectorClient({ apiKey: 'test-key-12345' });
    intelligenceApi = new IntelligenceApi(client);
  });

  test('getWhoisHistory returns live data on success', async () => {
    const mockResponse = {
      history: [
        { registrant: 'Acme Inc', date: '2024-01-01T00:00:00Z', changes: ['initial_registration'] },
      ],
    };

    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response(JSON.stringify(mockResponse), { status: 200 }))
    ) as any;

    const result = await intelligenceApi.getWhoisHistory('acme.com');
    expect(result.domain).toBe('acme.com');
    expect(result.stub).toBe(false);
    expect(result.history).toHaveLength(1);
    expect(result.history[0].registrant).toBe('Acme Inc');

    globalThis.fetch = originalFetch;
  });

  test('getWhoisHistory returns stub data when API unreachable', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(() =>
      Promise.reject(new Error('Network error'))
    ) as any;

    const result = await intelligenceApi.getWhoisHistory('acme.com');
    expect(result.domain).toBe('acme.com');
    expect(result.stub).toBe(true);
    expect(result.history.length).toBeGreaterThan(0);
    expect(result.history[0].registrant).toBe('Privacy Proxy Service');

    globalThis.fetch = originalFetch;
  });

  test('getThreatAssessment returns live data on success', async () => {
    const mockResponse = {
      domain: 'suspicious.com',
      risk_level: 'high',
      threats: ['phishing', 'malware'],
      recommendation: 'Take down immediately',
    };

    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response(JSON.stringify(mockResponse), { status: 200 }))
    ) as any;

    const result = await intelligenceApi.getThreatAssessment('suspicious.com');
    expect(result.domain).toBe('suspicious.com');
    expect(result.stub).toBe(false);
    expect(result.risk_level).toBe('high');
    expect(result.threats).toContain('phishing');
    expect(result.recommendation).toBe('Take down immediately');

    globalThis.fetch = originalFetch;
  });

  test('getThreatAssessment returns stub data when API unreachable', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(() =>
      Promise.reject(new Error('Network error'))
    ) as any;

    const result = await intelligenceApi.getThreatAssessment('acme.com');
    expect(result.domain).toBe('acme.com');
    expect(result.stub).toBe(true);
    expect(result.risk_level).toBe('low');
    expect(result.threats).toHaveLength(0);
    expect(result.recommendation).toContain('No immediate threats');

    globalThis.fetch = originalFetch;
  });

  test('getThreatAssessment throws on HTTP 500', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response('Internal Server Error', { status: 500, statusText: 'Internal Server Error' }))
    ) as any;

    await expect(intelligenceApi.getThreatAssessment('acme.com')).rejects.toThrow('Brandsight API GET');

    globalThis.fetch = originalFetch;
  });
});

// ============================================
// ConnectorApiError Tests
// ============================================

describe('ConnectorApiError', () => {
  test('creates error with message and status code', () => {
    const err = new ConnectorApiError('test error', 500);
    expect(err.message).toBe('test error');
    expect(err.statusCode).toBe(500);
    expect(err.name).toBe('ConnectorApiError');
  });

  test('creates error with response body', () => {
    const err = new ConnectorApiError('unauthorized', 401, '{"error":"invalid_key"}');
    expect(err.responseBody).toBe('{"error":"invalid_key"}');
    expect(err.statusCode).toBe(401);
  });
});
