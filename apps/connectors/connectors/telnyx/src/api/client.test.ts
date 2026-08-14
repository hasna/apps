import { afterEach, describe, expect, mock, test } from 'bun:test';
import { Telnyx } from './index';
import { TelnyxApiError } from '../types';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('Telnyx client', () => {
  test('sends a Bearer token and JSON body when sending a message', async () => {
    const fetchMock = mock(async () =>
      Response.json({ data: { id: 'msg-1', to: [{ phone_number: '+15551230000' }] } })
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const telnyx = new Telnyx({ apiKey: 'KEY_test_123456' });
    await telnyx.messages.send({
      from: '+15550001111',
      to: '+15551230000',
      text: 'Hi from Telnyx',
    });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.telnyx.com/v2/messages');
    expect(init.method).toBe('POST');
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer KEY_test_123456');
    expect(headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(String(init.body))).toMatchObject({
      from: '+15550001111',
      to: '+15551230000',
      text: 'Hi from Telnyx',
    });
  });

  test('parses the Telnyx error envelope into TelnyxApiError', async () => {
    const fetchMock = mock(async () =>
      Response.json(
        {
          errors: [
            {
              code: '10015',
              title: 'Invalid API key',
              detail: 'The API key provided is not valid.',
            },
          ],
        },
        { status: 401 }
      )
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const telnyx = new Telnyx({ apiKey: 'bad-key' });

    let caught: unknown;
    try {
      await telnyx.messages.get('msg-1');
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(TelnyxApiError);
    const apiError = caught as TelnyxApiError;
    expect(apiError.status).toBe(401);
    expect(apiError.code).toBe('10015');
    expect(apiError.message).toBe('Invalid API key: The API key provided is not valid.');
    expect(apiError.isAuthError()).toBe(true);
  });

  test('builds repeated query params for array filters', async () => {
    const fetchMock = mock(async () => Response.json({ data: [] }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const telnyx = new Telnyx({ apiKey: 'KEY_test' });
    await telnyx.availableNumbers.search({ country_code: 'US', features: ['sms', 'mms'] });

    const [url] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const parsed = new URL(url);
    expect(parsed.pathname).toBe('/v2/available_phone_numbers');
    expect(parsed.searchParams.get('filter[country_code]')).toBe('US');
    expect(parsed.searchParams.getAll('filter[features]')).toEqual(['sms', 'mms']);
  });

  test('requires from or messaging_profile_id when sending', async () => {
    const telnyx = new Telnyx({ apiKey: 'KEY_test' });
    await expect(telnyx.messages.send({ to: '+15551230000', text: 'hi' })).rejects.toThrow(
      /from.*messaging_profile_id/
    );
  });
});
