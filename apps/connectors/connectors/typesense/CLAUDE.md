# CLAUDE.md

Typesense search engine API connector.

## Auth

**API key** via `X-TYPESENSE-API-KEY` header. Profile fields: `apiKey`, `host` (required, e.g. `https://xxx.a1.typesense.net`).

## Environment Variables

| Variable | Description |
|----------|-------------|
| `TYPESENSE_API_KEY` | API key |
| `TYPESENSE_HOST` | Typesense cluster URL |

## Commands

```bash
bun install
bun run dev
bun run build
bun run typecheck
bun test
```

## API Coverage

Health/debug/stats/metrics, collections CRUD, documents CRUD/import/export, search/multi-search, API keys, aliases, synonyms, overrides.

## Docs

https://typesense.org/docs/29.0/api/
