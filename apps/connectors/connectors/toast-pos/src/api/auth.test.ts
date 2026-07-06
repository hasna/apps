import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test';
import { loginWithMachineClient, AUTH_LOGIN_PATH } from './auth';
import { ToastClient } from './client';
import { clearAuthToken } from '../utils/config';

describe('Toast auth', () => {
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
    clearAuthToken();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  test('login sends machine client credentials JSON body', async () => {
    let capturedUrl = '';
    let capturedOptions: RequestInit | undefined;

    const fetchMock = mock((url: string | URL | Request, init?: RequestInit) => {
      capturedUrl = String(url);
      capturedOptions = init;
      return Promise.resolve({
        ok: true,
        status: 200,
        text: () =>
          Promise.resolve(
            JSON.stringify({
              token: {
                tokenType: 'Bearer',
                expiresIn: 3600,
                accessToken: 'test-access-token',
              },
              status: 'SUCCESS',
            }),
          ),
      } as Response);
    });

    global.fetch = fetchMock as unknown as typeof fetch;

    const token = await loginWithMachineClient({
      clientId: 'client-id',
      clientSecret: 'client-secret',
      baseUrl: 'https://example.toast.test',
    });

    expect(token.accessToken).toBe('test-access-token');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(capturedUrl).toBe(`https://example.toast.test${AUTH_LOGIN_PATH}`);
    expect(capturedOptions?.method).toBe('POST');
    expect(capturedOptions?.headers).toMatchObject({
      'Content-Type': 'application/json',
    });
    expect(JSON.parse(String(capturedOptions?.body))).toEqual({
      clientId: 'client-id',
      clientSecret: 'client-secret',
      userAccessType: 'TOAST_MACHINE_CLIENT',
    });
  });
});

describe('ToastClient', () => {
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
    clearAuthToken();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  test('GET requests include Toast-Restaurant-External-ID header', async () => {
    let callCount = 0;
    const fetchMock = mock((url: string | URL | Request, init?: RequestInit) => {
      callCount += 1;
      const requestUrl = String(url);

      if (requestUrl.endsWith(AUTH_LOGIN_PATH)) {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: () =>
            Promise.resolve(
              JSON.stringify({
                token: { accessToken: 'token-123', expiresIn: 3600, tokenType: 'Bearer' },
                status: 'SUCCESS',
              }),
            ),
        } as Response);
      }

      expect(init?.headers).toMatchObject({
        Authorization: 'Bearer token-123',
        'Toast-Restaurant-External-ID': 'restaurant-guid-1',
      });

      return Promise.resolve({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: () => Promise.resolve(JSON.stringify({ menus: [] })),
      } as Response);
    });

    global.fetch = fetchMock as unknown as typeof fetch;

    const client = new ToastClient({
      clientId: 'client-id',
      clientSecret: 'client-secret',
      restaurantExternalId: 'restaurant-guid-1',
      baseUrl: 'https://example.toast.test',
    });

    const result = await client.get('/menus/v3/menus');
    expect(result).toEqual({ menus: [] });
    expect(callCount).toBe(2);
  });
});
