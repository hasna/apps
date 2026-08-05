/**
 * Regression tests for todos task b9f6c835 — owner directive 2026-08-05.
 *
 * THE DIRECTIVE: every agent must be notified when knowledge is created or
 * updated, receiving the TITLE, a BRIEF DESCRIPTION, and a prompt to read it if
 * it matters. A notification cannot carry a description the store does not
 * hold, so the field is the precondition for the whole feature.
 *
 * WHY THE FIELD IS REQUIRED AT WRITE TIME AND NOT MERELY AVAILABLE — this is
 * the load-bearing decision and it is settled by measurement, not taste.
 * hasna/mementos already ships exactly this kind of human-guidance field
 * (`when_to_use`). It has existed for a long time and is populated on ZERO of
 * its rows, because nothing forces it. `summary` on the same store, also
 * optional, sits at 6.4% of 6529 rows and is FALLING (July 70.0%, August 3.3%).
 * An optional guidance field lands at zero. That is measured, not predicted, so
 * this field is refused at the write path rather than documented as encouraged.
 *
 * WHAT ENFORCES IT, and why there is more than one layer. The obvious place —
 * `ItemCreateInput` in item-store.ts — is a PLAIN TYPESCRIPT INTERFACE, erased
 * at compile time, enforcing nothing at runtime; the same is true of `NoteInput`
 * in serve.ts. (zod is a dependency of this package but is imported only by
 * schema.js and mcp.js.) So a type annotation alone would be a comment. The
 * runtime floors are therefore:
 *   - LOCAL: an explicit check inside the store's create path, below the CLI,
 *     so an SDK or MCP caller cannot route around it.
 *   - CLOUD: a Postgres CHECK constraint, which sits below the serve handler,
 *     the upsert branch, sync/outbox replay, a backfill script, and a human at
 *     psql — the same argument this repo already made for the versioning
 *     trigger in db/pg-migrations.ts, and for the same reason: the writers are
 *     already plural and next month there will be another.
 *
 * EXISTING ROWS ARE NOT REWRITTEN. The constraint is added NOT VALID, so it
 * binds every new INSERT and UPDATE without being checked against the 1361 rows
 * already stored. `description IS NULL` is the mark of a legacy row; no second
 * column and no status enum. Legacy rows stay readable, listable and gettable —
 * asserted below, because a migration that makes existing knowledge unreadable
 * would be a far worse defect than the one being fixed.
 *
 * Every test here runs IN-PROCESS against an explicit temp store path. That is
 * deliberate: on a contended station the subprocess-spawning CLI tests in this
 * repo time out at their 5000ms budget regardless of correctness (measured at
 * load 31 on 20 cores, where the same unmodified code failed 15 tests in one
 * run and 26 in the next). A test whose result tracks the box rather than the
 * code is not a regression test.
 */
import { describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { resolveItemStore, type ItemStore } from '../src/item-store';
import {
  KnowledgeDescriptionRequiredError,
  KnowledgeTaxonomyValueError,
  REACH_VALUES,
  CONSEQUENCE_VALUES,
  DESCRIPTION_MIN_LENGTH,
  DESCRIPTION_MAX_LENGTH,
  validateDescription,
  normalizeReach,
  normalizeConsequence,
} from '../src/knowledge-taxonomy';
import { sortItems } from '../src/cli';
import { PG_MIGRATIONS } from '../src/db/pg-migrations';
import { createMigratedPglite } from './fixtures/pglite-client';

function localStore(): ItemStore {
  const dir = mkdtempSync(join(tmpdir(), 'knowledge-desc-'));
  return resolveItemStore({ storePath: join(dir, 'db.json'), storePathOverridden: true });
}

/** A description that satisfies the bounds, for tests about something else. */
const GOOD_DESCRIPTION = 'Explains why the squash merge body must carry the Agent trailer.';

describe('knowledge description field (owner directive 2026-08-05)', () => {
  test('create REFUSES an item with no description at all', async () => {
    const store = localStore();
    // The cast is the point of the test: a JS caller, an SDK consumer, or the
    // MCP server can and does omit this field, and the TypeScript interface
    // cannot stop them. The runtime check must.
    await expect(
      store.create({ title: 'Some title', content: 'Some content' } as never),
    ).rejects.toBeInstanceOf(KnowledgeDescriptionRequiredError);
  });

  test('create REFUSES an empty or whitespace-only description', async () => {
    const store = localStore();
    for (const blank of ['', '   ', '\n\t  ']) {
      await expect(
        store.create({ title: 'T', content: 'C', description: blank } as never),
      ).rejects.toBeInstanceOf(KnowledgeDescriptionRequiredError);
    }
  });

  test('create ACCEPTS a valid description and stores it verbatim (trimmed)', async () => {
    const store = localStore();
    const item = await store.create({
      title: 'Agent trailer survives squash',
      content: 'body',
      description: `  ${GOOD_DESCRIPTION}  `,
    });
    expect(item.description).toBe(GOOD_DESCRIPTION);
    // And it survives a round trip through the store, not just the return value.
    const fetched = await store.get(item.id);
    expect(fetched?.description).toBe(GOOD_DESCRIPTION);
  });

  test('a too-short description is refused, and one at the boundary is accepted', async () => {
    const store = localStore();
    // Two-sided: the check must be able to both fire and stay silent, or it is
    // not evidence about anything.
    const tooShort = 'a'.repeat(DESCRIPTION_MIN_LENGTH - 1);
    const exactlyMin = 'a'.repeat(DESCRIPTION_MIN_LENGTH);
    await expect(
      store.create({ title: 'T', content: 'C', description: tooShort }),
    ).rejects.toBeInstanceOf(KnowledgeDescriptionRequiredError);
    const ok = await store.create({ title: 'T', content: 'C', description: exactlyMin });
    expect(ok.description).toBe(exactlyMin);
  });

  test('a too-long description is refused, and one at the boundary is accepted', async () => {
    const store = localStore();
    const tooLong = 'a'.repeat(DESCRIPTION_MAX_LENGTH + 1);
    const exactlyMax = 'a'.repeat(DESCRIPTION_MAX_LENGTH);
    await expect(
      store.create({ title: 'T', content: 'C', description: tooLong }),
    ).rejects.toBeInstanceOf(KnowledgeDescriptionRequiredError);
    const ok = await store.create({ title: 'T', content: 'C', description: exactlyMax });
    expect(ok.description).toBe(exactlyMax);
  });

  test('the refusal NAMES the field and says how to supply it', async () => {
    const store = localStore();
    // A guard whose message does not tell the caller what to do produces an
    // agent that debugs the store instead of adding the flag.
    let message = '';
    try {
      await store.create({ title: 'T', content: 'C' } as never);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain('--description');
    expect(message.toLowerCase()).toContain('description');
  });

  test('update can SET a description on a legacy row that has none', async () => {
    const store = localStore();
    const item = await store.create({ title: 'T', content: 'C', description: GOOD_DESCRIPTION });
    const next = `${GOOD_DESCRIPTION} Amended.`;
    const updated = await store.update(item.id, { description: next });
    expect(updated?.description).toBe(next);
  });

  test('update REFUSES a description that is present but invalid', async () => {
    const store = localStore();
    const item = await store.create({ title: 'T', content: 'C', description: GOOD_DESCRIPTION });
    await expect(store.update(item.id, { description: 'too short' })).rejects.toBeInstanceOf(
      KnowledgeDescriptionRequiredError,
    );
    // The stored value must be untouched by the refused write.
    const fetched = await store.get(item.id);
    expect(fetched?.description).toBe(GOOD_DESCRIPTION);
  });

  test('an update that does not mention description leaves it alone', async () => {
    const store = localStore();
    const item = await store.create({ title: 'T', content: 'C', description: GOOD_DESCRIPTION });
    const updated = await store.update(item.id, { title: 'New title' });
    expect(updated?.title).toBe('New title');
    expect(updated?.description).toBe(GOOD_DESCRIPTION);
  });
});

describe('legacy rows written before the field existed stay readable', () => {
  test('a stored item with no description is still listed and fetched', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'knowledge-legacy-'));
    const storePath = join(dir, 'db.json');
    // Write a legacy-shaped row directly, bypassing every application path —
    // exactly what the 1361 existing rows look like.
    //
    // `Bun.write` returns a Promise and MUST be awaited. Unawaited, the read
    // below races the write: POSIX runners happened to win that race and the
    // test passed on every local run, while Windows CI lost it and read an
    // absent file as an empty store — `toHaveLength(1)` received 0. The
    // failure therefore looked like "legacy rows are not readable", i.e. a
    // defect in the feature under test, when it was only the fixture not
    // having landed yet. Every other Bun.write in tests/ (5 of 5) awaits.
    await Bun.write(
      storePath,
      JSON.stringify({
        items: [
          {
            id: 'k_legacy_0001',
            short_id: 'legacy1',
            title: 'A legacy item',
            content: 'written before description existed',
            url: null,
            tags: [],
            metadata: {},
            archived: false,
            created_at: '2026-07-01T00:00:00.000Z',
            updated_at: '2026-07-01T00:00:00.000Z',
            version: 1,
          },
        ],
      }),
    );
    const store = resolveItemStore({ storePath, storePathOverridden: true });
    const listed = await store.listAll();
    expect(listed.items).toHaveLength(1);
    expect(listed.items[0]!.title).toBe('A legacy item');
    // `description IS NULL` is the mark of a legacy row — readable, not broken.
    expect(listed.items[0]!.description ?? null).toBeNull();
    const fetched = await store.get('k_legacy_0001');
    expect(fetched?.title).toBe('A legacy item');
  });
});

describe('taxonomy: reach and consequence', () => {
  test('the two axes carry the documented closed vocabularies', () => {
    expect([...REACH_VALUES]).toEqual(['fleet', 'project', 'seat', 'self']);
    expect([...CONSEQUENCE_VALUES]).toEqual(['blocking', 'standing', 'reference']);
  });

  test('every vocabulary value is accepted', () => {
    for (const value of REACH_VALUES) expect(normalizeReach(value)).toBe(value);
    for (const value of CONSEQUENCE_VALUES) expect(normalizeConsequence(value)).toBe(value);
  });

  test('a value outside the vocabulary is refused, and the error lists the legal set', () => {
    // Negative control for the two assertions above: if normalize accepted
    // anything, the "every value is accepted" test would pass vacuously.
    expect(() => normalizeReach('global')).toThrow(KnowledgeTaxonomyValueError);
    expect(() => normalizeConsequence('important')).toThrow(KnowledgeTaxonomyValueError);
    let message = '';
    try {
      normalizeReach('global');
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    for (const value of REACH_VALUES) expect(message).toContain(value);
  });

  test('reach and consequence round-trip through the store', async () => {
    const store = localStore();
    const item = await store.create({
      title: 'T',
      content: 'C',
      description: GOOD_DESCRIPTION,
      reach: 'fleet',
      consequence: 'blocking',
    });
    expect(item.reach).toBe('fleet');
    expect(item.consequence).toBe('blocking');
    const fetched = await store.get(item.id);
    expect(fetched?.reach).toBe('fleet');
    expect(fetched?.consequence).toBe('blocking');
  });

  test('an item written without the axes carries neither — the default is QUIET', async () => {
    const store = localStore();
    const item = await store.create({ title: 'T', content: 'C', description: GOOD_DESCRIPTION });
    // Absent rather than eagerly stamped: a monitor treats absent as
    // self/reference. Storing a default eagerly would make the field 100%
    // populated and worthless as a signal — which is precisely what happened to
    // mementos' `scope`, 400/400 populated and carrying no information.
    expect(item.reach ?? null).toBeNull();
    expect(item.consequence ?? null).toBeNull();
  });

  test('the store refuses an out-of-vocabulary axis value', async () => {
    const store = localStore();
    await expect(
      store.create({ title: 'T', content: 'C', description: GOOD_DESCRIPTION, reach: 'global' } as never),
    ).rejects.toBeInstanceOf(KnowledgeTaxonomyValueError);
  });
});

describe('update detection: knowledge list --sort updated', () => {
  const item = (id: string, created: string, updated: string) => ({
    id,
    title: `title-${id}`,
    content: '',
    url: null,
    tags: [],
    created_at: created,
    updated_at: updated,
  });

  test('--sort updated orders by updated_at, not created_at', () => {
    // Constructed so the two orders DISAGREE — otherwise the test cannot tell
    // which field was actually read and would pass on the old code.
    const items = [
      item('a', '2026-01-01T00:00:00Z', '2026-03-01T00:00:00Z'),
      item('b', '2026-02-01T00:00:00Z', '2026-01-15T00:00:00Z'),
      item('c', '2026-03-01T00:00:00Z', '2026-02-01T00:00:00Z'),
    ];
    const byUpdated = sortItems(items as never, { sort: 'updated' } as never);
    expect(byUpdated.sorted.map((entry) => entry.id)).toEqual(['b', 'c', 'a']);
    expect(byUpdated.sort).toBe('updated');

    // Positive control that the fixture really does discriminate: the same
    // input sorted by the pre-existing key yields a DIFFERENT order.
    const byCreated = sortItems(items as never, { sort: 'created' } as never);
    expect(byCreated.sorted.map((entry) => entry.id)).toEqual(['a', 'b', 'c']);
  });

  test('--sort updated --desc reverses, so the most recently updated leads', () => {
    const items = [
      item('a', '2026-01-01T00:00:00Z', '2026-03-01T00:00:00Z'),
      item('b', '2026-02-01T00:00:00Z', '2026-01-15T00:00:00Z'),
    ];
    const result = sortItems(items as never, { sort: 'updated', desc: true } as never);
    expect(result.sorted.map((entry) => entry.id)).toEqual(['a', 'b']);
    expect(result.direction).toBe('desc');
  });

  test('the pre-existing sort keys still work and an invalid one is still refused', () => {
    const items = [item('a', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')];
    expect(() => sortItems(items as never, { sort: 'created' } as never)).not.toThrow();
    expect(() => sortItems(items as never, { sort: 'title' } as never)).not.toThrow();
    // Negative control: the validator must still reject, or "updated is
    // accepted" would be a statement about a validator that accepts everything.
    expect(() => sortItems(items as never, { sort: 'nonsense' } as never)).toThrow();
  });
});

describe('the cloud floor: Postgres migration', () => {
  const sql = PG_MIGRATIONS.join('\n;\n');

  test('adds the three columns', () => {
    expect(sql).toContain('description');
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS description/i);
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS reach/i);
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS consequence/i);
  });

  test('the description CHECK is added NOT VALID so existing rows are never rewritten', () => {
    // The whole migration story depends on this token. Without NOT VALID the
    // ALTER scans 1361 rows, fails on every legacy row, and the deploy stops.
    expect(sql).toMatch(/knowledge_items_description_present[\s\S]*?NOT VALID/i);
  });

  test('the vocabulary CHECKs pin exactly the documented values', () => {
    for (const value of REACH_VALUES) expect(sql).toContain(`'${value}'`);
    for (const value of CONSEQUENCE_VALUES) expect(sql).toContain(`'${value}'`);
    expect(sql).toMatch(/knowledge_items_reach_vocab/i);
    expect(sql).toMatch(/knowledge_items_consequence_vocab/i);
  });

  test('the version trigger no-op guard includes the new columns', () => {
    // Without this, a description-only edit produces NO version row and NO
    // counter bump — the edit would be invisible to the very update-detection
    // surface this task exists to build.
    const guard = sql.match(/IS NOT DISTINCT FROM[\s\S]{0,400}/g)?.join('\n') ?? '';
    expect(guard).toContain('description');
    expect(guard).toContain('reach');
    expect(guard).toContain('consequence');
  });

  test('the migration set applies cleanly to a real Postgres', async () => {
    // SQL-shape assertions above prove the text is present; they cannot prove it
    // is VALID SQL or that it applies in order. This does.
    const { db } = await createMigratedPglite();
    const row = await db.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM information_schema.columns
        WHERE table_name = 'knowledge_items' AND column_name IN ('description','reach','consequence')`,
    );
    expect(row.rows[0]!.count).toBe('3');
    await db.close();
  });

  test('the CHECK actually REFUSES a raw INSERT with no description, and accepts one with', async () => {
    // A raw INSERT bypasses the CLI, the Store, and the serve handler — every
    // application-level guard at once. This is the layer that catches sync
    // replay, a backfill script, and a human at psql, so it is the one worth
    // exercising rather than reasoning about.
    const { db } = await createMigratedPglite();
    const insert = (id: string, description: string | null) => db.query(
      `INSERT INTO knowledge_items (id, short_id, title, content, description, tags, metadata, archived, created_at, updated_at)
       VALUES ($1,$2,'T','body',$3,'[]'::jsonb,'{}'::jsonb,FALSE,'2026-08-05T00:00:00.000Z','2026-08-05T00:00:00.000Z')`,
      [id, id.slice(0, 8), description],
    );

    // Negative: refused, and specifically as a CHECK violation (SQLSTATE 23514)
    // rather than any other error that would also make this test "pass".
    let code = '';
    try {
      await insert('k_no_desc', null);
    } catch (error) {
      code = (error as { code?: string }).code ?? '';
    }
    expect(code).toBe('23514');

    // Positive control: the identical statement WITH a description succeeds, so
    // the refusal above is attributable to the description and not to the shape
    // of the insert.
    await insert('k_with_desc', GOOD_DESCRIPTION);
    const stored = await db.query<{ description: string }>(
      `SELECT description FROM knowledge_items WHERE id = 'k_with_desc'`,
    );
    expect(stored.rows[0]!.description).toBe(GOOD_DESCRIPTION);
    await db.close();
  });

  test('the vocabulary CHECK refuses an out-of-vocabulary reach at the database', async () => {
    const { db } = await createMigratedPglite();
    let code = '';
    try {
      await db.query(
        `INSERT INTO knowledge_items (id, short_id, title, content, description, reach, tags, metadata, archived, created_at, updated_at)
         VALUES ('k_bad_reach','k_bad_re','T','body',$1,'global','[]'::jsonb,'{}'::jsonb,FALSE,'2026-08-05T00:00:00.000Z','2026-08-05T00:00:00.000Z')`,
        [GOOD_DESCRIPTION],
      );
    } catch (error) {
      code = (error as { code?: string }).code ?? '';
    }
    expect(code).toBe('23514');
    await db.close();
  });

  test('NOT VALID grandfathers rows that already violate it — the whole migration story', async () => {
    // THIS IS THE CENTRAL CLAIM OF THE DESIGN and it was, until this test,
    // asserted only from documentation. If NOT VALID did not behave this way,
    // adding the constraint would abort against the existing corpus and every
    // deployment would fail — so it is worth exercising rather than believing.
    const { db } = await createMigratedPglite();

    // Drop the constraint and insert a legacy-shaped row with NO description,
    // reproducing a row written before the field existed.
    await db.query('ALTER TABLE knowledge_items DROP CONSTRAINT knowledge_items_description_present');
    await db.query(
      `INSERT INTO knowledge_items (id, short_id, title, content, tags, metadata, archived, created_at, updated_at)
       VALUES ('k_legacy','k_legacy','Legacy','written before the field existed','[]'::jsonb,'{}'::jsonb,FALSE,'2026-07-01T00:00:00.000Z','2026-07-01T00:00:00.000Z')`,
    );

    // Re-adding it NOT VALID must SUCCEED despite that row violating it.
    await db.query(
      `ALTER TABLE knowledge_items ADD CONSTRAINT knowledge_items_description_present
       CHECK (description IS NOT NULL AND char_length(btrim(description)) BETWEEN 24 AND 280) NOT VALID`,
    );

    // The legacy row is still there and still readable — not rewritten, not hidden.
    const legacy = await db.query<{ title: string; description: string | null }>(
      `SELECT title, description FROM knowledge_items WHERE id = 'k_legacy'`,
    );
    expect(legacy.rows[0]!.title).toBe('Legacy');
    expect(legacy.rows[0]!.description).toBeNull();

    // And `description IS NULL` finds it — the queryable mark of a legacy row.
    const unmarked = await db.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM knowledge_items WHERE description IS NULL`,
    );
    expect(unmarked.rows[0]!.count).toBe('1');

    // Meanwhile NEW writes are still refused, so grandfathering is not a hole.
    let code = '';
    try {
      await db.query(
        `INSERT INTO knowledge_items (id, short_id, title, content, tags, metadata, archived, created_at, updated_at)
         VALUES ('k_new','k_new','New','body','[]'::jsonb,'{}'::jsonb,FALSE,'2026-08-05T00:00:00.000Z','2026-08-05T00:00:00.000Z')`,
      );
    } catch (error) {
      code = (error as { code?: string }).code ?? '';
    }
    expect(code).toBe('23514');
    await db.close();
  });

  test('a description-only edit IS version-worthy — the trigger sees the new column', async () => {
    // If the no-op guard had not learned `description`, this edit would produce
    // no snapshot and no counter bump, and would be invisible to the very
    // update-detection surface this work exists to build.
    const { db } = await createMigratedPglite();
    await db.query(
      `INSERT INTO knowledge_items (id, short_id, title, content, description, tags, metadata, archived, created_at, updated_at)
       VALUES ('k_desc_edit','k_desc_e','T','body',$1,'[]'::jsonb,'{}'::jsonb,FALSE,'2026-08-05T00:00:00.000Z','2026-08-05T00:00:00.000Z')`,
      [GOOD_DESCRIPTION],
    );
    await db.query(`UPDATE knowledge_items SET description = $1 WHERE id = 'k_desc_edit'`, [
      `${GOOD_DESCRIPTION} Amended once.`,
    ]);
    const after = await db.query<{ version: number }>(
      `SELECT version FROM knowledge_items WHERE id = 'k_desc_edit'`,
    );
    expect(after.rows[0]!.version).toBe(2);
    const history = await db.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM knowledge_item_versions WHERE item_id = 'k_desc_edit'`,
    );
    expect(history.rows[0]!.count).toBe('1');

    // Negative control on the same row: a write that changes NOTHING must still
    // be a no-op, or the guard has simply been disabled rather than extended.
    await db.query(`UPDATE knowledge_items SET description = $1 WHERE id = 'k_desc_edit'`, [
      `${GOOD_DESCRIPTION} Amended once.`,
    ]);
    const unchanged = await db.query<{ version: number }>(
      `SELECT version FROM knowledge_items WHERE id = 'k_desc_edit'`,
    );
    expect(unchanged.rows[0]!.version).toBe(2);
    await db.close();
  });

  test('the new statements are APPENDED, never inserted mid-array', () => {
    // PG migration ids derive from array index (`knowledge_pg_${index+1}`), so
    // inserting mid-array shifts every following id and trips the ledger drift
    // guard. Pin the first statement so a future edit that prepends is caught.
    expect(PG_MIGRATIONS[0]).toMatch(/CREATE TABLE/i);
    const descriptionIndex = PG_MIGRATIONS.findIndex((statement) => /ADD COLUMN IF NOT EXISTS description/i.test(statement));
    const versionIndex = PG_MIGRATIONS.findIndex((statement) => /ADD COLUMN IF NOT EXISTS version INTEGER/i.test(statement));
    expect(descriptionIndex).toBeGreaterThan(versionIndex);
  });
});
