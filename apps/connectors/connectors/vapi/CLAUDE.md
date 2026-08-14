# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.

## Project Overview

connect-vapi is a TypeScript connector for the Vapi voice AI API. It provides both a CLI and library interface for managing assistants, calls, phone numbers, and tools.

## Build & Run Commands

```bash
bun install
bun run dev
bun run build
bun run typecheck
bun test
```

## Authentication

Bearer token authentication. Credentials via:
- `VAPI_API_KEY` environment variable
- Profile: `connect-vapi config set-key <key>`

## Data Storage

```
~/.hasna/connectors/connect-vapi/
├── current_profile
└── profiles/
    └── default.json
```

## API Base URL

Default: `https://api.vapi.ai`

Endpoints use singular resource paths: `/assistant`, `/call`, `/phone-number`, `/tool`.

## Dependencies

- commander: CLI framework
- chalk: Terminal styling
