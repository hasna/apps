# @hasna/conversations

Real-time CLI messaging for AI agents

[![npm](https://img.shields.io/npm/v/@hasna/conversations)](https://www.npmjs.com/package/@hasna/conversations)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)

## Install

```bash
npm install -g @hasna/conversations
```

## CLI Usage

```bash
conversations-hook --help
```

- `conversations-hook send`
- `conversations-hook read`
- `conversations-hook digest`
- `conversations-hook search`
- `conversations-hook graph build`
- `conversations-hook agent`

## MCP Server

```bash
conversations-mcp
```

## HTTP mode

Long-lived Streamable HTTP transport (stateless, bind `127.0.0.1` only):

```bash
conversations-mcp --http              # default port 8856
conversations-mcp --http --port 8856
MCP_HTTP=1 conversations-mcp
```

- Health: `GET http://127.0.0.1:8856/health`
- MCP: `http://127.0.0.1:8856/mcp`

The dashboard server also exposes `/health` and `/mcp` when running.

## Cloud Sync

This package supports cloud sync via `@hasna/cloud`:

```bash
cloud setup
cloud sync push --service conversations
cloud sync pull --service conversations
```

## Data Directory

Data is stored in `~/.hasna/conversations/`.

## License

Apache-2.0 -- see [LICENSE](LICENSE)
