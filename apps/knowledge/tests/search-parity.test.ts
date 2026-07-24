/**
 * Search-parity characterization suite (Stage 0 of the search overhaul).
 *
 * These tests pin the CURRENT, pre-overhaul SQLite keyword behavior against the
 * shared parity corpus so later stages produce a reviewable behavior diff:
 *
 *   - multi-term queries are OR-of-prefixes today (any term matches), so a query
 *     for two terms returns documents that contain only one of them;
 *   - there is no phrase operator, so a quoted query behaves like its bare terms.
 *
 * Stage 1 (real query parser: AND-default + "phrase" + prefix*) flips these
 * expectations; the diff in this file is the human-readable proof of the change.
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

describe('search parity — current SQLite keyword behavior (pre-overhaul baseline)', () => {
  test('multi-term query uses OR semantics: single-term docs still match', async () => {
    const dbPath = freshDb();
    const results = await hybridSearch({ dbPath, query: 'alpha beta', limit: 20 });
    const ids = keywordIds(results);
    // Baseline: OR-of-prefixes returns the doc with BOTH terms *and* each
    // single-term doc. Stage 1 (AND default) will drop the single-term docs.
    expect(ids).toContain('c_alpha_beta');
    expect(ids).toContain('c_alpha_only');
    expect(ids).toContain('c_beta_only');
  });

  test('unrelated term in a multi-term query still pulls its doc in (OR)', async () => {
    const dbPath = freshDb();
    const results = await hybridSearch({ dbPath, query: 'alpha gamma', limit: 20 });
    // Baseline: "gamma" alone drags c_gamma into the results even though no doc
    // contains both terms. Stage 1 (AND) will return zero source chunks here.
    expect(keywordIds(results)).toContain('c_gamma');
  });

  test('quoted phrase is not honored today (behaves like bare terms)', async () => {
    const dbPath = freshDb();
    const results = await hybridSearch({ dbPath, query: '"quick brown"', limit: 20 });
    const ids = keywordIds(results);
    // Baseline: the scrambled doc ("brown the quick ...") still matches because
    // there is no phrase operator. Stage 1 will exclude it for the exact phrase.
    expect(ids).toContain('c_phrase');
    expect(ids).toContain('c_phrase_scrambled');
  });
});
