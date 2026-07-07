import { describe, expect, mock, test } from 'bun:test';
import { DEFAULT_SCAN_FORMAT, SucuriClient } from './client';
import { Sucuri } from './index';
import { SucuriApiError } from '../types';

const API_KEY_ENV = 'SUCURI_API_KEY';
const MONITOR_DOMAIN_ENV = 'SUCURI_MONITOR_DOMAIN';
const fakeApiKey = (...parts: string[]) => ['fake', 'sucuri', ...parts].join('-');

describe('SucuriClient', () => {
  test('requires an apiKey and monitorDomain', () => {
    expect(() => new SucuriClient({ apiKey: '', monitorDomain: 'monitorx.sucuri.net' })).toThrow('Sucuri apiKey is required');
    expect(() => new SucuriClient({ apiKey: fakeApiKey('required'), monitorDomain: '' })).toThrow('Sucuri monitorDomain is required');
  });

  test('normalizes the monitor domain', () => {
    const client = new SucuriClient({ apiKey: fakeApiKey('domain'), monitorDomain: 'monitorx.sucuri.net/path/' });
    expect(client.getMonitorDomain()).toBe('https://monitorx.sucuri.net');
  });

  test('builds documented scan-api.php URLs', () => {
    const key = fakeApiKey('url');
    const client = new SucuriClient({ apiKey: key, monitorDomain: 'https://monitorx.sucuri.net' });
    const url = new URL(client.buildScanUrl({ host: 'example.com' }));

    expect(url.origin).toBe('https://monitorx.sucuri.net');
    expect(url.pathname).toBe('/scan-api.php');
    expect(url.searchParams.get('k')).toBe(key);
    expect(url.searchParams.get('a')).toBe('scan');
    expect(url.searchParams.get('host')).toBe('example.com');
    expect(url.searchParams.get('format')).toBe(DEFAULT_SCAN_FORMAT);
  });

  test('honors explicit scan format', () => {
    const client = new SucuriClient({ apiKey: fakeApiKey('format'), monitorDomain: 'monitorx.sucuri.net' });
    const url = new URL(client.buildScanUrl({ host: 'https://example.com/path', format: 'serialized' }));
    expect(url.searchParams.get('host')).toBe('https://example.com/path');
    expect(url.searchParams.get('format')).toBe('serialized');
  });

  test('requires a scan host', () => {
    const client = new SucuriClient({ apiKey: fakeApiKey('host'), monitorDomain: 'monitorx.sucuri.net' });
    expect(() => client.buildScanUrl({ host: '' })).toThrow('Sucuri scan host is required');
  });

  test('requests a scan and returns raw body text', async () => {
    let capturedUrl = '';
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock((url: string) => {
      capturedUrl = url;
      return Promise.resolve(new Response('scan-result', { status: 200 }));
    }) as unknown as typeof fetch;

    const client = new SucuriClient({ apiKey: fakeApiKey('request'), monitorDomain: 'monitorx.sucuri.net' });
    const result = await client.scan({ host: 'example.com', format: 'text' });

    const url = new URL(capturedUrl);
    expect(url.pathname).toBe('/scan-api.php');
    expect(url.searchParams.get('a')).toBe('scan');
    expect(result).toEqual({ host: 'example.com', format: 'text', body: 'scan-result' });

    globalThis.fetch = originalFetch;
  });

  test('throws a SucuriApiError on non-2xx responses', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response('invalid scan key', { status: 403 }))
    ) as unknown as typeof fetch;

    const client = new SucuriClient({ apiKey: fakeApiKey('bad'), monitorDomain: 'monitorx.sucuri.net' });
    let thrown: unknown;
    try {
      await client.scan({ host: 'example.com' });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(SucuriApiError);
    expect((thrown as SucuriApiError).statusCode).toBe(403);
    expect((thrown as SucuriApiError).isAuthError()).toBe(true);

    globalThis.fetch = originalFetch;
  });

  test('does not expose api key material in the preview', () => {
    const client = new SucuriClient({ apiKey: fakeApiKey('preview'), monitorDomain: 'monitorx.sucuri.net' });
    expect(client.getApiKeyPreview()).toBe('configured');
  });
});

describe('Sucuri', () => {
  test('fromEnv throws without required environment variables', () => {
    const originalKey = process.env[API_KEY_ENV];
    const originalDomain = process.env[MONITOR_DOMAIN_ENV];
    delete process.env[API_KEY_ENV];
    delete process.env[MONITOR_DOMAIN_ENV];

    expect(() => Sucuri.fromEnv()).toThrow('SUCURI_API_KEY environment variable is required');

    process.env[API_KEY_ENV] = fakeApiKey('env-required');
    expect(() => Sucuri.fromEnv()).toThrow('SUCURI_MONITOR_DOMAIN environment variable is required');

    if (originalKey) process.env[API_KEY_ENV] = originalKey; else delete process.env[API_KEY_ENV];
    if (originalDomain) process.env[MONITOR_DOMAIN_ENV] = originalDomain; else delete process.env[MONITOR_DOMAIN_ENV];
  });

  test('fromEnv reads key and monitor domain', () => {
    const originalKey = process.env[API_KEY_ENV];
    const originalDomain = process.env[MONITOR_DOMAIN_ENV];
    process.env[API_KEY_ENV] = fakeApiKey('env');
    process.env[MONITOR_DOMAIN_ENV] = 'monitorx.sucuri.net';

    const client = Sucuri.fromEnv().getClient();
    expect(client.getMonitorDomain()).toBe('https://monitorx.sucuri.net');
    expect(client.getApiKeyPreview()).toBe('configured');

    if (originalKey) process.env[API_KEY_ENV] = originalKey; else delete process.env[API_KEY_ENV];
    if (originalDomain) process.env[MONITOR_DOMAIN_ENV] = originalDomain; else delete process.env[MONITOR_DOMAIN_ENV];
  });

  test('scan delegates to the client', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response('ok', { status: 200 }))
    ) as unknown as typeof fetch;

    const sucuri = new Sucuri({ apiKey: fakeApiKey('facade'), monitorDomain: 'monitorx.sucuri.net' });
    const result = await sucuri.scan({ host: 'example.com' });
    expect(result.body).toBe('ok');

    globalThis.fetch = originalFetch;
  });
});

describe('SucuriApiError', () => {
  test('captures message, status and helpers', () => {
    const err = new SucuriApiError('rate limited', 429, { retry: 1 });
    expect(err.message).toBe('rate limited');
    expect(err.statusCode).toBe(429);
    expect(err.name).toBe('SucuriApiError');
    expect(err.isRateLimited()).toBe(true);
    expect(err.isAuthError()).toBe(false);
    expect(err.details).toEqual({ retry: 1 });
  });
});
