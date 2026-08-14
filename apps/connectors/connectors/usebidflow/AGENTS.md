# AGENTS.md

Bidflow Platform (`usebidflow`) API connector.

## Commands

```bash
bun install
bun run dev
bun run build
bun run typecheck
bun test
```

## Authentication

Bearer token via `USEBIDFLOW_API_KEY` or `connect-usebidflow config set-key`.

## Structure

```
src/api/     # HTTP client + bids/events modules
src/cli/     # Commander CLI
src/types/   # TypeScript types
src/utils/   # config + output
```

## Data Storage

`~/.hasna/connectors/connect-usebidflow/profiles/`

## Security

- No hardcoded API keys
- `.env.example` uses placeholders only
- `@hasna` namespace
