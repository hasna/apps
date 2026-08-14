import { describe, test, expect, mock, afterEach } from 'bun:test';
import { WindmillApiPlatformClient } from './client';
import { WindmillApiPlatform } from './index';

const originalFetch = globalThis.fetch;
const TEST_BASE_URL = 'https://windmill.example.com/api';
const TEST_WORKSPACE = 'test-workspace';

function createClient(): WindmillApiPlatformClient {
  return new WindmillApiPlatformClient({
    apiKey: 'windmill-api-platform-key',
    baseUrl: TEST_BASE_URL,
    workspace: TEST_WORKSPACE,
  });
}

describe('WindmillApiPlatformClient', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('requires apiKey', () => {
    expect(() => new WindmillApiPlatformClient({
      apiKey: '',
      baseUrl: TEST_BASE_URL,
      workspace: TEST_WORKSPACE,
    })).toThrow('API key is required');
  });

  test('requires base URL', () => {
    expect(() => new WindmillApiPlatformClient({
      apiKey: 'test-key',
      baseUrl: '',
      workspace: TEST_WORKSPACE,
    })).toThrow('baseUrl is required');
  });

  test('requires workspace', () => {
    expect(() => new WindmillApiPlatformClient({
      apiKey: 'test-key',
      baseUrl: TEST_BASE_URL,
      workspace: '',
    })).toThrow('workspace is required');
  });

  test('buildUrl supports custom base URL and query params', () => {
    const client = new WindmillApiPlatformClient({
      apiKey: 'test-key',
      baseUrl: 'https://custom.example.com/api/',
      workspace: TEST_WORKSPACE,
    });
    expect(client.buildUrl('/version', { force: true })).toBe('https://custom.example.com/api/version?force=true');
  });

  test('getApiKeyPreview masks key', () => {
    const client = createClient();
    expect(client.getApiKeyPreview()).toBe('windmi...-key');
  });

  test('listScripts sends bearer auth and workspace URL', async () => {
    const captured: Array<{ url: string; init?: RequestInit }> = [];
    globalThis.fetch = mock(async (input: string | URL | Request, init?: RequestInit) => {
      captured.push({
        url: typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url,
        init,
      });
      return Response.json([]);
    }) as unknown as typeof fetch;

    await createClient().listScripts({ path_start: 'u/admin' });

    expect(captured[0]?.url).toBe(`${TEST_BASE_URL}/w/${TEST_WORKSPACE}/scripts/list?path_start=u%2Fadmin`);
    expect(new Headers(captured[0]?.init?.headers).get('Authorization')).toBe('Bearer windmill-api-platform-key');
  });

  test('getScript encodes script path', async () => {
    const captured: Array<{ url: string; init?: RequestInit }> = [];
    globalThis.fetch = mock(async (input: string | URL | Request, init?: RequestInit) => {
      captured.push({
        url: typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url,
        init,
      });
      return Response.json({ path: 'u/admin/script' });
    }) as unknown as typeof fetch;

    await createClient().getScript('u/admin/script');

    expect(captured[0]?.url).toBe(`${TEST_BASE_URL}/w/${TEST_WORKSPACE}/scripts/get/p/u%2Fadmin%2Fscript`);
  });

  test('runScript sends JSON args to Windmill jobs endpoint', async () => {
    const captured: Array<{ url: string; init?: RequestInit }> = [];
    globalThis.fetch = mock(async (input: string | URL | Request, init?: RequestInit) => {
      captured.push({
        url: typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url,
        init,
      });
      return new Response('job-id', { status: 201, headers: { 'content-type': 'text/plain' } });
    }) as unknown as typeof fetch;

    const result = await createClient().runScript({
      path: 'u/admin/script',
      args: { name: 'example' },
      query: { skip_preprocessor: true },
    });

    expect(result).toBe('job-id');
    expect(captured[0]?.url).toBe(`${TEST_BASE_URL}/w/${TEST_WORKSPACE}/jobs/run/p/u%2Fadmin%2Fscript?skip_preprocessor=true`);
    expect(captured[0]?.init?.method).toBe('POST');
    expect(captured[0]?.init?.body).toBe(JSON.stringify({ name: 'example' }));
    expect(new Headers(captured[0]?.init?.headers).get('Content-Type')).toBe('application/json');
  });

  test('listFlows, resources, and jobs use workspace endpoints', async () => {
    const captured: Array<string> = [];
    globalThis.fetch = mock(async (input: string | URL | Request) => {
      captured.push(typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url);
      return Response.json([]);
    }) as unknown as typeof fetch;

    const client = createClient();
    await client.listFlows();
    await client.getFlow('u/admin/flow');
    await client.listResources({ resource_type: 'postgresql' });
    await client.getResource('u/admin/resource');
    await client.listJobs({ status: 'success' });

    expect(captured).toEqual([
      `${TEST_BASE_URL}/w/${TEST_WORKSPACE}/flows/list`,
      `${TEST_BASE_URL}/w/${TEST_WORKSPACE}/flows/get/u%2Fadmin%2Fflow`,
      `${TEST_BASE_URL}/w/${TEST_WORKSPACE}/resources/list?resource_type=postgresql`,
      `${TEST_BASE_URL}/w/${TEST_WORKSPACE}/resources/get/u%2Fadmin%2Fresource`,
      `${TEST_BASE_URL}/w/${TEST_WORKSPACE}/jobs/list?status=success`,
    ]);
  });

  test('rawRequest supports custom method, path, and JSON body', async () => {
    const captured: Array<{ url: string; init?: RequestInit }> = [];
    globalThis.fetch = mock(async (input: string | URL | Request, init?: RequestInit) => {
      captured.push({
        url: typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url,
        init,
      });
      return Response.json({ ok: true });
    }) as unknown as typeof fetch;

    await createClient().rawRequest({ method: 'PATCH', path: '/w/test/scripts/get/p/u%2Fadmin', body: { active: true } });

    expect(captured[0]?.url).toBe(`${TEST_BASE_URL}/w/test/scripts/get/p/u%2Fadmin`);
    expect(captured[0]?.init?.method).toBe('PATCH');
    expect(captured[0]?.init?.body).toBe(JSON.stringify({ active: true }));
  });
});

describe('WindmillApiPlatform', () => {
  test('fromEnv requires WINDMILL_API_PLATFORM_API_KEY', () => {
    const previous = process.env.WINDMILL_API_PLATFORM_API_KEY;
    delete process.env.WINDMILL_API_PLATFORM_API_KEY;
    expect(() => WindmillApiPlatform.fromEnv()).toThrow('WINDMILL_API_PLATFORM_API_KEY');
    if (previous !== undefined) process.env.WINDMILL_API_PLATFORM_API_KEY = previous;
  });

  test('fromEnv requires WINDMILL_API_PLATFORM_BASE_URL', () => {
    const previousKey = process.env.WINDMILL_API_PLATFORM_API_KEY;
    const previousBaseUrl = process.env.WINDMILL_API_PLATFORM_BASE_URL;
    process.env.WINDMILL_API_PLATFORM_API_KEY = 'test-key';
    delete process.env.WINDMILL_API_PLATFORM_BASE_URL;
    expect(() => WindmillApiPlatform.fromEnv()).toThrow('WINDMILL_API_PLATFORM_BASE_URL');
    if (previousKey !== undefined) process.env.WINDMILL_API_PLATFORM_API_KEY = previousKey;
    else delete process.env.WINDMILL_API_PLATFORM_API_KEY;
    if (previousBaseUrl !== undefined) process.env.WINDMILL_API_PLATFORM_BASE_URL = previousBaseUrl;
  });

  test('fromEnv requires WINDMILL_API_PLATFORM_WORKSPACE', () => {
    const previousKey = process.env.WINDMILL_API_PLATFORM_API_KEY;
    const previousBaseUrl = process.env.WINDMILL_API_PLATFORM_BASE_URL;
    const previousWorkspace = process.env.WINDMILL_API_PLATFORM_WORKSPACE;
    process.env.WINDMILL_API_PLATFORM_API_KEY = 'test-key';
    process.env.WINDMILL_API_PLATFORM_BASE_URL = TEST_BASE_URL;
    delete process.env.WINDMILL_API_PLATFORM_WORKSPACE;
    expect(() => WindmillApiPlatform.fromEnv()).toThrow('WINDMILL_API_PLATFORM_WORKSPACE');
    if (previousKey !== undefined) process.env.WINDMILL_API_PLATFORM_API_KEY = previousKey;
    else delete process.env.WINDMILL_API_PLATFORM_API_KEY;
    if (previousBaseUrl !== undefined) process.env.WINDMILL_API_PLATFORM_BASE_URL = previousBaseUrl;
    else delete process.env.WINDMILL_API_PLATFORM_BASE_URL;
    if (previousWorkspace !== undefined) process.env.WINDMILL_API_PLATFORM_WORKSPACE = previousWorkspace;
    else delete process.env.WINDMILL_API_PLATFORM_WORKSPACE;
  });
});
