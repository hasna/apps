import { afterEach, describe, expect, test } from 'bun:test';
import { ConnectorClient } from './client';
import { ConnectorApiError } from '../types';

const realFetch = globalThis.fetch;

interface Recorded {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

function installFetch(handler: (recorded: Recorded) => unknown) {
  const recorded: Recorded[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const headers: Record<string, string> = {};
    if (init?.headers) {
      const h = init.headers;
      if (h instanceof Headers) {
        h.forEach((v, k) => { headers[k] = v; });
      } else if (Array.isArray(h)) {
        h.forEach(([k, v]) => { headers[k] = v; });
      } else {
        Object.assign(headers, h);
      }
    }
    const body = typeof init?.body === 'string' ? init.body : undefined;
    const entry: Recorded = { url, method: init?.method ?? 'GET', headers, body };
    recorded.push(entry);
    const json = handler(entry);
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

describe('ConnectorClient', () => {
  test('requires API key', () => {
    expect(() => new ConnectorClient({})).toThrow('2Captcha API key is required');
  });

  test('POST includes clientKey, Content-Type application/json, and correct URL', async () => {
    const recorded = installFetch(() => ({ errorId: 0, balance: 10.5 }));
    const client = new ConnectorClient({ apiKey: 'test-api-key-12345' });
    const result = await client.post<{ errorId: number; balance?: number }>('/getBalance');
    expect(result).toEqual({ errorId: 0, balance: 10.5 });
    expect(recorded).toHaveLength(1);
    expect(recorded[0].url).toBe('https://api.2captcha.com/getBalance');
    expect(recorded[0].method).toBe('POST');
    expect(recorded[0].headers['Content-Type']).toBe('application/json');
    const body = JSON.parse(recorded[0].body!);
    expect(body.clientKey).toBe('test-api-key-12345');
  });

  test('createTask forwards task payload with clientKey', async () => {
    const recorded = installFetch(() => ({ errorId: 0, taskId: 42 }));
    const client = new ConnectorClient({ apiKey: 'key-abc' });
    await client.post('/createTask', {
      task: { type: 'RecaptchaV2TaskProxyless', websiteURL: 'https://example.com', websiteKey: 'site-key' },
    });
    const body = JSON.parse(recorded[0].body!);
    expect(body.clientKey).toBe('key-abc');
    expect(body.task.type).toBe('RecaptchaV2TaskProxyless');
    expect(body.task.websiteURL).toBe('https://example.com');
  });

  test('throws ConnectorApiError when errorId is non-zero', async () => {
    installFetch(() => ({
      errorId: 1,
      errorCode: 'ERROR_WRONG_USER_KEY',
      errorDescription: 'Invalid API key',
    }));
    const client = new ConnectorClient({ apiKey: 'bad-key' });
    await expect(client.post('/getBalance')).rejects.toThrow(ConnectorApiError);
    await expect(client.post('/getBalance')).rejects.toThrow('Invalid API key');
  });

  test('parses HTTP error responses', async () => {
    globalThis.fetch = (async () => ({
      ok: false,
      status: 400,
      headers: new Headers({ 'content-type': 'application/json' }),
      async text() {
        return JSON.stringify({ message: 'Bad request' });
      },
    } as Response)) as unknown as typeof fetch;
    const client = new ConnectorClient({ apiKey: 'key' });
    await expect(client.post('/getBalance')).rejects.toThrow(ConnectorApiError);
  });
});
