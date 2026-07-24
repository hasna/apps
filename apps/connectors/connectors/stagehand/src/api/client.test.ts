import { afterEach, describe, expect, mock, test } from 'bun:test';
import { StagehandClient } from './client';
import { Stagehand } from './index';
import { StagehandApiError } from '../types';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function mockJson(body: unknown, status = 200) {
  return mock(async () =>
    new Response(JSON.stringify(body), {
      status,
      statusText: status >= 400 ? 'Error' : 'OK',
      headers: { 'content-type': 'application/json' },
    })
  );
}

function lastCall(fetchMock: ReturnType<typeof mockJson>) {
  const call = fetchMock.mock.calls[0] as unknown as [unknown, RequestInit] | undefined;
  return { url: String(call?.[0]), init: (call?.[1] ?? {}) as RequestInit };
}

function newApi() {
  return new Stagehand({
    browserbaseApiKey: 'bb_test_key_123456',
    browserbaseProjectId: 'proj_123',
    modelApiKey: 'model_test_key_123456',
    baseUrl: 'https://api.stagehand.browserbase.com',
  });
}

describe('StagehandClient', () => {
  test('requires Browserbase and model API keys', () => {
    expect(() => new StagehandClient({ browserbaseApiKey: '', modelApiKey: 'model' })).toThrow(
      'Browserbase API key is required'
    );
    expect(() => new StagehandClient({ browserbaseApiKey: 'bb', modelApiKey: '' })).toThrow(
      'Model API key is required'
    );
  });

  test('uses the official Browserbase Stagehand base URL by default', () => {
    const client = new StagehandClient({ browserbaseApiKey: 'bb', modelApiKey: 'model' });
    expect(client.getBaseUrl()).toBe('https://api.stagehand.browserbase.com');
  });

  test('sends Browserbase and model credential headers without bearer auth', async () => {
    const fetchMock = mockJson({ success: true, data: { sessionId: 's1', available: true } });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await newApi().startSession({ modelName: 'openai/gpt-5.4-mini' });

    const { url, init } = lastCall(fetchMock);
    expect(url).toBe('https://api.stagehand.browserbase.com/v1/sessions/start');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({
      'x-bb-api-key': 'bb_test_key_123456',
      'x-bb-project-id': 'proj_123',
      'x-model-api-key': 'model_test_key_123456',
      Accept: 'application/json',
      'Content-Type': 'application/json',
    });
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
    expect(JSON.parse(String(init.body))).toEqual({ modelName: 'openai/gpt-5.4-mini' });
  });

  test('maps API errors to StagehandApiError', async () => {
    const fetchMock = mockJson({ error: 'invalid credentials' }, 401);
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(newApi().startSession({ modelName: 'openai/gpt-5.4-mini' })).rejects.toBeInstanceOf(
      StagehandApiError
    );
  });
});

describe('Stagehand session API', () => {
  test('startSession POSTs to /v1/sessions/start', async () => {
    const fetchMock = mockJson({ success: true, data: { sessionId: 'session-1', available: true } });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await newApi().startSession({ modelName: 'openai/gpt-5.4-mini', selfHeal: true });

    const { url, init } = lastCall(fetchMock);
    expect(url).toBe('https://api.stagehand.browserbase.com/v1/sessions/start');
    expect(JSON.parse(String(init.body))).toMatchObject({
      modelName: 'openai/gpt-5.4-mini',
      selfHeal: true,
    });
  });

  test('navigate POSTs to /v1/sessions/{id}/navigate', async () => {
    const fetchMock = mockJson({ success: true, data: { result: { url: 'https://example.com' } } });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await newApi().navigate('session/1', { url: 'https://example.com' });

    const { url, init } = lastCall(fetchMock);
    expect(url).toBe('https://api.stagehand.browserbase.com/v1/sessions/session%2F1/navigate');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({ url: 'https://example.com' });
  });

  test('act POSTs action input to /act', async () => {
    const fetchMock = mockJson({ success: true, data: { result: { success: true } } });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await newApi().act('session-1', { input: 'Click the login button' });

    const { url, init } = lastCall(fetchMock);
    expect(url).toBe('https://api.stagehand.browserbase.com/v1/sessions/session-1/act');
    expect(JSON.parse(String(init.body))).toEqual({ input: 'Click the login button' });
  });

  test('observe POSTs instruction to /observe', async () => {
    const fetchMock = mockJson({ success: true, data: { result: [] } });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await newApi().observe('session-1', { instruction: 'Find navigation links' });

    const { url, init } = lastCall(fetchMock);
    expect(url).toBe('https://api.stagehand.browserbase.com/v1/sessions/session-1/observe');
    expect(JSON.parse(String(init.body))).toEqual({ instruction: 'Find navigation links' });
  });

  test('extract POSTs instruction and schema to /extract', async () => {
    const fetchMock = mockJson({ success: true, data: { result: { title: 'Example' } } });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await newApi().extract('session-1', {
      instruction: 'Extract page title',
      schema: { type: 'object', properties: { title: { type: 'string' } } },
    });

    const { url, init } = lastCall(fetchMock);
    expect(url).toBe('https://api.stagehand.browserbase.com/v1/sessions/session-1/extract');
    expect(JSON.parse(String(init.body))).toMatchObject({ instruction: 'Extract page title' });
  });

  test('agentExecute POSTs config and execute options to /agentExecute', async () => {
    const fetchMock = mockJson({ success: true, data: { result: { completed: true } } });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await newApi().agentExecute('session-1', {
      agentConfig: { model: 'openai/gpt-5.4-mini' },
      executeOptions: { instruction: 'Apply for this job', maxSteps: 5 },
    });

    const { url, init } = lastCall(fetchMock);
    expect(url).toBe('https://api.stagehand.browserbase.com/v1/sessions/session-1/agentExecute');
    expect(JSON.parse(String(init.body))).toMatchObject({
      agentConfig: { model: 'openai/gpt-5.4-mini' },
      executeOptions: { instruction: 'Apply for this job', maxSteps: 5 },
    });
  });

  test('replay GETs /replay and endSession POSTs /end', async () => {
    const fetchMock = mockJson({ success: true, data: {} });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await newApi().replay('session-1');
    await newApi().endSession('session-1');

    const replayCall = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const endCall = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
    expect(replayCall[0]).toBe('https://api.stagehand.browserbase.com/v1/sessions/session-1/replay');
    expect(replayCall[1].method).toBe('GET');
    expect(endCall[0]).toBe('https://api.stagehand.browserbase.com/v1/sessions/session-1/end');
    expect(endCall[1].method).toBe('POST');
  });

  test('rawRequest preserves arbitrary official paths and query params', async () => {
    const fetchMock = mockJson({ success: true, data: {} });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await newApi().rawRequest({
      path: '/v1/sessions/start',
      method: 'POST',
      query: { trace: true },
      body: { modelName: 'openai/gpt-5.4-mini' },
      headers: {
        Authorization: 'Bearer wrong',
        'x-bb-api-key': 'wrong',
        'x-bb-project-id': 'wrong',
        'x-model-api-key': 'wrong',
        'x-stream-response': 'false',
      },
    });

    const { url, init } = lastCall(fetchMock);
    expect(url).toBe('https://api.stagehand.browserbase.com/v1/sessions/start?trace=true');
    expect(init.headers).toMatchObject({
      'x-bb-api-key': 'bb_test_key_123456',
      'x-bb-project-id': 'proj_123',
      'x-model-api-key': 'model_test_key_123456',
      'x-stream-response': 'false',
    });
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
  });
});
