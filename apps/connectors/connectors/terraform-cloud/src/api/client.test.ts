import { afterEach, describe, expect, test } from 'bun:test';
import { TerraformCloud } from './index';
import { TerraformCloudClient } from './client';
import { TerraformCloudApiError } from '../types';

const realFetch = globalThis.fetch;

interface Recorded {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

function installFetch(handler: (url: string, init: RequestInit | undefined, recorded: Recorded[]) => unknown) {
  const recorded: Recorded[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const headers = Object.fromEntries(new Headers(init?.headers).entries());
    recorded.push({
      url,
      method: init?.method ?? 'GET',
      headers,
      body: typeof init?.body === 'string' ? init.body : undefined,
    });
    const json = handler(url, init, recorded);
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: new Headers({ 'content-type': 'application/vnd.api+json' }),
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

describe('TerraformCloudClient', () => {
  test('requires API token', () => {
    expect(() => new TerraformCloudClient({ apiToken: '' })).toThrow('API token is required');
  });

  test('sends Bearer token and JSON:API headers', async () => {
    const recorded = installFetch(() => ({ data: [] }));
    const client = new TerraformCloudClient({ apiToken: 'test-token-abc' });
    await client.get('/organizations');

    expect(recorded[0].url).toBe('https://app.terraform.io/api/v2/organizations');
    expect(recorded[0].method).toBe('GET');
    expect(recorded[0].headers.authorization).toBe('Bearer test-token-abc');
    expect(recorded[0].headers.accept).toBe('application/vnd.api+json');
  });

  test('uses custom base URL from config', async () => {
    const recorded = installFetch(() => ({ data: [] }));
    const client = new TerraformCloudClient({
      apiToken: 'token',
      baseUrl: 'https://tfe.example.com',
    });
    await client.get('/organizations');
    expect(recorded[0].url).toStartWith('https://tfe.example.com/api/v2/');
  });

  test('handles 204 No Content', async () => {
    globalThis.fetch = (async () =>
      ({
        ok: true,
        status: 204,
        headers: new Headers(),
        async text() {
          return '';
        },
      }) as Response) as any;

    const client = new TerraformCloudClient({ apiToken: 'token' });
    const result = await client.delete('/workspaces/ws-1');
    expect(result).toEqual({});
  });

  test('throws TerraformCloudApiError on JSON:API errors', async () => {
    globalThis.fetch = (async () =>
      ({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        headers: new Headers({ 'content-type': 'application/vnd.api+json' }),
        async text() {
          return JSON.stringify({
            errors: [{ status: '401', title: 'Unauthorized', detail: 'Invalid token' }],
          });
        },
      }) as Response) as any;

    const client = new TerraformCloudClient({ apiToken: 'bad' });
    try {
      await client.get('/organizations');
      expect(true).toBe(false);
    } catch (err) {
      expect(err).toBeInstanceOf(TerraformCloudApiError);
      expect((err as TerraformCloudApiError).statusCode).toBe(401);
      expect((err as TerraformCloudApiError).message).toContain('Invalid token');
    }
  });

  test('sends JSON:API body for POST requests', async () => {
    const recorded = installFetch(() => ({ data: { type: 'workspaces', id: 'ws-new' } }));
    const client = new TerraformCloudClient({ apiToken: 'token' });
    await client.post('/organizations/acme/workspaces', {
      data: { type: 'workspaces', attributes: { name: 'demo' } },
    });

    expect(recorded[0].method).toBe('POST');
    expect(recorded[0].headers['content-type']).toBe('application/vnd.api+json');
    expect(JSON.parse(recorded[0].body!)).toEqual({
      data: { type: 'workspaces', attributes: { name: 'demo' } },
    });
  });
});

describe('TerraformCloud API routes', () => {
  test('listOrganizations GET /organizations', async () => {
    const recorded = installFetch(() => ({ data: [{ type: 'organizations', id: 'acme' }] }));
    const tfc = new TerraformCloud({ apiToken: 'token' });
    await tfc.listOrganizations();
    expect(recorded[0].url).toContain('/api/v2/organizations');
    expect(recorded[0].method).toBe('GET');
  });

  test('getOrganization GET /organizations/:name', async () => {
    const recorded = installFetch(() => ({ data: { type: 'organizations', id: 'acme' } }));
    const tfc = new TerraformCloud({ apiToken: 'token' });
    await tfc.getOrganization('acme');
    expect(recorded[0].url).toContain('/api/v2/organizations/acme');
  });

  test('listWorkspaces GET /organizations/:org/workspaces', async () => {
    const recorded = installFetch(() => ({ data: [] }));
    const tfc = new TerraformCloud({ apiToken: 'token' });
    await tfc.listWorkspaces('acme');
    expect(recorded[0].url).toContain('/api/v2/organizations/acme/workspaces');
  });

  test('createWorkspace POST with JSON:API workspace body', async () => {
    const recorded = installFetch(() => ({ data: { type: 'workspaces', id: 'ws-1' } }));
    const tfc = new TerraformCloud({ apiToken: 'token' });
    await tfc.createWorkspace('acme', { name: 'prod' });
    const body = JSON.parse(recorded[0].body!);
    expect(body.data.type).toBe('workspaces');
    expect(body.data.attributes.name).toBe('prod');
  });

  test('createRun POST /runs with workspace relationship', async () => {
    const recorded = installFetch(() => ({ data: { type: 'runs', id: 'run-1' } }));
    const tfc = new TerraformCloud({ apiToken: 'token' });
    await tfc.createRun('ws-abc', { message: 'triggered via API' });
    expect(recorded[0].url).toContain('/api/v2/runs');
    const body = JSON.parse(recorded[0].body!);
    expect(body.data.type).toBe('runs');
    expect(body.data.attributes.message).toBe('triggered via API');
    expect(body.data.relationships.workspace.data).toEqual({ type: 'workspaces', id: 'ws-abc' });
  });

  test('applyRun POST /runs/:id/actions/apply', async () => {
    const recorded = installFetch(() => ({}));
    const tfc = new TerraformCloud({ apiToken: 'token' });
    await tfc.applyRun('run-1', 'ship it');
    expect(recorded[0].url).toContain('/api/v2/runs/run-1/actions/apply');
    expect(recorded[0].method).toBe('POST');
  });

  test('createWorkspaceVar POST /vars with workspace relationship', async () => {
    const recorded = installFetch(() => ({ data: { type: 'vars', id: 'var-1' } }));
    const tfc = new TerraformCloud({ apiToken: 'token' });
    await tfc.createWorkspaceVar('ws-1', {
      key: 'region',
      value: 'us-east-1',
      category: 'terraform',
    });
    expect(recorded[0].url).toContain('/api/v2/vars');
    const body = JSON.parse(recorded[0].body!);
    expect(body.data.attributes.key).toBe('region');
    expect(body.data.relationships.workspace.data.id).toBe('ws-1');
  });

  test('listStateVersions GET /workspaces/:id/state-versions', async () => {
    const recorded = installFetch(() => ({ data: [] }));
    const tfc = new TerraformCloud({ apiToken: 'token' });
    await tfc.listStateVersions('ws-1');
    expect(recorded[0].url).toContain('/api/v2/workspaces/ws-1/state-versions');
  });

  test('listConfigurationVersions GET /workspaces/:id/configuration-versions', async () => {
    const recorded = installFetch(() => ({ data: [] }));
    const tfc = new TerraformCloud({ apiToken: 'token' });
    await tfc.listConfigurationVersions('ws-1');
    expect(recorded[0].url).toContain('/api/v2/workspaces/ws-1/configuration-versions');
  });

  test('listTeams GET /organizations/:org/teams', async () => {
    const recorded = installFetch(() => ({ data: [] }));
    const tfc = new TerraformCloud({ apiToken: 'token' });
    await tfc.listTeams('acme');
    expect(recorded[0].url).toContain('/api/v2/organizations/acme/teams');
  });

  test('listProjects GET /organizations/:org/projects', async () => {
    const recorded = installFetch(() => ({ data: [] }));
    const tfc = new TerraformCloud({ apiToken: 'token' });
    await tfc.listProjects('acme');
    expect(recorded[0].url).toContain('/api/v2/organizations/acme/projects');
  });

  test('listPolicySets GET /organizations/:org/policy-sets', async () => {
    const recorded = installFetch(() => ({ data: [] }));
    const tfc = new TerraformCloud({ apiToken: 'token' });
    await tfc.listPolicySets('acme');
    expect(recorded[0].url).toContain('/api/v2/organizations/acme/policy-sets');
  });

  test('deleteWorkspace DELETE /organizations/:org/workspaces/:name', async () => {
    const recorded = installFetch(() => ({}));
    const tfc = new TerraformCloud({ apiToken: 'token' });
    await tfc.deleteWorkspace('acme', 'old-ws');
    expect(recorded[0].method).toBe('DELETE');
    expect(recorded[0].url).toContain('/api/v2/organizations/acme/workspaces/old-ws');
  });

  test('updateVar PATCH /vars/:id', async () => {
    const recorded = installFetch(() => ({ data: { type: 'vars', id: 'var-1' } }));
    const tfc = new TerraformCloud({ apiToken: 'token' });
    await tfc.updateVar('var-1', { value: 'eu-west-1' });
    expect(recorded[0].method).toBe('PATCH');
    expect(recorded[0].url).toContain('/api/v2/vars/var-1');
    const body = JSON.parse(recorded[0].body!);
    expect(body.data.id).toBe('var-1');
    expect(body.data.attributes.value).toBe('eu-west-1');
  });
});
