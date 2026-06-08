# open-knowledge

> Agent-friendly local knowledge CLI/MCP with JSON output, project workspaces, durable artifacts, and safe destructive actions.

[![npm version](https://img.shields.io/npm/v/@hasna/knowledge)](https://npm.im/@hasna/knowledge)
[![license](https://img.shields.io/npm/l/@hasna/knowledge)](LICENSE)
[![build](https://img.shields.io/github/actions/workflow/status/hasna/knowledge/ci.yml)](.github/workflows/ci.yml)

`open-knowledge` is evolving from a flat note store into a local-first knowledge
engine for AI agents. It stores simple knowledge items today, creates a Hasna
project workspace under `.hasna/apps/knowledge`, initializes a versioned
`knowledge.db`, writes generated wiki artifacts, and exposes a stdio MCP server.

CLI and MCP workspace operations share a `KnowledgeService` facade for config,
safety policy, artifact storage, DB/wiki setup, source ingestion, source
resolution, and outbox consumption. That keeps local project mode and future
remote/S3-backed wrappers on the same service contracts.

## Install

```bash
# Bun
bun add -g @hasna/knowledge

# npm
npm install -g @hasna/knowledge
```

Or run directly:

```bash
bun x @hasna/knowledge add "My Note" "Some content"
```

## Quick Start

```bash
# Add a note
open-knowledge add "Rust ownership" "Every value has exactly one owner"

# List all notes
open-knowledge list

# List with search
open-knowledge list --search ownership

# List notes tagged "rust"
open-knowledge list --tag rust

# Get a note
open-knowledge get --id <id>

# Update a note
open-knowledge update --id <id> --title "Rust ownership model"

# Delete a note (requires --yes)
open-knowledge delete --id <id> --yes

# Export all notes as JSONL
open-knowledge export --format jsonl

# Show resolved workspace paths
open-knowledge paths --scope project --json

# Inspect local/S3 artifact storage and source ownership
open-knowledge storage status --scope project --json

# Initialize the project SQLite catalog
open-knowledge db init --scope project

# Initialize scalable wiki/schema/index/log artifacts
open-knowledge wiki init --scope project

# Ingest an open-files source manifest into the project SQLite catalog
open-knowledge ingest manifest ./open-files-manifest.jsonl --scope project --json

# Ingest one read-only source ref directly
open-knowledge ingest source file:///absolute/path/to/handbook.md --purpose knowledge_index --scope project --json

# Consume open-files change events and invalidate stale source chunks
open-knowledge reindex outbox ./open-files-outbox.jsonl --scope project --json

# Resolve indexed source text and citation evidence through the read-only source boundary
open-knowledge source resolve open-files://file/f_123/revision/rev_456 --scope project --json

# Inspect local safety policy and approvals
open-knowledge safety status --scope project --json

# Inspect AI SDK provider credentials and model aliases
open-knowledge providers status --scope project --json
open-knowledge providers models --scope project --json

# Embed indexed chunks and run semantic search
open-knowledge embeddings index --scope project --model openai:text-embedding-3-small --json
open-knowledge embeddings search "company wiki policy" --scope project --json

# Hybrid search over source chunks, generated wiki pages, indexes, and optional vectors
open-knowledge search "company wiki policy" --scope project --json
open-knowledge search "company wiki policy" --scope project --semantic --json
open-knowledge search "company wiki policy" --scope project --context --json

# Build a citation answer/context draft for a prompt
open-knowledge ask "How do we cite handbook policy?" --scope project --json
knowledge "How do we cite handbook policy?" --scope project --json

# Provider-native web search, safety-gated for real network access
HASNA_KNOWLEDGE_WEB_SEARCH=1 open-knowledge web search "latest AI SDK web search" --provider openai --json
```

## Commands

### add
```bash
open-knowledge add <title> <content> [--url <url>] [-t <tag>]
```
Add a new knowledge item.

### list
```bash
open-knowledge list|ls [options]
```
List items with pagination, search, and tag filtering.

| Flag | Description |
|------|-------------|
| `-p, --page <n>` | Page number (default: 1) |
| `-l, --limit <n>` | Items per page (default: 20) |
| `-s, --search <text>` | Filter by title or content |
| `-t, --tag <tag>` | Filter by tag |
| `--sort created\|title` | Sort field (default: created) |
| `--desc` | Sort descending |

### get
```bash
open-knowledge get --id <id>
```
Retrieve a single item by ID.

### update
```bash
open-knowledge update|edit --id <id> [options]
```
Update an existing item.

| Flag | Description |
|------|-------------|
| `--title <title>` | New title |
| `--content <content>` | New content |
| `--url <url>` | New source URL |
| `-t, --tag <tag>` | Add a tag |

### archive / restore
```bash
open-knowledge archive --id <id>
open-knowledge restore --id <id>
```
Archive hides an item from default `list` output without deleting it.

### upsert
```bash
open-knowledge upsert [title] [content] [--id <id>] [--title <title>] [--content <content>]
```
Create or update an item by ID.

### untag
```bash
open-knowledge untag --id <id> -t <tag>
```
Remove one tag from an item.

### delete
```bash
open-knowledge delete|rm --id <id> --yes
```
Delete an item. Requires `--yes` to confirm.

### export
```bash
open-knowledge export [--format jsonl]
```
Export all items. Use `--format jsonl` for newline-delimited JSON.

### paths
```bash
open-knowledge paths [--scope global|project|local] [--json]
```
Show the resolved Hasna app workspace, JSON compatibility store, SQLite path,
artifact directories, and config.

### storage
```bash
open-knowledge storage status [--scope project] [--json]
open-knowledge storage validate [--scope project] [--json]
```
Show the storage contract for local or S3-backed generated artifacts. Local mode
uses `.hasna/apps/knowledge` for config, SQLite, indexes, wiki artifacts, logs,
runs, and exports. S3 mode stores generated artifacts under the configured
knowledge bucket/prefix while `open-files` remains the source of truth for raw
source bytes. The command also reports artifact classes, allowed source ref
schemes, and warnings for non-scalable or unsafe config.

### db
```bash
open-knowledge db init [--scope project]
open-knowledge db stats [--scope project]
```
Initialize or inspect the versioned SQLite catalog at
`.hasna/apps/knowledge/knowledge.db`.

### wiki
```bash
open-knowledge wiki init [--scope project]
```
Create starter generated-knowledge artifacts through the artifact store:
`schemas/v1.md`, `indexes/root.md`, `wiki/README.md`, and a dated JSONL log
partition.

### source
```bash
open-knowledge source resolve <source-ref> [--purpose knowledge_answer|knowledge_index] [--limit <n>] [--scope project] [--json]
```
Resolve an indexed source through the read-only open-files boundary. The result
returns source metadata, permissions, the selected revision, derived chunk text,
and citation evidence. It does not expose raw file bytes or storage credentials;
raw source retrieval remains owned by `open-files`.

### ingest
```bash
open-knowledge ingest manifest <file|s3://bucket/key> [--scope project] [--json]
open-knowledge ingest source <source-ref> [--purpose knowledge_index] [--scope project] [--json]
```
Import an open-files JSON or JSONL source manifest into `knowledge.db`. This
upserts sources and source revisions, stores hash/MIME/status/permission
metadata, and chunks embedded extracted text when the manifest includes it.

`ingest source` accepts `open-files://`, `file://`, `s3://`, and `https://`
refs. It reads source content through a read-only boundary, redacts known
secrets before storage, records hashes/revisions, and stores only derived chunks
and citation spans. Web and S3 reads remain opt-in through the safety policy.
For `open-files://` refs, the source must already be present in the local
knowledge catalog through a manifest or extracted-text ref until the open-files
resolver API lands.

### reindex
```bash
open-knowledge reindex outbox <file|s3://bucket/key> [--scope project] [--json]
```
Consume open-files JSON or JSONL change events. This invalidates matching
source chunks and embeddings by source ref, revision, or hash, updates
permission/path/delete metadata, and records a local run ledger.

### search
```bash
open-knowledge search <query> [--scope project] [--limit <n>] [--json]
open-knowledge search <query> --semantic [--model openai:text-embedding-3-small] [--scope project] [--json]
open-knowledge search <query> --context [--semantic] [--scope project] [--json]
```
Run hybrid search over `chunks_fts`, generated wiki chunks, wiki/index catalog
rows, and optional vector results. The default path is local-only keyword and
catalog search. `--semantic` embeds the query and merges vector results from
`vector_index_entries`, preserving source refs, artifact URIs, citations,
revision/hash metadata, and provenance in each structured result.

`--context` returns a reranked context pack for agents: selected excerpts,
assembled citations, freshness and permission notes, graph evidence from
`citations`/`wiki_backlinks`, and final rerank scores. This is the shape future
`knowledge <prompt>` flows should send to a model instead of raw search rows.

### ask / build
```bash
open-knowledge ask <prompt> [--scope project] [--json]
open-knowledge build <prompt> [--generate] [--model default|provider:model] [--scope project] [--json]
knowledge <prompt> [--scope project] [--json]
```
Build an agent-native prompt run. The command first creates a read-only context
pack, returns a local citation draft by default, records a run ledger in
`runs`/`run_events`, and proposes durable wiki updates without writing them.
`--generate` explicitly calls AI SDK text generation; `--fake --generate` keeps
the flow deterministic for local tests. `--approve-write` records approval
intent, but durable wiki writes remain deferred to the wiki compile/write task.

### web
```bash
open-knowledge web search <query> [--provider openai|anthropic] [--model provider:model] [--domain <domain>] [--file-results] [--scope project] [--json]
```
Run provider-native hosted web search and return cited web sources. Real network
search is disabled unless `safety.network.web_search_enabled=true` or
`HASNA_KNOWLEDGE_WEB_SEARCH=1` is set. OpenAI uses the AI SDK OpenAI
`tools.webSearch` path; Anthropic uses its provider web-search tool when
available. `--file-results` stores returned snippets as read-only `web` source
refs in `knowledge.db` so later local search can cite them. `--fake` returns
deterministic offline sources for tests.

### safety
```bash
open-knowledge safety status [--scope project] [--json]
open-knowledge safety check generated_write [target] [--scope project] [--json]
open-knowledge safety approve generated_write [target] [--scope project] [--json]
open-knowledge safety audit [--scope project] [--json]
open-knowledge safety redact <text> [--scope project] [--json]
```
Inspect and operate the local safety model. Source reads are read-only by
default, web search and S3 reads are opt-in, generated writes require approval
by default, and known secret patterns are redacted before chunk storage.

### providers
```bash
open-knowledge providers status [--scope project] [--json]
open-knowledge providers models [--scope project] [--json]
open-knowledge providers check [provider|model-alias] [--scope project] [--json]
```
Inspect AI SDK v6 provider readiness for OpenAI, Anthropic, and DeepSeek. The
provider layer resolves BYOK credentials from `OPENAI_API_KEY`,
`ANTHROPIC_API_KEY`, and `DEEPSEEK_API_KEY` by default, exposes model aliases
such as `default`, `fast`, `reasoning`, `sonnet`, and `deepseek`, and records
provider capability metadata for structured output, tool use, tool streaming,
reasoning, embeddings, and native web-search support.

### embeddings
```bash
open-knowledge embeddings status [--scope project] [--json]
open-knowledge embeddings index [--model openai:text-embedding-3-small] [--limit <n>] [--scope project] [--json]
open-knowledge embeddings search <query> [--model openai:text-embedding-3-small] [--limit <n>] [--scope project] [--json]
```
Build and query the local vector index over derived knowledge chunks. The first
implementation stores vectors in SQLite as JSON rows in `chunk_embeddings` and
`vector_index_entries`, with provider/model/dimensions, source revision/hash,
chunk offsets, token counts, invalidation status, and provenance metadata. Raw
source bytes remain owned by `open-files`; semantic results return cited chunks
with source refs and revision metadata.

OpenAI embeddings use AI SDK v6 and `OPENAI_API_KEY`. `--fake` provides
deterministic local vectors for tests and offline smoke checks.

### help
```bash
open-knowledge help [command]
```

## Global Options

| Flag | Description |
|------|-------------|
| `--json` | Output raw JSON |
| `--store <path>` | Override store path |
| `--scope global\|project\|local` | Select global Hasna app workspace or project workspace |
| `--version, -v` | Show version |
| `--help, -h` | Show help |

## Store Location

Default global compatibility store: `~/.hasna/apps/knowledge/db.json`

Project workspace: `.hasna/apps/knowledge/`

The legacy `~/.open-knowledge/db.json` store is migrated into the new global
Hasna app path on first use if the new store does not exist. Override item-store
location with `--store <path>`.

## MCP Server

```bash
open-knowledge-mcp
```

The MCP server exposes item tools (`ok_add`, `ok_list`, `ok_get`, `ok_update`,
`ok_delete`, `ok_archive`, `ok_restore`, `ok_upsert`, `ok_untag`,
`ok_bulk_delete`, `ok_prune`, `ok_dedupe`, `ok_stats`, `ok_export`,
`ok_import`, `ok_batch`), workspace/storage inspection (`ok_paths`,
`ok_storage_status`), provider/embedding tools (`ok_provider_status`,
`ok_provider_models`, `ok_embeddings_status`, `ok_embeddings_index`,
`ok_semantic_search`), hybrid retrieval (`ok_search`), and source-ref
parsing/resolution (`ok_parse_source_ref`, `ok_resolve_source`). The
`knowledge_search` MCP tool returns reranked citation context packs for agent
prompts, and `knowledge_ask` runs the same prompt flow exposed by
`open-knowledge ask`. `ok_web_search` exposes safety-gated provider web search
to MCP clients.

## Source And Artifact Boundary

Raw files should be stored and resolved through `open-files`. `open-knowledge`
stores source references such as `open-files://file/<id>`,
`open-files://file/<id>/revision/<revision_id>`, `s3://...`, `file://...`,
and `https://...`, plus citations, chunks, generated wiki pages, indexes,
logs, runs, and search metadata.

`open-knowledge source resolve` and the MCP `ok_resolve_source` tool resolve
only the indexed, derived knowledge catalog. The resolver enforces read-only
purpose labels from source permissions, returns chunk citation evidence, writes
an audit event, and keeps bytes/storage credentials inside `open-files`.

`open-knowledge ingest source` can also build derived chunks from an allowed
source ref. It does not copy raw files into the knowledge workspace; local file,
S3, web, and open-files inputs are converted into redacted chunks with offsets,
hashes, revision metadata, and FTS rows.

Chunks, resolver results, generated wiki pages, and index records carry
provenance metadata: source owner, source ref/URI, revision/hash, chunk offsets,
read-only status, citation requirements, and stale-source status. This keeps
future semantic search and wiki compile flows tied back to `open-files` instead
of detached Markdown.

Semantic indexing stores generated vector rows and provenance only. It does not
store raw S3 or local-file bytes in the knowledge app, so a future hosted/S3
wrapper can move generated artifacts to object storage while source ownership
and immutable object identity stay in `open-files`.

AI provider configuration is local/BYOK by default. `open-knowledge` declares
AI SDK v6 provider support through `ai`, `@ai-sdk/openai`,
`@ai-sdk/anthropic`, and `@ai-sdk/deepseek`, but does not call providers until a
prompt, embedding, or agent command explicitly requests a model.

Generated knowledge artifacts can be stored locally under
`.hasna/apps/knowledge/artifacts` or through the S3 artifact-store adapter.

The default safety policy allows writes only under the resolved
`.hasna/apps/knowledge` workspace. S3 manifest/outbox reads require
`safety.network.s3_reads_enabled=true` and an allowed bucket in config, or the
equivalent `HASNA_KNOWLEDGE_ALLOW_S3_READS=1` and
`HASNA_KNOWLEDGE_ALLOWED_S3_BUCKETS=bucket-a,bucket-b` environment variables.

## JSON Output

Every command returns structured JSON when `--json` is passed:

```json
{
  "ok": true,
  "item": { "id": "...", "title": "...", "content": "...", "url": null, "tags": [], "created_at": "...", "updated_at": "..." }
}
```

## Agent-Friendly Design

- **JSON-only mode**: `--json` flag for easy parsing by LLMs
- **Idempotent IDs**: each item gets a stable unique ID
- **Safe deletes**: `--yes` flag required; no accidental deletions
- **Concurrent-safe**: file locking prevents corruption from parallel agents
- **Scriptable**: works in pipelines, CI, and any automation tool

## MCP Server

```bash
open-knowledge-mcp
```

## HTTP mode

Run a shared Streamable HTTP MCP server (127.0.0.1 only):

```bash
open-knowledge-mcp --http      # default port 8819
open-knowledge-mcp --http --port 8819
MCP_HTTP=1 open-knowledge-mcp
```

- Health: `GET http://127.0.0.1:8819/health`
- MCP: `POST http://127.0.0.1:8819/mcp`

Stdio remains the default when no `--http` flag is passed.
