# @hasna/connect-vercel-blob-platform

TypeScript connector and CLI for [Vercel Blob](https://vercel.com/docs/storage/vercel-blob) object storage.

## Features

- Upload, list, download, inspect metadata, and delete blobs
- Bearer token (`BLOB_READ_WRITE_TOKEN`) or OIDC + store ID auth
- Multi-profile configuration
- Programmatic API and Commander CLI

## Quick Start

```bash
cd connectors/vercel-blob-platform
bun install
export BLOB_READ_WRITE_TOKEN=vercel_blob_rw_...
bun run dev blob list
```

Get your token from the Vercel dashboard (**Storage** → your store) or `vercel env pull` in a linked project.

## CLI

```bash
connect-vercel-blob-platform config set-token <token>
connect-vercel-blob-platform blob put uploads/photo.jpg ./photo.jpg --access public
connect-vercel-blob-platform blob list --prefix uploads/
connect-vercel-blob-platform blob head uploads/photo.jpg
connect-vercel-blob-platform blob get uploads/photo.jpg --access public -o ./out.jpg
connect-vercel-blob-platform blob del https://<store>.public.blob.vercel-storage.com/uploads/photo.jpg
```

## Library

```typescript
import { VercelBlobPlatform } from '@hasna/connect-vercel-blob-platform';

const blob = new VercelBlobPlatform({ token: process.env.BLOB_READ_WRITE_TOKEN! });
await blob.put('docs/readme.md', '# Hello', { access: 'public', contentType: 'text/markdown' });
const listed = await blob.list({ prefix: 'docs/' });
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `BLOB_READ_WRITE_TOKEN` | Primary read-write token |
| `VERCEL_BLOB_READ_WRITE_TOKEN` | Alias |
| `BLOB_STORE_ID` | Store ID for OIDC auth |
| `VERCEL_OIDC_TOKEN` | OIDC token on Vercel |

## License

Apache-2.0
