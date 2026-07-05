import { afterEach, describe, expect, test } from 'bun:test';
import { ZohoBookingsClient, encodeFormBody, resolveBookingsApiBase } from './client';
import { ZohoBookings } from './index';
import { ZohoBookingsApiError } from '../types';

const realFetch = globalThis.fetch;

function installFetch(handler: (url: string, init?: RequestInit) => unknown) {
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const payload = handler(url, init);
    const body = typeof payload === 'object' && payload !== null && 'error' in (payload as object)
      ? payload
      : { response: { returnvalue: payload, status: 'success' } };
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () => JSON.stringify(body),
    } as Response;
  }) as typeof fetch;
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('resolveBookingsApiBase', () => {
  test('defaults to zohoapis.com bookings json path', () => {
    expect(resolveBookingsApiBase()).toBe('https://www.zohoapis.com/bookings/v1/json');
  });

  test('accepts regional origin override', () => {
    expect(resolveBookingsApiBase('https://www.zohoapis.eu')).toBe(
      'https://www.zohoapis.eu/bookings/v1/json',
    );
  });

  test('accepts full bookings json base', () => {
    expect(resolveBookingsApiBase('https://www.zohoapis.com/bookings/v1/json')).toBe(
      'https://www.zohoapis.com/bookings/v1/json',
    );
  });
});

describe('encodeFormBody', () => {
  test('JSON-encodes nested objects like customer_details', () => {
    const body = encodeFormBody({
      service_id: '123',
      customer_details: { name: 'Jane', email: 'jane@example.com' },
    });
    expect(body).toContain('service_id=123');
    expect(body).toContain(
      encodeURIComponent('customer_details') +
        '=' +
        encodeURIComponent('{"name":"Jane","email":"jane@example.com"}'),
    );
  });

  test('wraps fetchappointment filters in data field', () => {
    const body = encodeFormBody({
      data: { from_time: '01-Jan-2026 00:00:00', to_time: '31-Jan-2026 23:59:59' },
    });
    expect(body).toBe(
      `${encodeURIComponent('data')}=${encodeURIComponent('{"from_time":"01-Jan-2026 00:00:00","to_time":"31-Jan-2026 23:59:59"}')}`,
    );
  });
});

describe('ZohoBookingsClient', () => {
  test('requires token', () => {
    expect(() => new ZohoBookingsClient({ token: '' })).toThrow('token is required');
  });

  test('GET builds workspace URL with query params', async () => {
    let capturedUrl = '';
    installFetch((url) => {
      capturedUrl = url;
      return { data: [{ id: '1', name: 'Main' }] };
    });

    const client = new ZohoBookingsClient({ token: 'test-token' });
    const result = await client.get<{ data: { id: string }[] }>('workspaces', {
      workspace_id: 'ws-1',
    });

    expect(capturedUrl).toBe(
      'https://www.zohoapis.com/bookings/v1/json/workspaces?workspace_id=ws-1',
    );
    expect(result.data[0]?.id).toBe('1');
  });

  test('POST sends form body with Zoho-oauthtoken header', async () => {
    let capturedInit: RequestInit | undefined;
    installFetch((_url, init) => {
      capturedInit = init;
      return { booking_id: '#NU-00001' };
    });

    const client = new ZohoBookingsClient({ token: 'oauth-token' });
    await client.post('appointment', {
      service_id: 'svc',
      customer_details: { name: 'John' },
    });

    expect(capturedInit?.method).toBe('POST');
    const headers = capturedInit?.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Zoho-oauthtoken oauth-token');
    expect(headers['Content-Type']).toBe('application/x-www-form-urlencoded');
    expect(capturedInit?.body).toContain('service_id=svc');
    expect(capturedInit?.body).toContain('customer_details');
  });

  test('bookAppointment sends time zone with Zoho snake_case field', async () => {
    let capturedInit: RequestInit | undefined;
    installFetch((_url, init) => {
      capturedInit = init;
      return { booking_id: '#NU-00001' };
    });

    const bookings = new ZohoBookings({ token: 'oauth-token' });
    await bookings.bookAppointment({
      service_id: 'svc',
      staff_id: 'staff',
      from_time: '04-Jul-2026 10:00:00',
      time_zone: 'UTC',
      customer_details: { name: 'Jane' },
    });

    expect(capturedInit?.body).toContain('time_zone=UTC');
    expect(capturedInit?.body).not.toContain('timezone=UTC');
  });

  test('throws ZohoBookingsApiError on failure envelope', async () => {
    globalThis.fetch = (async () =>
      ({
        ok: true,
        status: 200,
        statusText: 'OK',
        text: async () =>
          JSON.stringify({
            response: { status: 'failure', errormessage: 'Invalid service_id' },
          }),
      }) as Response) as unknown as typeof fetch;

    const client = new ZohoBookingsClient({ token: 't' });
    await expect(client.get('services', { workspace_id: 'x' })).rejects.toBeInstanceOf(
      ZohoBookingsApiError,
    );
  });
});
