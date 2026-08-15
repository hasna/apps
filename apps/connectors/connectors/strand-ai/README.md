# @hasna/connect-strand-ai

Strand AI connector — WSI uploads, Lattice inference jobs, and imputation results via the [Strand AI Platform API](https://app.strandai.com/api/v1/openapi.json).

## Features

- Bearer token authentication with multi-profile support
- Upload lifecycle (initiate resumable upload, complete, list, get)
- Credit estimation and prediction job submission
- Job status, cancellation, and signed results URLs
- JSON and pretty CLI output formats

## Quick Start

```bash
cd connectors/strand-ai
bun install

# Configure API key (generate at https://app.strandai.com/settings/api-keys)
export STRAND_API_KEY=sk-strand-your-key
# or
bun run dev config set-key sk-strand-your-key

bun run dev uploads list
bun run dev predict estimate --upload-id <uuid> --markers '["CD3","CD8"]'
```

## CLI Commands

```bash
connect-strand-ai profile list|use|create|delete|show
connect-strand-ai config set-key|show|clear
connect-strand-ai uploads list|get <id>|initiate|complete <id>
connect-strand-ai predict estimate|submit
connect-strand-ai jobs get|cancel|results|stream-url <id>
connect-strand-ai raw-request --method GET --path /uploads
```

## Resumable Upload Flow

1. `uploads initiate --filename slide.svs --file-size 1234567 --content-type image/tiff`
2. PUT bytes to the returned `uploadUrl` (GCS resumable upload — outside this CLI)
3. `uploads complete <uploadId>`

## Job Streaming (SSE)

`jobs stream-url <id>` prints the SSE endpoint. Use `curl` or an SSE client with `Authorization: Bearer <key>`. The connector does not parse event streams.

## Library Usage

```typescript
import { StrandAI } from '@hasna/connect-strand-ai';

const strand = StrandAI.fromEnv();
const uploads = await strand.listUploads();
const estimate = await strand.estimatePrediction({
  uploadId: '...',
  markers: ['CD3', 'CD8'],
});
```

## License

Apache-2.0
