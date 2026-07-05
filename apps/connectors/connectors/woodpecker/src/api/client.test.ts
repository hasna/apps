import { afterEach, describe, expect, test } from 'bun:test';
import { Woodpecker } from './index';
import { WoodpeckerClient } from './client';

const realFetch = globalThis.fetch;

interface Recorded {
  url: string;
  method: string;
  headers: Record<string, string>;
}

function installFetch(handler: (url: string, init: RequestInit | undefined) => unknown) {
  const recorded: Recorded[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const headers: Record<string, string> = {};
    if (init?.headers) {
      const h = init.headers as Record<string, string>;
      Object.assign(headers, h);
    }
    recorded.push({ url, method: init?.method ?? 'GET', headers });
    const json = handler(url, init);
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: new Headers({ 'content-type': 'application/json' }),
      async text() {
        return JSON.stringify(json ?? {});
      },
    } as Response;
  }) as typeof fetch;
  return recorded;
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('WoodpeckerClient', () => {
  test('requires API key', () => {
    expect(() => new WoodpeckerClient({ apiKey: '' })).toThrow('API key is required');
  });

  test('sends x-api-key header on requests', async () => {
    const recorded = installFetch(() => ({ ok: true }));
    const client = new WoodpeckerClient({ apiKey: 'test-key-12345' });
    await client.get('/v1/campaign_list');
    expect(recorded[0].headers['x-api-key']).toBe('test-key-12345');
    expect(recorded[0].url).toBe('https://api.woodpecker.co/rest/v1/campaign_list');
    expect(recorded[0].method).toBe('GET');
  });

  test('uses custom base URL when configured', async () => {
    const recorded = installFetch(() => ({}));
    const client = new WoodpeckerClient({
      apiKey: 'key',
      baseUrl: 'https://custom.example/rest',
    });
    await client.get('/v2/campaigns/42');
    expect(recorded[0].url).toBe('https://custom.example/rest/v2/campaigns/42');
  });
});

describe('Woodpecker API facade', () => {
  test('listCampaigns maps to v1 campaign_list', async () => {
    const recorded = installFetch((url) => {
      if (url.includes('campaign_list')) {
        return [{ id: 1, name: 'Test', status: 'RUNNING' }];
      }
      return {};
    });
    const wp = new Woodpecker({ apiKey: 'key' });
    const campaigns = await wp.listCampaigns({ status: 'RUNNING' });
    expect(campaigns).toHaveLength(1);
    expect(campaigns[0].name).toBe('Test');
    expect(recorded[0].url).toContain('/v1/campaign_list');
    expect(recorded[0].url).toContain('status=RUNNING');
  });

  test('getCampaign maps to v2 campaigns endpoint', async () => {
    const recorded = installFetch((url) => {
      if (url.includes('/v2/campaigns/99')) {
        return { id: 99, name: 'Detail', status: 'DRAFT' };
      }
      return {};
    });
    const wp = new Woodpecker({ apiKey: 'key' });
    const campaign = await wp.getCampaign(99);
    expect(campaign.id).toBe(99);
    expect(recorded[0].url).toBe('https://api.woodpecker.co/rest/v2/campaigns/99');
    expect(recorded[0].headers['x-api-key']).toBe('key');
  });

  test('searchProspects maps to v1 prospects search', async () => {
    const recorded = installFetch((url) => {
      if (url.includes('/v1/prospects')) {
        return [{ id: 5, email: 'a@b.com' }];
      }
      return {};
    });
    const wp = new Woodpecker({ apiKey: 'key' });
    const prospects = await wp.searchProspects({ search: 'email=a@b.com' });
    expect(prospects[0].email).toBe('a@b.com');
    expect(recorded[0].url).toContain('/v1/prospects');
    expect(recorded[0].url).toContain('search=email%3Da%40b.com');
  });
});
