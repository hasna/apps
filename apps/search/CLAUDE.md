# search

Unified search — local file index (find files by name/path/content) + 12 web providers. CLI + MCP + REST API + Dashboard.

## Package

- **Name**: `@hasna/search`
- **Port**: 19800 (`SEARCH_PORT`)
- **Config**: `~/.hasna/search/config.json`
- **History DB**: `~/.hasna/search/data.db` (`HASNA_SEARCH_DB_PATH` / `SEARCH_DB_PATH`)
- **File index DB**: `~/.hasna/search/index.db` (`HASNA_SEARCH_INDEX_DB_PATH` / `SEARCH_INDEX_DB_PATH`) — machine-local, never synced

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
├── types/index.ts          # TypeScript interfaces, Zod schemas, enums, LOCAL_PROVIDER_NAMES
├── db/
│   ├── database.ts         # History SQLite singleton (data.db)
│   ├── migrations.ts       # Forward-only migrations (data.db)
│   ├── index-db.ts         # Local file index SQLite singleton (index.db, WAL)
│   ├── index-migrations.ts # Forward-only migrations (index.db)
│   ├── searches.ts         # Search history CRUD
│   ├── results.ts          # Search results CRUD + FTS5
│   ├── saved-searches.ts   # Saved search CRUD
│   ├── providers.ts        # Provider config CRUD
│   ├── profiles.ts         # Search profile CRUD
│   └── storage-*.ts        # Optional Postgres sync (history tables only)
├── lib/
│   ├── config.ts           # Configuration management
│   ├── search.ts           # Unified search engine
│   ├── dedup.ts            # URL normalization + dedup
│   ├── export.ts           # JSON/CSV/Markdown export
│   ├── youtube-deep.ts     # YouTube deep search + transcription
│   ├── local/
│   │   ├── ignore.ts       # Gitignore-style matcher + DEFAULT_EXCLUDES
│   │   ├── walker.ts       # Recursive scan, binary sniffing, content excludes
│   │   ├── indexer.ts      # Roots CRUD, incremental indexing, staleness refresh
│   │   ├── query.ts        # searchFilePaths / searchFileContent (trigram FTS)
│   │   └── find.ts         # findLocal — one-call agent lookup
│   └── providers/
│       ├── types.ts        # SearchProvider interface
│       ├── index.ts        # Provider registry/factory
│       ├── files.ts        # Local file path/name search
│       ├── content.ts      # Local file content search
│       └── *.ts            # 12 web providers (plain fetch, no SDKs)
├── cli/
│   ├── index.tsx           # Commander.js CLI entry
│   ├── local.ts            # find + index commands
│   └── storage.ts          # storage sync commands
├── mcp/index.ts            # MCP server (find, index_*, search tools)
├── server/serve.ts         # Bun.serve() routes incl. /api/find, /api/index
└── index.ts                # Library SDK re-exports
dashboard/                  # Vite + React SPA (Search, Local, History, ... tabs)
```

## Key Patterns

- **Two databases**: `data.db` (history; optionally synced to Postgres) and `index.db` (local file index; never synced)
- **Provider interface**: Each provider implements `SearchProvider` with `search()` and `isConfigured()`; local providers are configured when ≥1 index root is ready
- **Trigram FTS5**: substring matching over file names/paths and content; contentless content table — files are re-read on hit for exact line numbers
- **Incremental indexing**: diff by (size, mtime_ms); gitignore + default excludes; symlinks skipped; auto-refresh when stale (`indexStaleMinutes`)
- **Plain fetch()**: No SDK packages for web APIs
- **Concurrent search**: `Promise.allSettled` across providers
- **URL dedup**: Normalize URLs, keep highest-scoring result
- **Local results** are not persisted to history by default (`recordLocalResults`)

## Database Tables

data.db: `searches`, `search_results` (+FTS5), `saved_searches`, `providers` (14 seeded), `search_profiles` (7 seeded), `feedback`
index.db: `index_roots`, `files` (+`files_fts` trigram), `file_content_fts` (contentless trigram)

## Providers (14)

Local: files (path/name), content (file content). Web: Google (SerpAPI), SerpAPI (multi-engine), Exa.ai, Perplexity, Brave, Bing, Twitter/X, Reddit, YouTube, Hacker News, GitHub, arXiv.

## Search Profiles (7 default)

- `local` — files + content (local filesystem)
- `research` — Google + Exa + Perplexity
- `social` — Twitter + Reddit + HN
- `video` — YouTube
- `code` — GitHub + Exa
- `academic` — arXiv + Exa + Perplexity
- `all` — All enabled providers (web + local)

## Agent Usage

- `search find <query>` / MCP `find` tool — one-call local file lookup (name/path/content, ranked, line numbers)
- `search index add <path>` — register + index a workspace root
- `search index update` — incremental reindex (also happens automatically when stale)
