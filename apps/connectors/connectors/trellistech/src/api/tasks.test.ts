import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test';
import { TasksApi } from './tasks';
import { TrellistechClient } from './client';

describe('TasksApi', () => {
  const mockConfig = {
    apiKey: 'trls_test_key',
    workspaceId: 'haven-vacation-rentals',
    baseUrl: 'https://app.trellistech.com/api/v1',
  };

  let client: TrellistechClient;
  let tasks: TasksApi;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    client = new TrellistechClient(mockConfig);
    tasks = new TasksApi(client);
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  const getFetchMock = () => global.fetch as unknown as ReturnType<typeof mock>;

  const mockFetch = (response: unknown, status = 200) => {
    global.fetch = mock(() =>
      Promise.resolve({
        ok: status >= 200 && status < 300,
        status,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: () => Promise.resolve(JSON.stringify(response)),
      } as Response)
    ) as unknown as typeof fetch;
  };

  test('list GETs workspace tasks with filters', async () => {
    mockFetch({ items: [], pagination: { total: 0, limit: 50, offset: 0, hasMore: false } });

    await tasks.list({
      limit: 10,
      status: 'OPEN',
      priority: 'HIGH',
      propertyId: '11111111-1111-4111-8111-111111111111',
      q: 'light bulb',
    });

    const [url, options] = getFetchMock().mock.calls[0];
    expect(url).toContain('/workspaces/haven-vacation-rentals/tasks');
    expect(url).toContain('status=OPEN');
    expect(url).toContain('priority=HIGH');
    expect(url).toContain('propertyId=11111111-1111-4111-8111-111111111111');
    expect(url).toContain('q=light');
    expect(options.method).toBe('GET');
  });

  test('get GETs single task', async () => {
    const task = { id: '22222222-2222-4222-8222-222222222222', title: 'Fix light' };
    mockFetch({ task });

    const result = await tasks.get('22222222-2222-4222-8222-222222222222');

    expect(result.title).toBe('Fix light');
    const [url] = getFetchMock().mock.calls[0];
    expect(url).toContain('/tasks/22222222-2222-4222-8222-222222222222');
  });

  test('create POSTs task body', async () => {
    mockFetch({ task: { id: 't1', title: 'New task' } }, 201);

    await tasks.create({
      title: 'Replace bulb',
      departmentId: '33333333-3333-4333-8333-333333333333',
    });

    const [url, options] = getFetchMock().mock.calls[0];
    expect(url).toContain('/workspaces/haven-vacation-rentals/tasks');
    expect(options.method).toBe('POST');
    expect(JSON.parse(options.body).departmentId).toBe('33333333-3333-4333-8333-333333333333');
  });

  test('update PATCHes task', async () => {
    mockFetch({ task: { id: 't1', status: 'COMPLETED' } });

    await tasks.update('t1', { status: 'COMPLETED' });

    const [, options] = getFetchMock().mock.calls[0];
    expect(options.method).toBe('PATCH');
  });

  test('delete DELETEs task', async () => {
    mockFetch({ deleted: true, taskId: 't1' });

    const result = await tasks.delete('t1');

    expect(result.deleted).toBe(true);
    const [, options] = getFetchMock().mock.calls[0];
    expect(options.method).toBe('DELETE');
  });
});
