import { afterEach, describe, expect, test } from 'bun:test';
import { Zatanna, ZatannaClient } from './index';
import { ZatannaApiError } from '../types';

const realFetch = globalThis.fetch;

interface CapturedRequest {
  url: URL;
  method: string;
  headers: Headers;
  body: unknown;
}

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
    const request: CapturedRequest = {
      url,
      method: init?.method ?? 'GET',
      headers: new Headers(init?.headers),
      body: parseBody(init?.body),
    };
    captured.push(request);
    return responseFactory?.(request) ?? Response.json({
      ok: true,
      path: url.pathname,
      method: request.method,
    });
  }) as typeof fetch;
  return captured;
}

function createClient(overrides: {
  apiKey?: string;
  baseUrl?: string;
  authHeader?: string;
  defaultWorkspaceId?: string;
} = {}): Zatanna {
  return new Zatanna({
    apiKey: overrides.apiKey ?? 'zat_test',
    baseUrl: overrides.baseUrl,
    authHeader: overrides.authHeader,
    defaultWorkspaceId: overrides.defaultWorkspaceId ?? 'workspace_default',
  });
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('ZatannaClient', () => {
  test('rejects absolute paths', () => {
    expect(() => ZatannaClient.relativePath('https://evil.example.com/workflows')).toThrow(
      'path must be a relative API path',
    );
  });

  test('requires API key', () => {
    expect(() => new ZatannaClient({ apiKey: '' })).toThrow('API key is required');
  });
});

describe('Zatanna workflow API', () => {
  test('calls workflow discovery, invocation, status, and export endpoints', async () => {
    const captured = installFetchMock();
    const client = createClient();

    await client.workflows.searchWorkflows({ query: 'claims portal', limit: 5 });
    await client.workflows.discoverWorkflows({
      query: 'submit a freight claim',
      target: 'carrier portal',
    });
    await client.workflows.getWorkflow('submit-claim');
    await client.workflows.invokeWorkflow({
      workflowId: 'submit-claim',
      input: { claimId: 'CLM-1' },
      metadata: { agent: 'nero' },
      idempotencyKey: 'idem-1',
      dryRun: true,
    });
    await client.workflows.getRunStatus('run_123');
    await client.workflows.listRunEvents({ runId: 'run_123', limit: 10 });
    await client.workflows.exportWorkflow({
      workflowId: 'submit-claim',
      format: 'mcp',
    });
    await client.workflows.replayCapture({
      captureId: 'capture_123',
      input: { claimId: 'CLM-1' },
      metadata: { source: 'test' },
    });
    await client.workflows.rawRequest({
      method: 'PUT',
      path: '/workflows/submit-claim',
      query: { dry_run: true },
      headers: { 'X-Trace': 'trace_1' },
      body: { status: 'draft' },
    });

    expect(captured).toHaveLength(9);
    for (const request of captured) {
      expect(request.url.origin).toBe('https://api.zatanna.ai');
      expect(request.url.pathname.startsWith('/v1/')).toBe(true);
      expect(request.headers.get('Authorization')).toBe('Bearer zat_test');
    }

    expect(captured[0]?.url.pathname).toBe('/v1/workflows');
    expect(captured[0]?.url.searchParams.get('query')).toBe('claims portal');
    expect(captured[0]?.url.searchParams.get('workspace_id')).toBe('workspace_default');
    expect(captured[0]?.url.searchParams.get('limit')).toBe('5');

    expect(captured[1]?.url.pathname).toBe('/v1/workflows/discover');
    expect(captured[1]?.url.searchParams.get('target')).toBe('carrier portal');

    expect(captured[2]?.url.pathname).toBe('/v1/workflows/submit-claim');

    expect(captured[3]?.url.pathname).toBe('/v1/workflows/submit-claim/invoke');
    expect(captured[3]?.method).toBe('POST');
    expect(captured[3]?.body).toEqual({
      input: { claimId: 'CLM-1' },
      metadata: { agent: 'nero' },
      idempotency_key: 'idem-1',
      dry_run: true,
    });

    expect(captured[4]?.url.pathname).toBe('/v1/runs/run_123');
    expect(captured[5]?.url.pathname).toBe('/v1/runs/run_123/events');
    expect(captured[5]?.url.searchParams.get('limit')).toBe('10');
    expect(captured[6]?.url.pathname).toBe('/v1/workflows/submit-claim/export');
    expect(captured[6]?.url.searchParams.get('format')).toBe('mcp');
    expect(captured[6]?.url.searchParams.get('include_secrets')).toBe('false');
    expect(captured[7]?.url.pathname).toBe('/v1/captures/capture_123/replay');
    expect(captured[7]?.method).toBe('POST');
    expect(captured[7]?.body).toEqual({
      input: { claimId: 'CLM-1' },
      metadata: { source: 'test' },
    });
    expect(captured[8]?.url.pathname).toBe('/v1/workflows/submit-claim');
    expect(captured[8]?.method).toBe('PUT');
    expect(captured[8]?.url.searchParams.get('dry_run')).toBe('true');
    expect(captured[8]?.headers.get('X-Trace')).toBe('trace_1');
    expect(captured[8]?.body).toEqual({ status: 'draft' });
  });

  test('supports configured hosted endpoint paths and custom auth header', async () => {
    const captured = installFetchMock();
    const client = createClient({
      baseUrl: 'https://hosted.example.com/api',
      authHeader: 'X-Zatanna-Key',
    });

    const response = await client.workflows.invokeHostedEndpoint({
      path: '/carrier/submit',
      method: 'PATCH',
      query: { trace: 'run_123' },
      body: { claimId: 'CLM-1' },
    });

    expect(response).toEqual({
      ok: true,
      path: '/api/carrier/submit',
      method: 'PATCH',
    });
    expect(captured).toHaveLength(1);
    expect(captured[0]?.url.href).toBe('https://hosted.example.com/api/carrier/submit?trace=run_123');
    expect(captured[0]?.headers.get('X-Zatanna-Key')).toBe('zat_test');
    expect(captured[0]?.headers.get('Authorization')).toBeNull();
    expect(captured[0]?.body).toEqual({ claimId: 'CLM-1' });
  });

  test('rejects unsafe absolute raw paths', async () => {
    installFetchMock();
    const client = createClient();

    await expect(client.workflows.rawRequest({
      path: 'https://evil.example.com/workflows',
    })).rejects.toThrow('path must be a relative API path');
  });

  test('surfaces provider error status and message', async () => {
    installFetchMock(() => Response.json({ error: 'workflow session expired' }, { status: 409 }));
    const client = createClient();

    await expect(client.workflows.getWorkflow('renew-session')).rejects.toThrow(
      'workflow session expired',
    );

    try {
      await client.workflows.getWorkflow('renew-session');
    } catch (err) {
      expect(err).toBeInstanceOf(ZatannaApiError);
      expect((err as ZatannaApiError).statusCode).toBe(409);
    }
  });
});
