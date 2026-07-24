# CLAUDE.md

## Project Overview

connect-topaz-labs is a TypeScript connector for the Topaz Labs Image API (`https://api.topazlabs.com/image/v1`).

## Authentication

- **Type**: API key
- **Header**: `X-API-Key`
- **Env**: `TOPAZ_LABS_API_KEY` (alias: `CONNECTOR_API_KEY`)
- **Profiles**: `~/.hasna/connectors/topaz-labs/profiles/`

## Commands

```bash
bun install
bun run dev
bun run typecheck
bun test
bun run build
```

## CLI Groups

| Group | Operations |
|-------|------------|
| image | enhance, enhance-gen, sharpen, sharpen-gen, denoise, restore, lighting, matting, tool |
| status | list, get, delete, clear |
| download | output, input |
| estimate | standard, gen, bulk |
| cancel | cancel by process ID |

## API Docs

https://developer.topazlabs.com/reference
