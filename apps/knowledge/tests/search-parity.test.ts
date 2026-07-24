/**
 * Search-parity suite — SQLite keyword behavior after Stage 1 of the overhaul.
 *
 * Stage 1 replaces the OR-of-prefixes FTS builder with a real query parser
 * (AND default, "phrase", prefix*, OR / NOT), adds bm25 column weights favoring
 * title/source_uri over body, a diacritic-folding tokenizer, and offset
 * pagination. The assertions below are the flipped counterparts of the Stage 0
 * characterization tests (the git history for this file is the behavior diff).
 */
import { describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hybridSearch } from '../src/search';
import { buildParitySqliteDb } from './fixtures/search-parity-fixtures';

function freshDb(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ok-search-parity-'));
  const dbPath = join(dir, 'knowledge.db');
  buildParitySqliteDb(dbPath);
  return dbPath;
}

function keywordIds(results: Awaited<ReturnType<typeof hybridSearch>>): string[] {
  return results.results.filter((r) => r.kind === 'source_chunk').map((r) => r.id);
}

describe('search parity — Stage 1 SQLite keyword behavior', () => {
  test('multi-term query is AND by default: single-term docs are excluded', async () => {
    const dbPath = freshDb();
    const results = await hybridSearch({ dbPath, query: 'alpha beta', limit: 20 });
    const ids = keywordIds(results);
    expect(ids).toContain('c_alpha_beta'); // has both terms
    expect(ids).not.toContain('c_alpha_only'); // only "alpha"
    expect(ids).not.toContain('c_beta_only'); // only "beta"
  });

  test('AND-first with OR fallback: recall is preserved when no doc has all terms', async () => {
    const dbPath = freshDb();
    const results = await hybridSearch({ dbPath, query: 'alpha gamma', limit: 20 });
    // No document contains both "alpha" and "gamma", so the strict AND pass is
    // empty and the query degrades to OR recall rather than returning nothing.
    const ids = keywordIds(results);
    expect(ids).toContain('c_alpha_beta');
    expect(ids).toContain('c_gamma');
  });

  test('AND precision wins when a doc satisfies all terms (no OR fallback)', async () => {
    const dbPath = freshDb();
    // "alpha beta" has an all-terms match (c_alpha_beta), so the OR fallback must
    // NOT fire — single-term docs stay excluded.
    const results = await hybridSearch({ dbPath, query: 'alpha beta', limit: 20 });
    const ids = keywordIds(results);
    expect(ids).toEqual(['c_alpha_beta']);
  });

  test('OR operator restores disjunction explicitly', async () => {
    const dbPath = freshDb();
    const results = await hybridSearch({ dbPath, query: 'alpha OR gamma', limit: 20 });
    const ids = keywordIds(results);
    expect(ids).toContain('c_alpha_beta');
    expect(ids).toContain('c_gamma');
  });

  test('quoted phrase honors adjacency and excludes the scrambled doc', async () => {
    const dbPath = freshDb();
    const results = await hybridSearch({ dbPath, query: '"quick brown"', limit: 20 });
    const ids = keywordIds(results);
    expect(ids).toContain('c_phrase'); // "...quick brown fox..."
    expect(ids).not.toContain('c_phrase_scrambled'); // "brown the quick..." — not adjacent
  });

  test('NOT / leading-dash negation excludes matching docs', async () => {
    const dbPath = freshDb();
    const results = await hybridSearch({ dbPath, query: 'alpha -beta', limit: 20 });
    const ids = keywordIds(results);
    expect(ids).toContain('c_alpha_only');
    expect(ids).not.toContain('c_alpha_beta'); // contains "beta"
  });

  test('prefix matching returns stemmed/extended forms', async () => {
    const dbPath = freshDb();
    const results = await hybridSearch({ dbPath, query: 'kubern*', limit: 20 });
    const ids = keywordIds(results);
    expect(ids).toContain('c_title_term'); // "Kubernetes deployment ..."
    expect(ids).toContain('c_body_term'); // "...kubernetes appears..."
  });

  test('bm25 column weights rank a title match above a body-only match', async () => {
    const dbPath = freshDb();
    const results = await hybridSearch({ dbPath, query: 'kubernetes', limit: 20 });
    const ids = keywordIds(results);
    const titleRank = ids.indexOf('c_title_term');
    const bodyRank = ids.indexOf('c_body_term');
    expect(titleRank).toBeGreaterThanOrEqual(0);
    expect(bodyRank).toBeGreaterThanOrEqual(0);
    expect(titleRank).toBeLessThan(bodyRank);
  });

  test('diacritic folding: an unaccented query matches accented content', async () => {
    const dbPath = freshDb();
    const results = await hybridSearch({ dbPath, query: 'cafe resume', limit: 20 });
    expect(keywordIds(results)).toContain('c_diacritic');
  });

  test('offset pagination is stable and non-overlapping', async () => {
    const dbPath = freshDb();
    const full = await hybridSearch({ dbPath, query: 'the', limit: 20, offset: 0 });
    const fullIds = full.results.map((r) => `${r.kind}:${r.id}`);
    expect(fullIds.length).toBeGreaterThanOrEqual(4);

    const page1 = await hybridSearch({ dbPath, query: 'the', limit: 2, offset: 0 });
    const page2 = await hybridSearch({ dbPath, query: 'the', limit: 2, offset: 2 });
    const p1 = page1.results.map((r) => `${r.kind}:${r.id}`);
    const p2 = page2.results.map((r) => `${r.kind}:${r.id}`);

    expect(page1.offset).toBe(0);
    expect(page2.offset).toBe(2);
    expect(p1).toEqual(fullIds.slice(0, 2));
    expect(p2).toEqual(fullIds.slice(2, 4));
    expect(p1.filter((id) => p2.includes(id))).toHaveLength(0); // no overlap
  });
});
