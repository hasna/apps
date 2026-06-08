# Hybrid Semantic Search Architecture

`open-knowledge` search is hybrid by design. Keyword search, semantic vector
search, wiki graph traversal, and citation/provenance signals each solve a
different part of the retrieval problem.

## Ownership Boundary

`open-files` supplies:

- Stable source refs such as `open-files://file/<id>` and
  `open-files://file/<id>/revision/<revision_id>`.
- Source ids, file ids, revisions, hashes, MIME metadata, and storage location.
- Extracted text and extraction status.
- Read-only content resolution for deeper reads.
- Change events that trigger incremental reindexing.

`open-knowledge` owns:

- Chunk boundaries and chunk metadata.
- Embeddings for source chunks, wiki pages, decisions, and durable answers.
- FTS indexes over chunks and generated wiki artifacts.
- Wiki backlinks and citation graph signals.
- Merge, dedupe, rerank, freshness scoring, and context packing.
- Permission-aware filtering before any content reaches a model.

## Local Indexes

Local mode starts with SQLite:

- `chunks` stores source/wiki text segments and metadata.
- `chunks_fts` provides keyword search.
- `chunk_embeddings` stores embedding vectors as JSON until a local vector
  extension is chosen.
- `wiki_pages`, `wiki_backlinks`, and `citations` provide graph and provenance
  signals.
- `knowledge_indexes` tracks generated machine-readable shards.

The JSON vector representation is intentionally simple for the first local
implementation. The retrieval interface should hide it so a later vector
extension or pgvector backend can replace storage without changing CLI/MCP
contracts.

## Hosted Indexes

Hosted mode may use:

- Postgres plus pgvector for sources/chunks/wiki/runs.
- Managed vector stores for large corpora.
- Object storage for generated artifact shards.
- Worker queues for extraction, embedding, compile, lint, and refresh jobs.

Permission filtering must happen before reranked context is sent to the model.
Filtering only after retrieval is not enough if the retriever or reranker can see
unauthorized content.

## Query Pipeline

1. Normalize the query.
2. Embed the query if a semantic-capable provider is configured.
3. Run keyword FTS over source chunks and wiki chunks.
4. Run vector search over source chunks and wiki pages.
5. Expand candidate pages through backlinks and citations.
6. Drop stale candidates whose source revision/hash no longer matches
   `open-files`.
7. Apply permission filters.
8. Merge and dedupe by source revision, wiki page, citation, and text hash.
9. Rerank by relevance, exact-match score, semantic score, freshness, citation
   quality, and wiki authority.
10. Return structured results with source refs, citation spans, page refs,
    scores, and reason codes.

## Result Shape

Search results should be structured enough for CLI, MCP, and agents:

```json
{
  "kind": "source_chunk",
  "id": "chunk_123",
  "text": "...",
  "score": 0.87,
  "scores": {
    "keyword": 0.72,
    "semantic": 0.91,
    "freshness": 1
  },
  "source": {
    "uri": "open-files://file/file_123",
    "revision": "rev_456",
    "hash": "..."
  },
  "citation": {
    "start_offset": 120,
    "end_offset": 260
  },
  "reason": ["semantic_match", "exact_term", "fresh_source"]
}
```

## Context Packs

`knowledge <prompt>` and MCP `knowledge_ask` should not receive raw search rows.
They should receive context packs:

- Query and normalized intent.
- Selected source/wiki excerpts.
- Citation metadata.
- Freshness and permission notes.
- Known uncertainty or conflicting sources.
- Suggested durable wiki updates.

This keeps agent prompts stable while the retrieval internals evolve.

## Reindexing

Reindexing is driven by source revisions:

- If an `open-files` hash/revision changes, affected chunks and embeddings become
  stale.
- If a source is deleted or access changes, affected chunks must be hidden or
  removed before future retrieval.
- Wiki pages should track the source revisions they cite so lint can flag stale
  pages.
- Embedding refresh jobs should be idempotent and checkpointed in `runs` and
  `run_events`.

## Acceptance Criteria

- Local search works without network access for keyword-only retrieval.
- Semantic search is optional and provider-gated.
- Every returned excerpt can resolve to a source ref or wiki page.
- Permission filters run before model context assembly.
- Retrieval internals can swap from JSON vectors to pgvector or managed vector
  stores without changing CLI/MCP result contracts.
