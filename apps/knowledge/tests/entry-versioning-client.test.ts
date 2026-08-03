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
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ApiKeyStore, mintApiKey, verifyApiKey } from '@hasna/contracts/auth';
import type { PGlite } from '@electric-sql/pglite';
import { createServeHandler } from '../src/serve';
import { KnowledgeVersionConflictError } from '../src/cloud-store';
import { resolveItemStore, VersionHistoryUnsupportedError, type ItemStore } from '../src/item-store';
import { createMigratedPglite } from './fixtures/pglite-client';
import { budget } from './support/budget';

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
    HOME: mkdtempSync(join(tmpdir(), 'ok-versions-home-')),
    HASNA_KNOWLEDGE_STORAGE_MODE: 'postgres',
    HASNA_KNOWLEDGE_API_URL: `http://127.0.0.1:${server.port}`,
    HASNA_KNOWLEDGE_API_KEY: mintApiKey({
      app: 'knowledge',
      scopes: ['knowledge:read', 'knowledge:write'],
      signingSecret: SIGNING,
    }).token,
  };
  cloudEnv.USERPROFILE = cloudEnv.HOME;
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
  }, budget(60_000));

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
  }, budget(60_000));

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
  }, budget(60_000));

  test('versions on an absent id exits 1 rather than printing an empty history', async () => {
    const result = await runCli(['versions', '--id', 'k_absent_entirely', '--json'], cloudEnv as Record<string, string>);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Item not found');
  }, budget(60_000));

  test('against the local JSON store the verbs refuse loudly instead of printing an empty history', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ok-versions-cli-local-'));
    const path = join(dir, 'db.json');
    writeFileSync(path, JSON.stringify({ items: [{ id: 'k_local', short_id: 'local', title: 'T', content: 'c', url: null, tags: [], created_at: 'x', updated_at: 'x' }] }));

    const result = await runCli(['versions', '--id', 'k_local', '--store', path, '--json']);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Version history is not kept by the local JSON knowledge store');
  }, budget(60_000));
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
    expect(message).toContain('HASNA_KNOWLEDGE_STORAGE_MODE=postgres');
  });
});

// ---------------------------------------------------------------------------
// `update --if-version` — the guard the CLI's own re-read cannot provide.
//
// The update command already passes `expectedVersion: current.version`, but that
// number comes from a read the CLI performs microseconds before its own write.
// It therefore guards only the gap inside one invocation. The race that actually
// loses fleet edits is wider: an agent reads an entry, spends minutes composing a
// new body, and then types `knowledge update --content <composed>`. The CLI
// re-reads, sees whatever landed in the meantime, passes THAT as the guard, and
// the write is accepted — so a second writer holding a stale read still clobbers
// the first at exit 0. The version the agent actually read is never expressed,
// and a guard derived from the write itself cannot express it.
//
// `--if-version <N>` is how the caller supplies the version IT read. Omitted,
// behaviour is unchanged, because many installed callers pass nothing.
// ---------------------------------------------------------------------------

describe('knowledge update --if-version — caller-supplied concurrency guard', () => {
  test('a writer holding a stale read is REFUSED instead of silently clobbering', async () => {
    const store = cloudStore();
    const created = await store.create({ title: 'Contended entry', content: 'BASE-LINE-ZERO' });
    const cliEnv = cloudEnv as Record<string, string>;

    // Both agents read the same version — the read an agent really performs,
    // well before it composes an edit.
    const readA = await store.get(created.id);
    const readB = await store.get(created.id);
    expect(readA!.version).toBe(1);
    expect(readB!.version).toBe(1);

    const a = await runCli(
      ['update', '--id', created.id, '--content', 'BASE-LINE-ZERO\nAAA', '--if-version', String(readA!.version), '--json'],
      cliEnv,
    );
    expect(a.exitCode).toBe(0);

    // B still holds version 1 while the stored entry is at 2.
    const b = await runCli(
      ['update', '--id', created.id, '--content', 'BASE-LINE-ZERO\nBBB', '--if-version', String(readB!.version), '--json'],
      cliEnv,
    );
    expect(b.exitCode).not.toBe(0);
    expect(b.stderr).toContain('version_conflict');
    // Both numbers must be named, or the operator cannot tell what to re-read.
    expect(b.stderr).toContain('version 1');
    expect(b.stderr).toContain('version 2');

    // The decisive assertion: A's edit survived and B's never landed.
    const after = await store.get(created.id);
    expect(after!.version).toBe(2);
    expect(after!.content).toContain('AAA');
    expect(after!.content).not.toContain('BBB');
  }, budget(60_000));

  test('a matching --if-version is accepted, so the guard is not simply always-on', async () => {
    // Positive control for the test above: same flag, same path, a current
    // version instead of a stale one, and the write must land.
    const store = cloudStore();
    const created = await store.create({ title: 'Uncontended entry', content: 'first' });
    const cliEnv = cloudEnv as Record<string, string>;

    const result = await runCli(
      ['update', '--id', created.id, '--content', 'second', '--if-version', String(created.version), '--json'],
      cliEnv,
    );
    expect(result.exitCode).toBe(0);

    const after = await store.get(created.id);
    expect(after!.version).toBe(2);
    expect(after!.content).toBe('second');
  }, budget(60_000));

  test('OMITTING --if-version leaves existing callers working exactly as before', async () => {
    // Back-compat is the reason the flag is opt-in. Many installed callers pass
    // nothing, and this asserts they are not broken by the addition.
    const store = cloudStore();
    const created = await store.create({ title: 'Unguarded entry', content: 'first' });
    const cliEnv = cloudEnv as Record<string, string>;

    const result = await runCli(['update', '--id', created.id, '--content', 'second', '--json'], cliEnv);
    expect(result.exitCode).toBe(0);

    const after = await store.get(created.id);
    expect(after!.version).toBe(2);
    expect(after!.content).toBe('second');
  }, budget(60_000));

  test('a non-numeric --if-version is rejected before anything is written', async () => {
    const store = cloudStore();
    const created = await store.create({ title: 'Bad guard', content: 'untouched' });
    const cliEnv = cloudEnv as Record<string, string>;

    const result = await runCli(
      ['update', '--id', created.id, '--content', 'clobbered', '--if-version', 'abc', '--json'],
      cliEnv,
    );
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain('--if-version');
    // Without this the test passes while the flag does not exist at all, because
    // `Unknown flag: --if-version` also contains the string above. It would then
    // be a check that cannot fail.
    expect(result.stderr).not.toContain('Unknown flag');

    // A guard that parsed to NaN and then wrote anyway would be worse than none.
    const after = await store.get(created.id);
    expect(after!.content).toBe('untouched');
    expect(after!.version).toBe(1);
  }, budget(60_000));

  // REWRITTEN from the version filed against fix/5d45a037-if-version, whose
  // design refused --if-version outright on the local JSON store ("the local
  // store drops expectedVersion on the floor"). That premise no longer holds:
  // this branch's fix (todos 97d26f1b) gives LocalItemStore a real,
  // lock-protected version counter and enforces --if-version against it
  // directly, precisely so the flag is not "cloud-only". Refusing here would
  // now be a REGRESSION, not a safety net — the P1 this flag exists to close
  // was two agents on the SAME machine racing the SAME local db.json, so a
  // guard that only worked against the hosted store would leave the local
  // case exactly as unsafe as before. See src/item-store.ts (LocalItemStore)
  // and tests/knowledge-update-cas.test.ts for the store-level and CLI-level
  // coverage this duplicates from the other direction (real HTTP transport
  // fixture vs. a bare temp file), which is why both are kept rather than
  // one being deleted in favour of the other.
  test('--if-version against the local JSON store ENFORCES the guard — a matching version writes, a stale one is refused', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ok-ifversion-local-'));
    const path = join(dir, 'db.json');
    writeFileSync(
      path,
      JSON.stringify({
        // Deliberately no `version` field — the exact shape of an item
        // written before the local counter existed. LocalItemStore reads
        // that as version 1 rather than making it un-guardable.
        items: [{ id: 'k_local', short_id: 'local', title: 'T', content: 'c', url: null, tags: [], created_at: 'x', updated_at: 'x' }],
      }),
    );

    // A stale guard (99, nowhere close to the real version 1) is REFUSED:
    // exit 2 (the CAS-conflict exit, distinct from the generic exit 1 a bad
    // flag value or an unknown flag would produce), both versions named, and
    // nothing written.
    const stale = await runCli(['update', '--id', 'k_local', '--content', 'clobbered', '--if-version', '99', '--store', path, '--json']);
    expect(stale.exitCode).toBe(2);
    expect(stale.stderr).toContain('version_conflict');
    expect(stale.stderr).toContain('version 99');
    expect(stale.stderr).toContain('now at version 1');
    expect(JSON.parse(readFileSync(path, 'utf8')).items[0].content).toBe('c');

    // The matching version (1) is ACCEPTED — positive control proving the
    // rejection above is the guard firing on a real mismatch, not the store
    // refusing --if-version categorically.
    const ok = await runCli(['update', '--id', 'k_local', '--content', 'new', '--if-version', '1', '--store', path, '--json']);
    expect(ok.exitCode).toBe(0);
    const stored = JSON.parse(readFileSync(path, 'utf8')).items[0];
    expect(stored.content).toBe('new');
    expect(stored.version).toBe(2);
  }, budget(60_000));
});
