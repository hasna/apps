# @hasna/browser

General-purpose browser agent toolkit — Playwright, Chrome DevTools Protocol, Lightpanda with auto engine selection. CLI + MCP + REST + SDK.

[![npm](https://img.shields.io/npm/v/@hasna/browser)](https://www.npmjs.com/package/@hasna/browser)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)

## Install

```bash
npm install -g @hasna/browser
```

## CLI Usage

```bash
browser --help
```

## MCP Server

```bash
browser-mcp
```

## HTTP mode

Run a long-lived Streamable HTTP MCP server on `127.0.0.1` (default port **8802**):

```bash
browser-mcp --http
# or: MCP_HTTP=1 browser-mcp
# port override: --port 8802  or  MCP_HTTP_PORT=8802
```

- Health: `GET http://127.0.0.1:8802/health` → `{"status":"ok","name":"browser"}`
- MCP: `http://127.0.0.1:8802/mcp`

Stdio remains the default when no `--http` / `MCP_HTTP=1` is set.

## REST API

```bash
browser-serve
```

## Cloud Sync

This package supports cloud sync via `@hasna/cloud`:

```bash
cloud setup
cloud sync push --service browser
cloud sync pull --service browser
```

## Data Directory

Data is stored in `~/.hasna/browser/`.

## License

Apache-2.0 -- see [LICENSE](LICENSE)
