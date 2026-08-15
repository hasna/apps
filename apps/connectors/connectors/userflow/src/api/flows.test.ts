import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { UserflowClient } from './client';
import { FlowsApi } from './flows';
import { WebhooksApi } from './webhooks';
import { SegmentsApi } from './metadata';

describe('FlowsApi', () => {
  let originalFetch: typeof global.fetch;
  let lastUrl = '';
  let lastMethod = '';
  let lastBody: unknown;

  beforeEach(() => {
    originalFetch = global.fetch;
    global.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
      lastUrl = typeof _input === 'string' ? _input : _input.toString();
      lastMethod = init?.method ?? 'GET';
      lastBody = init?.body ? JSON.parse(String(init.body)) : undefined;
      return Response.json({ ok: true });
    }) as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  const api = new FlowsApi(new UserflowClient({ apiKey: 'uf-key' }));

  test('startFlowForUser POSTs to flow-scoped /start endpoint', async () => {
    await api.startFlowForUser({
      flow_id: 'flow-1',
      user_id: 'u-1',
      idempotency_key: 'abc',
    });

    expect(lastMethod).toBe('POST');
    expect(lastUrl).toBe('https://api.userflow.com/v2/flows/flow-1/start');
    expect(lastBody).toEqual({ user_id: 'u-1', idempotency_key: 'abc' });
  });

  test('listFlowProgress uses encoded flow id', async () => {
    await api.listFlowProgress('flow/1', { limit: 22 });
    const url = new URL(lastUrl);
    expect(url.pathname).toBe('/v2/flows/flow%2F1/progress');
    expect(url.searchParams.get('limit')).toBe('22');
  });
});

describe('WebhooksApi', () => {
  test('createWebhookEndpoint requires non-empty enabled_events', async () => {
    const api = new WebhooksApi(new UserflowClient({ apiKey: 'uf-key' }));
    await expect(
      api.createWebhookEndpoint({
        url: 'https://example.com/hook',
        enabled_events: [],
      }),
    ).rejects.toThrow('Userflow: enabled_events is required');

    await expect(
      api.createWebhookEndpoint({
        url: 'https://example.com/hook',
        enabled_events: ['user.created', ' '],
      }),
    ).rejects.toThrow('Userflow: enabled_events is required');
  });
});

describe('SegmentsApi', () => {
  test('rejects invalid entity before network access', async () => {
    const api = new SegmentsApi(new UserflowClient({ apiKey: 'uf-key' }));
    await expect(api.listSegments({ entity: 'account' as 'user' })).rejects.toThrow(
      'Userflow: entity must be one of user, group',
    );
  });
});
