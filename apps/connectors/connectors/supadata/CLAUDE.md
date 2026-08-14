# CLAUDE.md

## Project Overview

connect-supadata is a TypeScript connector for the [Supadata API](https://docs.supadata.ai). It provides web scraping, video transcripts, metadata extraction, AI video analysis, and YouTube-specific endpoints.

## Build & Run Commands

```bash
bun install
bun run dev
bun run build
bun run typecheck
bun test
```

## Authentication

API key via `x-api-key` header. Configure with:

- Environment: `SUPADATA_API_KEY`
- CLI: `connect-supadata config set-key <key>`
- Profiles: `~/.hasna/connectors/connect-supadata/profiles/`

## API Modules

| Module | Endpoints |
|--------|-----------|
| account | `GET /me` |
| web | `GET /web/scrape`, `GET /web/map`, `POST /web/crawl`, `GET /web/crawl/{jobId}` |
| transcript | `GET /transcript`, `GET /transcript/{jobId}` |
| metadata | `GET /metadata` |
| extract | `POST /extract`, `GET /extract/{jobId}` |
| youtube | channel, playlist, video, search, transcript, batch endpoints |

Base URL: `https://api.supadata.ai/v1`

## Environment Variables

| Variable | Description |
|----------|-------------|
| `SUPADATA_API_KEY` | API key (required) |
| `SUPADATA_BASE_URL` | Override base URL |
