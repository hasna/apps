import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test';
import { TalendClient } from './client';
import { TalendApiPlatform } from './index';
import { TalendApiError } from '../types';

// ============================================
// TalendClient
// ============================================

describe('TalendClient', () => {
  test('requires a token', () => {
    expect(() => new TalendClient({ token: '' })).toThrow('token is required');
  });

  test('resolves the US base URL by default', () => {
    const client = new TalendClient({ token: 'tkn' });
    expect(client.baseUrl).toBe('https://api.us.cloud.talend.com/tmc/v1.2');
  });

  test('resolves per-region base URLs', () => {
    expect(new TalendClient({ token: 't', region: 'eu' }).baseUrl).toBe('https://api.eu.cloud.talend.com/tmc/v1.2');
    expect(new TalendClient({ token: 't', region: 'ap' }).baseUrl).toBe('https://api.ap.cloud.talend.com/tmc/v1.2');
  });

  test('throws for an unknown region', () => {
    expect(() => new TalendClient({ token: 't', region: 'moon' as any })).toThrow('Unknown Talend region');
  });

  test('baseUrl override wins over region and trailing slashes are trimmed', () => {
    const client = new TalendClient({ token: 't', region: 'eu', baseUrl: 'https://talend.example.com/tmc/v1.2/' });
    expect(client.baseUrl).toBe('https://talend.example.com/tmc/v1.2');
  });

  test('getTokenPreview masks the token', () => {
    expect(new TalendClient({ token: 'abcdef1234567890' }).getTokenPreview()).toBe('abcdef...7890');
    expect(new TalendClient({ token: 'short' }).getTokenPreview()).toBe('***');
  });
});

// ============================================
// Request building (mocked fetch)
// ============================================

describe('TalendClient.request', () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = originalFetch; });

  test('sends Bearer auth and appends query params', async () => {
    let captured: { url: string; init: RequestInit } | undefined;
    globalThis.fetch = mock((url: string, init: RequestInit) => {
      captured = { url, init };
      return Promise.resolve(new Response(JSON.stringify({ items: [] }), { status: 200 }));
    }) as any;

    const client = new TalendClient({ token: 'secret-token' });
    await client.request('/executables', { params: { limit: 5, offset: 10, environmentId: undefined } });

    expect(captured!.url).toContain('https://api.us.cloud.talend.com/tmc/v1.2/executables');
    expect(captured!.url).toContain('limit=5');
    expect(captured!.url).toContain('offset=10');
    // undefined params are skipped
    expect(captured!.url).not.toContain('environmentId');
    expect((captured!.init.headers as Record<string, string>).Authorization).toBe('Bearer secret-token');
  });

  test('serializes a JSON body for POST', async () => {
    let captured: RequestInit | undefined;
    globalThis.fetch = mock((_url: string, init: RequestInit) => {
      captured = init;
      return Promise.resolve(new Response(JSON.stringify({ executionId: 'exec-1' }), { status: 200 }));
    }) as any;

    const client = new TalendClient({ token: 't' });
    const result = await client.request<{ executionId: string }>('/executions', {
      method: 'POST',
      body: { executable: 'task-1' },
    });

    expect(captured!.method).toBe('POST');
    expect((captured!.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    expect(captured!.body).toBe(JSON.stringify({ executable: 'task-1' }));
    expect(result.executionId).toBe('exec-1');
  });

  test('returns an empty object on 204', async () => {
    globalThis.fetch = mock(() => Promise.resolve(new Response(null, { status: 204 }))) as any;
    const client = new TalendClient({ token: 't' });
    expect(await client.request<Record<string, unknown>>('/executions/exec-1', { method: 'DELETE' })).toEqual({});
  });

  test('throws TalendApiError with parsed message and code on failure', async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response(JSON.stringify({ error: 'Invalid token', errorCode: 'UNAUTHORIZED' }), { status: 401 }))
    ) as any;
    const client = new TalendClient({ token: 't' });

    try {
      await client.request('/executables');
      throw new Error('expected request to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(TalendApiError);
      const apiErr = err as TalendApiError;
      expect(apiErr.message).toBe('Invalid token');
      expect(apiErr.statusCode).toBe(401);
      expect(apiErr.errorCode).toBe('UNAUTHORIZED');
    }
  });

  test('falls back to status text when the error body is not JSON', async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response('gateway down', { status: 502, statusText: 'Bad Gateway' }))
    ) as any;
    const client = new TalendClient({ token: 't' });
    await expect(client.request('/executables')).rejects.toThrow('gateway down');
  });
});

// ============================================
// TalendApiPlatform
// ============================================

describe('TalendApiPlatform', () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = originalFetch; });

  test('fromEnv throws without TALEND_API_TOKEN', () => {
    const orig = process.env.TALEND_API_TOKEN;
    delete process.env.TALEND_API_TOKEN;
    expect(() => TalendApiPlatform.fromEnv()).toThrow('TALEND_API_TOKEN environment variable is required');
    if (orig) process.env.TALEND_API_TOKEN = orig;
  });

  test('fromEnv builds a client from env vars', () => {
    const origToken = process.env.TALEND_API_TOKEN;
    const origRegion = process.env.TALEND_REGION;
    process.env.TALEND_API_TOKEN = 'env-token-123456';
    process.env.TALEND_REGION = 'eu';

    const connector = TalendApiPlatform.fromEnv();
    expect(connector.getTokenPreview()).toBe('env-to...3456');
    expect(connector.getClient().baseUrl).toBe('https://api.eu.cloud.talend.com/tmc/v1.2');

    if (origToken) process.env.TALEND_API_TOKEN = origToken; else delete process.env.TALEND_API_TOKEN;
    if (origRegion) process.env.TALEND_REGION = origRegion; else delete process.env.TALEND_REGION;
  });

  describe('list operations', () => {
    let connector: TalendApiPlatform;
    beforeEach(() => { connector = new TalendApiPlatform({ token: 't' }); });

    test('listTasks unwraps a paginated envelope', async () => {
      globalThis.fetch = mock(() =>
        Promise.resolve(new Response(JSON.stringify({ items: [{ executable: 'e1', name: 'Task 1' }], total: 1 }), { status: 200 }))
      ) as any;
      const tasks = await connector.listTasks();
      expect(tasks).toHaveLength(1);
      expect(tasks[0].executable).toBe('e1');
    });

    test('listTasks handles a bare array response', async () => {
      globalThis.fetch = mock(() =>
        Promise.resolve(new Response(JSON.stringify([{ executable: 'a', name: 'A' }, { executable: 'b', name: 'B' }]), { status: 200 }))
      ) as any;
      expect(await connector.listTasks()).toHaveLength(2);
    });

    test('listPlans tolerates an unexpected object shape', async () => {
      globalThis.fetch = mock(() =>
        Promise.resolve(new Response(JSON.stringify({ unexpected: true }), { status: 200 }))
      ) as any;
      expect(await connector.listPlans()).toEqual([]);
    });
  });

  describe('execution operations', () => {
    let connector: TalendApiPlatform;
    beforeEach(() => { connector = new TalendApiPlatform({ token: 't' }); });

    test('runTask posts to /executions and returns the reference', async () => {
      let captured: { url: string; init: RequestInit } | undefined;
      globalThis.fetch = mock((url: string, init: RequestInit) => {
        captured = { url, init };
        return Promise.resolve(new Response(JSON.stringify({ executionId: 'run-1' }), { status: 200 }));
      }) as any;

      const ref = await connector.runTask({ executable: 'task-9', parameters: { foo: 'bar' } });
      expect(ref.executionId).toBe('run-1');
      expect(captured!.url).toContain('/tmc/v1.2/executions');
      expect(captured!.init.method).toBe('POST');
      expect(JSON.parse(captured!.init.body as string)).toEqual({ executable: 'task-9', parameters: { foo: 'bar' } });
    });

    test('getExecution reads status by id', async () => {
      let capturedUrl = '';
      globalThis.fetch = mock((url: string) => {
        capturedUrl = url;
        return Promise.resolve(new Response(JSON.stringify({ executionId: 'run-1', status: 'RUNNING' }), { status: 200 }));
      }) as any;

      const exec = await connector.getExecution('run-1');
      expect(exec.status).toBe('RUNNING');
      expect(capturedUrl).toContain('/executions/run-1');
    });

    test('runPlan posts the plan id as executable', async () => {
      let body = '';
      globalThis.fetch = mock((_url: string, init: RequestInit) => {
        body = init.body as string;
        return Promise.resolve(new Response(JSON.stringify({ executionId: 'plan-run-1' }), { status: 200 }));
      }) as any;

      const ref = await connector.runPlan('plan-3');
      expect(ref.executionId).toBe('plan-run-1');
      expect(JSON.parse(body)).toEqual({ executable: 'plan-3' });
    });
  });
});

// ============================================
// TalendApiError
// ============================================

describe('TalendApiError', () => {
  test('carries status code and optional error code', () => {
    const err = new TalendApiError('boom', 500, 'INTERNAL');
    expect(err.message).toBe('boom');
    expect(err.statusCode).toBe(500);
    expect(err.errorCode).toBe('INTERNAL');
    expect(err.name).toBe('TalendApiError');
  });
});
