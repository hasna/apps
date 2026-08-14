# AGENTS.md

This file provides guidance to AI coding agents when working with this repository.

## Project Overview

Telnyx API connector CLI — a TypeScript wrapper for the Telnyx v2 API
(`https://api.telnyx.com/v2`). Covers messaging, phone numbers, number search,
messaging profiles, and number lookup.

## Build & Run Commands

```bash
bun install        # Install dependencies
bun run dev        # Run CLI in development
bun run build      # Build for distribution
bun run typecheck  # Type check
bun test           # Run tests
```

## Code Style

- TypeScript with strict mode
- ESM modules (`type: module`)
- Async/await for all async operations
- Minimal dependencies: commander, chalk
- Type annotations required everywhere

## Project Structure

```
src/
├── api/
│   ├── client.ts              # HTTP client: Bearer auth, JSON body, error parsing
│   ├── messages.ts            # send / get
│   ├── phone-numbers.ts       # list / get owned numbers
│   ├── available-numbers.ts   # search numbers to purchase
│   ├── messaging-profiles.ts  # list / get
│   ├── number-lookup.ts       # carrier / caller lookup
│   └── index.ts               # Telnyx aggregate class
├── cli/index.ts               # CLI commands
├── types/index.ts             # Types + TelnyxApiError
├── utils/
│   ├── config.ts              # Multi-profile configuration
│   └── output.ts              # CLI output formatting
└── index.ts                   # Library exports
```

## Authentication

Bearer token: `Authorization: Bearer <api_key>`. The key resolves from the
`TELNYX_API_KEY` env var, the `--api-key` flag, or the profile config.

## API Notes

- Requests and responses are JSON. List/single responses use a `{ data, meta }`
  envelope; array filters are repeated query params (e.g. `filter[features]=sms`).
- Errors follow `{ "errors": [{ code, title, detail }] }` and are surfaced as
  `TelnyxApiError` (see `src/types/index.ts`). This differs from other connectors
  (e.g. Twilio's `{ message, code, more_info }`) — do not copy that parsing here.
- Telnyx has no "list messages" endpoint; only send and retrieve-by-id exist.

## Environment Variables

| Variable | Description |
|----------|-------------|
| `TELNYX_API_KEY` | Telnyx API key |

## Data Storage

```
~/.hasna/connectors/connect-telnyx/
├── current_profile   # Active profile name
└── profiles/
    └── <name>/config.json
```

## Dependencies

- commander: CLI framework
- chalk: Terminal styling
