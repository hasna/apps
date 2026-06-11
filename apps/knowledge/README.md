# knowledge

> Agent-friendly local knowledge CLI/MCP with JSON output, project workspaces, durable artifacts, and safe destructive actions.

[![npm version](https://img.shields.io/npm/v/@hasna/knowledge)](https://npm.im/@hasna/knowledge)
[![license](https://img.shields.io/npm/l/@hasna/knowledge)](LICENSE)
[![build](https://img.shields.io/github/actions/workflow/status/hasna/knowledge/ci.yml)](.github/workflows/ci.yml)

`knowledge` is evolving from a flat note store into a local-first knowledge
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

## SDK

Apps can install the package and use the public SDK without shelling out to the
CLI or importing internal source files:

```ts
import { createKnowledgeClient } from '@hasna/knowledge';

const knowledge = createKnowledgeClient({
  scope: 'project',
  cwd: process.cwd(),
});

await knowledge.setup({ mode: 'hosted', canonicalHasnaXyz: true });
await knowledge.ingest.source('file:///absolute/path/to/handbook.md', 'knowledge_index');

const results = await knowledge.search({
  query: 'company wiki policy',
  semantic: true,
  limit: 5,
});

const answer = await knowledge.ask('How do we cite handbook policy?', {
  semantic: true,
  limit: 5,
});

const sync = knowledge.sync.status();
```

The stable package surface is the top-level `@hasna/knowledge` export:
`createKnowledgeClient`, `createKnowledgeSdk`, service/result types, workspace
helpers, source-ref helpers, storage contracts, search/retrieval types,
provider helpers, and remote contract types. CLI and MCP entrypoints remain
available as package bins.

Database storage sync helpers are also available from
`@hasna/knowledge/storage` for SaaS wrappers and deployment tooling.
The top-level SDK also exposes `knowledge.sync.status()`,
`knowledge.sync.snapshot()`, `knowledge.sync.conflicts()`, and
`knowledge.sync.machines()` for app-native sync inspection.

The SDK uses the same `.hasna/apps/knowledge` project workspace as the CLI. In
local mode it writes the SQLite catalog and generated artifacts under that path.
In hosted/canonical mode it can point generated artifacts at S3 while keeping
raw source ownership outside knowledge. Source files remain referenced via
`open-files://`, `file://`, `s3://`, or web refs; knowledge stores derived
chunks, citations, indexes, run logs, and generated wiki artifacts.

## Quick Start

```bash
# Add a note
knowledge add "Rust ownership" "Every value has exactly one owner"

# List all notes
knowledge list

# List with search
knowledge list --search ownership

# List notes tagged "rust"
knowledge list --tag rust

# Inspect every local knowledge layer: notes, sources, chunks, wiki, artifacts, runs, sync
knowledge inventory --scope project --json

# Get a note
knowledge get --id <id>

# Update a note
knowledge update --id <id> --title "Rust ownership model"

# Delete a note (requires --yes)
knowledge delete --id <id> --yes

# Export all notes as JSONL
knowledge export --format jsonl

# Show resolved workspace paths
knowledge paths --scope project --json

# Inspect local/S3 artifact storage and source ownership
knowledge storage status --scope project --json

# Inspect optional machine topology for future sync
knowledge machines topology --scope project --json
knowledge machines preflight spark01 --workspace /home/hasna/workspace/hasna/opensource/open-knowledge --scope project --json

# Inspect and record knowledge-aware sync ledger state
knowledge sync status --scope project --json
knowledge sync doctor --machine spark01 --scope project --json
knowledge sync snapshot --scope project --no-tailscale --json
knowledge sync conflicts --scope project --json
knowledge sync dry-run --peer-workspace /path/to/peer/repo --scope project --json
knowledge sync push --peer-workspace /path/to/peer/repo --scope project --json
knowledge sync dry-run --machine spark01 --peer-workspace /home/hasna/workspace/hasna/opensource/open-knowledge --scope project --json

# Configure optional hosted mode and inspect remote contracts
knowledge setup --mode hosted --api-url https://knowledge.hasna.xyz --scope project --json
knowledge auth whoami --scope project --json
knowledge remote contracts --scope project --json

# Initialize the project SQLite catalog
knowledge db init --scope project

# Inspect optional PostgreSQL sync for knowledge.db
knowledge db storage status --scope project --json

# Push selected catalog tables when HASNA_KNOWLEDGE_DATABASE_URL is configured
HASNA_KNOWLEDGE_DATABASE_URL=postgres://... knowledge db storage push --scope project --tables sources,chunks --json

# Initialize scalable wiki/schema/index/log artifacts
knowledge wiki init --scope project

# Compile cited wiki pages, file approved answers, and lint wiki health
knowledge wiki compile "handbook policy" --title "Handbook Policy" --scope project --json
knowledge wiki file-answer "How do we cite policy?" --content "Use cited source context." --approve-write --scope project --json
knowledge wiki lint --scope project --json

# Ingest an open-files source manifest into the project SQLite catalog
knowledge ingest manifest ./open-files-manifest.jsonl --scope project --json

# Ingest one read-only source ref directly
knowledge ingest source file:///absolute/path/to/handbook.md --purpose knowledge_index --scope project --json

# Consume open-files change events and invalidate stale source chunks
knowledge reindex outbox ./open-files-outbox.jsonl --scope project --json

# Inspect and refresh the embedding queue after source changes
knowledge reindex status --scope project --json
knowledge reindex enqueue --scope project --json
knowledge reindex embeddings --scope project --fake --json

# Resolve indexed source text and citation evidence through the read-only source boundary
knowledge source resolve open-files://file/f_123/revision/rev_456 --scope project --json

# Inspect local safety policy and approvals
knowledge safety status --scope project --json

# Inspect AI SDK provider credentials and model aliases
knowledge providers status --scope project --json
knowledge providers models --scope project --json

# Embed indexed chunks and run semantic search
knowledge embeddings index --scope project --model openai:text-embedding-3-small --json
knowledge embeddings search "company wiki policy" --scope project --json

# Hybrid search over source chunks, generated wiki pages, indexes, and optional vectors
knowledge search "company wiki policy" --scope project --json
knowledge search "company wiki policy" --scope project --semantic --json
knowledge search "company wiki policy" --scope project --context --json

# Build a citation answer/context draft for a prompt
knowledge ask "How do we cite handbook policy?" --scope project --json
knowledge "How do we cite handbook policy?" --scope project --json

# Provider-native web search, safety-gated for real network access
HASNA_KNOWLEDGE_WEB_SEARCH=1 knowledge web search "latest AI SDK web search" --provider openai --json
```

## Guides

- [Company wiki workflow](docs/examples/company-wiki-workflow.md): an end-to-end
  local workflow for open-files manifests, search, prompt runs, cited wiki
  pages, linting, reindexing, MCP, and optional hosted/S3 mode.
- [JSON to SQLite migration](docs/migration/json-to-sqlite.md): how legacy
  JSON notes coexist with the `.hasna/apps/knowledge` workspace and the
  versioned SQLite catalog.
- [AI-native architecture](docs/architecture/ai-native-knowledge-base.md):
  source boundaries, wiki model, search model, provider registry, and non-goals.
- [Hybrid semantic search](docs/architecture/hybrid-semantic-search.md):
  keyword/vector/search-context contracts and hosted index options.
- [Machine sync schema](docs/architecture/machine-sync-schema.md):
  optional open-machines topology, sync ledgers, conflict records, and
  local/S3/hosted sync boundaries.
- [Hosted wrapper responsibilities](docs/architecture/hosted-wrapper-responsibilities.md):
  what a future SaaS layer owns outside the OSS package.

## Commands

### add
```bash
knowledge add <title> <content> [--url <url>] [-t <tag>]
```
Add a new knowledge item.

### list
```bash
knowledge list|ls [options]
```
List compatibility JSON-store items with pagination, search, and tag filtering.
Use `knowledge inventory` or `knowledge search` when an agent needs the
SQLite catalog, source chunks, generated wiki pages, artifacts, runs, and sync
state too.

| Flag | Description |
|------|-------------|
| `-p, --page <n>` | Page number (default: 1) |
| `-l, --limit <n>` | Items per page (default: 20) |
| `-s, --search <text>` | Filter by title or content |
| `-t, --tag <tag>` | Filter by tag |
| `--sort created\|title` | Sort field (default: created) |
| `--desc` | Sort descending |

### inventory
```bash
knowledge inventory [--scope local|global|project] [--limit <n>] [--include-archived] [--json]
```
Show a capped, unified local inventory across the compatibility JSON item
store, the SQLite catalog, indexed source refs, source/wiki chunks, generated
wiki pages, knowledge indexes, artifact manifest rows, prompt runs, vector
index status, reindex queue, machine sync rows, conflicts, and safety/audit
decisions. This is the command to answer "what knowledge exists here?" without
dumping every raw chunk body.

### get
```bash
knowledge get --id <id>
```
Retrieve a single item by ID.

### update
```bash
knowledge update|edit --id <id> [options]
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
knowledge archive --id <id>
knowledge restore --id <id>
```
Archive hides an item from default `list` output without deleting it.

### upsert
```bash
knowledge upsert [title] [content] [--id <id>] [--title <title>] [--content <content>]
```
Create or update an item by ID.

### untag
```bash
knowledge untag --id <id> -t <tag>
```
Remove one tag from an item.

### delete
```bash
knowledge delete|rm --id <id> --yes
```
Delete an item. Requires `--yes` to confirm.

### export
```bash
knowledge export [--format jsonl]
```
Export all items. Use `--format jsonl` for newline-delimited JSON.

### paths
```bash
knowledge paths [--scope global|project|local] [--json]
```
Show the resolved Hasna app workspace, JSON compatibility store, SQLite path,
artifact directories, and config.

### storage
```bash
knowledge storage status [--scope project] [--json]
knowledge storage validate [--scope project] [--json]
knowledge storage repair-artifact-keys [--approve-write --approved-by <name>] [--scope project] [--json]
```
Show the storage contract for local or S3-backed generated artifacts. Local mode
uses `.hasna/apps/knowledge` for config, SQLite, indexes, wiki artifacts, logs,
runs, and exports. S3 mode stores generated artifacts under the configured
knowledge bucket/prefix while `open-files` remains the source of truth for raw
source bytes. The command also reports artifact classes, allowed source ref
schemes, and warnings for non-scalable or unsafe config.

`storage repair-artifact-keys` previews legacy `storage_objects` rows where the
portable artifact key accidentally includes the configured S3 prefix. It only
updates metadata after `--approve-write --approved-by <name>` and records an
audit event; it does not move S3 objects or copy raw source bytes.

For Hasna XYZ production, the canonical generated-artifact bucket is
`hasna-xyz-opensource-knowledge-prod` in `us-east-1` with prefix
`.hasna/apps/knowledge/`. `storage status --json` exposes this under
`canonical_hasna_xyz` even when local storage is active. The canonical
metadata-only secret paths are:

```text
hasna/xyz/opensource/knowledge/prod/env
hasna/xyz/opensource/knowledge/prod/aws
hasna/xyz/opensource/knowledge/prod/s3
```

The future hosted database path, if provisioned, is
`hasna/xyz/opensource/knowledge/prod/rds`.

### machines
```bash
knowledge machines topology [--no-tailscale] [--scope project] [--json]
knowledge machines preflight [machine] [--workspace <repo>] [--scope project] [--json]
```
Inspect the read-only machine topology that future knowledge sync will use.
Machine integration goes through the optional `KnowledgeMachinesAdapter`
boundary. In default `auto` mode, `knowledge` tries the lightweight
`@hasna/machines/consumer` SDK, then the installed `machines --json` CLI, then
local machine identity and optional Tailscale status probing. The explicit
adapter modes are `sdk`, `cli`, and `disabled`; `@hasna/machines` is never a
hard runtime dependency. This command does not sync data; it only exposes
machine ids, hostnames, route hints, workspace context, and adapter status.
If the optional consumer SDK declares a newer contract than `knowledge`
understands, `knowledge` refuses the SDK result and reports
`unsupported_contract_version:<n>` while falling back to raw/local behavior.

`machines preflight` checks command availability, `@hasna/knowledge` CLI
version parity, optional `@hasna/machines` availability, and the target repo
workspace/package metadata before any machine sync is attempted. When
`@hasna/machines` is installed, `knowledge` delegates to its compatibility SDK
or CLI contract; otherwise it uses a local/SSH fallback. Remote sync JSON
includes adapter diagnostics for route and workspace resolution so CLI, SDK,
and MCP callers can see whether the result came from SDK, CLI, argument
override, registry fallback, or disabled fallback.

The installed adapter smoke harness verifies the same boundary outside unit
test fakes:

```bash
bun run smoke:machines-adapter -- --json
```

It builds isolated temp apps for project-local SDK resolution, global
`machines` CLI-only fallback, unsupported future SDK contracts, and
no-SDK/no-CLI fallback.

The spark release smoke turns the manual spark02/spark01 sync runbook into a
repeatable evidence command:

```bash
bun run smoke:spark-sync-release -- --knowledge-version 0.2.63 --machines-version latest --json --keep-temp
```

It installs the requested package versions on spark02 and spark01, runs the
adapter smoke and machines consumer conformance on both machines when
available, creates isolated project workspaces, runs `sync doctor`, dry-run,
push, generated artifact manifest checks, forced conflicts in both directions,
fake AI conflict proposals, approval-gated resolutions, and a final
bidirectional dry-run that must converge with zero conflicts. It also repeats
the sync/conflict path from an isolated installed-package runner where
`@hasna/machines` and the `machines` CLI are hidden locally, proving knowledge
can still operate through raw SSH plus `--peer-workspace`. A second hidden
runner scenario first learns a knowledge-owned registry fallback, then omits
`--peer-workspace` and requires `source=registry` for route and workspace
resolution. Use `--evidence-json <path>` or `--evidence-md <path>` to save a
compact release artifact for todos.

### sync
```bash
knowledge sync status [--scope project] [--json]
knowledge sync doctor|readiness [--machine <ssh-alias>] [--peer-workspace <repo-or-knowledge-home>] [--tables sources,chunks] [--scope project] [--json]
knowledge sync snapshot [--no-tailscale] [--machine <id>] [--scope project] [--json]
knowledge sync machines [--scope project] [--json]
knowledge sync conflicts [status] [--limit <n>] [--scope project] [--json]
knowledge sync conflicts propose <id> [--mode deterministic|ai] [--model <alias|provider:model>] [--fake] [--scope project] [--json]
knowledge sync dry-run --peer-workspace <repo-or-knowledge-home> [--tables sources,chunks] [--scope project] [--json]
knowledge sync pull --peer-workspace <repo-or-knowledge-home> [--tables sources,chunks] [--scope project] [--json]
knowledge sync push --peer-workspace <repo-or-knowledge-home> [--tables sources,chunks] [--scope project] [--json]
knowledge sync sync --peer-workspace <repo-or-knowledge-home> [--tables sources,chunks] [--scope project] [--json]
knowledge sync dry-run --machine <ssh-alias> --peer-workspace <remote-repo> [--scope project] [--json]
knowledge sync export [--tables sources,chunks] [--no-artifact-content] [--scope project] --json
knowledge sync import [--dry-run] [--scope project] [--json] < bundle.json
```
Inspect and record the knowledge-aware sync ledger in `knowledge.db`.
`sync status` is read-only and reports registered machines, latest snapshot,
change counts, conflict counts, and durable table counts. `sync snapshot`
refreshes the machine registry from optional topology discovery and records a
content hash over table counts and generated artifact hashes. Conflict rows are
inspectable before any future merge/approval flow writes durable changes.
Non-dry remote sync also persists route/workspace resolver evidence into
`knowledge_machines`; later remote sync can use that knowledge-owned registry
row when the optional open-machines SDK/CLI is unavailable. Read-only commands
such as `sync status`, `sync doctor`, and `sync dry-run` do not write registry
evidence.
When newer `@hasna/machines` consumers provide resolver cacheability metadata,
knowledge preserves `observed_at`, `expires_at`, cacheable/stale status,
source authority, and reasons in sync JSON and registry fallback evidence.

`sync doctor` is the read-only preflight for machine sync. It reports the
local SQLite schema and table counts, storage contract validation, table
generated artifact manifest readiness from `storage_objects`, table clocks,
open conflicts, `open-files://` source-ref boundary status, optional route
confidence, optional workspace path sources, and any open-machines workspace
diagnostics or repair hints. The artifact manifest check is read-only: it
validates hashes, sizes, portable artifact keys, S3/local URI prefix parity,
artifact modified-time metadata where available, provenance artifact-key
parity, and raw-payload sentinels without downloading artifacts or raw source
bytes.
When open-machines reports inferred or untrusted workspace metadata, the JSON
includes actionable `machines workspace repair ...` commands before sync is
attempted.

`sync conflicts propose <id>` is approval-gated. The default deterministic
mode builds a merge prompt from conflict metadata. `--mode ai` runs the same
read-only evidence gathering path through the AI SDK provider abstraction,
returning a structured proposed patch, citations, confidence, provider/model,
usage, and read-only tool trail. `--fake` produces deterministic local output
without provider credentials. Neither mode resolves or writes durable changes;
`sync conflicts resolve` still requires `--approve-write --approved-by <name>`.

`sync dry-run`, `pull`, `push`, and `sync` operate against another local repo
root or `.hasna/apps/knowledge` path. They compare rows by table primary key,
copy generated artifacts recorded in `storage_objects`, normalize local
artifact URIs per machine, and record conflicts instead of overwriting
divergent rows. They move derived catalog rows and generated artifacts only;
raw `open-files` bytes are not copied into knowledge.

When `--machine <ssh-alias>` is supplied, peer sync uses `ssh` plus the
remote `knowledge sync export/import` commands. The remote machine must have a
compatible published `knowledge` CLI on PATH, and `--peer-workspace` should be
the remote repo root or remote `.hasna/apps/knowledge` path.

This command is separate from `knowledge db storage sync`: `sync` owns
knowledge semantics and conflict visibility, while `db storage sync` moves
SQLite catalog rows to or from PostgreSQL using the open-core storage contract.

### setup / auth / remote
```bash
knowledge setup --mode local [--scope project] [--json]
knowledge setup --mode hosted [--api-url https://knowledge.hasna.xyz] [--scope project] [--json]
knowledge setup --mode hosted --canonical-hasna-xyz [--scope project] [--json]
knowledge auth login --api-key <key> [--email you@example.com] [--org <slug>] [--scope project] [--json]
knowledge auth whoami [--scope project] [--json]
knowledge auth logout [--scope project] [--json]
knowledge remote status [--scope project] [--json]
knowledge remote contracts [--scope project] [--json]
```
Hosted mode mirrors the `open-skills` open-core pattern: the OSS package stays
local-first, while `hosted.api_url`, `KNOWLEDGE_API_URL`, and
`KNOWLEDGE_API_KEY` define an optional remote client boundary. Credentials are
stored locally in `~/.hasna/knowledge/auth.json` or supplied by env vars.
`remote contracts` prints the typed registry/search/ask/build/sync/status/logs
and artifact API contract that a future SaaS wrapper can implement.

### db
```bash
knowledge db init [--scope project]
knowledge db stats [--scope project]
knowledge inventory [--scope project] [--json]
knowledge db storage status [--scope project] [--json]
knowledge db storage push [--tables sources,chunks] [--scope project] [--json]
knowledge db storage pull [--tables sources,chunks] [--scope project] [--json]
knowledge db storage sync [--tables sources,chunks] [--scope project] [--json]
```
Initialize or inspect the versioned SQLite catalog at
`.hasna/apps/knowledge/knowledge.db`.

`db storage` is separate from `knowledge storage`: it syncs durable catalog rows
between local SQLite and PostgreSQL. Configure it with
`HASNA_KNOWLEDGE_DATABASE_URL` or fallback `KNOWLEDGE_DATABASE_URL`. Optional
mode env vars are `HASNA_KNOWLEDGE_STORAGE_MODE` and
`KNOWLEDGE_STORAGE_MODE`, with `local`, `hybrid`, or `remote` values.
The sync table list excludes local derived FTS indexes such as `chunks_fts`.

### wiki
```bash
knowledge wiki init [--scope project]
knowledge wiki compile [query|source-ref...] [--title <title>] [--limit <n>] [--scope project] [--json]
knowledge wiki file-answer <prompt> --content <answer> [--approve-write] [--scope project] [--json]
knowledge wiki lint [--scope project] [--json]
```
Create starter generated-knowledge artifacts through the artifact store:
`schemas/v1.md`, `indexes/root.md`, `wiki/README.md`, and a dated JSONL log
partition.

`wiki compile` turns existing source chunks into a cited Markdown page under
`wiki/generated/`, updates `knowledge_indexes`, records citations and a concept
backlink, and appends a JSONL log partition. `wiki file-answer` keeps answer
filing as a dry run unless `--approve-write` is supplied, then writes a cited
answer note under `wiki/answers/`. `wiki lint` checks generated pages for
missing citations, stale citations, duplicate titles, orphan pages, unresolved
source refs, contradiction markers, and new article candidates.

### source
```bash
knowledge source resolve <source-ref> [--purpose knowledge_answer|knowledge_index] [--limit <n>] [--scope project] [--json]
```
Resolve an indexed source through the read-only open-files boundary. The result
returns source metadata, permissions, the selected revision, derived chunk text,
and citation evidence. It does not expose raw file bytes or storage credentials;
raw source retrieval remains owned by `open-files`.

### ingest
```bash
knowledge ingest manifest <file|s3://bucket/key> [--scope project] [--json]
knowledge ingest source <source-ref> [--purpose knowledge_index] [--scope project] [--json]
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
knowledge reindex status [--model openai:text-embedding-3-small] [--scope project] [--json]
knowledge reindex enqueue [--model openai:text-embedding-3-small] [--scope project] [--json]
knowledge reindex embeddings [--full] [--limit <n>] [--model openai:text-embedding-3-small] [--scope project] [--json]
knowledge reindex outbox <file|s3://bucket/key> [--scope project] [--json]
```
Inspect and operate index refresh work. `reindex status` reports missing
embedding rows, stale revisions, queued jobs, and vector counts. `reindex
enqueue` adds missing source chunks to `reindex_queue` idempotently. `reindex
embeddings` records an `embedding-refresh` run, indexes missing chunks, and
marks completed queue rows; `--full` first clears `chunk_embeddings` and
`vector_index_entries` so the current source catalog is rebuilt from scratch.

`reindex outbox` consumes open-files JSON or JSONL change events. This
invalidates matching source chunks and embeddings by source ref, revision, or
hash, updates permission/path/delete metadata, and records a local run ledger.
Outbox inputs can be local files or allowed S3 objects, but raw source files
remain owned by `open-files`.

### search
```bash
knowledge search <query> [--scope project] [--limit <n>] [--json]
knowledge search <query> --semantic [--model openai:text-embedding-3-small] [--scope project] [--json]
knowledge search <query> --context [--semantic] [--scope project] [--json]
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
knowledge ask <prompt> [--scope project] [--json]
knowledge build <prompt> [--generate] [--model default|provider:model] [--scope project] [--json]
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
knowledge web search <query> [--provider openai|anthropic] [--model provider:model] [--domain <domain>] [--file-results] [--scope project] [--json]
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
knowledge safety status [--scope project] [--json]
knowledge safety check generated_write [target] [--scope project] [--json]
knowledge safety approve generated_write [target] [--scope project] [--json]
knowledge safety audit [--scope project] [--json]
knowledge safety redact <text> [--scope project] [--json]
```
Inspect and operate the local safety model. Source reads are read-only by
default, web search and S3 reads are opt-in, generated writes require approval
by default, and known secret patterns are redacted before chunk storage.

### providers
```bash
knowledge providers status [--scope project] [--json]
knowledge providers models [--scope project] [--json]
knowledge providers check [provider|model-alias] [--scope project] [--json]
```
Inspect AI SDK v6 provider readiness for OpenAI, Anthropic, and DeepSeek. The
provider layer resolves BYOK credentials from `OPENAI_API_KEY`,
`ANTHROPIC_API_KEY`, and `DEEPSEEK_API_KEY` by default, exposes model aliases
such as `default`, `fast`, `reasoning`, `sonnet`, and `deepseek`, and records
provider capability metadata for structured output, tool use, tool streaming,
reasoning, embeddings, and native web-search support.

### embeddings
```bash
knowledge embeddings status [--scope project] [--json]
knowledge embeddings index [--model openai:text-embedding-3-small] [--limit <n>] [--scope project] [--json]
knowledge embeddings search <query> [--model openai:text-embedding-3-small] [--limit <n>] [--scope project] [--json]
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
knowledge help [command]
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
knowledge-mcp
```

The stable agent-facing MCP tools are:

- `knowledge_search`: return a reranked citation context pack.
- `knowledge_ask`: answer with read-only local knowledge and optional AI SDK
  generation.
- `knowledge_build`: run the prompt flow and optionally file a cited wiki answer
  when `approve_write=true`.
- `knowledge_get`: read an item, indexed source, wiki page, run, index, or
  decision by id.
- `knowledge_ingest`: ingest an open-files/S3/file/web source ref or open-files
  manifest into the derived catalog.
- `knowledge_web_search`: run safety-gated provider-native web search.
- `knowledge_lint`: lint generated wiki pages for citation/source issues.
- `knowledge_run_status`: list recent runs or inspect one run ledger.
- `knowledge_storage`: inspect the local/S3/hosted storage contract.
- `knowledge_resolve_source`: resolve indexed source chunks through the
  read-only source boundary.
- `knowledge_machines_topology`: inspect optional machine topology and route
  hints for future knowledge sync planning.
- `knowledge_machines_preflight`: check command, package, workspace, and
  optional open-machines readiness before knowledge sync.
- `knowledge_sync_status`: inspect machine registry rows, latest snapshot,
  changes, conflicts, and table counts.
- `knowledge_sync_doctor`: read-only sync readiness report with storage,
  open-files boundary, route/workspace diagnostics, and next commands.
- `knowledge_sync_snapshot`: record a local sync snapshot and refresh machine
  registry rows from optional topology.
- `knowledge_sync_conflicts`: list sync conflicts awaiting review or already
  resolved.
- `knowledge_sync_conflict_propose`: build deterministic or AI SDK conflict
  proposals with citations and explicit approval gating.
- `knowledge_sync_peer`: dry-run, pull, push, or bidirectionally sync with a
  local peer workspace.
- `storage_status`, `storage_push`, `storage_pull`, `storage_sync`: inspect or
  sync the SQLite catalog with PostgreSQL using the standard open-core storage
  env contract.

Compatibility and lower-level tools remain available with the `ok_*` prefix:
item tools (`ok_add`, `ok_list`, `ok_get`, `ok_update`, `ok_delete`,
`ok_archive`, `ok_restore`, `ok_upsert`, `ok_untag`, `ok_bulk_delete`,
`ok_prune`, `ok_dedupe`, `ok_stats`, `ok_export`, `ok_import`, `ok_batch`),
workspace/storage inspection (`ok_paths`, `ok_storage_status`), providers,
embeddings, reindexing, hybrid search, source parsing/resolution, and
`ok_web_search`.

MCP also publishes project-scope JSON resources for agent inspection:

- `knowledge://project/config`
- `knowledge://project/storage`
- `knowledge://project/machines`
- `knowledge://project/sync`
- `knowledge://project/schema`
- `knowledge://project/sources`
- `knowledge://project/open-files`
- `knowledge://project/wiki/pages`
- `knowledge://project/indexes`
- `knowledge://project/runs`
- `knowledge://project/decisions`
- Templated reads:
  `knowledge://project/items/{id}`,
  `knowledge://project/sources/{id}`,
  `knowledge://project/wiki/pages/{id}`,
  `knowledge://project/indexes/{id}`,
  `knowledge://project/runs/{id}`,
  `knowledge://project/decisions/{id}`

These resources expose compact metadata, derived chunks, generated wiki text,
run ledgers, and citation evidence. They do not expose raw source bytes from
`open-files`, local files, or S3.

## Source And Artifact Boundary

Raw files should be stored and resolved through `open-files`. `knowledge`
stores source references such as `open-files://file/<id>`,
`open-files://file/<id>/revision/<revision_id>`, `s3://...`, `file://...`,
and `https://...`, plus citations, chunks, generated wiki pages, indexes,
logs, runs, and search metadata.

`knowledge source resolve` and the MCP `ok_resolve_source` tool resolve
only the indexed, derived knowledge catalog. The resolver enforces read-only
purpose labels from source permissions, returns chunk citation evidence, writes
an audit event, and keeps bytes/storage credentials inside `open-files`.

`knowledge ingest source` can also build derived chunks from an allowed
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

AI provider configuration is local/BYOK by default. `knowledge` declares
AI SDK v6 provider support through `ai`, `@ai-sdk/openai`,
`@ai-sdk/anthropic`, and `@ai-sdk/deepseek`, but does not call providers until a
prompt, embedding, or agent command explicitly requests a model.

Generated knowledge artifacts can be stored locally under
`.hasna/apps/knowledge/artifacts` or through the S3 artifact-store adapter.
For Hasna XYZ production, `knowledge setup --mode hosted
--canonical-hasna-xyz --scope project --json` configures generated artifacts
under `s3://hasna-xyz-opensource-knowledge-prod/.hasna/apps/knowledge/` and
keeps `open-files` as the raw-source owner.

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
knowledge-mcp
```

## HTTP mode

Run a shared Streamable HTTP MCP server (127.0.0.1 only):

```bash
knowledge-mcp --http      # default port 8819
knowledge-mcp --http --port 8819
MCP_HTTP=1 knowledge-mcp
```

- Health: `GET http://127.0.0.1:8819/health`
- MCP: `POST http://127.0.0.1:8819/mcp`

Stdio remains the default when no `--http` flag is passed.
