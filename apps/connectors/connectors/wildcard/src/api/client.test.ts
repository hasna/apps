import { afterEach, describe, expect, test } from 'bun:test';
import { Wildcard } from './index';
import { executeFlow, flowPrompt, flowToOpenAiTool, loadAgentsJson } from './flows';
import type { AgentsJsonDocument } from '../types';

const realFetch = globalThis.fetch;

interface CapturedRequest {
  url: URL;
  method: string;
  headers: Headers;
  body: unknown;
}

const sampleAgentsJson: AgentsJsonDocument = {
  agentsJson: '0.1.0',
  info: {
    title: 'Example CRM',
    version: '1.0.0',
    description: 'CRM flows',
  },
  sources: [
    {
      id: 'crm',
      path: 'https://specs.example.com/crm-openapi.json',
    },
  ],
  flows: [
    {
      id: 'create_contact',
      title: 'Create Contact',
      description: 'Create a CRM contact from a name and email.',
      actions: [
        {
          id: 'create_contact_action',
          sourceId: 'crm',
          operationId: 'createContact',
        },
      ],
      links: [
        {
          origin: { actionId: null, fieldPath: 'parameters.name' },
          target: { actionId: 'create_contact_action', fieldPath: 'parameters.name' },
        },
        {
          origin: { actionId: null, fieldPath: 'requestBody.email' },
          target: { actionId: 'create_contact_action', fieldPath: 'requestBody.email' },
        },
      ],
      fields: {
        parameters: [
          {
            name: 'name',
            type: 'string',
            description: 'Contact name',
            required: true,
          },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  email: { type: 'string' },
                },
                required: ['email'],
              },
            },
          },
        },
      },
    },
  ],
};

const sampleOpenApi = {
  openapi: '3.1.0',
  servers: [{ url: 'https://provider.example.com/v1' }],
  paths: {
    '/contacts': {
      post: {
        operationId: 'createContact',
        parameters: [{ name: 'name', in: 'query', required: true }],
        requestBody: {
          content: {
            'application/json': {
              schema: { type: 'object' },
            },
          },
        },
      },
    },
  },
};

function parseBody(body: BodyInit | null | undefined): unknown {
  if (typeof body !== 'string' || body.length === 0) return undefined;
  return JSON.parse(body);
}

function installFetchMock(responseFactory?: (request: CapturedRequest) => Response) {
  const captured: CapturedRequest[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url,
    );
    const request = {
      url,
      method: init?.method ?? 'GET',
      headers: new Headers(init?.headers),
      body: parseBody(init?.body),
    };
    captured.push(request);
    if (url.href === 'https://specs.example.com/crm-openapi.json') {
      return Response.json(sampleOpenApi);
    }
    return responseFactory?.(request) ?? Response.json({ ok: true, path: url.pathname });
  }) as typeof fetch;
  return captured;
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('WildcardClient', () => {
  test('sets X-API-Key and Accept headers on hosted API calls', async () => {
    const captured = installFetchMock();
    const client = new Wildcard({
      apiKey: 'wc_test',
      defaultCollectionId: 'collection_default',
    });

    await client.search.searchTools({ query: 'send a Slack message' });
    await client.search.getFlow({ flow_id: 'send_slack_message', collection_id: 'collection_1' });
    await client.query.searchEndpoints({
      q: 'gmail search',
      q2: 'find emails',
      index_name: 'private_tools',
      limit: 3,
    });
    await client.query.getActionSchema({
      id: 'gmail_users_messages_list',
      collection_name: 'private_tools',
    });
    await client.query.listPublicTools({ limit: 20 });
    await client.query.getEndpointCount({ collection_name: 'private_tools' });
    await client.query.listEndpoints({
      collection_name: 'private_tools',
      limit: 10,
      offset: 5,
    });
    await client.rawRequest({
      method: 'POST',
      path: '/query/tools',
      query: { dry_run: true },
      headers: { 'X-Test': '1' },
      body: { hello: 'world' },
    });

    expect(captured).toHaveLength(8);
    for (const request of captured) {
      expect(request.url.origin).toBe('https://api.wild-card.ai');
      expect(request.headers.get('X-API-Key')).toBe('wc_test');
    }

    expect(captured[0]?.url.pathname).toBe('/search');
    expect(captured[0]?.url.searchParams.get('query')).toBe('send a Slack message');
    expect(captured[0]?.url.searchParams.get('collection_id')).toBe('collection_default');
    expect(captured[1]?.url.pathname).toBe('/flow');
    expect(captured[1]?.url.searchParams.get('flow_id')).toBe('send_slack_message');
    expect(captured[2]?.url.pathname).toBe('/query/v4/');
    expect(captured[2]?.url.searchParams.get('q2')).toBe('find emails');
    expect(captured[3]?.url.pathname).toBe('/query/endpoints/');
    expect(captured[4]?.url.pathname).toBe('/query/tools');
    expect(captured[5]?.url.pathname).toBe('/query/endpoints/size/');
    expect(captured[6]?.url.pathname).toBe('/query/endpoints/all/');
    expect(captured[7]?.method).toBe('POST');
    expect(captured[7]?.headers.get('X-Test')).toBe('1');
    expect(captured[7]?.body).toEqual({ hello: 'world' });
  });

  test('rejects absolute paths in rawRequest', async () => {
    installFetchMock();
    const client = new Wildcard({ apiKey: 'wc_test' });
    await expect(client.rawRequest({ path: 'https://evil.example.com/search' }))
      .rejects.toThrow('path must be a relative API path');
  });

  test('requires API key', () => {
    expect(() => new Wildcard({ apiKey: '' })).toThrow('API key is required');
  });
});

describe('agents.json flows', () => {
  test('formats flows for natural-language tool selection', async () => {
    const agentsJson = await loadAgentsJson({ agentsJson: sampleAgentsJson });
    const prompt = flowPrompt(agentsJson);
    const tools = (agentsJson.flows ?? []).map(flowToOpenAiTool);

    expect(prompt).toContain('create_contact: Create a CRM contact');
    expect(tools[0].function).toMatchObject({
      name: 'create_contact',
    });
    expect((tools[0].function as { parameters: { required: string[] } }).parameters.required)
      .toEqual(['parameters', 'requestBody']);
  });

  test('invokes a simple flow through its OpenAPI operation with bearer auth', async () => {
    const captured = installFetchMock();
    const result = await executeFlow(
      {
        apiKey: 'wc_test',
        providerAuthJson: {
          crm: { type: 'bearer', token: 'provider-token' },
        },
      },
      sampleAgentsJson,
      sampleAgentsJson.flows![0],
      {
        parameters: { name: 'Ada Lovelace' },
        requestBody: { email: 'ada@example.com' },
      },
    );

    expect(captured).toHaveLength(2);
    expect(captured[0]?.url.href).toBe('https://specs.example.com/crm-openapi.json');
    expect(captured[1]?.method).toBe('POST');
    expect(captured[1]?.url.href).toBe('https://provider.example.com/v1/contacts?name=Ada+Lovelace');
    expect(captured[1]?.headers.get('Authorization')).toBe('Bearer provider-token');
    expect(captured[1]?.body).toEqual({ email: 'ada@example.com' });
    expect(result.flowId).toBe('create_contact');
    expect(result.actions[0]).toMatchObject({
      actionId: 'create_contact_action',
      operationId: 'createContact',
      status: 200,
    });
  });
});
