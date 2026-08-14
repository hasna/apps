# CLAUDE.md

This file provides guidance to Claude Code when working with the Upstash connector.

## Project Overview

`@hasna/connect-upstash` is a TypeScript connector for the Upstash Developer API control plane (`https://api.upstash.com/v2`). It manages serverless Redis databases and Kafka topics — not direct Redis/Kafka data operations.

## Build & Run Commands

```bash
bun install
bun run dev databases list
bun run build
bun run typecheck
bun test src/api/client.test.ts
```

## Authentication

**API Key (email + api_key)** — HTTP Basic auth with base64(`email:api_key`).

| Variable | Description |
|----------|-------------|
| `UPSTASH_EMAIL` | Upstash account email |
| `UPSTASH_API_KEY` | Upstash API key from console |
| `UPSTASH_BASE_URL` | Optional API base URL override |

Profile config stored at `~/.hasna/connectors/connect-upstash/profiles/`.

## API Endpoints

| Method | Path | CLI Command |
|--------|------|-------------|
| GET | `/redis/databases` | `databases list` |
| GET | `/redis/database/:id` | `databases get <id>` |
| POST | `/redis/database` | `databases create --name <name>` |
| GET | `/redis/stats/:id` | `stats get <id>` |
| GET | `/kafka/topics` | `topics list` |

Database passwords are redacted (`[redacted]`) in all responses.

## Project Structure

```
src/
├── api/
│   ├── client.ts      # HTTP client with Basic auth, 15s timeout
│   ├── client.test.ts # Mock fetch tests
│   └── index.ts       # Upstash class
├── cli/index.ts       # Commander CLI
├── types/index.ts     # Type definitions
├── utils/
│   ├── config.ts      # Profile + credential management
│   └── output.ts      # CLI output formatting
└── index.ts           # Library exports
```

## Security

- Never commit real credentials
- Password fields are always redacted before returning API data
- No browser-use or scraper dependencies
