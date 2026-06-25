import { createHash } from 'node:crypto';
import { openKnowledgeDb } from './knowledge-db';
import { isStaleStatus } from './provenance';
import { hybridSearch, type HybridSearchEntry, type HybridSearchOptions, type HybridSearchResult, type SearchProvenance } from './search';

export interface RetrievalOptions extends HybridSearchOptions {
  contextChars?: number;
}

export interface RerankedSearchEntry extends HybridSearchEntry {
  rerank: {
    base_score: number;
    final_score: number;
    exact_score: number;
    citation_score: number;
    freshness_score: number;
    authority_score: number;
  };
}

export interface RetrievalCitation {
  id: string;
  result_id: string;
  kind: HybridSearchEntry['kind'];
  source_uri: string | null;
  source_ref: string | null;
  artifact_uri: string | null;
  artifact_path: string | null;
  revision: string | null;
  hash: string | null;
  chunk_id: string | null;
  start_offset: number | null;
  end_offset: number | null;
  quote: string | null;
  provenance: SearchProvenance | null;
}

export interface RetrievalExcerpt {
  id: string;
  result_id: string;
  citation_id: string | null;
  kind: HybridSearchEntry['kind'];
  text: string;
  score: number;
}

export interface RetrievalGraphEvidence {
  citations: Array<{
    id: string;
    chunk_id: string | null;
    wiki_page_id: string | null;
    source_uri: string;
    quote: string | null;
    start_offset: number | null;
    end_offset: number | null;
  }>;
  backlinks: Array<{
    from_page_id: string;
    to_page_id: string;
    label: string | null;
  }>;
}

export interface KnowledgeContextPack {
  query: string;
  normalized_query: string;
  created_at: string;
  mode: HybridSearchResult['mode'];
  warnings: string[];
  search_counts: HybridSearchResult['counts'];
  results: RerankedSearchEntry[];
  citations: RetrievalCitation[];
  excerpts: RetrievalExcerpt[];
  graph: RetrievalGraphEvidence;
  notes: {
    permissions: string[];
    freshness: string[];
    stability: string[];
  };
}

interface CitationRow {
  id: string;
  wiki_page_id: string | null;
  chunk_id: string | null;
  source_uri: string;
  quote: string | null;
  start_offset: number | null;
  end_offset: number | null;
}

interface BacklinkRow {
  from_page_id: string;
  to_page_id: string;
  label: string | null;
}

function stableId(prefix: string, value: string): string {
  return `${prefix}_${createHash('sha256').update(value).digest('hex').slice(0, 20)}`;
}

function normalizeQuery(query: string): string {
  return query.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
}

function queryTerms(query: string): string[] {
  return Array.from(new Set(normalizeQuery(query).match(/[\p{L}\p{N}_]+/gu) ?? [])).slice(0, 16);
}

function textForResult(result: HybridSearchEntry): string {
  return [result.title, result.text].filter(Boolean).join(' ').toLowerCase();
}

function exactScore(result: HybridSearchEntry, terms: string[]): number {
  if (terms.length === 0) return 0;
  const text = textForResult(result);
  const matched = terms.filter((term) => text.includes(term)).length;
  return Number((matched / terms.length).toFixed(6));
}

function hasReadOnlyProvenance(provenance: SearchProvenance | null): boolean {
  if (!provenance) return true;
  if ('read_only' in provenance) return provenance.read_only === true;
  if ('read_only_sources' in provenance) return provenance.read_only_sources === true;
  return true;
}

function isStale(provenance: SearchProvenance | null): boolean {
  if (!provenance) return false;
  if ('stale' in provenance && provenance.stale) return true;
  if ('status' in provenance) return isStaleStatus(provenance.status);
  return false;
}

function freshnessScore(result: HybridSearchEntry): number {
  if (isStale(result.provenance)) return 0;
  if (result.source?.hash || result.source?.revision) return 1;
  if (result.artifact?.hash) return 0.85;
  if (result.provenance && 'source_refs' in result.provenance && result.provenance.source_refs.length > 0) return 0.75;
  return 0.55;
}

function citationScore(result: HybridSearchEntry): number {
  if (result.citation?.chunk_id && (result.source?.uri || result.artifact?.uri)) return 1;
  if (result.provenance && 'citation_required' in result.provenance && result.provenance.citation_required) return 0.75;
  if (result.artifact?.uri) return 0.65;
  return 0.35;
}

function authorityScore(result: HybridSearchEntry): number {
  if (result.kind === 'wiki_chunk') return 0.85;
  if (result.kind === 'source_chunk') return 0.8;
  if (result.kind === 'wiki_page') return 0.65;
  return 0.55;
}

function rerank(result: HybridSearchEntry, terms: string[]): RerankedSearchEntry {
  const scores = {
    base_score: result.score,
    exact_score: exactScore(result, terms),
    citation_score: citationScore(result),
    freshness_score: freshnessScore(result),
    authority_score: authorityScore(result),
  };
  const final = Math.min(1,
    scores.base_score * 0.65 +
    scores.exact_score * 0.1 +
    scores.citation_score * 0.1 +
    scores.freshness_score * 0.1 +
    scores.authority_score * 0.05,
  );
  const reasons = new Set(result.reasons);
  if (scores.exact_score > 0.5) reasons.add('exact_term');
  if (scores.citation_score >= 0.75) reasons.add('cited_source');
  if (scores.freshness_score >= 0.85) reasons.add('fresh_source');
  return {
    ...result,
    score: Number(final.toFixed(6)),
    reasons: Array.from(reasons),
    rerank: {
      ...scores,
      final_score: Number(final.toFixed(6)),
    },
  };
}

function quoteFor(result: HybridSearchEntry, maxChars: number): string | null {
  const source = result.text ?? result.title;
  if (!source) return null;
  const normalized = source.replace(/\s+/g, ' ').trim();
  return normalized.length <= maxChars ? normalized : `${normalized.slice(0, Math.max(0, maxChars - 1)).trim()}...`;
}

function citationFor(result: RerankedSearchEntry): RetrievalCitation {
  const id = stableId('cite', `${result.kind}\u0000${result.id}\u0000${result.source?.uri ?? ''}\u0000${result.artifact?.uri ?? ''}`);
  return {
    id,
    result_id: result.id,
    kind: result.kind,
    source_uri: result.source?.uri ?? null,
    source_ref: result.source?.ref ?? null,
    artifact_uri: result.artifact?.uri ?? null,
    artifact_path: result.artifact?.path ?? null,
    revision: result.source?.revision ?? null,
    hash: result.source?.hash ?? result.artifact?.hash ?? null,
    chunk_id: result.citation?.chunk_id ?? null,
    start_offset: result.citation?.start_offset ?? null,
    end_offset: result.citation?.end_offset ?? null,
    quote: quoteFor(result, 500),
    provenance: result.provenance,
  };
}

function excerptFor(result: RerankedSearchEntry, citation: RetrievalCitation, contextChars: number): RetrievalExcerpt | null {
  const text = quoteFor(result, contextChars);
  if (!text) return null;
  return {
    id: stableId('excerpt', `${result.kind}\u0000${result.id}`),
    result_id: result.id,
    citation_id: citation.id,
    kind: result.kind,
    text,
    score: result.score,
  };
}

function placeholders(values: unknown[]): string {
  return values.map(() => '?').join(', ');
}

function loadGraphEvidence(dbPath: string, results: RerankedSearchEntry[]): RetrievalGraphEvidence {
  const chunkIds = results.map((result) => result.citation?.chunk_id).filter((id): id is string => Boolean(id));
  const wikiPageIds = results.filter((result) => result.kind === 'wiki_page').map((result) => result.id);
  const citations: CitationRow[] = [];
  const backlinks: BacklinkRow[] = [];
  if (chunkIds.length === 0 && wikiPageIds.length === 0) return { citations, backlinks };

  const db = openKnowledgeDb(dbPath);
  try {
    if (chunkIds.length > 0) {
      citations.push(...db.query<CitationRow, string[]>(
        `SELECT id, wiki_page_id, chunk_id, source_uri, quote, start_offset, end_offset
         FROM citations
         WHERE chunk_id IN (${placeholders(chunkIds)})
         ORDER BY created_at DESC
         LIMIT 50`,
      ).all(...chunkIds));
    }
    if (wikiPageIds.length > 0) {
      citations.push(...db.query<CitationRow, string[]>(
        `SELECT id, wiki_page_id, chunk_id, source_uri, quote, start_offset, end_offset
         FROM citations
         WHERE wiki_page_id IN (${placeholders(wikiPageIds)})
         ORDER BY created_at DESC
         LIMIT 50`,
      ).all(...wikiPageIds));
      backlinks.push(...db.query<BacklinkRow, string[]>(
        `SELECT from_page_id, to_page_id, label
         FROM wiki_backlinks
         WHERE from_page_id IN (${placeholders(wikiPageIds)}) OR to_page_id IN (${placeholders(wikiPageIds)})
         LIMIT 50`,
      ).all(...wikiPageIds, ...wikiPageIds));
    }
  } finally {
    db.close();
  }
  return { citations, backlinks };
}

export async function retrieveKnowledgeContext(options: RetrievalOptions): Promise<KnowledgeContextPack> {
  const contextChars = Math.max(200, Math.min(options.contextChars ?? 1200, 4000));
  const search = await hybridSearch(options);
  const terms = queryTerms(search.query);
  const warnings = [...search.warnings];
  const permissionNotes = new Set<string>();
  const freshnessNotes = new Set<string>();
  const stabilityNotes = new Set<string>();

  const filtered = search.results.filter((result) => {
    if (!hasReadOnlyProvenance(result.provenance)) {
      warnings.push(`permission_filtered: ${result.kind}:${result.id}`);
      permissionNotes.add('Dropped a result because provenance was not read-only.');
      return false;
    }
    if (isStale(result.provenance)) {
      warnings.push(`stale_filtered: ${result.kind}:${result.id}`);
      freshnessNotes.add('Dropped a stale result whose source status requires reindexing.');
      return false;
    }
    return true;
  });

  const results = filtered
    .map((result) => rerank(result, terms))
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
    .slice(0, search.limit);
  stabilityNotes.add('Context evidence order is deterministic by final score and stable result id.');
  if (results.length > 1 && Math.abs(results[0].score - results[1].score) <= 0.02) {
    stabilityNotes.add('Top evidence scores are close; verify multiple citations before filing durable claims.');
  }

  const citations = results.map(citationFor);
  const excerpts = results
    .map((result, index) => excerptFor(result, citations[index], contextChars))
    .filter((entry): entry is RetrievalExcerpt => Boolean(entry));

  for (const result of results) {
    if (result.provenance && 'read_only' in result.provenance && result.provenance.read_only) {
      permissionNotes.add('All source-backed excerpts are read-only and citation-required.');
    }
    if (result.rerank.freshness_score >= 0.85) {
      freshnessNotes.add('Fresh source revision/hash or artifact hash is present for top context.');
    }
  }

  return {
    query: search.query,
    normalized_query: normalizeQuery(search.query),
    created_at: new Date().toISOString(),
    mode: search.mode,
    warnings,
    search_counts: search.counts,
    results,
    citations,
    excerpts,
    graph: loadGraphEvidence(options.dbPath, results),
    notes: {
      permissions: Array.from(permissionNotes),
      freshness: Array.from(freshnessNotes),
      stability: Array.from(stabilityNotes),
    },
  };
}
