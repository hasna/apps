# CLAUDE.md

Weaviate vector database connector for self-hosted instances.

## Commands

```bash
bun install
bun run dev
bun run build
bun run typecheck
bun test
```

## API

Base URL: `{host}/v1` with optional `Authorization: Bearer {apiKey}`.

Methods: `getSchema`, `createClass`, `deleteClass`, `addObject`, `getObject`, `updateObject`, `deleteObject`, `graphqlQuery`, `nearTextSearch`, `getNode`.

## Config

- Profile dir: `~/.hasna/connectors/connect-weaviate/`
- Env: `WEAVIATE_HOST`, `WEAVIATE_API_KEY`
