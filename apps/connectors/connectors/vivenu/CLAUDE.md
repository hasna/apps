# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Project Overview

connect-vivenu is a TypeScript connector for the Vivenu Distribution API — event ticketing integration for sellers, events, availabilities, and checkouts.

API documentation: https://docs.vivenu.dev/distribution

## Build & Run Commands

```bash
bun install
bun run dev
bun run build
bun run typecheck
bun test
```

## Authentication

API Key authentication with a distributor type header:
- `Authorization` — raw secret API key (NOT Bearer prefix)
- `x-distributor-type` — registered distributor type string

Credentials via environment variables or profile config:
- `connect-vivenu config set-key <key>`
- `connect-vivenu config set-distributor-type <type>`

## Environment Variables

| Variable | Description |
|----------|-------------|
| `VIVENU_API_KEY` | Secret API key |
| `VIVENU_DISTRIBUTOR_TYPE` | Distributor type identifier |
| `VIVENU_BASE_URL` | Optional base URL override |

## Data Storage

```
~/.hasna/connectors/connect-vivenu/
├── current_profile
└── profiles/
    └── default.json
```

Profile JSON:
```json
{
  "apiKey": "your-key",
  "distributorType": "YourDistributorType",
  "baseUrl": "https://vivenu.com"
}
```

## Project Structure

```
src/
├── api/
│   ├── client.ts        # HTTP client (raw Authorization + x-distributor-type)
│   ├── distribution.ts  # Distribution API methods
│   └── index.ts         # Vivenu class
├── cli/index.ts         # CLI commands
├── types/index.ts       # Type definitions
├── utils/config.ts      # Multi-profile configuration
└── utils/output.ts      # CLI output formatting
```

## API Endpoints

| Method | Path | CLI |
|--------|------|-----|
| GET | /api/distribution/sellers | distribution list-sellers |
| GET | /api/distribution/events | distribution list-events |
| GET | /api/distribution/events/{id} | distribution get-event |
| GET | /api/distribution/events/{id}/availabilities | distribution list-availabilities |
| POST | /api/distribution/checkout | distribution create-checkout |

## Dependencies

- commander: CLI framework
- chalk: Terminal styling
