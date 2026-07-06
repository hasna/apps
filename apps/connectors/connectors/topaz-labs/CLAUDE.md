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
| image | enhance, upscale, sharpen, denoise, restore, generative-upscale, lighting, preview-enhance |
| jobs | get, list, cancel, delete |
| batch | submit |
| models | list, get |
| presets | list, create, update, delete |
| tags | list, create, delete |
| uploads | create-url |
| account | get, credits, usage |
| webhooks | list, create, delete |

## API Docs

https://developer.topazlabs.com/reference
