import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test';
import { ConnectorClient } from './client';
import { FlagsApi } from './flags';

describe('FlagsApi', () => {
  const mockConfig = {
    apiKey: 'test-token',
    baseUrl: 'https://test.app.unleash-hosted.com/instance/api',
    projectId: 'default',
  };

  let client: ConnectorClient;
  let flags: FlagsApi;
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    client = new ConnectorClient(mockConfig);
    flags = new FlagsApi(client);
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  test('list() calls /admin/projects/{project}/features', async () => {
    const mockResponse = { version: 1, features: [{ name: 'flag-a', type: 'release', enabled: true }] };
    global.fetch = mock(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: () => Promise.resolve(JSON.stringify(mockResponse)),
      } as Response)
    );

    const result = await flags.list();

    const [url, options] = (global.fetch as ReturnType<typeof mock>).mock.calls[0];
    expect(url).toBe('https://test.app.unleash-hosted.com/instance/api/admin/projects/default/features');
    expect(options.headers.Authorization).toBe('Bearer test-token');
    expect(result).toEqual(mockResponse.features);
  });

  test('get() calls /admin/projects/{project}/features/{name}', async () => {
    const mockFeature = { name: 'flag-a', type: 'release', enabled: true };
    global.fetch = mock(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: () => Promise.resolve(JSON.stringify(mockFeature)),
      } as Response)
    );

    const result = await flags.get('flag-a');

    const [url] = (global.fetch as ReturnType<typeof mock>).mock.calls[0];
    expect(url).toBe('https://test.app.unleash-hosted.com/instance/api/admin/projects/default/features/flag-a');
    expect(result).toEqual(mockFeature);
  });

  test('create() POSTs to /admin/projects/{project}/features', async () => {
    const mockFeature = { name: 'new-flag', type: 'release', enabled: false };
    global.fetch = mock(() =>
      Promise.resolve({
        ok: true,
        status: 201,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: () => Promise.resolve(JSON.stringify(mockFeature)),
      } as Response)
    );

    const result = await flags.create({ name: 'new-flag' });

    const [url, options] = (global.fetch as ReturnType<typeof mock>).mock.calls[0];
    expect(url).toBe('https://test.app.unleash-hosted.com/instance/api/admin/projects/default/features');
    expect(options.method).toBe('POST');
    expect(JSON.parse(options.body as string)).toEqual({
      name: 'new-flag',
      type: 'release',
      description: undefined,
      impressionData: false,
    });
    expect(result).toEqual(mockFeature);
  });
});
