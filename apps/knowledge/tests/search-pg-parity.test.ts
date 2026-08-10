/**
 * Postgres full-text parity suite (Stage 2 of the search overhaul).
 *
 * Runs the real NoteRepo against an in-process Postgres (pglite) with the
 * actual cloud migrations applied, so these are genuine behavior tests — not
 * SQL-shape assertions. They fail on the pre-Stage-2 ILIKE-substring +
 * `ORDER BY created_at DESC` implementation and pass on the tsvector +
 * websearch_to_tsquery + ts_rank_cd path:
 *
 *   - word-order-independent multi-term match ("beta alpha" finds a doc whose
 *     text is "alpha beta ...", which ILIKE '%beta alpha%' returns EMPTY for —
 *     the "cloud returns nothing" bug);
 *   - relevance ranking (title-weighted) instead of recency ordering;
 *   - quoted-phrase adjacency;
 *   - parity with the local SQLite backend over the shared corpus.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PGlite } from '@electric-sql/pglite';
import { NoteRepo } from '../src/serve';
import { hybridSearch } from '../src/search';
import { PARITY_CORPUS, buildParitySqliteDb } from './fixtures/search-parity-fixtures';
import { createMigratedPglite, pgliteClient } from './fixtures/pglite-client';

let db: PGlite;
let repo: NoteRepo;

beforeAll(async () => {
  // Shared harness rather than a private shim. The copy that used to live here
  // had no `transaction()`, so the moment NoteRepo's write path started using
  // one it would have thrown inside this file — it survived only because these
  // tests happen to call `list()` exclusively. That is the latent drift the
  // shared fixture exists to remove.
  //
  // It also applies the FULL migration set, not a name-filtered subset, so this
  // suite ranks against the same schema production has.
  const created = await createMigratedPglite();
  db = created.db;
  // Seed the shared parity corpus with deterministic, increasing created_at so
  // the "relevance beats recency" assertion is meaningful (later index = newer).
  for (let i = 0; i < PARITY_CORPUS.length; i += 1) {
    const doc = PARITY_CORPUS[i]!;
    const createdAt = new Date(2026, 0, 1 + i).toISOString();
    await db.query(
      `INSERT INTO knowledge_items (id, short_id, title, content, tags, metadata, archived, created_at, updated_at)
       VALUES ($1,$2,$3,$4,'[]'::jsonb,'{}'::jsonb,FALSE,$5,$5)`,
      [doc.id, doc.id.slice(0, 8), doc.title, doc.text, createdAt],
    );
  }
  const listFixtures = [
    {
      id: 'list_id_literal_needle',
      shortId: 'short-no-match',
      title: 'Literal alpha title',
      content: 'plain list body',
      tags: ['red', 'blue'],
      archived: false,
      createdAt: '2026-02-01T00:00:00.000Z',
    },
    {
      id: 'list_title_match',
      shortId: 'short-title',
      title: 'Needle in title',
      content: 'plain body',
      tags: ['red,blue'],
      archived: false,
      createdAt: '2026-02-02T00:00:00.000Z',
    },
    {
      id: 'list_content_match',
      shortId: 'short-content',
      title: 'Other title',
      content: 'Needle in content',
      tags: ['red', 'blue', 'green'],
      archived: true,
      createdAt: '2026-02-03T00:00:00.000Z',
    },
    {
      id: 'list_short_excluded',
      shortId: 'needle-short-only',
      title: 'No literal here',
      content: 'No literal here either',
      tags: ['red'],
      archived: false,
      createdAt: '2026-02-04T00:00:00.000Z',
    },
  ] as const;
  for (const fixture of listFixtures) {
    await db.query(
      `INSERT INTO knowledge_items
         (id, short_id, title, content, tags, metadata, archived, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5::jsonb,'{}'::jsonb,$6,$7,$7)`,
      [
        fixture.id,
        fixture.shortId,
        fixture.title,
        fixture.content,
        JSON.stringify(fixture.tags),
        fixture.archived,
        fixture.createdAt,
      ],
    );
  }
  repo = new NoteRepo(pgliteClient(db));
});

afterAll(async () => {
  await db?.close();
});

async function listIds(search: string): Promise<string[]> {
  const result = await repo.search({ query: search, limit: 50 });
  return result.items.map((hit) => hit.item.id);
}

describe('search parity — Stage 2 Postgres full-text', () => {
  test('multi-term match is word-order independent (kills the ILIKE empty-result bug)', async () => {
    // "beta alpha" reversed vs the document text "alpha beta ...".
    // ILIKE '%beta alpha%' returns nothing; FTS AND matches.
    const ids = await listIds('beta alpha');
    expect(ids).toContain('c_alpha_beta');
    expect(ids).not.toContain('c_alpha_only');
    expect(ids).not.toContain('c_beta_only');
  });

  test('ranks by relevance (title-weighted), not recency', async () => {
    // c_title_term (term in title, older) must outrank c_body_term (term in
    // body, newer). The old ORDER BY created_at DESC would surface the newer
    // body match first.
    const ids = await listIds('kubernetes');
    const titleRank = ids.indexOf('c_title_term');
    const bodyRank = ids.indexOf('c_body_term');
    expect(titleRank).toBeGreaterThanOrEqual(0);
    expect(bodyRank).toBeGreaterThanOrEqual(0);
    expect(titleRank).toBeLessThan(bodyRank);
  });

  test('quoted phrase honors adjacency', async () => {
    const ids = await listIds('"quick brown"');
    expect(ids).toContain('c_phrase');
    expect(ids).not.toContain('c_phrase_scrambled');
  });

  test('total reflects the full-text predicate, not the whole table', async () => {
    const result = await repo.search({ query: 'kubernetes', limit: 50 });
    expect(result.total).toBe(2); // c_title_term + c_body_term only
    expect(result.items).toHaveLength(2);
  });

  test('sqlite-vs-pg equivalence: identical result set for a precise AND query', async () => {
    const pgIds = (await listIds('alpha beta')).sort();

    const dir = mkdtempSync(join(tmpdir(), 'ok-pg-parity-sqlite-'));
    const dbPath = join(dir, 'knowledge.db');
    buildParitySqliteDb(dbPath);
    const sqlite = await hybridSearch({ dbPath, query: 'alpha beta', limit: 50 });
    const sqliteIds = sqlite.results
      .filter((r) => r.kind === 'source_chunk')
      .map((r) => r.id)
      .sort();

    expect(pgIds).toEqual(['c_alpha_beta']);
    expect(sqliteIds).toEqual(['c_alpha_beta']);
    expect(pgIds).toEqual(sqliteIds);
  });

  test('ranked search preserves OR, negation, limit, and offset producer semantics', async () => {
    const orResult = await repo.search({ query: 'alpha OR kubernetes', limit: 50 });
    const orIds = orResult.items.map((hit) => hit.item.id);
    expect(orIds).toContain('c_alpha_beta');
    expect(orIds).toContain('c_title_term');

    const negated = await repo.search({ query: 'alpha -beta', limit: 50 });
    const negatedIds = negated.items.map((hit) => hit.item.id);
    expect(negatedIds).toContain('c_alpha_only');
    expect(negatedIds).not.toContain('c_alpha_beta');

    const first = await repo.search({ query: 'kubernetes', limit: 1, offset: 0 });
    const second = await repo.search({ query: 'kubernetes', limit: 1, offset: 1 });
    expect(first.total).toBe(2);
    expect(second.total).toBe(2);
    expect(first.items).toHaveLength(1);
    expect(second.items).toHaveLength(1);
    expect(first.items[0]!.item.id).not.toBe(second.items[0]!.item.id);
  });
});

describe('bounded public list compatibility — producer-side PGlite', () => {
  test('literal matching covers full id, title, and content but excludes short id', async () => {
    const result = await repo.list({ filter: 'needle', archive: 'all', limit: 50 });
    expect(result.items.map((item) => item.id).sort()).toEqual([
      'list_content_match',
      'list_id_literal_needle',
      'list_title_match',
    ]);
  });

  test('repeated tags narrow and comma-containing filters preserve whole-or-split semantics', async () => {
    const repeated = await repo.list({
      tags: ['red', 'green'],
      archive: 'all',
      limit: 50,
    });
    expect(repeated.items.map((item) => item.id)).toEqual(['list_content_match']);

    const glued = await repo.list({
      tags: ['red,blue'],
      archive: 'all',
      limit: 50,
    });
    expect(glued.items.map((item) => item.id).sort()).toEqual([
      'list_content_match',
      'list_id_literal_needle',
      'list_title_match',
    ]);
  });

  test('archive modes, total-before-page, deterministic ordering, and bounds are exact', async () => {
    const active = await repo.list({ filter: 'list_', archive: 'active', limit: 50 });
    expect(active.items.map((item) => item.id)).toEqual([
      'list_id_literal_needle',
      'list_title_match',
      'list_short_excluded',
    ]);
    const archived = await repo.list({ filter: 'list_', archive: 'archived', limit: 50 });
    expect(archived.items.map((item) => item.id)).toEqual(['list_content_match']);

    const page = await repo.list({
      filter: 'list_',
      archive: 'all',
      sort: 'title',
      direction: 'desc',
      limit: 2,
      offset: 1,
    });
    expect(page.total).toBe(4);
    expect(page.items).toHaveLength(2);
    expect(page.items.map((item) => item.title)).toEqual(['No literal here', 'Needle in title']);

    await expect(repo.list({ limit: 0 })).rejects.toThrow(/limit/);
    await expect(repo.list({ limit: 201 })).rejects.toThrow(/limit/);
    await expect(repo.list({ offset: -1 })).rejects.toThrow(/offset/);
    await expect(repo.list({ offset: 10_001 })).rejects.toThrow(/offset/);
  });
});
