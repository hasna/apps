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

## Cloud Sync

This package supports cloud sync via `@hasna/cloud`:

```bash
cloud setup
cloud sync push --service prompts
cloud sync pull --service prompts
```

## Data Directory

Data is stored in `~/.hasna/prompts/`.

## License

Apache-2.0 -- see [LICENSE](LICENSE)
