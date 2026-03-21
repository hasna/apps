# open-crawl — CLAUDE.md

## Project
AI-powered web crawler — self-hosted Firecrawl alternative.
Package: `@hasna/crawl` | Port: `19700`

## Commands
```bash
bun test              # run tests
bun run typecheck     # TypeScript check
bun run build         # build all binaries (CLI + MCP + server + SDK)
bun run dev:cli       # run CLI from source
bun run dev:mcp       # run MCP server from source
bun run dev:serve     # run REST API server from source
```

## Architecture
```
src/
├── types/index.ts     # all TypeScript types
├── db/
│   ├── database.ts    # SQLite singleton (bun:sqlite, WAL mode)
│   ├── migrations.ts  # schema migrations (3 migrations)
│   ├── crawls.ts      # crawl job CRUD
│   └── pages.ts       # page CRUD + FTS5 search
├── lib/
│   ├── config.ts      # ~/.open-crawl/config.json
│   ├── fetcher.ts     # HTTP fetcher (retry, rate-limit, redirects)
│   ├── extractor.ts   # HTML → text + markdown (no deps)
│   ├── crawler.ts     # main crawl engine (startCrawl, crawlUrl, batchCrawl, recrawl)
│   ├── robots.ts      # robots.txt parser + cache
│   ├── sitemap.ts     # sitemap.xml parser (recursive, gzip)
│   ├── ai.ts          # OpenAI/Anthropic extraction + summarize + classify
│   ├── export.ts      # export to JSON/Markdown/CSV
│   └── diff.ts        # line-based content diff
├── cli/index.ts       # Commander.js CLI (15 commands)
├── mcp/index.ts       # MCP server (12 tools)
├── server/index.ts    # REST API + web dashboard (Bun.serve, port 19700)
└── index.ts           # public SDK exports
```

## Data Location
- DB: `~/.open-crawl/data.db` (override: `CRAWL_DB_PATH`)
- Config: `~/.open-crawl/config.json`
- Screenshots: `~/.open-crawl/screenshots/`

## Key Patterns
- All three entry points (CLI, MCP, server) share the same db/ and lib/ layer
- No code duplication — business logic lives in lib/, persistence in db/
- Playwright is optional — falls back to fetch() gracefully if not installed
- AI extraction needs `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` in env

## MCP Install
```bash
crawl mcp --claude    # installs crawl-mcp into Claude Code
crawl mcp --codex     # installs into Codex
crawl mcp --gemini    # installs into Gemini
```
