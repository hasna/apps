# CLAUDE.md

## Project Overview

`@hasna/connect-xml` is a TypeScript connector for the XML.com REST API (documents, events, search).

## Authentication

Bearer token via `XML_API_KEY` environment variable or profile config (`connect-xml config set-key`).

Optional `XML_BASE_URL` overrides the default `https://api.xml.com/v1`.

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/documents` | List documents |
| POST | `/documents` | Create document |
| GET | `/documents/:id` | Get document |
| GET | `/events` | List events |
| POST | `/search` | Search |
| * | custom path | `rawRequest` escape hatch |

## Commands

```bash
bun install
bun run dev -- documents list
bun run typecheck
bun test
bun run build
```

## Config Storage

`~/.hasna/connectors/xml/profiles/`
