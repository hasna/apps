# @hasna/connect-xray

TypeScript connector for the [Xray](https://www.ycombinator.com/companies/xray) test management platform API.

## Overview

Xray provides scans, events, and search APIs for QA and test management workflows. This connector exposes those endpoints via a typed client and CLI.

**Note:** Public API documentation for `api.xray.com` is limited. Endpoint shapes follow the published inventory (`GET/POST /scans`, `GET /scans/{id}`, `GET /events`, `POST /search`). Use the `raw request` command for endpoints not yet wrapped.

## Installation

```bash
bun install
```

## Configuration

```bash
export XRAY_API_KEY=your-api-key
# optional
export XRAY_BASE_URL=https://api.xray.com/v1
```

Or via CLI profile:

```bash
connect-xray config set-key <api-key>
connect-xray config set-base-url https://api.xray.com/v1
```

## CLI Usage

```bash
connect-xray scans list
connect-xray scans get <scanId>
connect-xray scans create --name "Regression run"
connect-xray events list --scan-id <scanId>
connect-xray search run --query "failed tests"
connect-xray raw request --path /scans --method GET
```

## Library Usage

```typescript
import { Connector } from '@hasna/connect-xray';

const xray = new Connector({ apiKey: process.env.XRAY_API_KEY! });
const scans = await xray.scans.list();
const scan = await xray.scans.get('scan-id');
const results = await xray.search.search({ query: 'smoke' });
```

## Development

```bash
bun run dev -- scans list
bun run typecheck
bun run build
bun test
```

## Authentication

Bearer token via `Authorization: Bearer <api_key>` header.

## License

Apache-2.0
