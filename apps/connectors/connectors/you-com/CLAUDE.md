# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Project Overview

connect-you-com is a TypeScript CLI and library for the You.com Web Search and Research APIs. It provides LLM-ready web search via `ydc-index.io` and citation-backed deep research via `api.you.com`.

## Build & Run Commands

```bash
bun install
bun run dev
bun run build
bun run typecheck
bun test

# Example commands
bun run dev search "latest AI developments" --count 5
bun run dev search-post "cloud providers" --include-domains aws.amazon.com,cloud.google.com
bun run dev research "microservices vs monolith tradeoffs" --effort standard
```

## Code Style

- TypeScript with strict mode
- ESM modules (type: module)
- Use async/await for all async operations
- Minimal dependencies: commander, chalk only
- Type annotations required everywhere

## Project Structure

```
src/
├── api/
│   ├── client.ts     # HTTP client with X-API-Key auth
│   ├── search.ts     # GET/POST /v1/search
│   ├── research.ts   # POST /v1/research
│   └── index.ts      # Main YouCom class
├── cli/
│   └── index.ts      # CLI commands
├── types/
│   └── index.ts      # API types
├── utils/
│   ├── config.ts     # Multi-profile configuration
│   └── output.ts     # CLI output formatting
└── index.ts          # Library exports
```

## API Endpoints

| API | Base URL | Endpoint |
|-----|----------|----------|
| Search | `https://ydc-index.io` | `GET/POST /v1/search` |
| Research | `https://api.you.com` | `POST /v1/research` |

Docs: https://you.com/docs

## Authentication

API Key authentication via `X-API-Key` header. Credentials can be set via:
- Environment variable `YDC_API_KEY`
- Profile configuration: `connect-you-com config set-key <key>`

## Environment Variables

| Variable | Description |
|----------|-------------|
| `YDC_API_KEY` | You.com API key |
| `YDC_SEARCH_BASE_URL` | Optional search API base URL override |
| `YDC_RESEARCH_BASE_URL` | Optional research API base URL override |

## Data Storage

```
~/.hasna/connectors/connect-you-com/
├── current_profile   # Active profile name
└── profiles/
    ├── default.json  # Default profile
    └── {name}.json   # Named profiles
```

Profile JSON:
```json
{
  "apiKey": "your-key-here"
}
```

## CLI Commands

```bash
connect-you-com search <query> [--count N] [--freshness week] [--livecrawl all]
connect-you-com search-post <query> [--include-domains a.com,b.com] [--exclude-domains spam.com]
connect-you-com research <input> [--effort standard|lite|deep|exhaustive]

connect-you-com config set-key <key>
connect-you-com config show
connect-you-com config clear

connect-you-com profile list|use|create|delete|show
```

## Dependencies

- commander: CLI framework
- chalk: Terminal styling
