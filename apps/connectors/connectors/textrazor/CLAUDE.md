# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Project Overview

connect-textrazor is a TypeScript CLI and library for the [TextRazor](https://www.textrazor.com/) NLP API. It provides entity extraction, topic detection, sentiment analysis, and custom extractor pipelines.

## Build & Run Commands

```bash
bun install
bun run dev
bun run build
bun run typecheck
bun test
```

## API Contract

- Base URL: `https://api.textrazor.com` (override with `TEXTRAZOR_BASE_URL`)
- Auth header: `X-TextRazor-Key`
- Analysis endpoint: `POST /` with `application/x-www-form-urlencoded` body
- Core form fields: `text`, `extractors` (comma-separated), optional `language` and cleanup params

## Authentication

API Key authentication via the `X-TextRazor-Key` header. Credentials can be set via:
- Environment variable `TEXTRAZOR_API_KEY`
- Profile configuration: `connect-textrazor config set-key <key>`

## CLI Commands

```bash
connect-textrazor analyze "Your text here" --extractors entities,topics
connect-textrazor entities "Your text here"
connect-textrazor topics "Your text here"
connect-textrazor sentiment "Your text here"
connect-textrazor raw --text "..." --extractors entities
connect-textrazor config set-key <key>
connect-textrazor profile list|use|create|delete|show
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `TEXTRAZOR_API_KEY` | API key (required) |
| `TEXTRAZOR_TOKEN` | Alias for API key |
| `TEXTRAZOR_BASE_URL` | Optional API base URL override |

## Data Storage

```
~/.hasna/connectors/connect-textrazor/
├── current_profile
└── profiles/
    ├── default.json
    └── {name}.json
```

## Dependencies

- commander: CLI framework
- chalk: Terminal styling
