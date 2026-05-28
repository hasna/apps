# @hasna/crawl

AI-powered web crawler — self-hosted Firecrawl alternative. Crawl, extract, render JS, search. CLI + MCP + REST API + Dashboard.

[![npm](https://img.shields.io/npm/v/@hasna/crawl)](https://www.npmjs.com/package/@hasna/crawl)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)

## Install

```bash
npm install -g @hasna/crawl
```

## CLI Usage

```bash
crawl --help
```

- `crawl crawl <url>`
- `crawl list`
- `crawl stats`
- `crawl search <query>`
- `crawl sitemap <url>`
- `crawl map <url>`
- `crawl export`

## MCP Server

```bash
crawl-mcp
```

30 tools available.

## HTTP mode

Long-lived Streamable HTTP transport for shared agent sessions (binds `127.0.0.1` only):

```bash
crawl-mcp --http              # default port 8812
crawl-mcp --http --port 8812
MCP_HTTP=1 MCP_HTTP_PORT=8812 crawl-mcp
```

- `GET /health` → `{"status":"ok","name":"crawl"}`
- `POST /mcp` — Streamable HTTP MCP endpoint (also mounted on `crawl-serve`)

Stdio remains the default transport for gradual rollout.

## REST API

```bash
crawl-serve
```

## Cloud Sync

This package supports cloud sync via `@hasna/cloud`:

```bash
cloud setup
cloud sync push --service crawl
cloud sync pull --service crawl
```

## Data Directory

Data is stored in `~/.hasna/crawl/`.

## License

Apache-2.0 -- see [LICENSE](LICENSE)
