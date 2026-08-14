# CLAUDE.md

Guidance for working with the Standout connector.

## Project Overview

TypeScript connector for the Standout hiring-assessment REST API (`https://api.standout.ai/v1`). Provides multi-profile configuration, Bearer token authentication, and a Commander.js CLI.

## Build & Run Commands

```bash
bun install
bun run dev
bun run build
bun run typecheck
bun test src/api/client.test.ts
```

## Authentication

Bearer token authentication using an API key:

```typescript
'Authorization': `Bearer ${this.apiKey}`,
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `STANDOUT_API_KEY` | API key (overrides profile) |
| `STANDOUT_BASE_URL` | Optional API base URL override |

## Data Storage

```
~/.hasna/connectors/standout/
├── current_profile
└── profiles/
    └── default.json
```

Profile JSON structure:

```json
{
  "apiKey": "your-api-key",
  "baseUrl": "https://api.standout.ai/v1"
}
```
