// Hosted (cloud) recall for sessions-serve.
//
// Mirrors src/lib/recall.ts over the shared Postgres: the same multi-signal
// ranking — message / session / tool-call hits per query variant, semantic
// embeddings, metadata-and-graph hits, and the recent fallback — with the
// retrieval half bound to the cloud store (ILIKE content search instead of
// SQLite FTS5, shared `sessions`/`messages`/`tool_calls` rows). The pure
// ranking and result-building helpers are the SAME functions as the local path
// (exported additively from lib/recall.ts), so recall behaves identically on
// both backends; the documented difference is retrieval granularity (cloud
// search is substring-based, local is FTS5-ranked).

import type { TypedQueryClient } from "../../generated/storage-kit/index.js";
import { getCloudClient } from "./client.js";
import { searchContent, searchSessions, searchToolCalls, graphSession, listSessions } from "./store.js";
import { getSession, getMessages, getToolCalls } from "./store.js";
import { cloudSemanticSearch, cloudEmbeddingCount, type Embedder } from "./embeddings.js";
import {
  MAX_CONTEXT_MESSAGES_PER_RESULT,
  MAX_CONTEXT_TOOL_CALLS_PER_RESULT,
  MAX_EVIDENCE_PER_RESULT,
  MAX_TOOL_CALLS_PER_RESULT,
  MAX_VARIANT_TERMS,
  addCandidate,
  addSearchHits,
  addToolHits,
  buildQueryVariants,
  buildReason,
  buildResumeMetadata,
  evidencePriority,
  extractCodingEntities,
  selectMatchingToolCalls,
  shouldUseRecentFallback,
  significantTerms,
  type Candidate,
  type RecallOptions,
  type RecallResponse,
  type RecallResult,
} from "../../lib/recall.js";
import type { Message, ToolCall } from "../../types/index.js";
import type { SearchHit, SearchOptions, ToolCallHit } from "../../lib/search.js";

interface MetadataHit {
  session_id: string;
  snippet: string;
  signal: string;
}

function unique(values: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const normalized = value.trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

/** Session-metadata / graph hits over the shared cloud (ILIKE over metadata fields). */
export async function cloudMetadataAndGraphHits(
  terms: string[],
  query: string,
  opts: SearchOptions,
  limit: number,
  client: TypedQueryClient,
): Promise<MetadataHit[]> {
  const needles = unique(
    [...terms, query.toLowerCase().trim()].filter((term) => term.length >= 2),
  ).slice(0, MAX_VARIANT_TERMS);
  if (needles.length === 0) return [];

  const params: unknown[] = [];
  const filters = ((): string => {
    const where: string[] = [];
    if (opts.source) {
      params.push(opts.source);
      where.push(`s.source = $${params.length}`);
    }
    if (opts.project_path) {
      params.push(opts.project_path);
      where.push(
        `(s.project_path = $${params.length} OR s.project_name = $${params.length})`,
      );
    }
    if (opts.machine) {
      params.push(opts.machine);
      where.push(`s.machine = $${params.length}`);
    }
    return where.length > 0 ? ` AND ${where.join(" AND ")}` : "";
  })();

  const fields = [
    "s.source",
    "s.title",
    "s.project_name",
    "s.project_path",
    "s.model",
    "s.model_provider",
    "s.git_branch",
    "s.git_sha",
    "s.git_origin_url",
  ];
  const matchClauses: string[] = [];
  for (const needle of needles) {
    const like = `%${needle}%`;
    params.push(like);
    matchClauses.push(
      `(${fields.map((field) => `LOWER(COALESCE(${field}, '')) LIKE $${params.length}`).join(" OR ")})`,
    );
  }

  params.push(limit);
  const rows = await client.many<Record<string, unknown>>(
    `SELECT s.id, s.source, s.title, s.project_name, s.project_path,
            s.model, s.model_provider, s.git_branch, s.git_sha, s.git_origin_url
       FROM sessions s
      WHERE (${matchClauses.join(" OR ")})${filters}
      ORDER BY COALESCE(s.updated_at, s.started_at, s.ingested_at) DESC
      LIMIT $${params.length}`,
    params,
  );

  return rows.map((row) => ({
    session_id: row.id as string,
    signal: "metadata_or_graph",
    snippet: graphSnippet(row),
  }));
}

function graphSnippet(row: Record<string, unknown>): string {
  const parts = [
    row.source ? `source ${row.source}` : "",
    row.project_name ? `project ${row.project_name}` : "",
    row.project_path ? `path ${row.project_path}` : "",
    row.git_branch ? `branch ${row.git_branch}` : "",
    row.git_sha ? `commit ${row.git_sha}` : "",
    row.git_origin_url ? `repo ${row.git_origin_url}` : "",
    row.model ? `model ${row.model}` : "",
    row.model_provider ? `provider ${row.model_provider}` : "",
    row.title ? `title ${row.title}` : "",
  ].filter(Boolean);
  return parts.join("; ");
}

/** Map a cloud session-search hit to the SearchHit shape used by ranking. */
function sessionHitToSearchHit(hit: Awaited<ReturnType<typeof searchSessions>>[number]): SearchHit {
  return {
    session_id: hit.session.id,
    source: hit.session.source,
    title: hit.session.title,
    project_name: hit.session.project_name,
    project_path: hit.session.project_path,
    started_at: hit.session.started_at,
    snippet:
      hit.match === "title"
        ? hit.session.title ?? hit.session.project_name ?? ""
        : hit.session.project_name ?? hit.session.title ?? "",
    rank: 0,
  };
}

function toolCallHitToSearchHit(hit: Awaited<ReturnType<typeof searchToolCalls>>[number]): ToolCallHit {
  return {
    session_id: hit.session_id,
    source: hit.source,
    title: hit.title,
    project_name: hit.project_name,
    project_path: hit.project_path,
    started_at: hit.started_at,
    tool_name: hit.tool_name,
    snippet: hit.snippet,
    rank: hit.rank,
  };
}

function parseMeta(value: string | null): Record<string, unknown> {
  if (!value) return {};
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return {};
  }
}

async function loadCloudRecallContext(
  sessionId: string,
  client: TypedQueryClient,
): Promise<{ messages: Message[]; toolCalls: ToolCall[] }> {
  const messages = (await getMessages(sessionId, client)).slice(0, MAX_CONTEXT_MESSAGES_PER_RESULT);
  const toolCalls = (await getToolCalls(sessionId, client))
    .filter((tc) => tc.id && tc.id.length > 0)
    .slice(0, MAX_CONTEXT_TOOL_CALLS_PER_RESULT);
  return { messages, toolCalls };
}

async function buildCloudRecallResult(
  candidate: Candidate,
  rank: number,
  terms: string[],
  query: string,
  client: TypedQueryClient,
): Promise<RecallResult | null> {
  const session = await getSession(candidate.sessionId, client);
  if (!session) return null;
  const context = await loadCloudRecallContext(session.id, client);
  const entities = extractCodingEntities(session, context.messages, context.toolCalls);
  const graph = await graphSession(session.id, {}, client);
  const matchingToolCalls = selectMatchingToolCalls(
    context.toolCalls,
    terms,
    query,
    candidate.toolHitSnippets,
  );
  const evidence = candidate.evidence
    .sort((a, b) => evidencePriority(a.kind) - evidencePriority(b.kind))
    .slice(0, MAX_EVIDENCE_PER_RESULT);

  return {
    session_id: session.id,
    source: session.source,
    source_id: session.source_id,
    source_path: session.source_path,
    title: session.title,
    project_name: session.project_name,
    project_path: session.project_path,
    started_at: session.started_at,
    updated_at: session.updated_at,
    rank,
    score: Number(candidate.score.toFixed(4)),
    reason: buildReason(candidate, evidence, matchingToolCalls, entities),
    evidence,
    matching_tool_calls: matchingToolCalls,
    touched_file_paths: entities.file_paths,
    coding_entities: entities,
    related_graph_entities: {
      project: graph?.project ?? session.project_name,
      model: graph?.model ?? session.model,
      provider: graph?.provider ?? session.model_provider,
      repo: graph?.repo ?? session.git_origin_url,
      branch: session.git_branch,
      commit: session.git_sha,
      tools: (graph?.tools ?? entities.tool_names).slice(0, MAX_TOOL_CALLS_PER_RESULT),
    },
    resume: buildResumeMetadata(session),
  };
}

/** Natural-language recall over the shared cloud (see module docstring). */
export async function cloudRecallSessions(
  query: string,
  opts: RecallOptions = {},
  client: TypedQueryClient = getCloudClient(),
): Promise<RecallResponse> {
  const normalizedQuery = query.trim();
  const limit = Math.max(1, Math.min(Number(opts.limit ?? 10) || 10, 100));
  const terms = significantTerms(normalizedQuery);
  const variants = buildQueryVariants(normalizedQuery, terms);
  const candidates = new Map<string, Candidate>();
  const signalCounts: Record<string, number> = {
    message: 0,
    session: 0,
    tool_call: 0,
    semantic: 0,
    graph: 0,
    recent: 0,
  };

  for (const variant of variants) {
    const messageHits = await searchContent(variant.query, { ...opts, limit: limit * 4 }, client);
    signalCounts.message += messageHits.length;
    addSearchHits(candidates, messageHits, {
      kind: "message",
      signal: `message:${variant.label}`,
      weight: 5 * variant.weight,
    });

    const sessionHits = (await searchSessions(variant.query, { ...opts, limit: limit * 4 }, client)).map(
      sessionHitToSearchHit,
    );
    signalCounts.session += sessionHits.length;
    addSearchHits(candidates, sessionHits, {
      kind: "session",
      signal: `session:${variant.label}`,
      weight: 3.25 * variant.weight,
    });

    const toolHits = (await searchToolCalls(variant.query, { ...opts, limit: limit * 4 }, client)).map(
      toolCallHitToSearchHit,
    );
    signalCounts.tool_call += toolHits.length;
    addToolHits(candidates, toolHits, {
      signal: `tool_call:${variant.label}`,
      weight: 4.5 * variant.weight,
    });
  }

  const semantic = await maybeCloudSemanticSearch(normalizedQuery, opts, limit, client);
  if (semantic.hits.length > 0) {
    signalCounts.semantic = semantic.hits.length;
    addSearchHits(candidates, semantic.hits, {
      kind: "semantic",
      signal: "semantic",
      weight: 3.75,
      scoreFromRank: true,
    });
  }

  const graphHits = await cloudMetadataAndGraphHits(terms, normalizedQuery, opts, limit * 6, client);
  signalCounts.graph = graphHits.length;
  for (let i = 0; i < graphHits.length; i++) {
    const hit = graphHits[i];
    addCandidate(candidates, hit.session_id, 2.25 / (i + 1), {
      kind: "graph",
      signal: hit.signal,
      snippet: hit.snippet,
    });
  }

  if (candidates.size === 0 && shouldUseRecentFallback(normalizedQuery, terms)) {
    const recent = await listSessions(
      {
        source: opts.source,
        project_path: opts.project_path,
        machine: opts.machine,
        limit,
      },
      client,
    );
    signalCounts.recent = recent.length;
    for (let i = 0; i < recent.length; i++) {
      addCandidate(candidates, recent[i].id, 0.75 / (i + 1), {
        kind: "session",
        signal: "recent_fallback",
        snippet: `Recent ${recent[i].source} session ${recent[i].title ?? "(untitled)"} in ${recent[i].project_name ?? recent[i].project_path ?? "unknown project"}`,
      });
    }
  }

  // Pre-fetch candidate sessions once so the recency tiebreak is synchronous.
  const recency = new Map<string, number>();
  for (const id of candidates.keys()) {
    const session = await getSession(id, client);
    recency.set(id, new Date(session?.updated_at ?? session?.started_at ?? 0).getTime());
  }
  const ranked = [...candidates.values()].sort((a, b) => {
    const byScore = b.score - a.score;
    if (byScore !== 0) return byScore;
    return (recency.get(b.sessionId) ?? 0) - (recency.get(a.sessionId) ?? 0);
  });

  const results: RecallResult[] = [];
  for (let i = 0; i < Math.min(ranked.length, limit); i++) {
    const result = await buildCloudRecallResult(ranked[i], i + 1, terms, normalizedQuery, client);
    if (result) results.push(result);
  }

  return {
    query: normalizedQuery,
    count: results.length,
    results,
    metadata: {
      query: normalizedQuery,
      query_variants: variants.map((variant) => variant.query),
      significant_terms: terms,
      semantic: semantic.metadata,
      signals: signalCounts,
    },
  };
}

async function maybeCloudSemanticSearch(
  query: string,
  opts: RecallOptions,
  limit: number,
  client: TypedQueryClient,
): Promise<{
  hits: SearchHit[];
  metadata: RecallResponse["metadata"]["semantic"];
}> {
  const stored = await cloudEmbeddingCount(client);
  const apiKeyPresent = Boolean(process.env.OPENAI_API_KEY);
  const base = {
    attempted: false,
    status: "skipped" as const,
    stored_embeddings: stored,
    openai_api_key_present: apiKeyPresent,
    reason: null as string | null,
  };

  if (opts.semantic === false) {
    return { hits: [], metadata: { ...base, reason: "semantic recall disabled by request" } };
  }
  if (stored === 0) {
    return {
      hits: [],
      metadata: { ...base, reason: "no stored embeddings; run 'sessions embed' to enable semantic recall" },
    };
  }
  if (!opts.embedder && !apiKeyPresent) {
    return {
      hits: [],
      metadata: { ...base, reason: "OPENAI_API_KEY is not set; using FTS, tool-call, and graph signals" },
    };
  }

  try {
    const hits = await cloudSemanticSearch(
      query,
      { ...opts, limit: limit * 4, embedder: opts.embedder },
      client,
    );
    return {
      hits,
      metadata: {
        ...base,
        attempted: true,
        status: "used",
        reason: null,
      },
    };
  } catch (err) {
    return {
      hits: [],
      metadata: {
        ...base,
        attempted: true,
        status: "failed",
        reason: (err as Error).message,
      },
    };
  }
}
