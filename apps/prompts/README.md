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

## HTTP mode

```bash
prompts-mcp --http              # default port 8828
MCP_HTTP=1 MCP_HTTP_PORT=8828 prompts-mcp
```

Endpoints: `GET /health` → `{"status":"ok","name":"prompts"}`, MCP at `/mcp`. The REST server (`prompts-serve`) also mounts `/mcp` on its port.

## REST API

```bash
prompts-serve
```

## Data Directory

Data is stored locally in `~/.hasna/prompts/` by default.

- Set `HASNA_PROMPTS_DB_PATH` to point at a specific SQLite database file.
- Set `PROMPTS_DB_SCOPE=project` to use the nearest project `.prompts/prompts.db`.
- Set `HASNA_PROMPTS_STORAGE_MODE=local` to make the storage mode explicit.

Remote or hosted deployments should provide a prompts-owned storage adapter or
service boundary. This package owns its database adapter and MCP tool surface.

## License

Apache-2.0 -- see [LICENSE](LICENSE)
