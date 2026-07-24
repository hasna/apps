# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Project Overview

connect-trycardinal-ai is a TypeScript connector for the Cardinal document intelligence API (TryCardinal AI). It provides CLI and library access for converting documents to markdown and splitting documents.

## Build & Run Commands

```bash
bun install
bun run dev
bun run build
bun run typecheck
bun run dev convert-to-markdown --file-url https://example.com/doc.pdf
bun run dev split-document --file ./document.pdf
bun run dev raw-request --path /markdown --method POST --body '{"fileUrl":"https://example.com/doc.pdf"}'
```

## API Details

- **Base URL**: `https://api.trycardinal.ai` (configurable via `TRYCARDINAL_AI_BASE_URL`)
- **Auth**: API key via `x-api-key` header
- **Docs**: https://docs.trycardinal.ai/authentication

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/markdown` | POST | Convert a document to markdown (multipart) |
| `/split` | POST | Split a document into sections (multipart) |

## Environment Variables

| Variable | Description |
|----------|-------------|
| `TRYCARDINAL_AI_API_KEY` | API key (overrides profile config) |
| `TRYCARDINAL_AI_BASE_URL` | Optional custom base URL |

## CLI Commands

```bash
connect-trycardinal-ai convert-to-markdown --file-url <url>
connect-trycardinal-ai convert-to-markdown --file <path> [--pages <n>] [--start-page <n>]
connect-trycardinal-ai split-document --file-url <url> [--queries <json>]
connect-trycardinal-ai split-document --file <path>
connect-trycardinal-ai raw-request --path <path> [--method <method>] [--query <json>] [--body <json>]
connect-trycardinal-ai config set-key <key>
connect-trycardinal-ai profile list
```

## Code Style

- TypeScript with strict mode
- ESM modules (type: module)
- Bun runtime
