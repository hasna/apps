# @hasna/prompts

Reusable prompt library for AI agents — CLI + MCP server + REST API + web dashboard

[![npm](https://img.shields.io/npm/v/@hasna/prompts)](https://www.npmjs.com/package/@hasna/prompts)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)

## Install

```bash
npm install -g @hasna/prompts
```

## CLI Usage

```bash
prompts --help
```

## MCP Server

```bash
prompts-mcp
```

1 tools available.

## REST API

```bash
prompts-serve
```

## Storage Sync

This package has native local/remote sync. Local data stays in SQLite under
`~/.hasna/prompts/`; remote sync uses PostgreSQL when
`HASNA_PROMPTS_DATABASE_URL` is set or `~/.hasna/prompts/storage/config.json` is
configured.

```bash
prompts storage status
prompts storage migrate
prompts storage push
prompts storage pull
```

Programmatic storage helpers are available from `@hasna/prompts/storage`.

## Data Directory

Data is stored in `~/.hasna/prompts/`.

## License

Apache-2.0 -- see [LICENSE](LICENSE)
