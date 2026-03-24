# @hasna/search

Unified search aggregator — 12 providers (Google, SerpAPI, Exa, Perplexity, Twitter, Reddit, YouTube, Brave, Bing, Hacker News, GitHub, arXiv) + YouTube transcription. CLI + MCP + REST API + Dashboard.

[![npm](https://img.shields.io/npm/v/@hasna/search)](https://www.npmjs.com/package/@hasna/search)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)

## Install

```bash
npm install -g @hasna/search
```

## CLI Usage

```bash
search --help
```

## MCP Server

```bash
search-mcp
```

31 tools available.

## REST API

```bash
search-serve
```

## Cloud Sync

This package supports cloud sync via `@hasna/cloud`:

```bash
cloud setup
cloud sync push --service search
cloud sync pull --service search
```

## Data Directory

Data is stored in `~/.hasna/search/`.

## License

Apache-2.0 -- see [LICENSE](LICENSE)
