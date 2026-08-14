import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, statSync } from 'fs';
import { rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { Tidio, TidioClient } from './index';
import {
  createProfile,
  getProfilesDir,
  loadProfile,
  saveProfile,
  setClientCredentials,
  setProfileOverride,
  validateProfileName,
} from '../utils/config';

const originalFetch = globalThis.fetch;
const originalConfigHome = process.env.TIDIO_CONFIG_HOME;

type CapturedRequest = {
  url: URL;
  method: string;
  headers: Headers;
  body?: unknown;
};

function parseBody(body: BodyInit | null | undefined): unknown {
  if (typeof body !== 'string' || body.length === 0) return undefined;
  return JSON.parse(body);
}

function installFetchMock(response?: Response) {
  const captured: CapturedRequest[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url);
    captured.push({
      url,
      method: init?.method ?? 'GET',
      headers: new Headers(init?.headers),
      body: parseBody(init?.body),
    });
    return response?.clone() ?? Response.json({ id: 'test-id' });
  }) as typeof fetch;
  return captured;
}

beforeEach(() => {
  globalThis.fetch = originalFetch;
  delete process.env.TIDIO_CLIENT_ID;
  delete process.env.TIDIO_CLIENT_SECRET;
  delete process.env.TIDIO_CONFIG_HOME;
  setProfileOverride(undefined);
});

afterEach(async () => {
  globalThis.fetch = originalFetch;
  if (originalConfigHome) {
    process.env.TIDIO_CONFIG_HOME = originalConfigHome;
  } else {
    delete process.env.TIDIO_CONFIG_HOME;
  }
  setProfileOverride(undefined);
});

describe('TidioClient', () => {
  test('requires client id and client secret', () => {
    expect(() => new TidioClient({ clientId: '', clientSecret: 'cs_test' })).toThrow('Client ID is required');
    expect(() => new TidioClient({ clientId: 'ci_test', clientSecret: '' })).toThrow('Client secret is required');
  });

  test('sends current Tidio base URL, versioned Accept header, auth headers, and query params', async () => {
    const captured = installFetchMock();
    const client = new TidioClient({ clientId: 'ci_test', clientSecret: 'cs_test' });
    await client.get('/contacts', { limit: 25, updated_after: '2026-01-01T00:00:00Z' });

    const req = captured[0]!;
    expect(req.url.origin).toBe('https://api.tidio.com');
    expect(req.url.pathname).toBe('/contacts');
    expect(req.method).toBe('GET');
    expect(req.headers.get('Accept')).toBe('application/json; version=1');
    expect(req.headers.get('X-Tidio-Openapi-Client-Id')).toBe('ci_test');
    expect(req.headers.get('X-Tidio-Openapi-Client-Secret')).toBe('cs_test');
    expect(Object.fromEntries(req.url.searchParams.entries())).toEqual({
      limit: '25',
      updated_after: '2026-01-01T00:00:00Z',
    });
  });

  test('surfaces nested Tidio API error messages', async () => {
    installFetchMock(Response.json({ errors: [{ message: 'invalid credentials' }] }, { status: 401 }));
    const tidio = new Tidio({ clientId: 'ci_test', clientSecret: 'cs_test' });
    await expect(tidio.getProject()).rejects.toThrow('invalid credentials');
  });
});

describe('Tidio documented API facade', () => {
  test('createContact uses documented contact payload shape', async () => {
    const captured = installFetchMock();
    const tidio = new Tidio({ clientId: 'ci_test', clientSecret: 'cs_test' });
    await tidio.createContact({
      email: 'ada@example.com',
      firstName: 'Ada',
      lastName: 'Lovelace',
      distinctId: 'crm-123',
      properties: [{ name: 'plan', value: 'pro' }],
      emailConsent: 'subscribed',
    });

    const req = captured[0]!;
    expect(req.url.pathname).toBe('/contacts');
    expect(req.method).toBe('POST');
    expect(req.headers.get('Content-Type')).toBe('application/json');
    expect(req.body).toEqual({
      email: 'ada@example.com',
      first_name: 'Ada',
      last_name: 'Lovelace',
      distinct_id: 'crm-123',
      properties: [{ name: 'plan', value: 'pro' }],
      email_consent: 'subscribed',
    });
  });

  test('sendContactMessage uses /contacts/{contactId}/messages with message body', async () => {
    const captured = installFetchMock(Response.json({ status: 'accepted' }, { status: 202 }));
    const tidio = new Tidio({ clientId: 'ci_test', clientSecret: 'cs_test' });
    await tidio.sendContactMessage('a1b4ca4c-1108-4432-b256-1e4cf2bf6f9e', { message: 'hello' });

    const req = captured[0]!;
    expect(req.url.pathname).toBe('/contacts/a1b4ca4c-1108-4432-b256-1e4cf2bf6f9e/messages');
    expect(req.method).toBe('POST');
    expect(req.body).toEqual({ message: 'hello' });
  });

  test('updateContact treats documented 204 response as no content', async () => {
    const captured = installFetchMock(new Response(null, { status: 204 }));
    const tidio = new Tidio({ clientId: 'ci_test', clientSecret: 'cs_test' });
    await expect(tidio.updateContact('a1b4ca4c-1108-4432-b256-1e4cf2bf6f9e', { firstName: 'Ada' })).resolves.toBeUndefined();

    const req = captured[0]!;
    expect(req.url.pathname).toBe('/contacts/a1b4ca4c-1108-4432-b256-1e4cf2bf6f9e');
    expect(req.method).toBe('PATCH');
    expect(req.body).toEqual({ first_name: 'Ada' });
  });

  test('listContactMessages uses documented cursor pagination only', async () => {
    const captured = installFetchMock();
    const tidio = new Tidio({ clientId: 'ci_test', clientSecret: 'cs_test' });
    await tidio.listContactMessages('a1b4ca4c-1108-4432-b256-1e4cf2bf6f9e', { cursor: 'next' });

    const req = captured[0]!;
    expect(req.url.pathname).toBe('/contacts/a1b4ca4c-1108-4432-b256-1e4cf2bf6f9e/messages');
    expect(Object.fromEntries(req.url.searchParams.entries())).toEqual({ cursor: 'next' });
  });

  test('project, tickets, products, and Lyro helpers use documented paths', async () => {
    const captured = installFetchMock();
    const tidio = new Tidio({ clientId: 'ci_test', clientSecret: 'cs_test' });
    await tidio.getProject();
    await tidio.getTicket('ticket-1');
    await tidio.upsertProducts([
      {
        id: 1,
        title: 'Red shirt',
        url: 'https://example.com/red-shirt',
        default_currency: 'USD',
        updated_at: '2026-01-01T00:00:00+00:00',
      },
    ]);
    await tidio.listLyroDataSources({ kind: 'qa', cursor: 'next' });
    await tidio.askLyroToAnswerTicket({
      ticketId: '01H6XZJ88T5PMRRQC3C54WY1EJ',
      subject: 'Question about delivery',
      contactEmail: 'user@example.com',
      contactName: 'Ada Lovelace',
      recipientEmail: 'support@example.com',
      messages: [
        {
          created_at: '2026-01-01T00:00:00+00:00',
          message_id: '01JVRXTTZ4ACV3JZTQS8ZVKASK',
          author_type: 'contact',
          message_type: 'public',
          message_content: 'Can you ship to the USA?',
        },
      ],
    });

    expect(captured.map(req => `${req.method} ${req.url.pathname}`)).toEqual([
      'GET /project',
      'GET /tickets/ticket-1',
      'PUT /products/batch',
      'GET /lyro/data-sources',
      'POST /lyro/tickets',
    ]);
    expect(captured[3]!.url.searchParams.get('kind')).toBe('qa');
    expect(captured[3]!.url.searchParams.get('cursor')).toBe('next');
    expect(captured[4]!.body).toEqual({
      ticket_id: '01H6XZJ88T5PMRRQC3C54WY1EJ',
      subject: 'Question about delivery',
      contact_email: 'user@example.com',
      contact_name: 'Ada Lovelace',
      recipient_email: 'support@example.com',
      messages: [
        {
          created_at: '2026-01-01T00:00:00+00:00',
          message_id: '01JVRXTTZ4ACV3JZTQS8ZVKASK',
          author_type: 'contact',
          message_type: 'public',
          message_content: 'Can you ship to the USA?',
        },
      ],
    });
  });
});

describe('Tidio.fromEnv', () => {
  test('requires both TIDIO_CLIENT_ID and TIDIO_CLIENT_SECRET', () => {
    process.env.TIDIO_CLIENT_ID = 'ci_test';
    expect(() => Tidio.fromEnv()).toThrow('TIDIO_CLIENT_ID and TIDIO_CLIENT_SECRET environment variables are required');
  });
});

describe('secure profile storage', () => {
  test('validates profile names before path joins', () => {
    expect(() => validateProfileName('../escape')).toThrow('Profile name can only contain');
    expect(() => createProfile('../escape')).toThrow('Profile name can only contain');
  });

  test('writes config directories as 0700 and profile files as 0600', async () => {
    const home = mkdtempSync(join(tmpdir(), 'tidio-config-'));
    process.env.TIDIO_CONFIG_HOME = home;
    createProfile('default');
    setClientCredentials('ci_test', 'cs_test');
    saveProfile({ clientId: 'ci_other', clientSecret: 'cs_other' }, 'work');

    expect((statSync(home).mode & 0o777).toString(8)).toBe('700');
    expect((statSync(getProfilesDir()).mode & 0o777).toString(8)).toBe('700');
    expect((statSync(join(getProfilesDir(), 'default.json')).mode & 0o777).toString(8)).toBe('600');
    expect((statSync(join(getProfilesDir(), 'work.json')).mode & 0o777).toString(8)).toBe('600');
    expect(loadProfile('work')).toEqual({ clientId: 'ci_other', clientSecret: 'cs_other' });

    await rm(home, { recursive: true, force: true });
  });
});
