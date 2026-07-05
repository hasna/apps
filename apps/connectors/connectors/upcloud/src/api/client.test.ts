import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test';
import { UpCloudClient } from './client';
import { UpCloudApiError } from '../types';

describe('UpCloudClient', () => {
  const mockConfig = {
    apiKey: 'testuser99',
    apiSecret: 'testpass123',
  };

  describe('constructor', () => {
    test('throws error when username is missing', () => {
      expect(() => new UpCloudClient({ apiKey: '', apiSecret: 'pass' })).toThrow('API username and password are required');
    });

    test('throws error when password is missing', () => {
      expect(() => new UpCloudClient({ apiKey: 'user', apiSecret: '' })).toThrow('API username and password are required');
    });

    test('creates client with valid config', () => {
      const client = new UpCloudClient(mockConfig);
      expect(client).toBeInstanceOf(UpCloudClient);
    });
  });

  describe('getUsernamePreview', () => {
    test('returns masked username for long usernames', () => {
      const client = new UpCloudClient(mockConfig);
      const preview = client.getUsernamePreview();
      expect(preview).toBe('test...er99');
    });

    test('returns *** for short usernames', () => {
      const client = new UpCloudClient({ apiKey: 'short', apiSecret: 'pass' });
      expect(client.getUsernamePreview()).toBe('***');
    });
  });

  describe('request', () => {
    let client: UpCloudClient;
    let originalFetch: typeof global.fetch;

    beforeEach(() => {
      client = new UpCloudClient(mockConfig);
      originalFetch = global.fetch;
    });

    afterEach(() => {
      global.fetch = originalFetch;
    });

    test('sends Basic auth header', async () => {
      const expectedAuth = `Basic ${Buffer.from('testuser99:testpass123').toString('base64')}`;
      global.fetch = mock(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify({ account: {} })),
        } as Response)
      );

      await client.get('/account');

      expect(global.fetch).toHaveBeenCalledTimes(1);
      const [, options] = (global.fetch as ReturnType<typeof mock>).mock.calls[0];
      expect((options as RequestInit).headers).toMatchObject({
        Authorization: expectedAuth,
        Accept: 'application/json',
      });
    });

    test('parses UpCloud error envelope', async () => {
      global.fetch = mock(() =>
        Promise.resolve({
          ok: false,
          status: 401,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify({
            error: { error_code: 'UNAUTHORIZED', error_message: 'Invalid credentials' },
          })),
        } as Response)
      );

      await expect(client.get('/account')).rejects.toThrow(UpCloudApiError);
      await expect(client.get('/account')).rejects.toThrow('Invalid credentials');
    });

    test('handles 204 No Content', async () => {
      global.fetch = mock(() =>
        Promise.resolve({
          ok: true,
          status: 204,
          headers: new Headers(),
          text: () => Promise.resolve(''),
        } as Response)
      );

      const result = await client.delete('/server/test-uuid');
      expect(result).toEqual({});
    });
  });
});
