import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test';
import { ViewsApi } from './views';
import { ZendeskClient } from './client';

describe('ViewsApi', () => {
  let client: ZendeskClient;
  let viewsApi: ViewsApi;
  let originalFetch: typeof global.fetch;

  const mockConfig = {
    email: 'test@example.com',
    apiToken: 'test-api-token-12345',
    baseUrl: 'https://test.zendesk.com/api/v2',
  };

  beforeEach(() => {
    client = new ZendeskClient(mockConfig);
    viewsApi = new ViewsApi(client);
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
    test('returns list of views', async () => {
      const mockViews = [
        { id: 1, title: 'All Unsolved Tickets', active: true },
        { id: 2, title: 'My Open Tickets', active: true },
      ];
      mockFetch({ views: mockViews });

      const result = await viewsApi.list();

      expect(result).toEqual(mockViews);
    });

    test('passes filter params', async () => {
      mockFetch({ views: [] });

      await viewsApi.list({ active: true, group_id: 123 });

      const [url] = (global.fetch as ReturnType<typeof mock>).mock.calls[0];
      expect(url).toContain('active=true');
      expect(url).toContain('group_id=123');
    });
  });

  describe('listActive', () => {
    test('returns active views', async () => {
      mockFetch({ views: [{ id: 1, active: true }] });

      const result = await viewsApi.listActive();

      const [url] = (global.fetch as ReturnType<typeof mock>).mock.calls[0];
      expect(url).toContain('/views/active.json');
      expect(result.length).toBe(1);
    });
  });

  describe('listCompact', () => {
    test('returns compact view list', async () => {
      mockFetch({ views: [{ id: 1, title: 'View' }] });

      await viewsApi.listCompact();

      const [url] = (global.fetch as ReturnType<typeof mock>).mock.calls[0];
      expect(url).toContain('/views/compact.json');
    });
  });

  describe('get', () => {
    test('returns a single view', async () => {
      const mockView = { id: 123, title: 'Test View', active: true };
      mockFetch({ view: mockView });

      const result = await viewsApi.get(123);

      expect(result).toEqual(mockView);
      const [url] = (global.fetch as ReturnType<typeof mock>).mock.calls[0];
      expect(url).toContain('/views/123.json');
    });
  });

  describe('create', () => {
    test('creates a new view', async () => {
      const newView = { id: 456, title: 'New View', active: true };
      mockFetch({ view: newView }, 201);

      const result = await viewsApi.create({
        view: {
          title: 'New View',
          conditions: {
            all: [{ field: 'status', operator: 'is', value: 'open' }],
          },
        },
      });

      expect(result).toEqual(newView);
      const [url, options] = (global.fetch as ReturnType<typeof mock>).mock.calls[0];
      expect(url).toContain('/views.json');
      expect(options.method).toBe('POST');
    });
  });

  describe('update', () => {
    test('updates a view', async () => {
      const updatedView = { id: 123, title: 'Updated View' };
      mockFetch({ view: updatedView });

      const result = await viewsApi.update(123, {
        view: { title: 'Updated View' },
      });

      expect(result).toEqual(updatedView);
      const [, options] = (global.fetch as ReturnType<typeof mock>).mock.calls[0];
      expect(options.method).toBe('PUT');
    });
  });

  describe('delete', () => {
    test('deletes a view', async () => {
      global.fetch = mock(() =>
        Promise.resolve({
          ok: true,
          status: 204,
          headers: new Headers({}),
          text: () => Promise.resolve(''),
        } as Response)
      );

      await viewsApi.delete(123);

      const [url, options] = (global.fetch as ReturnType<typeof mock>).mock.calls[0];
      expect(url).toContain('/views/123.json');
      expect(options.method).toBe('DELETE');
    });
  });

  describe('execute', () => {
    test('executes a view', async () => {
      const mockResult = {
        rows: [{ ticket: { id: 1 } }],
        count: 1,
      };
      mockFetch(mockResult);

      const result = await viewsApi.execute(123);

      expect(result).toEqual(mockResult);
      const [url] = (global.fetch as ReturnType<typeof mock>).mock.calls[0];
      expect(url).toContain('/views/123/execute.json');
    });
  });

  describe('count', () => {
    test('gets view count', async () => {
      const mockCount = { view_count: { view_id: 123, value: 42, pretty: '42', fresh: true } };
      mockFetch(mockCount);

      const result = await viewsApi.count(123);

      expect(result.view_count.value).toBe(42);
      const [url] = (global.fetch as ReturnType<typeof mock>).mock.calls[0];
      expect(url).toContain('/views/123/count.json');
    });
  });

  describe('counts', () => {
    test('gets multiple view counts', async () => {
      mockFetch({ view_counts: [{ view_id: 1, value: 10 }, { view_id: 2, value: 20 }] });

      const result = await viewsApi.counts([1, 2]);

      expect(result.view_counts.length).toBe(2);
      const [url] = (global.fetch as ReturnType<typeof mock>).mock.calls[0];
      expect(url).toContain('/views/count_many.json');
      expect(url).toContain('ids=1%2C2');
    });
  });

  describe('search', () => {
    test('searches views by title', async () => {
      mockFetch({ views: [{ id: 1, title: 'Urgent' }] });

      const result = await viewsApi.search('urgent');

      expect(result.length).toBe(1);
      const [url] = (global.fetch as ReturnType<typeof mock>).mock.calls[0];
      expect(url).toContain('/views/search.json');
      expect(url).toContain('query=urgent');
    });
  });

  describe('preview', () => {
    test('previews a view', async () => {
      mockFetch({ rows: [], count: 0 });

      await viewsApi.preview({
        view: {
          title: 'Preview',
          conditions: { all: [] },
        },
      });

      const [url, options] = (global.fetch as ReturnType<typeof mock>).mock.calls[0];
      expect(url).toContain('/views/preview.json');
      expect(options.method).toBe('POST');
    });
  });
});
