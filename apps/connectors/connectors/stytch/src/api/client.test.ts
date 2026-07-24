import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test';
import { StytchClient, ENV_BASES } from './client';
import { StytchApiError } from '../types';

describe('StytchClient', () => {
  const liveConfig = {
    projectId: 'project-live-test-1234',
    secret: 'secret-live-abcdefghijklmnop',
    environment: 'live' as const,
  };

  const testConfig = {
    projectId: 'project-test-test-5678',
    secret: 'secret-test-qrstuvwxyz123456',
    environment: 'test' as const,
  };

  describe('constructor', () => {
    test('throws when projectId is missing', () => {
      expect(() => new StytchClient({ projectId: '', secret: 'secret' })).toThrow('Stytch projectId and secret are required');
    });

    test('throws when secret is missing', () => {
      expect(() => new StytchClient({ projectId: 'project-id', secret: '' })).toThrow('Stytch projectId and secret are required');
    });

    test('throws for invalid environment', () => {
      expect(() => new StytchClient({ projectId: 'p', secret: 's', environment: 'staging' as 'live' })).toThrow('Stytch environment must be one of');
    });

    test('uses live base URL by default', () => {
      const client = new StytchClient({ projectId: 'p', secret: 's' });
      expect(client.baseUrl).toBe(`${ENV_BASES.live}/v1`);
      expect(client.getEnvironment()).toBe('live');
    });

    test('uses test base URL when environment is test', () => {
      const client = new StytchClient(testConfig);
      expect(client.baseUrl).toBe(`${ENV_BASES.test}/v1`);
      expect(client.getEnvironment()).toBe('test');
    });
  });

  describe('getAuthHeader', () => {
    test('returns Basic auth with projectId:secret', () => {
      const client = new StytchClient(liveConfig);
      const expected = `Basic ${Buffer.from(`${liveConfig.projectId}:${liveConfig.secret}`).toString('base64')}`;
      expect(client.getAuthHeader()).toBe(expected);
    });
  });

  describe('request', () => {
    let client: StytchClient;
    let originalFetch: typeof global.fetch;

    beforeEach(() => {
      client = new StytchClient(liveConfig);
      originalFetch = global.fetch;
    });

    afterEach(() => {
      global.fetch = originalFetch;
    });

    test('get() sends Basic Authorization header', async () => {
      const mockResponse = { user: { user_id: 'user-1' } };
      const fetchMock = mock(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          text: () => Promise.resolve(JSON.stringify(mockResponse)),
        } as Response),
      );
      global.fetch = fetchMock as unknown as typeof fetch;

      const result = await client.get('/users/user-1');

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, options] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
      expect(url).toBe('https://api.stytch.com/v1/users/user-1');
      expect(options.method).toBe('GET');
      expect((options.headers as Record<string, string>).Authorization).toBe(client.getAuthHeader());
      expect(result).toEqual(mockResponse);
    });

    test('post() sends JSON body', async () => {
      const mockResponse = { user_id: 'user-new' };
      const fetchMock = mock(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          text: () => Promise.resolve(JSON.stringify(mockResponse)),
        } as Response),
      );
      global.fetch = fetchMock as unknown as typeof fetch;

      const body = { email: 'test@example.com' };
      const result = await client.post('/users', body);

      const [, options] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
      expect(options.method).toBe('POST');
      expect((options.headers as Record<string, string>)['Content-Type']).toBe('application/json');
      expect(options.body).toBe(JSON.stringify(body));
      expect(result).toEqual(mockResponse);
    });

    test('throws StytchApiError with error_message and error_type', async () => {
      global.fetch = mock(() =>
        Promise.resolve({
          ok: false,
          status: 400,
          statusText: 'Bad Request',
          text: () =>
            Promise.resolve(
              JSON.stringify({
                error_message: 'Invalid email address',
                error_type: 'invalid_email',
                request_id: 'req-123',
              }),
            ),
        } as Response),
      ) as unknown as typeof fetch;

      try {
        await client.post('/users', { email: 'bad' });
        expect.unreachable('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(StytchApiError);
        const apiErr = err as StytchApiError;
        expect(apiErr.message).toBe('Invalid email address');
        expect(apiErr.statusCode).toBe(400);
        expect(apiErr.errorType).toBe('invalid_email');
        expect(apiErr.requestId).toBe('req-123');
      }
    });
  });
});
