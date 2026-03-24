# @hasna/economy

AI coding cost tracker — CLI + MCP server + REST API + web dashboard for Claude Code, Codex, and Gemini

[![npm](https://img.shields.io/npm/v/@hasna/economy)](https://www.npmjs.com/package/@hasna/economy)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)

## Install

```bash
npm install -g @hasna/economy
```

## CLI Usage

```bash
economy --help
```

## MCP Server

```bash
economy-mcp
```

## REST API

```bash
economy-serve
```

## Cloud Sync

This package supports cloud sync via `@hasna/cloud`:

```bash
cloud setup
cloud sync push --service economy
cloud sync pull --service economy
```

## Data Directory

Data is stored in `~/.hasna/economy/`.

## License

Apache-2.0 -- see [LICENSE](LICENSE)
