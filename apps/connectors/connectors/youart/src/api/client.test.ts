import { afterEach, describe, expect, test } from 'bun:test';
import { YouArt } from './index';

const realFetch = globalThis.fetch;

interface Recorded {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: unknown;
}

function installFetch(): Recorded[] {
  const recorded: Recorded[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((value, key) => {
      headers[key.toLowerCase()] = value;
    });
    let body: unknown;
    if (typeof init?.body === 'string') {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = init.body;
      }
    }
    recorded.push({ url, method: init?.method ?? 'GET', headers, body });
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      async text() {
        return JSON.stringify({ ok: true, connector: 'youart' });
      },
    } as Response;
  }) as typeof fetch;
  return recorded;
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('YouArt API client', () => {
  test('requires apiKey', () => {
    expect(() => new YouArt({ apiKey: '' })).toThrow('YouArt apiKey is required');
  });

  test('fromEnv requires YOUART_API_KEY', () => {
    const prev = process.env.YOUART_API_KEY;
    delete process.env.YOUART_API_KEY;
    expect(() => YouArt.fromEnv()).toThrow('YOUART_API_KEY');
    if (prev) process.env.YOUART_API_KEY = prev;
  });

  test('uses bearer credentials for creator economy endpoints', async () => {
    const recorded = installFetch();
    const client = new YouArt({ apiKey: 'youart-key' });

    await client.listProjects({ status: 'launching' });
    await client.getProject('project 1');
    await client.createProject({ title: 'Moon Opera', genre: 'sci-fi' });
    await client.listOriginals({ project_id: 'project 1' });
    await client.publishOriginal('original 1', { visibility: 'members' });
    await client.listMembershipTiers({ project_id: 'project 1' });
    await client.createFundingCampaign({ projectId: 'project 1', goal_cents: 500000 });
    await client.listBackers({ campaign_id: 'campaign 1' });

    expect(recorded.map((request) => [request.method, request.url])).toEqual([
      ['GET', 'https://api.youart.ai/v1/projects?status=launching'],
      ['GET', 'https://api.youart.ai/v1/projects/project%201'],
      ['POST', 'https://api.youart.ai/v1/projects'],
      ['GET', 'https://api.youart.ai/v1/originals?project_id=project+1'],
      ['POST', 'https://api.youart.ai/v1/originals/original%201/publish'],
      ['GET', 'https://api.youart.ai/v1/membership-tiers?project_id=project+1'],
      ['POST', 'https://api.youart.ai/v1/funding-campaigns'],
      ['GET', 'https://api.youart.ai/v1/backers?campaign_id=campaign+1'],
    ]);

    for (const request of recorded) {
      expect(request.headers.authorization).toBe('Bearer youart-key');
    }

    expect(recorded[2].body).toEqual({ title: 'Moon Opera', genre: 'sci-fi' });
    expect(recorded[4].body).toEqual({ visibility: 'members' });
    expect(recorded[6].body).toEqual({ project_id: 'project 1', goal_cents: 500000 });
  });

  test('supports raw requests with custom path and body', async () => {
    const recorded = installFetch();
    const client = new YouArt({ apiKey: 'youart-key' });

    await client.rawRequest({
      path: '/custom/originals',
      method: 'POST',
      body: { enabled: true },
    });

    expect(recorded[0].url).toBe('https://api.youart.ai/v1/custom/originals');
    expect(recorded[0].method).toBe('POST');
    expect(recorded[0].body).toEqual({ enabled: true });
    expect(recorded[0].headers.authorization).toBe('Bearer youart-key');
  });

  test('respects custom base URL', async () => {
    const recorded = installFetch();
    const client = new YouArt({ apiKey: 'youart-key', baseUrl: 'https://staging.youart.ai/v1/' });

    await client.listProjects();

    expect(recorded[0].url).toBe('https://staging.youart.ai/v1/projects');
  });
});
