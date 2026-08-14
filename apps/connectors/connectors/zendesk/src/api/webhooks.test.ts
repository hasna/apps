import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test';
import { WebhooksApi } from './webhooks';
import { ZendeskClient } from './client';

describe('WebhooksApi', () => {
  let client: ZendeskClient;
  let webhooksApi: WebhooksApi;
  let originalFetch: typeof global.fetch;

  const mockConfig = {
    email: 'test@example.com',
    apiToken: 'test-api-token-12345',
    baseUrl: 'https://test.zendesk.com/api/v2',
  };

  beforeEach(() => {
    client = new ZendeskClient(mockConfig);
    webhooksApi = new WebhooksApi(client);
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  const mockFetch = (response: unknown, status = 200) => {
    global.fetch = mock(() =>
      Promise.resolve({
        ok: status >= 200 && status < 300,
        status,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: () => Promise.resolve(JSON.stringify(response)),
      } as Response)
    );
  };

  describe('list', () => {
    test('returns list of webhooks', async () => {
      const mockWebhooks = [
        { id: 'wh-1', name: 'Slack notification', status: 'active', endpoint: 'https://slack.com/webhook' },
        { id: 'wh-2', name: 'CRM sync', status: 'inactive', endpoint: 'https://crm.com/api' },
      ];
      mockFetch({ webhooks: mockWebhooks });

      const result = await webhooksApi.list();

      expect(result).toEqual(mockWebhooks);
    });
  });

  describe('get', () => {
    test('returns a single webhook', async () => {
      const mockWebhook = { id: 'wh-123', name: 'Test Webhook', status: 'active', endpoint: 'https://example.com' };
      mockFetch({ webhook: mockWebhook });

      const result = await webhooksApi.get('wh-123');

      expect(result).toEqual(mockWebhook);
      const [url] = (global.fetch as ReturnType<typeof mock>).mock.calls[0];
      expect(url).toContain('/webhooks/wh-123.json');
    });
  });

  describe('create', () => {
    test('creates a new webhook', async () => {
      const newWebhook = { id: 'wh-456', name: 'New Webhook', status: 'active', endpoint: 'https://new.com' };
      mockFetch({ webhook: newWebhook }, 201);

      const result = await webhooksApi.create({
        webhook: {
          name: 'New Webhook',
          endpoint: 'https://new.com',
          http_method: 'POST',
          request_format: 'json',
        },
      });

      expect(result).toEqual(newWebhook);
      const [url, options] = (global.fetch as ReturnType<typeof mock>).mock.calls[0];
      expect(url).toContain('/webhooks.json');
      expect(options.method).toBe('POST');
    });

    test('creates webhook with authentication', async () => {
      mockFetch({ webhook: { id: 'wh-1' } }, 201);

      await webhooksApi.create({
        webhook: {
          name: 'Authenticated Webhook',
          endpoint: 'https://api.com',
          http_method: 'POST',
          request_format: 'json',
          authentication: {
            type: 'bearer',
            data: { token: 'secret-token' },
          },
        },
      });

      const [, options] = (global.fetch as ReturnType<typeof mock>).mock.calls[0];
      const body = JSON.parse(options.body);
      expect(body.webhook.authentication.type).toBe('bearer');
    });
  });

  describe('update', () => {
    test('updates a webhook', async () => {
      const updatedWebhook = { id: 'wh-123', name: 'Updated Webhook', status: 'inactive' };
      mockFetch({ webhook: updatedWebhook });

      const result = await webhooksApi.update('wh-123', {
        webhook: { status: 'inactive' },
      });

      expect(result).toEqual(updatedWebhook);
      const [url, options] = (global.fetch as ReturnType<typeof mock>).mock.calls[0];
      expect(url).toContain('/webhooks/wh-123.json');
      expect(options.method).toBe('PATCH');
    });
  });

  describe('delete', () => {
    test('deletes a webhook', async () => {
      global.fetch = mock(() =>
        Promise.resolve({
          ok: true,
          status: 204,
          headers: new Headers({}),
          text: () => Promise.resolve(''),
        } as Response)
      );

      await webhooksApi.delete('wh-123');

      const [url, options] = (global.fetch as ReturnType<typeof mock>).mock.calls[0];
      expect(url).toContain('/webhooks/wh-123.json');
      expect(options.method).toBe('DELETE');
    });
  });

  describe('clone', () => {
    test('clones a webhook', async () => {
      const clonedWebhook = { id: 'wh-789', name: 'Cloned Webhook' };
      mockFetch({ webhook: clonedWebhook }, 201);

      const result = await webhooksApi.clone('wh-123');

      expect(result).toEqual(clonedWebhook);
      const [, options] = (global.fetch as ReturnType<typeof mock>).mock.calls[0];
      const body = JSON.parse(options.body);
      expect(body.webhook.clone_webhook_id).toBe('wh-123');
    });
  });

  describe('test', () => {
    test('tests a webhook', async () => {
      const testResult = { webhook_invocation: { id: 'inv-1', status: 'success' } };
      mockFetch(testResult);

      const result = await webhooksApi.test('wh-123', { request: { test: true } });

      expect(result.webhook_invocation.status).toBe('success');
      const [url, options] = (global.fetch as ReturnType<typeof mock>).mock.calls[0];
      expect(url).toContain('/webhooks/wh-123/test.json');
      expect(options.method).toBe('POST');
    });
  });

  describe('getSigningSecret', () => {
    test('gets signing secret', async () => {
      mockFetch({ signing_secret: { secret: 'abc123' } });

      const result = await webhooksApi.getSigningSecret('wh-123');

      expect(result.signing_secret.secret).toBe('abc123');
      const [url] = (global.fetch as ReturnType<typeof mock>).mock.calls[0];
      expect(url).toContain('/webhooks/wh-123/signing_secret.json');
    });
  });

  describe('resetSigningSecret', () => {
    test('resets signing secret', async () => {
      mockFetch({ signing_secret: { secret: 'new-secret' } });

      const result = await webhooksApi.resetSigningSecret('wh-123');

      expect(result.signing_secret.secret).toBe('new-secret');
      const [, options] = (global.fetch as ReturnType<typeof mock>).mock.calls[0];
      expect(options.method).toBe('POST');
    });
  });

  describe('listInvocations', () => {
    test('lists webhook invocations', async () => {
      const mockInvocations = [
        { id: 'inv-1', webhook_id: 'wh-123', status: 'success' },
        { id: 'inv-2', webhook_id: 'wh-123', status: 'failure' },
      ];
      mockFetch({ invocations: mockInvocations });

      const result = await webhooksApi.listInvocations('wh-123');

      expect(result.invocations).toEqual(mockInvocations);
      const [url] = (global.fetch as ReturnType<typeof mock>).mock.calls[0];
      expect(url).toContain('/webhooks/wh-123/invocations.json');
    });
  });
});
