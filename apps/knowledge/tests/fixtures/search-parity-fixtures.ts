/**
 * Shared search-parity fixtures.
 *
 * A single, backend-agnostic document corpus plus small helpers to materialise
 * it into a local SQLite knowledge DB. The same corpus is reused by the SQLite
 * and Postgres parity suites so the two backends are asserted against identical
 * inputs (the "sqlite-vs-pg equivalence" goal of the search overhaul).
 *
 * The corpus is deliberately tiny and hand-authored so every expectation is
 * explainable from the text alone: it exercises multi-term AND, quoted phrase,
 * prefix, ranking (title vs body), diacritic folding, and pagination stability.
 */
import { migrateKnowledgeDb, openKnowledgeDb } from '../../src/knowledge-db';

export interface ParityDoc {
  /** Stable chunk id (also the knowledge_items id in the PG corpus). */
  id: string;
  title: string;
  /** Body text (maps to chunk.text locally / knowledge_items.content in cloud). */
  text: string;
  /** Synthetic source uri, indexed into the FTS source_uri column locally. */
  source_uri: string;
}

/**
 * Backend-agnostic corpus. Ordering here is the insertion order; it must NOT be
 * relied on for result ordering — ranking/pagination assertions live in the
 * suites.
 */
export const PARITY_CORPUS: ParityDoc[] = [
  {
    id: 'c_alpha_beta',
    title: 'Alpha Beta Guide',
    text: 'alpha beta configuration overview for operators',
    source_uri: 'file:///corpus/alpha-beta.md',
  },
  {
    id: 'c_alpha_only',
    title: 'Alpha Notes',
    text: 'alpha standalone reference without the second term',
    source_uri: 'file:///corpus/alpha-only.md',
  },
  {
    id: 'c_beta_only',
    title: 'Beta Notes',
    text: 'beta standalone reference without the first term',
    source_uri: 'file:///corpus/beta-only.md',
  },
  {
    id: 'c_gamma',
    title: 'Gamma Handbook',
    text: 'gamma unrelated content that shares no query terms',
    source_uri: 'file:///corpus/gamma.md',
  },
  {
    id: 'c_phrase',
    title: 'Fox Story',
    text: 'the quick brown fox jumps over the lazy dog',
    source_uri: 'file:///corpus/fox.md',
  },
  {
    id: 'c_phrase_scrambled',
    title: 'Scrambled Fox',
    text: 'brown the quick fox never jumps in this order',
    source_uri: 'file:///corpus/fox-scrambled.md',
  },
  {
    id: 'c_title_term',
    title: 'Kubernetes deployment runbook',
    text: 'generic body about servers and rollouts with no special keyword',
    source_uri: 'file:///corpus/k8s-title.md',
  },
  {
    id: 'c_body_term',
    title: 'Generic operations guide',
    text: 'the word kubernetes appears only in the body of this document',
    source_uri: 'file:///corpus/k8s-body.md',
  },
  {
    id: 'c_diacritic',
    title: 'Café résumé notes',
    text: 'the café served a naïve résumé to the señor at the piñata',
    source_uri: 'file:///corpus/diacritics.md',
  },
];

/**
 * Insert a chunk + its FTS row using the exact column contract the ingest paths
 * use (see manifest-ingest.ts / wiki-compiler.ts). Kept in one place so the
 * suites never drift from the production insert shape.
 */
export function insertParityChunk(db: ReturnType<typeof openKnowledgeDb>, doc: ParityDoc, ordinal: number): void {
  db.run(
    'INSERT INTO chunks (id, kind, ordinal, text, created_at) VALUES (?, ?, ?, ?, ?)',
    [doc.id, 'source', ordinal, doc.text, new Date(2026, 0, 1 + ordinal).toISOString()],
  );
  db.run(
    'INSERT INTO chunks_fts (chunk_id, text, title, source_uri) VALUES (?, ?, ?, ?)',
    [doc.id, doc.text, doc.title, doc.source_uri],
  );
}

/**
 * Materialise the full parity corpus into a fresh SQLite knowledge DB at
 * `dbPath` and return it. Applies all migrations first.
 */
export function buildParitySqliteDb(dbPath: string): void {
  migrateKnowledgeDb(dbPath);
  const db = openKnowledgeDb(dbPath);
  try {
    db.exec('BEGIN');
    PARITY_CORPUS.forEach((doc, index) => insertParityChunk(db, doc, index));
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  } finally {
    db.close();
  }
}

/** Convenience: the ids of docs that contain a given lowercase whole word in title+text. */
export function docsContaining(word: string): string[] {
  const needle = word.toLowerCase();
  return PARITY_CORPUS.filter((doc) => `${doc.title} ${doc.text}`.toLowerCase().includes(needle)).map((doc) => doc.id);
}
