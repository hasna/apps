# open-search

Unified search aggregator — 12 providers, CLI + MCP + REST API + Dashboard.

## Package

- **Name**: `@hasna/search`
- **Version**: 0.0.1
- **Port**: 19800 (`SEARCH_PORT`)
- **Config**: `~/.open-search/config.json`
- **Database**: `~/.open-search/data.db` (`SEARCH_DB_PATH`)

## Commands

```bash
bun run dev:cli        # Run CLI in dev mode
bun run dev:mcp        # Run MCP server in dev mode
bun run dev:serve      # Run REST API + dashboard in dev mode
bun run build          # Build all surfaces + dashboard
bun run build:no-dashboard  # Build without dashboard
bun test               # Run tests
bun run typecheck      # Type check
```

## Architecture

```
src/
├── types/index.ts          # TypeScript interfaces, Zod schemas, enums
├── db/
│   ├── database.ts         # SQLite singleton (WAL, FK, busy 5s)
│   ├── migrations.ts       # Forward-only migrations
│   ├── searches.ts         # Search history CRUD
│   ├── results.ts          # Search results CRUD + FTS5
│   ├── saved-searches.ts   # Saved search CRUD
│   ├── providers.ts        # Provider config CRUD
│   └── profiles.ts         # Search profile CRUD
├── lib/
│   ├── config.ts           # Configuration management
│   ├── search.ts           # Unified search engine
│   ├── dedup.ts            # URL normalization + dedup
│   ├── export.ts           # JSON/CSV/Markdown export
│   ├── youtube-deep.ts     # YouTube deep search + transcription
│   └── providers/
│       ├── types.ts        # SearchProvider interface
│       ├── index.ts        # Provider registry/factory
│       ├── google.ts       # Google via SerpAPI
│       ├── serpapi.ts       # SerpAPI multi-engine
│       ├── exa.ts          # Exa.ai semantic search
│       ├── perplexity.ts   # Perplexity API
│       ├── brave.ts        # Brave Search API
│       ├── bing.ts         # Bing Web Search API v7
│       ├── twitter.ts      # X/Twitter API v2
│       ├── reddit.ts       # Reddit OAuth API
│       ├── youtube.ts      # YouTube Data API v3
│       ├── hackernews.ts   # Algolia HN API
│       ├── github.ts       # GitHub Code Search API
│       ├── arxiv.ts        # arXiv API
│       └── transcriber.ts  # microservice-transcriber integration
├── cli/
│   ├── index.tsx           # Commander.js CLI entry
│   └── components/         # React/Ink TUI components
├── mcp/index.ts            # MCP server (~34 tools)
├── server/
│   ├── index.ts            # Server entry point
│   └── serve.ts            # Bun.serve() routes
└── index.ts                # Library SDK re-exports
dashboard/                  # Vite + React + shadcn/ui SPA
```

## Key Patterns

- **Singleton DB**: All surfaces share one `getDb()` connection
- **Provider interface**: Each provider implements `SearchProvider` with `search()` and `isConfigured()`
- **Plain fetch()**: No SDK packages for APIs — all providers use built-in fetch
- **Concurrent search**: `Promise.allSettled` across providers
- **URL dedup**: Normalize URLs, keep highest-scoring result
- **FTS5**: Full-text search on stored results

## Database Tables

- `searches` — search history
- `search_results` — normalized results (+ FTS5 virtual table)
- `saved_searches` — bookmarked queries
- `providers` — provider configuration (12 seeded)
- `search_profiles` — named provider combinations (6 seeded)

## Providers (12)

Google (SerpAPI), SerpAPI (multi-engine), Exa.ai, Perplexity, Brave, Bing, Twitter/X, Reddit, YouTube, Hacker News, GitHub, arXiv.

## Search Profiles (6 default)

- `research` — Google + Exa + Perplexity
- `social` — Twitter + Reddit + HN
- `video` — YouTube
- `code` — GitHub + Exa
- `academic` — arXiv + Exa + Perplexity
- `all` — All enabled providers
