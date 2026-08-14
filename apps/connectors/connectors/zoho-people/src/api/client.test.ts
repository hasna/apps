import { afterEach, describe, expect, test } from 'bun:test';
import { ZohoPeople, ZohoPeopleClient } from './index';
import { ZohoPeopleApiError } from '../types';

const realFetch = globalThis.fetch;

interface CapturedRequest {
  url: URL;
  method: string;
  headers: Headers;
  body?: string;
}

function installFetchMock(response?: Response) {
  const captured: CapturedRequest[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url,
    );
    captured.push({
      url,
      method: init?.method ?? 'GET',
      headers: new Headers(init?.headers),
      body: typeof init?.body === 'string' ? init.body : undefined,
    });
    if (response) return response.clone();
    return Response.json({ response: { status: 0 }, result: [] });
  }) as typeof fetch;
  return captured;
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('ZohoPeopleClient', () => {
  test('listEmployees uses /people/api/forms/employee/getRecords with Zoho-oauthtoken auth', async () => {
    const captured = installFetchMock();
    const zp = new ZohoPeople({ token: ' zp-tok ', dataCenter: 'com' });
    await zp.listEmployees();
    const req = captured[0]!;
    expect(req.url.origin).toBe('https://people.zoho.com');
    expect(req.url.pathname).toBe('/people/api/forms/employee/getRecords');
    expect(req.headers.get('Authorization')).toBe('Zoho-oauthtoken zp-tok');
  });

  test('getEmployee forwards recordId query', async () => {
    const captured = installFetchMock();
    const zp = new ZohoPeople({ token: 'tok', dataCenter: 'com' });
    await zp.getEmployee('emp-123');
    expect(captured[0]!.url.searchParams.get('recordId')).toBe('emp-123');
  });

  test('addEmployee POSTs urlencoded body with serialized inputData', async () => {
    const captured = installFetchMock();
    const zp = new ZohoPeople({ token: 'tok', dataCenter: 'com' });
    await zp.addEmployee({
      FirstName: 'Ada',
      LastName: 'Lovelace',
      EmailID: 'ada@example.com',
    });
    const req = captured[0]!;
    expect(req.method).toBe('POST');
    expect(req.url.pathname).toBe('/people/api/forms/employee/insertRecord');
    expect(req.headers.get('Content-Type')).toBe('application/x-www-form-urlencoded');
    const body = new URLSearchParams(req.body ?? '');
    expect(JSON.parse(body.get('inputData') ?? '{}')).toEqual({
      FirstName: 'Ada',
      LastName: 'Lovelace',
      EmailID: 'ada@example.com',
    });
  });

  test('addBulkPunch POSTs serialized data array', async () => {
    const captured = installFetchMock();
    const zp = new ZohoPeople({ token: 'tok', dataCenter: 'com' });
    await zp.addBulkPunch([{ empId: '1', checkIn: '2026-05-15 09:00:00' }]);
    const body = new URLSearchParams(captured[0]!.body ?? '');
    expect(JSON.parse(body.get('data') ?? '[]')).toEqual([
      { empId: '1', checkIn: '2026-05-15 09:00:00' },
    ]);
  });

  test('EU data center routes to people.zoho.eu', async () => {
    const captured = installFetchMock();
    const zp = new ZohoPeople({ token: 'tok', dataCenter: 'eu' });
    await zp.listEmployees();
    expect(captured[0]!.url.origin).toBe('https://people.zoho.eu');
  });

  test('missing token surfaces configuration error', () => {
    expect(() => new ZohoPeopleClient({ token: '' })).toThrow('Zoho People token is required');
  });

  test('response.status === 1 surfaces as error', async () => {
    installFetchMock(Response.json({ response: { status: 1, message: 'Invalid request' } }));
    const zp = new ZohoPeople({ token: 'tok', dataCenter: 'com' });
    await expect(zp.listEmployees()).rejects.toThrow('Invalid request');
  });

  test('non-2xx responses surface API message', async () => {
    installFetchMock(Response.json({ response: { message: 'rate limited' } }, { status: 429 }));
    const zp = new ZohoPeople({ token: 'tok', dataCenter: 'com' });
    await expect(zp.listEmployees()).rejects.toThrow('rate limited');
  });

  test('invalid data center is rejected', () => {
    expect(() => new ZohoPeopleClient({ token: 'tok', dataCenter: 'invalid' })).toThrow(
      ZohoPeopleApiError,
    );
  });
});
