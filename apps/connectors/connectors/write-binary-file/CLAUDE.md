# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

`connect-write-binary-file` is a TypeScript connector for the Write Binary File REST API. It provides multi-profile configuration, Bearer token (API key) authentication, and a CLI built with Commander.js.

## Build & Run Commands

```bash
bun install
bun run dev
bun run build
bun run typecheck
```

## Authentication

API key bearer auth. Set via profile config, `WRITE_BINARY_FILE_API_KEY`, or `--api-key`.

Default base URL: `https://api.write-binary-file.com/v1`

## API Surface

| Method | Endpoint | CLI |
|--------|----------|-----|
| GET | /files | files list |
| POST | /files | files create |
| GET | /files/{fileId} | files get |
| GET | /events | events list |
| POST | /search | search |
| * | custom path | raw-request |

## Data Storage

```
~/.hasna/connectors/connect-write-binary-file/
├── current_profile
└── profiles/
    └── default.json
```

Profile JSON: `{ "apiKey": "..." }`
