# CLAUDE.md

TextIt (RapidPro) API connector CLI.

## Build & Run

```bash
bun install
bun run dev
bun run typecheck
bun test
bun run build
```

## Authentication

API key (Token) authentication. Set credentials via `TEXTIT_API_TOKEN` or `connect-textit config set-token <token>`.

Requests use `Authorization: Token <api_token>` against `https://textit.com/api/v2`.

## Environment Variables

| Variable | Description |
|----------|-------------|
| `TEXTIT_API_TOKEN` | API token |
| `TEXTIT_BASE_URL` | Optional base URL override |
| `TEXTIT_TOKEN_PREFIX` | Optional auth prefix (default `Token`) |

## Project Structure

```
src/
├── api/client.ts   # HTTP transport (.json suffix, Token auth)
├── api/index.ts    # TextIt connector class
├── cli/index.ts    # connect-textit CLI
├── types/index.ts
└── utils/config.ts # Profiles under ~/.hasna/connectors/connect-textit/
```

## API Notes

TextIt REST API v2: all resource paths end with `.json`. Core resources: contacts, messages, flows, flow_starts.
