# open-knowledge

> Agent-friendly local knowledge CLI/MCP with JSON output, project workspaces, durable artifacts, and safe destructive actions.

[![npm version](https://img.shields.io/npm/v/@hasna/knowledge)](https://npm.im/@hasna/knowledge)
[![license](https://img.shields.io/npm/l/@hasna/knowledge)](LICENSE)
[![build](https://img.shields.io/github/actions/workflow/status/hasna/knowledge/ci.yml)](.github/workflows/ci.yml)

`open-knowledge` is evolving from a flat note store into a local-first knowledge
engine for AI agents. It stores simple knowledge items today, creates a Hasna
project workspace under `.hasna/apps/knowledge`, initializes a versioned
`knowledge.db`, writes generated wiki artifacts, and exposes a stdio MCP server.

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

# Initialize the project SQLite catalog
open-knowledge db init --scope project

# Initialize scalable wiki/schema/index/log artifacts
open-knowledge wiki init --scope project
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
`ok_import`, `ok_batch`), workspace inspection (`ok_paths`), and source-ref
parsing (`ok_parse_source_ref`).

## Source And Artifact Boundary

Raw files should be stored and resolved through `open-files`. `open-knowledge`
stores source references such as `open-files://file/<id>`, `s3://...`,
`file://...`, and `https://...`, plus citations, chunks, generated wiki pages,
indexes, logs, runs, and search metadata.

Generated knowledge artifacts can be stored locally under
`.hasna/apps/knowledge/artifacts` or through the S3 artifact-store adapter.

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
