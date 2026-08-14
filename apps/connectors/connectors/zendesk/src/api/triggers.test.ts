import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test';
import { TriggersApi } from './triggers';
import { ZendeskClient } from './client';

describe('TriggersApi', () => {
  let client: ZendeskClient;
  let triggersApi: TriggersApi;
  let originalFetch: typeof global.fetch;

  const mockConfig = {
    email: 'test@example.com',
    apiToken: 'test-api-token-12345',
    baseUrl: 'https://test.zendesk.com/api/v2',
  };

  beforeEach(() => {
    client = new ZendeskClient(mockConfig);
    triggersApi = new TriggersApi(client);
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
    test('returns list of triggers', async () => {
      const mockTriggers = [
        { id: 1, title: 'Auto-reply trigger', active: true, actions: [] },
        { id: 2, title: 'Escalation trigger', active: false, actions: [] },
      ];
      mockFetch({ triggers: mockTriggers });

      const result = await triggersApi.list();

      expect(result).toEqual(mockTriggers);
    });

    test('filters by active status', async () => {
      mockFetch({ triggers: [] });

      await triggersApi.list({ active: true });

      const [url] = (global.fetch as ReturnType<typeof mock>).mock.calls[0];
      expect(url).toContain('active=true');
    });

    test('filters by category', async () => {
      mockFetch({ triggers: [] });

      await triggersApi.list({ category_id: 'notifications' });

      const [url] = (global.fetch as ReturnType<typeof mock>).mock.calls[0];
      expect(url).toContain('category_id=notifications');
    });
  });

  describe('listActive', () => {
    test('returns active triggers', async () => {
      mockFetch({ triggers: [{ id: 1, active: true, actions: [] }] });

      const result = await triggersApi.listActive();

      const [url] = (global.fetch as ReturnType<typeof mock>).mock.calls[0];
      expect(url).toContain('/triggers/active.json');
      expect(result.length).toBe(1);
    });
  });

  describe('get', () => {
    test('returns a single trigger', async () => {
      const mockTrigger = { id: 123, title: 'Test Trigger', active: true, actions: [] };
      mockFetch({ trigger: mockTrigger });

      const result = await triggersApi.get(123);

      expect(result).toEqual(mockTrigger);
      const [url] = (global.fetch as ReturnType<typeof mock>).mock.calls[0];
      expect(url).toContain('/triggers/123.json');
    });
  });

  describe('create', () => {
    test('creates a new trigger', async () => {
      const newTrigger = { id: 456, title: 'New Trigger', active: true, actions: [] };
      mockFetch({ trigger: newTrigger }, 201);

      const result = await triggersApi.create({
        trigger: {
          title: 'New Trigger',
          actions: [{ field: 'status', value: 'open' }],
          conditions: {
            all: [{ field: 'status', operator: 'is', value: 'new' }],
          },
        },
      });

      expect(result).toEqual(newTrigger);
      const [url, options] = (global.fetch as ReturnType<typeof mock>).mock.calls[0];
      expect(url).toContain('/triggers.json');
      expect(options.method).toBe('POST');
    });
  });

  describe('update', () => {
    test('updates a trigger', async () => {
      const updatedTrigger = { id: 123, title: 'Updated Trigger', active: false, actions: [] };
      mockFetch({ trigger: updatedTrigger });

      const result = await triggersApi.update(123, {
        trigger: { active: false },
      });

      expect(result).toEqual(updatedTrigger);
      const [, options] = (global.fetch as ReturnType<typeof mock>).mock.calls[0];
      expect(options.method).toBe('PUT');
    });
  });

  describe('delete', () => {
    test('deletes a trigger', async () => {
      global.fetch = mock(() =>
        Promise.resolve({
          ok: true,
          status: 204,
          headers: new Headers({}),
          text: () => Promise.resolve(''),
        } as Response)
      );

      await triggersApi.delete(123);

      const [url, options] = (global.fetch as ReturnType<typeof mock>).mock.calls[0];
      expect(url).toContain('/triggers/123.json');
      expect(options.method).toBe('DELETE');
    });
  });

  describe('reorder', () => {
    test('reorders triggers', async () => {
      mockFetch({});

      await triggersApi.reorder([3, 1, 2]);

      const [url, options] = (global.fetch as ReturnType<typeof mock>).mock.calls[0];
      expect(url).toContain('/triggers/reorder.json');
      expect(options.method).toBe('PUT');
      const body = JSON.parse(options.body);
      expect(body.trigger_ids).toEqual([3, 1, 2]);
    });
  });

  describe('search', () => {
    test('searches triggers by title', async () => {
      mockFetch({ triggers: [{ id: 1, title: 'Auto-reply', actions: [] }] });

      const result = await triggersApi.search('auto');

      expect(result.length).toBe(1);
      const [url] = (global.fetch as ReturnType<typeof mock>).mock.calls[0];
      expect(url).toContain('/triggers/search.json');
      expect(url).toContain('query=auto');
    });
  });

  describe('listRevisions', () => {
    test('lists trigger revisions', async () => {
      const mockRevisions = [
        { id: 1, author_id: 100, created_at: '2024-01-01', url: '/revisions/1' },
      ];
      mockFetch({ trigger_revisions: mockRevisions });

      const result = await triggersApi.listRevisions(123);

      expect(result).toEqual(mockRevisions);
      const [url] = (global.fetch as ReturnType<typeof mock>).mock.calls[0];
      expect(url).toContain('/triggers/123/revisions.json');
    });
  });

  describe('getRevision', () => {
    test('gets a specific revision', async () => {
      const mockTrigger = { id: 123, title: 'Old Version', actions: [] };
      mockFetch({ trigger: mockTrigger });

      const result = await triggersApi.getRevision(123, 1);

      expect(result).toEqual(mockTrigger);
      const [url] = (global.fetch as ReturnType<typeof mock>).mock.calls[0];
      expect(url).toContain('/triggers/123/revisions/1.json');
    });
  });
});
