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
  semantic?: boolean;
  config?: KnowledgeConfig;
}

export interface HybridSearchResult {
  query: string;
  limit: number;
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

function ftsQueryForTerms(terms: string[]): string | null {
  if (terms.length === 0) return null;
  return terms.map((term) => `${term}*`).join(' OR ');
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
       bm25(chunks_fts) AS rank
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

function selectLegacyItems(path: string | undefined, terms: string[], limit: number): Array<{
  item: KnowledgeItem;
  score: number;
}> {
  if (terms.length === 0) return [];
  return readLegacyItems(path)
    .filter((item) => item.archived !== true)
    .map((item) => ({ item, haystack: legacyItemHaystack(item) }))
    .filter(({ haystack }) => terms.some((term) => haystack.includes(term)))
    .map(({ item, haystack }) => ({ item, score: catalogScore(haystack, terms) }))
    .sort((a, b) => b.score - a.score || a.item.id.localeCompare(b.item.id))
    .slice(0, limit);
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
  const terms = queryTerms(query);
  const ftsQuery = ftsQueryForTerms(terms);
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
    const ftsRows = selectFtsChunks(db, ftsQuery, Math.max(limit * 3, 20));
    keywordCount = ftsRows.length;
    ftsRows.forEach((row, index) => mergeResult(merged, chunkResult(row, scoreFromRank(row.rank, index))));

    const wikiRows = selectWikiPages(db, terms, Math.max(limit, 10));
    const indexRows = selectKnowledgeIndexes(db, terms, Math.max(limit, 10));
    const legacyRows = selectLegacyItems(options.legacyStorePath, terms, Math.max(limit, 10));
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
        limit: Math.max(limit * 3, 20),
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

  const results = sortResults(Array.from(merged.values())).slice(0, limit);
  return {
    query,
    limit,
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
