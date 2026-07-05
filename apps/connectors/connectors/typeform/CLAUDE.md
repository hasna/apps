# CLAUDE.md

Guidance for working with the Typeform connector (`connect-typeform`).

## Overview

`@hasna/connect-typeform` is a TypeScript API connector for the Typeform REST API (`https://api.typeform.com`). It provides a CLI and programmatic library for forms, responses, webhooks, workspaces, themes, and images.

## Authentication

**Bearer token** — Personal Access Token from the Typeform admin dashboard.

```typescript
'Authorization': `Bearer ${apiToken}`,
```

Environment variable: `TYPEFORM_API_TOKEN`

Profiles stored in `~/.hasna/connectors/connect-typeform/profiles/`.

## Build & Run

```bash
bun install
bun run dev forms list
bun run typecheck
bun test
bun run build
```

## Project Structure

```
src/
├── api/
│   ├── client.ts       # HTTP client (Bearer auth, path encoding)
│   ├── client.test.ts  # Mock-fetch unit tests
│   └── index.ts        # Typeform class (API methods)
├── cli/index.ts        # Commander CLI (26 API subcommands)
├── types/index.ts      # Config and API types
├── utils/              # config, output, auth, bulk, settings, storage
└── index.ts            # Library exports
```

## API Surface

| Resource | Endpoints |
|----------|-----------|
| Forms | list, get, create, update, patch, delete |
| Responses | list, delete by token |
| Webhooks | list, get, upsert, delete |
| Workspaces | list, get, update, list forms |
| Themes | list, get, create, update, delete |
| Images | list, get, create, delete |
| Raw | arbitrary relative path via `rawRequest` |

## Environment Variables

| Variable | Description |
|----------|-------------|
| `TYPEFORM_API_TOKEN` | Personal access token (overrides profile) |
| `TYPEFORM_BASE_URL` | Optional API base URL override |

## Dependencies

- commander — CLI framework
- chalk — Terminal styling
