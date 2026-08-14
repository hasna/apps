# AGENTS.md

Guidance for AI agents working with the Vector Legal connector.

## Overview

`@hasna/connect-vector-legal` is a REST bearer API connector for the Vector Legal legal document platform.

## Auth

- **Type**: Bearer API key
- **Env**: `VECTOR_LEGAL_API_KEY`
- **Optional**: `VECTOR_LEGAL_BASE_URL` (default `https://api.vector-legal.com/v1`)

## API Surface

- `documents` — GET/POST `/documents`, GET `/documents/:id`
- `events` — GET `/events`
- `search` — POST `/search`
- `raw` — arbitrary path/method helper

## Security

- No hardcoded credentials
- `.env.example` uses placeholders only
- No browser-use or scraper dependencies
