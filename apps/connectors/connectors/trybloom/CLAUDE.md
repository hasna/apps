# CLAUDE.md

Guidance for working with the Bloom (TryBloom) connector.

## Project Overview

`@hasna/connect-trybloom` is a TypeScript connector for the Bloom on-brand creative API. Authentication uses a Bearer API key. Default base URL: `https://www.trybloom.ai/api/v1`.

## Build & Run Commands

```bash
bun install
bun run dev
bun run build
bun run typecheck
bun test
```

## Auth

- Type: API key (Bearer token)
- Env: `TRYBLOOM_API_KEY`
- Optional: `TRYBLOOM_BASE_URL`
- Profiles: `~/.hasna/connectors/connect-trybloom/profiles/`

## API Surface

- `listBrands`, `getBrand`, `createBrand`
- `createGeneration`, `getGeneration`
- `editImage`, `resizeImage`, `uploadImage`
- `rawRequest`

## Docs

- Public API docs: https://www.trybloom.ai/mcp/
