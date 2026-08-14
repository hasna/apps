# @hasna/connect-vercel-blob

TypeScript connector and CLI for [Vercel Blob](https://vercel.com/docs/storage/vercel-blob) object storage.

## Features

- List, create, search, and download blobs via the official Blob control-plane API
- Bearer token (`BLOB_READ_WRITE_TOKEN`) or OIDC + store ID auth
- Multi-profile configuration
- Programmatic API and Commander CLI

## Quick Start

```bash
cd connectors/vercel-blob
bun install
export BLOB_READ_WRITE_TOKEN=vercel_blob_rw_...
bun run dev blob list
```

Get your token from the Vercel dashboard (**Storage** → your store) or `vercel env pull` in a linked project.

## CLI

```bash
connect-vercel-blob config set-token <token>
connect-vercel-blob blob create uploads/photo.jpg ./photo.jpg --access public
connect-vercel-blob blob list --prefix uploads/
connect-vercel-blob blob search --prefix uploads/
connect-vercel-blob blob get uploads/photo.jpg --access public -o ./out.jpg
connect-vercel-blob raw-request GET "?limit=10"
```

`blob events` (list-events) is intentionally unsupported — the public Vercel Blob REST API does not expose store event streams.

## Library

```typescript
import { VercelBlob } from '@hasna/connect-vercel-blob';

const blob = new VercelBlob({ token: process.env.BLOB_READ_WRITE_TOKEN! });
await blob.createBlob('docs/readme.md', '# Hello', { access: 'public', contentType: 'text/markdown' });
const listed = await blob.listBlobs({ prefix: 'docs/' });
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `BLOB_READ_WRITE_TOKEN` | Primary read-write token |
| `VERCEL_BLOB_READ_WRITE_TOKEN` | Alias |
| `BLOB_STORE_ID` | Store ID for OIDC auth |
| `VERCEL_OIDC_TOKEN` | OIDC token on Vercel |

## Related Connectors

- `@hasna/connect-vercel` — Vercel deployment/project REST API
- `@hasna/connect-vercel-blob-platform` — alternate slug for the same Blob platform (distinct registry entry)

## License

Apache-2.0
