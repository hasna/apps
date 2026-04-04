# open-knowledge

> Agent-friendly local knowledge CLI with JSON output, pagination, and safe destructive actions.

[![npm version](https://img.shields.io/npm/v/@hasna/knowledge)](https://npm.im/@hasna/knowledge)
[![license](https://img.shields.io/npm/l/@hasna/knowledge)](LICENSE)
[![build](https://img.shields.io/github/actions/workflow/status/hasna/knowledge/ci.yml)](.github/workflows/ci.yml)

A flat key-value knowledge store designed for AI agents. Stores notes with titles, content, source URLs, and tags. Works with Bun and Node.js.

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

### help
```bash
open-knowledge help [command]
```

## Global Options

| Flag | Description |
|------|-------------|
| `--json` | Output raw JSON |
| `--store <path>` | Override store path |
| `--version, -v` | Show version |
| `--help, -h` | Show help |

## Store Location

Default store: `~/.open-knowledge/db.json`

Override with `--store <path>` or set `OPEN_KNOWLEDGE_STORE` env var.

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
