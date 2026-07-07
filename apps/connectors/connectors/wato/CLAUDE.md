# CLAUDE.md

This file provides guidance to Claude Code when working with the Wato connector.

## Project Overview

`@hasna/connect-wato` is a TypeScript API connector for the Wato REST API (`https://api.watolabs.com/v1`). It exposes shared agent memories, workflows, tools, and artifacts.

## Build & Run Commands

```bash
bun install
bun run dev
bun run build
bun run typecheck
bun test
```

## Authentication

API key via **Bearer token** (`Authorization: Bearer <api_key>`).

| Variable | Description |
|----------|-------------|
| `WATO_API_KEY` | API key (overrides profile) |
| `WATO_BASE_URL` | Optional base URL override |

Profiles are stored in `~/.hasna/connectors/wato/profiles/`.

## API Surface

- `GET /memories` — listMemories
- `POST /memories` — upsertMemory
- `GET /memories/{id}` — getMemory
- `GET /workflows` — listWorkflows
- `POST /workflows/{id}/runs` — runWorkflow
- `GET /tools` — listTools
- `GET /artifacts/{id}` — getArtifact
- `rawRequest` — arbitrary path/method/body under base URL

Path segments are URL-encoded with `encodeURIComponent`.

## CLI Commands

```bash
wato memories list --query '{"scope":"team"}'
wato memories get <memoryId>
wato memories upsert --title "..." --content "..."
wato workflows list
wato workflows run <workflowId> --input '{"account":"acme"}'
wato tools list
wato artifacts get <artifactId>
wato raw-request --path /custom/agents --method POST --body '{"enabled":true}'
```

## Project Structure

```
src/
├── api/
│   ├── client.ts
│   ├── client.test.ts
│   └── index.ts
├── cli/index.ts
├── types/index.ts
├── utils/config.ts
└── index.ts
```

## License

Apache-2.0
