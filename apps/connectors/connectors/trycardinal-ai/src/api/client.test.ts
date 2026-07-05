import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test';
import { ConnectorClient, DEFAULT_BASE_URL } from './client';
import { Connector } from './index';
import { ConnectorApiError } from '../types';

describe('ConnectorClient', () => {
  const mockConfig = {
    apiKey: 'cardinal-key',
    baseUrl: DEFAULT_BASE_URL,
  };

  describe('constructor', () => {
    test('throws when API key is missing', () => {
      expect(() => new ConnectorClient({})).toThrow('API key is required');
    });

    test('creates client with valid config', () => {
      const client = new ConnectorClient(mockConfig);
      expect(client).toBeInstanceOf(ConnectorClient);
      expect(client.getBaseUrl()).toBe(DEFAULT_BASE_URL);
    });

    test('uses custom base URL when provided', () => {
      const client = new ConnectorClient({ apiKey: 'key', baseUrl: 'https://custom.example.com' });
      expect(client.getBaseUrl()).toBe('https://custom.example.com');
    });
  });

  describe('getApiKeyPreview', () => {
    test('masks long API keys', () => {
      const client = new ConnectorClient(mockConfig);
      expect(client.getApiKeyPreview()).toBe('cardin...-key');
    });

    test('returns *** for short keys', () => {
      const client = new ConnectorClient({ apiKey: 'short' });
      expect(client.getApiKeyPreview()).toBe('***');
    });
  });

  describe('buildDocumentFormData', () => {
    test('throws when file and fileUrl are missing', () => {
      const client = new ConnectorClient(mockConfig);
      expect(() => client.buildDocumentFormData({ pages: 2 })).toThrow(/file or fileUrl is required/i);
    });

    test('normalizes file_url alias to fileUrl', () => {
      const client = new ConnectorClient(mockConfig);
      const form = client.buildDocumentFormData({ file_url: 'https://example.com/doc.pdf', mode: 'sections' });
      const entries: Record<string, string> = {};
      for (const [key, value] of form.entries()) {
        entries[key] = String(value);
      }
      expect(entries.fileUrl).toBe('https://example.com/doc.pdf');
      expect(entries.mode).toBe('sections');
      expect(entries.file_url).toBeUndefined();
    });

    test('accepts fileUrl directly', () => {
      const client = new ConnectorClient(mockConfig);
      const form = client.buildDocumentFormData({ fileUrl: 'https://example.com/doc.pdf', pages: 2 });
      const entries: Record<string, string> = {};
      for (const [key, value] of form.entries()) {
        entries[key] = String(value);
      }
      expect(entries).toEqual({
        fileUrl: 'https://example.com/doc.pdf',
        pages: '2',
      });
    });
  });

  describe('multipart and JSON requests', () => {
    let client: ConnectorClient;
    let originalFetch: typeof global.fetch;
    let captured: Array<{ url: string; init?: RequestInit; fields?: Record<string, string> }>;

    beforeEach(() => {
      client = new ConnectorClient(mockConfig);
      originalFetch = global.fetch;
      captured = [];
    });

    afterEach(() => {
      global.fetch = originalFetch;
    });

    async function formFields(body: BodyInit | null | undefined): Promise<Record<string, string> | undefined> {
      if (!(body instanceof FormData)) return undefined;
      const entries: Record<string, string> = {};
      for (const [key, value] of body.entries()) {
        entries[key] = String(value);
      }
      return entries;
    }

    test('requestMultipart sends x-api-key and POST to /markdown', async () => {
      global.fetch = mock(async (input: string | URL | Request, init?: RequestInit) => {
        captured.push({
          url: String(input),
          init,
          fields: await formFields(init?.body),
        });
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }) as unknown as typeof fetch;

      const form = client.buildDocumentFormData({ fileUrl: 'https://example.com/doc.pdf', pages: 2 });
      await client.requestMultipart('/markdown', form);

      expect(captured).toHaveLength(1);
      expect(captured[0].url).toBe('https://api.trycardinal.ai/markdown');
      expect(captured[0].init?.method).toBe('POST');
      expect(new Headers(captured[0].init?.headers).get('x-api-key')).toBe('cardinal-key');
      expect(captured[0].fields).toEqual({
        fileUrl: 'https://example.com/doc.pdf',
        pages: '2',
      });
    });

    test('requestMultipart sends POST to /split with file_url alias', async () => {
      global.fetch = mock(async (input: string | URL | Request, init?: RequestInit) => {
        captured.push({
          url: String(input),
          init,
          fields: await formFields(init?.body),
        });
        return new Response(JSON.stringify({ sections: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }) as unknown as typeof fetch;

      const form = client.buildDocumentFormData({ file_url: 'https://example.com/split.pdf', mode: 'sections' });
      await client.requestMultipart('/split', form);

      expect(captured[0].url).toBe('https://api.trycardinal.ai/split');
      expect(captured[0].fields).toEqual({
        fileUrl: 'https://example.com/split.pdf',
        mode: 'sections',
      });
    });

    test('rawRequest builds URL with query params and JSON body', async () => {
      global.fetch = mock(async (input: string | URL | Request, init?: RequestInit) => {
        captured.push({ url: String(input), init });
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }) as unknown as typeof fetch;

      await client.rawRequest({
        path: '/markdown',
        method: 'POST',
        body: { fileUrl: 'https://example.com/raw.pdf' },
      });

      expect(captured[0].url).toBe('https://api.trycardinal.ai/markdown');
      expect(captured[0].init?.method).toBe('POST');
      expect(new Headers(captured[0].init?.headers).get('x-api-key')).toBe('cardinal-key');
      expect(captured[0].init?.body).toBe(JSON.stringify({ fileUrl: 'https://example.com/raw.pdf' }));
    });

    test('throws ConnectorApiError on failed response', async () => {
      global.fetch = mock(async () =>
        new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401,
          headers: { 'content-type': 'application/json' },
        }),
      ) as unknown as typeof fetch;

      const form = client.buildDocumentFormData({ fileUrl: 'https://example.com/doc.pdf' });
      await expect(client.requestMultipart('/markdown', form)).rejects.toThrow(ConnectorApiError);
    });
  });
});

describe('Connector', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  test('fromEnv requires TRYCARDINAL_AI_API_KEY', () => {
    delete process.env.TRYCARDINAL_AI_API_KEY;
    expect(() => Connector.fromEnv()).toThrow(/TRYCARDINAL_AI_API_KEY/);
  });

  test('fromEnv creates connector with env vars', () => {
    process.env.TRYCARDINAL_AI_API_KEY = 'env-test-key-12345';
    process.env.TRYCARDINAL_AI_BASE_URL = 'https://api.trycardinal.ai';
    const connector = Connector.fromEnv();
    expect(connector.getApiKeyPreview()).toBe('env-te...2345');
  });
});

describe('DocumentsApi integration', () => {
  let originalFetch: typeof global.fetch;
  let captured: Array<{ url: string; fields?: Record<string, string> }>;

  beforeEach(() => {
    originalFetch = global.fetch;
    captured = [];
    global.fetch = mock(async (input: string | URL | Request, init?: RequestInit) => {
      const fields: Record<string, string> = {};
      if (init?.body instanceof FormData) {
        for (const [key, value] of init.body.entries()) {
          fields[key] = String(value);
        }
      }
      captured.push({ url: String(input), fields });
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  test('convertToMarkdown and splitDocument hit correct endpoints', async () => {
    const connector = new Connector({ apiKey: 'cardinal-key' });

    await connector.documents.convertToMarkdown({ fileUrl: 'https://example.com/doc.pdf', pages: 2 });
    await connector.documents.splitDocument({ file_url: 'https://example.com/split.pdf', mode: 'sections' });

    expect(captured.map((r) => r.url)).toEqual([
      'https://api.trycardinal.ai/markdown',
      'https://api.trycardinal.ai/split',
    ]);
    expect(captured[0].fields).toEqual({ fileUrl: 'https://example.com/doc.pdf', pages: '2' });
    expect(captured[1].fields).toEqual({ fileUrl: 'https://example.com/split.pdf', mode: 'sections' });
  });
});
