# AI-Native Knowledge Base Architecture

`knowledge` is the local-first knowledge engine for Hasna projects and
agents. It should make company knowledge durable, searchable, citable, and safe
for agents to reuse. It is not the raw file bucket. Raw source bytes belong to
`open-files`.

## Product Boundary

The open source package owns:

- Local CLI and MCP interfaces.
- Shared service modules used by CLI, MCP, tests, and future SDK callers. The
  current `KnowledgeService` facade centralizes workspace/config/safety,
  artifact storage, DB/wiki setup, source ingestion, source resolution, and
  outbox consumption.
- Local project workspace under `.hasna/apps/knowledge`.
- Source references, citations, extracted metadata, chunks, generated wiki
  artifacts, schemas, indexes, run ledgers, and search state.
- Hybrid retrieval over keyword search, semantic vectors, wiki pages, citations,
  and graph signals.
- Provider/runtime contracts for local BYOK agent workflows.
- Hosted-aware client contracts that can talk to a future SaaS wrapper.

`open-files` owns:

- Raw source bytes and snapshots.
- Local, S3, Google Drive, and future connector-backed source storage.
- Source ids, file ids, revisions, hashes, MIME metadata, storage locations, and
  extraction outputs.
- Read-only content resolution for knowledge agents.
- Source manifests and source-change events that drive reindexing.

The future hosted/SaaS wrapper owns:

- Users, orgs, projects, memberships, API keys, and permissions.
- Billing, limits, queues, workers, hosted databases, hosted object storage
  policies, connector secrets, audit, observability, and web UI.
- Permission-aware retrieval enforcement across tenants.
- Remote job orchestration for ingestion, embedding, web search, compile, lint,
  and sync runs.

The OSS package must stay useful without a hosted account. Hosted mode should be
an optional remote client over explicit API contracts.

The detailed hosted boundary is specified in
[`hosted-wrapper-responsibilities.md`](./hosted-wrapper-responsibilities.md).
That document is the source of truth for responsibilities that must stay out of
the OSS package, including tenants, ACL enforcement, connector credentials,
bucket provisioning, secrets, queues, billing, admin controls, observability, and
the hosted web UI.

Multi-machine sync is specified in
[`machine-sync-schema.md`](./machine-sync-schema.md). The sync contract keeps
machine discovery optional through `@hasna/machines`, stores scalable sync state
in SQLite/Postgres/object storage, and keeps raw source bytes in `open-files`.

The local hosted-aware contract follows the `open-skills` pattern: `mode` is
`local` by default, `setup --mode hosted` records `hosted.api_url`, env vars
`KNOWLEDGE_API_URL` and `KNOWLEDGE_API_KEY` can override local config, and
credentials live outside project state in `~/.hasna/knowledge/auth.json`.
`remote contracts` publishes the registry/search/ask/build/sync/status/logs and
artifact endpoints that a SaaS wrapper can implement. Local use, local search,
and local artifact generation do not require this remote API.

## Local Workspace

Project-local state lives at:

```text
.hasna/apps/knowledge/
  config.json
  knowledge.db
  artifacts/
  cache/
  exports/
  indexes/
  logs/
  runs/
  schemas/
  wiki/
```

The legacy JSON store at `~/.open-knowledge/db.json` remains readable for
migration and compatibility. New project mode should prefer
`.hasna/apps/knowledge/knowledge.db` and generated artifacts under the same app
home.

Global/user state may use a Hasna data directory, but project mode is the
default for company knowledge because it keeps artifacts close to the repo or
workspace they describe.

## Source References

`knowledge` stores references, not raw source bytes. Supported source ref
forms:

```text
open-files://file/<file_id>
open-files://file/<file_id>/revision/<revision_id>
open-files://source/<source_id>/path/<path>
s3://bucket/key
file:///absolute/path
https://example.com/page
```

For durable company knowledge, `open-files://` is preferred because it can carry
file revisions, hashes, extraction state, permissions, and storage metadata.
Direct `s3://`, `file://`, and `https://` refs are useful for bootstrap and
interop, but should be normalized into source records when possible.

## Provenance Contract

Every durable search/wiki artifact should carry a provenance object in metadata:
`source_owner`, `source_ref`, `source_uri`, `source_kind`, `source_revision_id`,
`revision`, `hash`, optional `chunk_id`, offsets, `read_only`,
`citation_required`, resolver name, and stale status. For generated artifacts
that are not source-backed yet, metadata still records that `open-files` owns
source bytes and that citations are required before durable facts are filed.

`wiki init` now catalogs the starter `wiki/README.md` and `indexes/root.md`
records with generated-artifact provenance. Source ingestion stores source
provenance on every chunk, and source resolution returns that provenance with
chunks and citations so semantic search can pass through trustworthy evidence
without reconstructing it later.

## Resolver Boundary

The local resolver is exposed through:

```bash
knowledge source resolve <source-ref> --purpose knowledge_answer --json
knowledge ingest source <source-ref> --purpose knowledge_index --json
```

and the MCP tool `ok_resolve_source`. It reads the knowledge catalog only,
enforces the read-only purpose labels imported from `open-files`, returns source
metadata, selected revision metadata, derived chunks, and citation evidence, and
records an audit event. It never returns raw bytes or storage credentials.

`ingest source` uses the same boundary for indexing. It accepts `open-files://`,
`file://`, `s3://`, and `https://` refs, applies S3/web safety gates, converts
allowed extracted text into redacted chunks with offsets, records hashes and
revisions, and stores only derived knowledge records.

In future hosted mode, the same result shape can be backed by a remote
open-files resolver API. The local OSS package should keep using the shared
service boundary so CLI, MCP, and SaaS wrappers do not grow separate permission
logic.

## Remote And S3 Mode

Local mode writes artifacts to `.hasna/apps/knowledge`.

Remote/cloud mode can store generated knowledge artifacts in S3:

```text
s3://<knowledge-bucket>/<org>/<project>/knowledge/
  artifacts/
  indexes/
  logs/
  runs/
  schemas/
  wiki/
```

Hasna XYZ production uses the canonical open-source knowledge bucket and app
path-compatible prefix:

```text
s3://hasna-xyz-opensource-knowledge-prod/.hasna/apps/knowledge/
```

The app config can be materialized with:

```bash
knowledge setup --mode hosted --canonical-hasna-xyz --scope project --json
```

The canonical metadata-only secret paths are:

```text
hasna/xyz/opensource/knowledge/prod/env
hasna/xyz/opensource/knowledge/prod/aws
hasna/xyz/opensource/knowledge/prod/s3
```

`hasna/xyz/opensource/knowledge/prod/rds` is reserved for a future hosted
runtime database if the wrapper provisions one.

Raw files still route through `open-files`. Knowledge S3 storage is for derived
artifacts such as wiki pages, index shards, schema versions, logs, exports, and
run outputs.

The storage contract is inspectable through:

```bash
knowledge storage status --scope project --json
```

That contract names the local app path, SQLite catalog, generated artifact
classes, S3 bucket/prefix when configured, and the source ownership rule that
raw source bytes stay in `open-files`. The `storage_objects` table catalogs
generated artifacts by URI, kind, hash, size, and metadata so local mode and
remote/S3 mode share the same DB-facing shape.

## Wiki Model

The Karpathy-style wiki pattern is implemented as scalable artifacts, not three
giant files.

Small repositories may expose root Markdown summaries:

```text
wiki/index.md
schemas/current.md
logs/latest.md
```

Large knowledge bases use:

```text
schemas/
  v1.md
  v2.md
indexes/
  root.md
  engineering.md
  product.md
  machine/
    engineering.json
logs/
  2026/
    06/
      08.jsonl
wiki/
  engineering/
  product/
  operations/
```

The database catalog tracks every schema, index shard, log partition, wiki page,
source citation, and generated artifact. Markdown remains the readable layer;
SQLite/Postgres and object storage carry the scalable catalog.

The first compile/write loop is local and approval-gated. `wiki compile`
generates cited pages from derived source chunks, creates concept backlinks,
updates index rows, records storage objects, and appends dated JSONL logs.
`wiki file-answer` writes answer notes only with `--approve-write`; otherwise it
returns the dry-run proposal. `wiki lint` checks missing/stale citations,
duplicates, orphan pages, unresolved source refs, contradiction markers, and
new-article candidates.

## Search Model

Search is hybrid:

1. `open-files` supplies source manifests, revisions, hashes, and extracted text.
2. `knowledge` chunks extracted text and generated wiki pages.
3. Chunks and pages are indexed with keyword search and embeddings.
4. Queries run through keyword FTS, vector search, and wiki/citation graph
   expansion.
5. Results are merged, deduped, reranked, permission-filtered, and returned with
   citations.

Local mode should start with SQLite FTS and a local vector-index option. Hosted
mode can use Postgres with pgvector or a managed vector index. Permission
filters must be applied before agent context is assembled.

The first local semantic-search implementation indexes derived chunks with
`knowledge embeddings index` and queries them with
`knowledge search --semantic` or the lower-level
`knowledge embeddings search`. It stores OpenAI embedding vectors as
generated metadata rows, not raw source bytes, and pins each row to `open-files`
provenance: source ref/URI, revision/hash, chunk offsets, token count, provider,
model, dimensions, status, and timestamps. The structured `search` contract
merges keyword FTS, wiki/index catalog hits, generated wiki chunks, and optional
vector results. `knowledge search --context` and MCP `knowledge_search`
turn those rows into reranked citation context packs with selected excerpts,
freshness and permission notes, graph evidence, and final rerank scores. The
local SQLite index can later move to pgvector or a managed hosted vector store
without changing CLI/MCP result shape.

MCP has a stable agent-facing contract layered over the older `ok_*`
compatibility tools. Agents should prefer `knowledge_search`, `knowledge_ask`,
`knowledge_build`, `knowledge_get`, `knowledge_ingest`,
`knowledge_web_search`, `knowledge_lint`, `knowledge_run_status`,
`knowledge_storage`, and `knowledge_resolve_source`. The same server publishes
project-scope JSON resources at `knowledge://project/config`,
`knowledge://project/storage`, `knowledge://project/schema`,
`knowledge://project/sources`, `knowledge://project/open-files`,
`knowledge://project/wiki/pages`, `knowledge://project/indexes`,
`knowledge://project/runs`, and `knowledge://project/decisions`, plus templated
reads for individual items, sources, wiki pages, indexes, runs, and decisions.
These resources expose derived chunks, generated wiki artifacts, citations, run
ledgers, and storage/index metadata without exposing raw source bytes.

Index freshness is explicit. `reindex_queue` tracks missing or stale embedding
work, `knowledge reindex status|enqueue|embeddings` operates the local
queue, and MCP exposes the same controls through `ok_reindex_status`,
`ok_reindex_enqueue`, and `ok_reindex_embeddings`. Hosted mode can map the same
contract to worker queues, S3/object artifact sync, Postgres/pgvector, or a
managed vector index while preserving the local command shape.

## Agent Workflow

The target user flow is:

```bash
knowledge "<prompt>"
```

The command should:

1. Search existing wiki and indexed source chunks.
2. Resolve deeper read-only source content through `open-files` if needed.
3. Optionally use provider-native web search.
4. Produce an answer with citations.
5. Propose durable wiki/index/schema/log updates.
6. Write generated artifacts only after approval or in an explicitly approved
   auto-write mode.
7. Record a run ledger with tool calls, sources, costs, outputs, and generated
   records.

The first implementation exposes this as `knowledge ask|build <prompt>`
and the installed `knowledge <prompt>` bin alias. It retrieves read-only context,
returns a local citation draft by default, optionally calls AI SDK generation via
`--generate`, records `runs`, `run_events`, and `provider_usage`, and only
proposes durable wiki updates until the wiki compile/write task owns writes.

Provider-native web search is exposed separately as
`knowledge web search <query>` and MCP `ok_web_search`. Real network access
is safety-gated; OpenAI and Anthropic use provider web-search tools through AI
SDK, while DeepSeek remains a future fallback/external-search path. Returned web
snippets can optionally be filed as read-only `web` source refs for later local
search and citation.

## Provider Registry

AI provider setup is BYOK and AI SDK v6 based. The local provider layer tracks:

- OpenAI via `@ai-sdk/openai`, defaulting to `openai:gpt-5.2`.
- Anthropic via `@ai-sdk/anthropic`, defaulting to
  `anthropic:claude-sonnet-4-6`.
- DeepSeek via `@ai-sdk/deepseek`, defaulting to `deepseek:deepseek-chat`.

Model aliases live in config and can be inspected with
`knowledge providers models`. Credentials are resolved from env vars by
default, checked without making provider calls, and usage can be normalized into
the existing `provider_usage` table for future prompt, embedding, and web-search
runs.

## Non-Goals

- Do not make `knowledge` own raw source files.
- Do not make hosted account, billing, worker, or tenant state required for local
  use.
- Do not let semantic search bypass permissions.
- Do not treat one `index.md`, `schema.md`, or `log.md` as the final scalable
  representation for a large company knowledge base.
