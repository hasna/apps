import { afterEach, describe, expect, test } from 'bun:test';
import { Zolvo, encodePathSegment } from './index';

const realFetch = globalThis.fetch;

interface Recorded {
  url: string;
  method: string;
  headers: Headers;
  body?: unknown;
}

function installFetch(): Recorded[] {
  const recorded: Recorded[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    let body: unknown;
    if (typeof init?.body === 'string') {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = init.body;
      }
    }
    recorded.push({
      url,
      method: init?.method ?? 'GET',
      headers: new Headers(init?.headers),
      body,
    });
    return {
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      async text() {
        return JSON.stringify({ ok: true, connector: 'zolvo' });
      },
    } as Response;
  }) as typeof fetch;
  return recorded;
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('ZolvoClient', () => {
  test('encodePathSegment URL-encodes path segments', () => {
    expect(encodePathSegment('loan 1')).toBe('loan%201');
    expect(encodePathSegment('pay 1')).toBe('pay%201');
  });

  test('requires API key', () => {
    expect(() => new Zolvo({ apiKey: '' })).toThrow(/API key is required/);
  });

  test('uses Bearer auth and servicing endpoints', async () => {
    const recorded = installFetch();
    const zolvo = new Zolvo({ apiKey: 'zolvo-key' });

    await zolvo.listLoans({ status: 'active' });
    await zolvo.getLoan('loan 1');
    await zolvo.listPayments({ unmatched: true });
    await zolvo.reconcilePayment('pay 1', { confidence: 0.92 });
    await zolvo.createServicingTask('loan 1', { task: 'verify invoice' });

    expect(recorded.map((r) => [r.method, r.url])).toEqual([
      ['GET', 'https://api.zolvo.com/v1/loans?status=active'],
      ['GET', 'https://api.zolvo.com/v1/loans/loan%201'],
      ['GET', 'https://api.zolvo.com/v1/payments?unmatched=true'],
      ['POST', 'https://api.zolvo.com/v1/payments/pay%201/reconcile'],
      ['POST', 'https://api.zolvo.com/v1/loans/loan%201/tasks'],
    ]);

    for (const request of recorded) {
      expect(request.headers.get('Authorization')).toBe('Bearer zolvo-key');
    }

    expect(recorded[3].body).toEqual({ confidence: 0.92 });
    expect(recorded[4].body).toEqual({ task: 'verify invoice' });
  });

  test('supports raw requests with custom path and method', async () => {
    const recorded = installFetch();
    const zolvo = new Zolvo({ apiKey: 'zolvo-key' });

    await zolvo.rawRequest({
      path: '/custom/endpoint',
      method: 'POST',
      body: { enabled: true },
    });

    expect(recorded[0].url).toBe('https://api.zolvo.com/v1/custom/endpoint');
    expect(recorded[0].method).toBe('POST');
    expect(recorded[0].body).toEqual({ enabled: true });
    expect(recorded[0].headers.get('Authorization')).toBe('Bearer zolvo-key');
  });

  test('respects custom base URL', async () => {
    const recorded = installFetch();
    const zolvo = new Zolvo({ apiKey: 'key', baseUrl: 'https://sandbox.zolvo.com/v1/' });

    await zolvo.listLoans();

    expect(recorded[0].url).toBe('https://sandbox.zolvo.com/v1/loans');
  });
});
