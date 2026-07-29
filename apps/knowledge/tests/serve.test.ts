import { describe, expect, test } from 'bun:test';
import { mintApiKey } from '@hasna/contracts/auth';
import { verifyApiKey } from '@hasna/contracts/auth';
import { ApiKeyStore } from '@hasna/contracts/auth';
import { createServeHandler, knowledgeOpenApi, normalizeCloudDatabaseUrl } from '../src/serve.ts';

const SIGNING = 'test-signing-secret-not-a-real-key';

// In-memory query client shim implementing the subset the serve/store use.
function makeMemoryClient() {
  const rows: Record<string, Record<string, unknown>>[] = [] as any;
  const items = new Map<string, Record<string, unknown>>();
  const apiKeys = new Map<string, Record<string, unknown>>();

  const client: any = {
    async query(sql: string, params: unknown[] = []) {
      return runSql(sql, params);
    },
    async many(sql: string, params: unknown[] = []) {
      return (await runSql(sql, params)).rows;
    },
    async get(sql: string, params: unknown[] = []) {
      return (await runSql(sql, params)).rows[0] ?? null;
    },
    async one(sql: string, params: unknown[] = []) {
      const r = (await runSql(sql, params)).rows[0];
      if (!r) throw new Error('no rows');
      return r;
    },
    async execute(sql: string, params: unknown[] = []) {
      await runSql(sql, params);
    },
    async close() {},
    get pool() {
      return {} as any;
    },
  };

  async function runSql(sql: string, params: unknown[] = []) {
    const s = sql.trim().toLowerCase();
    // health/ready probe
    if (s.startsWith('select 1')) return { rows: [{ '?column?': 1 }], rowCount: 1 };
    // api_keys store: findByKid / isRevoked etc — treat all unknown kids as absent (not revoked)
    if (s.includes('from api_keys')) return { rows: [], rowCount: 0 };
    if (s.startsWith('update api_keys')) return { rows: [], rowCount: 0 };
    if (s.startsWith('insert into api_keys')) return { rows: [], rowCount: 0 };
    // knowledge_items
    if (s.startsWith('insert into knowledge_items')) {
      const [id, short_id, title, content, url, tags, metadata] = params as any[];
      const now = new Date().toISOString();
      const row = {
        id,
        short_id,
        title,
        content,
        url,
        tags,
        metadata,
        archived: false,
        created_at: now,
        updated_at: now,
      };
      items.set(id, row);
      return { rows: [row], rowCount: 1 };
    }
    if (s.startsWith('select count(*)') && s.includes('knowledge_items')) {
      return { rows: [{ count: String(items.size) }], rowCount: 1 };
    }
    if (s.startsWith('select * from knowledge_items where')) {
      const key = params[0];
      const found = [...items.values()].find((r) => r.id === key || r.short_id === key);
      return { rows: found ? [found] : [], rowCount: found ? 1 : 0 };
    }
    if (s.startsWith('select * from knowledge_items')) {
      return { rows: [...items.values()], rowCount: items.size };
    }
    if (s.startsWith('update knowledge_items')) {
      const id = params[params.length - 1];
      const row = items.get(id as string);
      if (!row) return { rows: [], rowCount: 0 };
      // naive: apply title/content when present in the sql
      const updated = { ...row, updated_at: new Date().toISOString() };
      // apply provided columns heuristically by matching set clause order is complex;
      // for the test we just bump content/tags if provided
      items.set(id as string, updated);
      return { rows: [updated], rowCount: 1 };
    }
    if (s.startsWith('delete from knowledge_items')) {
      items.delete(params[0] as string);
      return { rows: [], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  }

  return client;
}

function keyFor(scopes: string[]): string {
  return mintApiKey({ app: 'knowledge', scopes, signingSecret: SIGNING }).token;
}

function buildHandler() {
  const client = makeMemoryClient();
  const store = new ApiKeyStore(client);
  const verifier = verifyApiKey({ app: 'knowledge', signingSecret: SIGNING, isRevoked: store.isRevoked });
  return createServeHandler({ client, verifier, store, version: '9.9.9' });
}

describe('knowledge-serve', () => {
  test('health/ready/version are public and shaped', async () => {
    const h = buildHandler();
    for (const path of ['/health', '/version', '/ready']) {
      const res = await h(new Request(`http://x${path}`));
      expect(res.status).toBe(200);
      const body = (await res.json()) as { status: string; version: string; mode: string };
      expect(body.version).toBe('9.9.9');
      expect(body.mode).toBe('cloud');
      expect(typeof body.status).toBe('string');
    }
  });

  test('openapi.json is served and covers notes ops', async () => {
    const h = buildHandler();
    const res = await h(new Request('http://x/openapi.json'));
    expect(res.status).toBe(200);
    const spec = (await res.json()) as { paths: Record<string, unknown>; info: { description: string } };
    expect(Object.keys(spec.paths)).toContain('/v1/notes');
    expect(Object.keys(spec.paths)).toContain('/v1/notes/{id}');
    // Retired deployment-mode vocabulary must not reach user-facing output
    // (owner directive 2026-07-29). Positive control: the description exists.
    expect(spec.info.description.length).toBeGreaterThan(0);
    expect(spec.info.description).not.toMatch(/self[-_]hosted/i);
  });

  test('unauthenticated /v1 requests are rejected', async () => {
    const h = buildHandler();
    const res = await h(new Request('http://x/v1/notes'));
    expect(res.status).toBe(401);
  });

  test('a token for another app is rejected', async () => {
    const h = buildHandler();
    const foreign = mintApiKey({ app: 'todos', scopes: ['todos:read'], signingSecret: SIGNING }).token;
    const res = await h(new Request('http://x/v1/notes', { headers: { 'x-api-key': foreign } }));
    expect(res.status).toBe(401);
  });

  test('read scope cannot write', async () => {
    const h = buildHandler();
    const res = await h(
      new Request('http://x/v1/notes', {
        method: 'POST',
        headers: { 'x-api-key': keyFor(['knowledge:read']), 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'nope' }),
      }),
    );
    expect(res.status).toBe(403);
  });

  test('authenticated create + get roundtrip', async () => {
    const h = buildHandler();
    const key = keyFor(['knowledge:read', 'knowledge:write']);
    const created = await h(
      new Request('http://x/v1/notes', {
        method: 'POST',
        headers: { 'x-api-key': key, 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'hello', content: 'world', tags: ['a'] }),
      }),
    );
    expect(created.status).toBe(201);
    const note = (await created.json()) as { id: string; title: string };
    expect(note.title).toBe('hello');

    const got = await h(new Request(`http://x/v1/notes/${note.id}`, { headers: { 'x-api-key': key } }));
    expect(got.status).toBe(200);
    const fetched = (await got.json()) as { id: string };
    expect(fetched.id).toBe(note.id);
  });

  test('caller-supplied id is honored and upsert is idempotent (no duplicate)', async () => {
    const h = buildHandler();
    const key = keyFor(['knowledge:read', 'knowledge:write']);
    const post = (body: unknown) =>
      h(
        new Request('http://x/v1/notes', {
          method: 'POST',
          headers: { 'x-api-key': key, 'content-type': 'application/json' },
          body: JSON.stringify(body),
        }),
      );

    // First upsert with a stable caller id.
    const first = await post({ id: 'k_stable', title: 'v1', content: 'first' });
    expect(first.status).toBe(201);
    const created = (await first.json()) as { id: string; title: string };
    expect(created.id).toBe('k_stable'); // server persisted the caller id, not a fresh one

    // The stable id is now resolvable by that id — this GET returned 404 before
    // the fix, which is exactly why the upsert path created a fresh duplicate on
    // every re-run in cloud mode.
    const got = await h(new Request('http://x/v1/notes/k_stable', { headers: { 'x-api-key': key } }));
    expect(got.status).toBe(200);
    expect(((await got.json()) as { title: string }).title).toBe('v1');

    // Re-upsert with the same id -> updates the SAME row in place (id unchanged).
    const second = await post({ id: 'k_stable', title: 'v2', content: 'second' });
    expect(second.status).toBe(201);
    expect(((await second.json()) as { id: string }).id).toBe('k_stable');

    const after = await h(new Request('http://x/v1/notes/k_stable', { headers: { 'x-api-key': key } }));
    expect(((await after.json()) as { title: string }).title).toBe('v2');
  });

  test('normalizeCloudDatabaseUrl appends libpq-compat for require', () => {
    const env: NodeJS.ProcessEnv = { HASNA_KNOWLEDGE_DATABASE_URL: 'postgres://u:p@h:5432/db?sslmode=require' };
    const out = normalizeCloudDatabaseUrl(env);
    expect(out).toContain('uselibpqcompat=true');
    expect(env.HASNA_KNOWLEDGE_DATABASE_URL).toContain('uselibpqcompat=true');
  });

  test('openapi document version is threaded through', () => {
    const spec = knowledgeOpenApi('1.2.3') as { info: { version: string } };
    expect(spec.info.version).toBe('1.2.3');
  });
});
