import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test';
import { ConnectorClient } from './client';
import { WideframeApi } from './wideframe';
import { Connector } from './index';
import { ConnectorApiError } from '../types';

type CapturedRequest = { url: string; init?: RequestInit; body?: unknown };

function urlOf(input: string | URL | Request): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function jsonBody(init?: RequestInit): unknown {
  if (typeof init?.body !== 'string') return undefined;
  return JSON.parse(init.body);
}

describe('ConnectorClient', () => {
  test('requires apiKey', () => {
    expect(() => new ConnectorClient({ apiKey: '' })).toThrow('API key is required');
  });

  test('builds correct URL with query params', () => {
    const client = new ConnectorClient({ apiKey: 'wideframe-key' });
    const url = client.buildUrl('/libraries', { status: 'linked' });
    expect(url).toBe('https://api.wideframe.com/v1/libraries?status=linked');
  });

  test('uses custom base URL when configured', () => {
    const client = new ConnectorClient({
      apiKey: 'wideframe-key',
      baseUrl: 'https://custom.example/v1',
    });
    expect(client.buildUrl('/libraries')).toBe('https://custom.example/v1/libraries');
  });
});

describe('WideframeApi', () => {
  const originalFetch = globalThis.fetch;
  let captured: CapturedRequest[] = [];

  beforeEach(() => {
    captured = [];
    globalThis.fetch = mock(async (input: string | URL | Request, init?: RequestInit) => {
      captured.push({ url: urlOf(input), init, body: jsonBody(init) });
      return Response.json({ ok: true, connector: 'wideframe' });
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    captured = [];
  });

  test('uses bearer credentials for video workflow endpoints', async () => {
    const client = new ConnectorClient({ apiKey: 'wideframe-key' });
    const api = new WideframeApi(client);

    await api.listLibraries({ query: { status: 'linked' } });
    await api.getLibrary('library 1');
    await api.createIndexJob('library 1', { folder_path: '/Volumes/Footage' });
    await api.getIndexJob('job 1');
    await api.searchFootage('library 1', { search_text: 'founder soundbite', tags: ['b-roll'] });
    await api.createSequence({ libraryId: 'library 1', brief: '60 second launch cut' });
    await api.exportPremiereProject('seq 1', { format: 'prproj' });

    expect(captured.map((request) => [request.init?.method ?? 'GET', request.url])).toEqual([
      ['GET', 'https://api.wideframe.com/v1/libraries?status=linked'],
      ['GET', 'https://api.wideframe.com/v1/libraries/library%201'],
      ['POST', 'https://api.wideframe.com/v1/libraries/library%201/index-jobs'],
      ['GET', 'https://api.wideframe.com/v1/index-jobs/job%201'],
      ['POST', 'https://api.wideframe.com/v1/libraries/library%201/search'],
      ['POST', 'https://api.wideframe.com/v1/sequences'],
      ['POST', 'https://api.wideframe.com/v1/sequences/seq%201/exports/premiere'],
    ]);

    for (const request of captured) {
      expect(new Headers(request.init?.headers).get('Authorization')).toBe('Bearer wideframe-key');
    }

    expect(captured[2].body).toEqual({ folder_path: '/Volumes/Footage' });
    expect(captured[4].body).toEqual({ search_text: 'founder soundbite', tags: ['b-roll'] });
    expect(captured[6].body).toEqual({ format: 'prproj' });
  });

  test('supports raw requests', async () => {
    const client = new ConnectorClient({ apiKey: 'wideframe-key' });
    const api = new WideframeApi(client);

    await api.rawRequest({
      path: '/custom/video-workflow',
      method: 'POST',
      body: { enabled: true },
    });

    expect(captured[0].url).toBe('https://api.wideframe.com/v1/custom/video-workflow');
    expect(captured[0].init?.method).toBe('POST');
    expect(captured[0].body).toEqual({ enabled: true });
  });

  test('rejects missing api key before fetch', () => {
    expect(() => new ConnectorClient({ apiKey: '' })).toThrow('API key is required');
    expect(captured).toHaveLength(0);
  });
});

describe('Connector', () => {
  test('fromEnv throws without WIDEFRAME_API_KEY', () => {
    const origKey = process.env.WIDEFRAME_API_KEY;
    delete process.env.WIDEFRAME_API_KEY;

    expect(() => Connector.fromEnv()).toThrow('WIDEFRAME_API_KEY environment variable is required');

    if (origKey) process.env.WIDEFRAME_API_KEY = origKey;
  });

  test('fromEnv creates connector with env var', () => {
    const origKey = process.env.WIDEFRAME_API_KEY;
    process.env.WIDEFRAME_API_KEY = 'wideframe-key';

    const connector = Connector.fromEnv();
    expect(connector).toBeDefined();
    expect(connector.getApiKeyPreview()).toBe('widefr...-key');

    if (origKey) process.env.WIDEFRAME_API_KEY = origKey;
    else delete process.env.WIDEFRAME_API_KEY;
  });
});

describe('ConnectorApiError', () => {
  test('creates error with message and status code', () => {
    const err = new ConnectorApiError('test error', 500);
    expect(err.message).toBe('test error');
    expect(err.statusCode).toBe(500);
    expect(err.name).toBe('ConnectorApiError');
  });
});
