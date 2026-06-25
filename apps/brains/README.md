# @hasna/brains

Fine-tuned model tracker and trainer — wraps OpenAI + Thinker Labs, gathers training data from todos/mementos/conversations/sessions

[![npm](https://img.shields.io/npm/v/@hasna/brains)](https://www.npmjs.com/package/@hasna/brains)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)

## Install

```bash
npm install -g @hasna/brains
```

## CLI Usage

```bash
brains --help
```

- `brains models list`
- `brains models show`
- `brains finetune start`
- `brains finetune status`
- `brains data`

## MCP Server

```bash
brains-mcp
```

## REST API

```bash
brains-serve
```

## Storage Sync

This package supports optional storage sync through a package-local Postgres connection:

```bash
export HASNA_BRAINS_DATABASE_URL=postgres://...
brains storage status
brains storage push
brains storage pull
brains storage sync
```

`BRAINS_DATABASE_URL` is accepted as a short non-deprecated fallback for local
development.

The MCP server also exposes `storage_status`, `storage_push`, `storage_pull`, and `storage_sync`.

## Data Directory

Data is stored in `~/.hasna/brains/`.

## License

Apache-2.0 -- see [LICENSE](LICENSE)
