# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.

## Project Overview

connect-textcortex is a TypeScript CLI and library for the TextCortex API. It provides Hemingwai endpoints for text generation, summarization, rewriting, and classification with multi-profile support.

## Build & Run Commands

```bash
bun install
bun run dev
bun run build
bun run typecheck
bun test
```

## Authentication

Bearer Token authentication. Credentials can be set via:
- Environment variable `TEXTCORTEX_API_KEY`
- Profile configuration: `connect-textcortex config set-key <key>`

## API Endpoints

Base URL: `https://api.textcortex.com`

| Operation | Path |
|-----------|------|
| Generate | `POST /hemingwai/generate_text_v3/` |
| Summarize | `POST /hemingwai/summarize_text_v1/` |
| Rewrite | `POST /hemingwai/rewrite_text_v1/` |
| Classify | `POST /hemingwai/classify_text_v1/` |

## CLI Commands

```bash
connect-textcortex generate <prompt> [--max-tokens N]
connect-textcortex summarize <text> [--max-tokens N]
connect-textcortex rewrite <text> [--mode MODE]
connect-textcortex classify <text> [--labels a,b,c]
connect-textcortex request --path /hemingwai/generate_text_v3/ [--body '{}']

connect-textcortex config set-key <key>
connect-textcortex config set-base-url <url>
connect-textcortex config show

connect-textcortex profile list|use|create|delete|show
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `TEXTCORTEX_API_KEY` | API key |
| `TEXTCORTEX_BASE_URL` | Override base URL (optional) |

## Data Storage

```
~/.hasna/connectors/connect-textcortex/
├── current_profile
└── profiles/
    └── default.json
```
