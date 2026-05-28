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

## HTTP mode

Run a long-lived Streamable HTTP MCP server on `127.0.0.1` (default port **8801**):

```bash
brains-mcp --http
# or: MCP_HTTP=1 brains-mcp
# port override: --port 8801  or  MCP_HTTP_PORT=8801
```

- Health: `GET http://127.0.0.1:8801/health` → `{"status":"ok","name":"brains"}`
- MCP: `http://127.0.0.1:8801/mcp`

Stdio remains the default when no `--http` / `MCP_HTTP=1` is set.

## REST API

```bash
brains-serve
```

## Cloud Sync

This package supports cloud sync via `@hasna/cloud`:

```bash
cloud setup
cloud sync push --service brains
cloud sync pull --service brains
```

## Data Directory

Data is stored in `~/.hasna/brains/`.

## License

Apache-2.0 -- see [LICENSE](LICENSE)
