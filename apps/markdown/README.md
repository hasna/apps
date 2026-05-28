# @hasna/markdown

Open Markdown Protocol (OMP) — structured markdown as intermediate representation between AI models. Smart LLM writes it, cheap LLM/regex executes it.

[![npm](https://img.shields.io/npm/v/@hasna/markdown)](https://www.npmjs.com/package/@hasna/markdown)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)

## Install

```bash
npm install -g @hasna/markdown
```

## CLI Usage

```bash
omp --help
```

- `omp validate <file>`
- `omp run <file>`
- `omp compile <file>`
- `omp lint <file>`
- `omp inspect <file>`
- `omp init`

## MCP Server

```bash
omp-mcp
```

## HTTP mode

Long-lived Streamable HTTP transport for shared agent connections (stdio remains the default):

```bash
omp-mcp --http
# or: MCP_HTTP=1 omp-mcp
# default port: 8822 (override with --port or MCP_HTTP_PORT)
```

Endpoints on `127.0.0.1` only:

- `GET /health` → `{"status":"ok","name":"markdown"}`
- `POST /mcp` → MCP Streamable HTTP

## REST API

```bash
omp-serve
```

## Cloud Sync

This package supports cloud sync via `@hasna/cloud`:

```bash
cloud setup
cloud sync push --service markdown
cloud sync pull --service markdown
```

## Data Directory

Data is stored in `~/.hasna/markdown/`.

## License

Apache-2.0 -- see [LICENSE](LICENSE)
