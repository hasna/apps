import type { Database } from 'bun:sqlite';
import { existsSync, readFileSync } from 'node:fs';
import { migrateKnowledgeDb, openKnowledgeDb } from './knowledge-db';
import { searchVectorIndex, type EmbeddingRuntimeOptions } from './embeddings';
import { sourceProvenance, type GeneratedArtifactProvenance, type KnowledgeProvenance } from './provenance';
import type { KnowledgeItem } from './store';
import type { KnowledgeConfig } from './workspace';

export type SearchResultKind = 'source_chunk' | 'wiki_chunk' | 'legacy_item' | 'wiki_page' | 'knowledge_index';
export type SearchProvenance = KnowledgeProvenance | GeneratedArtifactProvenance;

export interface HybridSearchOptions extends EmbeddingRuntimeOptions {
  dbPath: string;
  legacyStorePath?: string;
  query: string;
  limit?: number;
  /** Zero-based result offset for stable pagination over the ranked list. */
  offset?: number;
  semantic?: boolean;
  config?: KnowledgeConfig;
}

export interface HybridSearchResult {
  query: string;
  limit: number;
  offset: number;
  mode: {
    keyword: true;
    catalog: true;
    semantic: boolean;
  };
  semantic_provider: string | null;
  semantic_model: string | null;
  semantic_dimensions: number | null;
  counts: {
    keyword_results: number;
    catalog_results: number;
    semantic_results: number;
    merged_results: number;
  };
  warnings: string[];
  results: HybridSearchEntry[];
}

export interface HybridSearchEntry {
  kind: SearchResultKind;
  id: string;
  title: string | null;
  text: string | null;
  score: number;
  scores: {
    keyword?: number;
    semantic?: number;
    catalog?: number;
  };
  source: {
    uri: string | null;
    ref: string | null;
    kind: string | null;
    revision: string | null;
    hash: string | null;
  } | null;
  citation: {
    chunk_id: string | null;
    start_offset: number | null;
    end_offset: number | null;
  } | null;
  artifact: {
    uri: string | null;
    path: string | null;
    hash: string | null;
    shard_key: string | null;
  } | null;
  provenance: SearchProvenance | null;
  reasons: string[];
}

interface FtsChunkRow {
  chunk_id: string;
  chunk_kind: string;
  wiki_page_id: string | null;
  text: string;
  token_count: number | null;
  start_offset: number | null;
  end_offset: number | null;
  chunk_metadata_json: string;
  source_revision_id: string | null;
  revision: string | null;
  hash: string | null;
  source_uri: string | null;
  source_kind: string | null;
  source_title: string | null;
  wiki_path: string | null;
  wiki_title: string | null;
  wiki_artifact_uri: string | null;
  wiki_content_hash: string | null;
  wiki_status: string | null;
  wiki_metadata_json: string | null;
  rank: number;
}

interface WikiPageRow {
  id: string;
  path: string;
  title: string;
  artifact_uri: string | null;
  content_hash: string | null;
  status: string;
  metadata_json: string;
}

interface IndexRow {
  id: string;
  kind: string;
  name: string;
  artifact_uri: string | null;
  shard_key: string | null;
  metadata_json: string;
}

function parseJsonObject(value: string | null | undefined): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function metadataString(metadata: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = metadata[key];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return null;
}

function metadataNumber(metadata: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = metadata[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return null;
}

function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}

function queryTerms(query: string): string[] {
  const terms = query
    .normalize('NFKC')
    .toLowerCase()
    .match(/[\p{L}\p{N}_]+/gu) ?? [];
  return unique(terms.filter((term) => term.length > 0)).slice(0, 16);
}

interface ParsedQueryToken {
  type: 'term' | 'phrase' | 'or';
  /** Normalized, lower-cased word(s); phrases keep interior spaces. */
  value: string;
  negate: boolean;
  /** Explicit trailing `*` prefix request on a bare term. */
  prefix: boolean;
}

function normalizeWords(raw: string): string[] {
  return raw.normalize('NFKC').toLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? [];
}

/**
 * Parse a user query into structured tokens supporting:
 *   - default AND across terms,
 *   - "quoted phrases" (adjacency),
 *   - trailing `prefix*`,
 *   - `OR` / `|` operators, and `NOT` / leading `-` negation.
 * Everything is defensively re-tokenized so only FTS5-safe barewords/phrases
 * reach the MATCH string.
 */
function parseSearchQuery(query: string): ParsedQueryToken[] {
  const tokens: ParsedQueryToken[] = [];
  const segment = /"([^"]*)"|(\S+)/g;
  let match: RegExpExecArray | null;
  let pendingNegate = false;
  while ((match = segment.exec(query)) !== null) {
    if (match[1] !== undefined) {
      const words = normalizeWords(match[1]);
      if (words.length > 0) {
        tokens.push({ type: 'phrase', value: words.join(' '), negate: pendingNegate, prefix: false });
      }
      pendingNegate = false;
      continue;
    }
    let raw = match[2] ?? '';
    if (raw === 'OR' || raw === '||' || raw === '|') {
      tokens.push({ type: 'or', value: '', negate: false, prefix: false });
      continue;
    }
    if (raw === 'AND' || raw === '&&') continue; // AND is the default join
    if (raw === 'NOT') { pendingNegate = true; continue; }
    let negate = pendingNegate;
    pendingNegate = false;
    if (raw.startsWith('-') && raw.length > 1) { negate = true; raw = raw.slice(1); }
    let prefix = false;
    if (raw.endsWith('*')) { prefix = true; raw = raw.slice(0, -1); }
    const words = normalizeWords(raw);
    if (words.length === 0) continue;
    tokens.push({
      type: words.length > 1 ? 'phrase' : 'term',
      value: words.join(' '),
      negate,
      prefix,
    });
  }
  return tokens.slice(0, 24);
}

function tokenToFragment(token: ParsedQueryToken): string {
  if (token.type === 'phrase') return `"${token.value}"`;
  // Bare single terms default to prefix matching to preserve recall; an
  // explicit `*` is honored identically.
  return `"${token.value}"*`;
}

export interface FtsMatchExpressions {
  /** Precise expression: positive terms AND-joined (unless `OR` is explicit). */
  and: string | null;
  /**
   * Recall expression: positive terms OR-joined. Used as a fallback when the
   * AND expression yields nothing, so natural-language questions (whose terms
   * rarely all co-occur in one chunk) still retrieve. Null when identical to
   * `and` (single positive term or explicit boolean already), letting callers
   * skip a redundant second query.
   */
  or: string | null;
}

/**
 * Build FTS5 MATCH expressions from a query. Positive terms are AND-joined by
 * default (precision); `OR` inserts an explicit disjunction; negations attach as
 * `NOT frag` (skipped when no positive term precedes them, since NOT cannot lead
 * an expression). A parallel OR-joined expression is returned for recall
 * fallback.
 */
function buildFtsMatch(query: string): FtsMatchExpressions {
  const tokens = parseSearchQuery(query);
  const positives = tokens.filter((t) => t.type !== 'or' && !t.negate);
  if (positives.length === 0) return { and: null, or: null };

  const compose = (defaultOp: 'AND' | 'OR'): string | null => {
    let expr = '';
    let pendingOr = false;
    const negations: string[] = [];
    for (const token of tokens) {
      if (token.type === 'or') { pendingOr = true; continue; }
      const fragment = tokenToFragment(token);
      if (token.negate) { negations.push(fragment); continue; }
      if (expr.length === 0) expr = fragment;
      else expr = pendingOr ? `${expr} OR ${fragment}` : `${expr} ${defaultOp} ${fragment}`;
      pendingOr = false;
    }
    for (const negation of negations) expr = `(${expr}) NOT ${negation}`;
    return expr.length > 0 ? expr : null;
  };

  const and = compose('AND');
  const or = compose('OR');
  return { and, or: or !== and ? or : null };
}

function escapeLikeTerm(term: string): string {
  return term.replace(/[\\%_]/g, (char) => `\\${char}`);
}

function likeParams(terms: string[], fieldsPerTerm: number): string[] {
  return terms.flatMap((term) => Array.from({ length: fieldsPerTerm }, () => `%${escapeLikeTerm(term)}%`));
}

function scoreFromRank(rank: number, index: number): number {
  const rankScore = Number.isFinite(rank) ? 1 / (1 + Math.abs(rank)) : 0;
  const orderScore = 1 / (1 + index);
  return roundScore(Math.max(rankScore, orderScore));
}

function catalogScore(haystack: string, terms: string[]): number {
  if (terms.length === 0) return 0;
  const matched = terms.filter((term) => haystack.includes(term)).length;
  if (matched === 0) return 0;
  return roundScore(Math.min(0.85, 0.35 + (matched / terms.length) * 0.5));
}

function semanticScore(score: number): number {
  return roundScore(Math.max(0, Math.min(1, (score + 1) / 2)));
}

function roundScore(score: number): number {
  return Number(score.toFixed(6));
}

function combinedScore(scores: HybridSearchEntry['scores'], citation: HybridSearchEntry['citation']): number {
  const keyword = scores.keyword ?? 0;
  const semantic = scores.semantic ?? 0;
  const catalog = scores.catalog ?? 0;
  const citationBoost = citation?.chunk_id ? 0.05 : 0;
  return roundScore(Math.min(1, keyword * 0.55 + semantic * 0.4 + catalog * 0.35 + citationBoost));
}

function existingProvenance(metadata: Record<string, unknown>): SearchProvenance | null {
  const provenance = metadata.provenance;
  return provenance && typeof provenance === 'object' && !Array.isArray(provenance) ? provenance as SearchProvenance : null;
}

function provenanceForChunk(row: FtsChunkRow): SearchProvenance | null {
  const metadata = parseJsonObject(row.chunk_metadata_json);
  const existing = existingProvenance(metadata);
  if (existing) return existing;
  if (!row.source_revision_id && !row.source_uri) return null;
  return sourceProvenance({
    source_ref: metadataString(metadata, ['source_ref']),
    source_uri: row.source_uri ?? metadataString(metadata, ['source_uri']),
    source_kind: row.source_kind ?? metadataString(metadata, ['source_kind']),
    source_revision_id: row.source_revision_id,
    revision: row.revision ?? metadataString(metadata, ['revision']),
    hash: row.hash ?? metadataString(metadata, ['hash']),
    chunk_id: row.chunk_id,
    start_offset: row.start_offset ?? metadataNumber(metadata, ['start_offset']),
    end_offset: row.end_offset ?? metadataNumber(metadata, ['end_offset']),
    status: metadataString(metadata, ['status']),
    resolver: 'open-files-read-only',
  });
}

function selectFtsChunks(db: Database, ftsQuery: string | null, limit: number): FtsChunkRow[] {
  if (!ftsQuery) return [];
  try {
    return runFtsChunkQuery(db, ftsQuery, limit);
  } catch {
    // A malformed MATCH expression must never abort the whole search; degrade to
    // no keyword hits rather than throwing (catalog/semantic lanes still run).
    return [];
  }
}

function runFtsChunkQuery(db: Database, ftsQuery: string, limit: number): FtsChunkRow[] {
  return db.query<FtsChunkRow, [string, number]>(
    `SELECT
       chunks_fts.chunk_id,
       c.kind AS chunk_kind,
       c.wiki_page_id,
       c.text,
       c.token_count,
       c.start_offset,
       c.end_offset,
       c.metadata_json AS chunk_metadata_json,
       c.source_revision_id,
       sr.revision,
       sr.hash,
       s.uri AS source_uri,
       s.kind AS source_kind,
       s.title AS source_title,
       wp.path AS wiki_path,
       wp.title AS wiki_title,
       wp.artifact_uri AS wiki_artifact_uri,
       wp.content_hash AS wiki_content_hash,
       wp.status AS wiki_status,
       wp.metadata_json AS wiki_metadata_json,
       bm25(chunks_fts, 0.0, 1.0, 5.0, 3.0) AS rank
     FROM chunks_fts
     JOIN chunks c ON c.id = chunks_fts.chunk_id
     LEFT JOIN source_revisions sr ON sr.id = c.source_revision_id
     LEFT JOIN sources s ON s.id = sr.source_id
     LEFT JOIN wiki_pages wp ON wp.id = c.wiki_page_id
     WHERE chunks_fts MATCH ?
     ORDER BY rank ASC
     LIMIT ?`,
  ).all(ftsQuery, limit);
}

function catalogWhere(fields: string[], terms: string[]): string {
  if (terms.length === 0) return '1 = 0';
  const clauses = terms.map(() => `(${fields.map((field) => `lower(COALESCE(${field}, '')) LIKE ? ESCAPE '\\'`).join(' OR ')})`);
  return clauses.join(' OR ');
}

function selectWikiPages(db: Database, terms: string[], limit: number): WikiPageRow[] {
  const fields = ['path', 'title', 'artifact_uri', 'metadata_json'];
  return db.query<WikiPageRow, [...string[], number]>(
    `SELECT id, path, title, artifact_uri, content_hash, status, metadata_json
     FROM wiki_pages
     WHERE status = 'active' AND (${catalogWhere(fields, terms)})
     ORDER BY updated_at DESC
     LIMIT ?`,
  ).all(...likeParams(terms, fields.length), limit);
}

function selectKnowledgeIndexes(db: Database, terms: string[], limit: number): IndexRow[] {
  const fields = ['kind', 'name', 'shard_key', 'artifact_uri', 'metadata_json'];
  return db.query<IndexRow, [...string[], number]>(
    `SELECT id, kind, name, artifact_uri, shard_key, metadata_json
     FROM knowledge_indexes
     WHERE ${catalogWhere(fields, terms)}
     ORDER BY updated_at DESC
     LIMIT ?`,
  ).all(...likeParams(terms, fields.length), limit);
}

function readLegacyItems(path?: string): KnowledgeItem[] {
  if (!path || !existsSync(path)) return [];
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as { items?: unknown };
    if (!parsed || !Array.isArray(parsed.items)) return [];
    return parsed.items.filter((item): item is KnowledgeItem => {
      return Boolean(
        item
        && typeof item === 'object'
        && typeof (item as KnowledgeItem).id === 'string'
        && typeof (item as KnowledgeItem).title === 'string'
        && typeof (item as KnowledgeItem).content === 'string',
      );
    });
  } catch {
    return [];
  }
}

function legacyItemHaystack(item: KnowledgeItem): string {
  return [
    item.id,
    item.short_id,
    item.title,
    item.content,
    item.url,
    ...(item.tags ?? []),
  ].filter((value): value is string => typeof value === 'string' && value.length > 0).join(' ').toLowerCase();
}

/** Pure lexical ranking over an in-memory knowledge-item corpus. Shared by the
 * on-box legacy JSON store path and the HTTP item corpus so both
 * transports rank identically. */
function selectItems(items: KnowledgeItem[], terms: string[], limit: number): Array<{
  item: KnowledgeItem;
  score: number;
}> {
  if (terms.length === 0) return [];
  return items
    .filter((item) => item.archived !== true)
    .map((item) => ({ item, haystack: legacyItemHaystack(item) }))
    .filter(({ haystack }) => terms.some((term) => haystack.includes(term)))
    .map(({ item, haystack }) => ({ item, score: catalogScore(haystack, terms) }))
    .sort((a, b) => b.score - a.score || a.item.id.localeCompare(b.item.id))
    .slice(0, limit);
}

function selectLegacyItems(path: string | undefined, terms: string[], limit: number): Array<{
  item: KnowledgeItem;
  score: number;
}> {
  return selectItems(readLegacyItems(path), terms, limit);
}

function chunkResult(row: FtsChunkRow, keywordScore: number): HybridSearchEntry {
  const metadata = parseJsonObject(row.chunk_metadata_json);
  const provenance = provenanceForChunk(row);
  const sourceRef = metadataString(metadata, ['source_ref']);
  const sourceUri = row.source_uri ?? metadataString(metadata, ['source_uri']);
  const isWiki = Boolean(row.wiki_page_id);
  const result: HybridSearchEntry = {
    kind: isWiki ? 'wiki_chunk' : 'source_chunk',
    id: row.chunk_id,
    title: isWiki ? row.wiki_title : row.source_title,
    text: row.text,
    score: 0,
    scores: { keyword: keywordScore },
    source: sourceUri || sourceRef ? {
      uri: sourceUri,
      ref: sourceRef,
      kind: row.source_kind ?? metadataString(metadata, ['source_kind']),
      revision: row.revision ?? metadataString(metadata, ['revision']),
      hash: row.hash ?? metadataString(metadata, ['hash']),
    } : null,
    citation: {
      chunk_id: row.chunk_id,
      start_offset: row.start_offset,
      end_offset: row.end_offset,
    },
    artifact: isWiki ? {
      uri: row.wiki_artifact_uri,
      path: row.wiki_path,
      hash: row.wiki_content_hash,
      shard_key: row.wiki_path,
    } : null,
    provenance,
    reasons: ['keyword_match'],
  };
  result.score = combinedScore(result.scores, result.citation);
  return result;
}

function legacyItemResult(item: KnowledgeItem, keywordScore: number): HybridSearchEntry {
  const uri = `knowledge://item/${encodeURIComponent(item.id)}`;
  const result: HybridSearchEntry = {
    kind: 'legacy_item',
    id: item.id,
    title: item.title,
    text: item.content,
    score: 0,
    scores: { keyword: keywordScore },
    source: {
      uri,
      ref: uri,
      kind: 'legacy_item',
      revision: null,
      hash: null,
    },
    citation: null,
    artifact: null,
    provenance: null,
    reasons: ['legacy_note_match', 'keyword_match'],
  };
  result.score = combinedScore(result.scores, result.citation);
  return result;
}

function wikiPageResult(row: WikiPageRow, terms: string[]): HybridSearchEntry {
  const metadata = parseJsonObject(row.metadata_json);
  const score = catalogScore(`${row.path} ${row.title} ${row.artifact_uri ?? ''} ${row.metadata_json}`.toLowerCase(), terms);
  const result: HybridSearchEntry = {
    kind: 'wiki_page',
    id: row.id,
    title: row.title,
    text: null,
    score: 0,
    scores: { catalog: score },
    source: null,
    citation: null,
    artifact: {
      uri: row.artifact_uri,
      path: row.path,
      hash: row.content_hash,
      shard_key: row.path,
    },
    provenance: existingProvenance(metadata),
    reasons: ['wiki_catalog_match'],
  };
  result.score = combinedScore(result.scores, result.citation);
  return result;
}

function indexResult(row: IndexRow, terms: string[]): HybridSearchEntry {
  const metadata = parseJsonObject(row.metadata_json);
  const score = catalogScore(`${row.kind} ${row.name} ${row.shard_key ?? ''} ${row.artifact_uri ?? ''} ${row.metadata_json}`.toLowerCase(), terms);
  const result: HybridSearchEntry = {
    kind: 'knowledge_index',
    id: row.id,
    title: row.name,
    text: null,
    score: 0,
    scores: { catalog: score },
    source: null,
    citation: null,
    artifact: {
      uri: row.artifact_uri,
      path: metadataString(metadata, ['artifact_key']),
      hash: metadataString(metadata, ['content_hash']),
      shard_key: row.shard_key,
    },
    provenance: existingProvenance(metadata),
    reasons: ['index_catalog_match'],
  };
  result.score = combinedScore(result.scores, result.citation);
  return result;
}

function mergeResult(results: Map<string, HybridSearchEntry>, entry: HybridSearchEntry): void {
  const key = `${entry.kind}:${entry.id}`;
  const existing = results.get(key);
  if (!existing) {
    results.set(key, entry);
    return;
  }
  existing.scores = {
    keyword: Math.max(existing.scores.keyword ?? 0, entry.scores.keyword ?? 0) || undefined,
    semantic: Math.max(existing.scores.semantic ?? 0, entry.scores.semantic ?? 0) || undefined,
    catalog: Math.max(existing.scores.catalog ?? 0, entry.scores.catalog ?? 0) || undefined,
  };
  existing.reasons = unique([...existing.reasons, ...entry.reasons]);
  existing.text = existing.text ?? entry.text;
  existing.title = existing.title ?? entry.title;
  existing.source = existing.source ?? entry.source;
  existing.citation = existing.citation ?? entry.citation;
  existing.artifact = existing.artifact ?? entry.artifact;
  existing.provenance = existing.provenance ?? entry.provenance;
  existing.score = combinedScore(existing.scores, existing.citation);
}

function sortResults(results: HybridSearchEntry[]): HybridSearchEntry[] {
  const kindOrder: Record<SearchResultKind, number> = {
    source_chunk: 0,
    wiki_chunk: 1,
    legacy_item: 2,
    wiki_page: 3,
    knowledge_index: 4,
  };
  return results.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return kindOrder[a.kind] - kindOrder[b.kind] || a.id.localeCompare(b.id);
  });
}

export async function hybridSearch(options: HybridSearchOptions): Promise<HybridSearchResult> {
  const query = options.query.trim();
  if (!query) throw new Error('Search query is required.');
  const limit = Math.max(1, Math.min(options.limit ?? 10, 100));
  const offset = Math.max(0, Math.floor(options.offset ?? 0));
  const window = offset + limit;
  const terms = queryTerms(query);
  const ftsMatch = buildFtsMatch(query);
  const semanticEnabled = options.semantic === true || options.fake === true || Boolean(options.modelRef);
  const warnings: string[] = [];
  let semanticProvider: string | null = null;
  let semanticModel: string | null = null;
  let semanticDimensions: number | null = null;
  let keywordCount = 0;
  let catalogCount = 0;
  let semanticCount = 0;
  const merged = new Map<string, HybridSearchEntry>();

  migrateKnowledgeDb(options.dbPath);
  const db = openKnowledgeDb(options.dbPath);
  try {
    const ftsDepth = Math.max(window * 3, 20);
    let ftsRows = selectFtsChunks(db, ftsMatch.and, ftsDepth);
    // AND-first for precision; fall back to OR for recall when nothing matches
    // all terms (e.g. natural-language questions from ask()/context.pack()).
    if (ftsRows.length === 0 && ftsMatch.or) {
      ftsRows = selectFtsChunks(db, ftsMatch.or, ftsDepth);
    }
    keywordCount = ftsRows.length;
    ftsRows.forEach((row, index) => mergeResult(merged, chunkResult(row, scoreFromRank(row.rank, index))));

    const wikiRows = selectWikiPages(db, terms, Math.max(window, 10));
    const indexRows = selectKnowledgeIndexes(db, terms, Math.max(window, 10));
    const legacyRows = selectLegacyItems(options.legacyStorePath, terms, Math.max(window, 10));
    catalogCount = wikiRows.length + indexRows.length;
    keywordCount += legacyRows.length;
    legacyRows.forEach(({ item, score }) => mergeResult(merged, legacyItemResult(item, score)));
    wikiRows.forEach((row) => mergeResult(merged, wikiPageResult(row, terms)));
    indexRows.forEach((row) => mergeResult(merged, indexResult(row, terms)));
  } finally {
    db.close();
  }

  if (semanticEnabled) {
    try {
      const semantic = await searchVectorIndex({
        dbPath: options.dbPath,
        query,
        limit: Math.max(window * 3, 20),
        config: options.config,
        env: options.env,
        modelRef: options.modelRef,
        dimensions: options.dimensions,
        fake: options.fake,
        batchSize: options.batchSize,
        maxParallelCalls: options.maxParallelCalls,
      });
      semanticProvider = semantic.provider;
      semanticModel = semantic.model;
      semanticDimensions = semantic.dimensions;
      semanticCount = semantic.results.length;
      for (const row of semantic.results) {
        const result: HybridSearchEntry = {
          kind: 'source_chunk',
          id: row.chunk_id,
          title: null,
          text: row.text,
          score: 0,
          scores: { semantic: semanticScore(row.score) },
          source: {
            uri: row.source_uri,
            ref: row.source_ref,
            kind: row.provenance?.source_kind ?? null,
            revision: row.revision,
            hash: row.hash,
          },
          citation: {
            chunk_id: row.chunk_id,
            start_offset: row.provenance?.start_offset ?? null,
            end_offset: row.provenance?.end_offset ?? null,
          },
          artifact: null,
          provenance: row.provenance,
          reasons: ['semantic_match'],
        };
        result.score = combinedScore(result.scores, result.citation);
        mergeResult(merged, result);
      }
    } catch (error) {
      warnings.push(`semantic_search_failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const ranked = sortResults(Array.from(merged.values()));
  const results = ranked.slice(offset, offset + limit);
  return {
    query,
    limit,
    offset,
    mode: {
      keyword: true,
      catalog: true,
      semantic: semanticEnabled,
    },
    semantic_provider: semanticProvider,
    semantic_model: semanticModel,
    semantic_dimensions: semanticDimensions,
    counts: {
      keyword_results: keywordCount,
      catalog_results: catalogCount,
      semantic_results: semanticCount,
      merged_results: results.length,
    },
    warnings,
    results,
  };
}

export async function hybridSearchLegacyStore(options: Omit<HybridSearchOptions, 'dbPath'>): Promise<HybridSearchResult> {
  return hybridSearchItems(readLegacyItems(options.legacyStorePath), options, ['knowledge_db_missing']);
}

/**
 * Lexical search over an in-memory knowledge-item corpus. The HTTP client has
 * no on-box sqlite catalog; the shared corpus is fetched through the item Store.
 * Both `search` and `ask`
 * route their retrieval here so the HTTP transport is first-class instead of throwing.
 * Semantic ranking (vector index) lives only in the on-box sqlite catalog, so it
 * is reported as skipped rather than silently ignored.
 */
export async function hybridSearchItems(
  items: KnowledgeItem[],
  options: Omit<HybridSearchOptions, 'dbPath' | 'legacyStorePath'>,
  baseWarnings: string[] = [],
): Promise<HybridSearchResult> {
  const query = options.query.trim();
  if (!query) throw new Error('Search query is required.');
  const limit = Math.max(1, Math.min(options.limit ?? 10, 100));
  const offset = Math.max(0, Math.floor(options.offset ?? 0));
  const terms = queryTerms(query);
  const semanticEnabled = options.semantic === true || options.fake === true || Boolean(options.modelRef);
  const merged = new Map<string, HybridSearchEntry>();
  const itemRows = selectItems(items, terms, Math.max(offset + limit, 10));
  itemRows.forEach(({ item, score }) => mergeResult(merged, legacyItemResult(item, score)));
  const warnings = [...baseWarnings];
  if (semanticEnabled) warnings.push('semantic_search_requires_local_catalog');
  const results = sortResults(Array.from(merged.values())).slice(offset, offset + limit);
  return {
    query,
    limit,
    offset,
    mode: {
      keyword: true,
      catalog: true,
      semantic: semanticEnabled,
    },
    semantic_provider: null,
    semantic_model: null,
    semantic_dimensions: null,
    counts: {
      keyword_results: itemRows.length,
      catalog_results: 0,
      semantic_results: 0,
      merged_results: results.length,
    },
    warnings,
    results,
  };
}

/**
 * Adapt an already-ranked, bounded producer page into the public hybrid-search
 * result shape without fetching or re-ranking the collection in the client.
 */
export function hybridSearchFromProducerPage(
  hits: readonly { item: KnowledgeItem; rank: number }[],
  options: Pick<HybridSearchOptions, 'query' | 'limit' | 'offset' | 'semantic'>,
  warnings: string[] = [],
  producerTotal: number = hits.length,
): HybridSearchResult {
  const query = options.query.trim();
  if (!query) throw new Error('Search query is required.');
  const limit = Math.max(1, Math.min(options.limit ?? 10, 100));
  const offset = Math.max(0, Math.floor(options.offset ?? 0));
  const results = hits.map(({ item, rank }) => legacyItemResult(item, rank));
  return {
    query,
    limit,
    offset,
    mode: {
      keyword: true,
      catalog: true,
      semantic: options.semantic === true,
    },
    semantic_provider: null,
    semantic_model: null,
    semantic_dimensions: null,
    counts: {
      keyword_results: producerTotal,
      catalog_results: 0,
      semantic_results: 0,
      merged_results: results.length,
    },
    warnings,
    results,
  };
}
