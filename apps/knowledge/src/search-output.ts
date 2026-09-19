import type { KnowledgeContextPack, RetrievalCitation, RetrievalExcerpt, RerankedSearchEntry } from './retrieval';
import type { HybridSearchEntry, HybridSearchResult } from './search';

export type KnowledgeSearchDetail = 'compact' | 'full' | 'legacy';

export interface KnowledgeSearchProjectionOptions {
  detail: KnowledgeSearchDetail;
  previewChars?: number;
  contextPreviewChars?: number;
}

/** Hard ceiling for ordinary compact CLI/MCP search responses, including their outer ok/message fields. */
export const KNOWLEDGE_COMPACT_RESPONSE_MAX_BYTES = 64 * 1024;
const COMPACT_PROJECTION_MAX_BYTES = KNOWLEDGE_COMPACT_RESPONSE_MAX_BYTES - 1024;
const DEFAULT_SEARCH_PREVIEW_CHARS = 320;
const DEFAULT_CONTEXT_PREVIEW_CHARS = 520;
const DEFAULT_CITATION_PREVIEW_CHARS = 240;

function encodedBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), 'utf8');
}

function compactText(value: string | null | undefined, maxChars: number): string | null {
  if (value === null || value === undefined) return null;
  const normalized = value.normalize('NFKC').trim().replace(/\s+/g, ' ');
  if (normalized.length <= maxChars) return normalized;
  if (maxChars <= 3) return normalized.slice(0, Math.max(0, maxChars));
  return `${normalized.slice(0, maxChars - 3).trim()}...`;
}

function compactStrings(values: readonly string[], maxItems: number, maxChars: number): string[] {
  return values.slice(0, maxItems).map((value) => compactText(value, maxChars) ?? '');
}

function boundedPreviewChars(value: number | undefined, fallback: number): number {
  if (!Number.isFinite(value ?? NaN)) return fallback;
  return Math.max(80, Math.min(Math.floor(value as number), 2_000));
}

export function parseKnowledgeSearchDetail(value: string | undefined): KnowledgeSearchDetail | undefined {
  if (value === undefined) return undefined;
  if (value === 'compact' || value === 'full' || value === 'legacy') return value;
  throw new Error("--detail must be 'compact', 'full', or 'legacy'.");
}

/** Serialize a final ordinary compact response and fail closed if a caller regresses the whole-response ceiling. */
export function stringifyKnowledgeCompactResponse(value: unknown): string {
  const text = JSON.stringify(value);
  const bytes = Buffer.byteLength(text, 'utf8');
  if (bytes > KNOWLEDGE_COMPACT_RESPONSE_MAX_BYTES) {
    throw new Error(`Knowledge compact response exceeded ${KNOWLEDGE_COMPACT_RESPONSE_MAX_BYTES} UTF-8 bytes (${bytes}). Use explicit detail='full' or detail='legacy' for exhaustive output.`);
  }
  return text;
}

function compactSource(source: HybridSearchEntry['source']): HybridSearchEntry['source'] {
  if (!source) return null;
  return {
    uri: compactText(source.uri, 512),
    ref: compactText(source.ref, 512),
    kind: compactText(source.kind, 80),
    revision: compactText(source.revision, 160),
    hash: compactText(source.hash, 160),
  };
}

function compactArtifact(artifact: HybridSearchEntry['artifact']): HybridSearchEntry['artifact'] {
  if (!artifact) return null;
  return {
    uri: compactText(artifact.uri, 512),
    path: compactText(artifact.path, 512),
    hash: compactText(artifact.hash, 160),
    shard_key: compactText(artifact.shard_key, 160),
  };
}

function compactEntryCitation(citation: HybridSearchEntry['citation']): HybridSearchEntry['citation'] {
  if (!citation) return null;
  return {
    chunk_id: compactText(citation.chunk_id, 160),
    start_offset: citation.start_offset,
    end_offset: citation.end_offset,
  };
}

function compactSearchEntry(
  entry: HybridSearchEntry | RerankedSearchEntry,
  options: { previewChars: number; includePreview: boolean },
): Record<string, unknown> {
  const textLength = entry.text?.length ?? 0;
  const titleLength = entry.title?.length ?? 0;
  return {
    kind: entry.kind,
    id: compactText(entry.id, 240),
    title: compactText(entry.title, 160),
    title_length: titleLength,
    title_truncated: titleLength > 160,
    score: entry.score,
    ...(options.includePreview
      ? {
          text_preview: compactText(entry.text, options.previewChars),
          text_length: textLength,
          text_truncated: textLength > options.previewChars,
        }
      : {}),
    source: compactSource(entry.source),
    citation: compactEntryCitation(entry.citation),
    artifact: compactArtifact(entry.artifact),
    reasons: entry.reasons.slice(0, 8).map((reason) => compactText(reason, 80)),
    ...('rerank' in entry ? { rerank: entry.rerank } : {}),
  };
}

function compactCitation(citation: RetrievalCitation): Record<string, unknown> {
  const quoteLength = citation.quote?.length ?? 0;
  return {
    id: compactText(citation.id, 240),
    result_id: compactText(citation.result_id, 240),
    kind: citation.kind,
    source_uri: compactText(citation.source_uri, 512),
    source_ref: compactText(citation.source_ref, 512),
    artifact_uri: compactText(citation.artifact_uri, 512),
    artifact_path: compactText(citation.artifact_path, 512),
    revision: compactText(citation.revision, 160),
    hash: compactText(citation.hash, 160),
    chunk_id: compactText(citation.chunk_id, 160),
    start_offset: citation.start_offset,
    end_offset: citation.end_offset,
    quote_preview: compactText(citation.quote, DEFAULT_CITATION_PREVIEW_CHARS),
    quote_length: quoteLength,
    quote_truncated: quoteLength > DEFAULT_CITATION_PREVIEW_CHARS,
  };
}

function compactExcerpt(excerpt: RetrievalExcerpt, previewChars: number): Record<string, unknown> {
  return {
    id: compactText(excerpt.id, 240),
    result_id: compactText(excerpt.result_id, 240),
    citation_id: compactText(excerpt.citation_id, 240),
    kind: excerpt.kind,
    text_preview: compactText(excerpt.text, previewChars),
    text_length: excerpt.text.length,
    text_truncated: excerpt.text.length > previewChars,
    score: excerpt.score,
  };
}

function compactGraphCitation(citation: KnowledgeContextPack['graph']['citations'][number]): Record<string, unknown> {
  return {
    id: compactText(citation.id, 240),
    chunk_id: compactText(citation.chunk_id, 160),
    wiki_page_id: compactText(citation.wiki_page_id, 160),
    source_uri: compactText(citation.source_uri, 512),
    start_offset: citation.start_offset,
    end_offset: citation.end_offset,
  };
}

function compactBacklink(backlink: KnowledgeContextPack['graph']['backlinks'][number]): Record<string, unknown> {
  return {
    from_page_id: compactText(backlink.from_page_id, 240),
    to_page_id: compactText(backlink.to_page_id, 240),
    label: compactText(backlink.label, 160),
  };
}

function receiptWithBytes(receipt: Record<string, unknown>, build: (receipt: Record<string, unknown>) => Record<string, unknown>) {
  let current = { ...receipt, encoded_bytes: 0 };
  for (let index = 0; index < 4; index += 1) {
    const bytes = encodedBytes(build(current));
    if (current.encoded_bytes === bytes) break;
    current = { ...current, encoded_bytes: bytes };
  }
  return current;
}

export function projectKnowledgeSearchResult(
  result: HybridSearchResult,
  options: KnowledgeSearchProjectionOptions,
): HybridSearchResult | Record<string, unknown> {
  if (options.detail === 'legacy') return result;
  if (options.detail === 'full') return { ...result, detail: 'full' };

  const previewChars = boundedPreviewChars(options.previewChars, DEFAULT_SEARCH_PREVIEW_CHARS);
  const projectedRows = result.results.map((entry) => compactSearchEntry(entry, { previewChars, includePreview: true }));
  const rows = [...projectedRows];
  const base = {
    query: compactText(result.query, 512),
    limit: result.limit,
    offset: result.offset,
    mode: result.mode,
    semantic_provider: compactText(result.semantic_provider, 120),
    semantic_model: compactText(result.semantic_model, 160),
    semantic_dimensions: result.semantic_dimensions,
    counts: result.counts,
    warnings: compactStrings(result.warnings, 8, 240),
    detail: 'compact',
    detail_hint: "Use detail='full' (MCP) or --detail full --json (CLI) only when complete result text is required.",
  } as const;

  const build = (receipt: Record<string, unknown>) => ({ ...base, results: rows, response_budget: receipt });
  let receipt: Record<string, unknown> = {};
  do {
    receipt = {
      max_bytes: KNOWLEDGE_COMPACT_RESPONSE_MAX_BYTES,
      returned_results: rows.length,
      omitted_results: projectedRows.length - rows.length,
      complete: rows.length === projectedRows.length,
    };
    receipt = receiptWithBytes(receipt, build);
    if (encodedBytes(build(receipt)) <= COMPACT_PROJECTION_MAX_BYTES || rows.length === 0) break;
    rows.pop();
  } while (true);

  return build(receipt);
}

export function projectKnowledgeContextResult(
  context: KnowledgeContextPack,
  options: KnowledgeSearchProjectionOptions,
): KnowledgeContextPack | Record<string, unknown> {
  if (options.detail === 'legacy') return context;
  if (options.detail === 'full') return { ...context, detail: 'full' };

  const previewChars = boundedPreviewChars(options.contextPreviewChars, DEFAULT_CONTEXT_PREVIEW_CHARS);
  const allResults = context.results.map((entry) => compactSearchEntry(entry, { previewChars, includePreview: false }));
  const allCitations = context.citations.map(compactCitation);
  const allExcerpts = context.excerpts.map((entry) => compactExcerpt(entry, previewChars));
  const allGraphCitations = context.graph.citations.map(compactGraphCitation);
  const allBacklinks = context.graph.backlinks.map(compactBacklink);
  const results = [...allResults];
  const citations = [...allCitations];
  const excerpts = [...allExcerpts];
  const graphCitations = [...allGraphCitations];
  const backlinks = [...allBacklinks];
  const base = {
    query: compactText(context.query, 512),
    normalized_query: compactText(context.normalized_query, 512),
    created_at: context.created_at,
    mode: context.mode,
    warnings: compactStrings(context.warnings, 8, 240),
    search_counts: context.search_counts,
    notes: {
      permissions: compactStrings(context.notes.permissions, 20, 240),
      freshness: compactStrings(context.notes.freshness, 20, 240),
    },
    detail: 'compact',
    detail_hint: "Use detail='full' (MCP) or --detail full --json (CLI) only when raw result, excerpt, and citation bodies are required.",
  } as const;

  const build = (receipt: Record<string, unknown>) => ({
    ...base,
    results,
    citations,
    excerpts,
    graph: { citations: graphCitations, backlinks },
    response_budget: receipt,
  });

  let receipt: Record<string, unknown> = {};
  do {
    receipt = {
      max_bytes: KNOWLEDGE_COMPACT_RESPONSE_MAX_BYTES,
      returned: {
        results: results.length,
        citations: citations.length,
        excerpts: excerpts.length,
        graph_citations: graphCitations.length,
        backlinks: backlinks.length,
      },
      omitted: {
        results: allResults.length - results.length,
        citations: allCitations.length - citations.length,
        excerpts: allExcerpts.length - excerpts.length,
        graph_citations: allGraphCitations.length - graphCitations.length,
        backlinks: allBacklinks.length - backlinks.length,
      },
      complete: results.length === allResults.length
        && citations.length === allCitations.length
        && excerpts.length === allExcerpts.length
        && graphCitations.length === allGraphCitations.length
        && backlinks.length === allBacklinks.length,
    };
    receipt = receiptWithBytes(receipt, build);
    if (encodedBytes(build(receipt)) <= COMPACT_PROJECTION_MAX_BYTES) break;
    if (backlinks.length > 0) backlinks.pop();
    else if (graphCitations.length > 0) graphCitations.pop();
    else if (excerpts.length > 0) excerpts.pop();
    else if (citations.length > 0) citations.pop();
    else if (results.length > 0) results.pop();
    else break;
  } while (true);

  return build(receipt);
}
