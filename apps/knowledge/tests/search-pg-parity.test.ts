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
import { PGlite } from '@electric-sql/pglite';
import { PG_MIGRATIONS } from '../src/db/pg-migrations';
import { NoteRepo } from '../src/serve';
import { hybridSearch } from '../src/search';
import { PARITY_CORPUS, buildParitySqliteDb } from './fixtures/search-parity-fixtures';

// Minimal PoolQueryClient shim backed by pglite (the subset NoteRepo uses).
function pgliteClient(db: PGlite): any {
  return {
    async query(sql: string, params: unknown[] = []) {
      return db.query(sql, params as unknown[]);
    },
    async many<T>(sql: string, params: unknown[] = []) {
      return (await db.query<T>(sql, params as unknown[])).rows;
    },
    async get<T>(sql: string, params: unknown[] = []) {
      return (await db.query<T>(sql, params as unknown[])).rows[0] ?? null;
    },
    async one<T>(sql: string, params: unknown[] = []) {
      const row = (await db.query<T>(sql, params as unknown[])).rows[0];
      if (!row) throw new Error('no rows');
      return row;
    },
    async execute(sql: string, params: unknown[] = []) {
      await db.query(sql, params as unknown[]);
    },
    async close() {},
    get pool() {
      return {} as unknown;
    },
  };
}

let db: PGlite;
let repo: NoteRepo;

beforeAll(async () => {
  db = new PGlite();
  // Apply the real cloud DDL for the notes catalog (table, indexes, and the
  // Stage 2 tsvector column + GIN index), in array order.
  for (const sql of PG_MIGRATIONS.filter((s) => s.includes('knowledge_items'))) {
    await db.exec(sql);
  }
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
  repo = new NoteRepo(pgliteClient(db));
});

afterAll(async () => {
  await db?.close();
});

async function listIds(search: string): Promise<string[]> {
  const result = await repo.list({ search, limit: 50 });
  return result.items.map((item) => item.id);
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
    const result = await repo.list({ search: 'kubernetes', limit: 50 });
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
});
