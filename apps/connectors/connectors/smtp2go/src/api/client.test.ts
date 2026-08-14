import { afterEach, describe, expect, test } from 'bun:test';
import { Smtp2go } from './index';
import { Smtp2goApiError } from '../types';

const realFetch = globalThis.fetch;

interface Recorded {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: unknown;
}

interface MockResponse {
  status?: number;
  json: unknown;
}

function installFetch(handler: (url: string) => MockResponse): Recorded[] {
  const recorded: Recorded[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const headers = (init?.headers as Record<string, string>) ?? {};
    recorded.push({
      url,
      method: init?.method ?? 'GET',
      headers,
      body: init?.body ? JSON.parse(init.body as string) : undefined,
    });
    const { status = 200, json } = handler(url);
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: 'OK',
      headers: { get: () => null },
      async text() {
        return JSON.stringify(json ?? {});
      },
    } as unknown as Response;
  }) as typeof fetch;
  return recorded;
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('Smtp2go v3 transport', () => {
  test('requires an api key', () => {
    expect(() => new Smtp2go({ apiKey: '' })).toThrow();
  });

  test('sendEmail POSTs /email/send with auth header and json body, unwraps envelope', async () => {
    const recorded = installFetch(() => ({
      json: { request_id: 'req-1', data: { succeeded: 1, failed: 0, failures: [], email_id: 'abc-123' } },
    }));

    const smtp = new Smtp2go({ apiKey: 'api-secret-key-1234' });
    const result = await smtp.sendEmail({
      sender: 'you@example.com',
      to: ['dest@example.com'],
      subject: 'Hi',
      text_body: 'Hello',
    });

    // Envelope is unwrapped to the data payload.
    expect(result).toEqual({ succeeded: 1, failed: 0, failures: [], email_id: 'abc-123' });

    const call = recorded[0];
    expect(call.url).toBe('https://api.smtp2go.com/v3/email/send');
    expect(call.method).toBe('POST');
    expect(call.headers['X-Smtp2go-Api-Key']).toBe('api-secret-key-1234');
    expect(call.headers['Content-Type']).toBe('application/json');

    const body = call.body as Record<string, unknown>;
    // api_key is injected into the body as a fallback.
    expect(body.api_key).toBe('api-secret-key-1234');
    expect(body.sender).toBe('you@example.com');
    expect(body.to).toEqual(['dest@example.com']);
    expect(body.subject).toBe('Hi');
    expect(body.text_body).toBe('Hello');
  });

  test('sendSimpleEmail normalizes a single recipient into an array', async () => {
    const recorded = installFetch(() => ({
      json: { request_id: 'req-2', data: { succeeded: 1, failed: 0, failures: [], email_id: 'x' } },
    }));

    const smtp = new Smtp2go({ apiKey: 'key' });
    await smtp.sendSimpleEmail({ sender: 'a@b.com', to: 'c@d.com', subject: 's', html: '<b>hi</b>' });

    const body = recorded[0].body as Record<string, unknown>;
    expect(body.to).toEqual(['c@d.com']);
    expect(body.html_body).toBe('<b>hi</b>');
  });

  test('statsSummary POSTs /stats/email_summary with the date range', async () => {
    const recorded = installFetch(() => ({ json: { request_id: 'r', data: { total: 5 } } }));

    const smtp = new Smtp2go({ apiKey: 'key' });
    const result = await smtp.statsSummary({ start_date: '2026-01-01', end_date: '2026-01-31' });

    expect(result).toEqual({ total: 5 });
    const call = recorded[0];
    expect(call.url).toBe('https://api.smtp2go.com/v3/stats/email_summary');
    const body = call.body as Record<string, unknown>;
    expect(body.start_date).toBe('2026-01-01');
    expect(body.end_date).toBe('2026-01-31');
  });

  test('honors a custom base URL', async () => {
    const recorded = installFetch(() => ({ json: { data: {} } }));
    const smtp = new Smtp2go({ apiKey: 'key', baseUrl: 'https://proxy.internal/v3/' });
    await smtp.listDomains();
    // Trailing slash is trimmed from the base URL.
    expect(recorded[0].url).toBe('https://proxy.internal/v3/domain/view');
  });

  test('parses an SMTP2GO error envelope into Smtp2goApiError', async () => {
    installFetch(() => ({
      status: 400,
      json: {
        request_id: 'req-err',
        data: { error: 'Invalid sender', error_code: 'E_ApiResponseCodes.INVALID_SENDER' },
      },
    }));

    const smtp = new Smtp2go({ apiKey: 'key' });
    let caught: unknown;
    try {
      await smtp.sendEmail({ sender: 'bad', to: ['x@y.com'], subject: 's', text_body: 't' });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(Smtp2goApiError);
    const apiError = caught as Smtp2goApiError;
    expect(apiError.statusCode).toBe(400);
    expect(apiError.message).toBe('Invalid sender');
    expect(apiError.errorCode).toBe('E_ApiResponseCodes.INVALID_SENDER');
    expect(apiError.requestId).toBe('req-err');
  });
});
