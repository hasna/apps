import type { KnowledgeContextPack, RetrievalCitation, RetrievalExcerpt, RerankedSearchEntry } from './retrieval';
import type { HybridSearchEntry, HybridSearchResult } from './search';

export type KnowledgeSearchDetail = 'compact' | 'full' | 'legacy';

export interface KnowledgeSearchProjectionOptions {
  detail: KnowledgeSearchDetail;
  previewChars?: number;
  contextPreviewChars?: number;
}

const DEFAULT_SEARCH_PREVIEW_CHARS = 320;
const DEFAULT_CONTEXT_PREVIEW_CHARS = 520;
const DEFAULT_CITATION_PREVIEW_CHARS = 240;

function compactText(value: string | null | undefined, maxChars: number): string | null {
  if (value === null || value === undefined) return null;
  const normalized = value.normalize('NFKC').trim().replace(/\s+/g, ' ');
  if (normalized.length <= maxChars) return normalized;
  if (maxChars <= 3) return normalized.slice(0, Math.max(0, maxChars));
  return `${normalized.slice(0, maxChars - 3).trim()}...`;
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

function compactSearchEntry(
  entry: HybridSearchEntry | RerankedSearchEntry,
  options: { previewChars: number; includePreview: boolean },
): Record<string, unknown> {
  const textLength = entry.text?.length ?? 0;
  const titleLength = entry.title?.length ?? 0;
  return {
    kind: entry.kind,
    id: entry.id,
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
    citation: entry.citation,
    artifact: compactArtifact(entry.artifact),
    reasons: entry.reasons.slice(0, 8).map((reason) => compactText(reason, 80)),
    ...('rerank' in entry ? { rerank: entry.rerank } : {}),
  };
}

function compactCitation(citation: RetrievalCitation): Record<string, unknown> {
  const quoteLength = citation.quote?.length ?? 0;
  return {
    id: citation.id,
    result_id: citation.result_id,
    kind: citation.kind,
    source_uri: compactText(citation.source_uri, 512),
    source_ref: compactText(citation.source_ref, 512),
    artifact_uri: compactText(citation.artifact_uri, 512),
    artifact_path: compactText(citation.artifact_path, 512),
    revision: compactText(citation.revision, 160),
    hash: compactText(citation.hash, 160),
    chunk_id: citation.chunk_id,
    start_offset: citation.start_offset,
    end_offset: citation.end_offset,
    quote_preview: compactText(citation.quote, DEFAULT_CITATION_PREVIEW_CHARS),
    quote_length: quoteLength,
    quote_truncated: quoteLength > DEFAULT_CITATION_PREVIEW_CHARS,
  };
}

function compactExcerpt(excerpt: RetrievalExcerpt, previewChars: number): Record<string, unknown> {
  return {
    id: excerpt.id,
    result_id: excerpt.result_id,
    citation_id: excerpt.citation_id,
    kind: excerpt.kind,
    text_preview: compactText(excerpt.text, previewChars),
    text_length: excerpt.text.length,
    text_truncated: excerpt.text.length > previewChars,
    score: excerpt.score,
  };
}

export function projectKnowledgeSearchResult(
  result: HybridSearchResult,
  options: KnowledgeSearchProjectionOptions,
): HybridSearchResult | Record<string, unknown> {
  if (options.detail === 'legacy') return result;
  if (options.detail === 'full') return { ...result, detail: 'full' };
  const previewChars = boundedPreviewChars(options.previewChars, DEFAULT_SEARCH_PREVIEW_CHARS);
  return {
    ...result,
    detail: 'compact',
    results: result.results.map((entry) => compactSearchEntry(entry, { previewChars, includePreview: true })),
    detail_hint: "Use detail='full' (MCP) or --detail full --json (CLI) only when complete result text is required.",
  };
}

export function projectKnowledgeContextResult(
  context: KnowledgeContextPack,
  options: KnowledgeSearchProjectionOptions,
): KnowledgeContextPack | Record<string, unknown> {
  if (options.detail === 'legacy') return context;
  if (options.detail === 'full') return { ...context, detail: 'full' };
  const previewChars = boundedPreviewChars(options.contextPreviewChars, DEFAULT_CONTEXT_PREVIEW_CHARS);
  return {
    ...context,
    detail: 'compact',
    // Excerpts already carry the bounded evidence text. Keeping result.text here
    // duplicates the same raw body and was the dominant context-response cost.
    results: context.results.map((entry) => compactSearchEntry(entry, { previewChars, includePreview: false })),
    citations: context.citations.map(compactCitation),
    excerpts: context.excerpts.map((entry) => compactExcerpt(entry, previewChars)),
    graph: {
      ...context.graph,
      citations: context.graph.citations.map(({ quote: _quote, ...citation }) => citation),
    },
    detail_hint: "Use detail='full' (MCP) or --detail full --json (CLI) only when raw result, excerpt, and citation bodies are required.",
  };
}
