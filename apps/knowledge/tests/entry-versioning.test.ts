/**
 * Entry versioning (R4) — behaviour suite against a REAL in-process Postgres.
 *
 * What this pins, and why each assertion exists:
 *
 *  1. THE TRIGGER SITS BELOW THE APPLICATION. A raw `UPDATE knowledge_items`
 *     issued straight at the database — no NoteRepo, no HTTP handler, the same
 *     thing a backfill script or a human at psql does — still snapshots the
 *     prior body and still bumps the counter. This is the assertion that makes
 *     "enforced at the database layer" a measurement instead of a claim.
 *
 *  2. THE WRITE PATH CALLERS ACTUALLY USE. `NoteRepo.create` with a supplied id
 *     is an `ON CONFLICT (id) DO UPDATE` upsert — the path `knowledge upsert
 *     --id`, import, and `ingest rules` take. In open-mementos the equivalent
 *     path (the merge branch of createMemory) bumped `version` and never
 *     snapshotted, which is why a memory sitting at v4 has ZERO retained
 *     bodies. A suite that only exercised the update path would have passed
 *     there too. This one exercises the upsert path explicitly.
 *
 *  3. NO SILENT OVERWRITE. Two readers of v1 both patch with expected version
 *     1: exactly one wins, the loser gets version_conflict, and the losing body
 *     is NOT in the row afterwards.
 *
 *  4. NO-OP WRITES MANUFACTURE NOTHING. An idempotent re-upsert (what sync and
 *     ingest do on every run) produces no version row — with a positive control
 *     in the same test proving the same harness DOES record one when a field
 *     actually changes, so "0 rows" cannot be an inert check passing by default.
 *
 * The in-memory SQL-string fake in serve.test.ts cannot observe any of this: it
 * has no trigger, so it would report success no matter what the DDL said. Real
 * Postgres is the only input here that can produce both outcomes.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { ApiKeyStore, mintApiKey, verifyApiKey } from '@hasna/contracts/auth';
import type { PGlite } from '@electric-sql/pglite';
import { NoteRepo, VersionConflictError, createServeHandler } from '../src/serve';
import type { PoolQueryClient } from '../src/generated/storage-kit/index.js';
import { createMigratedPglite } from './fixtures/pglite-client';

const SIGNING = 'test-signing-secret-not-a-real-key';

// One migrated instance for the file, truncated between tests. Booting a fresh
// PGlite per test cost ~3.5s each and pushed several past the default 5s
// timeout, which would have turned a real assertion into a flake.
let sharedDb: PGlite;
let sharedClient: PoolQueryClient;

beforeAll(async () => {
  const created = await createMigratedPglite();
  sharedDb = created.db;
  sharedClient = created.client;
});

afterAll(async () => {
  await sharedDb?.close().catch(() => {});
});

beforeEach(async () => {
  // CASCADE also clears knowledge_item_versions via its FK, which keeps the
  // "no version rows" assertions meaningful instead of inherited-empty.
  await sharedDb.query('TRUNCATE knowledge_items CASCADE');
});

async function harness(): Promise<{ db: PGlite; client: PoolQueryClient; repo: NoteRepo }> {
  return { db: sharedDb, client: sharedClient, repo: new NoteRepo(sharedClient) };
}

async function versionRows(db: PGlite, itemId: string) {
  const result = await db.query<Record<string, unknown>>(
    `SELECT version, title, content, content_hash, content_bytes, url, tags, metadata,
            archived, actor, reason, valid_from, valid_to, tenant_id
       FROM knowledge_item_versions WHERE item_id = $1 ORDER BY version ASC`,
    [itemId],
  );
  return result.rows;
}

async function currentRow(db: PGlite, itemId: string) {
  const result = await db.query<Record<string, unknown>>(
    `SELECT id, title, content, version, updated_at FROM knowledge_items WHERE id = $1`,
    [itemId],
  );
  return result.rows[0]!;
}

function keyFor(scopes: string[]): string {
  return mintApiKey({ app: 'knowledge', scopes, signingSecret: SIGNING }).token;
}

function handlerFor(client: PoolQueryClient) {
  const store = new ApiKeyStore(client);
  const verifier = verifyApiKey({ app: 'knowledge', signingSecret: SIGNING, isRevoked: store.isRevoked });
  return createServeHandler({ client, verifier, store, version: '9.9.9' });
}

// ---------------------------------------------------------------------------
// 1. Schema + trigger
// ---------------------------------------------------------------------------

describe('entry versioning — schema and trigger', () => {
  test('a new entry starts at version 1 with no history', async () => {
    const { db, repo } = await harness();
    const item = await repo.create({ title: 'T', content: 'first body' });
    expect(item.version).toBe(1);
    expect(await versionRows(db, item.id)).toHaveLength(0);
  });

  test('a raw SQL update — bypassing every application path — still snapshots and bumps', async () => {
    const { db, repo } = await harness();
    const item = await repo.create({ title: 'T', content: 'first body' });

    // No NoteRepo, no handler, no CLI. This is the psql/backfill path.
    await db.query(`UPDATE knowledge_items SET content = $2 WHERE id = $1`, [item.id, 'second body']);

    const rows = await versionRows(db, item.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.version).toBe(1);
    expect(rows[0]!.content).toBe('first body');
    expect(rows[0]!.content_bytes).toBe('first body'.length);
    // sha256("first body") — pinned so a change of hash algorithm is loud.
    expect(rows[0]!.content_hash).toBe(
      new Bun.CryptoHasher('sha256').update('first body').digest('hex'),
    );

    const now = await currentRow(db, item.id);
    expect(now.version).toBe(2);
    expect(now.content).toBe('second body');
  });

  test('the counter cannot be forged: an update that sets version explicitly is overruled', async () => {
    const { db, repo } = await harness();
    const item = await repo.create({ title: 'T', content: 'a' });
    await db.query(`UPDATE knowledge_items SET content = $2, version = 99 WHERE id = $1`, [item.id, 'b']);
    expect((await currentRow(db, item.id)).version).toBe(2);

    // ...and on a no-op write too, where the trigger takes its early return.
    await db.query(`UPDATE knowledge_items SET version = 99 WHERE id = $1`, [item.id]);
    expect((await currentRow(db, item.id)).version).toBe(2);
  });

  test('each update produces exactly one revision row, and every prior body is retrievable', async () => {
    const { db, repo } = await harness();
    const item = await repo.create({ title: 'T', content: 'v1 body' });
    await repo.update(item.id, { content: 'v2 body' });
    await repo.update(item.id, { content: 'v3 body' });

    const rows = await versionRows(db, item.id);
    expect(rows.map((r) => r.version)).toEqual([1, 2]);
    expect(rows.map((r) => r.content)).toEqual(['v1 body', 'v2 body']);
    expect((await currentRow(db, item.id)).version).toBe(3);
  });

  test('a no-op update records nothing — with a positive control on the same row', async () => {
    const { db, repo } = await harness();
    const item = await repo.create({ title: 'T', content: 'body' });

    // Idempotent re-upsert: identical field tuple. This is what `ingest rules`
    // and every sync replay do on each run.
    await repo.create({ id: item.id, title: 'T', content: 'body' });
    await repo.update(item.id, { content: 'body' });
    expect(await versionRows(db, item.id)).toHaveLength(0);
    expect((await currentRow(db, item.id)).version).toBe(1);

    // POSITIVE CONTROL: the identical harness, the identical row, one changed
    // field — if this did not produce a row the check above would be inert.
    await repo.update(item.id, { content: 'body changed' });
    expect(await versionRows(db, item.id)).toHaveLength(1);
    expect((await currentRow(db, item.id)).version).toBe(2);
  });

  test('archiving is version-worthy; a bare updated_at touch is not', async () => {
    const { db, repo } = await harness();
    const item = await repo.create({ title: 'T', content: 'body' });

    await db.query(`UPDATE knowledge_items SET updated_at = $2 WHERE id = $1`, [item.id, '2030-01-01T00:00:00.000Z']);
    expect(await versionRows(db, item.id)).toHaveLength(0);

    await repo.update(item.id, { archived: true });
    const rows = await versionRows(db, item.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.archived).toBe(false); // the snapshot is the PRIOR state
    expect((await currentRow(db, item.id)).version).toBe(2);
  });

  test('tags and metadata changes are version-worthy and snapshot faithfully', async () => {
    const { db, repo } = await harness();
    const item = await repo.create({ title: 'T', content: 'body', tags: ['a'], metadata: { k: 1 } });
    await repo.update(item.id, { tags: ['a', 'b'] });
    await repo.update(item.id, { metadata: { k: 2 } });

    const rows = await versionRows(db, item.id);
    expect(rows).toHaveLength(2);
    expect(rows[0]!.tags).toEqual(['a']);
    expect(rows[1]!.tags).toEqual(['a', 'b']);
    expect(rows[0]!.metadata).toEqual({ k: 1 });
    expect(rows[1]!.metadata).toEqual({ k: 1 });
  });

  test('the trigger is ENABLE ALWAYS, so a replication/restore session cannot bypass it', async () => {
    // A plain trigger does NOT fire while session_replication_role = replica —
    // which is exactly what logical-replication apply workers, `pg_restore
    // --disable-triggers`, and AWS DMS set. Under a plain trigger this update
    // lands with the prior body destroyed AND the counter left at 1, so
    // `version` then actively lies about the row. The design pre-committed to
    // this test ("any success is a P0 and Phase 1 does not ship").
    const enabled = await sharedDb.query<{ tgenabled: string }>(
      `SELECT tgenabled FROM pg_trigger WHERE tgname = 'trg_knowledge_items_version'
         AND tgrelid = 'knowledge_items'::regclass`,
    );
    expect(enabled.rows[0]?.tgenabled).toBe('A'); // 'A' = ALWAYS, 'O' = origin-only

    const { db, repo } = await harness();
    const item = await repo.create({ title: 'T', content: 'body before replication' });
    try {
      await db.query(`SET session_replication_role = replica`);
      await db.query(`UPDATE knowledge_items SET content = $2 WHERE id = $1`, [item.id, 'body written as replica']);
    } finally {
      await db.query(`SET session_replication_role = origin`);
    }

    const rows = await versionRows(db, item.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.content).toBe('body before replication');
    expect((await currentRow(db, item.id)).version).toBe(2);
  });

  test('the trigger writes updated_at in the SAME ISO-8601 shape the application uses', async () => {
    // NOW()::text renders as '2026-07-28 21:29:56.010+00' — a second, different
    // format in a TEXT column the application fills with toISOString(). Space
    // (0x20) sorts below 'T' (0x54), so in a mixed column EVERY trigger-written
    // timestamp sorts before EVERY application-written one regardless of actual
    // time, and any text comparison of updated_at silently inverts.
    const { db, repo } = await harness();
    const item = await repo.create({ title: 'T', content: 'a' });
    const appWritten = String((await currentRow(db, item.id)).updated_at);
    expect(appWritten).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);

    await db.query(`UPDATE knowledge_items SET content = 'b' WHERE id = $1`, [item.id]);
    const triggerWritten = String((await currentRow(db, item.id)).updated_at);
    expect(triggerWritten).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    // The point of one shared format: plain text ordering has to stay truthful.
    expect(triggerWritten > appWritten).toBe(true);

    // valid_from is copied verbatim from the row it snapshots, so the two ends
    // of a validity range must be comparable as text without casting either.
    const rows = await versionRows(db, item.id);
    expect(String(rows[0]!.valid_to)).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(String(rows[0]!.valid_to) > String(rows[0]!.valid_from)).toBe(true);
  });

  test('an explicitly supplied updated_at is preserved, not overwritten', async () => {
    // Import, sync replay, and backfill carry a SOURCE timestamp. Before the
    // trigger existed those writes kept it; silently replacing it with now()
    // would be a regression this change introduced.
    const { db, repo } = await harness();
    const item = await repo.create({ title: 'T', content: 'a' });
    await db.query(`UPDATE knowledge_items SET content = 'b', updated_at = $2 WHERE id = $1`, [
      item.id,
      '2019-03-04T05:06:07.008Z',
    ]);
    expect(String((await currentRow(db, item.id)).updated_at)).toBe('2019-03-04T05:06:07.008Z');
    // The snapshot still happened — preserving the caller's timestamp is not a
    // licence to skip history.
    expect(await versionRows(db, item.id)).toHaveLength(1);
    expect((await currentRow(db, item.id)).version).toBe(2);
  });

  test('a retained version row cannot be rewritten', async () => {
    // "Append-only" has to be enforced, not merely named. Nothing in this
    // package updates this table, so blocking it costs nothing and removes the
    // one way history can be edited in place rather than added to.
    const { db, repo } = await harness();
    const item = await repo.create({ title: 'T', content: 'original' });
    await repo.update(item.id, { content: 'edited' });
    expect(await versionRows(db, item.id)).toHaveLength(1);

    await expect(
      db.query(`UPDATE knowledge_item_versions SET content = 'rewritten' WHERE item_id = $1`, [item.id]),
    ).rejects.toThrow(/append-only/i);
    expect((await versionRows(db, item.id))[0]!.content).toBe('original');
  });

  test('tenancy is carried into the snapshot when the schema has a tenant_id column', async () => {
    // This repo's knowledge_items has no tenant column; the deployed build's
    // does. The trigger reads it through to_jsonb(OLD) so ONE migration is
    // correct against both. Without this test that branch has no input that can
    // distinguish it from a hardcoded NULL — measured: replacing it with NULL
    // was the one planted defect the suite did not catch.
    const { db, repo } = await harness();
    await db.query(`ALTER TABLE knowledge_items ADD COLUMN tenant_id TEXT`);
    try {
      const item = await repo.create({ title: 'T', content: 'a' });
      await db.query(`UPDATE knowledge_items SET tenant_id = 'tenant-abc' WHERE id = $1`, [item.id]);
      await db.query(`UPDATE knowledge_items SET content = 'b' WHERE id = $1`, [item.id]);
      const rows = await versionRows(db, item.id);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.tenant_id).toBe('tenant-abc');
    } finally {
      await db.query(`ALTER TABLE knowledge_items DROP COLUMN tenant_id`);
    }
  });

  test('a version-worthy change always advances updated_at, even when the caller does not', async () => {
    const { db, repo } = await harness();
    const item = await repo.create({ title: 'T', content: 'body' });
    await db.query(`UPDATE knowledge_items SET updated_at = $2 WHERE id = $1`, [item.id, '2000-01-01T00:00:00.000Z']);
    const stale = String((await currentRow(db, item.id)).updated_at);
    expect(stale).toBe('2000-01-01T00:00:00.000Z');

    await db.query(`UPDATE knowledge_items SET content = 'moved' WHERE id = $1`, [item.id]);
    const after = String((await currentRow(db, item.id)).updated_at);
    expect(after > stale).toBe(true);

    // valid_from carries the timestamp the snapshotted body was written at.
    const rows = await versionRows(db, item.id);
    expect(rows[0]!.valid_from).toBe(stale);
  });
});

// ---------------------------------------------------------------------------
// 2. The write path callers actually use — the mementos discriminator
// ---------------------------------------------------------------------------

describe('entry versioning — the upsert path (the open-mementos failure mode)', () => {
  test('upsert-on-existing-id snapshots too, not just the update path', async () => {
    const { db, repo } = await harness();
    const created = await repo.create({ id: 'k_stable_upsert', title: 'T', content: 'original' });
    expect(created.version).toBe(1);

    // `knowledge upsert --id` / import / ingest all land here. In open-mementos
    // this is the branch that bumped without snapshotting.
    const merged = await repo.create({ id: 'k_stable_upsert', title: 'T', content: 'replaced' });
    expect(merged.version).toBe(2);

    const rows = await versionRows(db, 'k_stable_upsert');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.content).toBe('original');
  });

  test('delete cascades history for the entry but leaves other entries intact', async () => {
    const { db, repo } = await harness();
    const keep = await repo.create({ title: 'keep', content: 'a' });
    const drop = await repo.create({ title: 'drop', content: 'a' });
    await repo.update(keep.id, { content: 'b' });
    await repo.update(drop.id, { content: 'b' });

    await repo.delete(drop.id);
    expect(await versionRows(db, drop.id)).toHaveLength(0);
    expect(await versionRows(db, keep.id)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// 3. Actor / reason attribution
// ---------------------------------------------------------------------------

describe('entry versioning — actor attribution', () => {
  test('actor and reason are recorded when the writer supplies them', async () => {
    const { db, repo } = await harness();
    const item = await repo.create({ title: 'T', content: 'body' });
    await repo.update(item.id, { content: 'edited' }, { actor: 'agent:augustus', reason: 'R4 rollout' });

    const rows = await versionRows(db, item.id);
    expect(rows[0]!.actor).toBe('agent:augustus');
    expect(rows[0]!.reason).toBe('R4 rollout');
  });

  test('an unattributed write records NULL, never a leaked previous actor or an empty string', async () => {
    const { db, repo } = await harness();
    const item = await repo.create({ title: 'T', content: 'body' });
    await repo.update(item.id, { content: 'one' }, { actor: 'agent:augustus' });
    // Same connection, next write, no actor: a transaction-local GUC resets to
    // '' rather than unset, so without NULLIF this would read as an attributed
    // write with an empty name.
    await repo.update(item.id, { content: 'two' });

    const rows = await versionRows(db, item.id);
    expect(rows[0]!.actor).toBe('agent:augustus');
    expect(rows[1]!.actor).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 4. Optimistic concurrency
// ---------------------------------------------------------------------------

describe('entry versioning — optimistic concurrency', () => {
  test('two agents that both read v1 cannot both succeed', async () => {
    const { db, repo } = await harness();
    const item = await repo.create({ title: 'T', content: 'shared body' });

    const readA = await repo.get(item.id);
    const readB = await repo.get(item.id);
    expect(readA!.version).toBe(1);
    expect(readB!.version).toBe(1);

    await repo.update(item.id, { content: 'agent A body' }, { expectedVersion: readA!.version });

    let conflict: unknown = null;
    try {
      await repo.update(item.id, { content: 'agent B body' }, { expectedVersion: readB!.version });
    } catch (error) {
      conflict = error;
    }
    expect(conflict).toBeInstanceOf(VersionConflictError);
    expect((conflict as VersionConflictError).expected).toBe(1);
    expect((conflict as VersionConflictError).current).toBe(2);

    const row = await currentRow(db, item.id);
    expect(row.version).toBe(2); // not 3 — the loser wrote nothing
    expect(row.content).toBe('agent A body');
    expect(await versionRows(db, item.id)).toHaveLength(1);
  });

  test('a matching expected version is accepted', async () => {
    const { repo } = await harness();
    const item = await repo.create({ title: 'T', content: 'a' });
    const updated = await repo.update(item.id, { content: 'b' }, { expectedVersion: 1 });
    expect(updated!.version).toBe(2);
    const again = await repo.update(item.id, { content: 'c' }, { expectedVersion: 2 });
    expect(again!.version).toBe(3);
  });

  test('an absent expected version still writes (phase 1 back-compat for installed CLIs)', async () => {
    const { repo } = await harness();
    const item = await repo.create({ title: 'T', content: 'a' });
    const updated = await repo.update(item.id, { content: 'b' });
    expect(updated!.version).toBe(2);
  });

  test('a conflict on a missing entry is reported as not-found, not as a conflict', async () => {
    const { repo } = await harness();
    expect(await repo.update('k_does_not_exist', { content: 'x' }, { expectedVersion: 1 })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 5. Read surface
// ---------------------------------------------------------------------------

describe('entry versioning — read surface', () => {
  test('listVersions returns prior bodies newest-first with the current version stated', async () => {
    const { repo } = await harness();
    const item = await repo.create({ title: 'T', content: 'v1' });
    await repo.update(item.id, { content: 'v2' });
    await repo.update(item.id, { content: 'v3' });

    const history = await repo.listVersions(item.id);
    expect(history).not.toBeNull();
    expect(history!.current_version).toBe(3);
    expect(history!.total).toBe(2);
    expect(history!.items.map((v) => v.version)).toEqual([2, 1]);
    expect(history!.items.map((v) => v.content)).toEqual(['v2', 'v1']);
  });

  test('an entry with no edits returns an EMPTY list, and an absent entry returns null', async () => {
    // The distinction matters: open-mementos conflated them, so "No previous
    // versions" was printed for a memory whose history the client simply could
    // not see. Absent must not look like empty.
    const { repo } = await harness();
    const item = await repo.create({ title: 'T', content: 'v1' });
    const history = await repo.listVersions(item.id);
    expect(history).not.toBeNull();
    expect(history!.items).toEqual([]);
    expect(history!.current_version).toBe(1);
    expect(await repo.listVersions('k_absent')).toBeNull();
  });

  test('getVersion fetches one snapshot by number', async () => {
    const { repo } = await harness();
    const item = await repo.create({ title: 'T', content: 'v1' });
    await repo.update(item.id, { content: 'v2' });
    const v1 = await repo.getVersion(item.id, 1);
    expect(v1!.content).toBe('v1');
    expect(await repo.getVersion(item.id, 7)).toBeNull();
  });

  test('history is reachable by short_id, as every other note lookup is', async () => {
    const { repo } = await harness();
    const item = await repo.create({ title: 'T', content: 'v1' });
    await repo.update(item.id, { content: 'v2' });
    const history = await repo.listVersions(item.short_id!);
    expect(history!.items).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// 6. HTTP surface
// ---------------------------------------------------------------------------

describe('entry versioning — HTTP surface', () => {
  async function seed() {
    const { db, client, repo } = await harness();
    const key = keyFor(['knowledge:read', 'knowledge:write']);
    const handler = handlerFor(client);
    const item = await repo.create({ title: 'T', content: 'v1 body' });
    return { db, handler, key, item };
  }

  test('PATCH with a stale If-Match returns 409 version_conflict and changes nothing', async () => {
    const { db, handler, key, item } = await seed();
    // Move it to v2 so If-Match: 1 is stale.
    await handler(new Request(`http://x/v1/notes/${item.id}`, {
      method: 'PATCH',
      headers: { 'x-api-key': key, 'content-type': 'application/json' },
      body: JSON.stringify({ content: 'v2 body' }),
    }));

    const res = await handler(new Request(`http://x/v1/notes/${item.id}`, {
      method: 'PATCH',
      headers: { 'x-api-key': key, 'content-type': 'application/json', 'if-match': '1' },
      body: JSON.stringify({ content: 'loser body' }),
    }));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'version_conflict', expected: 1, current: 2 });

    const row = await currentRow(db, item.id);
    expect(row.content).toBe('v2 body');
    expect(row.version).toBe(2);
  });

  test('PATCH with a matching If-Match succeeds and returns the new version', async () => {
    const { handler, key, item } = await seed();
    const res = await handler(new Request(`http://x/v1/notes/${item.id}`, {
      method: 'PATCH',
      headers: { 'x-api-key': key, 'content-type': 'application/json', 'if-match': '"1"' },
      body: JSON.stringify({ content: 'v2 body' }),
    }));
    expect(res.status).toBe(200);
    expect((await res.json() as { version: number }).version).toBe(2);
  });

  test('expected_version in the body works for clients that cannot set headers', async () => {
    const { handler, key, item } = await seed();
    const stale = await handler(new Request(`http://x/v1/notes/${item.id}`, {
      method: 'PATCH',
      headers: { 'x-api-key': key, 'content-type': 'application/json' },
      body: JSON.stringify({ content: 'v2', expected_version: 9 }),
    }));
    expect(stale.status).toBe(409);

    const ok = await handler(new Request(`http://x/v1/notes/${item.id}`, {
      method: 'PATCH',
      headers: { 'x-api-key': key, 'content-type': 'application/json' },
      body: JSON.stringify({ content: 'v2', expected_version: 1 }),
    }));
    expect(ok.status).toBe(200);
    // expected_version is a control field, never persisted as note metadata.
    expect((await ok.json() as { content: string }).content).toBe('v2');
  });

  test('GET /v1/notes/{id}/versions lists history; /versions/{n} fetches one', async () => {
    const { handler, key, item } = await seed();
    await handler(new Request(`http://x/v1/notes/${item.id}`, {
      method: 'PATCH',
      headers: { 'x-api-key': key, 'content-type': 'application/json' },
      body: JSON.stringify({ content: 'v2 body' }),
    }));

    const list = await handler(new Request(`http://x/v1/notes/${item.id}/versions`, {
      headers: { 'x-api-key': key },
    }));
    expect(list.status).toBe(200);
    const body = await list.json() as { current_version: number; total: number; items: { version: number; content: string }[] };
    expect(body.current_version).toBe(2);
    expect(body.total).toBe(1);
    expect(body.items[0]!.content).toBe('v1 body');

    const one = await handler(new Request(`http://x/v1/notes/${item.id}/versions/1`, {
      headers: { 'x-api-key': key },
    }));
    expect(one.status).toBe(200);
    expect((await one.json() as { content: string }).content).toBe('v1 body');

    const missing = await handler(new Request(`http://x/v1/notes/${item.id}/versions/9`, {
      headers: { 'x-api-key': key },
    }));
    expect(missing.status).toBe(404);
  });

  test('versions of an absent entry is 404, not an empty list', async () => {
    const { handler, key } = await seed();
    const res = await handler(new Request('http://x/v1/notes/k_absent/versions', {
      headers: { 'x-api-key': key },
    }));
    expect(res.status).toBe(404);
  });

  test('the version routes require knowledge:read', async () => {
    const { handler, item } = await seed();
    const res = await handler(new Request(`http://x/v1/notes/${item.id}/versions`, {
      headers: { 'x-api-key': keyFor(['knowledge:write']) },
    }));
    expect(res.status).toBe(403);
  });

  test('the OpenAPI document advertises version, If-Match, 409, and the version routes', async () => {
    const { handler } = await seed();
    const res = await handler(new Request('http://x/openapi.json'));
    const doc = await res.json() as any;
    expect(doc.components.schemas.Note.properties.version).toBeDefined();
    expect(doc.components.schemas.Note.required).toContain('version');
    expect(doc.components.schemas.NotePatch.properties.expected_version).toBeDefined();
    const patch = doc.paths['/v1/notes/{id}'].patch;
    expect(patch.parameters.some((p: any) => p.name === 'If-Match')).toBe(true);
    expect(patch.responses['409']).toBeDefined();
    expect(doc.paths['/v1/notes/{id}/versions']).toBeDefined();
    expect(doc.paths['/v1/notes/{id}/versions/{version}']).toBeDefined();
  });
});
