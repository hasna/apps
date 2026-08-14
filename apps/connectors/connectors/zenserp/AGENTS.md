# AGENTS.md

Guidance for AI agents working with the Zenserp connector.

## Overview

TypeScript CLI and library for the Zenserp real-time SERP API (Google/Bing/Yandex search results).

## Commands

```bash
bun install
bun run dev
bun run build
bun run typecheck
bun test
```

## Authentication

API key via `apikey` header. Set with `ZENSERP_API_KEY` or `connect-zenserp config set-key <key>`.

## Structure

```
src/api/     # client + search modules
src/cli/     # Commander CLI
src/types/   # TypeScript types
src/utils/   # config + output
```

## Security

- Never commit API keys
- Use placeholder values in `.env.example` only
- No browser-use or scraping dependencies — this is a REST API client
