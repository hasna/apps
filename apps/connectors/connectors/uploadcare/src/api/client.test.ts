import { describe, it, expect, mock } from 'bun:test';
import { Uploadcare } from './index';
import { UploadcareClient, withTrailingSlash } from './client';
import { FilesApi } from './files';
import { GroupsApi } from './groups';
import { WebhooksApi } from './webhooks';
import { ProjectApi } from './project';
import { ConnectorApiError, parseApiError, UPLOADCARE_ACCEPT_VERSION } from '../types';

function mockFetch(response: {
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
}) {
  const status = response.status ?? 200;
  const headers = new Headers({
    'content-type': 'application/json',
    ...(response.headers || {}),
  });

  return mock(() =>
    Promise.resolve(
      new Response(
        status === 204 ? null : JSON.stringify(response.body),
        { status, headers }
      )
    )
  );
}

function restoreFetch(original: typeof globalThis.fetch) {
  globalThis.fetch = original;
}

describe('withTrailingSlash', () => {
  it('should add trailing slash when missing', () => {
    expect(withTrailingSlash('/files')).toBe('/files/');
  });

  it('should preserve existing trailing slash', () => {
    expect(withTrailingSlash('/files/')).toBe('/files/');
  });
});

describe('UploadcareClient', () => {
  it('should require both publicKey and secretKey', () => {
    expect(() => new UploadcareClient({ publicKey: '', secretKey: '' })).toThrow(
      'Both publicKey and secretKey are required'
    );
  });

  it('should include Uploadcare.Simple Authorization header', async () => {
    const originalFetch = globalThis.fetch;
    let capturedHeaders: Record<string, string> = {};

    globalThis.fetch = mock((_url: unknown, options: { headers: Record<string, string> }) => {
      capturedHeaders = options.headers;
      return Promise.resolve(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      );
    }) as any;

    const client = new UploadcareClient({ publicKey: 'pubkey', secretKey: 'seckey' });
    await client.get('/files');

    expect(capturedHeaders['Authorization']).toBe('Uploadcare.Simple pubkey:seckey');
    expect(capturedHeaders['Accept']).toBe(UPLOADCARE_ACCEPT_VERSION);

    restoreFetch(originalFetch);
  });

  it('should use trailing slash in request URLs', async () => {
    const originalFetch = globalThis.fetch;
    let capturedUrl = '';

    globalThis.fetch = mock((url: string) => {
      capturedUrl = url.toString();
      return Promise.resolve(
        new Response(JSON.stringify({ results: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      );
    }) as any;

    const client = new UploadcareClient({ publicKey: 'pub', secretKey: 'sec' });
    await client.get('/files');

    expect(capturedUrl).toBe('https://api.uploadcare.com/files/');

    restoreFetch(originalFetch);
  });

  it('should throw ConnectorApiError on non-ok response', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetch({
      status: 401,
      body: { detail: 'Authentication credentials were not provided.' },
    }) as any;

    const client = new UploadcareClient({ publicKey: 'bad', secretKey: 'bad' });

    try {
      await client.get('/files');
      expect(true).toBe(false);
    } catch (err) {
      expect(err).toBeInstanceOf(ConnectorApiError);
      expect((err as ConnectorApiError).statusCode).toBe(401);
    }

    restoreFetch(originalFetch);
  });

  it('should handle 204 No Content', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response(null, { status: 204 }))
    ) as any;

    const client = new UploadcareClient({ publicKey: 'pub', secretKey: 'sec' });
    const result = await client.delete('/files/test-uuid');
    expect(result).toEqual({});

    restoreFetch(originalFetch);
  });
});

describe('FilesApi', () => {
  it('should list files', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetch({
      body: {
        total: 1,
        per_page: 20,
        current_page: 1,
        results: [{ uuid: 'abc-123', size: 1024, datetime_uploaded: '2026-01-01T00:00:00Z' }],
      },
    }) as any;

    const uc = new Uploadcare({ publicKey: 'pub', secretKey: 'sec' });
    const result = await uc.files.list();

    expect(result.total).toBe(1);
    expect(result.results[0].uuid).toBe('abc-123');

    restoreFetch(originalFetch);
  });

  it('should store a file', async () => {
    const originalFetch = globalThis.fetch;
    let capturedUrl = '';
    let capturedMethod = '';

    globalThis.fetch = mock((url: string, options: { method: string }) => {
      capturedUrl = url.toString();
      capturedMethod = options.method;
      return Promise.resolve(
        new Response(JSON.stringify({ uuid: 'abc-123', is_ready: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      );
    }) as any;

    const uc = new Uploadcare({ publicKey: 'pub', secretKey: 'sec' });
    await uc.files.store('abc-123');

    expect(capturedMethod).toBe('PUT');
    expect(capturedUrl).toContain('/files/abc-123/storage/');

    restoreFetch(originalFetch);
  });

  it('should get file metadata', async () => {
    const originalFetch = globalThis.fetch;
    let capturedUrl = '';

    globalThis.fetch = mock((url: string) => {
      capturedUrl = url.toString();
      return Promise.resolve(
        new Response(JSON.stringify({ album: 'vacation' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      );
    }) as any;

    const uc = new Uploadcare({ publicKey: 'pub', secretKey: 'sec' });
    const metadata = await uc.files.getMetadata('abc-123');

    expect(capturedUrl).toContain('/files/abc-123/metadata/');
    expect(metadata.album).toBe('vacation');

    restoreFetch(originalFetch);
  });
});

describe('GroupsApi', () => {
  it('should get a group', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetch({
      body: { id: 'group~1', datetime_created: '2026-01-01T00:00:00Z', files_count: 2 },
    }) as any;

    const uc = new Uploadcare({ publicKey: 'pub', secretKey: 'sec' });
    const group = await uc.groups.get('group~1');

    expect(group.id).toBe('group~1');
    expect(group.files_count).toBe(2);

    restoreFetch(originalFetch);
  });
});

describe('WebhooksApi', () => {
  it('should create a webhook', async () => {
    const originalFetch = globalThis.fetch;
    let capturedMethod = '';
    let capturedBody = '';

    globalThis.fetch = mock((_url: string, options: { method: string; body: string }) => {
      capturedMethod = options.method;
      capturedBody = options.body;
      return Promise.resolve(
        new Response(JSON.stringify({ id: 'wh-1', target_url: 'https://example.com/hook' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      );
    }) as any;

    const uc = new Uploadcare({ publicKey: 'pub', secretKey: 'sec' });
    const webhook = await uc.webhooks.create({ target_url: 'https://example.com/hook', event: 'file.uploaded' });

    expect(capturedMethod).toBe('POST');
    expect(JSON.parse(capturedBody).target_url).toBe('https://example.com/hook');
    expect(webhook.id).toBe('wh-1');

    restoreFetch(originalFetch);
  });
});

describe('ProjectApi', () => {
  it('should get project info', async () => {
    const originalFetch = globalThis.fetch;
    let capturedUrl = '';

    globalThis.fetch = mock((url: string) => {
      capturedUrl = url.toString();
      return Promise.resolve(
        new Response(JSON.stringify({ name: 'My Project', pub_key: 'pub', autostore_enabled: true, secure_uploads: false }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      );
    }) as any;

    const uc = new Uploadcare({ publicKey: 'pub', secretKey: 'sec' });
    const project = await uc.project.get();

    expect(capturedUrl).toBe('https://api.uploadcare.com/project/');
    expect(project.name).toBe('My Project');

    restoreFetch(originalFetch);
  });
});

describe('Uploadcare', () => {
  it('should expose API modules', () => {
    const uc = new Uploadcare({ publicKey: 'pub', secretKey: 'sec' });
    expect(uc.files).toBeInstanceOf(FilesApi);
    expect(uc.groups).toBeInstanceOf(GroupsApi);
    expect(uc.webhooks).toBeInstanceOf(WebhooksApi);
    expect(uc.project).toBeInstanceOf(ProjectApi);
  });

  it('should create from environment variables', () => {
    const originalPublic = process.env.UPLOADCARE_PUBLIC_KEY;
    const originalSecret = process.env.UPLOADCARE_SECRET_KEY;

    process.env.UPLOADCARE_PUBLIC_KEY = 'envpub';
    process.env.UPLOADCARE_SECRET_KEY = 'envsec';

    const uc = Uploadcare.fromEnv();
    expect(uc).toBeDefined();

    if (originalPublic) process.env.UPLOADCARE_PUBLIC_KEY = originalPublic;
    else delete process.env.UPLOADCARE_PUBLIC_KEY;
    if (originalSecret) process.env.UPLOADCARE_SECRET_KEY = originalSecret;
    else delete process.env.UPLOADCARE_SECRET_KEY;
  });
});

describe('ConnectorApiError', () => {
  it('should detect auth errors', () => {
    const err = new ConnectorApiError('Unauthorized', 401);
    expect(err.isAuthError()).toBe(true);
    expect(err.getUserMessage()).toContain('Authentication failed');
  });

  it('should parse API error response', () => {
    const err = parseApiError({ detail: 'Not found' }, 404);
    expect(err.message).toBe('Not found');
    expect(err.statusCode).toBe(404);
  });
});
