# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

connect-3scribe is a TypeScript connector for the 3Scribe transcription API. It provides multi-profile configuration, API key authentication via the `APIKey` header, and a CLI for managing transcription jobs.

## Build & Run Commands

```bash
bun install
bun run dev
bun run build
bun run typecheck
bun run dev jobs list
bun run dev jobs get <jobId>
bun run dev jobs delete <jobId>
bun run dev transcribe --url <audioUrl>
bun run dev config show
bun run dev profile list
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
│   ├── client.ts     # HTTP client with APIKey auth, retry, timeout
│   ├── jobs.ts       # Jobs API module (list, get, delete, transcribe)
│   └── index.ts      # Main connector class
├── cli/
│   └── index.ts      # CLI commands
├── types/
│   └── index.ts      # Type definitions
├── utils/
│   ├── auth.ts       # OAuth2 authentication (scaffold)
│   ├── bulk.ts       # Bulk operation utilities
│   ├── config.ts     # Multi-profile configuration
│   ├── output.ts     # CLI output formatting
│   ├── settings.ts   # User preferences storage
│   └── storage.ts    # Local data storage
├── index.ts          # Library exports
scripts/
└── release.ts        # Release automation
```

## API Reference

- Base URL: `https://api.3scri.be`
- Auth: `APIKey` header
- GET /jobs - List transcription jobs
- GET /jobs/:jobid - Get a specific job
- DELETE /jobs/:jobid - Delete a job
- POST /transcribe - Submit a new transcription

## Environment Variables

| Variable | Description |
|----------|-------------|
| `THREESCRIBE_API_KEY` | API key (overrides profile) |
| `THREESCRIBE_TOKEN` | Token (alias for API key) |

## Data Storage

```
~/.connect/connect-3scribe/
├── current_profile
├── settings.json
├── data/
└── profiles/
    ├── default.json
    └── {name}.json
```
