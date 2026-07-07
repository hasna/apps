import { describe, test, expect, afterEach } from 'bun:test';
import { TicketTailorClient } from './client';

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('TicketTailorClient', () => {
  test('throws when API key is missing', () => {
    expect(() => new TicketTailorClient({ apiKey: '' })).toThrow('API key is required');
  });

  test('forms Basic auth header from API key only', () => {
    const client = new TicketTailorClient({ apiKey: 'test-api-key' });
    expect(client.getAuthHeader()).toBe(`Basic ${Buffer.from('test-api-key').toString('base64')}`);
  });

  test('ping sends Basic auth to /ping', async () => {
    let capturedAuth = '';
    globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
      capturedAuth = (init?.headers as Record<string, string>)?.Authorization ?? '';
      return {
        ok: true,
        status: 200,
        async json() {
          return { version: 'pong' };
        },
      } as Response;
    }) as typeof fetch;

    const client = new TicketTailorClient({ apiKey: 'my-key' });
    const result = await client.ping();
    expect(result).toEqual({ version: 'pong' });
    expect(capturedAuth).toBe(`Basic ${Buffer.from('my-key').toString('base64')}`);
  });

  test('getEvent encodes event id in path', async () => {
    let capturedUrl = '';
    globalThis.fetch = (async (input: string | URL | Request) => {
      capturedUrl = typeof input === 'string' ? input : input.toString();
      return {
        ok: true,
        status: 200,
        async json() {
          return { id: 'ev_123' };
        },
      } as Response;
    }) as typeof fetch;

    const client = new TicketTailorClient({ apiKey: 'key' });
    await client.getEvent('ev_123');
    expect(capturedUrl).toContain('/events/ev_123');
  });
});
