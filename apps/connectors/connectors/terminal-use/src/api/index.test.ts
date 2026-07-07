import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test';
import { Connector } from './index';

describe('Connector API operations', () => {
  const config = { token: 'tu_test_token' };
  let originalFetch: typeof global.fetch;
  let connector: Connector;

  beforeEach(() => {
    originalFetch = global.fetch;
    connector = new Connector(config);
    global.fetch = mock(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: () => Promise.resolve('{}'),
      } as Response)
    );
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  function lastCall(): [string, RequestInit] {
    return (global.fetch as ReturnType<typeof mock>).mock.calls.at(-1) as [string, RequestInit];
  }

  test('projects.list hits GET /projects', async () => {
    await connector.projects.list({ namespaceId: 'ns-1' });
    const [url, options] = lastCall();
    expect(url).toContain('/projects');
    expect(url).toContain('namespace_id=ns-1');
    expect(options.method).toBe('GET');
  });

  test('projects.create validates namespace_id', () => {
    expect(() => connector.projects.create({ name: 'demo' } as any)).toThrow('namespace_id is required');
  });

  test('projects.create posts snake_case body from camelCase args', async () => {
    await connector.projects.create({ namespaceId: 'ns-1', name: 'demo' });
    const [, options] = lastCall();
    expect(JSON.parse(String(options.body))).toEqual({ namespace_id: 'ns-1', name: 'demo' });
  });

  test('agents.list hits GET /agents', async () => {
    await connector.agents.list();
    expect(lastCall()[0]).toContain('/agents');
  });

  test('agents.get hits GET /agents/{id}', async () => {
    await connector.agents.get('agent-123');
    expect(lastCall()[0]).toContain('/agents/agent-123');
  });

  test('agents.getByName hits namespaced path', async () => {
    await connector.agents.getByName('my-ns', 'my-agent');
    expect(lastCall()[0]).toContain('/agents/name/my-ns/my-agent');
  });

  test('agents.deploy posts deploy payload', async () => {
    await connector.agents.deploy({ agentName: 'ns/agent', versionId: 'v1' });
    const [, options] = lastCall();
    expect(lastCall()[0]).toContain('/agents/deploy');
    expect(JSON.parse(String(options.body))).toEqual({ agent_name: 'ns/agent', version_id: 'v1' });
    expect(options.method).toBe('POST');
  });

  test('tasks.list supports camelCase agentId', async () => {
    await connector.tasks.list({ agentId: 'a1' });
    expect(lastCall()[0]).toContain('agent_id=a1');
  });

  test('tasks.create posts task body', async () => {
    await connector.tasks.create({ agentName: 'ns/agent', name: 'task-1' });
    const [, options] = lastCall();
    expect(JSON.parse(String(options.body))).toEqual({ agent_name: 'ns/agent', name: 'task-1' });
  });

  test('tasks.cancel posts cancel endpoint', async () => {
    await connector.tasks.cancel('task-1');
    expect(lastCall()[0]).toContain('/tasks/task-1/cancel');
  });

  test('tasks.sendTextEvent posts text content', async () => {
    await connector.tasks.sendTextEvent('task-1', { text: 'hello' });
    const [, options] = lastCall();
    expect(JSON.parse(String(options.body))).toEqual({ content: { type: 'text', text: 'hello' } });
  });

  test('tasks.sendDataEvent posts data content', async () => {
    await connector.tasks.sendDataEvent('task-1', { data: { foo: 'bar' } });
    const [, options] = lastCall();
    expect(JSON.parse(String(options.body))).toEqual({ content: { type: 'data', data: { foo: 'bar' } } });
  });

  test('tasks.stream opens SSE endpoint', async () => {
    global.fetch = mock(() => Promise.resolve({ ok: true, status: 200 } as Response));
    await connector.tasks.stream('task-1');
    expect(lastCall()[0]).toContain('/tasks/task-1/stream');
  });

  test('messages.list hits v2 endpoint with taskId alias', async () => {
    await connector.messages.list({ taskId: 'task-1' });
    expect(lastCall()[0]).toContain('/v2/messages');
    expect(lastCall()[0]).toContain('task_id=task-1');
  });

  test('messages.get hits message by id', async () => {
    await connector.messages.get('msg-1');
    expect(lastCall()[0]).toContain('/v2/messages/msg-1');
  });

  test('filesystems.create posts project_id alias', async () => {
    await connector.filesystems.create({ projectId: 'p1', name: 'fs' });
    const [, options] = lastCall();
    expect(JSON.parse(String(options.body))).toEqual({ project_id: 'p1', name: 'fs' });
  });

  test('filesystems.list hits GET /filesystems', async () => {
    await connector.filesystems.list({ projectId: 'p1' });
    expect(lastCall()[0]).toContain('/filesystems');
    expect(lastCall()[0]).toContain('project_id=p1');
  });

  test('filesystems.getFile encodes file path', async () => {
    await connector.filesystems.getFile('fs-1', 'dir/file.txt');
    expect(lastCall()[0]).toContain('/filesystems/fs-1/files/dir/file.txt');
  });

  test('filesystems.getUploadUrl posts upload-url action', async () => {
    await connector.filesystems.getUploadUrl('fs-1', { filePath: 'a.txt' });
    expect(lastCall()[0]).toContain('/filesystems/fs-1/upload-url');
  });

  test('filesystems.getDownloadUrl posts download-url action', async () => {
    await connector.filesystems.getDownloadUrl('fs-1', { path: 'a.txt' });
    expect(lastCall()[0]).toContain('/filesystems/fs-1/download-url');
  });

  test('filesystems.syncComplete posts sync-complete action', async () => {
    await connector.filesystems.syncComplete('fs-1', { manifest: 'm1' });
    expect(lastCall()[0]).toContain('/filesystems/fs-1/sync-complete');
  });

  test('rawRequest supports custom method and path', async () => {
    await connector.rawRequest({ path: '/search', method: 'POST', body: { q: 'test' } });
    const [url, options] = lastCall();
    expect(url).toContain('/search');
    expect(options.method).toBe('POST');
  });
});
