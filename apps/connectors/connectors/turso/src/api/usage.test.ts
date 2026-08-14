import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test';
import { TursoClient } from './client';
import { UsageApi } from './usage';

describe('UsageApi', () => {
  let client: TursoClient;
  let usage: UsageApi;
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    client = new TursoClient(
      { apiKey: 'test-token', organization: 'acme-corp' },
      'https://api.turso.tech/v1',
    );
    usage = new UsageApi(client);
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  test('getOrganizationUsage() returns databases nested under organization', async () => {
    global.fetch = mock(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: () =>
          Promise.resolve(
            JSON.stringify({
              organization: {
                uuid: 'org-uuid',
                usage: { rows_read: 100, databases: 1 },
                databases: [
                  {
                    uuid: 'db-uuid',
                    total: { rows_read: 100, storage_bytes: 4096 },
                  },
                ],
              },
            }),
          ),
      } as Response),
    );

    const result = await usage.getOrganizationUsage();

    const [url, options] = (global.fetch as ReturnType<typeof mock>).mock.calls[0];
    expect(url).toBe('https://api.turso.tech/v1/organizations/acme-corp/usage');
    expect(options.method).toBe('GET');
    expect(result.organization.databases).toHaveLength(1);
    expect(result.organization.databases[0]?.uuid).toBe('db-uuid');
  });
});
