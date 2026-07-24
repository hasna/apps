# CLAUDE.md

Uploadcare REST API connector (`@hasna/connect-uploadcare`).

## Commands

```bash
bun install
bun run dev
bun run build
bun run typecheck
bun test
```

## Authentication

Uploadcare uses `Uploadcare.Simple publicKey:secretKey` with Accept header `application/vnd.uploadcare-v0.7+json`.

Environment variables:
- `UPLOADCARE_PUBLIC_KEY`
- `UPLOADCARE_SECRET_KEY`
- `UPLOADCARE_BASE_URL` (optional, default `https://api.uploadcare.com`)

Profiles stored in `~/.hasna/connectors/connect-uploadcare/profiles/`.

## API Modules

- `files` — list, get, store, delete, copy, metadata
- `groups` — list, get, delete
- `webhooks` — list, create, update, delete
- `project` — get project info
- `rawRequest` — arbitrary REST path

All REST paths use trailing slashes per Uploadcare API convention.
