import { afterEach, describe, expect, test } from 'bun:test';
import { ConnectorClient } from './client';
import { Connector } from './index';
import { ValidationApi } from './validation';
import { AccountApi } from './account';
import { BulkApi } from './bulk';
import { ZeroBounceApiError } from '../types';

const realFetch = globalThis.fetch;

interface Recorded {
  url: string;
  method: string;
  body?: string;
}

function installFetch(
  handler: (url: string, init: RequestInit | undefined, recorded: Recorded[]) => unknown,
  options?: { ok?: boolean; status?: number }
) {
  const recorded: Recorded[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const body = typeof init?.body === 'string' ? init.body : undefined;
    recorded.push({ url, method: init?.method ?? 'GET', body });
    const json = handler(url, init, recorded);
    const ok = options?.ok ?? true;
    const status = options?.status ?? (ok ? 200 : 400);
    return {
      ok,
      status,
      statusText: ok ? 'OK' : 'Bad Request',
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

describe('ZeroBounce ConnectorClient', () => {
  test('requires API key', () => {
    expect(() => new ConnectorClient({})).toThrow('ZeroBounce API key is required');
  });

  test('GET validate puts api_key in query on api.zerobounce.net', async () => {
    const recorded = installFetch(() => ({ address: 'a@b.com', status: 'valid' }));
    const client = new ConnectorClient({ apiKey: 'test-key-123' });
    const api = new ValidationApi(client);
    await api.validate({ email: 'a@b.com', ip_address: '1.2.3.4' });

    expect(recorded).toHaveLength(1);
    expect(recorded[0].url).toContain('api.zerobounce.net/v2/validate');
    expect(recorded[0].url).toContain('api_key=test-key-123');
    expect(recorded[0].url).toContain('email=a%40b.com');
    expect(recorded[0].url).toContain('ip_address=1.2.3.4');
    expect(recorded[0].method).toBe('GET');
  });

  test('validate throws when email missing', async () => {
    const client = new ConnectorClient({ apiKey: 'key' });
    const api = new ValidationApi(client);
    await expect(api.validate({ email: '' })).rejects.toThrow('email is required');
  });

  test('sandbox validation uses standard validate endpoint', async () => {
    const recorded = installFetch(() => ({ address: 'valid@example.com', status: 'valid' }));
    const client = new ConnectorClient({ apiKey: 'sandbox-key' });
    const api = new ValidationApi(client);
    await api.validateSandbox({ email: 'valid@example.com' });

    expect(recorded).toHaveLength(1);
    expect(recorded[0].url).toContain('api.zerobounce.net/v2/validate');
    expect(recorded[0].url).not.toContain('validate-sandbox');
    expect(recorded[0].url).toContain('email=valid%40example.com');
  });

  test('POST validatebatch puts api_key in JSON body and uses long HTTP timeout', async () => {
    const recorded = installFetch(() => ({ email_batch: [], errors: [] }));
    const client = new ConnectorClient({ apiKey: 'batch-key' });
    const api = new ValidationApi(client);
    await api.validateBatch({
      email_batch: [{ email_address: 'x@y.com' }],
    });

    expect(recorded[0].url).toContain('api.zerobounce.net/v2/validatebatch');
    expect(recorded[0].method).toBe('POST');
    const body = JSON.parse(recorded[0].body!);
    expect(body.api_key).toBe('batch-key');
    expect(body.email_batch).toEqual([{ email_address: 'x@y.com' }]);
    expect(body.timeout).toBe(120);
    expect(recorded[0].url).not.toContain('api_key=');
  });

  test('POST requests are not retried by default', async () => {
    const recorded = installFetch(() => ({ error: 'temporary server failure' }), {
      ok: false,
      status: 503,
    });
    const client = new ConnectorClient({ apiKey: 'batch-key' });
    const api = new ValidationApi(client);

    await expect(api.validateBatch({
      email_batch: [{ email_address: 'x@y.com' }],
    })).rejects.toBeInstanceOf(ZeroBounceApiError);
    expect(recorded).toHaveLength(1);
  });

  test('timeout errors expose configured timeout message', async () => {
    globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
      await new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('The operation was aborted', 'AbortError'));
        });
      });
      throw new Error('unreachable');
    }) as unknown as typeof fetch;

    const client = new ConnectorClient({ apiKey: 'timeout-key' });
    await expect(client.request('/v2/validate', {
      method: 'GET',
      retries: 0,
      timeout: 1,
    })).rejects.toThrow('Request timeout after 1ms');
  });

  test('validateBatch throws when email_batch empty', async () => {
    const client = new ConnectorClient({ apiKey: 'key' });
    const api = new ValidationApi(client);
    await expect(api.validateBatch({ email_batch: [] })).rejects.toThrow('email_batch is required');
  });

  test('getCredits uses api_key query param', async () => {
    const recorded = installFetch(() => ({ Credits: 100 }));
    const client = new ConnectorClient({ apiKey: 'cred-key' });
    const api = new AccountApi(client);
    const result = await api.getCredits();

    expect(result.Credits).toBe(100);
    expect(recorded[0].url).toContain('/v2/getcredits');
    expect(recorded[0].url).toContain('api_key=cred-key');
  });

  test('getApiUsage requires date range', async () => {
    const client = new ConnectorClient({ apiKey: 'key' });
    const api = new AccountApi(client);
    await expect(api.getApiUsage({ start_date: '', end_date: '' })).rejects.toThrow(
      'start_date and end_date are required'
    );
  });

  test('bulk filestatus uses bulkapi host with query api_key', async () => {
    const recorded = installFetch(() => ({ success: true, file_status: 'Complete' }));
    const client = new ConnectorClient({ apiKey: 'bulk-key' });
    const api = new BulkApi(client);
    await api.getFileStatus({ file_id: 'file-abc' });

    expect(recorded[0].url).toContain('bulkapi.zerobounce.net/v2/filestatus');
    expect(recorded[0].url).toContain('api_key=bulk-key');
    expect(recorded[0].url).toContain('file_id=file-abc');
    expect(recorded[0].method).toBe('GET');
  });

  test('sendFile posts multipart to bulkapi with api_key field', async () => {
    const recorded = installFetch(() => ({ success: true, file_id: 'new-file' }));
    const client = new ConnectorClient({ apiKey: 'upload-key' });
    const api = new BulkApi(client);
    await api.sendFile({
      file: new TextEncoder().encode('email\na@b.com'),
      fileName: 'test.csv',
      email_address_column: 1,
    });

    expect(recorded[0].url).toContain('bulkapi.zerobounce.net/v2/sendfile');
    expect(recorded[0].method).toBe('POST');
    expect(recorded[0].body).toBeUndefined();
  });

  test('parses API error responses', async () => {
    installFetch(() => ({ error: 'Invalid API Key or your account ran out of credits' }), {
      ok: false,
      status: 400,
    });
    const client = new ConnectorClient({ apiKey: 'bad-key' });
    const api = new ValidationApi(client);

    await expect(api.validate({ email: 'a@b.com' })).rejects.toBeInstanceOf(ZeroBounceApiError);
    try {
      await api.validate({ email: 'a@b.com' });
    } catch (err) {
      expect((err as ZeroBounceApiError).message).toContain('Invalid API Key');
      expect((err as ZeroBounceApiError).statusCode).toBe(400);
    }
  });

  test('Connector facade wires modules', () => {
    const connector = new Connector({ apiKey: 'facade-key-long-enough' });
    expect(connector.validation).toBeDefined();
    expect(connector.account).toBeDefined();
    expect(connector.bulk).toBeDefined();
    expect(connector.scoring).toBeDefined();
    expect(connector.enrichment).toBeDefined();
    expect(connector.getApiKeyPreview()).toMatch(/^facade/);
  });

  test('Connector.fromEnv requires ZERO_BOUNCE_API_KEY', () => {
    const prev = process.env.ZERO_BOUNCE_API_KEY;
    delete process.env.ZERO_BOUNCE_API_KEY;
    expect(() => Connector.fromEnv()).toThrow('ZERO_BOUNCE_API_KEY');
    if (prev) process.env.ZERO_BOUNCE_API_KEY = prev;
  });
});
