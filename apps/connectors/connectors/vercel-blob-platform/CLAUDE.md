# CLAUDE.md

Guidance for Claude Code when working with the Vercel Blob Platform connector.

## Project Overview

`connect-vercel-blob-platform` is a TypeScript connector for [Vercel Blob](https://vercel.com/docs/storage/vercel-blob) object storage. It wraps the Blob control-plane API (`https://vercel.com/api/blob`) and CDN download URLs (`*.blob.vercel-storage.com`).

## Build & Run

```bash
bun install
bun run dev
bun run build
bun run typecheck
bun test
```

## Authentication

Uses **Bearer** token authentication (`apikey` / `bearer` in dashboard auth detection).

| Variable | Description |
|----------|-------------|
| `BLOB_READ_WRITE_TOKEN` | Read-write token from Vercel Storage dashboard |
| `VERCEL_BLOB_READ_WRITE_TOKEN` | Alias supported by this CLI |
| `BLOB_STORE_ID` | Store ID when using OIDC (`store_…` or bare id) |
| `VERCEL_OIDC_TOKEN` | Short-lived OIDC token on Vercel deployments |

Create a token: Vercel dashboard → **Storage** → your Blob store → connect / env vars, or run `vercel env pull` in a linked project.

## Data Storage

```
~/.hasna/connectors/connect-vercel-blob-platform/
├── current_profile
└── profiles/
    └── default.json
```

Profile JSON:

```json
{
  "token": "vercel_blob_rw_…",
  "storeId": "store_…",
  "oidcToken": "…"
}
```

## CLI Commands

```bash
# Profiles & config
connect-vercel-blob-platform profile list
connect-vercel-blob-platform config set-token <token>
connect-vercel-blob-platform config set-store <storeId>
connect-vercel-blob-platform config show

# Blob operations
connect-vercel-blob-platform blob put <pathname> <file> --access public
connect-vercel-blob-platform blob list --prefix images/
connect-vercel-blob-platform blob get <urlOrPathname> --access private
connect-vercel-blob-platform blob head <urlOrPathname>
connect-vercel-blob-platform blob del <url> [more urls...]
```

## API Coverage

- `put` — upload via `PUT /api/blob/?pathname=…`
- `list` — paginated listing
- `get` — download blob body from CDN URL
- `head` — metadata without body
- `del` — delete one or more blobs (`POST /api/blob/delete`)

Control-plane requests send `x-api-version: 12` and `x-vercel-blob-store-id` per the official `@vercel/blob` SDK.

## Code Style

- TypeScript strict mode, ESM (`type: module`)
- Multi-profile config under `~/.hasna/connectors/`
- No browser-use or scraping dependencies
