# @hasna/search

Unified search aggregator — query 12 search providers simultaneously and get normalized, deduplicated results. CLI + MCP server + REST API + Web Dashboard.

## Providers

| Provider | API | Key Required |
|----------|-----|--------------|
| Google | SerpAPI | `SERP_API_KEY` |
| SerpAPI (multi-engine) | SerpAPI | `SERP_API_KEY` |
| Exa.ai | Exa API | `EXA_API_KEY` |
| Perplexity | Perplexity API | `PERPLEXITY_API_KEY` |
| Brave Search | Brave Search API | `BRAVE_API_KEY` |
| Bing | Bing Web Search v7 | `BING_API_KEY` |
| Twitter/X | Twitter API v2 | `X_BEARER_TOKEN` |
| Reddit | Reddit OAuth | `REDDIT_CLIENT_ID` + `REDDIT_CLIENT_SECRET` |
| YouTube | YouTube Data API v3 | `YOUTUBE_API_KEY` |
| Hacker News | Algolia HN API | No key needed |
| GitHub | GitHub REST API | `GITHUB_TOKEN` |
| arXiv | arXiv API | No key needed |

## Install

```bash
bun add -g @hasna/search
```

## Usage

### CLI

```bash
# Unified search across all configured providers
search "typescript best practices"

# Search specific providers
search "query" --providers google,exa,perplexity

# Use a search profile
search "query" --profile research

# Provider-specific search
search:youtube "bun runtime" --transcribe

# Manage providers
search providers list
search providers enable brave

# Search history
search history
```

### MCP Server

```bash
# Install for Claude Code
search mcp --claude

# Or run directly
search-mcp
```

### REST API + Dashboard

```bash
search-serve --port 19800
# Open http://localhost:19800
```

## Features

- Multi-provider concurrent search
- Result normalization and deduplication
- Search profiles (research, social, video, code, academic)
- Search history and saved searches
- YouTube video transcription (via microservice-transcriber)
- Export results as JSON, CSV, or Markdown
- Web dashboard with dark/light mode

## License

Apache-2.0
