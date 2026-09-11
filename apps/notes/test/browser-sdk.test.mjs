import { describe, test, expect } from 'bun:test';
import { NotesClient, NotesApiError, normalizeNotesApiBase } from '../sdk/browser.mjs';
import fixture from '../sdk/fixtures/wire-v1.json';

function client(fetchImpl, overrides = {}) {
  return new NotesClient({ apiBase: fixture.apiBases[0], credential: () => 'fixture-credential', fetchImpl, ...overrides });
}

describe('explicit browser SDK', () => {
  test('bundles for browsers without Node or fleet credential dependencies', async () => {
    const result = await Bun.build({ entrypoints: [new URL('../sdk/browser.mjs', import.meta.url).pathname], target: 'browser', write: false });
    expect(result.success).toBe(true);
    const code = await result.outputs[0].text();
    expect(code).not.toMatch(/node:|child_process|process\.env|api\.hasna\.com/);
  });

  test('preserves each complete API base, encoded resource IDs and wire data', async () => {
    for (const apiBase of fixture.apiBases) {
      let seen;
      const sdk = client(async (url, init) => { seen = { url, init }; return Response.json(fixture.note); }, { apiBase });
      expect(await sdk.get('note/with space')).toEqual(fixture.note);
      expect(seen.url).toBe(apiBase + 'notes/note%2Fwith%20space');
      expect(seen.init.headers.authorization).toBe('Bearer fixture-credential');
      expect(seen.init.credentials).toBe('omit');
      expect(seen.init.redirect).toBe('manual');
    }
  });

  test('refuses unsafe or partial authorities', () => {
    for (const apiBase of ['', '/api/v1', 'http://notes.example.com/v1', 'https://user:pass@notes.example.com/v1', 'https://notes.example.com/v1?key=x', 'https://notes.example.com/v1#x']) {
      expect(() => client(fetch, { apiBase })).toThrow(NotesApiError);
    }
    expect(normalizeNotesApiBase('http://127.0.0.1:8080/api/v1', { allowHttpLoopback: true })).toBe('http://127.0.0.1:8080/api/v1/');
    expect(() => client(fetch, { apiBase: 'http://127.0.0.1:8080/v1' })).toThrow();
    expect(() => client(fetch, { credential: undefined })).toThrow();
  });

  test('re-resolves credentials and refuses a missing session before sending', async () => {
    let credential = 'first';
    const seen = [];
    const sdk = client(async (_, init) => { seen.push(init.headers.authorization); return Response.json({ data: [] }); }, { credential: () => credential });
    await sdk.list(); credential = 'second'; await sdk.list(); credential = null;
    await expect(sdk.list()).rejects.toMatchObject({ code: 'missing_credential' });
    expect(seen).toEqual(['Bearer first', 'Bearer second']);
  });

  test('encodes page filters and does not truncate large sequence strings', async () => {
    let seen;
    const sdk = client(async (url) => { seen = new URL(url); return Response.json({ changes: [{ sequence: fixture.largeSequence }], cursor: fixture.changeCursor, hasMore: true }); });
    await sdk.list({ cursor: fixture.listCursor, limit: 200, includeDeleted: true, label: '日本語', search: 'tea & coffee' });
    expect(Object.fromEntries(seen.searchParams)).toEqual({ cursor: fixture.listCursor, limit: '200', include_deleted: '1', label: '日本語', search: 'tea & coffee' });
    const result = await sdk.changes({ cursor: fixture.changeCursor });
    expect(result.changes[0].sequence).toBe('9007199254740993');
    expect(result.hasMore).toBe(true);
  });

  test('sends mutation revisions and stable caller idempotency keys exactly once', async () => {
    const requests = [];
    const sdk = client(async (url, init) => { requests.push({ url, ...init }); return Response.json(fixture.note); });
    await sdk.create({ bodyMarkdown: fixture.note.bodyMarkdown }, { idempotencyKey: 'create:fixture-1' });
    await sdk.update(fixture.note.id, { title: 'New', baseRevision: 7 }, { idempotencyKey: 'update:fixture-1' });
    await sdk.delete(fixture.note.id, { baseRevision: 8 });
    await sdk.restore(fixture.note.id, { baseRevision: 9 });
    expect(requests.map(r => r.method)).toEqual(['POST', 'PATCH', 'DELETE', 'POST']);
    expect(requests[0].headers['idempotency-key']).toBe('create:fixture-1');
    expect(JSON.parse(requests[0].body).bodyMarkdown).toBe(fixture.note.bodyMarkdown);
    expect(JSON.parse(requests[1].body).baseRevision).toBe(7);
    expect(JSON.parse(requests[2].body)).toEqual({ baseRevision: 8 });
    expect(requests[3].url).toEndWith(`/notes/${fixture.note.id}/restore`);
    expect(JSON.parse(requests[3].body)).toEqual({ baseRevision: 9 });
  });

  test('labels and export use bounded encoded paths', async () => {
    const seen = [];
    const sdk = client(async (url, init) => { seen.push([url, init.method, init.body]); return Response.json({ data: [] }); });
    await sdk.labels(); await sdk.renameLabel('ideas/old', 'New'); await sdk.deleteLabel('日本語'); await sdk.export();
    expect(seen.map(r => r[1])).toEqual(['GET', 'PATCH', 'DELETE', 'POST']);
    expect(seen[1][0]).toEndWith('/labels/ideas%2Fold');
    expect(JSON.parse(seen[1][2])).toEqual({ name: 'New' });
    expect(() => sdk.get('..')).toThrow();
  });

  test('conflicts preserve the current note and redact reflected credentials', async () => {
    const sdk = client(async () => Response.json({ error: { code: 'revision_conflict', message: 'Rejected fixture-credential', details: { current: fixture.note, echoed: ['fixture-credential'] } } }, { status: 409 }));
    await expect(sdk.update(fixture.note.id, { baseRevision: 1 })).rejects.toMatchObject({ status: 409, code: 'revision_conflict', message: 'Rejected [REDACTED]', details: { current: fixture.note, echoed: ['[REDACTED]'] } });
  });

  test('rejects redirects, and auth failures without consuming error bodies', async () => {
    for (const status of [301, 302, 307, 401, 403]) {
      let cancelled = false;
      const sdk = client(async () => new Response(new ReadableStream({ cancel() { cancelled = true; } }), { status }));
      await expect(sdk.get('fixture')).rejects.toMatchObject({ status });
      expect(cancelled).toBe(true);
    }
  });

  test('bounds chunked response bytes and refuses invalid JSON', async () => {
    const oversized = client(async () => new Response(new ReadableStream({ start(c) { c.enqueue(new Uint8Array(64)); c.enqueue(new Uint8Array(64)); c.close(); } })), { maxResponseBytes: 100 });
    await expect(oversized.list()).rejects.toMatchObject({ code: 'response_too_large' });
    await expect(client(async () => new Response('not json')).list()).rejects.toMatchObject({ code: 'invalid_json' });
  });

  test('does not reflect transport/provider error details', async () => {
    const sdk = client(async () => { throw new Error('Authorization: Bearer fixture-credential'); });
    await expect(sdk.list()).rejects.toMatchObject({ code: 'network_error' });
    try { await sdk.list(); } catch (error) { expect(String(error)).not.toContain('fixture-credential'); }
  });

  test('cancels an in-flight request and refuses an already-cancelled request', async () => {
    const controller = new AbortController();
    let count = 0;
    const sdk = client(async (_, init) => { count++; controller.abort(); init.signal.throwIfAborted(); });
    await expect(sdk.list({ signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    await expect(sdk.list({ signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(count).toBe(1);
  });

  test('times out a stalled network request', async () => {
    const sdk = client((_, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason))), { timeoutMs: 5 });
    await expect(sdk.list()).rejects.toMatchObject({ name: 'TimeoutError' });
  });

  test('also bounds a stalled credential provider without sending a request', async () => {
    let sent = false;
    const sdk = client(async () => { sent = true; return Response.json({}); }, { credential: () => new Promise(() => {}), timeoutMs: 5 });
    await expect(sdk.list()).rejects.toMatchObject({ name: 'TimeoutError' });
    expect(sent).toBe(false);
  });

  test('uses the same wire operations against an actual HTTP server', async () => {
    const server = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch(request) {
      if (request.headers.get('authorization') !== 'Bearer fixture-credential') return new Response(null, { status: 401 });
      const url = new URL(request.url);
      if (url.pathname === '/api/v1/notes' && request.method === 'GET') return Response.json({ data: [fixture.note], nextCursor: null, hasMore: false });
      if (url.pathname.endsWith('/restore') && request.method === 'POST') return Response.json(fixture.note);
      return new Response(null, { status: 404 });
    } });
    try {
      const sdk = client(fetch, { apiBase: `http://127.0.0.1:${server.port}/api/v1/`, allowHttpLoopback: true });
      expect((await sdk.list()).data[0]).toEqual(fixture.note);
      expect(await sdk.restore(fixture.note.id)).toEqual(fixture.note);
    } finally { await server.stop(true); }
  });
});
