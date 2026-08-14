# CLAUDE.md

Guidance for Claude Code when working with the Vercel Blob connector.

## Project Overview

`connect-vercel-blob` is a TypeScript connector for [Vercel Blob](https://vercel.com/docs/storage/vercel-blob) object storage. It wraps the Blob control-plane API (`https://vercel.com/api/blob`) and CDN download URLs (`*.blob.vercel-storage.com`).

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
~/.hasna/connectors/connect-vercel-blob/
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
connect-vercel-blob profile list
connect-vercel-blob config set-token <token>
connect-vercel-blob config set-store <storeId>
connect-vercel-blob config show

# Blob operations (alumia inventory mapping)
connect-vercel-blob blob list              # list-blobs
connect-vercel-blob blob create <path> <file> --access public   # create-blob
connect-vercel-blob blob get <urlOrPathname> --access private   # get-blob
connect-vercel-blob blob search --prefix docs/                  # search
connect-vercel-blob blob events            # list-events (unsupported — clear error)
connect-vercel-blob raw-request GET "?limit=5"
```

## API Coverage

- `createBlob` — upload via `PUT /api/blob/?pathname=…`
- `listBlobs` — paginated listing
- `searchBlobs` — prefix/cursor search (delegates to list)
- `getBlob` — download blob body from CDN URL
- `head` — metadata without body
- `listEvents` — **not supported** on public REST API
- `rawRequest` — escape hatch limited to `https://vercel.com/api/blob`

Control-plane requests send `x-api-version: 12` and `x-vercel-blob-store-id` per the official `@vercel/blob` SDK.

## Code Style

- TypeScript strict mode, ESM (`type: module`)
- Multi-profile config under `~/.hasna/connectors/`
- No browser-use or scraping dependencies
