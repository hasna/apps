import { afterEach, describe, expect, test } from 'bun:test';
import { Connector } from './index';
import { ConnectorClient, encodeFormData } from './client';
import { ConnectorApiError } from '../types';

const realFetch = globalThis.fetch;

interface Recorded {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

function installFetch(
  handler: (url: string) => { status?: number; json?: unknown },
): Recorded[] {
  const recorded: Recorded[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    recorded.push({
      url,
      method: init?.method ?? 'GET',
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: init?.body as string | undefined,
    });
    const { status = 200, json = {} } = handler(url);
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: 'OK',
      headers: { get: () => 'application/json' },
      async text() {
        return JSON.stringify(json);
      },
    } as unknown as Response;
  }) as typeof fetch;
  return recorded;
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('encodeFormData', () => {
  test('encodes nested objects with bracket notation', () => {
    const encoded = encodeFormData({
      report_type: 'balance.summary.1',
      parameters: { currency: 'usd', interval_start: 1600000000 },
    });
    expect(encoded).toContain('report_type=balance.summary.1');
    expect(encoded).toContain('parameters%5Bcurrency%5D=usd');
    expect(encoded).toContain('parameters%5Binterval_start%5D=1600000000');
  });

  test('encodes arrays with indexed bracket notation', () => {
    const encoded = encodeFormData({ parameters: { columns: ['net', 'fee'] } });
    expect(encoded).toContain('parameters%5Bcolumns%5D%5B0%5D=net');
    expect(encoded).toContain('parameters%5Bcolumns%5D%5B1%5D=fee');
  });

  test('omits undefined and null values', () => {
    const encoded = encodeFormData({ a: undefined, b: null, c: 'keep' });
    expect(encoded).toBe('c=keep');
  });
});

describe('ConnectorClient auth', () => {
  test('throws when API key is missing', () => {
    expect(() => new ConnectorClient({ apiKey: '' })).toThrow('API key is required');
  });

  test('sends Bearer auth and Stripe-Version headers', async () => {
    const recorded = installFetch(() => ({ json: { object: 'list', data: [] } }));
    const connector = new Connector({ apiKey: 'sk_test_123' });
    await connector.reportTypes.list();

    expect(recorded[0].method).toBe('GET');
    expect(recorded[0].url).toContain('/v1/reporting/report_types');
    expect(recorded[0].headers['Authorization']).toBe('Bearer sk_test_123');
    expect(recorded[0].headers['Stripe-Version']).toBeDefined();
  });

  test('getApiKeyPreview masks the key', () => {
    const connector = new Connector({ apiKey: 'sk_test_abcdef1234' });
    const preview = connector.getApiKeyPreview();
    expect(preview).toContain('...');
    expect(preview).not.toBe('sk_test_abcdef1234');
  });
});

describe('ReportRunsApi', () => {
  test('create posts form-encoded parameters to /reporting/report_runs', async () => {
    const recorded = installFetch(() => ({
      json: { id: 'frr_1', object: 'reporting.report_run', status: 'pending' },
    }));
    const connector = new Connector({ apiKey: 'sk_test_123' });
    const run = await connector.reportRuns.create({
      report_type: 'balance.summary.1',
      parameters: {
        interval_start: 1600000000,
        interval_end: 1600100000,
        columns: ['net', 'fee'],
      },
    });

    expect(run.id).toBe('frr_1');
    expect(recorded[0].method).toBe('POST');
    expect(recorded[0].url).toContain('/v1/reporting/report_runs');
    expect(recorded[0].headers['Content-Type']).toBe('application/x-www-form-urlencoded');
    expect(recorded[0].body).toContain('report_type=balance.summary.1');
    expect(recorded[0].body).toContain('parameters%5Binterval_start%5D=1600000000');
    expect(recorded[0].body).toContain('parameters%5Bcolumns%5D%5B0%5D=net');
  });

  test('get retrieves a report run by ID', async () => {
    const recorded = installFetch(() => ({
      json: { id: 'frr_9', object: 'reporting.report_run', status: 'succeeded' },
    }));
    const connector = new Connector({ apiKey: 'sk_test_123' });
    const run = await connector.reportRuns.get('frr_9');

    expect(run.status).toBe('succeeded');
    expect(recorded[0].url).toContain('/v1/reporting/report_runs/frr_9');
  });
});

describe('error handling', () => {
  test('throws ConnectorApiError with Stripe error message', async () => {
    installFetch(() => ({
      status: 400,
      json: { error: { message: 'No such report_type', type: 'invalid_request_error' } },
    }));
    const connector = new Connector({ apiKey: 'sk_test_123' });

    await expect(connector.reportTypes.get('bogus')).rejects.toThrow(ConnectorApiError);
    await expect(connector.reportTypes.get('bogus')).rejects.toThrow('No such report_type');
  });
});
