# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this connector.

## Project Overview

`@hasna/connect-surtrdefensesystems` is a TypeScript connector for **Surtr Defense Systems**,
a counter-UAS (C-UAS) operating system. It wraps the public Surtr HTTP API and exposes
sensors, fused threat tracks, the situation picture, and engagement workflows via a
library and a Commander.js CLI.

## Build & Run Commands

```bash
bun install
bun run dev            # run the CLI in development
bun run typecheck      # tsc --noEmit
bun test               # run bun tests
bun run build          # build dist/ and bin/
```

## Code Style

- TypeScript with strict mode, ESM modules (`type: module`)
- async/await for all async operations
- Minimal dependencies: `commander`, `chalk`
- Interfaces for all API types

## Project Structure

```
src/
├── api/
│   ├── client.ts     # Bearer-auth HTTP client (fetch)
│   ├── index.ts      # Surtr class with the API operations
│   └── surtr.test.ts # URL/header/body unit tests (mocked fetch)
├── cli/
│   └── index.ts      # CLI commands
├── types/
│   └── index.ts      # Type definitions
├── utils/
│   ├── config.ts     # Multi-profile configuration
│   └── output.ts     # CLI output formatting
└── index.ts          # Library exports
```

## API Operations (`Surtr`)

- `listSensors(options?)` → `GET /sensors`
- `getSensor(sensorId)` → `GET /sensors/{sensorId}`
- `listThreats(options?)` → `GET /threats`
- `getThreat(threatId)` → `GET /threats/{threatId}`
- `getSituationPicture()` → `GET /situation`
- `listEngagements(options?)` → `GET /engagements`
- `createEngagementRecommendation(input)` → `POST /engagements/recommendations`
- `rawRequest(path, options?)` → arbitrary authenticated request

## Authentication

Bearer API key in `src/api/client.ts`:

```typescript
'Authorization': `Bearer ${this.apiKey}`,
```

Default base URL is `https://api.surtrdefense.com/v1`, overridable via config,
the `--base-url` flag, or `SURTRDEFENSESYSTEMS_BASE_URL`.

## Environment Variables

| Variable | Description |
|----------|-------------|
| `SURTRDEFENSESYSTEMS_API_KEY` | API key (overrides profile) |
| `SURTRDEFENSESYSTEMS_BASE_URL` | Override API base URL (optional) |

## Data Storage

Profiles are stored in `~/.hasna/connectors/connect-surtrdefensesystems/`:

```
~/.hasna/connectors/connect-surtrdefensesystems/
├── current_profile   # Active profile name
└── profiles/
    ├── default.json  # Default profile
    └── {name}.json   # Named profiles
```

Profile JSON structure:
```json
{
  "apiKey": "...",
  "baseUrl": "https://api.surtrdefense.com/v1"
}
```
