/**
 * Client-side versioning, end to end over REAL HTTP.
 *
 * A live `Bun.serve` on loopback, backed by a real in-process Postgres with the
 * real migrations, driven through the real `ItemStore` the CLI uses. Nothing is
 * stubbed: the request crosses a socket, hits the actual handler, and the
 * actual trigger writes the history. The outbound guard permits loopback for
 * exactly this reason — a stubbed transport is how an egress or serialization
 * bug hides.
 *
 * The local-store half of the file pins the other half of the contract: a store
 * that keeps no history must SAY SO. An empty list there would be
 * indistinguishable from "this entry was never edited", which is how the
 * sibling implementation reported a record at version 4 with zero retained
 * bodies.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ApiKeyStore, mintApiKey, verifyApiKey } from '@hasna/contracts/auth';
import type { PGlite } from '@electric-sql/pglite';
import { createServeHandler } from '../src/serve';
import { KnowledgeVersionConflictError } from '../src/cloud-store';
import { resolveItemStore, VersionHistoryUnsupportedError, type ItemStore } from '../src/item-store';
import { createMigratedPglite } from './fixtures/pglite-client';

const SIGNING = 'test-signing-secret-not-a-real-key';

let db: PGlite;
let server: { port: number; stop: (closeActive?: boolean) => void };
let cloudEnv: NodeJS.ProcessEnv;

beforeAll(async () => {
  const created = await createMigratedPglite();
  db = created.db;
  const store = new ApiKeyStore(created.client);
  const verifier = verifyApiKey({ app: 'knowledge', signingSecret: SIGNING, isRevoked: store.isRevoked });
  const handler = createServeHandler({ client: created.client, verifier, store, version: '9.9.9' });
  server = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: handler });

  cloudEnv = {
    HASNA_KNOWLEDGE_STORAGE_MODE: 'cloud',
    HASNA_KNOWLEDGE_API_URL: `http://127.0.0.1:${server.port}`,
    HASNA_KNOWLEDGE_API_KEY: mintApiKey({
      app: 'knowledge',
      scopes: ['knowledge:read', 'knowledge:write'],
      signingSecret: SIGNING,
    }).token,
  };
});

afterAll(async () => {
  server?.stop(true);
  await db?.close().catch(() => {});
});

function cloudStore(): ItemStore {
  return resolveItemStore({ storePath: join(tmpdir(), 'never-used-db.json'), storePathOverridden: false, env: cloudEnv });
}

describe('ItemStore (api transport) — versioning over real HTTP', () => {
  test('resolves to the api transport and reports that it keeps history', () => {
    const store = cloudStore();
    expect(store.kind).toBe('api');
    expect(store.supportsVersions).toBe(true);
  });

  test('history round-trips: prior bodies come back through the HTTP surface', async () => {
    const store = cloudStore();
    const created = await store.create({ title: 'Round trip', content: 'body v1' });
    await store.update(created.id, { content: 'body v2' });
    await store.update(created.id, { content: 'body v3' });

    const history = await store.listVersions(created.id);
    expect(history).not.toBeNull();
    expect(history!.current_version).toBe(3);
    expect(history!.items.map((v) => v.content)).toEqual(['body v2', 'body v1']);
    // The actor is taken from the authenticated principal, not from the caller.
    expect(history!.items[0]!.actor).toMatch(/^(agent|key):/);
    expect(history!.items[0]!.content_hash).toMatch(/^[0-9a-f]{64}$/);

    const one = await store.getVersion(created.id, 1);
    expect(one!.content).toBe('body v1');
    expect(await store.getVersion(created.id, 99)).toBeNull();
  });

  test('an entry that exists but was never edited returns an EMPTY history, not null', async () => {
    const store = cloudStore();
    const created = await store.create({ title: 'Untouched', content: 'only body' });
    const history = await store.listVersions(created.id);
    expect(history).not.toBeNull();
    expect(history!.items).toEqual([]);
    expect(history!.current_version).toBe(1);
  });

  test('an absent entry returns null — the two answers stay distinguishable', async () => {
    expect(await cloudStore().listVersions('k_definitely_absent')).toBeNull();
  });

  test('a stale expectedVersion raises a typed conflict carrying both numbers', async () => {
    const store = cloudStore();
    const created = await store.create({ title: 'Contended', content: 'shared' });
    await store.update(created.id, { content: 'winner' }, { expectedVersion: created.version });

    let caught: unknown = null;
    try {
      await store.update(created.id, { content: 'loser' }, { expectedVersion: created.version });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(KnowledgeVersionConflictError);
    expect((caught as KnowledgeVersionConflictError).expected).toBe(1);
    expect((caught as KnowledgeVersionConflictError).current).toBe(2);

    const after = await store.get(created.id);
    expect(after!.content).toBe('winner');
    expect(after!.version).toBe(2);
  });

  test('a fresh expectedVersion is accepted, so the guard is not simply always-on', async () => {
    // Positive control for the test above: same code path, same store, a
    // current version instead of a stale one, and the write lands.
    const store = cloudStore();
    const created = await store.create({ title: 'Uncontended', content: 'a' });
    const updated = await store.update(created.id, { content: 'b' }, { expectedVersion: created.version });
    expect(updated!.version).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// The verbs an agent actually types, as a real process against the real server.
// ---------------------------------------------------------------------------

const CLI = join(import.meta.dir, '..', 'src', 'cli.ts');

/**
 * Spawn the CLI ASYNCHRONOUSLY, never `spawnSync`.
 *
 * The server under test runs in THIS process. `Bun.spawnSync` blocks this
 * process's event loop until the child exits, so the child's HTTP request can
 * never be answered and both sides sit there until the transport's 30s timeout
 * fires — a deadlock that presents as "The operation was aborted." and reads
 * like a broken CLI rather than a broken harness.
 */
async function runCli(args: string[], extraEnv: Record<string, string> = {}) {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    // Drop any ambient knowledge configuration so the test decides the backend.
    if (key.includes('KNOWLEDGE') || value === undefined) continue;
    env[key] = value;
  }
  const proc = Bun.spawn(['bun', CLI, ...args], { env: { ...env, ...extraEnv }, stdout: 'pipe', stderr: 'pipe' });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { exitCode, stdout, stderr };
}

describe('knowledge versions / diff — CLI against the live server', () => {
  test('versions and diff report a real edit end to end', async () => {
    const store = cloudStore();
    const created = await store.create({ title: 'CLI subject', content: 'line one\nline two', tags: ['x'] });
    await store.update(created.id, { content: 'line one\nline two changed', tags: ['x', 'y'] });

    const cliEnv = cloudEnv as Record<string, string>;

    const versions = await runCli(['versions', '--id', created.id, '--json'], cliEnv);
    expect(versions.exitCode).toBe(0);
    const listed = JSON.parse(versions.stdout) as {
      ok: boolean; current_version: number; total: number; versions: { version: number; content: string }[];
    };
    expect(listed.ok).toBe(true);
    expect(listed.current_version).toBe(2);
    expect(listed.total).toBe(1);
    expect(listed.versions[0]!.content).toBe('line one\nline two');

    // Default diff: newest retained version vs the live entry.
    const diff = await runCli(['diff', '--id', created.id, '--json'], cliEnv);
    expect(diff.exitCode).toBe(0);
    const diffed = JSON.parse(diff.stdout) as {
      identical: boolean; added: number; removed: number; fields: { field: string }[]; from: string; to: string;
    };
    expect(diffed.identical).toBe(false);
    expect(diffed.from).toBe('v1');
    expect(diffed.to).toBe('v2 (current)');
    expect(diffed.added).toBe(1);
    expect(diffed.removed).toBe(1);
    // The tag move is reported too — a body-only differ would have missed it.
    expect(diffed.fields.map((f) => f.field)).toEqual(['tags']);

    // --rev N compares N with N-1, matching the sibling CLI's documented shape.
    const rev = await runCli(['diff', '--id', created.id, '--rev', '2', '--json'], cliEnv);
    expect(rev.exitCode).toBe(0);
    expect((JSON.parse(rev.stdout) as { from: string; to: string }).from).toBe('v1');
    // v2 IS the current version, so the live row is the right right-hand side.
    expect((JSON.parse(rev.stdout) as { to: string }).to).toBe('v2 (current)');
  }, 60_000);

  test('an entry with no edits prints an empty history at exit 0, and diff refuses at exit 1', async () => {
    const created = await cloudStore().create({ title: 'Never edited', content: 'only' });
    const cliEnv = cloudEnv as Record<string, string>;

    const versions = await runCli(['versions', '--id', created.id, '--json'], cliEnv);
    expect(versions.exitCode).toBe(0);
    expect((JSON.parse(versions.stdout) as { total: number; versions: unknown[] }).total).toBe(0);

    // "Nothing to compare" must not render as "no changes" — that would read as
    // a measurement showing the entry is unmodified.
    const diff = await runCli(['diff', '--id', created.id, '--json'], cliEnv);
    expect(diff.exitCode).toBe(1);
    expect(diff.stderr).toContain('no retained prior versions');
  }, 60_000);

  test('versions pages, so history past one page is still reachable', async () => {
    // The server caps a page at 200. Without an offset, an entry with more
    // retained versions than that reports them in `total` and can never return
    // them — a retrieval hole, not a display one. Proven here at limit 1 so the
    // assertion needs three edits rather than two hundred.
    const store = cloudStore();
    const created = await store.create({ title: 'Paged', content: 'v1' });
    await store.update(created.id, { content: 'v2' });
    await store.update(created.id, { content: 'v3' });
    await store.update(created.id, { content: 'v4' });
    const cliEnv = cloudEnv as Record<string, string>;

    const first = await runCli(['versions', '--id', created.id, '--limit', '1', '--json'], cliEnv);
    expect(first.exitCode).toBe(0);
    const page1 = JSON.parse(first.stdout) as { total: number; page: number; versions: { version: number }[] };
    expect(page1.total).toBe(3);
    expect(page1.page).toBe(1);
    expect(page1.versions.map((v) => v.version)).toEqual([3]);

    const second = await runCli(['versions', '--id', created.id, '--limit', '1', '--page', '2', '--json'], cliEnv);
    expect(second.exitCode).toBe(0);
    const page2 = JSON.parse(second.stdout) as { page: number; versions: { version: number }[] };
    expect(page2.page).toBe(2);
    expect(page2.versions.map((v) => v.version)).toEqual([2]);

    const third = await runCli(['versions', '--id', created.id, '--limit', '1', '--page', '3', '--json'], cliEnv);
    expect((JSON.parse(third.stdout) as { versions: { version: number }[] }).versions.map((v) => v.version)).toEqual([1]);
  }, 60_000);

  test('versions on an absent id exits 1 rather than printing an empty history', async () => {
    const result = await runCli(['versions', '--id', 'k_absent_entirely', '--json'], cloudEnv as Record<string, string>);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Item not found');
  }, 60_000);

  test('against the local JSON store the verbs refuse loudly instead of printing an empty history', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ok-versions-cli-local-'));
    const path = join(dir, 'db.json');
    writeFileSync(path, JSON.stringify({ items: [{ id: 'k_local', short_id: 'local', title: 'T', content: 'c', url: null, tags: [], created_at: 'x', updated_at: 'x' }] }));

    const result = await runCli(['versions', '--id', 'k_local', '--store', path, '--json']);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Version history is not kept by the local JSON knowledge store');
  }, 60_000);
});

describe('ItemStore (local transport) — a store with no history says so', () => {
  function localStore(): ItemStore {
    const dir = mkdtempSync(join(tmpdir(), 'ok-versions-local-'));
    const path = join(dir, 'db.json');
    writeFileSync(path, JSON.stringify({ items: [] }));
    return resolveItemStore({ storePath: path, storePathOverridden: true, env: cloudEnv });
  }

  test('an explicit --store pins to local even while cloud env vars are present', () => {
    const store = localStore();
    expect(store.kind).toBe('local');
    expect(store.supportsVersions).toBe(false);
  });

  test('listVersions REFUSES rather than returning an empty history', async () => {
    await expect(localStore().listVersions('k_anything')).rejects.toThrow(VersionHistoryUnsupportedError);
  });

  test('getVersion refuses the same way', async () => {
    await expect(localStore().getVersion('k_anything', 1)).rejects.toThrow(VersionHistoryUnsupportedError);
  });

  test('the refusal names the store and how to reach one that does keep history', async () => {
    let message = '';
    try {
      await localStore().listVersions('k_anything');
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain('db.json');
    expect(message).toContain('HASNA_KNOWLEDGE_STORAGE_MODE=cloud');
  });
});
